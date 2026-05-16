"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const section_controller_1 = __importDefault(require("../../controllers/section.controller"));
const auth_1 = require("../../middlewares/auth");
const router = express_1.default.Router();
router.post("/createSection", auth_1.authenticate, 
//   authorize(["ADMIN"]),
section_controller_1.default.createSection);
router.get("/allSections", auth_1.authenticate, 
//   authorize(["ADMIN"]),
section_controller_1.default.getAllSections);
router.get("/getSection/:sectionId", auth_1.authenticate, 
//   authorize(["ADMIN"]),
section_controller_1.default.getSectionById);
router.patch("/updateSection/:sectionId", auth_1.authenticate, 
//   authorize(["ADMIN"]),
section_controller_1.default.updateSection);
router.delete("/deleteSection/:sectionId", auth_1.authenticate, 
//   authorize(["ADMIN"]),
section_controller_1.default.deleteSection);
exports.default = router;
