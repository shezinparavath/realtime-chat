'use strict';

/** User: { id, username } */
function toUser(doc) {
  if (!doc) return null;
  return { id: String(doc._id), username: doc.username };
}

/** Message: { id, chatId, senderId, text, createdAt (ISO) } */
function toMessage(doc, chatId) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    chatId: String(chatId || doc.chatId),
    senderId: String(doc.senderId),
    text: doc.text,
    createdAt: new Date(doc.createdAt).toISOString(),
  };
}

/**
 * Chat: { id, participants: [User, User], lastMessage: Message | null, updatedAt (ISO) }
 * Expects `participants` populated with { _id, username }. Participants are in
 * stored (sorted-by-id) order.
 */
function toChat(doc) {
  return {
    id: String(doc._id),
    participants: doc.participants.map(toUser),
    lastMessage: doc.lastMessage ? toMessage(doc.lastMessage, doc._id) : null,
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

module.exports = { toUser, toMessage, toChat };
