import Joi from "joi";

const name = Joi.string()
  .trim()
  .max(60)
  .pattern(/^[\p{L}][\p{L} .'-]*$/u)
  .messages({ "string.pattern.base": "{{#label}} may contain letters, spaces, dots, apostrophes and hyphens only." });

// Admin passwords chosen by the super admin: 8–64 characters with an uppercase letter,
// a lowercase letter and a digit, no spaces.
const adminPassword = Joi.string()
  .min(8)
  .max(64)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)\S+$/)
  .messages({
    "string.min": "Password must be at least 8 characters.",
    "string.max": "Password must not exceed 64 characters.",
    "string.pattern.base": "Password needs an uppercase letter, a lowercase letter and a number, and no spaces.",
  });

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
