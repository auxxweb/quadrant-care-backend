import type { Request } from 'express';
import { parseDateOnly } from './week.js';

export function applyDateRange(filter: Record<string, unknown>, req: Request, field: string, endOfDay = false) {
  if (!req.query.from && !req.query.to) return filter;
  const range: Record<string, Date> = {};
  if (req.query.from) range.$gte = parseDateOnly(String(req.query.from));
  if (req.query.to) {
    const end = parseDateOnly(String(req.query.to));
    if (endOfDay) end.setUTCHours(23, 59, 59, 999);
    range.$lte = end;
  }
  filter[field] = range;
  return filter;
}
