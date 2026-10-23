import { describe, expect, it } from 'vitest';
import { staffSignupSchema } from './auth.js';

const base = {
  fullName: 'Ada Staff',
  email: 'ada@example.com',
  mobile: '07123456789',
  password: 'password1',
  careHomeId: 'home-1',
};

describe('staffSignupSchema', () => {
  it('rejects an empty job role list', () => {
    const result = staffSignupSchema.safeParse({ ...base, jobRoleIds: [] });
    expect(result.success).toBe(false);
  });

  it('accepts multiple job roles and an optional primary', () => {
    const result = staffSignupSchema.parse({
      ...base,
      jobRoleIds: ['role-1', 'role-2'],
      primaryJobRoleId: 'role-2',
    });
    expect(result.jobRoleIds).toEqual(['role-1', 'role-2']);
    expect(result.primaryJobRoleId).toBe('role-2');
  });

  it('does not require a primary job role', () => {
    const result = staffSignupSchema.parse({
      ...base,
      jobRoleIds: ['role-1', 'role-2'],
    });
    expect(result.primaryJobRoleId).toBeUndefined();
  });
});
