import type { Request, Response, NextFunction } from 'express';
import { Employee } from '../models/Employee.js';
import { User } from '../models/User.js';
import { CareHome } from '../models/CareHome.js';
import { JobRole } from '../models/JobRole.js';
import { Timesheet } from '../models/Timesheet.js';
import { ROLES, TIMESHEET_STATUS } from '../config/constants.js';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, toDateKey } from '../utils/week.js';
import { ForbiddenError } from '../utils/errors.js';

function todayRange() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

export async function staffDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user?.role !== 'STAFF') throw new ForbiddenError();
    const employee = await Employee.findOne({ userId: req.user.id }).populate('jobRoleId').populate('careHomeId');
    if (!employee) throw new ForbiddenError('Employee profile not found.');
    const weekStart = startOfWeek(new Date());
    const weekEnd = endOfWeek(new Date());
    const monthStart = startOfMonth(new Date());
    const monthEnd = endOfMonth(new Date());
    const [weekSheets, pending, approved, monthSheets] = await Promise.all([
      Timesheet.find({ employeeId: employee._id, date: { $gte: weekStart, $lte: weekEnd } }),
      Timesheet.countDocuments({
        employeeId: employee._id,
        status: { $in: [TIMESHEET_STATUS.SUBMITTED, TIMESHEET_STATUS.ADMIN_REVIEW, TIMESHEET_STATUS.SUPER_ADMIN_REVIEW, TIMESHEET_STATUS.RESUBMITTED] },
      }),
      Timesheet.countDocuments({ employeeId: employee._id, status: TIMESHEET_STATUS.APPROVED }),
      Timesheet.find({ employeeId: employee._id, date: { $gte: monthStart, $lte: monthEnd } }),
    ]);
    const weekMinutes = weekSheets.reduce((sum, item) => sum + item.totalMinutes, 0);
    const weekProductiveMinutes = weekSheets.reduce((sum, item) => sum + (item.productiveMinutes ?? 0), 0);
    const weekly = Array.from({ length: 7 }).map((_, index) => {
      const date = addDays(weekStart, index);
      const key = toDateKey(date);
      const dayItems = weekSheets.filter((item) => toDateKey(new Date(item.date)) === key);
      return {
        date: key,
        shifts: dayItems.length,
        hours: Number((dayItems.reduce((sum, item) => sum + item.totalMinutes, 0) / 60).toFixed(1)),
      };
    });
    const rejected = monthSheets.filter((item) =>
      [TIMESHEET_STATUS.ADMIN_REJECTED, TIMESHEET_STATUS.SUPER_ADMIN_REJECTED].includes(item.status as typeof TIMESHEET_STATUS.ADMIN_REJECTED),
    ).length;
    const draft = monthSheets.filter((item) => item.status === TIMESHEET_STATUS.DRAFT).length;
    const monthPending = monthSheets.filter((item) =>
      [TIMESHEET_STATUS.SUBMITTED, TIMESHEET_STATUS.ADMIN_REVIEW, TIMESHEET_STATUS.SUPER_ADMIN_REVIEW, TIMESHEET_STATUS.RESUBMITTED].includes(
        item.status as typeof TIMESHEET_STATUS.SUBMITTED,
      ),
    ).length;
    const monthApproved = monthSheets.filter((item) => item.status === TIMESHEET_STATUS.APPROVED).length;
    res.json({
      employee,
      weekMinutes,
      weekProductiveMinutes,
      pending,
      approved,
      monthMinutes: monthSheets.reduce((sum, item) => sum + item.totalMinutes, 0),
      monthProductiveMinutes: monthSheets.reduce((sum, item) => sum + (item.productiveMinutes ?? 0), 0),
      today: weekSheets.find((item) => toDateKey(new Date(item.date)) === toDateKey(new Date())) ?? null,
      weekly,
      statusMix: {
        approved: monthApproved,
        pending: monthPending,
        rejected,
        draft,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function adminDashboard(_req: Request, res: Response, next: NextFunction) {
  try {
    const { start, end } = todayRange();
    const weekStart = startOfWeek(new Date());
    const [employees, submittedToday, pendingReview, verified, rejected, recent, weekItems] = await Promise.all([
      Employee.countDocuments({ status: 'ACTIVE' }),
      Timesheet.countDocuments({ submittedAt: { $gte: start, $lte: end } }),
      Timesheet.countDocuments({ status: { $in: [TIMESHEET_STATUS.SUBMITTED, TIMESHEET_STATUS.ADMIN_REVIEW, TIMESHEET_STATUS.RESUBMITTED] } }),
      Timesheet.countDocuments({ status: TIMESHEET_STATUS.APPROVED }),
      Timesheet.countDocuments({ status: { $in: [TIMESHEET_STATUS.ADMIN_REJECTED, TIMESHEET_STATUS.SUPER_ADMIN_REJECTED] } }),
      Timesheet.find({ status: { $in: [TIMESHEET_STATUS.SUBMITTED, TIMESHEET_STATUS.ADMIN_REVIEW, TIMESHEET_STATUS.RESUBMITTED] } })
        .sort({ submittedAt: -1 })
        .limit(8),
      Timesheet.find({ date: { $gte: weekStart } }),
    ]);
    const weekly = Array.from({ length: 7 }).map((_, index) => {
      const date = addDays(weekStart, index);
      const key = toDateKey(date);
      const dayItems = weekItems.filter((item) => toDateKey(new Date(item.date)) === key);
      return {
        date: key,
        submitted: dayItems.length,
        hours: Number((dayItems.reduce((sum, item) => sum + item.totalMinutes, 0) / 60).toFixed(1)),
      };
    });
    res.json({ employees, submittedToday, pendingReview, verified, rejected, recent, weekly });
  } catch (error) {
    next(error);
  }
}

export async function superAdminDashboard(_req: Request, res: Response, next: NextFunction) {
  try {
    const { start, end } = todayRange();
    const monthStart = startOfMonth(new Date());
    const monthEnd = endOfMonth(new Date());
    const weekStart = startOfWeek(new Date());
    const [
      employees,
      admins,
      careHomes,
      jobRoles,
      todayShifts,
      pendingAdmin,
      pendingApprovals,
      approvedMonth,
      monthSheets,
      careHomeHours,
      topEmployees,
    ] = await Promise.all([
      Employee.countDocuments(),
      User.countDocuments({ role: ROLES.ADMIN }),
      CareHome.countDocuments(),
      JobRole.countDocuments(),
      Timesheet.countDocuments({ date: { $gte: start, $lte: end } }),
      Timesheet.countDocuments({ status: { $in: [TIMESHEET_STATUS.SUBMITTED, TIMESHEET_STATUS.ADMIN_REVIEW, TIMESHEET_STATUS.RESUBMITTED] } }),
      Timesheet.countDocuments({
        status: { $in: [TIMESHEET_STATUS.SUBMITTED, TIMESHEET_STATUS.ADMIN_REVIEW, TIMESHEET_STATUS.RESUBMITTED, TIMESHEET_STATUS.SUPER_ADMIN_REVIEW] },
      }),
      Timesheet.countDocuments({
        status: TIMESHEET_STATUS.APPROVED,
        $or: [{ adminReviewedAt: { $gte: monthStart } }, { superAdminApprovedAt: { $gte: monthStart } }],
      }),
      Timesheet.find({ date: { $gte: monthStart, $lte: monthEnd } }),
      Timesheet.aggregate([
        { $match: { date: { $gte: monthStart, $lte: monthEnd } } },
        {
          $group: {
            _id: '$careHomeSnapshot.name',
            minutes: { $sum: '$totalMinutes' },
            productiveMinutes: { $sum: { $ifNull: ['$productiveMinutes', 0] } },
          },
        },
        { $sort: { minutes: -1 } },
      ]),
      Timesheet.aggregate([
        { $match: { date: { $gte: monthStart, $lte: monthEnd } } },
        {
          $group: {
            _id: '$employeeSnapshot.name',
            minutes: { $sum: '$totalMinutes' },
            productiveMinutes: { $sum: { $ifNull: ['$productiveMinutes', 0] } },
          },
        },
        { $sort: { minutes: -1 } },
        { $limit: 5 },
      ]),
    ]);
    const weekly = Array.from({ length: 7 }).map((_, index) => {
      const date = addDays(weekStart, index);
      const key = toDateKey(date);
      const dayItems = monthSheets.filter((item) => toDateKey(new Date(item.date)) === key);
      return { date: key, count: dayItems.length };
    });
    const approvedVsRejected = {
      approved: monthSheets.filter((item) => item.status === TIMESHEET_STATUS.APPROVED).length,
      rejected: monthSheets.filter((item) => [TIMESHEET_STATUS.ADMIN_REJECTED, TIMESHEET_STATUS.SUPER_ADMIN_REJECTED].includes(item.status as never)).length,
      pending: monthSheets.filter((item) => ![TIMESHEET_STATUS.APPROVED, TIMESHEET_STATUS.ADMIN_REJECTED, TIMESHEET_STATUS.SUPER_ADMIN_REJECTED].includes(item.status as never)).length,
    };
    const topProductiveEmployees = [...(topEmployees as { _id: string; minutes: number; productiveMinutes?: number }[])]
      .sort((a, b) => (b.productiveMinutes ?? 0) - (a.productiveMinutes ?? 0))
      .slice(0, 5)
      .map((item) => ({
        _id: item._id,
        minutes: item.productiveMinutes ?? 0,
        workedMinutes: item.minutes,
      }));
    res.json({
      employees,
      admins,
      careHomes,
      jobRoles,
      todayShifts,
      pendingAdmin,
      pendingApprovals,
      approvedMonth,
      monthMinutes: monthSheets.reduce((sum, item) => sum + item.totalMinutes, 0),
      monthProductiveMinutes: monthSheets.reduce((sum, item) => sum + (item.productiveMinutes ?? 0), 0),
      careHomeHours,
      topEmployees,
      topProductiveEmployees,
      weekly,
      approvedVsRejected,
      submittedOverTime: weekly,
    });
  } catch (error) {
    next(error);
  }
}
