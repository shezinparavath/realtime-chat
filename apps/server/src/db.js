'use strict';

const mongoose = require('mongoose');

/** @type {'not_configured' | 'connecting' | 'connected' | 'disconnected'} */
let status = 'not_configured';

function getDbStatus() {
  if (status === 'connecting') {
    // Reflect live mongoose state if we started a connect
    const ready = mongoose.connection.readyState;
    if (ready === 1) return 'connected';
    if (ready === 0) return 'disconnected';
    return 'connecting';
  }
  if (status === 'connected' && mongoose.connection.readyState !== 1) {
    return 'disconnected';
  }
  return status;
}

/**
 * Connect when MONGODB_URI is set. Never throws to the caller —
 * failures are logged and reflected in /health as disconnected.
 */
async function connectMongo(uri) {
  if (!uri) {
    status = 'not_configured';
    return;
  }

  status = 'connecting';
  try {
    mongoose.connection.on('connected', () => {
      status = 'connected';
    });
    mongoose.connection.on('disconnected', () => {
      if (status !== 'not_configured') status = 'disconnected';
    });
    mongoose.connection.on('error', (err) => {
      console.error('[db] mongoose error:', err.message);
      status = 'disconnected';
    });

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    status = 'connected';
    console.log('[db] MongoDB connected');
  } catch (err) {
    status = 'disconnected';
    console.error('[db] MongoDB connection failed:', err.message);
  }
}

async function disconnectMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (status !== 'not_configured') status = 'disconnected';
}

module.exports = { connectMongo, disconnectMongo, getDbStatus };
