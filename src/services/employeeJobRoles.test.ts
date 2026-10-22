import { describe, expect, it } from 'vitest';
import { AppError } from '../utils/errors.js';
import { normalizeEmployeeJobRoles, resolveStaffTimesheetJobRole } from './employeeJobRoles.js';

describe('normalizeEmployeeJobRoles', () => {
  it('requires at least one role', () => {
    expect(() => normalizeEmployeeJobRoles([])).toThrow(AppError);
  });

  it('deduplicates and defaults primary to the first role', () => {
    expect(normalizeEmployeeJobRoles(['a', 'b', 'a'])).toEqual({
      jobRoleIds: ['a', 'b'],
      primaryJobRoleId: 'a',
    });
  });

  it('keeps an explicit primary when it is assigned', () => {
    expect(normalizeEmployeeJobRoles(['a', 'b'], 'b')).toEqual({
      jobRoleIds: ['a', 'b'],
      primaryJobRoleId: 'b',
    });
  });

  it('rejects a primary that is not assigned', () => {
    expect(() => normalizeEmployeeJobRoles(['a'], 'b')).toThrow(/Primary job role/);
  });

  it('falls back to the current primary when still assigned', () => {
    expect(normalizeEmployeeJobRoles(['b', 'c'], undefined, 'c')).toEqual({
      jobRoleIds: ['b', 'c'],
      primaryJobRoleId: 'c',
    });
  });
});

describe('resolveStaffTimesheetJobRole', () => {
  const employee = {
    jobRoleIds: [
      { _id: 'a', name: 'HCA' },
      { _id: 'b', name: 'Senior HCA' },
    ],
    primaryJobRoleId: { _id: 'a', name: 'HCA' },
  };

  it('requires a choice when the employee has multiple roles', () => {
    expect(() => resolveStaffTimesheetJobRole(employee)).toThrow(/Select a job role/);
  });

  it('uses the requested assigned role', () => {
    expect(resolveStaffTimesheetJobRole(employee, 'b')).toEqual({ _id: 'b', name: 'Senior HCA' });
  });

  it('rejects an unassigned role', () => {
    expect(() => resolveStaffTimesheetJobRole(employee, 'c')).toThrow(/assigned job roles/);
  });

  it('defaults to the primary when only one role is assigned', () => {
    expect(
      resolveStaffTimesheetJobRole({
        jobRoleIds: [{ _id: 'a', name: 'HCA' }],
        primaryJobRoleId: { _id: 'a', name: 'HCA' },
      }),
    ).toEqual({ _id: 'a', name: 'HCA' });
  });
});
