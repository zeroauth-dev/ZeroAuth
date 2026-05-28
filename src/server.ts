import { createApp } from './app';
import { config } from './config';
import { logger } from './services/logger';
import { initBlockchain } from './services/blockchain';
import { initPoseidon } from './services/identity';
import { initZKP } from './services/zkp';
import { initDb, closeDb } from './services/db';
import { initRateLimitCleanup, stopRateLimitCleanup } from './middleware/rate-limit';

async function main() {
  logger.info('ZeroAuth: Initializing subsystems...');

  // Initialize Poseidon hash (for identity generation)
  try {
    await initPoseidon();
  } catch (err) {
    logger.warn('Poseidon init failed — identity registration will be unavailable', {
      error: (err as Error).message,
    });
  }

  // Initialize ZKP verification engine
  try {
    await initZKP();
  } catch (err) {
    logger.warn('ZKP init failed — proof verification will use fallback mode', {
      error: (err as Error).message,
    });
  }

  // Connect to blockchain
  try {
    await initBlockchain();
  } catch (err) {
    logger.warn('Blockchain init failed — on-chain features will be unavailable', {
      error: (err as Error).message,
    });
  }

  // Connect to PostgreSQL
  try {
    await initDb();
  } catch (err) {
    logger.warn('PostgreSQL init failed — leads will not be persisted', {
      error: (err as Error).message,
    });
  }

  // C-026: kick off the periodic GC of expired rate-limit buckets so
  // `rate_limit_buckets` doesn't grow unbounded. setInterval is
  // unref'd so it doesn't keep the process alive past graceful
  // shutdown.
  initRateLimitCleanup();

  // C-025 / audit finding C-9: hydrate the session cache from the
  // `user_sessions` Postgres table so a process restart no longer
  // wipes signed-in users. Write-through writes from create()/delete()
  // keep the table in sync; an hourly cleanup interval prunes
  // expired rows.
  try {
    const { sessionStore } = await import('./services/session-store');
    await sessionStore.init();
  } catch (err) {
    logger.warn('SessionStore init failed — sessions will be in-memory only', {
      error: (err as Error).message,
    });
  }

  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info(`ZeroAuth server listening on port ${config.port}`, {
      env: config.nodeEnv,
      apiBaseUrl: config.apiBaseUrl,
      corsOrigins: config.corsOrigins,
      trustProxy: config.trustProxy,
    });
    logger.info('Zero biometric data stored. Ever. Breach-proof by architecture.');
  });

  // Graceful shutdown
  async function shutdown(signal: string) {
    logger.info(`${signal} received. Shutting down gracefully...`);
    stopRateLimitCleanup();
    await closeDb();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Fatal startup error', { error: (err as Error).message });
  process.exit(1);
});
