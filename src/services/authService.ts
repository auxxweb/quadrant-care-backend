import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { User } from '../models/User.js';
import { SystemSettings } from '../models/SystemSettings.js';
import { DEFAULT_SETTINGS, ROLES } from '../config/constants.js';
import { AppError, UnauthorizedError } from '../utils/errors.js';
import { persistRefreshToken, signAccessToken, signRefreshToken, rotateRefreshToken, revokeRefreshToken } from './tokenService.js';
import { recordAudit } from './auditService.js';
import { sendEmail } from './emailService.js';
import { env } from '../config/env.js';
import type { AuthUser } from '../types/index.js';

const SALT_ROUNDS = 12;

export async function hashSecret(value: string): Promise<string> {
  return bcrypt.hash(value, SALT_ROUNDS);
}

export async function verifySecret(value: string, hash: string): Promise<boolean> {
  return bcrypt.compare(value, hash);
}

export function assertPasswordStrength(password: string): void {
  if (!password.trim()) {
    throw new AppError('Password is required.', 400, 'WEAK_PASSWORD');
  }
}

export async function getSettings() {
  const existing = await SystemSettings.findOne({ key: 'global' });
  if (!existing) return SystemSettings.create({ key: 'global', ...DEFAULT_SETTINGS });
  if (existing.staffSignupEnabled == null) {
    existing.staffSignupEnabled = true;
    await existing.save();
  }
  return existing;
}

export async function loginWithPassword(identifier: string, password: string, meta: { ip?: string; userAgent?: string }) {
  const settings = await getSettings();
  const looksLikeEmail = identifier.includes('@');
  if (looksLikeEmail && !settings.emailLoginEnabled) {
    throw new AppError('Email login is currently disabled.', 403, 'LOGIN_METHOD_DISABLED');
  }
  if (!looksLikeEmail && !settings.mobileLoginEnabled) {
    throw new AppError('Mobile login is currently disabled.', 403, 'LOGIN_METHOD_DISABLED');
  }

  const query = looksLikeEmail
    ? { email: identifier.toLowerCase() }
    : { $or: [{ mobile: identifier }, { employeeId: identifier }, { adminId: identifier }] };

  const user = await User.findOne(query).select('+passwordHash');
  if (!user) throw new UnauthorizedError('Invalid login details.');
  await assertAccountUsable(user, settings);
  const valid = await verifySecret(password, user.passwordHash);
  if (!valid) {
    await registerFailedAttempt(user, settings);
    throw new UnauthorizedError('Invalid login details.');
  }
  return completeLogin(user, meta);
}

export async function loginWithPasscode(identifier: string, passcode: string, meta: { ip?: string; userAgent?: string }) {
  const settings = await getSettings();
  if (!settings.passcodeLoginEnabled) {
    throw new AppError('Passcode login is currently disabled.', 403, 'LOGIN_METHOD_DISABLED');
  }
  if (!/^\d{5}$/.test(passcode)) {
    throw new AppError('Passcode must be 5 digits.', 400, 'INVALID_PASSCODE');
  }
  const user = await User.findOne({
    $or: [{ employeeId: identifier }, { mobile: identifier }, { email: identifier.toLowerCase() }, { adminId: identifier }],
  }).select('+passcodeHash +passwordHash');
  if (!user || !user.passcodeHash) throw new UnauthorizedError('Invalid login details.');
  await assertAccountUsable(user, settings);
  const valid = await verifySecret(passcode, user.passcodeHash);
  if (!valid) {
    await registerFailedAttempt(user, settings);
    throw new UnauthorizedError('Invalid login details.');
  }
  return completeLogin(user, meta);
}

export async function refreshSession(refreshToken: string) {
  const rotated = await rotateRefreshToken(refreshToken);
  if (!rotated) throw new UnauthorizedError('Session expired. Please sign in again.');
  const user = await User.findById(rotated.userId);
  if (!user || user.status !== 'ACTIVE' || !user.loginEnabled) {
    throw new UnauthorizedError('Session expired. Please sign in again.');
  }
  const tokens = await issueTokens(toAuthUser(user));
  return { user: sanitizeUser(user), ...tokens };
}

export async function logout(refreshToken?: string) {
  if (refreshToken) await revokeRefreshToken(refreshToken);
}

export async function requestPasswordReset(email: string) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return;
  const token = crypto.randomBytes(32).toString('hex');
  user.passwordResetToken = crypto.createHash('sha256').update(token).digest('hex');
  user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();
  await sendEmail({
    to: user.email ?? '',
    template: 'password-reset',
    data: { name: user.name, resetUrl: `${env.clientUrl}/reset-password?token=${token}` },
  });
}

export async function resetPassword(token: string, password: string) {
  assertPasswordStrength(password);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    passwordResetToken: tokenHash,
    passwordResetExpires: { $gt: new Date() },
  }).select('+passwordResetToken +passwordResetExpires');
  if (!user) throw new AppError('This reset link is invalid or has expired.', 400, 'INVALID_RESET');
  user.passwordHash = await hashSecret(password);
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  user.failedLoginAttempts = 0;
  user.lockUntil = undefined;
  await user.save();
  await recordAudit({
    userId: String(user._id),
    userName: user.name,
    role: user.role,
    action: 'PASSWORD_RESET',
    entity: 'User',
    entityId: String(user._id),
    description: 'Password reset completed',
  });
}

export async function completeLogin(user: InstanceType<typeof User>, meta: { ip?: string; userAgent?: string }) {
  user.failedLoginAttempts = 0;
  user.lockUntil = undefined;
  user.lastLogin = new Date();
  await user.save();
  const authUser = toAuthUser(user);
  const tokens = await issueTokens(authUser, meta);
  await recordAudit({
    userId: String(user._id),
    userName: user.name,
    role: user.role,
    action: 'LOGIN',
    entity: 'User',
    entityId: String(user._id),
    description: 'User signed in',
    ipAddress: meta.ip,
  });
  return { user: sanitizeUser(user), ...tokens };
}

async function issueTokens(user: AuthUser, meta: { ip?: string; userAgent?: string } = {}) {
  const accessToken = signAccessToken(user);
  const refresh = signRefreshToken();
  await persistRefreshToken({
    userId: user.id,
    tokenHash: refresh.tokenHash,
    expiresAt: refresh.expiresAt,
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
  });
  return { accessToken, refreshToken: refresh.token, expiresAt: refresh.expiresAt };
}

async function assertAccountUsable(user: InstanceType<typeof User>, settings: Awaited<ReturnType<typeof getSettings>>) {
  if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
    throw new AppError('Too many failed attempts. Please try again later.', 423, 'ACCOUNT_LOCKED');
  }
  if (user.status !== 'ACTIVE' || !user.loginEnabled) {
    throw new AppError('This account is disabled. Please contact Quadrant Care.', 403, 'ACCOUNT_DISABLED');
  }
  if (user.lockUntil && user.lockUntil.getTime() <= Date.now()) {
    user.lockUntil = undefined;
    user.failedLoginAttempts = 0;
    await user.save();
  }
  void settings;
}

async function registerFailedAttempt(user: InstanceType<typeof User>, settings: Awaited<ReturnType<typeof getSettings>>) {
  user.failedLoginAttempts += 1;
  if (user.failedLoginAttempts >= settings.maxLoginAttempts) {
    user.lockUntil = new Date(Date.now() + settings.lockoutDurationMinutes * 60 * 1000);
    user.failedLoginAttempts = 0;
  }
  await user.save();
}

export function toAuthUser(user: InstanceType<typeof User>): AuthUser {
  return {
    id: String(user._id),
    role: user.role as AuthUser['role'],
    name: user.name,
    email: user.email ?? undefined,
    employeeId: user.employeeId ?? undefined,
    adminId: user.adminId ?? undefined,
    metricsFocus: ((user as { metricsFocus?: 'WORKED' | 'PRODUCTIVE' }).metricsFocus ?? 'WORKED'),
  };
}

export function sanitizeUser(user: InstanceType<typeof User>) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    mobile: user.mobile,
    role: user.role,
    status: user.status,
    employeeId: user.employeeId,
    adminId: user.adminId,
    lastLogin: user.lastLogin,
    themePreference: user.themePreference,
    metricsFocus: (user as { metricsFocus?: 'WORKED' | 'PRODUCTIVE' }).metricsFocus ?? 'WORKED',
    mustChangePassword: user.mustChangePassword,
    hasPasscode: Boolean((user as { passcodeHash?: string }).passcodeHash),
    signaturePath: user.signaturePath,
  };
}

export { ROLES };
