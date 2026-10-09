import config from "./config/config";
import { Server } from "http";
import app from "./app";
import logger from "./config/logger";
import connectDB from "./db/connect"; // Change to sequelize connection
import initSuperAdmin from "./config/superAdmin";
import { describePythonServices, checkPythonServices } from "./config/pythonServices";
import { recoverPipeline6Queue } from "./services/evaluation/pipeline6.service";
import { startSubscriptionScheduler } from "./services/subscription/subscriptionScheduler";
let server: Server;

const bootApp = () => {
  server = app.listen(config.port, async () => {
    logger.info(`Listening on port ${config.port}`);
    logger.info(describePythonServices());
    void checkPythonServices(); // logs reachability only; never blocks startup
    await initSuperAdmin();
    // Default plans, subscriptions for existing institutes, then hourly expiry checks and reminders.
    void startSubscriptionScheduler();
    // The AI evaluation queue is in memory: put evaluations left "Pending" by a restart back in line.
    void recoverPipeline6Queue();
  });
  // Set server timeouts to 1 hour to support slow CPU model processing
  server.timeout = 3600000;
  server.keepAliveTimeout = 3600000;
  server.headersTimeout = 3605000;
};

connectDB(bootApp);

const shutdown = (signal: string) => {
  logger.info(`${signal} received. Closing server...`);
  if (server) {
    if (typeof (server as any).closeAllConnections === "function") {
      (server as any).closeAllConnections();
    }
    server.close(() => {
      logger.info("Server closed successfully.");
      process.exit(0);
    });

    // Fallback: force exit after 1s if connections hang
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  } else {
    process.exit(0);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGUSR2", () => shutdown("SIGUSR2"));

const unexpectedErrorHandler = (error: unknown) => {
  if (error) {
    logger.error("Uncaught exception / rejection detected:");
    if (error instanceof Error) {
      logger.error(error.stack || error.message);
    } else {
      logger.error(String(error));
    }
  }
};

process.on("uncaughtException", unexpectedErrorHandler);
process.on("unhandledRejection", unexpectedErrorHandler);
