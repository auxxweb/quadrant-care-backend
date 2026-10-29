import { describe, expect, it } from 'vitest';
import { calculateShiftDuration, formatMinutes, intervalsOverlap, shiftInterval } from './time.js';
import { assertTransition, canStaffEdit } from '../services/timesheetStatus.js';
import { TIMESHEET_STATUS } from '../config/constants.js';

describe('time calculation', () => {
  it('calculates a standard day shift minus break', () => {
    const result = calculateShiftDuration('08:00', '20:00', 60);
    expect(result.totalMinutes).toBe(660);
    expect(result.formattedHours).toBe('11:00');
    expect(formatMinutes(660)).toBe('11:00');
  });

  it('handles overnight shifts as a positive duration', () => {
    const result = calculateShiftDuration('20:00', '08:00', 0);
    expect(result.totalMinutes).toBe(12 * 60);
  });

  it('rejects a break longer than the shift', () => {
    expect(() => calculateShiftDuration('08:00', '09:00', 90)).toThrow();
  });

  it('rejects a 24-hour shift', () => {
    expect(() => calculateShiftDuration('08:00', '08:00', 0)).toThrow(/less than 24 hours/);
  });
});

describe('timesheet status transitions', () => {
  it('allows the official approval chain', () => {
    assertTransition(TIMESHEET_STATUS.DRAFT, TIMESHEET_STATUS.SUBMITTED);
    assertTransition(TIMESHEET_STATUS.SUBMITTED, TIMESHEET_STATUS.ADMIN_REVIEW);
    assertTransition(TIMESHEET_STATUS.ADMIN_REVIEW, TIMESHEET_STATUS.ADMIN_VERIFIED);
    assertTransition(TIMESHEET_STATUS.ADMIN_VERIFIED, TIMESHEET_STATUS.SUPER_ADMIN_REVIEW);
    assertTransition(TIMESHEET_STATUS.ADMIN_VERIFIED, TIMESHEET_STATUS.APPROVED);
    assertTransition(TIMESHEET_STATUS.SUPER_ADMIN_REVIEW, TIMESHEET_STATUS.APPROVED);
  });

  it('blocks admin from giving final approval', () => {
    expect(() => assertTransition(TIMESHEET_STATUS.ADMIN_REVIEW, TIMESHEET_STATUS.APPROVED)).toThrow();
  });

  it('allows rejected timesheets to be corrected', () => {
    assertTransition(TIMESHEET_STATUS.ADMIN_REJECTED, TIMESHEET_STATUS.RESUBMITTED);
    assertTransition(TIMESHEET_STATUS.SUPER_ADMIN_REJECTED, TIMESHEET_STATUS.RESUBMITTED);
    expect(canStaffEdit(TIMESHEET_STATUS.ADMIN_REJECTED)).toBe(true);
    expect(canStaffEdit(TIMESHEET_STATUS.APPROVED)).toBe(false);
  });
});

describe('shift overlap', () => {
  const day = new Date('2026-10-29T00:00:00.000Z');
  const nextDay = new Date('2026-10-30T00:00:00.000Z');
  const overlaps = (a: [Date, string, string], b: [Date, string, string]) =>
    intervalsOverlap(shiftInterval(...a), shiftInterval(...b));

  it('flags an exact duplicate', () => {
    expect(overlaps([day, '08:00', '20:00'], [day, '08:00', '20:00'])).toBe(true);
  });

  it('flags a partial overlap', () => {
    expect(overlaps([day, '08:00', '16:00'], [day, '12:00', '20:00'])).toBe(true);
  });

  it('allows shifts that only touch', () => {
    expect(overlaps([day, '08:00', '12:00'], [day, '12:00', '16:00'])).toBe(false);
  });

  it('flags an overnight shift against the next morning', () => {
    expect(overlaps([day, '20:00', '08:00'], [nextDay, '07:00', '09:00'])).toBe(true);
    expect(overlaps([day, '20:00', '08:00'], [nextDay, '08:00', '12:00'])).toBe(false);
  });

  it('flags an overnight shift against the same evening', () => {
    expect(overlaps([day, '22:00', '06:00'], [day, '20:00', '23:00'])).toBe(true);
  });
});
