import express from "express";
import SubjectController from "../../controllers/subject.controller";
import { authenticate, authorize } from "../../middlewares/auth";

const router = express.Router();

router.post(
  "/createSubject",
  authenticate,
//   authorize(["ADMIN"]),
  SubjectController.createSubject
);

router.get(
  "/getAllSubjects",
  authenticate,
//   authorize(["ADMIN"]),
  SubjectController.getAllSubjects
);

router.get(
  "/getSubjectById/:subjectId",
  authenticate,
//   authorize(["ADMIN"]),
  SubjectController.getSubjectById
);

router.patch(
  "/updateSubject/:subjectId",
  authenticate,
//   authorize(["ADMIN"]),
  SubjectController.updateSubject
);

router.delete(
  "/deleteSubject/:subjectId",
  authenticate,
//   authorize(["ADMIN"]),
  SubjectController.deleteSubject
);

export default router;