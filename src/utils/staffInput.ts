// Checks for the "add teacher" / "add scanner staff" forms, so a bad value gets a
// sentence that says what to fix instead of a database error.

import { Op } from "sequelize";
import UserModal from "../models/User.model";
import { sequelize } from "../config/sequelize";

const NAME = /^[A-Za-z][A-Za-z.'’ -]{0,49}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE = /^[6-9]\d{9}$/;

const text = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");

export const cleanEmail = (v: unknown) => text(v).toLowerCase();

const validDate = (v: unknown) => {
  if (v === undefined || v === null || text(v) === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/** Staff (teachers, scanner staff) must be 18 or older on the day they are added or edited. */
export const MIN_STAFF_AGE = 18;

/** A problem with a staff date of birth (under 18 by the calendar, or over 100 years ago), or null. */
export const staffAgeProblem = (dob: Date, today = new Date()): string | null => {
  // By calendar date, not days: someone born on 16 Oct 2008 turns 18 on 16 Oct 2026.
  const adult = new Date(Date.UTC(today.getUTCFullYear() - MIN_STAFF_AGE, today.getUTCMonth(), today.getUTCDate()));
  if (dob.getTime() > adult.getTime()) return `Staff must be at least ${MIN_STAFF_AGE} years old; check the date of birth.`;
  const oldest = new Date(Date.UTC(today.getUTCFullYear() - 100, today.getUTCMonth(), today.getUTCDate()));
  if (dob.getTime() < oldest.getTime()) return "Check the date of birth; it is more than 100 years ago.";
  return null;
};

/**
 * Returns the first problem with the person's basic details, or null.
 * Teachers need a date of birth, joining date and qualification; scanner staff don't.
 */
export const staffInputProblem = (
  body: any,
  opts: { requireDob: boolean; requireJoining?: boolean; requireQualification?: boolean }
): string | null => {
  const first = text(body.firstName);
  const last = text(body.lastName);
  if (!first) return "First name is required.";
  if (!NAME.test(first)) return "First name can only have letters, spaces, dots, apostrophes and hyphens.";
  if (!last) return "Last name is required.";
  if (!NAME.test(last)) return "Last name can only have letters, spaces, dots, apostrophes and hyphens.";

  const email = cleanEmail(body.emailId ?? body.email);
  if (!email) return "Email is required.";
  if (!EMAIL.test(email) || email.length > 320) return "Enter a valid email address.";

  const phone = text(body.phoneNumber ?? body.mobile);
  if (!phone) return "Mobile number is required.";
  if (!MOBILE.test(phone)) return "Enter a 10-digit mobile number starting with 6, 7, 8 or 9.";

  if (opts.requireQualification && !text(body.qualification)) return "Qualification is required.";

  const dob = validDate(body.dob);
  if (dob === undefined) return "Enter a valid date of birth.";
  if (!dob && opts.requireDob) return "Date of birth is required.";
  if (dob) {
    const ageProblem = staffAgeProblem(dob);
    if (ageProblem) return ageProblem;
  }

  const joining = validDate(body.joiningDate);
  if (joining === undefined) return "Enter a valid joining date.";
  if (!joining && opts.requireJoining) return "Joining date is required.";
  if (joining && dob && joining < dob) return "The joining date is before the date of birth.";

  const password = body.password == null ? "" : String(body.password);
  if (password && password.length < 6) return "Password must be at least 6 characters.";
  if (password.length > 128) return "Password must not exceed 128 characters.";
  return null;
};

/**
 * Says who already owns an email or mobile number, so the admin knows whether to
 * reactivate someone rather than add them again.
 */
export const contactTakenMessage = async (email: string, phone: string, instituteId: string, exceptUserId?: string) => {
  const byEmail = email ? await UserModal.findOne({ where: { emailId: email } }) : null;
  if (byEmail && byEmail.userId !== exceptUserId) {
    if (byEmail.instituteId === instituteId && byEmail.status !== 1) {
      return `${byEmail.userName} already has this email and is deactivated. Reactivate them from the list instead of adding them again.`;
    }
    return "This email is already registered.";
  }
  const byPhone = phone ? await UserModal.findOne({ where: { phoneNumber: phone } }) : null;
  if (byPhone && byPhone.userId !== exceptUserId) {
    return byPhone.instituteId === instituteId
      ? `This mobile number belongs to ${byPhone.userName}.`
      : "This mobile number is already registered.";
  }
  return null;
};

/**
 * An admin changing someone's email (their login). Returns the cleaned new email,
 * nothing when it is unchanged or not sent, or a problem. Sign-in, password resets
 * and login emails all look the user up by email at the time, and sessions are tied
 * to the userId, so a change takes effect on their next sign-in and logs no one out.
 */
export const emailChange = async (
  raw: unknown,
  user: { userId: string; emailId: string },
  instituteId: string
): Promise<{ email?: string; problem?: string }> => {
  if (raw === undefined || raw === null) return {};
  const email = cleanEmail(raw);
  if (!email) return { problem: "Email is required; it is their login." };
  if (!EMAIL.test(email) || email.length > 320) return { problem: "Enter a valid email address." };
  if (email === String(user.emailId ?? "").toLowerCase()) return {};
  // Any account, any institute, deleted or not: the email must stay unique.
  const owner = await UserModal.findOne({
    where: { [Op.and]: [sequelize.where(sequelize.fn("lower", sequelize.col("emailId")), email), { userId: { [Op.ne]: user.userId } }] },
  });
  if (owner) {
    return { problem: owner.instituteId === instituteId ? `${owner.userName} already uses this email.` : "This email is already registered." };
  }
  return { email };
};
