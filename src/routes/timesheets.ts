import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import { approveSchema, managerEditTimesheetSchema, rejectSchema, timesheetSchema, verifySchema } from '../validators/resources.js';
import {
  adminReject,
  adminVerify,
  createTimesheet,
  downloadPdf,
  exportTimesheets,
  getTimesheet,
  listTimesheets,
  managerEditTimesheet,
  monthlySummary,
  submitTimesheet,
  superAdminApprove,
  superAdminReject,
  updateTimesheet,
  weeklySummary,
} from '../controllers/timesheetController.js';

export const timesheetRouter = Router();
timesheetRouter.use(authenticate);
timesheetRouter.get('/', listTimesheets);
timesheetRouter.get('/export', exportTimesheets);
timesheetRouter.get('/summary/weekly', weeklySummary);
timesheetRouter.get('/summary/monthly', monthlySummary);
timesheetRouter.post('/', authorize('STAFF', 'ADMIN'), validate(timesheetSchema), createTimesheet);
timesheetRouter.get('/:id', getTimesheet);
timesheetRouter.put('/:id', authorize('STAFF', 'ADMIN'), validate(timesheetSchema.partial()), updateTimesheet);
timesheetRouter.patch('/:id/hours', authorize('ADMIN', 'SUPER_ADMIN'), validate(managerEditTimesheetSchema), managerEditTimesheet);
timesheetRouter.post('/:id/submit', authorize('STAFF', 'ADMIN'), submitTimesheet);
timesheetRouter.post('/:id/admin-verify', authorize('ADMIN'), validate(verifySchema), adminVerify);
timesheetRouter.post('/:id/admin-reject', authorize('ADMIN'), validate(rejectSchema), adminReject);
timesheetRouter.post('/:id/super-admin-approve', authorize('SUPER_ADMIN'), validate(approveSchema), superAdminApprove);
timesheetRouter.post('/:id/super-admin-reject', authorize('SUPER_ADMIN'), validate(rejectSchema), superAdminReject);
timesheetRouter.get('/:id/pdf', downloadPdf);
