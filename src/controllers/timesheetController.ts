import type { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Timesheet } from '../models/Timesheet.js';
import { Employee } from '../models/Employee.js';
import { CareHome } from '../models/CareHome.js';
import { JobRole } from '../models/JobRole.js';
import { User } from '../models/User.js';
import { AppError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { calculateShiftDuration } from '../utils/time.js';
import { parseDateOnly } from '../utils/week.js';
import { applyDateRange } from '../utils/query.js';
import { nextTimesheetId } from '../services/idService.js';
import { getSettings } from '../services/authService.js';
import { assertTransition, canManagerEditHours, canStaffEdit, TIMESHEET_STATUS } from '../services/timesheetStatus.js';
import { auditFromRequest } from '../services/auditService.js';
import { notifyAdmins, notifySuperAdmins, notifyUser } from '../services/notificationService.js';
import { sendEmail } from '../services/emailService.js';
import { storageService } from '../services/storageService.js';
import { generateTimesheetPdf } from '../services/pdfService.js';
import { recalculateProductiveHoursForUserWeek } from '../services/productiveHoursService.js';
import { sendTimesheetExport } from './reportsController.js';
import type { TimesheetStatus } from '../config/constants.js';

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function superAdminInchargeName() {
  const superAdmin = await User.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' }).sort({ createdAt: 1 });
  return superAdmin?.name || 'Super Admin';
}

async function staffEmployee(userId: string) {
  const employee = await Employee.findOne({ userId });
  if (!employee) throw new ForbiddenError('Employee profile not found.');
  return employee;
}

async function loadTimesheetForUser(req: Request) {
  const timesheet = await Timesheet.findById(req.params.id)
    .populate('adminReviewedBy', 'name adminId')
    .populate('superAdminApprovedBy', 'name');
  if (!timesheet) throw new NotFoundError('Timesheet not found.');
  if (req.user?.role === 'STAFF') {
    const employee = await staffEmployee(req.user.id);
    if (String(timesheet.employeeId) !== String(employee._id)) {
      throw new ForbiddenError('You can only access your own timesheets.');
    }
  }
  return timesheet;
}

const REJECTED_STATUSES = [TIMESHEET_STATUS.ADMIN_REJECTED, TIMESHEET_STATUS.SUPER_ADMIN_REJECTED];
const MAX_DAY_MINUTES = 24 * 60;

function shiftDuration(startTime: string, endTime: string, breakDuration: number, allowOvernight: boolean) {
  try {
    return calculateShiftDuration(startTime, endTime, breakDuration, allowOvernight);
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : 'Invalid shift times.');
  }
}

async function assertDayUnder24Hours(userId: string, date: Date, extraMinutes: number, excludeId?: string) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const filter: Record<string, unknown> = {
    userId: new mongoose.Types.ObjectId(userId),
    date: { $gte: start, $lt: end },
    status: { $nin: REJECTED_STATUSES },
  };
  if (excludeId) filter._id = { $ne: new mongoose.Types.ObjectId(excludeId) };
  const [existing] = await Timesheet.aggregate<{ minutes: number }>([
    { $match: filter },
    { $group: { _id: null, minutes: { $sum: '$totalMinutes' } } },
  ]);
  if ((existing?.minutes ?? 0) + extraMinutes >= MAX_DAY_MINUTES) {
    throw new AppError('Total hours for this day must be less than 24 hours.');
  }
}

function ownerRoleClause(ownerRole?: string) {
  if (ownerRole === 'ADMIN') return { ownerRole: 'ADMIN' };
  if (ownerRole === 'STAFF') return { $or: [{ ownerRole: 'STAFF' }, { ownerRole: { $exists: false } }] };
  return null;
}

function buildFilter(req: Request) {
  const filter: Record<string, unknown> = {};
  if (req.query.status) {
    const statuses = String(req.query.status).split(',').map((value) => value.trim()).filter(Boolean);
    filter.status = statuses.length > 1 ? { $in: statuses } : statuses[0];
  }
  if (req.query.careHomeId) filter.careHomeId = req.query.careHomeId;
  if (req.query.jobRoleId) filter.jobRoleId = req.query.jobRoleId;
  if (req.query.employeeId) filter.employeeId = req.query.employeeId;
  if (req.query.userId) filter.userId = req.query.userId;
  applyDateRange(filter, req, 'date');
  const clauses: Record<string, unknown>[] = [];
  const ownerClause = ownerRoleClause(req.query.ownerRole ? String(req.query.ownerRole) : undefined);
  if (ownerClause) clauses.push(ownerClause);
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(String(req.query.search)), 'i');
    clauses.push({ $or: [{ timesheetId: rx }, { 'employeeSnapshot.name': rx }, { 'employeeSnapshot.employeeId': rx }] });
  }
  if (clauses.length === 1) Object.assign(filter, clauses[0]);
  if (clauses.length > 1) filter.$and = clauses;
  return filter;
}

async function scopedListFilter(req: Request) {
  const filter = buildFilter(req);
  if (req.user?.role === 'STAFF') {
    const employee = await staffEmployee(req.user.id);
    filter.employeeId = employee._id;
  }
  if (req.user?.role === 'ADMIN' && String(req.query.ownerRole ?? '') === 'ADMIN') {
    filter.userId = req.user.id;
    filter.ownerRole = 'ADMIN';
  }
  return filter;
}

export async function listTimesheets(req: Request, res: Response, next: NextFunction) {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const filter = await scopedListFilter(req);
    const [items, total] = await Promise.all([
      Timesheet.find(filter)
        .populate('adminReviewedBy', 'name adminId')
        .populate('superAdminApprovedBy', 'name')
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Timesheet.countDocuments(filter),
    ]);
    res.json({ items, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    next(error);
  }
}

export async function exportTimesheets(req: Request, res: Response, next: NextFunction) {
  try {
    const filter = await scopedListFilter(req);
    const items = await Timesheet.find(filter).sort({ date: -1, createdAt: -1 }).limit(2000);
    await sendTimesheetExport(req, res, items);
  } catch (error) {
    next(error);
  }
}

export async function createTimesheet(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user || !['STAFF', 'ADMIN'].includes(req.user.role)) throw new ForbiddenError();
    const settings = await getSettings();
    const startTime = req.body.startTime;
    const endTime = req.body.endTime;
    const breakDuration = Number(req.body.breakDuration ?? settings.defaultBreakDuration);
    const calc = shiftDuration(startTime, endTime, breakDuration, settings.allowOvernightShifts);
    if (req.user.role === 'STAFF' && settings.requireInchargeName && !req.body.inchargeName) throw new AppError('Incharge name is required.');
    if (settings.requireRemarks && !req.body.remarks) throw new AppError('Remarks are required.');

    const careHome = req.body.careHomeId ? await CareHome.findById(req.body.careHomeId) : null;
    if (!careHome) throw new AppError('Select a care home.');

    let ownerRole: 'STAFF' | 'ADMIN' = 'STAFF';
    let userId = req.user.id;
    let employeeId: unknown;
    let employeeSnapshot: { name: string; employeeId: string; email?: string; mobile?: string };
    let jobRole: { _id: unknown; name?: string } | null = null;
    let inchargeName = req.body.inchargeName as string | undefined;

    if (req.user.role === 'STAFF') {
      jobRole = req.body.jobRoleId ? await JobRole.findById(req.body.jobRoleId) : null;
      const employee = await Employee.findOne({ userId: req.user.id }).populate('jobRoleId').populate('careHomeId');
      if (!employee) throw new ForbiddenError('Employee profile not found.');
      if (!jobRole && employee.jobRoleId && typeof employee.jobRoleId === 'object' && '_id' in employee.jobRoleId) {
        jobRole = employee.jobRoleId as { _id: unknown; name?: string };
      }
      employeeId = employee._id;
      userId = String(employee.userId);
      employeeSnapshot = {
        name: employee.fullName,
        employeeId: employee.employeeId,
        email: employee.email ?? undefined,
        mobile: employee.mobile ?? undefined,
      };
      if (!jobRole) throw new AppError('Select a job role.');
    } else {
      const admin = await User.findById(req.user.id);
      if (!admin) throw new ForbiddenError();
      ownerRole = 'ADMIN';
      employeeSnapshot = {
        name: admin.name,
        employeeId: admin.adminId || 'ADMIN',
        email: admin.email ?? undefined,
        mobile: admin.mobile ?? undefined,
      };
      inchargeName = await superAdminInchargeName();
    }

    const date = parseDateOnly(req.body.date);
    await assertDayUnder24Hours(userId, date, calc.totalMinutes);
    let careHomeSignaturePath: string | undefined;
    if (req.user.role === 'STAFF' && req.body.careHomeSignature?.startsWith('data:image')) {
      careHomeSignaturePath = await storageService.saveBase64Image(req.body.careHomeSignature, 'signatures');
    }
    const timesheet = await Timesheet.create({
      timesheetId: await nextTimesheetId(),
      ...(employeeId ? { employeeId } : {}),
      userId,
      ownerRole,
      employeeSnapshot,
      careHomeId: careHome._id,
      careHomeSnapshot: { name: careHome.name },
      ...(jobRole ? { jobRoleId: jobRole._id, jobRoleSnapshot: { name: jobRole.name || 'Admin' } } : { jobRoleSnapshot: { name: 'Admin' } }),
      date,
      startTime,
      endTime,
      breakDuration,
      totalMinutes: calc.totalMinutes,
      totalHoursDisplay: calc.formattedHours,
      inchargeName,
      ...(careHomeSignaturePath ? { careHomeSignaturePath } : {}),
      remarks: req.body.remarks,
      status: TIMESHEET_STATUS.DRAFT,
      history: [{ status: TIMESHEET_STATUS.DRAFT, actorId: req.user.id, actorName: req.user.name, note: 'Created', at: new Date() }],
    });

    if (req.body.submit) {
      await submitExisting(timesheet, req);
    }
    await recalculateProductiveHoursForUserWeek(userId, date);
    const refreshed = await Timesheet.findById(timesheet._id);
    res.status(201).json(refreshed ?? timesheet);
  } catch (error) {
    next(error);
  }
}

export async function getTimesheet(req: Request, res: Response, next: NextFunction) {
  try {
    const timesheet = await loadTimesheetForUser(req);
    res.json(timesheet);
  } catch (error) {
    next(error);
  }
}

export async function updateTimesheet(req: Request, res: Response, next: NextFunction) {
  try {
    const timesheet = await loadTimesheetForUser(req);
    if (!req.user || !['STAFF', 'ADMIN'].includes(req.user.role)) throw new ForbiddenError();
    if (String(timesheet.userId) !== req.user.id) throw new ForbiddenError('You can only edit your own timesheets.');
    if (!canStaffEdit(timesheet.status as TimesheetStatus)) {
      throw new AppError('This timesheet can no longer be edited.');
    }
    const settings = await getSettings();
    const startTime = req.body.startTime ?? timesheet.startTime;
    const endTime = req.body.endTime ?? timesheet.endTime;
    const breakDuration = Number(req.body.breakDuration ?? timesheet.breakDuration);
    const calc = shiftDuration(startTime, endTime, breakDuration, settings.allowOvernightShifts);
    const nextDate = req.body.date ? parseDateOnly(req.body.date) : timesheet.date;
    await assertDayUnder24Hours(String(timesheet.userId), nextDate, calc.totalMinutes, String(timesheet._id));
    timesheet.startTime = startTime;
    timesheet.endTime = endTime;
    timesheet.breakDuration = breakDuration;
    timesheet.totalMinutes = calc.totalMinutes;
    timesheet.totalHoursDisplay = calc.formattedHours;
    if (req.body.date) timesheet.date = parseDateOnly(req.body.date);
    if (timesheet.ownerRole === 'ADMIN') {
      timesheet.inchargeName = await superAdminInchargeName();
    } else if (req.body.inchargeName !== undefined) {
      timesheet.inchargeName = req.body.inchargeName;
    }
    if (req.body.remarks !== undefined) timesheet.remarks = req.body.remarks;
    if (req.user.role === 'STAFF' && req.body.careHomeSignature?.startsWith('data:image')) {
      timesheet.careHomeSignaturePath = await storageService.saveBase64Image(req.body.careHomeSignature, 'signatures');
    }
    await timesheet.save();
    await recalculateProductiveHoursForUserWeek(String(timesheet.userId), timesheet.date);
    await auditFromRequest(req.user, 'UPDATE_TIMESHEET', 'Timesheet', String(timesheet._id), `Updated ${timesheet.timesheetId}`, req);
    res.json(await Timesheet.findById(timesheet._id));
  } catch (error) {
    next(error);
  }
}

export async function managerEditTimesheet(req: Request, res: Response, next: NextFunction) {
  try {
    const timesheet = await loadTimesheetForUser(req);
    if (!req.user || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) throw new ForbiddenError();
    if (timesheet.ownerRole === 'ADMIN') {
      throw new ForbiddenError('Admin timesheets cannot be edited this way.');
    }
    if (req.user.role === 'ADMIN' && String(timesheet.userId) === req.user.id) {
      throw new ForbiddenError('Use your own timesheet edit to change personal entries.');
    }
    if (!canManagerEditHours(timesheet.status as TimesheetStatus)) {
      throw new AppError('This timesheet cannot be edited.');
    }
    const settings = await getSettings();
    const startTime = req.body.startTime ?? timesheet.startTime;
    const endTime = req.body.endTime ?? timesheet.endTime;
    const breakDuration = Number(req.body.breakDuration ?? timesheet.breakDuration);
    const calc = shiftDuration(startTime, endTime, breakDuration, settings.allowOvernightShifts);
    await assertDayUnder24Hours(String(timesheet.userId), timesheet.date, calc.totalMinutes, String(timesheet._id));
    timesheet.startTime = startTime;
    timesheet.endTime = endTime;
    timesheet.breakDuration = breakDuration;
    timesheet.totalMinutes = calc.totalMinutes;
    timesheet.totalHoursDisplay = calc.formattedHours;
    timesheet.history.push({
      status: timesheet.status,
      actorId: req.user.id,
      actorName: req.user.name,
      note: `Hours updated to ${startTime}–${endTime}, break ${breakDuration}m`,
      at: new Date(),
    });
    await timesheet.save();
    await recalculateProductiveHoursForUserWeek(String(timesheet.userId), timesheet.date);
    await auditFromRequest(req.user, 'UPDATE_TIMESHEET', 'Timesheet', String(timesheet._id), `Adjusted hours on ${timesheet.timesheetId}`, req);
    res.json(await Timesheet.findById(timesheet._id));
  } catch (error) {
    next(error);
  }
}

async function submitExisting(timesheet: InstanceType<typeof Timesheet>, req: Request) {
  const from = timesheet.status as TimesheetStatus;
  const isAdminSheet = timesheet.ownerRole === 'ADMIN';
  if (isAdminSheet) {
    assertTransition(from, TIMESHEET_STATUS.SUPER_ADMIN_REVIEW);
    timesheet.status = TIMESHEET_STATUS.SUPER_ADMIN_REVIEW;
  } else {
    const nextStatus =
      from === TIMESHEET_STATUS.ADMIN_REJECTED || from === TIMESHEET_STATUS.SUPER_ADMIN_REJECTED
        ? TIMESHEET_STATUS.RESUBMITTED
        : TIMESHEET_STATUS.SUBMITTED;
    assertTransition(from === TIMESHEET_STATUS.RESUBMITTED ? TIMESHEET_STATUS.RESUBMITTED : from, nextStatus);
    timesheet.status = nextStatus === TIMESHEET_STATUS.RESUBMITTED ? TIMESHEET_STATUS.ADMIN_REVIEW : TIMESHEET_STATUS.SUBMITTED;
    if (nextStatus === TIMESHEET_STATUS.RESUBMITTED) {
      assertTransition(TIMESHEET_STATUS.RESUBMITTED, TIMESHEET_STATUS.ADMIN_REVIEW);
    }
  }
  timesheet.submittedAt = new Date();
  timesheet.rejectionReason = undefined;
  timesheet.history.push({
    status: timesheet.status,
    actorId: req.user!.id,
    actorName: req.user!.name,
    note: isAdminSheet ? 'Submitted for Super Admin review' : from === TIMESHEET_STATUS.ADMIN_REJECTED || from === TIMESHEET_STATUS.SUPER_ADMIN_REJECTED ? 'Resubmitted' : 'Submitted',
    at: new Date(),
  });
  await timesheet.save();
  await auditFromRequest(req.user, 'SUBMIT_TIMESHEET', 'Timesheet', String(timesheet._id), `Submitted ${timesheet.timesheetId}`, req);
  if (isAdminSheet) {
    await notifySuperAdmins(
      'Admin timesheet submitted',
      `${timesheet.employeeSnapshot?.name} submitted ${timesheet.timesheetId}. Waiting for Super Admin approval.`,
      String(timesheet._id),
    );
  } else {
    await notifyAdmins('New timesheet submitted', `${timesheet.employeeSnapshot?.name} submitted ${timesheet.timesheetId}`, String(timesheet._id));
    await notifySuperAdmins(
      'Admin request',
      `${timesheet.employeeSnapshot?.name} submitted ${timesheet.timesheetId}. Waiting for admin approval.`,
      String(timesheet._id),
    );
  }
  await notifyUser(String(timesheet.userId), 'Timesheet submitted', `Your timesheet ${timesheet.timesheetId} has been submitted.`, 'SUBMITTED', String(timesheet._id));
}

export async function submitTimesheet(req: Request, res: Response, next: NextFunction) {
  try {
    const timesheet = await loadTimesheetForUser(req);
    if (!req.user || !['STAFF', 'ADMIN'].includes(req.user.role)) throw new ForbiddenError();
    if (String(timesheet.userId) !== req.user.id) throw new ForbiddenError('You can only submit your own timesheets.');
    await submitExisting(timesheet, req);
    res.json(timesheet);
  } catch (error) {
    next(error);
  }
}

export async function adminVerify(req: Request, res: Response, next: NextFunction) {
  try {
    const timesheet = await loadTimesheetForUser(req);
    if (timesheet.ownerRole === 'ADMIN' || String(timesheet.userId) === req.user!.id) {
      throw new ForbiddenError('Admin timesheets are approved by a Super Admin.');
    }
    const settings = await getSettings();
    const current = timesheet.status as TimesheetStatus;
    if (current === TIMESHEET_STATUS.SUBMITTED) {
      assertTransition(current, TIMESHEET_STATUS.ADMIN_REVIEW);
      timesheet.status = TIMESHEET_STATUS.ADMIN_REVIEW;
    }
    assertTransition(timesheet.status as TimesheetStatus, TIMESHEET_STATUS.ADMIN_VERIFIED);
    const reviewer = await User.findById(req.user!.id);
    if (req.body.signature) {
      timesheet.adminSignaturePath = await storageService.saveBase64Image(req.body.signature, 'signatures');
    } else if (reviewer?.signaturePath) {
      timesheet.adminSignaturePath = await storageService.copyFile(reviewer.signaturePath, 'signatures');
    }
    if (settings.requireAdminSignature && !timesheet.adminSignaturePath) {
      throw new AppError('Save a signature in Settings, or draw one to verify.');
    }
    timesheet.adminRemarks = req.body.remarks;
    timesheet.adminReviewedBy = req.user!.id as unknown as typeof timesheet.adminReviewedBy;
    timesheet.adminReviewedAt = new Date();
    timesheet.status = TIMESHEET_STATUS.ADMIN_VERIFIED;
    timesheet.history.push({ status: TIMESHEET_STATUS.ADMIN_VERIFIED, actorId: req.user!.id, actorName: req.user!.name, note: 'Admin verified', at: new Date() });
    assertTransition(TIMESHEET_STATUS.ADMIN_VERIFIED, TIMESHEET_STATUS.APPROVED);
    timesheet.status = TIMESHEET_STATUS.APPROVED;
    timesheet.history.push({
      status: TIMESHEET_STATUS.APPROVED,
      actorId: req.user!.id,
      actorName: req.user!.name,
      note: 'Approved by admin',
      at: new Date(),
    });
    await timesheet.save();
    await auditFromRequest(req.user, 'ADMIN_APPROVE', 'Timesheet', String(timesheet._id), `Approved ${timesheet.timesheetId}`, req);
    await notifyUser(String(timesheet.userId), 'Timesheet approved', `Your timesheet ${timesheet.timesheetId} has been approved.`, 'APPROVED', String(timesheet._id));
    await notifySuperAdmins(
      'Admin approved a timesheet',
      `${req.user!.name} approved ${timesheet.timesheetId} for ${timesheet.employeeSnapshot?.name}.`,
      String(timesheet._id),
    );
    if (timesheet.employeeSnapshot?.email) {
      await sendEmail({
        to: timesheet.employeeSnapshot.email,
        template: 'timesheet-approved',
        data: { name: timesheet.employeeSnapshot.name, date: String(timesheet.date) },
      });
    }
    res.json(timesheet);
  } catch (error) {
    next(error);
  }
}

export async function adminReject(req: Request, res: Response, next: NextFunction) {
  try {
    const timesheet = await loadTimesheetForUser(req);
    if (timesheet.ownerRole === 'ADMIN' || String(timesheet.userId) === req.user!.id) {
      throw new ForbiddenError('Admin timesheets are reviewed by a Super Admin.');
    }
    const current = timesheet.status as TimesheetStatus;
    if (current === TIMESHEET_STATUS.SUBMITTED) timesheet.status = TIMESHEET_STATUS.ADMIN_REVIEW;
    assertTransition(timesheet.status as TimesheetStatus, TIMESHEET_STATUS.ADMIN_REJECTED);
    timesheet.status = TIMESHEET_STATUS.ADMIN_REJECTED;
    timesheet.rejectionReason = req.body.reason;
    timesheet.adminReviewedBy = req.user!.id as unknown as typeof timesheet.adminReviewedBy;
    timesheet.adminReviewedAt = new Date();
    timesheet.history.push({ status: TIMESHEET_STATUS.ADMIN_REJECTED, actorId: req.user!.id, actorName: req.user!.name, note: req.body.reason, at: new Date() });
    await timesheet.save();
    await recalculateProductiveHoursForUserWeek(String(timesheet.userId), timesheet.date);
    await auditFromRequest(req.user, 'ADMIN_REJECT', 'Timesheet', String(timesheet._id), `Rejected ${timesheet.timesheetId}`, req);
    await notifyUser(String(timesheet.userId), 'Timesheet rejected', `Your timesheet needs correction: ${req.body.reason}`, 'REJECTED', String(timesheet._id));
    if (timesheet.employeeSnapshot?.email) {
      await sendEmail({
        to: timesheet.employeeSnapshot.email,
        template: 'timesheet-rejected',
        data: { name: timesheet.employeeSnapshot.name, date: String(timesheet.date), reason: req.body.reason },
      });
    }
    res.json(timesheet);
  } catch (error) {
    next(error);
  }
}

export async function superAdminApprove(req: Request, res: Response, next: NextFunction) {
  try {
    const timesheet = await loadTimesheetForUser(req);
    assertTransition(timesheet.status as TimesheetStatus, TIMESHEET_STATUS.APPROVED);
    const settings = await getSettings();
    if (settings.requireSuperAdminSignature && req.body.signature) {
      timesheet.superAdminSignaturePath = await storageService.saveBase64Image(req.body.signature, 'signatures');
    }
    timesheet.status = TIMESHEET_STATUS.APPROVED;
    timesheet.superAdminApprovedBy = req.user!.id as unknown as typeof timesheet.superAdminApprovedBy;
    timesheet.superAdminApprovedAt = new Date();
    timesheet.superAdminRemarks = req.body.remarks;
    timesheet.history.push({ status: TIMESHEET_STATUS.APPROVED, actorId: req.user!.id, actorName: req.user!.name, note: 'Final approval', at: new Date() });
    await timesheet.save();
    await auditFromRequest(req.user, 'SUPER_ADMIN_APPROVE', 'Timesheet', String(timesheet._id), `Approved ${timesheet.timesheetId}`, req);
    await notifyUser(String(timesheet.userId), 'Timesheet approved', `Your timesheet ${timesheet.timesheetId} has been approved.`, 'APPROVED', String(timesheet._id));
    if (timesheet.employeeSnapshot?.email) {
      await sendEmail({
        to: timesheet.employeeSnapshot.email,
        template: 'timesheet-approved',
        data: { name: timesheet.employeeSnapshot.name, date: String(timesheet.date) },
      });
    }
    res.json(timesheet);
  } catch (error) {
    next(error);
  }
}

export async function superAdminReject(req: Request, res: Response, next: NextFunction) {
  try {
    const timesheet = await loadTimesheetForUser(req);
    assertTransition(timesheet.status as TimesheetStatus, TIMESHEET_STATUS.SUPER_ADMIN_REJECTED);
    timesheet.status = TIMESHEET_STATUS.SUPER_ADMIN_REJECTED;
    timesheet.rejectionReason = req.body.reason;
    timesheet.superAdminRemarks = req.body.reason;
    timesheet.history.push({
      status: TIMESHEET_STATUS.SUPER_ADMIN_REJECTED,
      actorId: req.user!.id,
      actorName: req.user!.name,
      note: req.body.reason,
      at: new Date(),
    });
    await timesheet.save();
    await recalculateProductiveHoursForUserWeek(String(timesheet.userId), timesheet.date);
    await auditFromRequest(req.user, 'SUPER_ADMIN_REJECT', 'Timesheet', String(timesheet._id), `Rejected ${timesheet.timesheetId}`, req);
    await notifyUser(String(timesheet.userId), 'Correction required', `Your timesheet needs correction: ${req.body.reason}`, 'REJECTED', String(timesheet._id));
    res.json(timesheet);
  } catch (error) {
    next(error);
  }
}

export async function downloadPdf(req: Request, res: Response, next: NextFunction) {
  try {
    const timesheet = await loadTimesheetForUser(req);
    const pdf = await generateTimesheetPdf(timesheet, {
      productiveOnly: req.user?.metricsFocus === 'PRODUCTIVE',
    });
    const safeName = String(timesheet.timesheetId || 'timesheet').replace(/[^\w.-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.send(pdf);
  } catch (error) {
    next(error);
  }
}

export async function weeklySummary(req: Request, res: Response, next: NextFunction) {
  try {
    const employee = req.user?.role === 'STAFF' ? await staffEmployee(req.user.id) : null;
    const weekStart = req.query.week ? parseDateOnly(String(req.query.week)) : startMonday(new Date());
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const filter: Record<string, unknown> = { date: { $gte: weekStart, $lte: weekEnd } };
    if (employee) filter.employeeId = employee._id;
    if (req.query.employeeId && req.user?.role !== 'STAFF') filter.employeeId = req.query.employeeId;
    const items = await Timesheet.find(filter).sort({ date: 1 });
    const days = Array.from({ length: 7 }).map((_, index) => {
      const date = new Date(weekStart);
      date.setUTCDate(date.getUTCDate() + index);
      const key = date.toISOString().slice(0, 10);
      const dayItems = items.filter((item) => new Date(item.date).toISOString().slice(0, 10) === key);
      const minutes = dayItems.reduce((sum, item) => sum + item.totalMinutes, 0);
      return { date: key, minutes, items: dayItems };
    });
    res.json({ weekStart, weekEnd, days, totalMinutes: days.reduce((sum, day) => sum + day.minutes, 0) });
  } catch (error) {
    next(error);
  }
}

export async function monthlySummary(req: Request, res: Response, next: NextFunction) {
  try {
    const employee = req.user?.role === 'STAFF' ? await staffEmployee(req.user.id) : null;
    const base = req.query.month ? parseDateOnly(`${req.query.month}-01`) : new Date();
    const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
    const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const filter: Record<string, unknown> = { date: { $gte: start, $lte: end } };
    if (employee) filter.employeeId = employee._id;
    const items = await Timesheet.find(filter);
    res.json({
      start,
      end,
      totalShifts: items.length,
      totalMinutes: items.reduce((sum, item) => sum + item.totalMinutes, 0),
      approvedMinutes: items.filter((item) => item.status === 'APPROVED').reduce((sum, item) => sum + item.totalMinutes, 0),
      pendingMinutes: items
        .filter((item) => !['APPROVED', 'ADMIN_REJECTED', 'SUPER_ADMIN_REJECTED'].includes(item.status))
        .reduce((sum, item) => sum + item.totalMinutes, 0),
      rejected: items.filter((item) => ['ADMIN_REJECTED', 'SUPER_ADMIN_REJECTED'].includes(item.status)).length,
      items,
    });
  } catch (error) {
    next(error);
  }
}

function startMonday(date: Date) {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = result.getUTCDay() || 7;
  result.setUTCDate(result.getUTCDate() - day + 1);
  return result;
}

export { User };
