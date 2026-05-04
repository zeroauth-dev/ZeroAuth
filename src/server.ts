import { createApp } from './app';
import { config } from './config';
import { logger } from './services/logger';
import { initBlockchain } from './services/blockchain';
import { initPoseidon } from './services/identity';
import { initZKP } from './services/zkp';
import { initDb, closeDb } from './services/db';

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
