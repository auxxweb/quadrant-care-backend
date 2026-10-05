import type { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { User } from '../models/User.js';
import { AppError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { emitToUsers, isUserOnline } from '../services/socketService.js';
import { notifyUsers } from '../services/notificationService.js';
import { ROLES } from '../config/constants.js';

type Participant = {
  userId: mongoose.Types.ObjectId;
  name: string;
  role: string;
  adminId?: string;
  employeeId?: string;
};

function asId(value: unknown) {
  return String(value);
}

function previewText(kind: string, body?: string, sticker?: string) {
  if (kind === 'STICKER' || sticker) return sticker || 'Sticker';
  return (body || '').slice(0, 120);
}

function participantFromUser(user: {
  _id: unknown;
  name: string;
  role: string;
  adminId?: string | null;
  employeeId?: string | null;
}): Participant {
  return {
    userId: user._id as mongoose.Types.ObjectId,
    name: user.name,
    role: user.role,
    adminId: user.adminId ?? undefined,
    employeeId: user.employeeId ?? undefined,
  };
}

function directKey(a: string, b: string) {
  return [a, b].sort().join(':');
}

function serializeMessage(message: InstanceType<typeof Message>, viewerId: string, otherCount = 1) {
  const others = Math.max(1, otherCount);
  const deliveredCount = (message.deliveredTo ?? []).filter((id) => asId(id) !== asId(message.senderId)).length;
  const readCount = (message.readBy ?? []).filter((item) => asId(item.userId) !== asId(message.senderId)).length;
  let ticks: 'sent' | 'delivered' | 'read' = 'sent';
  if (readCount >= others) ticks = 'read';
  else if (deliveredCount >= others) ticks = 'delivered';
  return {
    _id: String(message._id),
    conversationId: asId(message.conversationId),
    senderId: asId(message.senderId),
    senderName: message.senderName,
    senderRole: message.senderRole,
    kind: message.kind,
    body: message.body,
    sticker: message.sticker,
    createdAt: new Date((message as { createdAt?: Date }).createdAt ?? Date.now()).toISOString(),
    deliveredTo: (message.deliveredTo ?? []).map(asId),
    readBy: (message.readBy ?? []).map((item) => ({ userId: asId(item.userId), at: item.at })),
    mine: asId(message.senderId) === viewerId,
    ticks,
  };
}

function serializeConversation(
  conversation: InstanceType<typeof Conversation>,
  viewerId: string,
  unread = 0,
) {
  const others = (conversation.participants ?? []).filter((item) => asId(item.userId) !== viewerId);
  const other = conversation.type === 'DIRECT' ? others[0] : undefined;
  return {
    _id: String(conversation._id),
    type: conversation.type,
    title: conversation.title || (conversation.type === 'BROADCAST' ? 'Announcement' : other?.name || 'Chat'),
    createdBy: asId(conversation.createdBy),
    audience: conversation.audience,
    participants: (conversation.participants ?? []).map((item) => ({
      userId: asId(item.userId),
      name: item.name,
      role: item.role,
      adminId: item.adminId,
      employeeId: item.employeeId,
    })),
    other: other
      ? { userId: asId(other.userId), name: other.name, role: other.role }
      : undefined,
    lastMessageAt: conversation.lastMessageAt,
    lastMessageText: conversation.lastMessageText,
    lastSenderId: conversation.lastSenderId ? asId(conversation.lastSenderId) : undefined,
    unread,
    memberCount: conversation.participantIds?.length ?? 0,
  };
}

async function unreadMap(conversationIds: mongoose.Types.ObjectId[], viewerId: string) {
  if (!conversationIds.length) return new Map<string, number>();
  const rows = await Message.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
    {
      $match: {
        conversationId: { $in: conversationIds },
        senderId: { $ne: new mongoose.Types.ObjectId(viewerId) },
        'readBy.userId': { $ne: new mongoose.Types.ObjectId(viewerId) },
      },
    },
    { $group: { _id: '$conversationId', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

async function loadConversationForUser(req: Request) {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation) throw new NotFoundError('Chat not found.');
  if (!conversation.participantIds.some((id) => asId(id) === req.user!.id)) {
    throw new ForbiddenError('You are not in this chat.');
  }
  return conversation;
}

async function persistAndFanout(
  conversation: InstanceType<typeof Conversation>,
  sender: { id: string; name: string; role: string },
  payload: { body?: string; sticker?: string },
) {
  const others = Math.max(1, (conversation.participantIds?.length ?? 2) - 1);
  const kind = payload.sticker && !payload.body?.trim() ? 'STICKER' : 'TEXT';
  const deliveredTo = conversation.participantIds
    .map((id) => asId(id))
    .filter((id) => id !== sender.id && isUserOnline(id));
  const message = await Message.create({
    conversationId: conversation._id,
    senderId: sender.id,
    senderName: sender.name,
    senderRole: sender.role,
    kind,
    body: payload.body?.trim() || undefined,
    sticker: payload.sticker,
    deliveredTo,
    readBy: [{ userId: sender.id, at: new Date() }],
  });
  conversation.lastMessageAt = new Date();
  conversation.lastMessageText = previewText(kind, payload.body, payload.sticker);
  conversation.lastSenderId = new mongoose.Types.ObjectId(sender.id);
  await conversation.save();

  const memberIds = conversation.participantIds.map((id) => asId(id));
  for (const memberId of memberIds) {
    emitToUsers([memberId], 'chat:message', {
      conversation: serializeConversation(conversation, memberId),
      message: serializeMessage(message, memberId, others),
    });
  }

  const recipients = memberIds.filter((id) => id !== sender.id);
  await notifyUsers(
    recipients,
    conversation.type === 'BROADCAST' ? `Announcement from ${sender.name}` : sender.name,
    conversation.lastMessageText || 'New message',
    'CHAT_MESSAGE',
    String(conversation._id),
    'Conversation',
  );
  return message;
}

async function ensureDirectConversation(
  me: { _id: unknown; name: string; role: string; adminId?: string | null; employeeId?: string | null },
  other: { _id: unknown; name: string; role: string; adminId?: string | null; employeeId?: string | null },
) {
  const key = directKey(asId(me._id), asId(other._id));
  let conversation = await Conversation.findOne({ directKey: key });
  if (!conversation) {
    conversation = await Conversation.create({
      type: 'DIRECT',
      createdBy: me._id,
      participantIds: [me._id, other._id],
      participants: [participantFromUser(me), participantFromUser(other)],
      directKey: key,
      lastMessageAt: new Date(),
      lastMessageText: '',
    });
  }
  return conversation;
}

export async function chatDirectory(req: Request, res: Response, next: NextFunction) {
  try {
    const items = await User.find({
      _id: { $ne: req.user!.id },
      status: 'ACTIVE',
    })
      .sort({ role: 1, name: 1 })
      .select('name role adminId employeeId');
    res.json({
      items: items.map((user) => ({
        id: String(user._id),
        name: user.name,
        role: user.role,
        adminId: user.adminId,
        employeeId: user.employeeId,
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function listConversations(req: Request, res: Response, next: NextFunction) {
  try {
    const items = await Conversation.find({ participantIds: req.user!.id }).sort({ lastMessageAt: -1 }).limit(80);
    const counts = await unreadMap(items.map((item) => item._id), req.user!.id);
    res.json({
      items: items.map((item) => serializeConversation(item, req.user!.id, counts.get(String(item._id)) ?? 0)),
    });
  } catch (error) {
    next(error);
  }
}

export async function unreadCount(req: Request, res: Response, next: NextFunction) {
  try {
    const conversations = await Conversation.find({ participantIds: req.user!.id }).select('_id');
    const counts = await unreadMap(conversations.map((item) => item._id), req.user!.id);
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    res.json({ unread: total });
  } catch (error) {
    next(error);
  }
}

export async function openDirectChat(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.body.userId === req.user!.id) throw new AppError('You cannot message yourself.');
    const other = await User.findOne({ _id: req.body.userId, status: 'ACTIVE' });
    if (!other) throw new NotFoundError('User not found.');
    const me = await User.findById(req.user!.id);
    if (!me) throw new ForbiddenError();
    const existing = await Conversation.findOne({ directKey: directKey(req.user!.id, String(other._id)) });
    const conversation = await ensureDirectConversation(me, other);
    res.status(existing ? 200 : 201).json(serializeConversation(conversation, req.user!.id));
  } catch (error) {
    next(error);
  }
}

async function broadcastTargets(req: Request) {
  const allowed = req.user!.role === ROLES.SUPER_ADMIN ? [ROLES.STAFF, ROLES.ADMIN] : [ROLES.STAFF];
  const audience = req.body.audience as string;
  if (audience === 'ADMIN' || audience === 'ALL') {
    if (req.user!.role !== ROLES.SUPER_ADMIN) throw new ForbiddenError('Only Super Admin can message admins in bulk.');
  }
  if (audience === 'CUSTOM' || (Array.isArray(req.body.recipientIds) && req.body.recipientIds.length)) {
    const ids = (req.body.recipientIds as string[]).filter((id) => id !== req.user!.id);
    if (!ids.length) throw new AppError('Select at least one person.');
    return User.find({ _id: { $in: ids }, status: 'ACTIVE', role: { $in: allowed } });
  }
  if (audience === 'STAFF') return User.find({ role: ROLES.STAFF, status: 'ACTIVE' });
  if (audience === 'ADMIN') return User.find({ role: ROLES.ADMIN, status: 'ACTIVE' });
  if (audience === 'ALL') return User.find({ role: { $in: [ROLES.STAFF, ROLES.ADMIN] }, status: 'ACTIVE' });
  throw new AppError('Select who should receive this announcement.');
}

export async function createBroadcast(req: Request, res: Response, next: NextFunction) {
  try {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user!.role)) throw new ForbiddenError();
    const me = await User.findById(req.user!.id);
    if (!me) throw new ForbiddenError();
    const targets = await broadcastTargets(req);
    if (!targets.length) throw new AppError('No matching people to message.');
    const payload = { body: req.body.body as string | undefined, sticker: req.body.sticker as string | undefined };

    if (req.body.delivery === 'INDIVIDUAL') {
      const conversations = [];
      let lastMessage: InstanceType<typeof Message> | undefined;
      for (const target of targets) {
        const conversation = await ensureDirectConversation(me, target);
        lastMessage = await persistAndFanout(conversation, req.user!, payload);
        conversations.push(serializeConversation(conversation, req.user!.id));
      }
      res.status(201).json({
        delivery: 'INDIVIDUAL',
        count: conversations.length,
        conversation: conversations[0],
        conversations,
        message: lastMessage ? serializeMessage(lastMessage, req.user!.id, 1) : undefined,
      });
      return;
    }

    const conversation = await Conversation.create({
      type: 'BROADCAST',
      title: req.body.title?.trim() || 'Announcement',
      createdBy: me._id,
      audience: req.body.audience,
      participantIds: [me._id, ...targets.map((user) => user._id)],
      participants: [participantFromUser(me), ...targets.map(participantFromUser)],
      lastMessageAt: new Date(),
    });
    const message = await persistAndFanout(conversation, req.user!, payload);
    res.status(201).json({
      delivery: 'GROUP',
      count: targets.length,
      conversation: serializeConversation(conversation, req.user!.id),
      conversations: [serializeConversation(conversation, req.user!.id)],
      message: serializeMessage(message, req.user!.id, Math.max(1, targets.length)),
    });
  } catch (error) {
    next(error);
  }
}

export async function getMessages(req: Request, res: Response, next: NextFunction) {
  try {
    const conversation = await loadConversationForUser(req);
    const limit = Math.min(Number(req.query.limit ?? 50), 100);
    const before = req.query.before ? new Date(String(req.query.before)) : undefined;
    const filter: Record<string, unknown> = { conversationId: conversation._id };
    if (before && !Number.isNaN(before.getTime())) filter.createdAt = { $lt: before };
    const items = await Message.find(filter).sort({ createdAt: -1 }).limit(limit);
    const undelivered = items.filter(
      (item) => asId(item.senderId) !== req.user!.id && !(item.deliveredTo ?? []).some((id) => asId(id) === req.user!.id),
    );
    if (undelivered.length) {
      await Message.updateMany(
        { _id: { $in: undelivered.map((item) => item._id) } },
        { $addToSet: { deliveredTo: req.user!.id } },
      );
      emitToUsers(
        [...new Set(undelivered.map((item) => asId(item.senderId)))],
        'chat:delivered',
        { userId: req.user!.id, messageIds: undelivered.map((item) => String(item._id)) },
      );
    }
    res.json({
      conversation: serializeConversation(conversation, req.user!.id),
      items: items.reverse().map((item) => serializeMessage(item, req.user!.id, Math.max(1, (conversation.participantIds?.length ?? 2) - 1))),
    });
  } catch (error) {
    next(error);
  }
}

export async function sendMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const conversation = await loadConversationForUser(req);
    const message = await persistAndFanout(conversation, req.user!, {
      body: req.body.body,
      sticker: req.body.sticker,
    });
    res.status(201).json(serializeMessage(message, req.user!.id, Math.max(1, (conversation.participantIds?.length ?? 2) - 1)));
  } catch (error) {
    next(error);
  }
}

export async function markChatRead(req: Request, res: Response, next: NextFunction) {
  try {
    const conversation = await loadConversationForUser(req);
    const pending = await Message.find({
      conversationId: conversation._id,
      senderId: { $ne: req.user!.id },
      'readBy.userId': { $ne: req.user!.id },
    }).select('_id senderId');
    if (pending.length) {
      await Message.updateMany(
        { _id: { $in: pending.map((item) => item._id) } },
        { $addToSet: { readBy: { userId: req.user!.id, at: new Date() }, deliveredTo: req.user!.id } },
      );
      emitToUsers(
        [...new Set(pending.map((item) => asId(item.senderId)))],
        'chat:read',
        {
          conversationId: String(conversation._id),
          userId: req.user!.id,
          messageIds: pending.map((item) => String(item._id)),
        },
      );
    }
    res.json({ ok: true, read: pending.length });
  } catch (error) {
    next(error);
  }
}
