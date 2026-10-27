import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { allocateProductiveHours, MAX_PRODUCTIVE_MINUTES_PER_WEEK } from './productiveHoursService.js';

let seq = 0;
function sheet(date: string, startTime: string, endTime: string, totalMinutes: number) {
  seq += 1;
  return {
    _id: new mongoose.Types.ObjectId(String(seq).padStart(24, '0')),
    date: new Date(`${date}T00:00:00.000Z`),
    startTime,
    endTime,
    totalMinutes,
  };
}

function productiveOf(map: ReturnType<typeof allocateProductiveHours>, s: ReturnType<typeof sheet>) {
  return map.get(String(s._id))!.productiveMinutes;
}

function weekTotal(map: ReturnType<typeof allocateProductiveHours>) {
  return [...map.values()].reduce((sum, row) => sum + row.productiveMinutes, 0);
}

// Mon 5 Oct 2026 – Sun 11 Oct 2026
describe('allocateProductiveHours', () => {
  it('counts a normal 8h shift in full (no daily cap)', () => {
    const s = sheet('2026-10-05', '08:00', '16:30', 8 * 60);
    const map = allocateProductiveHours([s]);
    expect(productiveOf(map, s)).toBe(8 * 60);
    expect(map.get(String(s._id))!.productiveNote).toMatch(/Counts in full/);
  });

  it('leaves a week under 20h unchanged', () => {
    const sheets = ['05', '06', '07'].map((d) => sheet(`2026-10-${d}`, '09:00', '15:00', 6 * 60));
    const map = allocateProductiveHours(sheets);
    expect(weekTotal(map)).toBe(18 * 60);
  });

  it('scales 5 × 8h proportionally to exactly 20h', () => {
    const sheets = ['05', '06', '07', '08', '09'].map((d) => sheet(`2026-10-${d}`, '08:00', '16:30', 8 * 60));
    const map = allocateProductiveHours(sheets);
    for (const s of sheets) expect(productiveOf(map, s)).toBe(4 * 60);
    expect(weekTotal(map)).toBe(MAX_PRODUCTIVE_MINUTES_PER_WEEK);
  });

  it('rounds uneven scaling so the week totals exactly 20h', () => {
    const sheets = [
      sheet('2026-10-05', '08:00', '15:00', 7 * 60),
      sheet('2026-10-06', '08:00', '15:00', 7 * 60),
      sheet('2026-10-07', '08:00', '15:00', 7 * 60),
      sheet('2026-10-08', '08:00', '13:00', 5 * 60 + 7),
    ];
    const map = allocateProductiveHours(sheets);
    expect(weekTotal(map)).toBe(MAX_PRODUCTIVE_MINUTES_PER_WEEK);
    for (const s of sheets) expect(productiveOf(map, s)).toBeGreaterThan(0);
  });

  it('counts only the first 13h of a longer duty, prorating the break', () => {
    // 07:00–22:00 = 15h span, 60m break → 840 worked; 13/15 of it is compliant.
    const s = sheet('2026-10-05', '07:00', '22:00', 14 * 60);
    const map = allocateProductiveHours([s]);
    expect(productiveOf(map, s)).toBe(Math.round((840 * 13) / 15));
    expect(map.get(String(s._id))!.productiveNote).toMatch(/outside working-time rules/);
  });

  it('excludes only the time worked before the 11h rest ends', () => {
    const first = sheet('2026-10-05', '09:00', '22:00', 13 * 60);
    const tooSoon = sheet('2026-10-06', '06:00', '14:00', 8 * 60);
    const map = allocateProductiveHours([first, tooSoon]);
    expect(productiveOf(map, first)).toBe(13 * 60);
    // Rest ends Tue 09:00, so only 09:00–14:00 counts.
    expect(productiveOf(map, tooSoon)).toBe(5 * 60);
    expect(map.get(String(tooSoon._id))!.productiveNote).toMatch(/outside working-time rules/);
  });

  it('counts 14h shifts on Mon and Tue as 13h each, scaled to 20h', () => {
    const mon = sheet('2026-10-05', '08:00', '22:00', 14 * 60);
    const tue = sheet('2026-10-06', '08:00', '22:00', 14 * 60);
    const map = allocateProductiveHours([mon, tue]);
    expect(productiveOf(map, mon)).toBe(10 * 60);
    expect(productiveOf(map, tue)).toBe(10 * 60);
  });

  it('spreads 14h shifts Mon–Sat evenly to exactly 20h', () => {
    const sheets = ['05', '06', '07', '08', '09', '10'].map((d) => sheet(`2026-10-${d}`, '08:00', '22:00', 14 * 60));
    const map = allocateProductiveHours(sheets);
    for (const s of sheets) expect(productiveOf(map, s)).toBe(200);
    expect(weekTotal(map)).toBe(MAX_PRODUCTIVE_MINUTES_PER_WEEK);
  });

  it('gives nothing to a same-evening shift after a full 13h duty', () => {
    const day = sheet('2026-10-05', '08:00', '22:00', 14 * 60);
    const late = sheet('2026-10-05', '23:00', '02:00', 3 * 60);
    const map = allocateProductiveHours([day, late]);
    expect(productiveOf(map, late)).toBe(0);
  });

  it('counts a shift that starts after 11h rest in full', () => {
    const first = sheet('2026-10-05', '09:00', '22:00', 13 * 60);
    const rested = sheet('2026-10-06', '09:00', '17:00', 7 * 60);
    const map = allocateProductiveHours([first, rested]);
    expect(productiveOf(map, rested)).toBe(7 * 60);
  });

  it('treats split shifts in one day as one duty period', () => {
    const morning = sheet('2026-10-05', '08:00', '12:00', 4 * 60);
    const afternoon = sheet('2026-10-05', '13:00', '17:00', 4 * 60);
    const map = allocateProductiveHours([morning, afternoon]);
    expect(productiveOf(map, morning)).toBe(4 * 60);
    expect(productiveOf(map, afternoon)).toBe(4 * 60);
  });

  it('handles overnight shifts', () => {
    const s = sheet('2026-10-05', '20:00', '08:00', 11 * 60);
    const map = allocateProductiveHours([s]);
    expect(productiveOf(map, s)).toBe(11 * 60);
  });

  it('uses previous-week context for the Monday rest check without allocating it', () => {
    const sundayNight = sheet('2026-10-04', '14:00', '23:00', 9 * 60);
    const mondayEarly = sheet('2026-10-05', '06:00', '14:00', 8 * 60);
    const map = allocateProductiveHours([mondayEarly], [sundayNight]);
    expect(map.has(String(sundayNight._id))).toBe(false);
    // Rest ends Mon 10:00, so only 10:00–14:00 counts.
    expect(productiveOf(map, mondayEarly)).toBe(4 * 60);
  });

  it('never changes logged hours on the input sheets', () => {
    const sheets = ['05', '06', '07', '08', '09'].map((d) => sheet(`2026-10-${d}`, '07:00', '22:00', 14 * 60));
    const before = JSON.stringify(sheets);
    allocateProductiveHours(sheets);
    expect(JSON.stringify(sheets)).toBe(before);
  });
});
