import httpStatus from "http-status";
import AcademicCalendar from "../modals/AcademicCalendar.modal";
import User from "../modals/User.modal";
import Class from "../modals/Class.modal";
import Subject from "../modals/Subject.modal";
import Session from "../modals/Session.modal";
import { sequelize } from "../config/sequelize";
import { Op } from "sequelize";
import {
  formatClock,
  formatMinutes,
  isDateOnly,
  isShift,
  parseTime,
  readDetails,
  shiftFromTime,
  writeDetails,
  type ExamShift,
} from "../utils/examTime";

export const createEvent = async (data: any, instituteId: string, createdBy: string) => {
  try {
    const event = await AcademicCalendar.create({
      ...data,
      instituteId,
      createdBy,
    });
    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Event created successfully",
      data: event,
    };
  } catch (error: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Failed to create event: ${error.message}`,
    };
  }
};

export const updateEvent = async (eventId: string, data: any, instituteId: string) => {
  try {
    const event = await AcademicCalendar.findOne({ where: { eventId, instituteId, isDeleted: false } });
    if (!event) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Event not found" };
    }

    const { shift, ...changes } = data ?? {};
    // Exam papers (they have a class) are re-validated like new ones: date, times, shift, clashes.
    if (event.classId && (changes.eventDate !== undefined || changes.startTime !== undefined || changes.endTime !== undefined || shift !== undefined)) {
      const date = changes.eventDate ?? toDateOnly(event.eventDate);
      if (!isDateOnly(date)) {
        return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Choose a valid exam date." };
      }
      const start = parseTime(changes.startTime ?? event.startTime);
      const end = parseTime(changes.endTime ?? event.endTime);
      if (start === null || end === null || end <= start) {
        return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "End time must be after the start time." };
      }
      const currentShift = readDetails(event.description).shift;
      const nextShift = shift ?? currentShift ?? shiftFromTime(start);
      if (!isShift(nextShift)) {
        return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Shift must be First Shift or Second Shift." };
      }

      const clash = await findClassClash(instituteId, {
        classId: event.classId,
        date,
        start,
        end,
        shift: nextShift,
        excludeEventId: event.eventId,
      });
      if (clash) {
        return {
          error: true,
          statusCode: httpStatus.CONFLICT,
          message: `${event.className ? `Class ${event.className}` : "This class"} already has ${clash.subjectName || clash.title} in the ${clash.shift ?? "same shift"} on ${date}. Pick the other shift or another day.`,
        };
      }

      changes.eventDate = date;
      changes.startTime = formatClock(start);
      changes.endTime = formatClock(end);
      changes.duration = formatMinutes(end - start);
      changes.description = writeDetails(event.description, { shift: nextShift });
      changes.color = SHIFT_COLOR[nextShift];
    }

    // Identity fields of an exam paper are not changed through an edit.
    for (const key of ["instituteId", "createdBy", "eventId", "isDeleted", "classId", "sessionId", "subjectId"]) delete changes[key];
    await event.update(changes);
    return { error: false, statusCode: httpStatus.OK, message: "Exam paper updated.", data: event };
  } catch (error: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: error.message };
  }
};

// ─── Exam date sheet (bulk) ─────────────────────────────────────────────────

const SHIFT_COLOR: Record<ExamShift, string> = { "First Shift": "#4F6EF7", "Second Shift": "#0EA5E9" };
const MAX_BATCH = 300;

const toDateOnly = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const d = new Date(value as any);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const typeKey = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

interface Slot {
  classId: string;
  date: string;
  start: number | null;
  end: number | null;
  shift: ExamShift | null;
}

/**
 * One class, one day, one shift = one paper. A class may write a second paper the same day
 * in the other shift. Only when a shift cannot be known (very old events without times)
 * do overlapping times decide.
 */
const slotsClash = (a: Slot, b: Slot) => {
  if (a.classId !== b.classId || a.date !== b.date) return false;
  if (a.shift && b.shift) return a.shift === b.shift;
  if (a.start !== null && a.end !== null && b.start !== null && b.end !== null) return a.start < b.end && b.start < a.end;
  return false;
};

const eventSlot = (e: AcademicCalendar): Slot & { subjectName: string; title: string; eventId: string; time: string } => {
  const start = parseTime(e.startTime);
  const end = parseTime(e.endTime);
  const shift = readDetails(e.description).shift;
  return {
    eventId: e.eventId,
    classId: e.classId as string,
    date: toDateOnly(e.eventDate) as string,
    start,
    end,
    shift: isShift(shift) ? shift : shiftFromTime(e.startTime),
    subjectName: e.subjectName || "",
    title: e.title,
    time: [e.startTime, e.endTime].filter(Boolean).join(" – "),
  };
};

const findClassClash = async (
  instituteId: string,
  slot: Slot & { excludeEventId?: string }
) => {
  const sameDay = await AcademicCalendar.findAll({
    where: { instituteId, isDeleted: false, classId: slot.classId, eventDate: slot.date },
  });
  return sameDay
    .filter((e) => e.eventId !== slot.excludeEventId)
    .map(eventSlot)
    .find((other) => slotsClash(slot, other)) ?? null;
};

export interface SchedulePaperInput {
  sessionId: string;
  classId: string;
  subjectId: string;
  examType: string;
  date: string;
  shift: string;
  startTime: string;
  endTime: string;
}

/**
 * Publishes a date sheet: many papers (classes × subjects) in one go, all or nothing.
 * Names come from the database, not the client. Refused with the full problem list when
 * any paper is invalid, clashes with another paper of that class, or is already scheduled.
 */
export const createExamSchedule = async (items: SchedulePaperInput[], instituteId: string, createdBy: string) => {
  try {
    if (!Array.isArray(items) || items.length === 0) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Add at least one subject to the date sheet." };
    }
    if (items.length > MAX_BATCH) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: `A date sheet can have at most ${MAX_BATCH} papers at a time.` };
    }

    const ids = (key: keyof SchedulePaperInput) => Array.from(new Set(items.map((i) => String(i?.[key] ?? "")).filter(Boolean)));
    const [sessions, classes, subjects] = await Promise.all([
      Session.findAll({ where: { instituteId, sessionId: { [Op.in]: ids("sessionId") }, isDeleted: false } }),
      Class.findAll({ where: { instituteId, classId: { [Op.in]: ids("classId") } } }),
      Subject.findAll({ where: { instituteId, subjectId: { [Op.in]: ids("subjectId") }, isDeleted: false } }),
    ]);
    const sessionIds = new Set(sessions.map((s) => s.sessionId));
    const classById = new Map(classes.map((c) => [c.classId, c]));
    const subjectById = new Map(subjects.map((s) => [s.subjectId, s]));

    const problems: { index: number; message: string }[] = [];
    const rows: any[] = [];
    const slots: (Slot & { label: string })[] = [];

    items.forEach((item, index) => {
      const cls = classById.get(item?.classId);
      const subject = subjectById.get(item?.subjectId);
      const label = `${subject?.subjectName ?? "Subject"}${cls ? ` (Class ${cls.className})` : ""}`;
      const fail = (message: string) => problems.push({ index, message: `${label}: ${message}` });

      if (!item || !sessionIds.has(item.sessionId)) return fail("choose a session of your school.");
      if (!cls) return fail("class not found.");
      if (!subject || subject.classId !== cls.classId) return fail("this subject does not belong to the class.");
      const examType = String(item.examType ?? "").trim();
      if (!examType) return fail("choose the exam (e.g. Mid Term).");
      if (!isDateOnly(item.date)) return fail("choose a valid date.");
      if (!isShift(item.shift)) return fail("choose First Shift or Second Shift.");
      const start = parseTime(item.startTime);
      const end = parseTime(item.endTime);
      if (start === null || end === null) return fail("enter the start and end time.");
      if (end <= start) return fail("end time must be after the start time.");

      const slot = { classId: cls.classId, date: item.date, start, end, shift: item.shift, label };
      const twin = slots.find((s) => slotsClash(slot, s));
      if (twin) return fail(`clashes with ${twin.label} — both in the ${item.shift} on ${item.date}. Move one to the other shift or another day.`);
      slots.push(slot);

      rows.push({
        title: `${examType} - ${subject.subjectName} (${cls.className})`,
        description: writeDetails(null, { shift: item.shift }),
        eventDate: item.date,
        startTime: formatClock(start),
        endTime: formatClock(end),
        duration: formatMinutes(end - start),
        eventType: examType,
        color: SHIFT_COLOR[item.shift],
        instituteId,
        createdBy,
        sessionId: item.sessionId,
        classId: cls.classId,
        className: cls.className,
        subjectId: subject.subjectId,
        subjectName: subject.subjectName,
        _index: index,
      });
    });

    // Against what is already on the calendar.
    if (rows.length) {
      const existing = await AcademicCalendar.findAll({
        where: { instituteId, isDeleted: false, classId: { [Op.in]: Array.from(new Set(rows.map((r) => r.classId))) } },
      });
      for (const row of rows) {
        const label = `${row.subjectName} (Class ${row.className})`;
        const duplicate = existing.find(
          (e) =>
            e.sessionId === row.sessionId &&
            e.classId === row.classId &&
            e.subjectId === row.subjectId &&
            typeKey(e.eventType) === typeKey(row.eventType)
        );
        if (duplicate) {
          problems.push({
            index: row._index,
            message: `${label}: already scheduled for ${row.eventType} on ${toDateOnly(duplicate.eventDate)}. Edit that paper instead.`,
          });
          continue;
        }
        const slot: Slot = {
          classId: row.classId,
          date: row.eventDate,
          start: parseTime(row.startTime),
          end: parseTime(row.endTime),
          shift: readDetails(row.description).shift,
        };
        const clash = existing.map(eventSlot).find((other) => slotsClash(slot, other));
        if (clash) {
          problems.push({
            index: row._index,
            message: `${label}: Class ${row.className} already has ${clash.subjectName || clash.title} in the ${clash.shift ?? "same shift"} on ${row.eventDate}. Pick the other shift or another day.`,
          });
        }
      }
    }

    if (problems.length) {
      problems.sort((a, b) => a.index - b.index);
      return {
        error: true,
        // 409 whether the paper is invalid or clashes: the client shows one problem list either way.
        statusCode: httpStatus.CONFLICT,
        message: problems.length === 1 ? problems[0].message : `${problems.length} papers need attention before publishing.`,
        data: { problems },
      };
    }

    const created = await sequelize.transaction(async (transaction) =>
      AcademicCalendar.bulkCreate(rows.map(({ _index, ...row }) => row), { transaction })
    );
    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: `Date sheet published — ${created.length} ${created.length === 1 ? "paper" : "papers"} scheduled.`,
      data: { events: created },
    };
  } catch (error: any) {
    console.error("createExamSchedule Error:", error);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: `Failed to publish the date sheet: ${error.message}` };
  }
};

/** Unschedules several papers at once (soft delete, like single delete). */
export const deleteEvents = async (eventIds: string[], instituteId: string) => {
  try {
    const ids = Array.isArray(eventIds) ? eventIds.filter((id) => typeof id === "string" && id) : [];
    if (!ids.length) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Select at least one paper." };
    }
    const [count] = await AcademicCalendar.update(
      { isDeleted: true },
      { where: { instituteId, isDeleted: false, eventId: { [Op.in]: ids } } }
    );
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `${count} ${count === 1 ? "paper" : "papers"} unscheduled.`,
      data: { deleted: count },
    };
  } catch (error: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: error.message };
  }
};

export const deleteEvent = async (eventId: string, instituteId: string) => {
  try {
    const event = await AcademicCalendar.findOne({ where: { eventId, instituteId, isDeleted: false } });
    if (!event) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Event not found" };
    }
    await event.update({ isDeleted: true });
    return { error: false, statusCode: httpStatus.OK, message: "Event deleted successfully" };
  } catch (error: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: error.message };
  }
};

export const getEventsByMonth = async (instituteId: string, year: number, month: number) => {
  try {
    // MySQL handles string comparison on DATEONLY correctly. We can do month matching.
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const events = await AcademicCalendar.findAll({
      where: {
        instituteId,
        isDeleted: false,
        eventDate: {
          [Op.gte]: startDate,
          [Op.lte]: endDate,
        },
      },
      order: [["eventDate", "ASC"]],
    });

    const creatorIds = events.map(e => e.createdBy).filter(Boolean);
    const users = await User.findAll({
      where: { userId: creatorIds }
    });
    const userMap = users.reduce((acc: any, u: any) => {
      acc[u.userId] = u.userName;
      return acc;
    }, {});

    const mappedEvents = events.map(e => {
      const plain = e.toJSON();
      if (userMap[plain.createdBy]) {
        plain.createdBy = userMap[plain.createdBy];
      }
      return plain;
    });

    return { error: false, statusCode: httpStatus.OK, data: mappedEvents };
  } catch (error: any) {
    console.error("Error in getEventsByMonth service:", error);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: error.message };
  }
};

export const getAllEvents = async (instituteId: string) => {
  try {
    const events = await AcademicCalendar.findAll({
      where: { instituteId, isDeleted: false },
      order: [["eventDate", "ASC"]],
    });
    const creatorIds = events.map(e => e.createdBy).filter(Boolean);
    const users = await User.findAll({
      where: { userId: creatorIds }
    });
    const userMap = users.reduce((acc: any, u: any) => {
      acc[u.userId] = u.userName;
      return acc;
    }, {});

    const mappedEvents = events.map(e => {
      const plain = e.toJSON();
      if (userMap[plain.createdBy]) {
        plain.createdBy = userMap[plain.createdBy];
      }
      return plain;
    });

    return { error: false, statusCode: httpStatus.OK, data: mappedEvents };
  } catch (error: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: error.message };
  }
};
