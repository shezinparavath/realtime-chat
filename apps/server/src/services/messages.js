'use strict';

const mongoose = require('mongoose');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const { AppError } = require('../errors');
const { validateMessageText, isObjectIdString } = require('../validation');
const { toChat, toMessage } = require('../serializers');

function dbReady() {
  return mongoose.connection.readyState === 1;
}

/**
 * Load a chat and assert `userId` is a participant.
 * Malformed id → VALIDATION_ERROR(field); not a participant → FORBIDDEN.
 * Missing chat → NOT_FOUND (REST) or FORBIDDEN when { missingAs: 'FORBIDDEN' } (socket, ruling P3-2).
 */
async function getChatForParticipant(chatId, userId, field = 'chatId', { missingAs = 'NOT_FOUND' } = {}) {
  if (!isObjectIdString(chatId)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid chat id', field);
  }
  const chat = await Chat.findById(chatId).lean();
  if (!chat) {
    throw missingAs === 'FORBIDDEN'
      ? new AppError('FORBIDDEN', 'You are not a participant of this chat')
      : new AppError('NOT_FOUND', 'Chat not found');
  }
  if (!chat.participants.some((p) => String(p) === String(userId))) {
    throw new AppError('FORBIDDEN', 'You are not a participant of this chat');
  }
  return chat;
}

/**
 * Validate + persist a message and bump the chat's lastMessage/updatedAt.
 * Order of checks (locked): malformed chatId (VALIDATION_ERROR) → missing chat / not a participant
 * (FORBIDDEN) → non-string text (VALIDATION_ERROR) → MESSAGE_EMPTY → MESSAGE_TOO_LONG.
 * Returns { message: Message, chat: Chat, participantIds: string[] }.
 */
async function sendMessage({ userId, chatId, text }) {
  if (!dbReady()) throw new AppError('SERVER_ERROR', 'Database unavailable');

  const chat = await getChatForParticipant(chatId, userId, 'chatId', { missingAs: 'FORBIDDEN' });
  validateMessageText(text);

  const createdAt = new Date();
  const doc = await Message.create({ chatId: chat._id, senderId: userId, text, createdAt });

  // Only move lastMessage forward (concurrent sends can't regress it).
  await Chat.updateOne(
    {
      _id: chat._id,
      $or: [{ lastMessage: null }, { 'lastMessage.createdAt': { $lte: createdAt } }],
    },
    {
      $set: {
        lastMessage: { _id: doc._id, senderId: doc.senderId, text: doc.text, createdAt },
        updatedAt: createdAt,
      },
    }
  );

  const fresh = await Chat.findById(chat._id).populate('participants', 'username').lean();
  return {
    message: toMessage(doc, chat._id),
    chat: toChat(fresh),
    participantIds: chat.participants.map(String),
  };
}

module.exports = { sendMessage, getChatForParticipant };
