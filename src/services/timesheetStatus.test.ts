import { describe, expect, it } from 'vitest';
import { isCreatedBy } from './timesheetStatus.js';

describe('isCreatedBy', () => {
  const adminId = '64b000000000000000000001';
  const otherId = '64b000000000000000000002';

  it('matches the actor of the first history entry', () => {
    const sheet = { history: [{ actorId: adminId }, { actorId: otherId }] };
    expect(isCreatedBy(sheet, adminId)).toBe(true);
    expect(isCreatedBy(sheet, otherId)).toBe(false);
  });

  it('compares ObjectId-like values by string', () => {
    const objectIdLike = { toString: () => adminId };
    expect(isCreatedBy({ history: [{ actorId: objectIdLike }] }, adminId)).toBe(true);
  });

  it('returns false when there is no history', () => {
    expect(isCreatedBy({ history: [] }, adminId)).toBe(false);
    expect(isCreatedBy({}, adminId)).toBe(false);
    expect(isCreatedBy({ history: [{}] }, adminId)).toBe(false);
  });
});
