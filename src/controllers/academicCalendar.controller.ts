import { Response } from "express";
import * as academicCalendarService from "../services/academicCalendar.service";
import * as examScheduleService from "../services/examSchedule.service";
import httpStatus from "http-status";

const createEvent = async (req: any, res: Response): Promise<any> => {
  try {
    const user = req.viaExamUser;
    const roleName = user.role?.role?.toLowerCase();
    const createdBy = user.userName;
    const instituteId = user.instituteId;
    
    // Teachers can also create events
    if (roleName !== "super_admin" && roleName !== "admin" && roleName !== "teacher") {
      return res.status(httpStatus.FORBIDDEN).send({ error: true, message: "Only admins and teachers can create events" });
    }

    const response = await academicCalendarService.createEvent(req.body, instituteId, createdBy);
    return res.status(response.statusCode).send(response);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).send({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const updateEvent = async (req: any, res: Response): Promise<any> => {
  try {
    const user = req.viaExamUser;
    const roleName = user.role?.role?.toLowerCase();
    const instituteId = user.instituteId;
    const { eventId } = req.params;

    if (roleName !== "super_admin" && roleName !== "admin" && roleName !== "teacher") {
      return res.status(httpStatus.FORBIDDEN).send({ error: true, message: "Only admins and teachers can update events" });
    }

    const response = await academicCalendarService.updateEvent(eventId, req.body, instituteId);
    return res.status(response.statusCode).send(response);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).send({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const deleteEvent = async (req: any, res: Response): Promise<any> => {
  try {
    const user = req.viaExamUser;
    const roleName = user.role?.role?.toLowerCase();
    const instituteId = user.instituteId;
    const { eventId } = req.params;

    if (roleName !== "super_admin" && roleName !== "admin" && roleName !== "teacher") {
      return res.status(httpStatus.FORBIDDEN).send({ error: true, message: "Only admins and teachers can delete events" });
    }

    const response = await academicCalendarService.deleteEvent(eventId, instituteId);
    return res.status(response.statusCode).send(response);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).send({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getAllEvents = async (req: any, res: Response): Promise<any> => {
  try {
    const user = req.viaExamUser;
    const instituteId = user.instituteId;

    const response = await academicCalendarService.getAllEvents(instituteId);
    return res.status(response.statusCode).send(response);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).send({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getEventsByMonth = async (req: any, res: Response): Promise<any> => {
  try {
    const user = req.viaExamUser;
    const instituteId = user.instituteId;
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(httpStatus.BAD_REQUEST).send({ error: true, message: "Year and month query params are required" });
    }

    const response = await academicCalendarService.getEventsByMonth(instituteId, parseInt(year as string, 10), parseInt(month as string, 10));
    return res.status(response.statusCode).send(response);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).send({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

// Date sheets for the teacher / student / scanner portals (students: own class only).
const getExamSchedule = async (req: any, res: Response): Promise<any> => {
  try {
    const response = await examScheduleService.getExamSchedule(req.viaExamUser);
    return res.status(response.statusCode).send(response);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).send({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

// Date sheets are published by the school office only.
const isSchoolAdmin = (user: any) => ["admin", "super_admin"].includes(String(user?.role?.role ?? "").toLowerCase());

// POST /academic-calendar/exam-schedule  { papers: [...] } — publish a date sheet in one go.
const createExamSchedule = async (req: any, res: Response): Promise<any> => {
  try {
    const user = req.viaExamUser;
    if (!isSchoolAdmin(user)) {
      return res.status(httpStatus.FORBIDDEN).send({ error: true, message: "Only the school admin can publish date sheets." });
    }
    const response = await academicCalendarService.createExamSchedule(req.body?.papers, user.instituteId, user.userName);
    return res.status(response.statusCode).send(response);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).send({ error: true, message: "Internal Server Error" });
  }
};

// POST /academic-calendar/bulk-delete  { eventIds: [...] }
const deleteEvents = async (req: any, res: Response): Promise<any> => {
  try {
    const user = req.viaExamUser;
    if (!isSchoolAdmin(user)) {
      return res.status(httpStatus.FORBIDDEN).send({ error: true, message: "Only the school admin can unschedule papers." });
    }
    const response = await academicCalendarService.deleteEvents(req.body?.eventIds, user.instituteId);
    return res.status(response.statusCode).send(response);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).send({ error: true, message: "Internal Server Error" });
  }
};

export default {
  createEvent,
  updateEvent,
  deleteEvent,
  getAllEvents,
  getEventsByMonth,
  getExamSchedule,
  createExamSchedule,
  deleteEvents,
};
