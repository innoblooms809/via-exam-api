import Joi from "joi";

// Ids are business keys: old "IB12345678" and new "VI…" shapes both pass.
const id = Joi.string().trim().max(64).pattern(/^[A-Za-z0-9_-]+$/);

/** "Evaluate all": up to 200 sheets per call (the queue runs them in order). */
const evaluateBatch = {
  body: Joi.object({
    sheetIds: Joi.array().items(id.required()).min(1).max(200).unique().required(),
    force: Joi.boolean().default(false),
  }),
};

/** The queue page's one poll for every sheet it shows. */
const statusBatch = {
  body: Joi.object({
    sheetIds: Joi.array().items(id.required()).min(1).max(500).unique().required(),
  }),
};

export default { evaluateBatch, statusBatch };
