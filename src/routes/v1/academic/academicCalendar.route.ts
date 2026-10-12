import express from "express";
import Controller from "../../../controllers/academic/academicCalendar.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { ACADEMIC, MEMBERS, SUPER_ADMIN } from "../../../config/roles";

const router = express.Router();

router.use(authenticate);

// The controller narrows writes further (date sheets: school admin only).
const canRead = authorize([...MEMBERS, ...SUPER_ADMIN]);
const canWrite = authorize([...ACADEMIC, ...SUPER_ADMIN]);

router.post("/", canWrite, Controller.createEvent);
router.get("/", canRead, Controller.getAllEvents);
router.get("/monthly", canRead, Controller.getEventsByMonth);
router.get("/exam-schedule", canRead, Controller.getExamSchedule);
router.post("/exam-schedule", canWrite, Controller.createExamSchedule);
router.post("/bulk-delete", canWrite, Controller.deleteEvents);
router.put("/:eventId", canWrite, Controller.updateEvent);
router.delete("/:eventId", canWrite, Controller.deleteEvent);

export default router;
