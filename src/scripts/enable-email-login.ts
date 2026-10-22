import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { SystemSettings } from '../models/SystemSettings.js';
import { DEFAULT_SETTINGS } from '../config/constants.js';
import { logger } from '../utils/logger.js';

async function main() {
  await connectDatabase();
  let settings = await SystemSettings.findOne({ key: 'global' });
  if (!settings) {
    settings = await SystemSettings.create({ key: 'global', ...DEFAULT_SETTINGS, emailLoginEnabled: true });
  } else {
    settings.emailLoginEnabled = true;
    await settings.save();
  }
  logger.info('Email login enabled', {
    emailLoginEnabled: settings.emailLoginEnabled,
    mobileLoginEnabled: settings.mobileLoginEnabled,
    passcodeLoginEnabled: settings.passcodeLoginEnabled,
  });
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await disconnectDatabase();
  } catch {
    // ignore
  }
  process.exit(1);
});
