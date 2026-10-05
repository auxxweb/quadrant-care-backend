import { AuditLog } from '../models/AuditLog.js';
import type { AuthUser } from '../types/index.js';

export async function recordAudit(entry: {
  userId?: string;
  userName?: string;
  role?: string;
  action: string;
  entity: string;
  entityId?: string;
  description: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: unknown;
}): Promise<void> {
  await AuditLog.create(entry);
}

export function auditFromRequest(
  user: AuthUser | undefined,
  action: string,
  entity: string,
  entityId: string,
  description: string,
  req: { ip?: string; headers: { [key: string]: unknown } },
) {
  return recordAudit({
    userId: user?.id,
    userName: user?.name,
    role: user?.role,
    action,
    entity,
    entityId,
    description,
    ipAddress: req.ip,
    userAgent: String(req.headers['user-agent'] ?? ''),
  });
}
