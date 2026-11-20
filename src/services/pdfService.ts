import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { storageService } from './storageService.js';
import type { TimesheetDocument } from '../models/Timesheet.js';
import { AppError } from '../utils/errors.js';

const LOGO_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/logo.png');
const MAX_PNG_DECODE_MB = 32;
const SIGNATURE_ROW_HEIGHT = 16;
const SIGNATURE_FOOTER_HEIGHT = 28;

type PdfOptions = { productiveOnly?: boolean };

let pdfExportBusy = false;

export function isPdfExportBusy() {
  return pdfExportBusy;
}

export async function withPdfExportLock<T>(fn: () => Promise<T>): Promise<T> {
  if (pdfExportBusy) {
    throw new AppError(
      'A PDF export is already in progress. Please wait a moment and try again.',
      429,
      'PDF_EXPORT_BUSY',
    );
  }
  pdfExportBusy = true;
  try {
    return await fn();
  } finally {
    pdfExportBusy = false;
  }
}

function yieldEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function formatDate(value: Date) {
  return value.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

function formatClockHours(totalMinutes: number) {
  const hours = Math.floor(Math.max(0, totalMinutes) / 60);
  const minutes = Math.max(0, totalMinutes) % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

function sortItems(items: TimesheetDocument[]) {
  return items.slice().sort((a, b) => {
    const left = new Date(a.date).getTime();
    const right = new Date(b.date).getTime();
    if (left !== right) return left - right;
    return String(a.startTime).localeCompare(String(b.startTime));
  });
}

function createPdfDocument() {
  return new PDFDocument({
    size: 'A4',
    margin: 28,
    // Throttle PNG decode spikes that can OOM the process on large exports.
    maxPNGParallelDecodeMegaBytes: MAX_PNG_DECODE_MB,
  } as PDFKit.PDFDocumentOptions);
}

class SignatureImageCache {
  private readonly buffers = new Map<string, Buffer>();
  private readonly opened = new Map<string, unknown>();

  constructor(private readonly doc: PDFKit.PDFDocument) {}

  private async loadDownscaled(resolvedPath: string, targetHeight: number): Promise<Buffer | null> {
    const cacheKey = `${resolvedPath}::${targetHeight}`;
    const cached = this.buffers.get(cacheKey);
    if (cached) return cached;
    try {
      if (!fs.existsSync(resolvedPath)) return null;
      const buffer = await sharp(resolvedPath)
        .resize({ height: targetHeight * 2, withoutEnlargement: true })
        .png({ compressionLevel: 8, palette: true })
        .toBuffer();
      this.buffers.set(cacheKey, buffer);
      return buffer;
    } catch {
      return null;
    }
  }

  async draw(relativePath: string | undefined, x: number, y: number, height: number): Promise<boolean> {
    if (!relativePath) return false;
    try {
      const resolved = storageService.resolve(relativePath);
      const buffer = await this.loadDownscaled(resolved, height);
      if (!buffer) return false;
      const openKey = `${resolved}::${height}`;
      let image = this.opened.get(openKey);
      if (!image) {
        // openImage is available at runtime; typings omit it on some pdfkit versions.
        const opener = this.doc as PDFKit.PDFDocument & { openImage: (src: Buffer) => unknown };
        image = opener.openImage(buffer);
        this.opened.set(openKey, image);
      }
      this.doc.image(image as never, x, y, { height });
      return true;
    } catch {
      return false;
    }
  }
}

async function drawTimesheetPage(
  doc: PDFKit.PDFDocument,
  inputItems: TimesheetDocument[],
  options: PdfOptions,
  signatures: SignatureImageCache,
) {
  const productiveOnly = Boolean(options.productiveOnly);
  const items = sortItems(inputItems);
  if (!items.length) return;

  const primary = items[0];
  const pageWidth = 595.28;
  const left = 28;
  const right = pageWidth - 28;
  const width = right - left;

  try {
    if (fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, left, 28, { width: 88 });
    }
  } catch {
    /* logo is optional */
  }

  doc.font('Helvetica').fontSize(8).fillColor('#475569').text('Company No: 12019912', left, 40, { width, align: 'center' });
  doc.fontSize(8).text('Contact: +44 1582 943111\ninfo@quadrantcare.co.uk\nwww.quadrantcare.co.uk', right - 150, 28, {
    width: 150,
    align: 'right',
  });

  doc.rect(left + 180, 72, 180, 18).fill('#334155');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text('TIME SHEET', left + 180, 76, { width: 180, align: 'center' });

  const week = `${formatDate(new Date(items[0].date))} - ${formatDate(new Date(items[items.length - 1].date))}`;
  doc.fillColor('#0f172a').font('Helvetica').fontSize(9).text(`WEEK: ${week}`, left, 98, { width, align: 'right' });

  const dotted = (label: string, value: string, x: number, yPos: number, w: number) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b').text(label, x, yPos, { width: 70 });
    doc.font('Helvetica').fillColor('#0f172a').text(value || '—', x + 70, yPos, { width: w - 70 });
    doc.moveTo(x, yPos + 12).lineTo(x + w, yPos + 12).dash(1, { space: 2 }).stroke('#94a3b8').undash();
  };

  const isAdminSheet = primary.ownerRole === 'ADMIN';
  dotted('NAME', primary.employeeSnapshot?.name ?? '', left, 118, 260);
  if (!isAdminSheet) dotted('JOB ROLE', primary.jobRoleSnapshot?.name ?? '', left + 270, 118, 240);
  dotted('CARE HOME', primary.careHomeSnapshot?.name ?? '', left, 138, 260);
  if (!productiveOnly) {
    dotted('SUPERVISOR', items.find((item) => item.inchargeName)?.inchargeName ?? '—', left + 270, 138, 240);
  }

  const headers = productiveOnly
    ? (isAdminSheet
      ? ['SL', 'DATE', 'HOURS', 'CARE HOME', 'REMARKS']
      : ['SL', 'DATE', 'HOURS', 'ROLE', 'CARE HOME', 'REMARKS'])
    : (isAdminSheet
      ? ['SL', 'DATE', 'START', 'END', 'BREAK', 'HOURS', 'CARE HOME', 'INCHARGE', 'REMARKS']
      : ['SL', 'DATE', 'START', 'END', 'BREAK', 'HOURS', 'ROLE', 'CARE HOME', 'INCHARGE', 'REMARKS']);
  const widths = productiveOnly
    ? (isAdminSheet ? [40, 80, 80, 180, 140] : [36, 70, 70, 90, 140, 114])
    : (isAdminSheet
      ? [28, 52, 40, 40, 38, 48, 99, 115, 79]
      : [28, 52, 40, 40, 38, 42, 58, 70, 86, 85]);
  const inchargeIndex = headers.indexOf('INCHARGE');
  let y = 164;
  doc.rect(left, y, width, 20).fill('#e2e8f0');
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(7);
  let x = left;
  headers.forEach((header, index) => {
    doc.text(header, x + 2, y + 6, { width: widths[index] - 4 });
    x += widths[index];
  });

  const drawRow = async (values: string[], signaturePath?: string) => {
    y += 20;
    if (y > 740) {
      doc.addPage();
      y = 40;
    }
    doc.rect(left, y, width, 20).stroke('#94a3b8');
    x = left;
    doc.font('Helvetica').fontSize(8).fillColor('#0f172a');
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (index === inchargeIndex && signaturePath) {
        const drawn = await signatures.draw(signaturePath, x + 4, y + 2, SIGNATURE_ROW_HEIGHT);
        if (!drawn) {
          doc.text(value, x + 2, y + 6, { width: widths[index] - 4 });
        }
      } else {
        doc.text(value, x + 2, y + 6, { width: widths[index] - 4 });
      }
      x += widths[index];
    }
  };

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (productiveOnly) {
      await drawRow([
        String(index + 1),
        formatDate(new Date(item.date)),
        item.productiveHoursDisplay ?? formatClockHours(item.productiveMinutes || 0),
        ...(isAdminSheet ? [] : [item.jobRoleSnapshot?.name ?? '']),
        item.careHomeSnapshot?.name ?? '',
        item.remarks || '',
      ]);
      continue;
    }
    await drawRow(
      [
        String(index + 1),
        formatDate(new Date(item.date)),
        item.startTime,
        item.endTime,
        String(item.breakDuration ?? ''),
        item.totalHoursDisplay,
        ...(isAdminSheet ? [] : [item.jobRoleSnapshot?.name ?? '']),
        item.careHomeSnapshot?.name ?? '',
        item.inchargeName || '',
        item.remarks || '',
      ],
      item.careHomeSignaturePath ?? item.adminSignaturePath ?? undefined,
    );
  }

  const totalMinutes = items.reduce((sum, item) => sum + (item.totalMinutes || 0), 0);
  const totalProductive = items.reduce((sum, item) => sum + (item.productiveMinutes || 0), 0);
  if (productiveOnly) {
    await drawRow(isAdminSheet
      ? ['', 'TOTALS', formatClockHours(totalProductive), '', '']
      : ['', 'TOTALS', formatClockHours(totalProductive), '', '', '']);
  } else {
    await drawRow(isAdminSheet
      ? ['', '', '', '', 'TOTALS', formatClockHours(totalMinutes), '', '', '']
      : ['', '', '', '', 'TOTALS', formatClockHours(totalMinutes), '', '', '', '']);
  }

  y += 28;
  doc.font('Helvetica').fontSize(8).fillColor('#334155').text(
    'I certify that these hours are a true and accurate record of all times worked during the pay period.',
    left,
    y,
    { width },
  );
  y += 22;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a').text('EMPLOYEE SIGNATURE: ____________________________', left, y);
  y += 18;
  doc.text('SUPERVISOR SIGNATURE:', left, y);
  const signed = items.find((item) => item.careHomeSignaturePath || item.adminSignaturePath);
  const signaturePath = signed?.careHomeSignaturePath ?? signed?.adminSignaturePath ?? undefined;
  const footerDrawn = await signatures.draw(signaturePath || undefined, left + 130, y - 6, SIGNATURE_FOOTER_HEIGHT);
  if (!footerDrawn) {
    doc.font('Helvetica').text('____________________________', left + 130, y);
  }

  y += 36;
  const notes = [...new Set(items.map((item) => item.inchargeName).filter(Boolean))].join(' | ') || '—';
  doc.font('Helvetica-Bold').text('NOTES:', left, y);
  doc.font('Helvetica').text(notes, left + 42, y, { width: width - 42 });
}

async function writeGroupedTimesheetPdf(
  doc: PDFKit.PDFDocument,
  groups: TimesheetDocument[][],
  options: PdfOptions,
) {
  const sheets = groups.map(sortItems).filter((group) => group.length > 0);
  const signatures = new SignatureImageCache(doc);

  if (!sheets.length) {
    doc.font('Helvetica').fontSize(12).text('No timesheet entries to export.', 50, 50);
    doc.end();
    return;
  }

  for (let index = 0; index < sheets.length; index += 1) {
    if (index > 0) {
      doc.addPage();
      await yieldEventLoop();
    }
    await drawTimesheetPage(doc, sheets[index], options, signatures);
  }

  doc.end();
}

export async function generateTimesheetPdf(
  input: TimesheetDocument | TimesheetDocument[],
  options: PdfOptions = {},
): Promise<Buffer> {
  const items = Array.isArray(input) ? input : [input];
  return generateGroupedTimesheetPdf([items], options);
}

/** Buffered helper for single-sheet downloads and tests. */
export async function generateGroupedTimesheetPdf(
  groups: TimesheetDocument[][],
  options: PdfOptions = {},
): Promise<Buffer> {
  const doc = createPdfDocument();
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));

  const finished = new Promise<Buffer>((resolve, reject) => {
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    doc.on('error', reject);
  });

  doc.pipe(stream);
  await writeGroupedTimesheetPdf(doc, groups, options);
  return finished;
}

/** Stream a multi-sheet PDF directly to an HTTP response (preferred for bulk export). */
export async function streamGroupedTimesheetPdf(
  res: Response,
  groups: TimesheetDocument[][],
  options: PdfOptions & { filename?: string } = {},
): Promise<void> {
  const filename = options.filename ?? 'quadrant-care-timesheets.pdf';
  const doc = createPdfDocument();

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');

  const done = new Promise<void>((resolve, reject) => {
    const settle = () => resolve();
    res.once('finish', settle);
    res.once('close', settle);
    res.once('error', reject);
    doc.once('error', reject);
  });

  doc.pipe(res);
  await writeGroupedTimesheetPdf(doc, groups, options);
  await done;
}
