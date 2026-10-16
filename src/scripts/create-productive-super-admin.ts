import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { User } from '../models/User.js';
import { SystemSettings } from '../models/SystemSettings.js';
import { DEFAULT_SETTINGS, ROLES } from '../config/constants.js';
import { hashSecret } from '../services/authService.js';
import { logger } from '../utils/logger.js';

const EMAIL = 'quadrantcare@gmail.com';
const PASSWORD = 'Pass@123#';
const PASSCODE = '12345';
const NAME = 'Super Admin';

async function main() {
  await connectDatabase();
  const existingSettings = await SystemSettings.findOne({ key: 'global' });
  if (!existingSettings) {
    await SystemSettings.create({ key: 'global', ...DEFAULT_SETTINGS });
  }

  const passwordHash = await hashSecret(PASSWORD);
  const passcodeHash = await hashSecret(PASSCODE);
  const user = await User.findOneAndUpdate(
    { email: EMAIL },
    {
      $set: {
        name: NAME,
        email: EMAIL,
        passwordHash,
        passcodeHash,
        role: ROLES.SUPER_ADMIN,
        status: 'ACTIVE',
        loginEnabled: true,
        failedLoginAttempts: 0,
        lockUntil: null,
        mustChangePassword: false,
        metricsFocus: 'PRODUCTIVE',
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  // Ensure the operational Super Admin keeps the worked-hours panel.
  await User.updateMany(
    { role: ROLES.SUPER_ADMIN, email: { $ne: EMAIL }, $or: [{ metricsFocus: { $exists: false } }, { metricsFocus: null }] },
    { $set: { metricsFocus: 'WORKED' } },
  );

  logger.info(`Productive Super Admin ready: ${user.email} (metricsFocus=${user.metricsFocus})`);
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
