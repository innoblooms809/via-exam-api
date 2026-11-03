/**
 * Queue worker process — runs the jobs (OCR, AI evaluation, pushes, emails, scan-quality
 * checks) and the scheduled maintenance, and serves no HTTP.
 *
 * By default the API runs these itself. To keep long jobs off the API process, start the
 * API with QUEUE_WORKERS=false and run one (or more) of these beside it:
 *
 *   npm run worker            (ts-node)
 *   node build/src/worker.js  (after npm run build; pm2: ecosystem.config.json "worker")
 *
 * Several workers share the work; the evaluation stages keep their global limits
 * (EVAL_QUEUE_OCR_CONCURRENCY / EVAL_QUEUE_EVAL_CONCURRENCY) across all of them.
 */

import "./config/config";
import logger from "./config/logger";
import { sequelize } from "./config/sequelize";
import "./models/index";
import "./queue/jobs";
import { closeQueues, initQueues, startQueueWorkers } from "./queue";
import { queueConfig } from "./queue/config";
import { watchEvaluationProgress } from "./services/exam/examProgress";
import { describeDataKeys } from "./utils/dataProtection";
import { checkStoredKeys } from "./services/security/dataProtectionMaintenance";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The API adds new columns on start; a worker started first waits for them (up to 5 minutes). */
const waitForSchema = async () => {
  for (let i = 0; i < 30; i++) {
    const [rows] = await sequelize.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'viaexam_ai_evaluations' AND column_name = 'runCount'`
    );
    if ((rows as unknown[]).length) return;
    if (i === 0) logger.info("[Worker] Waiting for the API to bring the database schema up to date…");
    await sleep(10_000);
  }
  logger.warn("[Worker] The evaluation columns are still missing; starting anyway.");
};

const main = async () => {
  // Jobs read and write encrypted columns: the same key as the API, checked before any job runs.
  logger.info(`[Worker] ${describeDataKeys()}`);
  await sequelize.authenticate();
  await waitForSchema();
  await checkStoredKeys();
  // "100% evaluated" notifications follow each sheet that gets its marks — here too, since
  // evaluations finish in this process.
  watchEvaluationProgress();
  await initQueues({ driver: "postgres", allowFallback: false, workers: true });
  await startQueueWorkers({ force: true });
  logger.info(`[Worker] Queue worker ${process.pid} running.`);
};

let stopping = false;
const shutdown = (signal: string) => {
  if (stopping) return;
  stopping = true;
  logger.info(`[Worker] ${signal} received; finishing running jobs (up to ${queueConfig.shutdownGraceMs / 1000}s)…`);
  const force = setTimeout(() => process.exit(0), queueConfig.shutdownGraceMs + 5000);
  force.unref();
  closeQueues()
    .then(() => sequelize.close())
    .catch(() => undefined)
    .finally(() => process.exit(0));
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (err) => logger.error(`[Worker] Unhandled rejection: ${(err as any)?.stack || err}`));
process.on("uncaughtException", (err) => logger.error(`[Worker] Uncaught exception: ${err?.stack || err}`));

main().catch((err) => {
  logger.error(`[Worker] Could not start: ${err?.stack || err}`);
  process.exit(1);
});
