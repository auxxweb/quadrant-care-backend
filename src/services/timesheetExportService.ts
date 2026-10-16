import type { TimesheetDocument } from '../models/Timesheet.js';
import { generateGroupedTimesheetPdf } from './pdfService.js';

function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function groupTimesheetsForPdf(items: TimesheetDocument[]) {
  const groups = new Map<string, TimesheetDocument[]>();
  for (const item of items) {
    const key = String(item.userId || item.employeeId || item.employeeSnapshot?.employeeId || item._id);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return [...groups.values()];
}

export function buildTimesheetCsv(items: TimesheetDocument[], productiveOnly: boolean) {
  const header = productiveOnly
    ? 'Timesheet ID,Employee,Employee ID,Care Home,Job Role,Date,Hours,Status'
    : 'Timesheet ID,Employee,Employee ID,Care Home,Job Role,Date,Start,End,Break,Hours,Status';
  const rows = items.map((item) =>
    (productiveOnly
      ? [
          item.timesheetId,
          item.employeeSnapshot?.name ?? '',
          item.employeeSnapshot?.employeeId ?? '',
          item.careHomeSnapshot?.name ?? '',
          item.jobRoleSnapshot?.name ?? '',
          new Date(item.date).toISOString().slice(0, 10),
          item.productiveHoursDisplay ?? '0:00',
          item.status,
        ]
      : [
          item.timesheetId,
          item.employeeSnapshot?.name ?? '',
          item.employeeSnapshot?.employeeId ?? '',
          item.careHomeSnapshot?.name ?? '',
          item.jobRoleSnapshot?.name ?? '',
          new Date(item.date).toISOString().slice(0, 10),
          item.startTime,
          item.endTime,
          item.breakDuration,
          item.totalHoursDisplay,
          item.status,
        ]
    )
      .map(escapeCsv)
      .join(','),
  );
  return `${header}\n${rows.join('\n')}\n`;
}

export async function buildTimesheetPdfExport(
  items: TimesheetDocument[],
  options: { productiveOnly?: boolean } = {},
) {
  return generateGroupedTimesheetPdf(groupTimesheetsForPdf(items), options);
}
