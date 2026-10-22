import { JobRole } from '../models/JobRole.js';
import { AppError } from '../utils/errors.js';

function populatedJobRole(value: unknown): { _id: unknown; name?: string } | null {
  if (value && typeof value === 'object' && '_id' in value) return value as { _id: unknown; name?: string };
  return null;
}

export function resolveStaffTimesheetJobRole(
  employee: { jobRoleIds?: unknown[]; primaryJobRoleId?: unknown },
  requestedId?: string,
): { _id: unknown; name?: string } | null {
  const assigned = (employee.jobRoleIds ?? [])
    .map(populatedJobRole)
    .filter((role): role is { _id: unknown; name?: string } => Boolean(role));
  const assignedIds = assigned.map((role) => String(role._id));
  if (requestedId) {
    if (!assignedIds.includes(String(requestedId))) {
      throw new AppError('Select one of your assigned job roles.');
    }
    return assigned.find((role) => String(role._id) === String(requestedId)) ?? null;
  }
  if (assigned.length > 1) throw new AppError('Select a job role.');
  return populatedJobRole(employee.primaryJobRoleId) ?? assigned[0] ?? null;
}

export function uniqueRoleIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
}

export function normalizeEmployeeJobRoles(
  jobRoleIds: string[],
  primaryJobRoleId?: string,
  fallbackPrimary?: string,
) {
  const ids = uniqueRoleIds(jobRoleIds);
  if (!ids.length) throw new AppError('Select at least one job role.');
  if (primaryJobRoleId) {
    if (!ids.includes(primaryJobRoleId)) {
      throw new AppError('Primary job role must be one of the assigned roles.');
    }
    return { jobRoleIds: ids, primaryJobRoleId };
  }
  const fallback = fallbackPrimary && ids.includes(fallbackPrimary) ? fallbackPrimary : ids[0];
  return { jobRoleIds: ids, primaryJobRoleId: fallback };
}

export async function assertAssignableJobRoles(ids: string[], options?: { allowExistingInactiveIds?: string[] }) {
  const roles = await JobRole.find({ _id: { $in: ids } });
  if (roles.length !== ids.length) throw new AppError('Select valid job roles.');
  const allowedInactive = new Set((options?.allowExistingInactiveIds ?? []).map(String));
  const blocked = roles.filter((role) => role.status !== 'ACTIVE' && !allowedInactive.has(String(role._id)));
  if (blocked.length) throw new AppError('Select an active job role.');
  return roles;
}
