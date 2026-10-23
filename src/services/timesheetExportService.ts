import type { Request, Response } from 'express';
import { timesheetStatusLabel } from '../config/constants.js';
import type { TimesheetDocument } from '../models/Timesheet.js';
import { AppError } from '../utils/errors.js';
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
          timesheetStatusLabel(item.status),
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
          timesheetStatusLabel(item.status),
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

export async function sendTimesheetExport(
  req: Request,
  res: Response,
  items: TimesheetDocument[],
) {
  const format = String(req.query.format ?? '').toLowerCase();
  const productiveOnly = req.user?.metricsFocus === 'PRODUCTIVE';
  if (format === 'csv') {
    const body = buildTimesheetCsv(items, productiveOnly);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="quadrant-care-timesheets.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
    return;
  }
  if (format === 'pdf') {
    if (!items.length) throw new AppError('No timesheets match the current filters.');
    const pdf = await buildTimesheetPdfExport(items, { productiveOnly });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="quadrant-care-timesheets.pdf"');
    res.setHeader('Content-Length', String(pdf.length));
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
    return;
  }
  res.json({
    items,
    totalMinutes: items.reduce((sum, item) => sum + item.totalMinutes, 0),
    totalProductiveMinutes: items.reduce((sum, item) => sum + (item.productiveMinutes ?? 0), 0),
  });
}
