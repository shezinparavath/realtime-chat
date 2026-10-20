'use strict';

require('dotenv').config();

const { loadConfig, assertProductionConfig, assertValidConfig } = require('./config');
const { connectMongo, disconnectMongo } = require('./db');
const { createApp } = require('./app');

async function main() {
  const config = loadConfig();

  if (!config.jwtSecret) {
    console.warn(
      '[config] JWT_SECRET is unset — /auth/* and data routes will answer 500 SERVER_ERROR and all sockets are refused'
    );
  }

  // Fails fast (before connecting to Mongo) if NODE_ENV=production and no CLIENT_ORIGINS.
  assertProductionConfig(config);
  assertValidConfig(config);
  console.log(
    `[config] client IP: trust proxy hops=${config.trustProxyHops} (${config.clientIpSource.trustProxyHops}), ` +
      `header=${config.clientIpHeader || '(none, req.ip)'} (${config.clientIpSource.clientIpHeader})`
  );

  await connectMongo(config.mongodbUri);

  const { httpServer, io } = createApp(config);

  httpServer.listen(config.port, () => {
    console.log(`[server] listening on port ${config.port}`);
    console.log(
      `[server] CORS origins: ${
        config.clientOrigins.length ? config.clientOrigins.join(', ') : '(reflect request origin)'
      }`
    );
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received — shutting down`);

    const forceTimer = setTimeout(() => {
      console.error('[server] forced exit after timeout');
      process.exit(1);
    }, 10_000);
    forceTimer.unref();

    try {
      io.close();
      await new Promise((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      await disconnectMongo();
      console.log('[server] shutdown complete');
      process.exit(0);
    } catch (err) {
      console.error('[server] shutdown error:', err);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
