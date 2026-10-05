import { Router } from 'express';
import { authRouter } from './auth.js';
import { adminRouter, careHomeRouter, employeeRouter, jobRoleRouter } from './resources.js';
import { timesheetRouter } from './timesheets.js';
import { chatRouter } from './chat.js';
import { auditRouter, dashboardRouter, notificationRouter, reportsRouter, searchRouter, settingsRouter } from './misc.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/employees', employeeRouter);
apiRouter.use('/admins', adminRouter);
apiRouter.use('/care-homes', careHomeRouter);
apiRouter.use('/job-roles', jobRoleRouter);
apiRouter.use('/timesheets', timesheetRouter);
apiRouter.use('/chat', chatRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/audit-logs', auditRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/search', searchRouter);
