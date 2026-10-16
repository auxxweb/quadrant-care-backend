export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'STAFF';
export type EntityStatus = 'ACTIVE' | 'INACTIVE';

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  email?: string;
  employeeId?: string;
  adminId?: string;
  metricsFocus?: 'WORKED' | 'PRODUCTIVE';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

export {};
