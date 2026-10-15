import httpStatus from "http-status";
import { Response } from "express";
import SessionSetupService from "../../services/academic/sessionSetup.service";

// Session setup: what runs in each session (sections + class teachers, subjects + subject teachers).

const send = (res: Response, run: () => Promise<any>) =>
  run()
    .then((result) => res.status(result.statusCode).send(result))
    .catch(() => res.status(httpStatus.INTERNAL_SERVER_ERROR).json({ error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Internal Server Error" }));

const blankToNull = (v: unknown) => (v === undefined || v === null || v === "" || v === "null" ? null : String(v));

/** GET /session-setup/:sessionId? — the session's classes, sections, subjects and teachers. */
const getSetup = (req: any, res: Response) => send(res, () => SessionSetupService.getSetup(req.viaExamUser, req.params.sessionId));

/** PUT /session-setup/:sessionId/classes/:classId — { sections: [{ sectionId, classTeacherId }], subjects: [{ subjectId, teacherId }] } */
const saveClass = (req: any, res: Response) =>
  send(res, () => SessionSetupService.saveClass(req.viaExamUser, req.params.sessionId, req.params.classId, req.body ?? {}));

/** PATCH /session-setup/:sessionId/sections/:sectionId — { classTeacherId } */
const setClassTeacher = (req: any, res: Response) =>
  send(res, () => SessionSetupService.setClassTeacher(req.viaExamUser, req.params.sessionId, req.params.sectionId, blankToNull(req.body?.classTeacherId)));

/** PATCH /session-setup/:sessionId/subjects/:subjectId — { teacherId } */
const setSubjectTeacher = (req: any, res: Response) =>
  send(res, () => SessionSetupService.setSubjectTeacher(req.viaExamUser, req.params.sessionId, req.params.subjectId, blankToNull(req.body?.teacherId)));

/** POST /session-setup/:sessionId/copy — { fromSessionId, classIds?, classTeachers?, subjectTeachers?, marks? } */
const copySetup = (req: any, res: Response) => send(res, () => SessionSetupService.copySetup(req.viaExamUser, req.params.sessionId, req.body ?? {}));

export default { getSetup, saveClass, setClassTeacher, setSubjectTeacher, copySetup };
