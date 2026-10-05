import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { DEFAULT_SETTINGS } from '../config/constants.js';

const settingsSchema = new Schema(
  {
    key: { type: String, default: 'global', unique: true },
    companyName: { type: String, default: DEFAULT_SETTINGS.companyName },
    appName: { type: String, default: DEFAULT_SETTINGS.appName },
    logoPath: { type: String },
    timezone: { type: String, default: DEFAULT_SETTINGS.timezone },
    dateFormat: { type: String, default: DEFAULT_SETTINGS.dateFormat },
    timeFormat: { type: String, default: DEFAULT_SETTINGS.timeFormat },
    weekStartsOn: { type: Number, default: DEFAULT_SETTINGS.weekStartsOn },
    emailLoginEnabled: { type: Boolean, default: DEFAULT_SETTINGS.emailLoginEnabled },
    mobileLoginEnabled: { type: Boolean, default: DEFAULT_SETTINGS.mobileLoginEnabled },
    passcodeLoginEnabled: { type: Boolean, default: DEFAULT_SETTINGS.passcodeLoginEnabled },
    passcodeLength: { type: Number, default: DEFAULT_SETTINGS.passcodeLength },
    requirePasscodeAfterFirstLogin: { type: Boolean, default: DEFAULT_SETTINGS.requirePasscodeAfterFirstLogin },
    defaultBreakDuration: { type: Number, default: DEFAULT_SETTINGS.defaultBreakDuration },
    allowOvernightShifts: { type: Boolean, default: DEFAULT_SETTINGS.allowOvernightShifts },
    requireRemarks: { type: Boolean, default: DEFAULT_SETTINGS.requireRemarks },
    requireInchargeName: { type: Boolean, default: DEFAULT_SETTINGS.requireInchargeName },
    requireAdminSignature: { type: Boolean, default: DEFAULT_SETTINGS.requireAdminSignature },
    requireSuperAdminSignature: { type: Boolean, default: DEFAULT_SETTINGS.requireSuperAdminSignature },
    sessionDurationMinutes: { type: Number, default: DEFAULT_SETTINGS.sessionDurationMinutes },
    maxLoginAttempts: { type: Number, default: DEFAULT_SETTINGS.maxLoginAttempts },
    lockoutDurationMinutes: { type: Number, default: DEFAULT_SETTINGS.lockoutDurationMinutes },
    passwordMinLength: { type: Number, default: DEFAULT_SETTINGS.passwordMinLength },
    passwordRequireUppercase: { type: Boolean, default: DEFAULT_SETTINGS.passwordRequireUppercase },
    passwordRequireNumber: { type: Boolean, default: DEFAULT_SETTINGS.passwordRequireNumber },
    passwordRequireSpecial: { type: Boolean, default: DEFAULT_SETTINGS.passwordRequireSpecial },
    staffSignupEnabled: { type: Boolean, default: DEFAULT_SETTINGS.staffSignupEnabled },
  },
  { timestamps: true },
);

export type SystemSettingsDocument = InferSchemaType<typeof settingsSchema> & { _id: mongoose.Types.ObjectId };
export const SystemSettings = mongoose.model('SystemSettings', settingsSchema);
