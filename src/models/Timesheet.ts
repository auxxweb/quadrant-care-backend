import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { TIMESHEET_STATUS } from '../config/constants.js';

const snapshotSchema = new Schema(
  {
    name: { type: String, required: true },
    extra: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const timesheetSchema = new Schema(
  {
    timesheetId: { type: String, required: true, unique: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ownerRole: { type: String, enum: ['STAFF', 'ADMIN'], default: 'STAFF', index: true },
    employeeSnapshot: {
      name: { type: String, required: true },
      employeeId: { type: String, required: true },
      email: String,
      mobile: String,
    },
    careHomeId: { type: Schema.Types.ObjectId, ref: 'CareHome', required: true, index: true },
    careHomeSnapshot: snapshotSchema,
    jobRoleId: { type: Schema.Types.ObjectId, ref: 'JobRole', index: true },
    jobRoleSnapshot: snapshotSchema,
    date: { type: Date, required: true, index: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    breakDuration: { type: Number, required: true, min: 0 },
    totalMinutes: { type: Number, required: true, min: 0 },
    totalHoursDisplay: { type: String, required: true },
    inchargeName: { type: String, trim: true },
    careHomeSignaturePath: { type: String },
    remarks: { type: String, trim: true },
    status: {
      type: String,
      enum: Object.values(TIMESHEET_STATUS),
      default: TIMESHEET_STATUS.DRAFT,
      index: true,
    },
    submittedAt: { type: Date },
    adminReviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    adminReviewedAt: { type: Date },
    adminSignaturePath: { type: String },
    adminRemarks: { type: String, trim: true },
    superAdminApprovedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    superAdminApprovedAt: { type: Date },
    superAdminRemarks: { type: String, trim: true },
    superAdminSignaturePath: { type: String },
    rejectionReason: { type: String, trim: true },
    history: [
      {
        status: String,
        actorId: Schema.Types.ObjectId,
        actorName: String,
        note: String,
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

timesheetSchema.index({ employeeId: 1, date: 1 });
timesheetSchema.index({ status: 1, date: -1 });
timesheetSchema.index({ careHomeId: 1, date: -1 });
timesheetSchema.index({ jobRoleId: 1, date: -1 });
timesheetSchema.index({ 'employeeSnapshot.name': 'text', 'employeeSnapshot.employeeId': 'text' });

export type TimesheetDocument = InferSchemaType<typeof timesheetSchema> & { _id: mongoose.Types.ObjectId };
export const Timesheet = mongoose.model('Timesheet', timesheetSchema);
