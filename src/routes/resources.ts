import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import {
  createAdminSchema,
  createEmployeeSchema,
  careHomeSchema,
  jobRoleSchema,
  statusSchema,
  updateAdminSchema,
  updateEmployeeSchema,
} from '../validators/resources.js';
import {
  createAdmin,
  createCareHome,
  createEmployee,
  createJobRole,
  deleteCareHome,
  deleteJobRole,
  getAdmin,
  getCareHome,
  getEmployee,
  getJobRole,
  listAdmins,
  listInchargeAdmins,
  listCareHomes,
  listEmployees,
  listJobRoles,
  updateAdmin,
  updateAdminStatus,
  updateCareHome,
  updateCareHomeStatus,
  updateEmployee,
  updateEmployeeStatus,
  updateJobRole,
  updateJobRoleStatus,
} from '../controllers/resourceController.js';

export const employeeRouter = Router();
employeeRouter.use(authenticate);
employeeRouter.get('/', authorize('SUPER_ADMIN', 'ADMIN'), listEmployees);
employeeRouter.post('/', authorize('SUPER_ADMIN', 'ADMIN'), validate(createEmployeeSchema), createEmployee);
employeeRouter.get('/:id', authorize('SUPER_ADMIN', 'ADMIN', 'STAFF'), getEmployee);
employeeRouter.put('/:id', authorize('SUPER_ADMIN', 'ADMIN'), validate(updateEmployeeSchema), updateEmployee);
employeeRouter.patch('/:id/status', authorize('SUPER_ADMIN', 'ADMIN'), validate(statusSchema), updateEmployeeStatus);

export const adminRouter = Router();
adminRouter.use(authenticate);
adminRouter.get('/directory', authorize('SUPER_ADMIN', 'ADMIN', 'STAFF'), listInchargeAdmins);
adminRouter.get('/', authorize('SUPER_ADMIN'), listAdmins);
adminRouter.post('/', authorize('SUPER_ADMIN'), validate(createAdminSchema), createAdmin);
adminRouter.get('/:id', authorize('SUPER_ADMIN'), getAdmin);
adminRouter.put('/:id', authorize('SUPER_ADMIN'), validate(updateAdminSchema), updateAdmin);
adminRouter.patch('/:id/status', authorize('SUPER_ADMIN'), validate(statusSchema), updateAdminStatus);

export const careHomeRouter = Router();
careHomeRouter.use(authenticate);
careHomeRouter.get('/', authorize('SUPER_ADMIN', 'ADMIN', 'STAFF'), listCareHomes);
careHomeRouter.post('/', authorize('SUPER_ADMIN'), validate(careHomeSchema), createCareHome);
careHomeRouter.get('/:id', authorize('SUPER_ADMIN', 'ADMIN', 'STAFF'), getCareHome);
careHomeRouter.put('/:id', authorize('SUPER_ADMIN'), validate(careHomeSchema), updateCareHome);
careHomeRouter.patch('/:id/status', authorize('SUPER_ADMIN'), validate(statusSchema), updateCareHomeStatus);
careHomeRouter.delete('/:id', authorize('SUPER_ADMIN'), deleteCareHome);

export const jobRoleRouter = Router();
jobRoleRouter.use(authenticate);
jobRoleRouter.get('/', authorize('SUPER_ADMIN', 'ADMIN', 'STAFF'), listJobRoles);
jobRoleRouter.post('/', authorize('SUPER_ADMIN'), validate(jobRoleSchema), createJobRole);
jobRoleRouter.get('/:id', authorize('SUPER_ADMIN', 'ADMIN', 'STAFF'), getJobRole);
jobRoleRouter.put('/:id', authorize('SUPER_ADMIN'), validate(jobRoleSchema), updateJobRole);
jobRoleRouter.patch('/:id/status', authorize('SUPER_ADMIN'), validate(statusSchema), updateJobRoleStatus);
jobRoleRouter.delete('/:id', authorize('SUPER_ADMIN'), deleteJobRole);
