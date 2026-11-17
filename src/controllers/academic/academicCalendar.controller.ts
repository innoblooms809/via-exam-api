import { Response } from "express";
import * as academicCalendarService from "../../services/academic/academicCalendar.service";
import * as examScheduleService from "../../services/exam/examSchedule.service";
import CalendarChanges, { type CalendarActor } from "../../services/academic/examCalendarChanges.service";
import httpStatus from "http-status";

// Date sheets are made, published and changed by the school office only.
const isSchoolAdmin = (user: any) => ["admin", "super_admin"].includes(String(user?.role?.role ?? "").toLowerCase());

const actorOf = (user: any): CalendarActor => ({ instituteId: user.instituteId, userName: user.userName, isAdmin: isSchoolAdmin(user) });

const serverError = (res: Response) =>
  res.status(httpStatus.INTERNAL_SERVER_ERROR).send({ error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Internal Server Error" });

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
    return serverError(res);
  }
};

// A draft paper changes freely here; a published one is refused (it is rescheduled instead).
const updateEvent = async (req: any, res: Response): Promise<any> => {
  try {
    const user = req.viaExamUser;
    const roleName = user.role?.role?.toLowerCase();
    const { eventId } = req.params;

    if (roleName !== "super_admin" && roleName !== "admin" && roleName !== "teacher") {
      return res.status(httpStatus.FORBIDDEN).send({ error: true, message: "Only admins and teachers can update events" });
    }

    const response = await academicCalendarService.updateEvent(eventId, req.body, user.instituteId, { isAdmin: isSchoolAdmin(user) });
    return res.status(response.statusCode).send(response);
  } catch (error) {
    return serverError(res);
  }
};

const deleteEvent = async (req: any, res: Response): Promise<any> => {
  try {
    const user = req.viaExamUser;
    const roleName = user.role?.role?.toLowerCase();
    const { eventId } = req.params;

    if (roleName !== "super_admin" && roleName !== "admin" && roleName !== "teacher") {
      return res.status(httpStatus.FORBIDDEN).send({ error: true, message: "Only admins and teachers can delete events" });
    }

    const response = await CalendarChanges.removeEvent(eventId, actorOf(user), req.body?.reason ?? req.query?.reason);
    return res.status(response.statusCode).send(response);
  } catch (error) {
    return serverError(res);
  }
};

// Drafts only for the school admin; everyone else gets published events.
const getAllEvents = async (req: any, res: Response): Promise<any> => {
  try {
    const user = req.viaExamUser;
    // ?from=&to= (YYYY-MM-DD) and ?page=&limit= narrow the list (see the service).
    const response = await academicCalendarService.getAllEvents(user.instituteId, isSchoolAdmin(user), req.query);
    return res.status(response.statusCode).send(response);
  } catch (error) {
    return serverError(res);
  }
};

const getEventsByMonth = async (req: any, res: Response): Promise<any> => {
  try {
    const user = req.viaExamUser;
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(httpStatus.BAD_REQUEST).send({ error: true, message: "Year and month query params are required" });
    }

    const response = await academicCalendarService.getEventsByMonth(
      user.instituteId,
      parseInt(year as string, 10),
      parseInt(month as string, 10),
      isSchoolAdmin(user)
    );
    return res.status(response.statusCode).send(response);
  } catch (error) {
    return serverError(res);
  }
};

// Date sheets for the teacher / student / scanner portals (students: own class only; drafts: admin only).
const getExamSchedule = async (req: any, res: Response): Promise<any> => {
  try {
    const response = await examScheduleService.getExamSchedule(req.viaExamUser, req.query);
    return res.status(response.statusCode).send(response);
  } catch (error) {
    return serverError(res);
  }
};

// POST /academic-calendar/exam-schedule  { papers: [...] }: a date sheet in one go, saved as drafts.
const createExamSchedule = async (req: any, res: Response): Promise<any> => {
  try {
    const user = req.viaExamUser;
    if (!isSchoolAdmin(user)) {
      return res.status(httpStatus.FORBIDDEN).send({ error: true, message: "Only the school admin can make date sheets." });
    }
    const response = await academicCalendarService.createExamSchedule(req.body?.papers, user.instituteId, user.userName);
    return res.status(response.statusCode).send(response);
  } catch (error) {
    return serverError(res);
  }
};

// POST /academic-calendar/publish  { eventIds: [...] }: drafts become visible to everyone.
const publishPapers = async (req: any, res: Response): Promise<any> => {
  try {
    const user = req.viaExamUser;
    if (!isSchoolAdmin(user)) {
      return res.status(httpStatus.FORBIDDEN).send({ error: true, message: "Only the school admin can publish date sheets." });
    }
    const response = await CalendarChanges.publishPapers(req.body?.eventIds, actorOf(user));
    return res.status(response.statusCode).send(response);
  } catch (error) {
    return serverError(res);
  }
};

// POST /academic-calendar/reschedule  { changes: [{ eventId, eventDate, shift, startTime, endTime }], reason }
const reschedulePapers = async (req: any, res: Response): Promise<any> => {
  try {
    const user = req.viaExamUser;
    if (!isSchoolAdmin(user)) {
      return res.status(httpStatus.FORBIDDEN).send({ error: true, message: "Only the school admin can reschedule papers." });
    }
    const response = await CalendarChanges.reschedulePapers(req.body?.changes, req.body?.reason, actorOf(user));
    return res.status(response.statusCode).send(response);
  } catch (error) {
    return serverError(res);
  }
};

// POST /academic-calendar/bulk-delete  { eventIds: [...], reason? }
const deleteEvents = async (req: any, res: Response): Promise<any> => {
  try {
    const user = req.viaExamUser;
    if (!isSchoolAdmin(user)) {
      return res.status(httpStatus.FORBIDDEN).send({ error: true, message: "Only the school admin can unschedule papers." });
    }
    const response = await CalendarChanges.unschedulePapers(req.body?.eventIds, actorOf(user), req.body?.reason);
    return res.status(response.statusCode).send(response);
  } catch (error) {
    return serverError(res);
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
  publishPapers,
  reschedulePapers,
  deleteEvents,
};
