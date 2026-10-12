import Joi from "joi";

const name = Joi.string()
  .trim()
  .max(60)
  .pattern(/^[\p{L}][\p{L} .'-]*$/u)
  .messages({ "string.pattern.base": "{{#label}} may contain letters, spaces, dots, apostrophes and hyphens only." });

// Super admin adds or updates an institute's admin. The password is never sent:
// the server generates one and emails it.
const addAdmin = {
  params: Joi.object({ instituteId: Joi.string().trim().max(64).required() }),
  body: Joi.object({
    adminFirstName: name.required(),
    adminLastName: name.allow(""),
    adminEmail: Joi.string().trim().lowercase().email().max(254).required(),
    adminPhone: Joi.string()
      .trim()
      .pattern(/^[6-9][0-9]{9}$/)
      .required()
      .messages({ "string.pattern.base": "Phone must be a 10-digit mobile number starting with 6, 7, 8 or 9." }),
    resetPassword: Joi.boolean(),
  })
    // Older clients also send fields the server ignores (e.g. a password); drop them.
    .unknown(true),
};

export default { addAdmin };
