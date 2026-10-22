export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  STAFF: 'STAFF',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const USER_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;

export const TIMESHEET_STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  ADMIN_REVIEW: 'ADMIN_REVIEW',
  ADMIN_VERIFIED: 'ADMIN_VERIFIED',
  ADMIN_REJECTED: 'ADMIN_REJECTED',
  SUPER_ADMIN_REVIEW: 'SUPER_ADMIN_REVIEW',
  APPROVED: 'APPROVED',
  SUPER_ADMIN_REJECTED: 'SUPER_ADMIN_REJECTED',
  RESUBMITTED: 'RESUBMITTED',
} as const;

export type TimesheetStatus = (typeof TIMESHEET_STATUS)[keyof typeof TIMESHEET_STATUS];

export const TIMESHEET_STATUS_LABELS: Record<TimesheetStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  ADMIN_REVIEW: 'Pending review',
  ADMIN_VERIFIED: 'Admin verified',
  ADMIN_REJECTED: 'Rejected',
  SUPER_ADMIN_REVIEW: 'Awaiting approval',
  APPROVED: 'Approved',
  SUPER_ADMIN_REJECTED: 'Rejected',
  RESUBMITTED: 'Resubmitted',
};

export function timesheetStatusLabel(status?: string) {
  if (!status) return '';
  return TIMESHEET_STATUS_LABELS[status as TimesheetStatus] ?? status.replaceAll('_', ' ');
}

export const AUDIT_ACTIONS = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  CREATE_EMPLOYEE: 'CREATE_EMPLOYEE',
  UPDATE_EMPLOYEE: 'UPDATE_EMPLOYEE',
  CREATE_ADMIN: 'CREATE_ADMIN',
  UPDATE_ADMIN: 'UPDATE_ADMIN',
  CREATE_CARE_HOME: 'CREATE_CARE_HOME',
  UPDATE_CARE_HOME: 'UPDATE_CARE_HOME',
  CREATE_JOB_ROLE: 'CREATE_JOB_ROLE',
  UPDATE_JOB_ROLE: 'UPDATE_JOB_ROLE',
  SUBMIT_TIMESHEET: 'SUBMIT_TIMESHEET',
  UPDATE_TIMESHEET: 'UPDATE_TIMESHEET',
  ADMIN_REVIEW: 'ADMIN_REVIEW',
  ADMIN_SIGN: 'ADMIN_SIGN',
  ADMIN_REJECT: 'ADMIN_REJECT',
  SUPER_ADMIN_APPROVE: 'SUPER_ADMIN_APPROVE',
  SUPER_ADMIN_REJECT: 'SUPER_ADMIN_REJECT',
  PASSWORD_RESET: 'PASSWORD_RESET',
  SETTINGS_UPDATED: 'SETTINGS_UPDATED',
  STATUS_CHANGE: 'STATUS_CHANGE',
} as const;

export const DEFAULT_SETTINGS = {
  companyName: 'Quadrant Care Services Ltd',
  appName: 'Quadrant Care',
  timezone: 'Europe/London',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '24h',
  weekStartsOn: 1,
  emailLoginEnabled: true,
  mobileLoginEnabled: true,
  passcodeLoginEnabled: true,
  passcodeLength: 5,
  requirePasscodeAfterFirstLogin: false,
  defaultBreakDuration: 60,
  allowOvernightShifts: true,
  requireRemarks: false,
  requireInchargeName: true,
  requireAdminSignature: true,
  requireSuperAdminSignature: false,
  sessionDurationMinutes: 15,
  maxLoginAttempts: 5,
  lockoutDurationMinutes: 15,
  passwordMinLength: 10,
  passwordRequireUppercase: true,
  passwordRequireNumber: true,
  passwordRequireSpecial: true,
  staffSignupEnabled: true,
};

export const EMPLOYEE_ID_PREFIX = 'QC-EMP-';
export const ADMIN_ID_PREFIX = 'QC-ADM-';
export const TIMESHEET_ID_PREFIX = 'QC-TS-';
