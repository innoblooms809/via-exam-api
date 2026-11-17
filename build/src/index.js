"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("./config/config"));
const app_1 = __importDefault(require("./app"));
const logger_1 = __importDefault(require("./config/logger"));
const connect_1 = __importDefault(require("./db/connect")); // Change to sequelize connection
const superAdmin_1 = __importDefault(require("./config/superAdmin"));
const pythonServices_1 = require("./config/pythonServices");
const subscriptionScheduler_1 = require("./services/subscription/subscriptionScheduler");
require("./queue/jobs");
const queue_1 = require("./queue");
const config_2 = require("./queue/config");
const maintenance_1 = require("./queue/maintenance");
const dataProtection_1 = require("./utils/dataProtection");
const pipeline6_service_1 = require("./services/evaluation/pipeline6.service");
let server;
// The data encryption key is needed before anything touches the database: stop here, clearly,
// rather than fail on the first encrypted column.
try {
    logger_1.default.info(`[DataProtection] ${(0, dataProtection_1.describeDataKeys)()}`);
}
catch (err) {
    logger_1.default.error((err === null || err === void 0 ? void 0 : err.message) || String(err));
    process.exit(1);
}
// Job queues (BullMQ on PostgreSQL) connect while the database is prepared; requests can add
// jobs as soon as the server listens. Falls back to in-process queues rather than not starting.
const queuesReady = (0, queue_1.initQueues)().catch((err) => {
    logger_1.default.error(`[Queue] Queues unavailable: ${(err === null || err === void 0 ? void 0 : err.message) || err}`);
});
const bootApp = () => __awaiter(void 0, void 0, void 0, function* () {
    yield queuesReady;
    server = app_1.default.listen(config_1.default.port, () => __awaiter(void 0, void 0, void 0, function* () {
        logger_1.default.info(`Listening on port ${config_1.default.port}`);
        logger_1.default.info((0, pythonServices_1.describePythonServices)());
        void (0, pythonServices_1.checkPythonServices)(); // logs reachability only; never blocks startup
        yield (0, superAdmin_1.default)();
        // Default plans and subscriptions for existing institutes; expiry checks and reminders are scheduled jobs.
        void (0, subscriptionScheduler_1.startSubscriptionScheduler)();
        // OCR, AI evaluation, pushes, emails, scan checks and maintenance — unless QUEUE_WORKERS=false
        // (then `npm run worker` runs them).
        try {
            yield (0, queue_1.startQueueWorkers)();
            // Warns when another API process runs a job queue on this database that this one can't see.
            (0, pipeline6_service_1.startEvaluationQueueMonitor)();
            // Evaluations left "Pending" (by the previous version, or a crash) are queued again now,
            // not at the watchdog's next tick.
            void (0, maintenance_1.runMaintenanceTaskNow)("evaluation-watchdog").catch(() => undefined);
            // Values still in plain text (rows from before encryption) or under a previous key are
            // encrypted now, in the background, not at tonight's run.
            void (0, maintenance_1.runMaintenanceTaskNow)("encrypt-sensitive-data").catch(() => undefined);
        }
        catch (err) {
            logger_1.default.error(`[Queue] Workers could not start: ${(err === null || err === void 0 ? void 0 : err.message) || err}`);
        }
    }));
    // Set server timeouts to 1 hour to support slow CPU model processing
    server.timeout = 3600000;
    server.keepAliveTimeout = 3600000;
    server.headersTimeout = 3605000;
});
(0, connect_1.default)(bootApp);
let stopping = false;
const shutdown = (signal) => {
    if (stopping)
        return;
    stopping = true;
    logger_1.default.info(`${signal} received. Closing server...`);
    // Running jobs get a short grace period; any still running are picked up again after restart.
    const force = setTimeout(() => process.exit(0), config_2.queueConfig.shutdownGraceMs + 2000);
    force.unref();
    if (server) {
        if (typeof server.closeAllConnections === "function") {
            server.closeAllConnections();
        }
        server.close(() => logger_1.default.info("Server closed successfully."));
    }
    (0, queue_1.closeQueues)()
        .catch(() => undefined)
        .finally(() => process.exit(0));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGUSR2", () => shutdown("SIGUSR2"));
const unexpectedErrorHandler = (error) => {
    if (error) {
        logger_1.default.error("Uncaught exception / rejection detected:");
        if (error instanceof Error) {
            logger_1.default.error(error.stack || error.message);
        }
        else {
            logger_1.default.error(String(error));
        }
    }
};
process.on("uncaughtException", unexpectedErrorHandler);
process.on("unhandledRejection", unexpectedErrorHandler);
