import type { Request, Response, NextFunction } from 'express';
import { Timesheet } from '../models/Timesheet.js';
import { Employee } from '../models/Employee.js';
import { CareHome } from '../models/CareHome.js';
import { JobRole } from '../models/JobRole.js';
import { parseDateOnly } from '../utils/week.js';

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dateFilter(req: Request) {
  const filter: Record<string, unknown> = {};
  if (req.query.from || req.query.to) {
    filter.date = {
      ...(req.query.from ? { $gte: parseDateOnly(String(req.query.from)) } : {}),
      ...(req.query.to ? { $lte: parseDateOnly(String(req.query.to)) } : {}),
    };
  }
  if (req.query.status) filter.status = req.query.status;
  if (req.query.employeeId) filter.employeeId = req.query.employeeId;
  if (req.query.userId) filter.userId = req.query.userId;
  if (req.query.careHomeId) filter.careHomeId = req.query.careHomeId;
  if (req.query.jobRoleId) filter.jobRoleId = req.query.jobRoleId;
  if (req.query.ownerRole === 'ADMIN') filter.ownerRole = 'ADMIN';
  if (req.query.ownerRole === 'STAFF') {
    filter.$and = [...(Array.isArray(filter.$and) ? filter.$and : []), { $or: [{ ownerRole: 'STAFF' }, { ownerRole: { $exists: false } }] }];
  }
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(String(req.query.search)), 'i');
    filter.$or = [
      { timesheetId: rx },
      { 'employeeSnapshot.name': rx },
      { 'employeeSnapshot.employeeId': rx },
      { 'careHomeSnapshot.name': rx },
      { 'jobRoleSnapshot.name': rx },
    ];
  }
  return filter;
}

export async function timesheetReport(req: Request, res: Response, next: NextFunction) {
  try {
    const items = await Timesheet.find(dateFilter(req)).sort({ date: -1 }).limit(2000);
    if (req.query.format === 'csv') {
      const header = 'Timesheet ID,Employee,Employee ID,Care Home,Job Role,Date,Start,End,Break,Hours,Status\n';
      const rows = items
        .map((item) =>
          [
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
          ].join(','),
        )
        .join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="quadrant-care-timesheets.csv"');
      res.send(header + rows);
      return;
    }
    res.json({ items, totalMinutes: items.reduce((sum, item) => sum + item.totalMinutes, 0) });
  } catch (error) {
    next(error);
  }
}

export async function hoursReport(req: Request, res: Response, next: NextFunction) {
  try {
    const items = await Timesheet.aggregate([
      { $match: dateFilter(req) },
      {
        $group: {
          _id: '$employeeSnapshot.employeeId',
          name: { $first: '$employeeSnapshot.name' },
          minutes: { $sum: '$totalMinutes' },
          shifts: { $sum: 1 },
        },
      },
      { $sort: { minutes: -1 } },
    ]);
    res.json({ items });
  } catch (error) {
    next(error);
  }
}

export async function careHomeReport(req: Request, res: Response, next: NextFunction) {
  try {
    const items = await Timesheet.aggregate([
      { $match: dateFilter(req) },
      {
        $group: {
          _id: '$careHomeSnapshot.name',
          minutes: { $sum: '$totalMinutes' },
          shifts: { $sum: 1 },
        },
      },
      { $sort: { minutes: -1 } },
    ]);
    res.json({ items });
  } catch (error) {
    next(error);
  }
}

export async function employeeReport(req: Request, res: Response, next: NextFunction) {
  try {
    const items = await Timesheet.aggregate([
      { $match: dateFilter(req) },
      {
        $group: {
          _id: { employeeId: '$employeeSnapshot.employeeId', status: '$status' },
          name: { $first: '$employeeSnapshot.name' },
          minutes: { $sum: '$totalMinutes' },
          count: { $sum: 1 },
        },
      },
    ]);
    res.json({ items });
  } catch (error) {
    next(error);
  }
}

export async function globalSearch(req: Request, res: Response, next: NextFunction) {
  try {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) {
      res.json({ employees: [], careHomes: [], jobRoles: [], timesheets: [] });
      return;
    }
    const rx = new RegExp(escapeRegex(q), 'i');
    const staffScope = req.user?.role === 'STAFF';
    const [employees, careHomes, jobRoles, timesheets] = await Promise.all([
      staffScope ? [] : Employee.find({ $or: [{ fullName: rx }, { employeeId: rx }, { email: rx }] }).limit(8),
      CareHome.find({ name: rx }).limit(8),
      JobRole.find({ name: rx }).limit(8),
      Timesheet.find({
        $or: [{ timesheetId: rx }, { 'employeeSnapshot.name': rx }, { 'employeeSnapshot.employeeId': rx }],
        ...(staffScope ? { userId: req.user!.id } : {}),
      }).limit(8),
    ]);
    res.json({ employees, careHomes, jobRoles, timesheets });
  } catch (error) {
    next(error);
  }
}
