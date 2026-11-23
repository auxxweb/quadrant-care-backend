import { TIMESHEET_STATUS, type TimesheetStatus } from '../config/constants.js';
import { AppError } from '../utils/errors.js';

const TRANSITIONS: Record<TimesheetStatus, TimesheetStatus[]> = {
  DRAFT: ['SUBMITTED', 'SUPER_ADMIN_REVIEW'],
  SUBMITTED: ['ADMIN_REVIEW', 'ADMIN_VERIFIED', 'ADMIN_REJECTED', 'SUPER_ADMIN_REVIEW', 'DRAFT'],
  ADMIN_REVIEW: ['ADMIN_VERIFIED', 'ADMIN_REJECTED', 'DRAFT'],
  ADMIN_VERIFIED: ['SUPER_ADMIN_REVIEW', 'APPROVED'],
  ADMIN_REJECTED: ['RESUBMITTED', 'SUPER_ADMIN_REVIEW'],
  SUPER_ADMIN_REVIEW: ['APPROVED', 'SUPER_ADMIN_REJECTED', 'DRAFT'],
  APPROVED: [],
  SUPER_ADMIN_REJECTED: ['RESUBMITTED', 'SUPER_ADMIN_REVIEW'],
  RESUBMITTED: ['ADMIN_REVIEW', 'ADMIN_VERIFIED', 'ADMIN_REJECTED', 'SUPER_ADMIN_REVIEW', 'DRAFT'],
};

export function assertTransition(from: TimesheetStatus, to: TimesheetStatus): void {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new AppError(`Timesheet cannot move from ${from} to ${to}.`, 400, 'INVALID_STATUS_TRANSITION');
  }
}

export function canStaffEdit(status: TimesheetStatus): boolean {
  return status !== TIMESHEET_STATUS.APPROVED;
}

export function canOwnerDelete(status: TimesheetStatus): boolean {
  return status !== TIMESHEET_STATUS.APPROVED;
}

export function canOwnerWithdraw(status: TimesheetStatus, ownerRole?: string): boolean {
  if (ownerRole === 'ADMIN') {
    return status === TIMESHEET_STATUS.SUPER_ADMIN_REVIEW;
  }
  return (
    status === TIMESHEET_STATUS.SUBMITTED
    || status === TIMESHEET_STATUS.ADMIN_REVIEW
    || status === TIMESHEET_STATUS.RESUBMITTED
    || status === TIMESHEET_STATUS.SUPER_ADMIN_REVIEW
  );
}

export function canManagerEditHours(status: TimesheetStatus): boolean {
  return status !== TIMESHEET_STATUS.APPROVED;
}

export { TIMESHEET_STATUS };
