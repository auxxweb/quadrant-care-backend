import { describe, expect, it } from 'vitest';
import { TIMESHEET_STATUS } from '../config/constants.js';
import { buildTimesheetCsv } from './timesheetExportService.js';

describe('timesheet CSV labels', () => {
  it('writes human timesheet statuses instead of enum codes', () => {
    const csv = buildTimesheetCsv([
      {
        timesheetId: 'QC-TS-0001',
        employeeSnapshot: { name: 'Jane Smith', employeeId: 'QC-EMP-0004' },
        careHomeSnapshot: { name: 'Sunrise Care' },
        jobRoleSnapshot: { name: 'HCA' },
        date: new Date('2026-10-22T00:00:00.000Z'),
        startTime: '08:00',
        endTime: '20:00',
        breakDuration: 60,
        totalHoursDisplay: '11:00',
        status: TIMESHEET_STATUS.ADMIN_REVIEW,
      } as never,
    ], false);

    expect(csv).toContain('Pending review');
    expect(csv).not.toContain('ADMIN_REVIEW');
  });
});
