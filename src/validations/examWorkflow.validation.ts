import Joi from "joi";
import { RECHECK_CATEGORIES } from "../models/RecheckRequest.model";

// Ids are business keys: old "IB12345678" and new "VIEXM…" shapes both pass.
const id = Joi.string().trim().max(64).pattern(/^[A-Za-z0-9_-]+$/);
const page = Joi.number().integer().min(1).max(100000);
const limit = Joi.number().integer().min(1).max(100);
const text = (max: number) => Joi.string().trim().max(max).allow("", null);
// Clients add ?_t=<timestamp> to defeat caches.
const cacheBuster = Joi.any();

const examParam = { params: Joi.object({ examId: id.required() }) };
const requestParam = { params: Joi.object({ requestId: id.required() }) };
const sheetParam = { params: Joi.object({ sheetId: id.required() }) };

const listPipeline = {
  query: Joi.object({
    page,
    limit,
    search: text(100),
    examType: text(60),
    sessionId: id.allow(""),
    classId: id.allow(""),
    _t: cacheBuster,
  }),
};

const assignScanner = {
  ...examParam,
  body: Joi.object({ scannerId: id.required(), note: text(500) }),
};

const myScanExams = {
  query: Joi.object({ page, limit, status: Joi.string().valid("ASSIGNED", "COMPLETED", "").insensitive(), sessionId: id.allow(""), _t: cacheBuster }),
};

const setAttendance = {
  ...examParam,
  body: Joi.object({
    studentIds: Joi.array().items(id.required()).min(1).max(500).unique().required(),
    absent: Joi.boolean().required(),
    note: text(500),
  }),
};

const listResults = {
  query: Joi.object({
    page,
    limit,
    examId: id.allow(""),
    classId: id.allow(""),
    sectionId: id.allow(""),
    subjectId: id.allow(""),
    sessionId: id.allow(""),
    examType: text(60),
    resultStatus: Joi.string().valid("PASS", "FAIL", "ABSENT", "NOT_EVALUATED", "").insensitive(),
    search: text(100),
    _t: cacheBuster,
  }),
};

const classResults = {
  query: Joi.object({
    classId: id.required(),
    sectionId: id.allow(""),
    sessionId: id.allow(""),
    examType: text(60),
    _t: cacheBuster,
  }),
};

const myResults = {
  query: Joi.object({ examType: text(60), sessionId: id.allow(""), _t: cacheBuster }),
};

const resultParam = { params: Joi.object({ resultId: id.required() }), query: Joi.object({ _t: cacheBuster }) };
const myClaims = { query: Joi.object({ _t: cacheBuster }) };
const myReportCard = {
  query: Joi.object({ sessionId: id.required(), examType: Joi.string().trim().max(60).required(), _t: cacheBuster }),
};

const createRecheck = {
  body: Joi.object({
    examId: id,
    evaluationId: id,
    category: Joi.string()
      .valid(...RECHECK_CATEGORIES.map((c) => c.key))
      .required()
      .messages({ "any.required": "Choose what kind of marking concern this is.", "any.only": "Choose what kind of marking concern this is." }),
    // The questions the claim is about (the evaluation's keys); none for the whole paper.
    questions: Joi.array().items(Joi.string().trim().max(40)).max(60).unique(),
    reason: Joi.string().trim().min(10).max(1000).required().messages({
      "string.min": "Tell us in a sentence or two why the answer sheet should be rechecked.",
    }),
  }).or("examId", "evaluationId"),
};

const listRechecks = {
  query: Joi.object({
    page,
    limit,
    status: Joi.string().valid("Pending", "Under Review", "Awaiting Approval", "Completed", "Rejected", "Approved", ""),
    examId: id.allow(""),
    _t: cacheBuster,
  }),
};

const assignRecheck = { ...requestParam, body: Joi.object({ teacherId: id.allow("", null) }) };
const rejectRecheck = { ...requestParam, body: Joi.object({ note: Joi.string().trim().min(3).max(1000).required() }) };
const approveRecheck = { ...requestParam, body: Joi.object({}) };
// Sending a decision back always says what to look at again.
const returnRecheck = {
  ...requestParam,
  body: Joi.object({ note: Joi.string().trim().min(3).max(1000).required().messages({ "any.required": "Say what the teacher should look at again." }) }),
};
const myRechecks = { query: Joi.object({ page, limit, state: Joi.string().valid("open", "done", ""), _t: cacheBuster }) };
const completeRecheck = {
  ...requestParam,
  body: Joi.object({
    revisedScore: Joi.number().min(0).max(10000).precision(2).required(),
    note: text(1000),
  }),
};

// A scanner's request to re-open a completed upload, and the admin's answer (a note is
// required to reject; the service checks that, since approve and reject share the shape).
const requestReopen = { ...examParam, body: Joi.object({ reason: Joi.string().trim().min(5).max(500).required() }) };
const listReopenRequests = { query: Joi.object({ status: Joi.string().valid("PENDING", "DECIDED", "ALL", "").insensitive(), _t: cacheBuster }) };
const decideReopen = { ...requestParam, body: Joi.object({ note: text(500) }) };

export default {  sheetParam,

  classResults,
  examParam,
  listPipeline,
  assignScanner,
  myScanExams,
  setAttendance,
  listResults,
  myResults,
  resultParam,
  myClaims,
  myReportCard,
  createRecheck,
  listRechecks,
  assignRecheck,
  rejectRecheck,
  approveRecheck,
  returnRecheck,
  myRechecks,
  completeRecheck,
  requestReopen,
  listReopenRequests,
  decideReopen,
};
