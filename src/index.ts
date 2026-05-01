import { Server } from 'http';
import app from './app';

import config from './config/config';
import logger from './config/logger';
import connectDB from './db/connect'; // Change to sequelize connection
let server: Server;

const bootApp = () => {
  server = app.listen(config.port, () => {
    logger.info(`Listening on port ${config.port}`);
  });
};

connectDB(bootApp);

const exitHandler = () => {
  if (server) {
    server.close(() => {
      logger.info('Server closed');
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
};

const unexpectedErrorHandler = (error: unknown) => {
  logger.error(error);
  exitHandler();
};

process.on('uncaughtException', unexpectedErrorHandler);
process.on('unhandledRejection', unexpectedErrorHandler);

process.on('SIGTERM', () => {
  logger.info('SIGTERM received');
  if (server) {
    server.close();
  }
});
