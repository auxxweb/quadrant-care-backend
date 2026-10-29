export function calculateShiftDuration(
  startTime: string,
  endTime: string,
  breakMinutes: number,
  allowOvernight = true,
): { totalMinutes: number; formattedHours: string } {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error('Start time and end time are required.');
  }
  if (!Number.isFinite(breakMinutes) || breakMinutes < 0) {
    throw new Error('Break duration cannot be negative.');
  }

  let duration = end - start;
  if (duration <= 0) {
    if (!allowOvernight) {
      throw new Error('End time must be after start time.');
    }
    duration += 24 * 60;
  }
  if (duration >= 24 * 60) {
    throw new Error('A shift must be less than 24 hours in a day.');
  }

  const totalMinutes = duration - breakMinutes;
  if (totalMinutes < 0) {
    throw new Error('Break duration cannot be greater than the shift length.');
  }

  return {
    totalMinutes,
    formattedHours: formatMinutes(totalMinutes),
  };
}

/** Absolute [start, end) span of a shift in epoch ms; end <= start is treated as overnight. */
export function shiftInterval(date: Date, startTime: string, endTime: string): { start: number; end: number } {
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const startMinutes = parseTimeToMinutes(startTime);
  let endMinutes = parseTimeToMinutes(endTime);
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  return { start: dayStart + startMinutes * 60_000, end: dayStart + endMinutes * 60_000 };
}

export function intervalsOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

export function parseTimeToMinutes(value: string): number {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

export function formatHoursLabel(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}
