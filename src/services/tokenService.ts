import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { RefreshToken } from '../models/RefreshToken.js';
import type { AuthUser } from '../types/index.js';

export function signAccessToken(user: AuthUser): string {
  const payload = { sub: user.id, role: user.role, name: user.name, employeeId: user.employeeId, adminId: user.adminId };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.accessTokenExpiry } as SignOptions);
}

export function signRefreshToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = crypto.randomBytes(48).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = parseExpiry(env.refreshTokenExpiry);
  return { token, tokenHash, expiresAt };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function verifyAccessToken(token: string): AuthUser {
  const decoded = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
  return {
    id: String(decoded.sub),
    role: decoded.role,
    name: decoded.name,
    employeeId: decoded.employeeId,
    adminId: decoded.adminId,
  };
}

export async function persistRefreshToken(params: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}): Promise<void> {
  await RefreshToken.create(params);
}

export async function rotateRefreshToken(currentToken: string): Promise<{ userId: string } | null> {
  const tokenHash = hashToken(currentToken);
  const existing = await RefreshToken.findOne({ tokenHash, revokedAt: { $exists: false } });
  if (!existing || existing.expiresAt.getTime() < Date.now()) return null;
  existing.revokedAt = new Date();
  await existing.save();
  return { userId: String(existing.userId) };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await RefreshToken.updateOne({ tokenHash }, { $set: { revokedAt: new Date() } });
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  await RefreshToken.updateMany({ userId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
}

function parseExpiry(value: string): Date {
  const match = /^(\d+)([smhd])$/.exec(value);
  const amount = match ? Number(match[1]) : 7;
  const unit = match?.[2] ?? 'd';
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return new Date(Date.now() + amount * (multipliers[unit] ?? 86_400_000));
}
