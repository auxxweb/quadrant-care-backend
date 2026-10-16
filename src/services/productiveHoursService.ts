import mongoose from 'mongoose';
import { Timesheet } from '../models/Timesheet.js';
import { TIMESHEET_STATUS } from '../config/constants.js';
import { formatMinutes } from '../utils/time.js';
import { endOfWeek, startOfWeek, toDateKey } from '../utils/week.js';

/** Auto-cap rules: productive time counts as real work for monitoring. */
export const MAX_PRODUCTIVE_MINUTES_PER_DAY = 2 * 60;
export const MAX_PRODUCTIVE_MINUTES_PER_WEEK = 20 * 60;

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
  totalMinutes: number;
  createdAt?: Date;
};

function noteFor(productive: number, worked: number): string {
  if (worked <= 0) return 'No worked hours.';
  if (productive >= worked) {
    return `Productive equals worked (${formatMinutes(worked)}). Caps: ${MAX_PRODUCTIVE_MINUTES_PER_DAY / 60}h/day, ${MAX_PRODUCTIVE_MINUTES_PER_WEEK / 60}h/week.`;
  }
  if (productive === 0) {
    return `No productive time remaining after caps (${MAX_PRODUCTIVE_MINUTES_PER_DAY / 60}h/day, ${MAX_PRODUCTIVE_MINUTES_PER_WEEK / 60}h/week). Worked ${formatMinutes(worked)} still recorded.`;
  }
  return `Auto-capped productive ${formatMinutes(productive)} of ${formatMinutes(worked)} worked (max ${MAX_PRODUCTIVE_MINUTES_PER_DAY / 60}h/day, ${MAX_PRODUCTIVE_MINUTES_PER_WEEK / 60}h/week).`;
}

/**
 * Allocate productive minutes across a week's sheets chronologically.
 * Day cap and week cap apply; worked hours are never changed.
 */
export function allocateProductiveHours(sheets: SheetLike[]): Map<string, ProductiveAllocation> {
  const ordered = [...sheets].sort((a, b) => {
    const day = toDateKey(new Date(a.date)).localeCompare(toDateKey(new Date(b.date)));
    if (day !== 0) return day;
    const start = String(a.startTime).localeCompare(String(b.startTime));
    if (start !== 0) return start;
    const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (createdA !== createdB) return createdA - createdB;
    return String(a._id).localeCompare(String(b._id));
  });

  const result = new Map<string, ProductiveAllocation>();
  let weekRemaining = MAX_PRODUCTIVE_MINUTES_PER_WEEK;
  let currentDay = '';
  let dayRemaining = MAX_PRODUCTIVE_MINUTES_PER_DAY;

  for (const sheet of ordered) {
    const dayKey = toDateKey(new Date(sheet.date));
    if (dayKey !== currentDay) {
      currentDay = dayKey;
      dayRemaining = MAX_PRODUCTIVE_MINUTES_PER_DAY;
    }
    const worked = Math.max(0, Number(sheet.totalMinutes) || 0);
    const productive = Math.min(worked, dayRemaining, weekRemaining);
    dayRemaining -= productive;
    weekRemaining -= productive;
    result.set(String(sheet._id), {
      productiveMinutes: productive,
      productiveHoursDisplay: formatMinutes(productive),
      productiveSource: 'RULE',
      productiveNote: noteFor(productive, worked),
    });
  }
  return result;
}

export async function recalculateProductiveHoursForUserWeek(userId: string, date: Date) {
  const weekStart = startOfWeek(date);
  const weekEnd = endOfWeek(date);
  const sheets = await Timesheet.find({
    userId: new mongoose.Types.ObjectId(userId),
    date: { $gte: weekStart, $lte: weekEnd },
    status: { $nin: REJECTED },
  }).select('_id date startTime totalMinutes createdAt');

  const allocations = allocateProductiveHours(sheets);
  const ops = sheets.map((sheet) => {
    const allocation = allocations.get(String(sheet._id)) ?? {
      productiveMinutes: 0,
      productiveHoursDisplay: '0:00',
      productiveSource: 'RULE' as const,
      productiveNote: noteFor(0, sheet.totalMinutes),
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
    {
      userId: new mongoose.Types.ObjectId(userId),
      date: { $gte: weekStart, $lte: weekEnd },
      status: { $in: REJECTED },
    },
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
      await recalculateProductiveHoursForUserWeek(String(userId), start);
      weeks += 1;
    }
  }
  return { users: userIds.length, weeks };
}
