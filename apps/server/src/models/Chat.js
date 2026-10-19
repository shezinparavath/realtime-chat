'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * 1:1 chat. One document per unordered user pair (A-3):
 * participants are stored sorted and `pairKey` = "<smallerId>:<largerId>" has a
 * unique index, so concurrent POST /chats cannot create duplicates.
 *
 * `updatedAt` is managed by hand (NOT mongoose timestamps): it is the time of the
 * last message, or the creation time if there are none.
 */
const lastMessageSchema = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, required: true }, // message id
    senderId: { type: Schema.Types.ObjectId, required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, required: true },
  },
  { _id: false }
);

const chatSchema = new Schema({
  participants: {
    type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    validate: (v) => Array.isArray(v) && v.length === 2,
    required: true,
  },
  pairKey: { type: String, required: true },
  lastMessage: { type: lastMessageSchema, default: null },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
});

chatSchema.index({ pairKey: 1 }, { unique: true });
chatSchema.index({ participants: 1, updatedAt: -1 });

/** Deterministic sorted pair: returns { participants: [a, b], pairKey } */
function pairFor(userIdA, userIdB) {
  const ids = [String(userIdA), String(userIdB)].sort();
  return { participants: ids, pairKey: `${ids[0]}:${ids[1]}` };
}

const Chat = mongoose.models.Chat || mongoose.model('Chat', chatSchema);

module.exports = Chat;
module.exports.pairFor = pairFor;
