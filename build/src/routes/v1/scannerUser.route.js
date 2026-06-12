"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const scannerUser_controller_1 = __importDefault(require("../../controllers/scannerUser.controller"));
const auth_1 = require("../../middlewares/auth");
const router = (0, express_1.Router)();
// Configure multer for file uploads
const upload = (0, multer_1.default)({ dest: "uploads/" });
router.post("/create", auth_1.authenticate, upload.fields([{ name: "profilePhoto", maxCount: 1 }]), scannerUser_controller_1.default.createScanner);
router.get("/getAllScanners", auth_1.authenticate, scannerUser_controller_1.default.getAllScanners);
router.get("/getScanner/:userId", auth_1.authenticate, scannerUser_controller_1.default.getScannerById);
router.put("/updateScanner/:userId", auth_1.authenticate, upload.fields([{ name: "profilePhoto", maxCount: 1 }]), scannerUser_controller_1.default.updateScanner);
router.delete("/deleteScanner/:userId", auth_1.authenticate, scannerUser_controller_1.default.deleteScanner);
exports.default = router;
