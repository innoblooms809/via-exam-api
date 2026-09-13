import express from "express";
import Controller from "../../controllers/academicCalendar.controller";
import { authenticate } from "../../middlewares/auth";

const router = express.Router();

router.use(authenticate);

router.post("/", Controller.createEvent);
router.get("/", Controller.getAllEvents);
router.get("/monthly", Controller.getEventsByMonth);
router.get("/exam-schedule", Controller.getExamSchedule);
router.post("/exam-schedule", Controller.createExamSchedule);
router.post("/bulk-delete", Controller.deleteEvents);
router.put("/:eventId", Controller.updateEvent);
router.delete("/:eventId", Controller.deleteEvent);

export default router;
