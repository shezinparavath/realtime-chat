'use strict';

const mongoose = require('mongoose');
const { MAX_MESSAGE_LENGTH } = require('../constants');

const { Schema } = mongoose;

const messageSchema = new Schema({
  chatId: { type: Schema.Types.ObjectId, ref: 'Chat', required: true },
  senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  // Stored exactly as sent (no trim). Length is enforced before save too.
  text: { type: String, required: true, maxlength: MAX_MESSAGE_LENGTH },
  createdAt: { type: Date, default: () => new Date() },
});

// History pagination: newest-first within a chat, (createdAt, _id) tiebreak.
messageSchema.index({ chatId: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.models.Message || mongoose.model('Message', messageSchema);
