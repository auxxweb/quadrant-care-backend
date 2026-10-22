import type { Request, Response, NextFunction } from 'express';
import { AuditLog } from '../models/AuditLog.js';
import { Notification } from '../models/Notification.js';
import { getSettings } from '../services/authService.js';
import { SystemSettings } from '../models/SystemSettings.js';
import { auditFromRequest } from '../services/auditService.js';
import { applyDateRange } from '../utils/query.js';
import { AppError } from '../utils/errors.js';

export async function getSettingsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getSettings());
  } catch (error) {
    next(error);
  }
}

export async function updateSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const current = await getSettings();
    const emailLoginEnabled = req.body.emailLoginEnabled ?? current.emailLoginEnabled;
    const mobileLoginEnabled = req.body.mobileLoginEnabled ?? current.mobileLoginEnabled;
    const passcodeLoginEnabled = req.body.passcodeLoginEnabled ?? current.passcodeLoginEnabled;
    if (!emailLoginEnabled && !mobileLoginEnabled && !passcodeLoginEnabled) {
      throw new AppError('Enable at least one login method.', 400, 'LOGIN_METHOD_REQUIRED');
    }
    const settings = await SystemSettings.findOneAndUpdate({ key: 'global' }, { $set: req.body }, { new: true, upsert: true });
    await auditFromRequest(req.user, 'SETTINGS_UPDATED', 'SystemSettings', String(settings._id), 'Updated application settings', req);
    res.json(settings);
  } catch (error) {
    next(error);
  }
}

export async function listAuditLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 30);
    const filter: Record<string, unknown> = {};
    if (req.query.action) filter.action = req.query.action;
    if (req.query.search) {
      const rx = new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ userName: rx }, { description: rx }, { entityId: rx }, { action: rx }];
    }
    applyDateRange(filter, req, 'createdAt', true);
    const [items, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ items, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    next(error);
  }
}

export async function listNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    const items = await Notification.find({ userId: req.user!.id }).sort({ createdAt: -1 }).limit(50);
    const unread = await Notification.countDocuments({ userId: req.user!.id, read: false });
    res.json({ items, unread });
  } catch (error) {
    next(error);
  }
}

export async function markNotificationRead(req: Request, res: Response, next: NextFunction) {
  try {
    const item = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      { read: true, readAt: new Date() },
      { new: true },
    );
    res.json(item);
  } catch (error) {
    next(error);
  }
}

export async function markAllRead(req: Request, res: Response, next: NextFunction) {
  try {
    await Notification.updateMany({ userId: req.user!.id, read: false }, { $set: { read: true, readAt: new Date() } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}
