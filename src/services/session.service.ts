import httpStatus from "http-status";
import { Op } from "sequelize";
import Session from "../modals/Session.modal";
import Institute from "../modals/Institute.modal";
import Exam from "../modals/Exam.modal";
import StudentProfile from "../modals/Student.modal";
import RegHelper from "../utils/helper";
import { sequelize } from "../config/sequelize";

const fail = (statusCode: number, message: string) => ({ error: true, statusCode, message });

// ─── Validation ───────────────────────────────────────────────────────────────

/** "2026-2027" (or "2026-27"); the second year must follow the first. */
const parseSessionName = (value: unknown): string | null => {
  const name = String(value ?? "").replace(/\s+/g, "");
  const match = /^(\d{4})-(\d{2}|\d{4})$/.exec(name);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2].length === 2 ? Number(String(start).slice(0, 2) + match[2]) : Number(match[2]);
  if (start < 1990 || start > 2100 || end !== start + 1) return null;
  return name;
};

const parseDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const MAX_SESSION_DAYS = 550;

/** Checks name and dates; returns the cleaned values or an error message. */
type SessionCheck =
  | { ok: false; message: string }
  | { ok: true; sessionName: string; startDate: Date; endDate: Date };

const validateSession = (name: unknown, start: unknown, end: unknown): SessionCheck => {
  const sessionName = parseSessionName(name);
  if (!sessionName) return { ok: false, message: "Session name must look like 2026-2027." };
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate) return { ok: false, message: "Start date and end date are required." };
  if (endDate <= startDate) return { ok: false, message: "End date must be after the start date." };
  if ((endDate.getTime() - startDate.getTime()) / 86_400_000 > MAX_SESSION_DAYS) {
    return { ok: false, message: "A session can be at most 18 months long." };
  }
  return { ok: true, sessionName, startDate, endDate };
};

/** Another session of the institute whose dates overlap these. */
const findOverlap = (instituteId: string, startDate: Date, endDate: Date, exceptId?: string) =>
  Session.findOne({
    where: {
      instituteId,
      isDeleted: false,
      startDate: { [Op.lt]: endDate },
      endDate: { [Op.gt]: startDate },
      ...(exceptId ? { sessionId: { [Op.ne]: exceptId } } : {}),
    },
  });

const formatDay = (date: Date) =>
  new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

// ─── CREATE SESSION ───────────────────────────────────────────────────────────
const createSession = async (body: any, createdBy: any): Promise<any> => {
  const instituteId = createdBy.instituteId;
  const checked = validateSession(body.sessionName, body.startDate, body.endDate);
  if (!checked.ok) return fail(httpStatus.BAD_REQUEST, checked.message);
  const { sessionName, startDate, endDate } = checked;

  const t = await sequelize.transaction();
  try {
    const institute = await Institute.findOne({ where: { instituteId, status: 1 } });
    if (!institute) {
      await t.rollback();
      return fail(httpStatus.NOT_FOUND, "Institute not found or inactive.");
    }

    // The table keeps deleted sessions, so a deleted one with this name is brought back.
    const existing = await Session.findOne({ where: { instituteId, sessionName }, transaction: t });
    if (existing && !existing.isDeleted) {
      await t.rollback();
      return fail(httpStatus.CONFLICT, `Session ${sessionName} already exists.`);
    }

    const overlap = await findOverlap(instituteId, startDate, endDate, existing?.sessionId);
    if (overlap) {
      await t.rollback();
      return fail(
        httpStatus.CONFLICT,
        `These dates overlap session ${overlap.sessionName} (${formatDay(overlap.startDate)} – ${formatDay(overlap.endDate)}).`,
      );
    }

    const hasActive = await Session.count({ where: { instituteId, isDeleted: false, isActive: true }, transaction: t });
    const makeActive = body.isActive === true || body.isActive === "true" || hasActive === 0;
    if (makeActive) {
      await Session.update({ isActive: false }, { where: { instituteId, isDeleted: false }, transaction: t });
    }

    let session: Session;
    if (existing) {
      session = await existing.update({ startDate, endDate, isActive: makeActive, isDeleted: false }, { transaction: t });
    } else {
      session = await Session.create(
        {
          sessionId: await RegHelper.generateUserId(),
          instituteId,
          sessionName,
          startDate,
          endDate,
          isActive: makeActive,
        },
        { transaction: t },
      );
    }

    await t.commit();
    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: makeActive ? `Session ${sessionName} created and set as current.` : `Session ${sessionName} created.`,
      data: session,
    };
  } catch (e: any) {
    await t.rollback();
    console.error(e);
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
  }
};

// ─── GET ALL SESSIONS ─────────────────────────────────────────────────────────
const getAllSessions = async (createdBy: any, query: any): Promise<any> => {
  try {
    const { isActive = "" } = query;
    const instituteId = createdBy.instituteId;
    const where: any = { instituteId, isDeleted: false };
    if (isActive === "true") where.isActive = true;
    if (isActive === "false") where.isActive = false;

    const sessions = await Session.findAll({ where, order: [["startDate", "DESC"]] });

    // How much each session is used, so the UI can explain why one can't be deleted.
    const [studentRows, examRows] = await Promise.all([
      StudentProfile.findAll({
        attributes: ["session", [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
        where: { instituteId },
        group: ["session"],
        raw: true,
      }) as any,
      Exam.findAll({
        attributes: ["sessionId", [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
        where: { instituteId, isDeleted: false },
        group: ["sessionId"],
        raw: true,
      }) as any,
    ]);
    const students = new Map<string, number>(studentRows.map((r: any) => [r.session, Number(r.count)]));
    const exams = new Map<string, number>(examRows.map((r: any) => [r.sessionId, Number(r.count)]));

    const rows = sessions.map((s) => ({
      ...s.toJSON(),
      studentCount: students.get(s.sessionName) ?? 0,
      examCount: exams.get(s.sessionId) ?? 0,
    }));

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Sessions fetched successfully.",
      data: {
        sessions: rows,
        total: rows.length,
        activeSession: rows.find((s) => s.isActive) ?? null,
      },
    };
  } catch (e: any) {
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
  }
};

// ─── GET ONE SESSION ──────────────────────────────────────────────────────────
const getSessionById = async (sessionId: string, createdBy: any): Promise<any> => {
  try {
    const session = await Session.findOne({
      where: { sessionId, instituteId: createdBy.instituteId, isDeleted: false },
    });
    if (!session) return fail(httpStatus.NOT_FOUND, "Session not found.");

    return { error: false, statusCode: httpStatus.OK, message: "Session fetched successfully.", data: session };
  } catch (e: any) {
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
  }
};

// ─── GET ACTIVE SESSION ───────────────────────────────────────────────────────
const getActiveSession = async (createdBy: any): Promise<any> => {
  try {
    const session = await Session.findOne({
      where: { instituteId: createdBy.instituteId, isActive: true, isDeleted: false },
    });
    if (!session) return fail(httpStatus.NOT_FOUND, "No active session found. Please create or activate a session.");

    return { error: false, statusCode: httpStatus.OK, message: "Active session fetched.", data: session };
  } catch (e: any) {
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
  }
};

// ─── ACTIVATE SESSION ─────────────────────────────────────────────────────────
// Deactivates all other sessions and activates this one
const activateSession = async (sessionId: string, createdBy: any): Promise<any> => {
  const t = await sequelize.transaction();
  try {
    const session = await Session.findOne({
      where: { sessionId, instituteId: createdBy.instituteId, isDeleted: false },
      transaction: t,
    });
    if (!session) {
      await t.rollback();
      return fail(httpStatus.NOT_FOUND, "Session not found.");
    }
    if (session.isActive) {
      await t.rollback();
      return fail(httpStatus.BAD_REQUEST, `${session.sessionName} is already the current session.`);
    }

    await Session.update(
      { isActive: false },
      { where: { instituteId: createdBy.instituteId, isDeleted: false }, transaction: t },
    );
    await session.update({ isActive: true }, { transaction: t });
    await t.commit();

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `${session.sessionName} is now the current session.`,
      data: session,
    };
  } catch (e: any) {
    await t.rollback();
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
  }
};

// ─── UPDATE SESSION ───────────────────────────────────────────────────────────
// Name and dates can change; students keep the session by name, so a rename is carried over.
const updateSession = async (sessionId: string, body: any, createdBy: any): Promise<any> => {
  const instituteId = createdBy.instituteId;
  const t = await sequelize.transaction();
  try {
    const session = await Session.findOne({ where: { sessionId, instituteId, isDeleted: false }, transaction: t });
    if (!session) {
      await t.rollback();
      return fail(httpStatus.NOT_FOUND, "Session not found.");
    }

    const checked = validateSession(
      body.sessionName ?? session.sessionName,
      body.startDate ?? session.startDate,
      body.endDate ?? session.endDate,
    );
    if (!checked.ok) {
      await t.rollback();
      return fail(httpStatus.BAD_REQUEST, checked.message);
    }
    const { sessionName, startDate, endDate } = checked;
    const oldName = session.sessionName;

    if (sessionName !== oldName) {
      const taken = await Session.findOne({
        where: { instituteId, sessionName, sessionId: { [Op.ne]: sessionId } },
        transaction: t,
      });
      if (taken) {
        await t.rollback();
        return fail(
          httpStatus.CONFLICT,
          taken.isDeleted
            ? `A deleted session named ${sessionName} exists. Create ${sessionName} again to restore it instead.`
            : `Session ${sessionName} already exists.`,
        );
      }
    }

    const overlap = await findOverlap(instituteId, startDate, endDate, sessionId);
    if (overlap) {
      await t.rollback();
      return fail(
        httpStatus.CONFLICT,
        `These dates overlap session ${overlap.sessionName} (${formatDay(overlap.startDate)} – ${formatDay(overlap.endDate)}).`,
      );
    }

    await session.update({ sessionName, startDate, endDate }, { transaction: t });
    if (sessionName !== oldName) {
      await StudentProfile.update({ session: sessionName }, { where: { instituteId, session: oldName }, transaction: t });
    }
    await t.commit();

    return { error: false, statusCode: httpStatus.OK, message: `Session ${sessionName} updated.`, data: session };
  } catch (e: any) {
    await t.rollback();
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
  }
};

// ─── DELETE SESSION ───────────────────────────────────────────────────────────
const deleteSession = async (sessionId: string, createdBy: any): Promise<any> => {
  try {
    const instituteId = createdBy.instituteId;
    const session = await Session.findOne({ where: { sessionId, instituteId, isDeleted: false } });
    if (!session) return fail(httpStatus.NOT_FOUND, "Session not found.");

    if (session.isActive) {
      return fail(httpStatus.BAD_REQUEST, "The current session can't be deleted. Make another session current first.");
    }

    const [students, exams] = await Promise.all([
      StudentProfile.count({ where: { instituteId, session: session.sessionName } }),
      Exam.count({ where: { instituteId, sessionId, isDeleted: false } }),
    ]);
    if (students || exams) {
      const used = [students && `${students} student${students === 1 ? "" : "s"}`, exams && `${exams} exam${exams === 1 ? "" : "s"}`]
        .filter(Boolean)
        .join(" and ");
      return fail(httpStatus.CONFLICT, `${session.sessionName} can't be deleted because ${used} belong to it.`);
    }

    await session.update({ isDeleted: true, isActive: false });
    return { error: false, statusCode: httpStatus.OK, message: `Session ${session.sessionName} deleted.`, data: {} };
  } catch (e: any) {
    return fail(httpStatus.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
  }
};

export default {
  createSession,
  getAllSessions,
  getSessionById,
  getActiveSession,
  activateSession,
  updateSession,
  deleteSession,
};
