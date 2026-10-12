import express from "express";
import SubjectController from "../../../controllers/academic/subject.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { ADMINS, MEMBERS } from "../../../config/roles";

const router = express.Router();

router.post("/createSubject", authenticate, authorize(ADMINS), SubjectController.createSubject);
router.get("/getAllSubjects", authenticate, authorize(MEMBERS), SubjectController.getAllSubjects);
router.get("/getSubjectById/:subjectId", authenticate, authorize(MEMBERS), SubjectController.getSubjectById);
router.patch("/updateSubject/:subjectId", authenticate, authorize(ADMINS), SubjectController.updateSubject);
router.delete("/deleteSubject/:subjectId", authenticate, authorize(ADMINS), SubjectController.deleteSubject);

export default router;
