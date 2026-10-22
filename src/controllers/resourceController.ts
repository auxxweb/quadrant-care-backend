import type { Request, Response, NextFunction } from 'express';
import { CareHome } from '../models/CareHome.js';
import { JobRole } from '../models/JobRole.js';
import { Employee, EMPLOYEE_POPULATE } from '../models/Employee.js';
import { User } from '../models/User.js';
import { AppError, ConflictError, NotFoundError } from '../utils/errors.js';
import { assertPasswordStrength, hashSecret } from '../services/authService.js';
import { assertAssignableJobRoles, normalizeEmployeeJobRoles } from '../services/employeeJobRoles.js';
import { nextAdminId, nextEmployeeId } from '../services/idService.js';
import { auditFromRequest } from '../services/auditService.js';
import { sendEmail } from '../services/emailService.js';
import { env } from '../config/env.js';
import { storageService } from '../services/storageService.js';
import { ROLES } from '../config/constants.js';
import { applyDateRange } from '../utils/query.js';

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function listEmployees(req: Request, res: Response, next: NextFunction) {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.careHomeId) filter.careHomeId = req.query.careHomeId;
    if (req.query.jobRoleId) filter.jobRoleIds = req.query.jobRoleId;
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(String(req.query.search)), 'i');
      filter.$or = [{ fullName: rx }, { employeeId: rx }, { email: rx }, { mobile: rx }];
    }
    applyDateRange(filter, req, 'joiningDate');
    const [items, total] = await Promise.all([
      Employee.find(filter)
        .populate([...EMPLOYEE_POPULATE])
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Employee.countDocuments(filter),
    ]);
    res.json({ items, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    next(error);
  }
}

export async function createEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    const { fullName, email, mobile, password, jobRoleIds, primaryJobRoleId, careHomeId, joiningDate, dateOfBirth, address, loginEnabled, passcode, profilePhoto } =
      req.body;
    assertPasswordStrength(password);
    const roles = normalizeEmployeeJobRoles(jobRoleIds, primaryJobRoleId);
    await assertAssignableJobRoles(roles.jobRoleIds);
    if (careHomeId) {
      const careHome = await CareHome.findById(careHomeId);
      if (!careHome || careHome.status !== 'ACTIVE') throw new AppError('Select an active care home.');
    }
    if (await User.findOne({ $or: [{ email }, { mobile }] })) throw new ConflictError('Email or mobile already exists.');

    const employeeId = await nextEmployeeId();
    const user = await User.create({
      name: fullName,
      email,
      mobile,
      passwordHash: await hashSecret(password),
      passcodeHash: passcode ? await hashSecret(passcode) : undefined,
      role: ROLES.STAFF,
      status: 'ACTIVE',
      employeeId,
      loginEnabled: loginEnabled !== false,
      mustChangePassword: true,
    });

    let photoPath: string | undefined;
    if (profilePhoto?.startsWith('data:image')) {
      photoPath = await storageService.saveBase64Image(profilePhoto, 'photos');
    }

    const employee = await Employee.create({
      employeeId,
      userId: user._id,
      fullName,
      email,
      mobile,
      dateOfBirth,
      address,
      profilePhoto: photoPath,
      jobRoleIds: roles.jobRoleIds,
      primaryJobRoleId: roles.primaryJobRoleId,
      ...(careHomeId ? { careHomeId } : {}),
      joiningDate,
      status: 'ACTIVE',
      loginEnabled: loginEnabled !== false,
    });

    await auditFromRequest(req.user, 'CREATE_EMPLOYEE', 'Employee', String(employee._id), `Created employee ${employeeId}`, req);
    await sendEmail({
      to: email,
      template: 'welcome',
      data: { name: fullName, loginUrl: `${env.clientUrl}/login` },
    });
    res.status(201).json(await employee.populate([...EMPLOYEE_POPULATE]));
  } catch (error) {
    next(error);
  }
}

export async function getEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    const employee = await Employee.findById(req.params.id).populate([...EMPLOYEE_POPULATE]);
    if (!employee) throw new NotFoundError('Employee not found.');
    if (req.user?.role === 'STAFF') {
      const mine = await Employee.findOne({ userId: req.user.id });
      if (!mine || String(mine._id) !== String(employee._id)) throw new AppError('You can only view your own profile.', 403, 'FORBIDDEN');
    }
    res.json(employee);
  } catch (error) {
    next(error);
  }
}

export async function updateEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) throw new NotFoundError('Employee not found.');
    const user = await User.findById(employee.userId).select('+passwordHash +passcodeHash');
    if (!user) throw new NotFoundError('Linked user not found.');

    const body = req.body;
    if (body.fullName) {
      employee.fullName = body.fullName;
      user.name = body.fullName;
    }
    if (body.email) {
      employee.email = body.email;
      user.email = body.email;
    }
    if (body.mobile) {
      employee.mobile = body.mobile;
      user.mobile = body.mobile;
    }
    if (body.address !== undefined) employee.address = body.address;
    if (body.dateOfBirth !== undefined) employee.dateOfBirth = body.dateOfBirth;
    if (body.jobRoleIds || body.primaryJobRoleId) {
      const currentIds = (employee.jobRoleIds ?? []).map((id) => String(id));
      const roles = normalizeEmployeeJobRoles(body.jobRoleIds ?? currentIds, body.primaryJobRoleId, employee.primaryJobRoleId ? String(employee.primaryJobRoleId) : undefined);
      await assertAssignableJobRoles(roles.jobRoleIds, { allowExistingInactiveIds: currentIds });
      employee.set('jobRoleIds', roles.jobRoleIds);
      employee.set('primaryJobRoleId', roles.primaryJobRoleId);
    }
    if (body.careHomeId) {
      const careHome = await CareHome.findById(body.careHomeId);
      if (!careHome) throw new AppError('Care home not found.');
      employee.careHomeId = body.careHomeId;
    }
    if (body.joiningDate) employee.joiningDate = body.joiningDate;
    if (body.status) {
      employee.status = body.status;
      user.status = body.status;
    }
    if (body.loginEnabled !== undefined) {
      employee.loginEnabled = body.loginEnabled;
      user.loginEnabled = body.loginEnabled;
    }
    if (body.password) {
      assertPasswordStrength(body.password);
      user.passwordHash = await hashSecret(body.password);
    }
    if (body.passcode) user.passcodeHash = await hashSecret(body.passcode);
    if (body.profilePhoto?.startsWith('data:image')) {
      employee.profilePhoto = await storageService.saveBase64Image(body.profilePhoto, 'photos');
    }
    await user.save();
    await employee.save();
    await auditFromRequest(req.user, 'UPDATE_EMPLOYEE', 'Employee', String(employee._id), `Updated employee ${employee.employeeId}`, req);
    res.json(await employee.populate([...EMPLOYEE_POPULATE]));
  } catch (error) {
    next(error);
  }
}

export async function updateEmployeeStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) throw new NotFoundError('Employee not found.');
    employee.status = req.body.status;
    employee.loginEnabled = req.body.status === 'ACTIVE';
    await employee.save();
    await User.findByIdAndUpdate(employee.userId, { status: req.body.status, loginEnabled: req.body.status === 'ACTIVE' });
    await auditFromRequest(req.user, 'STATUS_CHANGE', 'Employee', String(employee._id), `Set employee status to ${req.body.status}`, req);
    res.json(employee);
  } catch (error) {
    next(error);
  }
}

export async function listAdmins(req: Request, res: Response, next: NextFunction) {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const filter: Record<string, unknown> = { role: ROLES.ADMIN };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(String(req.query.search)), 'i');
      filter.$or = [{ name: rx }, { adminId: rx }, { email: rx }, { mobile: rx }];
    }
    applyDateRange(filter, req, 'createdAt', true);
    const [items, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      User.countDocuments(filter),
    ]);
    res.json({ items, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    next(error);
  }
}

export async function listInchargeAdmins(req: Request, res: Response, next: NextFunction) {
  try {
    const roles = req.user?.role === ROLES.STAFF ? [ROLES.ADMIN] : [ROLES.ADMIN, ROLES.SUPER_ADMIN];
    const items = await User.find({
      role: { $in: roles },
      status: 'ACTIVE',
    })
      .sort({ name: 1 })
      .select('name adminId role');
    res.json({
      items: items.map((admin) => ({
        id: String(admin._id),
        name: admin.name,
        adminId: admin.adminId,
        role: admin.role,
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function createAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, email, mobile, password, passcode, loginEnabled } = req.body;
    assertPasswordStrength(password);
    if (await User.findOne({ $or: [{ email }, { mobile }] })) throw new ConflictError('Email or mobile already exists.');
    const adminId = await nextAdminId();
    const admin = await User.create({
      name,
      email,
      mobile,
      passwordHash: await hashSecret(password),
      passcodeHash: passcode ? await hashSecret(passcode) : undefined,
      role: ROLES.ADMIN,
      status: 'ACTIVE',
      adminId,
      loginEnabled: loginEnabled !== false,
      mustChangePassword: true,
    });
    await auditFromRequest(req.user, 'CREATE_ADMIN', 'Admin', String(admin._id), `Created admin ${adminId}`, req);
    await sendEmail({ to: email, template: 'welcome', data: { name, loginUrl: `${env.clientUrl}/login` } });
    res.status(201).json(admin);
  } catch (error) {
    next(error);
  }
}

export async function getAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const admin = await User.findOne({ _id: req.params.id, role: ROLES.ADMIN });
    if (!admin) throw new NotFoundError('Admin not found.');
    res.json(admin);
  } catch (error) {
    next(error);
  }
}

export async function updateAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const admin = await User.findOne({ _id: req.params.id, role: ROLES.ADMIN }).select('+passwordHash +passcodeHash');
    if (!admin) throw new NotFoundError('Admin not found.');
    const body = req.body;
    if (body.name) admin.name = body.name;
    if (body.email) admin.email = body.email;
    if (body.mobile) admin.mobile = body.mobile;
    if (body.status) admin.status = body.status;
    if (body.loginEnabled !== undefined) admin.loginEnabled = body.loginEnabled;
    if (body.password) {
      assertPasswordStrength(body.password);
      admin.passwordHash = await hashSecret(body.password);
    }
    if (body.passcode) admin.passcodeHash = await hashSecret(body.passcode);
    await admin.save();
    await auditFromRequest(req.user, 'UPDATE_ADMIN', 'Admin', String(admin._id), `Updated admin ${admin.adminId}`, req);
    res.json(admin);
  } catch (error) {
    next(error);
  }
}

export async function updateAdminStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const admin = await User.findOne({ _id: req.params.id, role: ROLES.ADMIN });
    if (!admin) throw new NotFoundError('Admin not found.');
    admin.status = req.body.status;
    admin.loginEnabled = req.body.status === 'ACTIVE';
    await admin.save();
    await auditFromRequest(req.user, 'STATUS_CHANGE', 'Admin', String(admin._id), `Set admin status to ${req.body.status}`, req);
    res.json(admin);
  } catch (error) {
    next(error);
  }
}

export async function listCareHomes(req: Request, res: Response, next: NextFunction) {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(String(req.query.search)), 'i');
      filter.$or = [{ name: rx }, { city: rx }, { postcode: rx }, { address: rx }, { contactPerson: rx }];
    }
    applyDateRange(filter, req, 'createdAt', true);
    const items = await CareHome.find(filter).sort({ name: 1 });
    res.json({ items });
  } catch (error) {
    next(error);
  }
}

function isDuplicateKey(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000;
}

export async function createCareHome(req: Request, res: Response, next: NextFunction) {
  try {
    const payload = { ...req.body, email: req.body.email || undefined };
    const careHome = await CareHome.create(payload);
    await auditFromRequest(req.user, 'CREATE_CARE_HOME', 'CareHome', String(careHome._id), `Created care home ${careHome.name}`, req);
    res.status(201).json(careHome);
  } catch (error) {
    if (isDuplicateKey(error)) {
      next(new ConflictError('A care home with this name already exists.'));
      return;
    }
    next(error);
  }
}

export async function getCareHome(req: Request, res: Response, next: NextFunction) {
  try {
    const careHome = await CareHome.findById(req.params.id);
    if (!careHome) throw new NotFoundError('Care home not found.');
    res.json(careHome);
  } catch (error) {
    next(error);
  }
}

export async function updateCareHome(req: Request, res: Response, next: NextFunction) {
  try {
    const payload = { ...req.body, email: req.body.email || undefined };
    const careHome = await CareHome.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
    if (!careHome) throw new NotFoundError('Care home not found.');
    await auditFromRequest(req.user, 'UPDATE_CARE_HOME', 'CareHome', String(careHome._id), `Updated care home ${careHome.name}`, req);
    res.json(careHome);
  } catch (error) {
    if (isDuplicateKey(error)) {
      next(new ConflictError('A care home with this name already exists.'));
      return;
    }
    next(error);
  }
}

export async function deleteCareHome(req: Request, res: Response, next: NextFunction) {
  try {
    const assigned = await Employee.countDocuments({ careHomeId: req.params.id });
    if (assigned > 0) {
      throw new AppError(
        `This care home has ${assigned} employee${assigned === 1 ? '' : 's'} assigned. Reassign them before deleting, or deactivate the care home instead.`,
        400,
        'IN_USE',
      );
    }
    const careHome = await CareHome.findByIdAndDelete(req.params.id);
    if (!careHome) throw new NotFoundError('Care home not found.');
    await auditFromRequest(req.user, 'DELETE_CARE_HOME', 'CareHome', String(careHome._id), `Deleted care home ${careHome.name}`, req);
    res.json({ message: 'Care home deleted.' });
  } catch (error) {
    next(error);
  }
}

export async function updateCareHomeStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const careHome = await CareHome.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    if (!careHome) throw new NotFoundError('Care home not found.');
    res.json(careHome);
  } catch (error) {
    next(error);
  }
}

export async function listJobRoles(req: Request, res: Response, next: NextFunction) {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(String(req.query.search)), 'i');
      filter.$or = [{ name: rx }, { description: rx }];
    }
    applyDateRange(filter, req, 'createdAt', true);
    const items = await JobRole.find(filter).sort({ name: 1 });
    res.json({ items });
  } catch (error) {
    next(error);
  }
}

export async function createJobRole(req: Request, res: Response, next: NextFunction) {
  try {
    const payload = { ...req.body, description: req.body.description || undefined };
    const jobRole = await JobRole.create(payload);
    await auditFromRequest(req.user, 'CREATE_JOB_ROLE', 'JobRole', String(jobRole._id), `Created job role ${jobRole.name}`, req);
    res.status(201).json(jobRole);
  } catch (error) {
    if (isDuplicateKey(error)) {
      next(new ConflictError('A job role with this name already exists.'));
      return;
    }
    next(error);
  }
}

export async function getJobRole(req: Request, res: Response, next: NextFunction) {
  try {
    const jobRole = await JobRole.findById(req.params.id);
    if (!jobRole) throw new NotFoundError('Job role not found.');
    res.json(jobRole);
  } catch (error) {
    next(error);
  }
}

export async function updateJobRole(req: Request, res: Response, next: NextFunction) {
  try {
    const payload = { ...req.body, description: req.body.description || undefined };
    const jobRole = await JobRole.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
    if (!jobRole) throw new NotFoundError('Job role not found.');
    await auditFromRequest(req.user, 'UPDATE_JOB_ROLE', 'JobRole', String(jobRole._id), `Updated job role ${jobRole.name}`, req);
    res.json(jobRole);
  } catch (error) {
    if (isDuplicateKey(error)) {
      next(new ConflictError('A job role with this name already exists.'));
      return;
    }
    next(error);
  }
}

export async function deleteJobRole(req: Request, res: Response, next: NextFunction) {
  try {
    const assigned = await Employee.countDocuments({ jobRoleIds: req.params.id });
    if (assigned > 0) {
      throw new AppError(
        `This job role has ${assigned} employee${assigned === 1 ? '' : 's'} assigned. Reassign them before deleting.`,
        400,
        'IN_USE',
      );
    }
    const jobRole = await JobRole.findByIdAndDelete(req.params.id);
    if (!jobRole) throw new NotFoundError('Job role not found.');
    await auditFromRequest(req.user, 'DELETE_JOB_ROLE', 'JobRole', String(jobRole._id), `Deleted job role ${jobRole.name}`, req);
    res.json({ message: 'Job role deleted.' });
  } catch (error) {
    next(error);
  }
}

export async function updateJobRoleStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const jobRole = await JobRole.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    if (!jobRole) throw new NotFoundError('Job role not found.');
    res.json(jobRole);
  } catch (error) {
    next(error);
  }
}
