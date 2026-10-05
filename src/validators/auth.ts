import { z } from 'zod';

export const loginSchema = z.object({
  identifier: z.string().min(3, 'Enter your email or mobile number.'),
  password: z.string().min(1, 'Password is required.'),
});

export const passcodeLoginSchema = z.object({
  identifier: z.string().min(3, 'Enter your employee ID or mobile number.'),
  passcode: z.string().regex(/^\d{5}$/, 'Passcode must be 5 digits.'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(1, 'Password is required.'),
});

export const updateMeSchema = z.object({
  themePreference: z.enum(['light', 'dark', 'system']).optional(),
  currentPassword: z.string().optional(),
  password: z.string().min(1, 'Password is required.').optional(),
  currentPasscode: z.union([z.string().regex(/^\d{5}$/, 'Passcode must be 5 digits.'), z.literal('')]).optional(),
  passcode: z.union([z.string().regex(/^\d{5}$/, 'Passcode must be 5 digits.'), z.literal('')]).optional(),
  signature: z.string().optional(),
  clearSignature: z.boolean().optional(),
});

export const staffSignupSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.'),
  email: z.string().trim().email('Enter a valid email address.'),
  mobile: z.string().trim().min(8, 'Enter a valid mobile number.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  jobRoleId: z.string().min(1, 'Select your job role.'),
  careHomeId: z.string().min(1, 'Select your care home.'),
  joiningDate: z.string().optional(),
  passcode: z.string().regex(/^\d{5}$/, 'Passcode must be 5 digits.').optional(),
});

export const mobileSchema = z.string().trim().min(1, 'Mobile number is required.');

export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.string().optional(),
  careHomeId: z.string().optional(),
  jobRoleId: z.string().optional(),
  employeeId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  week: z.string().optional(),
  month: z.string().optional(),
});
