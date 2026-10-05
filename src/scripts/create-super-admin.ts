import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { User } from '../models/User.js';
import { SystemSettings } from '../models/SystemSettings.js';
import { DEFAULT_SETTINGS, ROLES } from '../config/constants.js';
import { hashSecret } from '../services/authService.js';
import { logger } from '../utils/logger.js';

const EMAIL = 'superadmin@gmail.com';
const PASSWORD = 'Pass@123#';
const NAME = 'Super Admin';

async function main() {
  await connectDatabase();
  const existingSettings = await SystemSettings.findOne({ key: 'global' });
  if (!existingSettings) {
    await SystemSettings.create({ key: 'global', ...DEFAULT_SETTINGS });
  }

  const passwordHash = await hashSecret(PASSWORD);
  const user = await User.findOneAndUpdate(
    { email: EMAIL },
    {
      $set: {
        name: NAME,
        email: EMAIL,
        passwordHash,
        role: ROLES.SUPER_ADMIN,
        status: 'ACTIVE',
        loginEnabled: true,
        failedLoginAttempts: 0,
        lockUntil: null,
        mustChangePassword: false,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  logger.info(`Super Admin ready: ${user.email} (${user.role})`);
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
