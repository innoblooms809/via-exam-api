import httpStatus from "http-status";
import { QueryTypes } from "sequelize";
import { sequelize } from "../../config/sequelize";
import logger from "../../config/logger";
import Notification from "../../models/Notification.model";
import { openSessionIds } from "../academic/sessionSetup.service";
import { notifyAll, workLabel } from "../notification/notifyPeople";
import { DAY_OF_EXAM, EXAM_DAY, EXAM_NAMES, EXAM_SESSION } from "./home.service";
import { OPEN_WORK_SQL, PAPER_WITH_SETTER, WORK_KINDS, isWorkKind, type WorkKind } from "./openWork";

// The admin's Staff workload page: every teacher's and scanner's open work, piece by piece,
// and a reminder about any one piece. A reminder is an ordinary notification, so it is pushed
// and opens the work like the others, and it leaves on its own once the work is done (see
// clearFinishedWork). "Last reminded" is read from those notifications, deleted ones included,
// so someone deleting a reminder doesn't let it be sent again straight away.

/** How long after a reminder the same work can be reminded about again. */
const REMINDER_COOLDOWN_MS = 60 * 60 * 1000;

const KINDS = Object.keys(WORK_KINDS) as WorkKind[];

const STAFF_WORK_SQL = (only: string) => `
WITH ${EXAM_DAY},
reminded AS (
  SELECT "userId", "referenceId", type, MAX("createdAt") AS at
  FROM viaexam_notifications
  WHERE "instituteId" = :inst AND type IN (:reminders)
  GROUP BY 1, 2, 3
)
SELECT w."userId", u."userName" AS name, ro.role, w.kind, w."referenceId", w."examId", w.since, w.sections,
       e.status, e."examType", ${DAY_OF_EXAM} AS "examDate", c."className", sec."sectionName", sub."subjectName",
       sx."sessionName", sx."isActive" AS "sessionIsCurrent", rem.at AS "remindedAt"
FROM (${OPEN_WORK_SQL}) w
JOIN viaexam_users u ON u."userId" = w."userId" AND u."isDeleted" = false
JOIN roles ro ON ro.id = u."roleId"
JOIN viaexam_exams e ON e."examId" = w."examId"
LEFT JOIN exam_day ON exam_day."examId" = e."examId"
${EXAM_NAMES}
${EXAM_SESSION}
LEFT JOIN reminded rem ON rem."userId" = w."userId" AND rem."referenceId" = w."referenceId"
 AND rem.type = CASE w.kind ${KINDS.map((k) => `WHEN '${k}' THEN '${WORK_KINDS[k].reminder}'`).join(" ")} END
WHERE ro.role IN ('TEACHER', 'SCANNER') ${only}
ORDER BY "examDate" NULLS LAST, w.since`;

const loadWork = async (instituteId: string, only = "", extra: Record<string, unknown> = {}) => {
  const open = await openSessionIds(instituteId);
  return sequelize.query<any>(STAFF_WORK_SQL(only), {
    type: QueryTypes.SELECT,
    replacements: {
      inst: instituteId,
      open: open.length ? open : [""],
      withSetter: PAPER_WITH_SETTER,
      reminders: KINDS.map((k) => WORK_KINDS[k].reminder),
      ...extra,
    },
  });
};

const PAPER_STATE: Record<string, string> = { Draft: "not-started", "Paper Created": "writing", Rejected: "sent-back" };

const canRemindAt = (remindedAt: Date | string | null) => (remindedAt ? new Date(new Date(remindedAt).getTime() + REMINDER_COOLDOWN_MS).toISOString() : null);

const toItem = (r: any) => ({
  key: `${r.kind}:${r.referenceId}`,
  kind: r.kind as WorkKind,
  referenceId: r.referenceId,
  examId: r.examId,
  subjectName: r.subjectName ?? "",
  examType: r.examType ?? "",
  className: r.className ?? "",
  sectionName: r.sectionName || r.sections || "",
  sessionName: r.sessionName ?? null,
  /** Work left over from another session, which the page names. */
  otherSession: r.sessionIsCurrent === false,
  examDate: r.examDate ?? null,
  paperState: r.kind === "papers" ? (PAPER_STATE[r.status] ?? null) : null,
  givenAt: r.since ?? null,
  remindedAt: r.remindedAt ? new Date(r.remindedAt).toISOString() : null,
  canRemindAt: canRemindAt(r.remindedAt),
});

/** GET /v1/home/staff-work — open work per person, busiest first. */
const getStaffWork = async (admin: any) => {
  try {
    const instituteId = String(admin?.instituteId ?? "");
    if (!instituteId) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Institute not found for this user." };
    type Person = { userId: string; name: string; role: "teacher" | "scanner"; total: number; items: ReturnType<typeof toItem>[] };
    const people = new Map<string, Person>();
    for (const r of await loadWork(instituteId)) {
      const person: Person = people.get(r.userId) ?? { userId: r.userId, name: r.name ?? "", role: r.role === "SCANNER" ? "scanner" : "teacher", total: 0, items: [] };
      person.items.push(toItem(r));
      person.total += 1;
      people.set(r.userId, person);
    }
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Staff work loaded.",
      data: { people: [...people.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)) },
    };
  } catch (e: any) {
    logger.error(`[StaffWork] list: ${e?.message || e}`);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Could not load the staff workload." };
  }
};

/** What a reminder says. It names the work, so the person knows what is being asked of them without opening it. */
const reminderText = (r: any): { title: string; message: string } => {
  const work = workLabel(
    { subject: { subjectName: r.subjectName }, examType: r.examType, class: { className: r.className }, section: r.sectionName ? { sectionName: r.sectionName } : null },
    String(r.sections ?? "").split(", ")
  );
  switch (r.kind as WorkKind) {
    case "papers":
      return r.status === "Rejected"
        ? { title: "Reminder: question paper to fix", message: `Your admin is waiting for your changes to the question paper of ${work}, which was sent back.` }
        : { title: "Reminder: question paper to set", message: `Your admin reminded you to set the question paper for ${work}.` };
    case "evaluations":
      return { title: "Reminder: AI evaluation to finish", message: `Your admin reminded you to finish the AI evaluation of ${work}.` };
    case "crossChecks":
      return { title: "Reminder: cross-check to finish", message: `Your admin reminded you to finish the cross-check of ${work}.` };
    case "rechecks":
      return { title: "Reminder: recheck to finish", message: `Your admin reminded you to finish re-evaluating one answer sheet of ${work}.` };
    default:
      return { title: "Reminder: answer sheets to upload", message: `Your admin reminded you to upload the answer sheets of ${work} and mark the upload complete.` };
  }
};

const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** POST /v1/home/staff-work/remind — { userId, kind, referenceId }: one person, one piece of their open work. */
const sendReminder = async (admin: any, body: any) => {
  try {
    const instituteId = String(admin?.instituteId ?? "");
    const userId = clean(body?.userId);
    const referenceId = clean(body?.referenceId);
    const kind = body?.kind;
    if (!instituteId) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Institute not found for this user." };
    if (!userId || !referenceId || !isWorkKind(kind)) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Choose the work to send a reminder for." };

    const [work] = await loadWork(instituteId, `AND w."userId" = :user AND w.kind = :kind AND w."referenceId" = :ref`, { user: userId, kind, ref: referenceId });
    if (!work) return { error: true, statusCode: httpStatus.CONFLICT, message: "This work is no longer open, so no reminder was sent." };

    const type = WORK_KINDS[kind].reminder;
    const same = { instituteId, userId, type, referenceId };
    return await sequelize.transaction(async (t) => {
      // Two admins clicking together send one reminder.
      await sequelize.query(`SELECT pg_advisory_xact_lock(hashtext(:key))`, { replacements: { key: `viaexam:reminder:${userId}:${type}:${referenceId}` }, transaction: t });
      const last = await Notification.findOne({ where: same, attributes: ["createdAt"], order: [["createdAt", "DESC"]], transaction: t });
      const next = last ? canRemindAt(last.createdAt) : null;
      if (next && new Date(next).getTime() > Date.now()) {
        return {
          error: true,
          statusCode: httpStatus.CONFLICT,
          message: "A reminder for this work was sent recently. It can be sent again in a while.",
          data: { remindedAt: new Date(last!.createdAt).toISOString(), canRemindAt: next },
        };
      }
      // A newer reminder takes the place of the old one, so the person's list holds one per piece of work.
      await Notification.update({ isDeleted: true }, { where: { ...same, isDeleted: false }, transaction: t });
      await notifyAll([{ instituteId, userId, type, referenceId, ...reminderText(work) }], t);
      const remindedAt = new Date().toISOString();
      return {
        error: false,
        statusCode: httpStatus.CREATED,
        message: "Reminder sent.",
        data: { remindedAt, canRemindAt: canRemindAt(remindedAt) },
      };
    });
  } catch (e: any) {
    logger.error(`[StaffWork] remind: ${e?.message || e}`);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Could not send the reminder." };
  }
};

export default { getStaffWork, sendReminder };
