/**
 * Every module that defines a queue, a job processor or a schedule. Importing this file is
 * what makes them known to initQueues() / startQueueWorkers(): the API imports it on start,
 * and so does the worker process (src/worker.ts), which serves no routes of its own.
 */

import "./maintenance";
import "../services/evaluation/pipeline6.service";
import "../services/evaluation/evaluationMaintenance";
import "../services/notification/push.service";
import "../utils/mailHelper";
import "../services/answer-sheet/sheetQuality.service";
import "../services/subscription/subscriptionScheduler";
import "../services/partner/partnerWebhooks";
import "../services/security/dataProtectionMaintenance";
