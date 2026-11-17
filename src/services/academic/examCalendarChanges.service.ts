/**
 * Date sheets after the draft: publishing, rescheduling and removing papers.
 *
 *   publishPapers     drafts → published. Teachers, scanner staff and students see them from
 *                     then on, and the people each paper concerns are told: one notification
 *                     per person, naming their date sheets.
 *   reschedulePapers  one paper or a group (a holiday moves a whole day): new date, shift and
 *                     times, all or nothing. Clashes are checked against every other paper of
 *                     the class (drafts included) and among the papers moving together, so two
 *                     papers can swap days. A draft simply changes. A published paper needs a
 *                     reason, keeps where it was in changeLog (shown to everyone as
 *                     "rescheduled"), and the people it concerns are told.
 *   unschedulePapers  removes papers (soft delete). A published one is logged and its people told.
 *
 * Who a paper concerns: the students enrolled in its class that session, the class's subject
 * teacher, and the exam's setter, evaluators and scanner staff.
 */

import httpStatus from "http-status";
import { Op } from "sequelize";
import AcademicCalendar, { type CalendarChange, type PaperSlot } from "../../models/AcademicCalendar.model";
import StudentEnrollment from "../../models/StudentEnrollment.model";
import SessionSubject from "../../models/SessionSubject.model";
import Exam from "../../models/Exam.model";
import EvaluationAssignment from "../../models/EvaluationAssignment.model";
import ExamScannerAssignment from "../../models/ExamScannerAssignment.model";
import logger from "../../config/logger";
import { sequelize } from "../../config/sequelize";
import { formatClock, formatMinutes, isDateOnly, isShift, parseTime, readDetails, shiftFromTime, writeDetails, type ExamShift } from "../../utils/examTime";
import { notifyAll, type NotificationInput } from "../notification/notifyPeople";
import { MAX_BATCH, SHIFT_COLOR, eventSlot, slotsClash, toDateOnly, typeKey, type Slot } from "./academicCalendar.service";

export interface CalendarActor {
  instituteId: string;
  userName: string;
  isAdmin: boolean;
}

export interface PaperMove {
  eventId: string;
  eventDate: string;
  shift: string;
  startTime: string;
  endTime: string;
}

const MAX_REASON = 300;
const NOTICE_CHUNK = 500;

// ─── Small helpers ────────────────────────────────────────────────────────────

const uniq = <T>(values: (T | null | undefined)[]) => Array.from(new Set(values.filter((v): v is T => v !== null && v !== undefined && v !== ("" as any))));
const cleanIds = (value: unknown): string[] => (Array.isArray(value) ? uniq(value.map((v) => (typeof v === "string" ? v.trim() : ""))) : []);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listOf = (items: string[], max = 4) => (items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")} and ${items.length - max} more`);

/** Where a paper is now. */
const slotOf = (e: AcademicCalendar): PaperSlot => {
  const shift = readDetails(e.description).shift;
  return {
    date: toDateOnly(e.eventDate),
    startTime: e.startTime ?? null,
    endTime: e.endTime ?? null,
    shift: isShift(shift) ? shift : shiftFromTime(e.startTime),
  };
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mon 12 Dec" (written out, so every Node version words it the same). */
const dayLabel = (date: string | null) => {
  if (!date) return "no date";
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
/** "Mon 12 Dec, First Shift (09:00 AM – 12:00 PM)". */
const slotLabel = (s: PaperSlot) => `${dayLabel(s.date)}${s.shift ? `, ${s.shift}` : ""}${s.startTime && s.endTime ? ` (${s.startTime} – ${s.endTime})` : ""}`;
const subjectOf = (e: AcademicCalendar) => e.subjectName || e.title;
const sheetOf = (e: AcademicCalendar) => `${e.eventType} · Class ${e.className ?? ""}`.trim();
const paperLabel = (e: AcademicCalendar) => `${subjectOf(e)} (Class ${e.className ?? ""})`;

// ─── Who a paper concerns, and telling them ───────────────────────────────────

/** Each person a set of papers concerns, with the papers that concern them. */
const audienceOf = async (instituteId: string, papers: AcademicCalendar[]): Promise<Map<string, AcademicCalendar[]>> => {
  const audience = new Map<string, AcademicCalendar[]>();
  const examPapers = papers.filter((p) => p.classId);
  if (!examPapers.length) return audience;

  const classIds = uniq(examPapers.map((p) => p.classId));
  const sessionIds = uniq(examPapers.map((p) => p.sessionId));
  const subjectIds = uniq(examPapers.map((p) => p.subjectId));

  const [enrolments, subjectTeachers, exams] = await Promise.all([
    sessionIds.length
      ? StudentEnrollment.findAll({
          where: { instituteId, sessionId: { [Op.in]: sessionIds }, classId: { [Op.in]: classIds }, isActive: true },
          attributes: ["studentId", "sessionId", "classId"],
        })
      : [],
    sessionIds.length && subjectIds.length
      ? SessionSubject.findAll({
          where: { sessionId: { [Op.in]: sessionIds }, classId: { [Op.in]: classIds }, subjectId: { [Op.in]: subjectIds }, teacherId: { [Op.ne]: null } },
          attributes: ["sessionId", "classId", "subjectId", "teacherId"],
        })
      : [],
    subjectIds.length
      ? Exam.findAll({
          where: { instituteId, isDeleted: false, classId: { [Op.in]: classIds }, subjectId: { [Op.in]: subjectIds } },
          attributes: ["examId", "sessionId", "classId", "subjectId", "examType", "teacherId"],
        })
      : [],
  ]);
  const examIds = exams.map((e) => e.examId);
  const [evaluators, scanners] = examIds.length
    ? await Promise.all([
        EvaluationAssignment.findAll({ where: { examId: { [Op.in]: examIds }, isActive: true }, attributes: ["examId", "teacherId"] }),
        ExamScannerAssignment.findAll({ where: { examId: { [Op.in]: examIds }, isActive: true }, attributes: ["examId", "scannerId"] }),
      ])
    : [[], []];

  const group = <T>(rows: T[], key: (r: T) => string, value: (r: T) => string | null | undefined) => {
    const map = new Map<string, string[]>();
    for (const r of rows) {
      const v = value(r);
      if (v) map.set(key(r), [...(map.get(key(r)) ?? []), v]);
    }
    return map;
  };
  const studentsOf = group(enrolments, (e) => `${e.sessionId}|${e.classId}`, (e) => e.studentId);
  const teachersOf = group(subjectTeachers, (s) => `${s.sessionId}|${s.classId}|${s.subjectId}`, (s) => s.teacherId);
  const evaluatorsOf = group(evaluators, (a) => a.examId, (a) => a.teacherId);
  const scannersOf = group(scanners, (a) => a.examId, (a) => a.scannerId);

  const add = (userId: string | null | undefined, paper: AcademicCalendar) => {
    if (!userId) return;
    const list = audience.get(userId) ?? [];
    if (!list.includes(paper)) list.push(paper);
    audience.set(userId, list);
  };
  for (const paper of examPapers) {
    for (const id of studentsOf.get(`${paper.sessionId}|${paper.classId}`) ?? []) add(id, paper);
    for (const id of teachersOf.get(`${paper.sessionId}|${paper.classId}|${paper.subjectId}`) ?? []) add(id, paper);
    const papersExams = exams.filter(
      (e) =>
        e.classId === paper.classId &&
        e.subjectId === paper.subjectId &&
        typeKey(e.examType) === typeKey(paper.eventType) &&
        (!paper.sessionId || !e.sessionId || e.sessionId === paper.sessionId)
    );
    for (const exam of papersExams) {
      add(exam.teacherId, paper);
      for (const id of evaluatorsOf.get(exam.examId) ?? []) add(id, paper);
      for (const id of scannersOf.get(exam.examId) ?? []) add(id, paper);
    }
  }
  return audience;
};

type Notice = Pick<NotificationInput, "type" | "title" | "message">;

/** One notification per person, worded for the papers that concern them. Never throws. */
const tell = async (instituteId: string, papers: AcademicCalendar[], word: (theirs: AcademicCalendar[]) => Notice): Promise<number> => {
  try {
    const audience = await audienceOf(instituteId, papers);
    const items: NotificationInput[] = [];
    for (const [userId, theirs] of audience) items.push({ instituteId, userId, referenceId: theirs[0].eventId, ...word(theirs) });
    // Each is pushed to the person's browsers (Firebase) through the push queue.
    for (let i = 0; i < items.length; i += NOTICE_CHUNK) await notifyAll(items.slice(i, i + NOTICE_CHUNK));
    return items.length;
  } catch (err: any) {
    logger.warn(`[ExamCalendar] Notifications not sent: ${err?.message || err}`);
    return 0;
  }
};

const told = (n: number) => (n ? `; ${plural(n, "person was", "people were")} notified` : "");

// ─── Publish ──────────────────────────────────────────────────────────────────

const publishedNotice = (theirs: AcademicCalendar[]): Notice => {
  const sheets = uniq(theirs.map(sheetOf));
  const dates = uniq(theirs.map((p) => toDateOnly(p.eventDate))).sort();
  const span = dates.length ? (dates.length === 1 ? ` on ${dayLabel(dates[0])}` : `, ${dayLabel(dates[0])} to ${dayLabel(dates[dates.length - 1])}`) : "";
  return sheets.length === 1
    ? {
        type: "EXAM_SCHEDULE_PUBLISHED",
        title: "Exam date sheet published",
        message: `${sheets[0]}: ${plural(theirs.length, "paper")}${span}. Open the exam schedule for the dates and times.`,
      }
    : {
        type: "EXAM_SCHEDULE_PUBLISHED",
        title: "Exam date sheets published",
        message: `${sheets.length} date sheets: ${listOf(sheets)}${span}. Open the exam schedule for the dates and times.`,
      };
};

/** Publishes draft papers; already published ones are left as they are. */
export const publishPapers = async (eventIds: unknown, actor: CalendarActor) => {
  try {
    const ids = cleanIds(eventIds);
    if (!ids.length) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Choose the papers to publish." };
    if (ids.length > 1000) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Publish at most 1000 papers at a time." };

    // Only rows still in draft move, so a double click publishes (and notifies) once.
    const [, published] = await AcademicCalendar.update(
      { status: "published", publishedAt: new Date(), publishedBy: actor.userName },
      { where: { instituteId: actor.instituteId, isDeleted: false, status: "draft", eventId: { [Op.in]: ids } }, returning: true }
    );
    if (!published.length) {
      return { error: true, statusCode: httpStatus.CONFLICT, message: "These papers are already published." };
    }
    const notified = await tell(actor.instituteId, published, publishedNotice);
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `Published ${plural(published.length, "paper")}. Teachers, scanner staff and students can see ${published.length === 1 ? "it" : "them"} now${told(notified)}.`,
      data: { published: published.length, notified, alreadyPublished: ids.length - published.length },
    };
  } catch (error: any) {
    logger.error(`[ExamCalendar] Publish failed: ${error?.message || error}`);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: `Could not publish: ${error?.message ?? error}` };
  }
};

// ─── Reschedule ───────────────────────────────────────────────────────────────

const rescheduledNotice =
  (moves: Map<string, { from: PaperSlot; to: PaperSlot }>, reason: string) =>
  (theirs: AcademicCalendar[]): Notice => {
    if (theirs.length === 1) {
      const p = theirs[0];
      const m = moves.get(p.eventId)!;
      return {
        type: "EXAM_RESCHEDULED",
        title: `Exam rescheduled: ${subjectOf(p)}`,
        message: `${sheetOf(p)}: moved from ${slotLabel(m.from)} to ${slotLabel(m.to)}. Reason: ${reason}`,
      };
    }
    const lines = theirs.map((p) => {
      const m = moves.get(p.eventId)!;
      return `${paperLabel(p)} ${dayLabel(m.from.date)} → ${dayLabel(m.to.date)}${m.from.shift !== m.to.shift && m.to.shift ? ` (${m.to.shift})` : ""}`;
    });
    return {
      type: "EXAM_RESCHEDULED",
      title: `${theirs.length} exams rescheduled`,
      message: `${listOf(lines)}. Reason: ${reason}`,
    };
  };

type Planned = {
  index: number;
  event: AcademicCalendar;
  from: PaperSlot;
  to: PaperSlot & { date: string; shift: ExamShift };
  start: number;
  end: number;
  changed: boolean;
};

/**
 * Moves one paper or many at once, all or nothing (see the file comment). Papers listed with
 * their current slot are left alone. Refused with every problem (by the index of its change)
 * when any paper is invalid or would clash.
 */
export const reschedulePapers = async (changes: unknown, reasonInput: unknown, actor: CalendarActor) => {
  try {
    if (!Array.isArray(changes) || changes.length === 0) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Choose the papers to reschedule." };
    }
    if (changes.length > MAX_BATCH) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: `Reschedule at most ${MAX_BATCH} papers at a time.` };
    }
    const reason = String(reasonInput ?? "").trim().slice(0, MAX_REASON);
    const ids = cleanIds(changes.map((c: any) => c?.eventId));
    const events = ids.length
      ? await AcademicCalendar.findAll({ where: { instituteId: actor.instituteId, isDeleted: false, eventId: { [Op.in]: ids }, classId: { [Op.ne]: null } } })
      : [];
    const byId = new Map(events.map((e) => [e.eventId, e]));

    const problems: { index: number; message: string }[] = [];
    const planned: Planned[] = [];
    const seen = new Set<string>();
    (changes as Partial<PaperMove>[]).forEach((c, index) => {
      const event = byId.get(String(c?.eventId ?? ""));
      if (!event) return problems.push({ index, message: "This paper isn't on the date sheet any more. Refresh the page." });
      const fail = (message: string) => problems.push({ index, message: `${paperLabel(event)}: ${message}` });
      if (seen.has(event.eventId)) return fail("listed twice.");
      seen.add(event.eventId);
      if (!isDateOnly(c.eventDate)) return fail("choose a valid date.");
      if (!isShift(c.shift)) return fail("choose First Shift or Second Shift.");
      const start = parseTime(c.startTime);
      const end = parseTime(c.endTime);
      if (start === null || end === null) return fail("enter the start and end time.");
      if (end <= start) return fail("end time must be after the start time.");

      const from = slotOf(event);
      const to = { date: c.eventDate as string, startTime: formatClock(start), endTime: formatClock(end), shift: c.shift as ExamShift };
      const changed = from.date !== to.date || from.shift !== to.shift || parseTime(from.startTime) !== start || parseTime(from.endTime) !== end;
      planned.push({ index, event, from, to, start, end, changed });
    });

    const moving = planned.filter((p) => p.changed);
    if (!problems.length && !moving.length) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Nothing to change: the new dates and times are the same as now." };
    }
    if (moving.some((p) => p.event.status === "published") && reason.length < 3) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Give a reason for the reschedule. Teachers and students are told, with the reason.",
      };
    }

    // Clashes: every other paper of those classes on the new days (the moving papers' old
    // places don't count), then the moving papers among themselves.
    if (!problems.length) {
      const movingIds = new Set(moving.map((p) => p.event.eventId));
      const others = (
        await AcademicCalendar.findAll({
          where: {
            instituteId: actor.instituteId,
            isDeleted: false,
            classId: { [Op.in]: uniq(moving.map((p) => p.event.classId)) },
            eventDate: { [Op.in]: uniq(moving.map((p) => p.to.date)) },
          },
        })
      )
        .filter((e) => !movingIds.has(e.eventId))
        .map(eventSlot);
      const placed: (Slot & { label: string })[] = [];
      for (const p of moving) {
        const slot: Slot = { classId: p.event.classId as string, date: p.to.date, start: p.start, end: p.end, shift: p.to.shift };
        const clash = others.find((o) => slotsClash(slot, o));
        if (clash) {
          problems.push({
            index: p.index,
            message: `${paperLabel(p.event)}: Class ${p.event.className} already has ${clash.subjectName || clash.title} in the ${clash.shift ?? "same shift"} on ${p.to.date}. Pick the other shift or another day.`,
          });
          continue;
        }
        const twin = placed.find((o) => slotsClash(slot, o));
        if (twin) {
          problems.push({ index: p.index, message: `${paperLabel(p.event)}: clashes with ${twin.label}, which is also moving to the ${p.to.shift} on ${p.to.date}.` });
          continue;
        }
        placed.push({ ...slot, label: paperLabel(p.event) });
      }
    }
    if (problems.length) {
      problems.sort((a, b) => a.index - b.index);
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: problems.length === 1 ? problems[0].message : `${problems.length} papers need attention; nothing was changed.`,
        data: { problems },
      };
    }

    const at = new Date().toISOString();
    await sequelize.transaction(async (transaction) => {
      for (const p of moving) {
        const e = p.event;
        const entry: CalendarChange | null =
          e.status === "published" ? { kind: "rescheduled", at, by: actor.userName, reason, from: p.from, to: p.to } : null;
        await e.update(
          {
            eventDate: p.to.date as any,
            startTime: p.to.startTime,
            endTime: p.to.endTime,
            duration: formatMinutes(p.end - p.start),
            description: writeDetails(e.description, { shift: p.to.shift }),
            color: SHIFT_COLOR[p.to.shift],
            ...(entry ? { changeLog: [...(e.changeLog ?? []), entry] } : {}),
          },
          { transaction }
        );
      }
    });

    const published = moving.filter((p) => p.event.status === "published");
    const drafts = moving.length - published.length;
    const notified = published.length
      ? await tell(
          actor.instituteId,
          published.map((p) => p.event),
          rescheduledNotice(new Map(published.map((p) => [p.event.eventId, { from: p.from, to: p.to }])), reason)
        )
      : 0;
    const parts = [
      published.length ? `${plural(published.length, "paper")} rescheduled${told(notified)}` : "",
      drafts ? `${plural(drafts, "draft paper")} updated` : "",
    ].filter(Boolean);
    const message = parts.join(". ");
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `${message.charAt(0).toUpperCase()}${message.slice(1)}.`,
      data: { rescheduled: published.length, updated: drafts, notified, unchanged: planned.length - moving.length },
    };
  } catch (error: any) {
    logger.error(`[ExamCalendar] Reschedule failed: ${error?.message || error}`);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: `Could not reschedule: ${error?.message ?? error}` };
  }
};

// ─── Unschedule ───────────────────────────────────────────────────────────────

const unscheduledNotice =
  (reason: string | null) =>
  (theirs: AcademicCalendar[]): Notice => {
    const why = reason ? ` Reason: ${reason}` : "";
    if (theirs.length === 1) {
      const p = theirs[0];
      return {
        type: "EXAM_UNSCHEDULED",
        title: `Exam removed from the date sheet: ${subjectOf(p)}`,
        message: `${sheetOf(p)} on ${dayLabel(toDateOnly(p.eventDate))} is no longer on the date sheet.${why}`,
      };
    }
    return {
      type: "EXAM_UNSCHEDULED",
      title: `${theirs.length} exams removed from the date sheet`,
      message: `${listOf(theirs.map((p) => `${paperLabel(p)} on ${dayLabel(toDateOnly(p.eventDate))}`))} are no longer on the date sheet.${why}`,
    };
  };

/** Removes papers from the date sheet (soft delete). Published ones are logged and their people told. */
export const unschedulePapers = async (eventIds: unknown, actor: CalendarActor, reasonInput?: unknown) => {
  try {
    const ids = cleanIds(eventIds);
    if (!ids.length) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Select at least one paper." };
    const reason = String(reasonInput ?? "").trim().slice(0, MAX_REASON) || null;
    const events = await AcademicCalendar.findAll({ where: { instituteId: actor.instituteId, isDeleted: false, eventId: { [Op.in]: ids } } });
    const published = events.filter((e) => e.classId && e.status === "published");
    const at = new Date().toISOString();
    await sequelize.transaction(async (transaction) => {
      for (const e of events) {
        const entry: CalendarChange | null =
          e.classId && e.status === "published" ? { kind: "unscheduled", at, by: actor.userName, reason, from: slotOf(e) } : null;
        await e.update({ isDeleted: true, ...(entry ? { changeLog: [...(e.changeLog ?? []), entry] } : {}) }, { transaction });
      }
    });
    const notified = published.length ? await tell(actor.instituteId, published, unscheduledNotice(reason)) : 0;
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `${plural(events.length, "paper")} unscheduled${told(notified)}.`,
      data: { deleted: events.length, notified },
    };
  } catch (error: any) {
    logger.error(`[ExamCalendar] Unschedule failed: ${error?.message || error}`);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: `Could not unschedule: ${error?.message ?? error}` };
  }
};

/** Deletes one calendar event: a date-sheet paper through unschedulePapers (school admin only). */
export const removeEvent = async (eventId: string, actor: CalendarActor, reason?: unknown) => {
  try {
    const event = await AcademicCalendar.findOne({ where: { eventId, instituteId: actor.instituteId, isDeleted: false } });
    if (!event) return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Event not found" };
    if (event.classId) {
      if (!actor.isAdmin) return { error: true, statusCode: httpStatus.FORBIDDEN, message: "Only the school admin can change the date sheet." };
      return unschedulePapers([eventId], actor, reason);
    }
    await event.update({ isDeleted: true });
    return { error: false, statusCode: httpStatus.OK, message: "Event deleted successfully" };
  } catch (error: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: error?.message ?? String(error) };
  }
};

export default { publishPapers, reschedulePapers, unschedulePapers, removeEvent };
