import httpStatus from "http-status";
import { QueryTypes } from "sequelize";
import { sequelize } from "../../config/sequelize";
import logger from "../../config/logger";
// A question paper counts as approved once the admin approves it (published is later still).
const PAPER_APPROVED = ["APPROVED", "PUBLISHED"];

// One person's page for the institute admin (GET /v1/home/people/:userId): who they
// are, what they look after, a few numbers, and a history of everything that
// happened to or by them. The history is read from the records themselves (papers,
// assignments, uploads, marks, results, rechecks), so it is complete even for work
// done before the activity log existed; the log only adds sign-ins.

const PEOPLE_ROLES = ["TEACHER", "SCANNER", "STUDENT"];
const HISTORY_LIMIT = 80;

const num = (v: unknown) => Number(v) || 0;
const select = <T extends object = any>(sql: string, replacements: Record<string, unknown>): Promise<T[]> =>
  sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements });

const EXAM_NAMES = `
  LEFT JOIN viaexam_classes c ON c."classId" = e."classId"
  LEFT JOIN viaexam_sections sec ON sec."sectionId" = e."sectionId"
  LEFT JOIN viaexam_subjects sub ON sub."subjectId" = e."subjectId"`;
const EXAM_COLUMNS = `e."examId", e."examType", e."examDate", c."className", sec."sectionName", sub."subjectName"`;

export type Tone = "blue" | "green" | "amber" | "rose" | "violet" | "cyan" | "slate";

export interface HistoryEvent {
  at: string;
  kind: string;
  title: string;
  detail?: string | null;
  tone: Tone;
  examId?: string | null;
}

const place = (className?: string | null, sectionName?: string | null) =>
  className ? `Class ${className}${sectionName ? `-${sectionName}` : ""}` : "";
/** "Mathematics · Mid Term · Class 9-A" */
const examName = (r: any) => [r.subjectName || "Subject", r.examType, place(r.className, r.sectionName)].filter(Boolean).join(" · ");
const examRef = (r: any) => ({
  examId: r.examId,
  name: examName(r),
  subjectName: r.subjectName ?? "",
  examType: r.examType ?? "",
  className: r.className ?? "",
  sectionName: r.sectionName ?? "",
  examDate: r.examDate ?? null,
});
const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : null);

const BASE_SQL = `
SELECT u."userId", u."userName", u."emailId", u."phoneNumber", u.status, u."profileUrl", u."createdAt", u."updatedAt",
       u."lastLoginAt", r.role,
       ps."presenceStatus", ps."lastActivityAt", ps."lastLoginAt" AS "presenceLoginAt"
FROM viaexam_users u
JOIN roles r ON r.id = u."roleId"
LEFT JOIN viaexam_user_presence_sessions ps ON ps."userId" = u."userId"
WHERE u."userId" = :id AND u."instituteId" = :inst AND u."isDeleted" = false`;

const SIGN_INS_SQL = `
SELECT "createdAt", "eventType" FROM viaexam_activity_logs
WHERE "userId" = :id AND "instituteId" = :inst AND "eventType" = 'LOGIN_SUCCESS'
ORDER BY "createdAt" DESC LIMIT 10`;

// ─── Teacher ──────────────────────────────────────────────────────────────────

const teacher = async (r: Record<string, unknown>) => {
  const [[profile], subjects, classTeacherOf, exams, papers, evaluations, rechecks] = await Promise.all([
    select(`SELECT "teacherType", qualification, specialization, experience, address, "joiningDate", dob, "isExaminer", "createdAt"
            FROM viaexam_teacher_profiles WHERE "userId" = :id`, r),
    select(`SELECT sub."subjectId", sub."subjectName", c."className"
            FROM viaexam_subjects sub
            LEFT JOIN viaexam_classes c ON c."classId" = sub."classId"
            WHERE sub."instituteId" = :inst AND sub."isDeleted" = false AND sub."teacherId" = :id
            ORDER BY c."className", sub."subjectName"`, r),
    select(`SELECT s."sectionId", s."sectionName", c."className", s."updatedAt"
            FROM viaexam_sections s LEFT JOIN viaexam_classes c ON c."classId" = s."classId"
            WHERE s."instituteId" = :inst AND s."isDeleted" = false AND s."classTeacherId" = :id`, r),
    select(`SELECT ${EXAM_COLUMNS}, e."createdAt", e.status FROM viaexam_exams e ${EXAM_NAMES}
            WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e."teacherId" = :id
            ORDER BY e."examDate" DESC NULLS LAST, e."createdAt" DESC`, r),
    select(`SELECT q."paperId", q.paper_set AS "paperSet", q.status, q."rejectionNote", q."createdAt", q."submittedAt", q."approvedAt", q."rejectedAt", ${EXAM_COLUMNS}
            FROM viaexam_question_papers q JOIN viaexam_exams e ON e."examId" = q."examId" ${EXAM_NAMES}
            WHERE q."instituteId" = :inst AND q."teacherId" = :id AND q."deletedAt" IS NULL`, r),
    select(`SELECT a."assignmentId", a."createdAt", a."reviewedAt", a."unassignedAt", a."isActive", ${EXAM_COLUMNS}
            FROM viaexam_evaluation_assignments a JOIN viaexam_exams e ON e."examId" = a."examId" ${EXAM_NAMES}
            WHERE a."instituteId" = :inst AND a."teacherId" = :id`, r),
    select(`SELECT ra."assignedAt", ra."completedAt", ra."previousScore", ra."revisedScore", u."userName" AS "studentName", ${EXAM_COLUMNS}
            FROM viaexam_recheck_assignments ra
            JOIN viaexam_recheck_requests rr ON rr."requestId" = ra."requestId"
            JOIN viaexam_exams e ON e."examId" = ra."examId" ${EXAM_NAMES}
            LEFT JOIN viaexam_users u ON u."userId" = rr."studentId"
            WHERE ra."instituteId" = :inst AND ra."teacherId" = :id`, r),
  ]);

  const history: HistoryEvent[] = [];
  for (const e of exams) {
    history.push({ at: e.createdAt, kind: "exam", tone: "blue", title: "Asked to set a paper", detail: examName(e), examId: e.examId });
  }
  for (const p of papers) {
    const set = p.paperSet ? `Set ${p.paperSet}` : "Paper";
    history.push({ at: p.createdAt, kind: "paper", tone: "slate", title: `Started ${set}`, detail: examName(p), examId: p.examId });
    if (p.submittedAt) history.push({ at: p.submittedAt, kind: "paper", tone: "amber", title: `Sent ${set} for approval`, detail: examName(p), examId: p.examId });
    if (p.approvedAt) history.push({ at: p.approvedAt, kind: "paper", tone: "green", title: `${set} approved`, detail: examName(p), examId: p.examId });
    if (p.rejectedAt)
      history.push({ at: p.rejectedAt, kind: "paper", tone: "rose", title: `${set} sent back`, detail: [examName(p), p.rejectionNote].filter(Boolean).join(" — "), examId: p.examId });
  }
  for (const a of evaluations) {
    history.push({ at: a.createdAt, kind: "evaluation", tone: "violet", title: "Made evaluator", detail: examName(a), examId: a.examId });
    if (a.reviewedAt) history.push({ at: a.reviewedAt, kind: "evaluation", tone: "green", title: "Finished checking the marks", detail: examName(a), examId: a.examId });
    if (a.unassignedAt) history.push({ at: a.unassignedAt, kind: "evaluation", tone: "slate", title: "Removed as evaluator", detail: examName(a), examId: a.examId });
  }
  for (const x of rechecks) {
    history.push({ at: x.assignedAt, kind: "recheck", tone: "blue", title: `Asked to recheck ${x.studentName || "a student"}'s sheet`, detail: examName(x), examId: x.examId });
    if (x.completedAt)
      history.push({
        at: x.completedAt,
        kind: "recheck",
        tone: "green",
        title: "Finished a recheck",
        detail: `${examName(x)} — ${x.previousScore ?? "?"} → ${x.revisedScore ?? "?"}`,
        examId: x.examId,
      });
  }

  const approved = papers.filter((p) => PAPER_APPROVED.includes(p.status)).length;
  return {
    profile: profile
      ? {
          teacherType: profile.teacherType ?? null,
          qualification: profile.qualification ?? null,
          specialization: profile.specialization ?? null,
          experience: profile.experience ?? null,
          address: profile.address ?? null,
          joiningDate: profile.joiningDate ?? null,
          dob: profile.dob ?? null,
          isExaminer: Boolean(profile.isExaminer),
        }
      : null,
    numbers: {
      subjects: subjects.length,
      examsToSet: exams.length,
      papersApproved: approved,
      papersWaiting: papers.filter((p) => p.status === "PENDING_APPROVAL").length,
      evaluationsOpen: evaluations.filter((a) => a.isActive && !a.reviewedAt).length,
      evaluationsDone: evaluations.filter((a) => a.reviewedAt).length,
      rechecksOpen: rechecks.filter((x) => !x.completedAt).length,
    },
    teaches: subjects.map((s) => ({ subjectId: s.subjectId, subjectName: s.subjectName, className: s.className ?? "" })),
    classTeacherOf: classTeacherOf.map((s) => ({ sectionId: s.sectionId, label: place(s.className, s.sectionName) })),
    exams: exams.map((e) => {
      const ps = papers.filter((p) => p.examId === e.examId);
      const ev = evaluations.find((a) => a.examId === e.examId && a.isActive);
      return {
        ...examRef(e),
        paper: ps.some((p) => PAPER_APPROVED.includes(p.status))
          ? "approved"
          : ps.some((p) => p.status === "PENDING_APPROVAL")
            ? "waiting"
            : ps.some((p) => p.status === "REJECTED")
              ? "sent-back"
              : ps.length
                ? "draft"
                : "not-started",
        evaluator: Boolean(ev),
      };
    }),
    evaluations: evaluations
      .filter((a) => a.isActive)
      .map((a) => ({ ...examRef(a), assignedAt: iso(a.createdAt), reviewedAt: iso(a.reviewedAt) })),
    history,
  };
};

// ─── Scanner ──────────────────────────────────────────────────────────────────

const scanner = async (r: Record<string, unknown>) => {
  const [[profile], assignments, uploads] = await Promise.all([
    select(`SELECT address, dob, gender, "createdAt" FROM viaexam_scanner_profiles WHERE "userId" = :id`, r),
    select(`SELECT a."assignmentId", a.status, a."isActive", a.note, a."createdAt", a."completedAt", a."unassignedAt", ${EXAM_COLUMNS},
                   (SELECT COUNT(*) FROM viaexam_answer_sheets s WHERE s."examId" = a."examId" AND s."isDeleted" = false)::int AS uploaded
            FROM viaexam_exam_scanner_assignments a JOIN viaexam_exams e ON e."examId" = a."examId" ${EXAM_NAMES}
            WHERE a."instituteId" = :inst AND a."scannerId" = :id
            ORDER BY a."createdAt" DESC`, r),
    // Uploads grouped per exam and day: one history line instead of one per sheet.
    select(`SELECT s."examId", (s."createdAt")::date AS day, MAX(s."createdAt") AS at, COUNT(*)::int AS n,
                   e."examType", e."examDate", c."className", sec."sectionName", sub."subjectName"
            FROM viaexam_answer_sheets s
            LEFT JOIN viaexam_exams e ON e."examId" = s."examId" ${EXAM_NAMES}
            WHERE s."instituteId" = :inst AND s."uploadedBy" = :id AND s."isDeleted" = false
            GROUP BY s."examId", (s."createdAt")::date, e."examType", e."examDate", c."className", sec."sectionName", sub."subjectName"`, r),
  ]);

  const history: HistoryEvent[] = [];
  for (const a of assignments) {
    history.push({ at: a.createdAt, kind: "scan", tone: "cyan", title: "Asked to scan an exam", detail: [examName(a), a.note].filter(Boolean).join(" — "), examId: a.examId });
    if (a.completedAt) history.push({ at: a.completedAt, kind: "scan", tone: "green", title: "Finished scanning", detail: examName(a), examId: a.examId });
    if (a.unassignedAt) history.push({ at: a.unassignedAt, kind: "scan", tone: "slate", title: "Taken off the exam", detail: examName(a), examId: a.examId });
  }
  for (const u of uploads) {
    history.push({
      at: u.at,
      kind: "upload",
      tone: "blue",
      title: `Uploaded ${u.n} answer ${u.n === 1 ? "sheet" : "sheets"}`,
      detail: u.examId ? examName(u) : null,
      examId: u.examId ?? null,
    });
  }

  const active = assignments.filter((a) => a.isActive);
  return {
    profile: profile ? { address: profile.address ?? null, dob: profile.dob ?? null, gender: profile.gender ?? null } : null,
    numbers: {
      open: active.filter((a) => a.status !== "COMPLETED").length,
      finished: active.filter((a) => a.status === "COMPLETED").length,
      sheets: uploads.reduce((s, u) => s + num(u.n), 0),
      lastUpload: uploads.reduce<string | null>((m, u) => (!m || new Date(u.at) > new Date(m) ? iso(u.at) : m), null),
    },
    assignments: active.map((a) => ({ ...examRef(a), status: a.status, uploaded: num(a.uploaded), assignedAt: iso(a.createdAt), completedAt: iso(a.completedAt) })),
    history,
  };
};

// ─── Student ──────────────────────────────────────────────────────────────────

const student = async (r: Record<string, unknown>) => {
  const [[profile]] = await Promise.all([
    select(`SELECT p."classId", p."sectionId", p."rollNumber", p.session, p."fatherName", p.gender, p.dob, p.address, p."isActive", p."createdAt", p."updatedAt",
                   c."className", s."sectionName", t."userName" AS "classTeacher"
            FROM viaexam_student_profiles p
            LEFT JOIN viaexam_classes c ON c."classId" = p."classId"
            LEFT JOIN viaexam_sections s ON s."sectionId" = p."sectionId"
            LEFT JOIN viaexam_users t ON t."userId" = s."classTeacherId"
            WHERE p."userId" = :id`, r),
  ]);
  const rr = { ...r, classId: profile?.classId ?? "", sectionId: profile?.sectionId ?? "", roll: String(profile?.rollNumber ?? "") };

  const [results, sheets, evaluations, absences, rechecks, exams] = await Promise.all([
    select(`SELECT res."marksObtained", res."totalMarks", res.percentage, res.grade, res."resultStatus", res."publishedAt", res."revisedAt", ${EXAM_COLUMNS}
            FROM viaexam_student_results res JOIN viaexam_exams e ON e."examId" = res."examId" ${EXAM_NAMES}
            WHERE res."instituteId" = :inst AND res."studentId" = :id AND res."isDeleted" = false
            ORDER BY res."publishedAt" DESC NULLS LAST`, r),
    // Sheets carry the roll number, not the student id: match within the student's class.
    select(`SELECT s."sheetId", s."createdAt", s.status, u."userName" AS "uploader", ${EXAM_COLUMNS}
            FROM viaexam_answer_sheets s JOIN viaexam_exams e ON e."examId" = s."examId" ${EXAM_NAMES}
            LEFT JOIN viaexam_users u ON u."userId" = s."uploadedBy"
            WHERE s."instituteId" = :inst AND s."isDeleted" = false AND s."classId" = :classId AND s."rollNo" = :roll
              AND (e."sectionId" IS NULL OR e."sectionId" = :sectionId)`, rr),
    select(`SELECT a.status, a."totalScore", a."updatedAt", ${EXAM_COLUMNS}
            FROM viaexam_ai_evaluations a JOIN viaexam_exams e ON e."examId" = a."examId" ${EXAM_NAMES}
            WHERE a."studentId" = :id AND e."instituteId" = :inst`, r),
    select(`SELECT a."createdAt", ${EXAM_COLUMNS}
            FROM viaexam_exam_attendance a JOIN viaexam_exams e ON e."examId" = a."examId" ${EXAM_NAMES}
            WHERE a."instituteId" = :inst AND a."studentId" = :id AND a.status = 'ABSENT'`, r),
    select(`SELECT q."requestId", q.status, q.reason, q."createdAt", q."reviewedAt", q."completedAt", ${EXAM_COLUMNS}
            FROM viaexam_recheck_requests q JOIN viaexam_exams e ON e."examId" = q."examId" ${EXAM_NAMES}
            WHERE q."instituteId" = :inst AND q."studentId" = :id`, r),
    select(`SELECT COUNT(*)::int AS n FROM viaexam_exams e
            WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e."classId" = :classId
              AND (e."sectionId" IS NULL OR e."sectionId" = :sectionId)`, rr),
  ]);

  const history: HistoryEvent[] = [];
  if (profile?.createdAt)
    history.push({ at: profile.createdAt, kind: "class", tone: "violet", title: `Joined ${place(profile.className, profile.sectionName) || "a class"}`, detail: profile.session ? `Session ${profile.session}, roll ${profile.rollNumber}` : null });
  for (const s of sheets)
    history.push({ at: s.createdAt, kind: "upload", tone: "blue", title: "Answer sheet uploaded", detail: [examName(s), s.uploader && `by ${s.uploader}`].filter(Boolean).join(" — "), examId: s.examId });
  for (const a of evaluations) {
    if (a.status === "Success")
      history.push({ at: a.updatedAt, kind: "evaluation", tone: "violet", title: `Marked by AI: ${a.totalScore ?? "?"} marks`, detail: examName(a), examId: a.examId });
    else if (a.status === "Failed")
      history.push({ at: a.updatedAt, kind: "evaluation", tone: "rose", title: "AI couldn't read the sheet", detail: examName(a), examId: a.examId });
  }
  for (const a of absences) history.push({ at: a.createdAt, kind: "attendance", tone: "amber", title: "Marked absent", detail: examName(a), examId: a.examId });
  for (const x of results) {
    if (x.publishedAt)
      history.push({
        at: x.publishedAt,
        kind: "result",
        tone: x.resultStatus === "FAIL" ? "rose" : "green",
        title: `Result published: ${num(x.marksObtained)}/${num(x.totalMarks)}${x.grade ? ` (${x.grade})` : ""}`,
        detail: examName(x),
        examId: x.examId,
      });
    if (x.revisedAt) history.push({ at: x.revisedAt, kind: "result", tone: "blue", title: `Marks changed to ${num(x.marksObtained)}`, detail: examName(x), examId: x.examId });
  }
  for (const q of rechecks) {
    history.push({ at: q.createdAt, kind: "recheck", tone: "amber", title: "Asked for a recheck", detail: [examName(q), q.reason].filter(Boolean).join(" — "), examId: q.examId });
    if (q.status === "Rejected" && q.reviewedAt) history.push({ at: q.reviewedAt, kind: "recheck", tone: "rose", title: "Recheck declined", detail: examName(q), examId: q.examId });
    if (q.completedAt) history.push({ at: q.completedAt, kind: "recheck", tone: "green", title: "Recheck done", detail: examName(q), examId: q.examId });
  }

  const pcts = results.filter((x) => x.publishedAt && x.percentage != null).map((x) => Number(x.percentage));
  return {
    profile: profile
      ? {
          classId: profile.classId,
          sectionId: profile.sectionId,
          className: profile.className ?? "",
          sectionName: profile.sectionName ?? "",
          rollNumber: profile.rollNumber ?? "",
          session: profile.session ?? "",
          classTeacher: profile.classTeacher ?? null,
          fatherName: profile.fatherName ?? null,
          gender: profile.gender ?? null,
          dob: profile.dob ?? null,
          address: profile.address ?? null,
          active: Boolean(profile.isActive),
        }
      : null,
    numbers: {
      exams: num(exams[0]?.n),
      sheets: sheets.length,
      results: results.filter((x) => x.publishedAt).length,
      average: pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : null,
      absent: absences.length,
      rechecksOpen: rechecks.filter((q) => ["Pending", "Under Review", "Approved"].includes(q.status)).length,
    },
    results: results
      .filter((x) => x.publishedAt)
      .map((x) => ({
        ...examRef(x),
        marks: num(x.marksObtained),
        total: num(x.totalMarks),
        percentage: x.percentage == null ? null : Number(x.percentage),
        grade: x.grade ?? null,
        passed: x.resultStatus === "PASS",
        status: x.resultStatus ?? null,
        publishedAt: iso(x.publishedAt),
      })),
    history,
  };
};

// ─── Entry ────────────────────────────────────────────────────────────────────

const getPerson = async (user: any, userId: string) => {
  try {
    const inst = String(user?.instituteId ?? "");
    const r = { id: String(userId ?? ""), inst };
    const [base] = await select(BASE_SQL, r);
    if (!base || !PEOPLE_ROLES.includes(base.role)) return { error: true, statusCode: httpStatus.NOT_FOUND, message: "This person was not found in your school." };

    const [part, signIns] = await Promise.all([
      base.role === "TEACHER" ? teacher(r) : base.role === "SCANNER" ? scanner(r) : student(r),
      select(SIGN_INS_SQL, r),
    ]);

    const history: HistoryEvent[] = [
      { at: base.createdAt, kind: "account", tone: "green" as Tone, title: "Added to the school", detail: base.emailId },
      ...part.history,
      ...signIns.map((s: any) => ({ at: s.createdAt, kind: "sign-in", tone: "slate" as Tone, title: "Signed in", detail: null })),
    ]
      .filter((h) => h.at)
      .map((h) => ({ ...h, at: iso(h.at)! }))
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, HISTORY_LIMIT);

    const lastSignIn = [base.presenceLoginAt, base.lastLoginAt, signIns[0]?.createdAt].filter(Boolean).map((d) => new Date(d).getTime());
    const { history: _h, ...rest } = part;
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Person loaded.",
      data: {
        userId: base.userId,
        name: base.userName ?? "",
        role: base.role,
        email: base.emailId ?? "",
        phone: base.phoneNumber ?? "",
        photo: base.profileUrl ?? null,
        status: num(base.status),
        addedAt: iso(base.createdAt),
        updatedAt: iso(base.updatedAt),
        lastSignIn: lastSignIn.length ? new Date(Math.max(...lastSignIn)).toISOString() : null,
        online: base.presenceStatus === "ONLINE" && base.lastActivityAt && Date.now() - new Date(base.lastActivityAt).getTime() < 15 * 60_000,
        ...rest,
        history,
      },
    };
  } catch (e: any) {
    logger.error(`[Home] person: ${e?.message || e}`);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Could not load this person." };
  }
};

export default { getPerson };
