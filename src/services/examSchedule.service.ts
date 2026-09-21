// Exam schedule ("date sheet") for the teacher / student / scanner portals.
//
// A date sheet is one exam of one class in one session — e.g. "Mid Term · Class 7 ·
// 2025-2026" — with one paper per subject. It is built from two sources:
//
//   • academic calendar events  → WHEN a paper is written (date, start/end time, duration)
//   • exams + question-paper sets → WHETHER the paper is ready (per-set approval, marks)
//
// They are joined on session + class + exam type + subject. A paper can exist on only
// one side: scheduled but no exam created yet, or approved but not yet given a date.
//
// Scope is enforced here, not in the UI: students only ever receive their own class.
// Date-relative state (upcoming / ongoing / archived) is left to the client, which knows
// the viewer's local "today".

import httpStatus from "http-status";
import { Op } from "sequelize";
import AcademicCalendar from "../modals/AcademicCalendar.modal";
import Exam from "../modals/Exam.modal";
import Class from "../modals/Class.modal";
import Subject from "../modals/Subject.modal";
import Session from "../modals/Session.modal";
import Institute from "../modals/Institute.modal";
import StudentProfile from "../modals/Student.modal";
import QuestionPaper from "../modals/question-paper/QuestionPaper.modal";
import QuestionPaperAnswer from "../modals/question-paper/stander-answer.model";
import { isShift } from "../utils/examTime";

export type PaperApproval = "approved" | "pending" | "rejected" | "in_preparation" | "not_created";

export interface SchedulePaper {
  key: string;
  eventId: string | null;
  examId: string | null;
  subjectId: string | null;
  subjectName: string;
  subjectCode: string | null;
  /** YYYY-MM-DD, or null when the paper has no date yet. */
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  /** "First Shift" / "Second Shift" as scheduled; null on older events (derive from the time). */
  shift: string | null;
  /** Free text from the calendar ("3 Hours"). */
  duration: string | null;
  /** Exam duration in minutes, used when the calendar has none. */
  durationMinutes: number | null;
  totalMarks: number | null;
  passingMarks: number | null;
  approval: PaperApproval;
  /** Approved set letters. Staff only — never sent to students. */
  approvedSets?: string[];
  examStatus?: string | null;
}

export interface DateSheet {
  key: string;
  sessionId: string | null;
  sessionName: string;
  classId: string | null;
  className: string;
  examType: string;
  papers: SchedulePaper[];
}

type ViewerRole = "student" | "teacher" | "scanner" | "admin";

const APPROVED_STATUS_LIST = ["APPROVED", "PUBLISHED", "LIVE", "COMPLETED"];
const isApprovedStatus = (s: unknown): boolean => APPROVED_STATUS_LIST.includes(String(s || "").trim().toUpperCase());

/** "Mid Term", "Mid-Term" and "midterm" are the same exam. */
const typeKey = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const nameKey = (value: unknown) => String(value ?? "").trim().toLowerCase();

const viewerRole = (user: any): ViewerRole => {
  const role = String(user?.role?.role ?? user?.role ?? "").toUpperCase();
  if (role.includes("STUDENT")) return "student";
  if (role.includes("TEACH")) return "teacher";
  if (role.includes("SCAN")) return "scanner";
  return "admin";
};

/** Legacy events kept their details as JSON in the description. */
const legacyDetails = (description: string | null): Record<string, any> => {
  if (!description || !description.trim().startsWith("{")) return {};
  try {
    return JSON.parse(description);
  } catch {
    return {};
  }
};

const toDateOnly = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const d = new Date(value as any);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/** One approval state for an exam, from the statuses of its sets. */
const approvalOf = (
  exam: Exam | undefined,
  sets: QuestionPaper[],
  answers: QuestionPaperAnswer[] = []
): PaperApproval => {
  if (!exam) return "not_created";
  const setStatuses = sets.map((s) => String(s.status || "").trim().toUpperCase());
  const ansStatuses = answers.map((a) => String(a.status || "").trim().toUpperCase());
  const examStatus = String(exam.status || "").trim().toUpperCase();

  if (
    setStatuses.some(isApprovedStatus) ||
    ansStatuses.some(isApprovedStatus) ||
    isApprovedStatus(examStatus)
  ) {
    return "approved";
  }

  if (
    setStatuses.includes("PENDING_APPROVAL") ||
    ansStatuses.includes("PENDING_APPROVAL") ||
    examStatus.includes("PENDING")
  ) {
    return "pending";
  }

  if (
    setStatuses.includes("REJECTED") ||
    ansStatuses.includes("REJECTED") ||
    examStatus.includes("REJECTED")
  ) {
    return "rejected";
  }

  return "in_preparation";
};

/** Resolves the class a student belongs to (older profiles only carry the class name). */
const studentClass = async (user: any, instituteId: string) => {
  const profile = await StudentProfile.findOne({ where: { userId: user.userId } });
  if (!profile) return null;
  if (profile.classId) {
    const cls = await Class.findOne({ where: { classId: profile.classId } });
    return { classId: profile.classId, className: cls?.className || profile.className };
  }
  const cls = await Class.findOne({
    where: { instituteId, className: profile.className, isDeleted: false },
  });
  return cls ? { classId: cls.classId, className: cls.className } : null;
};

export const getExamSchedule = async (user: any) => {
  try {
    const instituteId: string | undefined = user?.instituteId;
    if (!instituteId) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Institute not found for user." };
    }
    const role = viewerRole(user);

    // ── Scope ───────────────────────────────────────────────────────────────
    let scopedClass: { classId: string; className: string } | null = null;
    if (role === "student") {
      scopedClass = await studentClass(user, instituteId);
      if (!scopedClass) {
        return {
          error: true,
          statusCode: httpStatus.NOT_FOUND,
          message: "Your class is not set on your student profile. Please contact the school office.",
        };
      }
    }

    // A student sees their class plus school-wide papers (no class on them).
    const eventWhere: any = { instituteId, isDeleted: false };
    const examWhere: any = { instituteId, isDeleted: false };
    if (scopedClass) {
      eventWhere[Op.or] = [
        { classId: scopedClass.classId },
        {
          classId: null,
          [Op.or]: [{ className: null }, { className: { [Op.in]: ["", "All", scopedClass.className] } }],
        },
      ];
      examWhere[Op.or] = [{ classId: scopedClass.classId }, { classId: null }];
    }

    const [institute, sessions, classes, events, exams] = await Promise.all([
      user.institute ?? Institute.findOne({ where: { instituteId } }),
      Session.findAll({ where: { instituteId, isDeleted: false }, order: [["startDate", "DESC"]] }),
      Class.findAll({ where: { instituteId } }),
      AcademicCalendar.findAll({ where: eventWhere, order: [["eventDate", "ASC"]] }),
      Exam.findAll({ where: examWhere }),
    ]);

    const examIds = exams.map((e) => e.examId);
    const subjectIds = Array.from(
      new Set([...exams.map((e) => e.subjectId), ...events.map((e) => e.subjectId)].filter(Boolean))
    ) as string[];

    const [sets, answers, subjects] = await Promise.all([
      examIds.length
        ? QuestionPaper.findAll({
            where: { examId: { [Op.in]: examIds } },
            attributes: ["examId", "paperSet", "status"],
          })
        : [],
      examIds.length
        ? QuestionPaperAnswer.findAll({
            where: { examId: { [Op.in]: examIds } },
            attributes: ["examId", "paperSet", "status"],
          })
        : [],
      subjectIds.length ? Subject.findAll({ where: { subjectId: { [Op.in]: subjectIds } } }) : [],
    ]);

    const sessionById = new Map(sessions.map((s) => [s.sessionId, s]));
    const classById = new Map(classes.map((c) => [c.classId, c]));
    const classIdByName = new Map(classes.map((c) => [nameKey(c.className), c.classId]));
    const subjectById = new Map(subjects.map((s) => [s.subjectId, s]));
    const setsByExam = new Map<string, QuestionPaper[]>();
    for (const s of sets) setsByExam.set(s.examId, [...(setsByExam.get(s.examId) ?? []), s]);
    const answersByExam = new Map<string, QuestionPaperAnswer[]>();
    for (const a of answers) answersByExam.set(a.examId, [...(answersByExam.get(a.examId) ?? []), a]);

    const sheets = new Map<string, DateSheet>();
    const sheetFor = (sessionId: string | null, classId: string | null, className: string, examType: string) => {
      const key = `${sessionId ?? "-"}|${classId ?? nameKey(className) ?? "-"}|${typeKey(examType)}`;
      let sheet = sheets.get(key);
      if (!sheet) {
        sheet = {
          key,
          sessionId,
          sessionName: (sessionId && sessionById.get(sessionId)?.sessionName) || "—",
          classId,
          className: className || "All Classes",
          examType: examType || "Exam",
          papers: [],
        };
        sheets.set(key, sheet);
      }
      return sheet;
    };

    // Exams indexed by the join key, so each calendar paper can find its exam.
    const examKey = (sessionId: string | null, classId: string | null, examType: string, subjectId: string | null) =>
      `${sessionId ?? "-"}|${classId ?? "-"}|${typeKey(examType)}|${subjectId ?? "-"}`;
    const examByKey = new Map<string, Exam>();
    for (const exam of exams) {
      examByKey.set(examKey(exam.sessionId, exam.classId, exam.examType, exam.subjectId), exam);
    }
    const matchedExamIds = new Set<string>();

    const paperFromExam = (exam: Exam | undefined) => {
      const examSets = exam ? setsByExam.get(exam.examId) ?? [] : [];
      const examAnswers = exam ? answersByExam.get(exam.examId) ?? [] : [];
      const approval = approvalOf(exam, examSets, examAnswers);
      const approvedSetList = Array.from(
        new Set([
          ...examSets.filter((s) => isApprovedStatus(s.status)).map((s) => s.paperSet),
          ...examAnswers.filter((a) => isApprovedStatus(a.status)).map((a) => a.paperSet),
        ])
      )
        .filter(Boolean)
        .sort();

      return {
        examId: exam?.examId ?? null,
        totalMarks: exam?.totalMarks ?? null,
        passingMarks: exam?.passingMarks ?? null,
        durationMinutes: exam?.duration ?? null,
        approval,
        examStatus: exam?.status ?? null,
        approvedSets: approvedSetList,
      };
    };

    // ── 1. Scheduled papers (calendar) ──────────────────────────────────────
    for (const ev of events) {
      const extra = legacyDetails(ev.description);
      const subjectId: string | null = ev.subjectId || extra.subjectId || null;
      const subjectName: string = ev.subjectName || extra.subject || subjectById.get(subjectId ?? "")?.subjectName || "";
      if (!subjectId && !subjectName) continue; // not an exam paper (e.g. a holiday)

      const examType: string = ev.eventType || extra.examType || "Exam";
      const sessionId: string | null = ev.sessionId || extra.sessionId || null;
      const rawClassName: string = ev.className || extra.className || "";
      const classId: string | null =
        ev.classId || extra.classId || classIdByName.get(nameKey(rawClassName)) || null;
      const className = (classId && classById.get(classId)?.className) || rawClassName;

      // Calendar events saved without a session still find their exam by class + type + subject.
      let exam = examByKey.get(examKey(sessionId, classId, examType, subjectId));
      if (!exam && !sessionId) {
        exam = exams.find(
          (e) => e.classId === classId && typeKey(e.examType) === typeKey(examType) && e.subjectId === subjectId
        );
      }
      if (exam) matchedExamIds.add(exam.examId);

      sheetFor(sessionId ?? exam?.sessionId ?? null, classId, className, examType).papers.push({
        key: ev.eventId,
        eventId: ev.eventId,
        subjectId,
        subjectName: subjectName || "—",
        subjectCode: subjectById.get(subjectId ?? "")?.subjectCode ?? null,
        date: toDateOnly(ev.eventDate),
        startTime: ev.startTime || null,
        endTime: ev.endTime || null,
        duration: ev.duration || extra.duration || null,
        shift: isShift(extra.shift) ? extra.shift : null,
        ...paperFromExam(exam),
      });
    }

    // ── 2. Exams with no date yet ───────────────────────────────────────────
    // Only approved ones: they are ready to be written and belong on the Approved list.
    for (const exam of exams) {
      if (matchedExamIds.has(exam.examId)) continue;
      const details = paperFromExam(exam);
      if (details.approval !== "approved") continue;
      const subject = subjectById.get(exam.subjectId);
      const className = (exam.classId && classById.get(exam.classId)?.className) || "All Classes";
      sheetFor(exam.sessionId, exam.classId, className, exam.examType).papers.push({
        key: `exam-${exam.examId}`,
        eventId: null,
        subjectId: exam.subjectId,
        subjectName: subject?.subjectName || exam.subjectId,
        subjectCode: subject?.subjectCode ?? null,
        date: null,
        startTime: null,
        endTime: null,
        duration: null,
        shift: null,
        ...details,
      });
    }

    // ── Output ──────────────────────────────────────────────────────────────
    const byDate = (a: SchedulePaper, b: SchedulePaper) =>
      (a.date ?? "9999").localeCompare(b.date ?? "9999") ||
      String(a.startTime ?? "").localeCompare(String(b.startTime ?? "")) ||
      a.subjectName.localeCompare(b.subjectName);

    const result = Array.from(sheets.values()).map((sheet) => {
      sheet.papers.sort(byDate);
      if (role === "student") {
        // Which sets exist / are approved is internal to the school.
        sheet.papers = sheet.papers.map(({ approvedSets: _sets, examStatus: _status, ...paper }) => paper);
      }
      return sheet;
    });

    const inst: any = institute;
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Exam schedule fetched successfully.",
      data: {
        viewer: { role, classId: scopedClass?.classId ?? null, className: scopedClass?.className ?? null },
        institute: inst
          ? {
              name: inst.instituteName,
              logoUrl: inst.logoUrl ?? null,
              boardType: inst.boardType ?? null,
              address: [inst.addressLine1, inst.addressLine2, inst.city, inst.state, inst.pincode]
                .filter(Boolean)
                .join(", "),
            }
          : null,
        sessions: sessions.map((s) => ({
          sessionId: s.sessionId,
          sessionName: s.sessionName,
          isActive: s.isActive,
          startDate: toDateOnly(s.startDate),
          endDate: toDateOnly(s.endDate),
        })),
        sheets: result,
      },
    };
  } catch (error: any) {
    console.error("getExamSchedule Error:", error);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Failed to load the exam schedule: ${error.message}`,
    };
  }
};
