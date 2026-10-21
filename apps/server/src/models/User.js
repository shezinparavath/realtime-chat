'use strict';

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    username: { type: String, required: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    // RTC-N2-01: Expo push tokens, oldest first, max PUSH_TOKENS_MAX (5). Additive, no migration.
    // Never serialized (toPublic/toSelf don't include it).
    pushTokens: { type: [String], default: undefined },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ username: 1 }, { unique: true });
// POST /me/push-token removes the token from any other user holding it.
userSchema.index({ pushTokens: 1 });

/** Public User: { id, username } */
userSchema.methods.toPublic = function toPublic() {
  return { id: String(this._id), username: this.username };
};

/** Self User (only in /auth/*): { id, email, username } */
userSchema.methods.toSelf = function toSelf() {
  return { id: String(this._id), email: this.email, username: this.username };
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
