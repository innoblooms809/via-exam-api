"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const session_controller_1 = __importDefault(require("../../controllers/session.controller"));
const auth_1 = require("../../middlewares/auth");
const router = (0, express_1.Router)();
// ─── Admin only ───────────────────────────────────────────────────────────────
// POST /v1/sessions
// Body: { sessionName, startDate, endDate, isActive }
router.post("/createSession", auth_1.authenticate, 
//   authorize(["ADMIN"]),
session_controller_1.default.createSession);
// GET  /v1/sessions
// Query: ?isActive=true
router.get("/getAllSessions", auth_1.authenticate, 
//   authorize(["ADMIN", "TEACHER", "EXAMINER"]),
session_controller_1.default.getAllSessions);
// GET  /v1/sessions/active
// Returns current active session
router.get("/active", 
//   authenticate,
//   authorize(["ADMIN", "TEACHER", "EXAMINER", "STUDENT"]),
session_controller_1.default.getActiveSession);
// GET  /v1/sessions/:sessionId
router.get("/getOneSession/:sessionId", auth_1.authenticate, 
//   authorize(["ADMIN", "TEACHER", "EXAMINER"]),
session_controller_1.default.getSessionById);
// PATCH /v1/sessions/:sessionId/activate
// Makes this session active, deactivates all others
router.patch("/:sessionId/activate", auth_1.authenticate, 
//   authorize(["ADMIN"]),
session_controller_1.default.activateSession);
// PUT /v1/sessions/:sessionId
router.put("/updateSession/:sessionId", auth_1.authenticate, 
//   authorize(["ADMIN"]),
session_controller_1.default.updateSession);
// DELETE /v1/sessions/:sessionId
// Cannot delete active session
router.delete("/deleteSession/:sessionId", auth_1.authenticate, 
//   authorize(["ADMIN"]),
session_controller_1.default.deleteSession);
exports.default = router;
