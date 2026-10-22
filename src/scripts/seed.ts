import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { User } from '../models/User.js';
import { Employee } from '../models/Employee.js';
import { CareHome } from '../models/CareHome.js';
import { JobRole } from '../models/JobRole.js';
import { SystemSettings } from '../models/SystemSettings.js';
import { Counter } from '../models/Counter.js';
import { DEFAULT_SETTINGS, ROLES } from '../config/constants.js';
import { hashSecret } from '../services/authService.js';
import { logger } from '../utils/logger.js';

async function seed() {
  await connectDatabase();

  await Promise.all([
    User.deleteMany({}),
    Employee.deleteMany({}),
    CareHome.deleteMany({}),
    JobRole.deleteMany({}),
    SystemSettings.deleteMany({}),
    Counter.deleteMany({}),
  ]);

  await SystemSettings.create({ key: 'global', ...DEFAULT_SETTINGS });

  await Counter.create([
    { _id: 'employee', seq: 1 },
    { _id: 'admin', seq: 1 },
    { _id: 'timesheet-2026', seq: 0 },
  ]);

  const passwordHash = await hashSecret('ChangeMeImmediately123!');
  const passcodeHash = await hashSecret('12345');

  await User.create({
    name: 'System Administrator',
    email: 'admin@quadrantcare.local',
    mobile: '07111111111',
    passwordHash,
    passcodeHash,
    role: ROLES.SUPER_ADMIN,
    status: 'ACTIVE',
    loginEnabled: true,
  });

  const admin = await User.create({
    name: 'Admin User',
    email: 'manager@quadrantcare.local',
    mobile: '07222222222',
    passwordHash,
    passcodeHash,
    role: ROLES.ADMIN,
    status: 'ACTIVE',
    adminId: 'QC-ADM-0001',
    loginEnabled: true,
  });

  const chadwick = await CareHome.create({
    name: 'Chadwick',
    address: '12 Chadwick Lane',
    city: 'Manchester',
    postcode: 'M1 1AA',
    contactPerson: 'Ward Manager',
    contactNumber: '01610000001',
    email: 'chadwick@quadrantcare.local',
    notes: 'Demo care home',
    status: 'ACTIVE',
  });

  await CareHome.create({
    name: 'Greenfield Care Home',
    address: '88 Greenfield Road',
    city: 'Leeds',
    postcode: 'LS1 2AB',
    contactPerson: 'Home Manager',
    contactNumber: '01130000002',
    email: 'greenfield@quadrantcare.local',
    status: 'ACTIVE',
  });

  const hca = await JobRole.create({ name: 'HCA', description: 'Health Care Assistant', status: 'ACTIVE' });
  await JobRole.create({ name: 'Senior HCA', description: 'Senior Health Care Assistant', status: 'ACTIVE' });
  await JobRole.create({ name: 'Support Worker', description: 'Support Worker', status: 'ACTIVE' });

  const staffUser = await User.create({
    name: 'Boney Jose',
    email: 'boney@quadrantcare.local',
    mobile: '07333333333',
    passwordHash,
    passcodeHash,
    role: ROLES.STAFF,
    status: 'ACTIVE',
    employeeId: 'QC-EMP-0001',
    loginEnabled: true,
  });

  await Employee.create({
    employeeId: 'QC-EMP-0001',
    userId: staffUser._id,
    fullName: 'Boney Jose',
    email: 'boney@quadrantcare.local',
    mobile: '07333333333',
    jobRoleIds: [hca._id],
    primaryJobRoleId: hca._id,
    careHomeId: chadwick._id,
    joiningDate: new Date('2024-01-15'),
    status: 'ACTIVE',
    loginEnabled: true,
  });

  logger.info('Seed complete. Demo accounts (not for production):');
  logger.info('Super Admin  admin@quadrantcare.local / ChangeMeImmediately123!');
  logger.info(`Admin        ${admin.email} / ChangeMeImmediately123!`);
  logger.info('Staff        boney@quadrantcare.local / ChangeMeImmediately123!  passcode 12345');

  await disconnectDatabase();
}

seed().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
