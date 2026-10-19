'use strict';

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    username: { type: String, required: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ username: 1 }, { unique: true });

/** Public User: { id, username } */
userSchema.methods.toPublic = function toPublic() {
  return { id: String(this._id), username: this.username };
};

/** Self User (only in /auth/*): { id, email, username } */
userSchema.methods.toSelf = function toSelf() {
  return { id: String(this._id), email: this.email, username: this.username };
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
