import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { ROLES } from '../config/constants.js';

export async function notifyUser(
  userId: string,
  title: string,
  description: string,
  type: string,
  entityId?: string,
  entityType = 'Timesheet',
) {
  await Notification.create({ userId, title, description, type, entityType, entityId });
}

export async function notifyUsers(
  userIds: string[],
  title: string,
  description: string,
  type: string,
  entityId?: string,
  entityType = 'Timesheet',
) {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return;
  await Notification.insertMany(
    unique.map((userId) => ({ userId, title, description, type, entityType, entityId })),
  );
}

export async function notifyRole(role: string, title: string, description: string, type: string, entityId?: string) {
  const users = await User.find({ role, status: 'ACTIVE' }).select('_id');
  await Notification.insertMany(
    users.map((user) => ({
      userId: user._id,
      title,
      description,
      type,
      entityType: 'Timesheet',
      entityId,
    })),
  );
}

export async function notifyAdmins(title: string, description: string, entityId?: string) {
  await notifyRole(ROLES.ADMIN, title, description, 'TIMESHEET_SUBMITTED', entityId);
}

export async function notifySuperAdmins(title: string, description: string, entityId?: string) {
  await notifyRole(ROLES.SUPER_ADMIN, title, description, 'TIMESHEET_READY', entityId);
}
