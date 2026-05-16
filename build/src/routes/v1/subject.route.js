"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const subject_controller_1 = __importDefault(require("../../controllers/subject.controller"));
const auth_1 = require("../../middlewares/auth");
const router = express_1.default.Router();
router.post("/createSubject", auth_1.authenticate, 
//   authorize(["ADMIN"]),
subject_controller_1.default.createSubject);
router.get("/getAllSubjects", auth_1.authenticate, 
//   authorize(["ADMIN"]),
subject_controller_1.default.getAllSubjects);
router.get("/getSubjectById/:subjectId", auth_1.authenticate, 
//   authorize(["ADMIN"]),
subject_controller_1.default.getSubjectById);
router.patch("/updateSubject/:subjectId", auth_1.authenticate, 
//   authorize(["ADMIN"]),
subject_controller_1.default.updateSubject);
router.delete("/deleteSubject/:subjectId", auth_1.authenticate, 
//   authorize(["ADMIN"]),
subject_controller_1.default.deleteSubject);
exports.default = router;
