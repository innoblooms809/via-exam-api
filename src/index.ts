import { Server } from "http";
import app from "./app";
import config from "./config/config";
import logger from "./config/logger";
import connectDB from "./db/connect"; // Change to sequelize connection
import initSuperAdmin from "./config/superAdmin";
let server: Server;

const bootApp = () => {
  server = app.listen(config.port, async () => {
    logger.info(`Listening on port ${config.port}`);
    await initSuperAdmin();
  });
};

connectDB(bootApp);

const exitHandler = () => {
  if (server) {
    server.close(() => {
      logger.info("Server closed");
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
};

const unexpectedErrorHandler = (error: unknown) => {
  // console.error(JSON.stringify(error, null, 2));
  logger.error(error);
  exitHandler();
};

process.on("uncaughtException", unexpectedErrorHandler);
process.on("unhandledRejection", unexpectedErrorHandler);

process.on("SIGTERM", () => {
  logger.info("SIGTERM received");
  if (server) {
    server.close();
  }
});
