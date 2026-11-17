import Joi from "joi";

// Ids are business keys: old "IB12345678" and new "VI…" shapes both pass.
const id = Joi.string().trim().max(64).pattern(/^[A-Za-z0-9_-]+$/);
const cacheBuster = Joi.alternatives(Joi.string().max(32), Joi.number());

/** Evaluator: asks to reopen a section they marked completed ("" = students without a section). */
const requestReopen = {
  params: Joi.object({ examId: id.required() }),
  body: Joi.object({
    reason: Joi.string().trim().min(5).max(500).required(),
    sectionId: Joi.string().trim().max(64).allow("", null),
  }),
};

/** Admin: open requests (PENDING), answered ones (DECIDED) or ALL. */
const listReopenRequests = {
  query: Joi.object({
    status: Joi.string().valid("PENDING", "DECIDED", "ALL", "").insensitive(),
    /** The requests (and counts) of one session's exams, or one exam of it. */
    sessionId: id.allow(""),
    examType: Joi.string().trim().max(60).allow(""),
    _t: cacheBuster,
  }),
};

/** Admin: approve (optional note; confirm cancelling an active cross-check) or decline (note required). */
const decideReopen = {
  params: Joi.object({ requestId: id.required() }),
  body: Joi.object({
    note: Joi.string().trim().max(500).allow(""),
    stopCrossCheck: Joi.boolean(),
  }),
};

export default { requestReopen, listReopenRequests, decideReopen };
