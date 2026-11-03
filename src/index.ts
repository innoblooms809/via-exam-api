import config from "./config/config";
import { Server } from "http";
import app from "./app";
import logger from "./config/logger";
import connectDB from "./db/connect"; // Change to sequelize connection
import initSuperAdmin from "./config/superAdmin";
import { describePythonServices, checkPythonServices } from "./config/pythonServices";
import { startSubscriptionScheduler } from "./services/subscription/subscriptionScheduler";
import "./queue/jobs";
import { closeQueues, initQueues, startQueueWorkers } from "./queue";
import { queueConfig } from "./queue/config";
import { runMaintenanceTaskNow } from "./queue/maintenance";
import { describeDataKeys } from "./utils/dataProtection";
let server: Server;

// The data encryption key is needed before anything touches the database: stop here, clearly,
// rather than fail on the first encrypted column.
try {
  logger.info(`[DataProtection] ${describeDataKeys()}`);
} catch (err: any) {
  logger.error(err?.message || String(err));
  process.exit(1);
}

// Job queues (BullMQ on PostgreSQL) connect while the database is prepared; requests can add
// jobs as soon as the server listens. Falls back to in-process queues rather than not starting.
const queuesReady = initQueues().catch((err) => {
  logger.error(`[Queue] Queues unavailable: ${err?.message || err}`);
});

const bootApp = async () => {
  await queuesReady;
  server = app.listen(config.port, async () => {
    logger.info(`Listening on port ${config.port}`);
    logger.info(describePythonServices());
    void checkPythonServices(); // logs reachability only; never blocks startup
    await initSuperAdmin();
    // Default plans and subscriptions for existing institutes; expiry checks and reminders are scheduled jobs.
    void startSubscriptionScheduler();
    // OCR, AI evaluation, pushes, emails, scan checks and maintenance — unless QUEUE_WORKERS=false
    // (then `npm run worker` runs them).
    try {
      await startQueueWorkers();
      // Evaluations left "Pending" (by the previous version, or a crash) are queued again now,
      // not at the watchdog's next tick.
      void runMaintenanceTaskNow("evaluation-watchdog").catch(() => undefined);
      // Values still in plain text (rows from before encryption) or under a previous key are
      // encrypted now, in the background, not at tonight's run.
      void runMaintenanceTaskNow("encrypt-sensitive-data").catch(() => undefined);
    } catch (err: any) {
      logger.error(`[Queue] Workers could not start: ${err?.message || err}`);
    }
  });
  // Set server timeouts to 1 hour to support slow CPU model processing
  server.timeout = 3600000;
  server.keepAliveTimeout = 3600000;
  server.headersTimeout = 3605000;
};

connectDB(bootApp);

let stopping = false;
const shutdown = (signal: string) => {
  if (stopping) return;
  stopping = true;
  logger.info(`${signal} received. Closing server...`);
  // Running jobs get a short grace period; any still running are picked up again after restart.
  const force = setTimeout(() => process.exit(0), queueConfig.shutdownGraceMs + 2000);
  force.unref();
  if (server) {
    if (typeof (server as any).closeAllConnections === "function") {
      (server as any).closeAllConnections();
    }
    server.close(() => logger.info("Server closed successfully."));
  }
  closeQueues()
    .catch(() => undefined)
    .finally(() => process.exit(0));
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
