'use strict';

const mongoose = require('mongoose');
const { MAX_MESSAGE_LENGTH } = require('../constants');

const { Schema } = mongoose;

const messageSchema = new Schema({
  chatId: { type: Schema.Types.ObjectId, ref: 'Chat', required: true },
  senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  // Stored exactly as sent (no trim). Length is enforced before save too.
  text: { type: String, required: true, maxlength: MAX_MESSAGE_LENGTH },
  // Client-generated UUID for idempotent sends (rulings round 2 #1); null for legacy clients.
  clientId: { type: String, default: null },
  createdAt: { type: Date, default: () => new Date() },
});

// One message per (senderId, clientId) — only when clientId is a string.
messageSchema.index(
  { senderId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } }
);

// History pagination (ruling P3-11): sort { _id: -1 }, cursor _id < before.
messageSchema.index({ chatId: 1, _id: -1 });

module.exports = mongoose.models.Message || mongoose.model('Message', messageSchema);
