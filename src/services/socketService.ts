import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { verifyAccessToken } from './tokenService.js';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import type { AuthUser } from '../types/index.js';

let io: Server | null = null;
const socketsByUser = new Map<string, Set<string>>();

export function initSocket(server: HttpServer) {
  io = new Server(server, {
    cors: {
      origin: env.isProd ? env.corsOrigins : true,
      credentials: true,
    },
    path: '/socket.io',
  });

  io.use((socket, next) => {
    const token = String(socket.handshake.auth?.token || socket.handshake.query?.token || '');
    try {
      socket.data.user = verifyAccessToken(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as AuthUser;
    const userId = user.id;
    socket.join(`user:${userId}`);
    addSocket(userId, socket.id);
    void markDeliveredForUser(userId);

    socket.on('disconnect', () => {
      removeSocket(userId, socket.id);
    });
  });
}

function addSocket(userId: string, socketId: string) {
  const set = socketsByUser.get(userId) ?? new Set<string>();
  set.add(socketId);
  socketsByUser.set(userId, set);
}

function removeSocket(userId: string, socketId: string) {
  const set = socketsByUser.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (!set.size) socketsByUser.delete(userId);
}

export function isUserOnline(userId: string) {
  return (socketsByUser.get(userId)?.size ?? 0) > 0;
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitToUsers(userIds: string[], event: string, payload: unknown) {
  for (const id of userIds) emitToUser(id, event, payload);
}

async function markDeliveredForUser(userId: string) {
  const conversations = await Conversation.find({ participantIds: userId }).select('_id createdBy');
  const ids = conversations.map((item) => item._id);
  if (!ids.length) return;
  const pending = await Message.find({
    conversationId: { $in: ids },
    senderId: { $ne: userId },
    deliveredTo: { $ne: new mongoose.Types.ObjectId(userId) },
  }).select('_id conversationId senderId');
  if (!pending.length) return;
  const messageIds = pending.map((item) => item._id);
  await Message.updateMany({ _id: { $in: messageIds } }, { $addToSet: { deliveredTo: userId } });
  const bySender = new Map<string, string[]>();
  for (const item of pending) {
    const sender = String(item.senderId);
    const list = bySender.get(sender) ?? [];
    list.push(String(item._id));
    bySender.set(sender, list);
  }
  for (const [senderId, idsForSender] of bySender) {
    emitToUser(senderId, 'chat:delivered', { userId, messageIds: idsForSender });
  }
}
