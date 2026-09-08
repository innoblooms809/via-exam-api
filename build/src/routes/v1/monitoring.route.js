"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../../middlewares/auth");
const monitoringController = __importStar(require("../../controllers/monitoring.controller"));
const router = express_1.default.Router();
// ── Heartbeat Endpoint (Open to all authenticated active sessions) ───────────
router.post("/heartbeat", auth_1.authenticate, monitoringController.recordHeartbeat);
// ── Cleanup Stale Sessions (Admin only - runs periodically) ───────────────────
router.post("/cleanup", auth_1.authenticate, (0, auth_1.authorize)(["SUPER_ADMIN", "ADMIN"]), monitoringController.cleanupStaleSessions);
// ── Platform-Wide Monitoring (Super Admin ONLY — Global across all institutes) ──
router.get("/platform/overview", auth_1.authenticate, (0, auth_1.authorize)(["SUPER_ADMIN"]), monitoringController.getPlatformOverview);
router.get("/platform/users", auth_1.authenticate, (0, auth_1.authorize)(["SUPER_ADMIN"]), monitoringController.getPlatformUsers);
// ── Institute-Scoped Monitoring (Admin & SuperAdmin — scoped to requester's institute) ──
router.get("/overview", auth_1.authenticate, (0, auth_1.authorize)(["SUPER_ADMIN", "ADMIN"]), auth_1.verifyTenant, monitoringController.getMonitoringOverview);
router.get("/users", auth_1.authenticate, (0, auth_1.authorize)(["SUPER_ADMIN", "ADMIN"]), auth_1.verifyTenant, monitoringController.getMonitoredUsers);
router.get("/users/:userId", auth_1.authenticate, (0, auth_1.authorize)(["SUPER_ADMIN", "ADMIN"]), auth_1.verifyTenant, monitoringController.getUserDetailsAndTimeline);
router.get("/activity", auth_1.authenticate, (0, auth_1.authorize)(["SUPER_ADMIN", "ADMIN"]), auth_1.verifyTenant, monitoringController.getActivityLogs);
exports.default = router;
