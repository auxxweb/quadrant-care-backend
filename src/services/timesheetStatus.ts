import { TIMESHEET_STATUS, type TimesheetStatus } from '../config/constants.js';
import { AppError } from '../utils/errors.js';

const TRANSITIONS: Record<TimesheetStatus, TimesheetStatus[]> = {
  DRAFT: ['SUBMITTED', 'SUPER_ADMIN_REVIEW'],
  SUBMITTED: ['ADMIN_REVIEW', 'ADMIN_VERIFIED', 'ADMIN_REJECTED', 'SUPER_ADMIN_REVIEW'],
  ADMIN_REVIEW: ['ADMIN_VERIFIED', 'ADMIN_REJECTED'],
  ADMIN_VERIFIED: ['SUPER_ADMIN_REVIEW', 'APPROVED'],
  ADMIN_REJECTED: ['RESUBMITTED', 'SUPER_ADMIN_REVIEW'],
  SUPER_ADMIN_REVIEW: ['APPROVED', 'SUPER_ADMIN_REJECTED'],
  APPROVED: [],
  SUPER_ADMIN_REJECTED: ['RESUBMITTED', 'SUPER_ADMIN_REVIEW'],
  RESUBMITTED: ['ADMIN_REVIEW', 'ADMIN_VERIFIED', 'ADMIN_REJECTED', 'SUPER_ADMIN_REVIEW'],
};

export function assertTransition(from: TimesheetStatus, to: TimesheetStatus): void {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new AppError(`Timesheet cannot move from ${from} to ${to}.`, 400, 'INVALID_STATUS_TRANSITION');
  }
}

export function canStaffEdit(status: TimesheetStatus): boolean {
  return status === TIMESHEET_STATUS.DRAFT || status === TIMESHEET_STATUS.ADMIN_REJECTED || status === TIMESHEET_STATUS.SUPER_ADMIN_REJECTED;
}

export function canManagerEditHours(_status: TimesheetStatus): boolean {
  return true;
}

export { TIMESHEET_STATUS };
