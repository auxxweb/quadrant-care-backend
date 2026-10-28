import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { storageService } from './storageService.js';
import type { TimesheetDocument } from '../models/Timesheet.js';

const LOGO_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/logo.png');

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

type SignatureImages = Map<string, Buffer>;

function signatureKey(item: TimesheetDocument) {
  return item.careHomeSignaturePath ?? item.adminSignaturePath ?? undefined;
}

/** PDF drawing is synchronous, so fetch every signature image up front. */
async function loadSignatures(groups: TimesheetDocument[][]): Promise<SignatureImages> {
  const keys = [...new Set(groups.flat().map(signatureKey).filter((key): key is string => Boolean(key)))];
  const images: SignatureImages = new Map();
  await Promise.all(
    keys.map(async (key) => {
      try {
        const buffer = await storageService.read(key);
        if (buffer) images.set(key, buffer);
      } catch {
        // A missing or unreadable signature falls back to text in the PDF.
      }
    }),
  );
  return images;
}

function drawTimesheetPage(
  doc: PDFKit.PDFDocument,
  inputItems: TimesheetDocument[],
  options: { productiveOnly?: boolean },
  signatures: SignatureImages,
) {
  const productiveOnly = Boolean(options.productiveOnly);
  const items = sortItems(inputItems);
  if (!items.length) return;

  const primary = items[0];
  const pageWidth = 595.28;
  const left = 28;
  const right = pageWidth - 28;
  const width = right - left;

  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, left, 28, { width: 88 });
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

  const drawRow = (values: string[], signaturePath?: string) => {
    y += 20;
    if (y > 740) {
      doc.addPage();
      y = 40;
    }
    doc.rect(left, y, width, 20).stroke('#94a3b8');
    x = left;
    doc.font('Helvetica').fontSize(8).fillColor('#0f172a');
    values.forEach((value, index) => {
      const image = index === inchargeIndex && signaturePath ? signatures.get(signaturePath) : undefined;
      if (image) {
        try {
          doc.image(image, x + 4, y + 2, { height: 16 });
        } catch {
          doc.text(value, x + 2, y + 6, { width: widths[index] - 4 });
        }
      } else {
        doc.text(value, x + 2, y + 6, { width: widths[index] - 4 });
      }
      x += widths[index];
    });
  };

  items.forEach((item, index) => {
    if (productiveOnly) {
      drawRow([
        String(index + 1),
        formatDate(new Date(item.date)),
        item.productiveHoursDisplay ?? formatClockHours(item.productiveMinutes || 0),
        ...(isAdminSheet ? [] : [item.jobRoleSnapshot?.name ?? '']),
        item.careHomeSnapshot?.name ?? '',
        item.remarks || '',
      ]);
      return;
    }
    drawRow(
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
      signatureKey(item),
    );
  });

  const totalMinutes = items.reduce((sum, item) => sum + (item.totalMinutes || 0), 0);
  const totalProductive = items.reduce((sum, item) => sum + (item.productiveMinutes || 0), 0);
  if (productiveOnly) {
    drawRow(isAdminSheet
      ? ['', 'TOTALS', formatClockHours(totalProductive), '', '']
      : ['', 'TOTALS', formatClockHours(totalProductive), '', '', '']);
  } else {
    drawRow(isAdminSheet
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
  const signatureImage = signed ? signatures.get(signatureKey(signed)!) : undefined;
  if (signatureImage) {
    try {
      doc.image(signatureImage, left + 130, y - 6, { height: 28 });
    } catch {
      doc.font('Helvetica').text('____________________________', left + 130, y);
    }
  } else {
    doc.font('Helvetica').text('____________________________', left + 130, y);
  }

  y += 36;
  const notes = [...new Set(items.map((item) => item.inchargeName).filter(Boolean))].join(' | ') || '—';
  doc.font('Helvetica-Bold').text('NOTES:', left, y);
  doc.font('Helvetica').text(notes, left + 42, y, { width: width - 42 });
}

export async function generateTimesheetPdf(
  input: TimesheetDocument | TimesheetDocument[],
  options: { productiveOnly?: boolean } = {},
): Promise<Buffer> {
  const items = Array.isArray(input) ? input : [input];
  return generateGroupedTimesheetPdf([items], options);
}

export async function generateGroupedTimesheetPdf(
  groups: TimesheetDocument[][],
  options: { productiveOnly?: boolean } = {},
): Promise<Buffer> {
  const sheets = groups.map(sortItems).filter((group) => group.length > 0);
  const signatures = await loadSignatures(sheets);
  const doc = new PDFDocument({ size: 'A4', margin: 28 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  if (!sheets.length) {
    doc.font('Helvetica').fontSize(12).text('No timesheet entries to export.', 50, 50);
    doc.end();
    return finished;
  }

  sheets.forEach((group, index) => {
    if (index > 0) doc.addPage();
    drawTimesheetPage(doc, group, options, signatures);
  });

  doc.end();
  return finished;
}
