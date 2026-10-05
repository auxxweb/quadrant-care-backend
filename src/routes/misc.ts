import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import { adminDashboard, staffDashboard, superAdminDashboard } from '../controllers/dashboardController.js';
import { careHomeReport, employeeReport, globalSearch, hoursReport, timesheetReport } from '../controllers/reportsController.js';
import { getSettingsHandler, listAuditLogs, listNotifications, markAllRead, markNotificationRead, updateSettings } from '../controllers/miscController.js';
import { settingsSchema } from '../validators/settings.js';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);
dashboardRouter.get('/staff', authorize('STAFF'), staffDashboard);
dashboardRouter.get('/admin', authorize('ADMIN', 'SUPER_ADMIN'), adminDashboard);
dashboardRouter.get('/super-admin', authorize('SUPER_ADMIN'), superAdminDashboard);

export const reportsRouter = Router();
reportsRouter.use(authenticate, authorize('ADMIN', 'SUPER_ADMIN'));
reportsRouter.get('/timesheets', timesheetReport);
reportsRouter.get('/hours', hoursReport);
reportsRouter.get('/care-homes', careHomeReport);
reportsRouter.get('/employees', employeeReport);

export const settingsRouter = Router();
settingsRouter.use(authenticate, authorize('SUPER_ADMIN'));
settingsRouter.get('/', getSettingsHandler);
settingsRouter.put('/', validate(settingsSchema), updateSettings);

export const auditRouter = Router();
auditRouter.use(authenticate, authorize('SUPER_ADMIN'));
auditRouter.get('/', listAuditLogs);

export const notificationRouter = Router();
notificationRouter.use(authenticate);
notificationRouter.get('/', listNotifications);
notificationRouter.patch('/read-all', markAllRead);
notificationRouter.patch('/:id/read', markNotificationRead);

export const searchRouter = Router();
searchRouter.use(authenticate);
searchRouter.get('/', globalSearch);
