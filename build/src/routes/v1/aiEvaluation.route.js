"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const aiEvaluation_controller_1 = __importDefault(require("../../controllers/aiEvaluation.controller"));
const aiEvaluationNew_controller_1 = __importDefault(require("../../controllers/aiEvaluationNew.controller"));
const ocrnew5_controller_1 = __importDefault(require("../../controllers/ocrnew5.controller"));
const pipeline6_controller_1 = __importDefault(require("../../controllers/pipeline6.controller"));
const auth_1 = require("../../middlewares/auth");
const router = (0, express_1.Router)();
// Trigger evaluation (legacy — uses old port 8002 API)
router.post("/evaluate", auth_1.authenticate, aiEvaluation_controller_1.default.evaluateSheet);
// Trigger evaluation V2 (uses OCR pipeline on port 8003/8005)
router.post("/evaluate2", auth_1.authenticate, aiEvaluationNew_controller_1.default.evaluateSheet2);
// Trigger evaluation OCRNew5 (uses multi-agent pipeline on port 8006)
router.post("/evaluate-ocrnew5", auth_1.authenticate, ocrnew5_controller_1.default.evaluateSheetOCRNew5);
// Trigger evaluation Pipeline 6.3 (uses 9-agent pipeline with rubric pre-warming on port 8007)
router.post("/evaluate-pipeline6", auth_1.authenticate, pipeline6_controller_1.default.evaluateSheetPipeline6);
router.post("/evaluate6", auth_1.authenticate, pipeline6_controller_1.default.evaluateSheetPipeline6);
// Get evaluation result by sheet ID
router.get("/sheet/:sheetId", auth_1.authenticate, aiEvaluation_controller_1.default.getEvaluation);
// Update evaluation details/marks by sheet ID
router.put("/sheet/:sheetId", auth_1.authenticate, aiEvaluation_controller_1.default.updateEvaluation);
// List evaluations
router.get("/list", auth_1.authenticate, aiEvaluation_controller_1.default.getAllEvaluations);
exports.default = router;
