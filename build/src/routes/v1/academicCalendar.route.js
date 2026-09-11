"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const academicCalendar_controller_1 = __importDefault(require("../../controllers/academicCalendar.controller"));
const auth_1 = require("../../middlewares/auth");
const router = express_1.default.Router();
router.use(auth_1.authenticate);
router.post("/", academicCalendar_controller_1.default.createEvent);
router.get("/", academicCalendar_controller_1.default.getAllEvents);
router.get("/monthly", academicCalendar_controller_1.default.getEventsByMonth);
router.put("/:eventId", academicCalendar_controller_1.default.updateEvent);
router.delete("/:eventId", academicCalendar_controller_1.default.deleteEvent);
exports.default = router;
