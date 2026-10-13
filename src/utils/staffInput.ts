// Checks for the "add teacher" / "add scanner staff" forms, so a bad value gets a
// sentence that says what to fix instead of a database error.

import UserModal from "../models/User.model";

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
    const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (age < 18) return "Staff must be at least 18 years old; check the date of birth.";
    if (age > 100) return "Check the date of birth; it is more than 100 years ago.";
  }

  const joining = validDate(body.joiningDate);
  if (joining === undefined) return "Enter a valid joining date.";
  if (!joining && opts.requireJoining) return "Joining date is required.";
  if (joining && dob && joining < dob) return "The joining date is before the date of birth.";
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
