import { describe, expect, it } from 'vitest';
import { generateTimesheetPdf } from './pdfService.js';
import { TIMESHEET_STATUS } from '../config/constants.js';

describe('PDF generation', () => {
  it('creates a PDF buffer for a timesheet', async () => {
    const pdf = await generateTimesheetPdf({
      timesheetId: 'QC-TS-2026-000001',
      employeeSnapshot: { name: 'Boney Jose', employeeId: 'QC-EMP-0001' },
      jobRoleSnapshot: { name: 'HCA' },
      careHomeSnapshot: { name: 'Chadwick' },
      date: new Date('2026-04-07'),
      startTime: '08:00',
      endTime: '20:00',
      breakDuration: 60,
      totalMinutes: 660,
      totalHoursDisplay: '11:00',
      inchargeName: 'Ward Manager',
      remarks: 'Long day',
      status: TIMESHEET_STATUS.APPROVED,
    } as never);
    expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(500);
  });
});
