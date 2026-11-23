import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import type { Response } from 'express';
import {
  generateGroupedTimesheetPdf,
  generateTimesheetPdf,
  sheetPeriodLabel,
  streamGroupedTimesheetPdf,
  withPdfExportLock,
} from './pdfService.js';
import { TIMESHEET_STATUS } from '../config/constants.js';
import { AppError } from '../utils/errors.js';

function sampleTimesheet(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  } as never;
}

describe('PDF generation', () => {
  it('creates a PDF buffer for a timesheet', async () => {
    const pdf = await generateTimesheetPdf(sampleTimesheet());
    expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(500);
  });

  it('creates a multi-group PDF buffer', async () => {
    const pdf = await generateGroupedTimesheetPdf([
      [sampleTimesheet({ userId: 'u1', timesheetId: 'QC-TS-1' })],
      [sampleTimesheet({ userId: 'u2', timesheetId: 'QC-TS-2', employeeSnapshot: { name: 'Other', employeeId: 'QC-EMP-0002' } })],
    ]);
    expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(800);
  });

  it('streams a PDF to a response-like writable', async () => {
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));

    const res = Object.assign(stream, {
      setHeader() {
        /* no-op */
      },
      headersSent: false,
    }) as unknown as Response;

    await streamGroupedTimesheetPdf(res, [[sampleTimesheet()]], { filename: 'test.pdf' });
    const pdf = Buffer.concat(chunks);
    expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(500);
  });

  it('rejects a second concurrent PDF export with 429', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });

    const first = withPdfExportLock(async () => {
      entered();
      await hold;
      return 'done';
    });

    await started;

    await expect(
      withPdfExportLock(async () => 'nope'),
    ).rejects.toMatchObject({
      statusCode: 429,
      code: 'PDF_EXPORT_BUSY',
    } satisfies Partial<AppError>);

    release();
    await expect(first).resolves.toBe('done');
  });
});

describe('sheetPeriodLabel', () => {
  const dates = [new Date('2026-11-24'), new Date('2026-11-25')];

  it('uses the selected filter range when provided', () => {
    expect(sheetPeriodLabel(dates, { from: '2026-11-23', to: '2026-11-29' })).toBe('23/11/2026 - 29/11/2026');
  });

  it('falls back to entry dates without a range', () => {
    expect(sheetPeriodLabel(dates)).toBe('24/11/2026 - 25/11/2026');
  });

  it('fills an open end from entry dates', () => {
    expect(sheetPeriodLabel(dates, { from: '2026-11-01' })).toBe('01/11/2026 - 25/11/2026');
  });
});
