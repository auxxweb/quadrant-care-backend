import { z } from 'zod';

export const createEmployeeSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  mobile: z.string().trim().min(1, 'Mobile number is required.'),
  password: z.string().min(1, 'Password is required.'),
  dateOfBirth: z.string().optional(),
  address: z.string().optional(),
  jobRoleIds: z.array(z.string().min(1)).min(1, 'Select at least one job role.'),
  primaryJobRoleId: z.string().min(1).optional(),
  careHomeId: z.string().optional(),
  joiningDate: z.string().min(1),
  loginEnabled: z.boolean().optional(),
  passcode: z.string().regex(/^\d{5}$/).optional(),
  profilePhoto: z.string().optional(),
});

export const updateEmployeeSchema = createEmployeeSchema.partial().omit({ password: true, passcode: true }).extend({
  password: z.string().min(1, 'Password is required.').optional(),
  passcode: z.string().regex(/^\d{5}$/).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export const statusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

export const createAdminSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  mobile: z.string().trim().min(1, 'Mobile number is required.'),
  password: z.string().min(1, 'Password is required.'),
  passcode: z.string().regex(/^\d{5}$/).optional(),
  loginEnabled: z.boolean().optional(),
});

export const updateAdminSchema = createAdminSchema.partial().extend({
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export const careHomeSchema = z.object({
  name: z.string().min(2),
  address: z.string().min(2),
  city: z.string().min(2),
  postcode: z.string().min(3),
  contactPerson: z.string().optional(),
  contactNumber: z.string().optional(),
  email: z.union([z.string().email('Enter a valid email address.'), z.literal('')]).optional(),
  notes: z.string().optional(),
});

export const jobRoleSchema = z.object({
  name: z.string().trim().min(2, 'Role name must be at least 2 characters.'),
  description: z.string().optional(),
});

export const timesheetSchema = z.object({
  date: z.string().min(1),
  startTime: z.string().regex(/^([01]?\d|2[0-3]):([0-5]\d)$/),
  endTime: z.string().regex(/^([01]?\d|2[0-3]):([0-5]\d)$/),
  breakDuration: z.coerce.number().min(0),
  jobRoleId: z.string().optional(),
  careHomeId: z.string().min(1, 'Select a care home.'),
  inchargeName: z.string().optional(),
  careHomeSignature: z.string().min(20, 'Care home admin signature is required.').optional(),
  remarks: z.string().optional(),
  submit: z.boolean().optional(),
});

export const managerEditTimesheetSchema = z.object({
  startTime: z.string().regex(/^([01]?\d|2[0-3]):([0-5]\d)$/).optional(),
  endTime: z.string().regex(/^([01]?\d|2[0-3]):([0-5]\d)$/).optional(),
  breakDuration: z.coerce.number().min(0).optional(),
}).refine((value) => value.startTime !== undefined || value.endTime !== undefined || value.breakDuration !== undefined, {
  message: 'Update start time, end time, or break duration.',
});

export const rejectSchema = z.object({
  reason: z.string().min(3, 'A rejection reason is required.'),
});

export const verifySchema = z.object({
  remarks: z.string().optional(),
  signature: z.string().min(20, 'A signature is required.').optional(),
  useSavedSignature: z.boolean().optional(),
});

export const approveSchema = z.object({
  remarks: z.string().optional(),
  signature: z.string().optional(),
});
