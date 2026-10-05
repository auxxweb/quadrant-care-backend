import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Employee } from '../models/Employee.js';
import { CareHome } from '../models/CareHome.js';
import { JobRole } from '../models/JobRole.js';
import { SystemSettings } from '../models/SystemSettings.js';
import {
  assertPasswordStrength,
  completeLogin,
  getSettings,
  hashSecret,
  loginWithPasscode,
  loginWithPassword,
  logout,
  refreshSession,
  requestPasswordReset,
  resetPassword,
  sanitizeUser,
  verifySecret,
} from '../services/authService.js';
import { recordAudit } from '../services/auditService.js';
import { storageService } from '../services/storageService.js';
import { sendEmail } from '../services/emailService.js';
import { nextEmployeeId } from '../services/idService.js';
import { notifyRole } from '../services/notificationService.js';
import { AppError, ConflictError } from '../utils/errors.js';
import { ROLES } from '../config/constants.js';

const cookieOptions = {
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: env.cookieSameSite,
  path: '/api/auth',
};

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await loginWithPassword(req.body.identifier, req.body.password, {
      ip: req.ip,
      userAgent: String(req.headers['user-agent'] ?? ''),
    });
    res.cookie('refreshToken', result.refreshToken, { ...cookieOptions, expires: result.expiresAt });
    res.json({ accessToken: result.accessToken, user: result.user });
  } catch (error) {
    next(error);
  }
}

export async function loginPasscode(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await loginWithPasscode(req.body.identifier, req.body.passcode, {
      ip: req.ip,
      userAgent: String(req.headers['user-agent'] ?? ''),
    });
    res.cookie('refreshToken', result.refreshToken, { ...cookieOptions, expires: result.expiresAt });
    res.json({ accessToken: result.accessToken, user: result.user });
  } catch (error) {
    next(error);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.refreshToken as string | undefined;
    if (!token) {
      res.status(401).json({ message: 'Please sign in to continue.', code: 'UNAUTHORIZED' });
      return;
    }
    const result = await refreshSession(token);
    res.cookie('refreshToken', result.refreshToken, { ...cookieOptions, expires: result.expiresAt });
    res.json({ accessToken: result.accessToken, user: result.user });
  } catch (error) {
    next(error);
  }
}

export async function logoutHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await logout(req.cookies?.refreshToken);
    if (req.user) {
      await recordAudit({
        userId: req.user.id,
        userName: req.user.name,
        role: req.user.role,
        action: 'LOGOUT',
        entity: 'User',
        entityId: req.user.id,
        description: 'User signed out',
        ipAddress: req.ip,
      });
    }
    res.clearCookie('refreshToken', cookieOptions);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await User.findById(req.user!.id).select('+passcodeHash');
    if (!user) {
      res.status(401).json({ message: 'Please sign in to continue.' });
      return;
    }
    let employee = null;
    if (user.role === 'STAFF') {
      employee = await Employee.findOne({ userId: user._id }).populate('jobRoleId').populate('careHomeId');
    }
    const settings = await getSettings();
    res.json({
      user: sanitizeUser(user),
      employee,
      authOptions: {
        emailLoginEnabled: settings.emailLoginEnabled,
        mobileLoginEnabled: settings.mobileLoginEnabled,
        passcodeLoginEnabled: settings.passcodeLoginEnabled,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function publicAuthOptions(_req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await SystemSettings.findOne({ key: 'global' });
    res.json({
      emailLoginEnabled: settings?.emailLoginEnabled ?? true,
      mobileLoginEnabled: settings?.mobileLoginEnabled ?? true,
      passcodeLoginEnabled: settings?.passcodeLoginEnabled ?? true,
      staffSignupEnabled: settings?.staffSignupEnabled !== false,
      appName: settings?.appName ?? 'Quadrant Care',
      companyName: settings?.companyName ?? 'Quadrant Care Services Ltd',
    });
  } catch (error) {
    next(error);
  }
}

export async function signupOptions(_req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await getSettings();
    if (settings.staffSignupEnabled === false) {
      res.json({ staffSignupEnabled: false, jobRoles: [], careHomes: [] });
      return;
    }
    const [jobRoles, careHomes] = await Promise.all([
      JobRole.find({ status: 'ACTIVE' }).sort({ name: 1 }).select('name'),
      CareHome.find({ status: 'ACTIVE' }).sort({ name: 1 }).select('name city'),
    ]);
    res.json({
      staffSignupEnabled: true,
      jobRoles: jobRoles.map((item) => ({ _id: String(item._id), name: item.name })),
      careHomes: careHomes.map((item) => ({ _id: String(item._id), name: item.name, city: item.city })),
    });
  } catch (error) {
    next(error);
  }
}

export async function staffSignup(req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await getSettings();
    if (settings.staffSignupEnabled === false) {
      throw new AppError('Staff self-signup is currently disabled. Please ask an admin to create your account.', 403, 'SIGNUP_DISABLED');
    }

    const { fullName, email, mobile, password, jobRoleId, careHomeId, joiningDate, passcode } = req.body as {
      fullName: string;
      email: string;
      mobile: string;
      password: string;
      jobRoleId: string;
      careHomeId: string;
      joiningDate?: string;
      passcode?: string;
    };

    assertPasswordStrength(password);
    const jobRole = await JobRole.findById(jobRoleId);
    if (!jobRole || jobRole.status !== 'ACTIVE') throw new AppError('Select an active job role.');
    const careHome = await CareHome.findById(careHomeId);
    if (!careHome || careHome.status !== 'ACTIVE') throw new AppError('Select an active care home.');

    const emailNorm = email.toLowerCase().trim();
    const mobileNorm = mobile.trim();
    if (await User.findOne({ $or: [{ email: emailNorm }, { mobile: mobileNorm }] })) {
      throw new ConflictError('An account with this email or mobile already exists. Try signing in instead.');
    }

    const employeeId = await nextEmployeeId();
    const user = await User.create({
      name: fullName.trim(),
      email: emailNorm,
      mobile: mobileNorm,
      passwordHash: await hashSecret(password),
      passcodeHash: passcode ? await hashSecret(passcode) : undefined,
      role: ROLES.STAFF,
      status: 'ACTIVE',
      employeeId,
      loginEnabled: true,
      mustChangePassword: false,
    });

    let employee;
    try {
      employee = await Employee.create({
        employeeId,
        userId: user._id,
        fullName: fullName.trim(),
        email: emailNorm,
        mobile: mobileNorm,
        jobRoleId,
        careHomeId,
        joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
        status: 'ACTIVE',
        loginEnabled: true,
      });
    } catch (error) {
      await User.deleteOne({ _id: user._id });
      throw error;
    }

    await recordAudit({
      userId: String(user._id),
      userName: user.name,
      role: user.role,
      action: 'STAFF_SIGNUP',
      entity: 'Employee',
      entityId: String(employee._id),
      description: `Staff self-signup ${employeeId}`,
      ipAddress: req.ip,
      userAgent: String(req.headers['user-agent'] ?? ''),
    });
    await Promise.all([
      notifyRole(ROLES.ADMIN, 'New staff signup', `${user.name} created a staff account (${employeeId}).`, 'STAFF_SIGNUP'),
      notifyRole(ROLES.SUPER_ADMIN, 'New staff signup', `${user.name} created a staff account (${employeeId}).`, 'STAFF_SIGNUP'),
      sendEmail({
        to: emailNorm,
        template: 'welcome',
        data: { name: user.name, loginUrl: `${env.clientUrl}/login` },
      }),
    ]);

    const result = await completeLogin(user, {
      ip: req.ip,
      userAgent: String(req.headers['user-agent'] ?? ''),
    });
    res.cookie('refreshToken', result.refreshToken, { ...cookieOptions, expires: result.expiresAt });
    res.status(201).json({ accessToken: result.accessToken, user: result.user, employeeId });
  } catch (error) {
    next(error);
  }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    await requestPasswordReset(req.body.email);
    res.json({ message: 'If an account exists, a reset email has been sent.' });
  } catch (error) {
    next(error);
  }
}

export async function resetPasswordHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await resetPassword(req.body.token, req.body.password);
    res.json({ message: 'Password updated. You can now sign in.' });
  } catch (error) {
    next(error);
  }
}

export async function updateMe(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await User.findById(req.user!.id).select('+passwordHash +passcodeHash');
    if (!user) {
      res.status(401).json({ message: 'Please sign in to continue.' });
      return;
    }
    if (req.body.themePreference) user.themePreference = req.body.themePreference;

    if (['ADMIN', 'SUPER_ADMIN'].includes(user.role) && req.body.clearSignature) {
      user.set('signaturePath', undefined);
    } else if (['ADMIN', 'SUPER_ADMIN'].includes(user.role) && req.body.signature?.startsWith('data:image')) {
      user.signaturePath = await storageService.saveBase64Image(req.body.signature, 'signatures');
    }

    if (req.body.password) {
      if (!req.body.currentPassword) throw new AppError('Enter your current password.');
      const matches = await verifySecret(req.body.currentPassword, user.passwordHash);
      if (!matches) throw new AppError('Current password is incorrect.');
      assertPasswordStrength(req.body.password);
      user.passwordHash = await hashSecret(req.body.password);
      user.mustChangePassword = false;
      await recordAudit({
        userId: String(user._id),
        userName: user.name,
        role: user.role,
        action: 'CHANGE_PASSWORD',
        entity: 'User',
        entityId: String(user._id),
        description: 'User changed their password',
        ipAddress: req.ip,
      });
    }

    if (req.body.passcode) {
      const hadPasscode = Boolean(user.passcodeHash);
      if (hadPasscode) {
        if (!req.body.currentPasscode) throw new AppError('Enter your current passcode.');
        const matches = await verifySecret(req.body.currentPasscode, user.passcodeHash!);
        if (!matches) throw new AppError('Current passcode is incorrect.');
      }
      user.passcodeHash = await hashSecret(req.body.passcode);
      await recordAudit({
        userId: String(user._id),
        userName: user.name,
        role: user.role,
        action: hadPasscode ? 'CHANGE_PASSCODE' : 'CREATE_PASSCODE',
        entity: 'User',
        entityId: String(user._id),
        description: hadPasscode ? 'User changed their passcode' : 'User created a passcode',
        ipAddress: req.ip,
      });
    }

    await user.save();
    res.json({ user: sanitizeUser(user) });
  } catch (error) {
    next(error);
  }
}
