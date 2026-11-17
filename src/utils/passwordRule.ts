/**
 * The one rule for a password a person types: the super admin for an institute admin, an admin
 * for a teacher, student or scanner (creating, importing, or sending a new password), or anyone
 * changing their own. 8–64 characters with an uppercase letter, a lowercase letter and a
 * number, and no spaces. Generated passwords (utils/helper strongPassword) always meet it.
 * The UI checks the same rule (via-exam-ui shared/lib/passwordRule.ts).
 */

import Joi from "joi";

export const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)\S{8,64}$/;

export const PASSWORD_MESSAGE = "Password must be 8–64 characters with an uppercase letter, a lowercase letter and a number, and no spaces.";

export const isStrongPassword = (password: unknown): boolean => typeof password === "string" && PASSWORD_RULE.test(password);

/** Joi form of the rule (add .required() / .allow("", null).optional() where it is used). */
export const strongPassword = () =>
  Joi.string().pattern(PASSWORD_RULE).messages({
    "string.base": PASSWORD_MESSAGE,
    "string.empty": "Password is required.",
    "string.pattern.base": PASSWORD_MESSAGE,
  });
