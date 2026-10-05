import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const participantSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    role: { type: String, required: true },
    adminId: String,
    employeeId: String,
  },
  { _id: false },
);

const conversationSchema = new Schema(
  {
    type: { type: String, enum: ['DIRECT', 'BROADCAST'], required: true, index: true },
    title: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    participantIds: [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
    participants: [participantSchema],
    audience: { type: String, enum: ['STAFF', 'ADMIN', 'ALL', 'CUSTOM'] },
    directKey: { type: String, unique: true, sparse: true },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessageText: { type: String, default: '' },
    lastSenderId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

conversationSchema.index({ participantIds: 1, lastMessageAt: -1 });

export type ConversationDocument = InferSchemaType<typeof conversationSchema> & { _id: mongoose.Types.ObjectId };
export const Conversation = mongoose.model('Conversation', conversationSchema);
