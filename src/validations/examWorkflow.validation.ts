import Joi from "joi";

// Ids are business keys: old "IB12345678" and new "VIEXM…" shapes both pass.
const id = Joi.string().trim().max(64).pattern(/^[A-Za-z0-9_-]+$/);
const page = Joi.number().integer().min(1).max(100000);
const limit = Joi.number().integer().min(1).max(100);
const text = (max: number) => Joi.string().trim().max(max).allow("", null);
// Clients add ?_t=<timestamp> to defeat caches.
const cacheBuster = Joi.any();

const examParam = { params: Joi.object({ examId: id.required() }) };
const requestParam = { params: Joi.object({ requestId: id.required() }) };

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

const createRecheck = {
  body: Joi.object({
    examId: id,
    evaluationId: id,
    reason: Joi.string().trim().min(10).max(1000).required().messages({
      "string.min": "Tell us in a sentence or two why the answer sheet should be rechecked.",
    }),
  }).or("examId", "evaluationId"),
};

const listRechecks = {
  query: Joi.object({
    page,
    limit,
    status: Joi.string().valid("Pending", "Under Review", "Completed", "Rejected", "Approved", ""),
    examId: id.allow(""),
    _t: cacheBuster,
  }),
};

const assignRecheck = { ...requestParam, body: Joi.object({ teacherId: id.allow("", null) }) };
const rejectRecheck = { ...requestParam, body: Joi.object({ note: Joi.string().trim().min(3).max(1000).required() }) };
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

export default {
  classResults,
  examParam,
  listPipeline,
  assignScanner,
  myScanExams,
  setAttendance,
  listResults,
  myResults,
  createRecheck,
  listRechecks,
  assignRecheck,
  rejectRecheck,
  myRechecks,
  completeRecheck,
  requestReopen,
  listReopenRequests,
  decideReopen,
};
