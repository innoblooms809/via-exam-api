import { Router } from "express";
import Controller from "../../../controllers/student/student.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { studentUpload } from "../../../utils/multer";
import validate from "../../../middlewares/validate";
import studentValidation from "../../../validations/student.validation";
import { ADMINS, STAFF } from "../../../config/roles";

const router = Router();

router.post("/createStudent", authenticate, authorize(ADMINS), studentUpload, Controller.createStudent);

// Envelope only — individual rows are validated in the service so one bad
// row reports a reason instead of rejecting the whole upload.
router.post(
  "/createBulkStudents",
  authenticate,
  authorize(ADMINS),
  validate(studentValidation.bulkCreateStudents),
  Controller.bulkCreateStudents
);

// ?search=john&className=Class 10&division=A&academicYear=2024-25
router.get("/getAllStudents", authenticate, authorize(STAFF), Controller.getAllStudents);
router.get("/getStudentById/:userId", authenticate, authorize(STAFF), Controller.getStudentById);
router.put("/updateStudent/:userId", authenticate, authorize(ADMINS), studentUpload, Controller.updateStudent);
router.delete("/deleteStudent/:userId", authenticate, authorize(ADMINS), Controller.deleteStudent);
// Year end: move chosen students to a class / section of the next session.
router.post("/promote", authenticate, authorize(ADMINS), Controller.promoteStudents);

export default router;
