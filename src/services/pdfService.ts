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

export async function generateTimesheetPdf(input: TimesheetDocument | TimesheetDocument[]): Promise<Buffer> {
  const items = (Array.isArray(input) ? input : [input]).slice().sort((a, b) => {
    const left = new Date(a.date).getTime();
    const right = new Date(b.date).getTime();
    return left - right;
  });
  const primary = items[0];
  const doc = new PDFDocument({ size: 'A4', margin: 28 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

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

  const week = items.length
    ? `${formatDate(new Date(items[0].date))} - ${formatDate(new Date(items[items.length - 1].date))}`
    : '';
  doc.fillColor('#0f172a').font('Helvetica').fontSize(9).text(`WEEK: ${week}`, left, 98, { width, align: 'right' });

  const dotted = (label: string, value: string, x: number, y: number, w: number) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b').text(label, x, y, { width: 70 });
    doc.font('Helvetica').fillColor('#0f172a').text(value || '—', x + 70, y, { width: w - 70 });
    doc.moveTo(x, y + 12).lineTo(x + w, y + 12).dash(1, { space: 2 }).stroke('#94a3b8').undash();
  };

  const isAdminSheet = primary.ownerRole === 'ADMIN';
  dotted('NAME', primary.employeeSnapshot?.name ?? '', left, 118, 260);
  if (!isAdminSheet) dotted('JOB ROLE', primary.jobRoleSnapshot?.name ?? '', left + 270, 118, 240);
  dotted('CARE HOME', primary.careHomeSnapshot?.name ?? '', left, 138, 260);
  dotted('SUPERVISOR', items.find((item) => item.inchargeName)?.inchargeName ?? '—', left + 270, 138, 240);

  const headers = isAdminSheet
    ? ['SL', 'DATE', 'START', 'END', 'BREAK', 'HOURS', 'CARE HOME', 'INCHARGE', 'REMARKS']
    : ['SL', 'DATE', 'START', 'END', 'BREAK', 'HOURS', 'ROLE', 'CARE HOME', 'INCHARGE', 'REMARKS'];
  const widths = isAdminSheet
    ? [28, 52, 40, 40, 38, 42, 99, 115, 85]
    : [28, 52, 40, 40, 38, 42, 58, 70, 86, 85];
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
      if (index === inchargeIndex && signaturePath) {
        try {
          const resolved = storageService.resolve(signaturePath);
          if (fs.existsSync(resolved)) {
            doc.image(resolved, x + 4, y + 2, { height: 16 });
          } else {
            doc.text(value, x + 2, y + 6, { width: widths[index] - 4 });
          }
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
      item.careHomeSignaturePath ?? item.adminSignaturePath ?? undefined,
    );
  });

  const totalMinutes = items.reduce((sum, item) => sum + (item.totalMinutes || 0), 0);
  drawRow(isAdminSheet
    ? ['', '', '', '', 'TOTALS', formatClockHours(totalMinutes), '', '', '']
    : ['', '', '', '', 'TOTALS', formatClockHours(totalMinutes), '', '', '', '']);

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
  const signaturePath = signed?.careHomeSignaturePath ?? signed?.adminSignaturePath;
  if (signaturePath) {
    try {
      const resolved = storageService.resolve(signaturePath);
      if (fs.existsSync(resolved)) {
        doc.image(resolved, left + 130, y - 6, { height: 28 });
      }
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

  doc.end();
  return finished;
}
