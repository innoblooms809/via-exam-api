import express from "express";
import Controller from "../../controllers/academicCalendar.controller";
import { authenticate } from "../../middlewares/auth";

const router = express.Router();

router.use(authenticate);

router.post("/", Controller.createEvent);
router.get("/", Controller.getAllEvents);
router.get("/monthly", Controller.getEventsByMonth);
router.put("/:eventId", Controller.updateEvent);
router.delete("/:eventId", Controller.deleteEvent);

export default router;
