import { ADMIN_ID_PREFIX, EMPLOYEE_ID_PREFIX, TIMESHEET_ID_PREFIX } from '../config/constants.js';
import { nextSequence } from '../models/Counter.js';

export async function nextEmployeeId(): Promise<string> {
  const seq = await nextSequence('employee');
  return `${EMPLOYEE_ID_PREFIX}${String(seq).padStart(4, '0')}`;
}

export async function nextAdminId(): Promise<string> {
  const seq = await nextSequence('admin');
  return `${ADMIN_ID_PREFIX}${String(seq).padStart(4, '0')}`;
}

export async function nextTimesheetId(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const seq = await nextSequence(`timesheet-${year}`);
  return `${TIMESHEET_ID_PREFIX}${year}-${String(seq).padStart(6, '0')}`;
}
