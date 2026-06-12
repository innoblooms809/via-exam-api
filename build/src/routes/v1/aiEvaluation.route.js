"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const aiEvaluation_controller_1 = __importDefault(require("../../controllers/aiEvaluation.controller"));
const auth_1 = require("../../middlewares/auth");
const router = (0, express_1.Router)();
// Trigger evaluation
router.post("/evaluate", auth_1.authenticate, aiEvaluation_controller_1.default.evaluateSheet);
// Get evaluation result by sheet ID
router.get("/sheet/:sheetId", auth_1.authenticate, aiEvaluation_controller_1.default.getEvaluation);
// List evaluations
router.get("/list", auth_1.authenticate, aiEvaluation_controller_1.default.getAllEvaluations);
exports.default = router;
