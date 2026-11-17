import Joi from "joi";
import { NAME_CHARS } from "../utils/textRules";
import { strongPassword } from "../utils/passwordRule";

const name = Joi.string()
  .trim()
  .max(60)
  .pattern(NAME_CHARS)
  .messages({ "string.pattern.base": "{{#label}} may contain letters, spaces, dots, apostrophes and hyphens only." });

// Admin passwords chosen by the super admin: the shared rule (utils/passwordRule).
const adminPassword = strongPassword();

// Super admin adds or updates an institute's admin. Without a password the server
// generates one; either way the login details are emailed to the admin.
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
    password: adminPassword,
  })
    // Older clients also send fields the server ignores; drop them.
    .unknown(true),
};

// Super admin resets the admin's password: their own choice, or generated when omitted.
const resendCredentials = {
  params: Joi.object({ instituteId: Joi.string().trim().max(64).required() }),
  body: Joi.object({ password: adminPassword }).unknown(true),
};

export default { addAdmin, resendCredentials };
