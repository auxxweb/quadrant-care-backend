import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { ROLES, USER_STATUS } from '../config/constants.js';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    mobile: { type: String, trim: true, unique: true, sparse: true },
    passwordHash: { type: String, required: true, select: false },
    passcodeHash: { type: String, select: false },
    role: { type: String, enum: Object.values(ROLES), required: true, index: true },
    status: { type: String, enum: Object.values(USER_STATUS), default: USER_STATUS.ACTIVE, index: true },
    employeeId: { type: String, unique: true, sparse: true, index: true },
    adminId: { type: String, unique: true, sparse: true, index: true },
    loginEnabled: { type: Boolean, default: true },
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    lastLogin: { type: Date },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    mustChangePassword: { type: Boolean, default: false },
    themePreference: { type: String, enum: ['light', 'dark', 'system'], default: 'light' },
    /**
     * SUPER_ADMIN view focus:
     * - WORKED: operational panel (actual logged hours)
     * - PRODUCTIVE: monitoring panel (auto-capped productive hours)
     * Same underlying timesheet records; UI emphasis differs only.
     */
    metricsFocus: { type: String, enum: ['WORKED', 'PRODUCTIVE'], default: 'WORKED', index: true },
    signaturePath: { type: String },
  },
  { timestamps: true },
);

userSchema.index({ role: 1, status: 1 });

userSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    const value = ret as Record<string, unknown>;
    value.id = String(value._id);
    delete value.passwordHash;
    delete value.passcodeHash;
    delete value.passwordResetToken;
    delete value.passwordResetExpires;
    delete value.__v;
    return value;
  },
});

export type UserDocument = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId };
export const User = mongoose.model('User', userSchema);
