import mongoose from 'mongoose';
import { Timesheet } from '../models/Timesheet.js';
import { TIMESHEET_STATUS } from '../config/constants.js';
import { formatMinutes, parseTimeToMinutes } from '../utils/time.js';
import { addDays, endOfWeek, startOfWeek, toDateKey } from '../utils/week.js';

/**
 * Productive-hours rules (monitoring metric only; logged/worked hours are never changed):
 * - a duty period counts for at most 13h from its start
 * - a new duty period needs 11h of continuous rest after the previous shift ended; time worked
 *   before that rest ends doesn't count, and a fresh duty period starts once it does
 * - the week is capped at 20h, scaled proportionally across that week's shifts
 */
export const MAX_DUTY_SPAN_MINUTES = 13 * 60;
export const MIN_REST_MINUTES = 11 * 60;
export const MAX_PRODUCTIVE_MINUTES_PER_WEEK = 20 * 60;

/** Look-back for shifts before the week that can affect Monday's rest check. */
const CONTEXT_DAYS = 2;

const REJECTED = [TIMESHEET_STATUS.ADMIN_REJECTED, TIMESHEET_STATUS.SUPER_ADMIN_REJECTED];

export type ProductiveAllocation = {
  productiveMinutes: number;
  productiveHoursDisplay: string;
  productiveSource: 'RULE';
  productiveNote: string;
};

type SheetLike = {
  _id: mongoose.Types.ObjectId;
  date: Date;
  startTime: string;
  endTime: string;
  totalMinutes: number;
  createdAt?: Date;
};

function noteFor(worked: number, compliant: number, productive: number): string {
  if (worked <= 0) return 'No worked hours.';
  const parts: string[] = [];
  if (compliant < worked) {
    parts.push(
      `${formatMinutes(worked - compliant)}h outside working-time rules (max ${MAX_DUTY_SPAN_MINUTES / 60}h duty, ${MIN_REST_MINUTES / 60}h rest).`,
    );
  }
  if (productive < compliant) {
    parts.push(
      `Scaled to fit the ${MAX_PRODUCTIVE_MINUTES_PER_WEEK / 60}h weekly cap (${formatMinutes(productive)} of ${formatMinutes(compliant)} compliant).`,
    );
  }
  if (!parts.length) return `Counts in full (${formatMinutes(worked)}).`;
  return `${parts.join(' ')} Worked ${formatMinutes(worked)} still recorded.`;
}

function compareSheets(a: SheetLike, b: SheetLike) {
  const day = toDateKey(new Date(a.date)).localeCompare(toDateKey(new Date(b.date)));
  if (day !== 0) return day;
  const start = String(a.startTime).localeCompare(String(b.startTime));
  if (start !== 0) return start;
  const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  if (createdA !== createdB) return createdA - createdB;
  return String(a._id).localeCompare(String(b._id));
}

/** Wall-clock interval in absolute minutes; end before start means an overnight shift. */
function shiftInterval(sheet: SheetLike) {
  const dayStart = Math.floor(new Date(sheet.date).getTime() / 60000);
  const startMin = parseTimeToMinutes(sheet.startTime);
  const endMin = parseTimeToMinutes(sheet.endTime);
  if (Number.isNaN(startMin) || Number.isNaN(endMin)) return null;
  const start = dayStart + startMin;
  let span = endMin - startMin;
  if (span <= 0) span += 24 * 60;
  return { start, end: start + span, span };
}

type DutyState = { lastEnd: number | null; windowStart: number };

/** Minutes of the shift's span that fall inside a valid duty window; advances `state`. */
function compliantSpanFor(interval: { start: number; end: number }, state: DutyState): number {
  const { start, end } = interval;
  let span = 0;
  if (state.lastEnd === null || start - state.lastEnd >= MIN_REST_MINUTES) {
    state.windowStart = start;
    span = Math.min(end, start + MAX_DUTY_SPAN_MINUTES) - start;
  } else {
    // Gap under 11h: continue the current duty while its window lasts (split shifts)...
    const windowEnd = state.windowStart + MAX_DUTY_SPAN_MINUTES;
    if (start < windowEnd) span += Math.min(end, windowEnd) - start;
    // ...then time worked during the required rest is skipped and a new duty starts after it.
    const newStart = Math.max(state.lastEnd + MIN_REST_MINUTES, windowEnd);
    if (end > newStart) {
      state.windowStart = newStart;
      span += Math.min(end, newStart + MAX_DUTY_SPAN_MINUTES) - newStart;
    }
  }
  state.lastEnd = state.lastEnd === null ? end : Math.max(state.lastEnd, end);
  return Math.max(0, span);
}

/** Distribute `cap` across values proportionally, rounding so the total is exactly `cap`. */
function scaleToCap(values: number[], cap: number): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= cap) return values;
  const raw = values.map((value) => (value * cap) / total);
  const scaled = raw.map(Math.floor);
  let leftover = cap - scaled.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (leftover <= 0) break;
    scaled[index] += 1;
    leftover -= 1;
  }
  return scaled;
}

/**
 * Allocate productive minutes for one week's sheets.
 * `context` sheets (just before the week) only feed the rest-period check; they get no allocation.
 */
export function allocateProductiveHours(sheets: SheetLike[], context: SheetLike[] = []): Map<string, ProductiveAllocation> {
  const targetIds = new Set(sheets.map((sheet) => String(sheet._id)));
  const ordered = [...context.filter((sheet) => !targetIds.has(String(sheet._id))), ...sheets].sort(compareSheets);

  const rows: { id: string; worked: number; compliant: number }[] = [];
  const state: DutyState = { lastEnd: null, windowStart: 0 };

  for (const sheet of ordered) {
    const worked = Math.max(0, Number(sheet.totalMinutes) || 0);
    const interval = shiftInterval(sheet);
    let compliant = 0;
    if (interval) {
      const compliantSpan = compliantSpanFor(interval, state);
      compliant = Math.min(worked, Math.round((worked * compliantSpan) / interval.span));
    }
    if (targetIds.has(String(sheet._id))) rows.push({ id: String(sheet._id), worked, compliant });
  }

  const productive = scaleToCap(
    rows.map((row) => row.compliant),
    MAX_PRODUCTIVE_MINUTES_PER_WEEK,
  );
  const result = new Map<string, ProductiveAllocation>();
  rows.forEach((row, index) => {
    result.set(row.id, {
      productiveMinutes: productive[index],
      productiveHoursDisplay: formatMinutes(productive[index]),
      productiveSource: 'RULE',
      productiveNote: noteFor(row.worked, row.compliant, productive[index]),
    });
  });
  return result;
}

async function recalculateWeek(userId: string, weekStart: Date) {
  const weekEnd = endOfWeek(weekStart);
  const user = new mongoose.Types.ObjectId(userId);
  const fields = '_id date startTime endTime totalMinutes createdAt';
  const [sheets, context] = await Promise.all([
    Timesheet.find({ userId: user, date: { $gte: weekStart, $lte: weekEnd }, status: { $nin: REJECTED } }).select(fields),
    Timesheet.find({ userId: user, date: { $gte: addDays(weekStart, -CONTEXT_DAYS), $lt: weekStart }, status: { $nin: REJECTED } }).select(fields),
  ]);

  const allocations = allocateProductiveHours(sheets, context);
  // Only productive* fields are written; logged hours (start/end/break/totalMinutes) are never touched.
  const ops = sheets.map((sheet) => {
    const allocation = allocations.get(String(sheet._id)) ?? {
      productiveMinutes: 0,
      productiveHoursDisplay: '0:00',
      productiveSource: 'RULE' as const,
      productiveNote: noteFor(sheet.totalMinutes, 0, 0),
    };
    return {
      updateOne: {
        filter: { _id: sheet._id },
        update: { $set: allocation },
      },
    };
  });
  if (ops.length) await Timesheet.bulkWrite(ops);

  // Rejected sheets in this week keep zero productive so UI stays clear.
  await Timesheet.updateMany(
    { userId: user, date: { $gte: weekStart, $lte: weekEnd }, status: { $in: REJECTED } },
    {
      $set: {
        productiveMinutes: 0,
        productiveHoursDisplay: '0:00',
        productiveSource: 'RULE',
        productiveNote: 'Rejected timesheets do not count toward productive hours.',
      },
    },
  );

  return allocations;
}

export async function recalculateProductiveHoursForUserWeek(userId: string, date: Date) {
  const weekStart = startOfWeek(date);
  const allocations = await recalculateWeek(userId, weekStart);
  // Late-week shifts feed next Monday's rest check.
  if (toDateKey(date) >= toDateKey(addDays(weekStart, 7 - CONTEXT_DAYS))) {
    await recalculateWeek(userId, addDays(weekStart, 7));
  }
  return allocations;
}

export async function backfillAllProductiveHours() {
  const userIds = await Timesheet.distinct('userId');
  let weeks = 0;
  for (const userId of userIds) {
    const dates = await Timesheet.distinct('date', { userId });
    const seenWeeks = new Set<string>();
    for (const date of dates) {
      const start = startOfWeek(new Date(date));
      const key = `${String(userId)}:${toDateKey(start)}`;
      if (seenWeeks.has(key)) continue;
      seenWeeks.add(key);
      // Chronological weeks; each week reads its own context, so order doesn't affect results.
      await recalculateWeek(String(userId), start);
      weeks += 1;
    }
  }
  return { users: userIds.length, weeks };
}
