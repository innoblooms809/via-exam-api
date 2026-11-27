import httpStatus from "http-status";
import config from "../../config/config";
import logger from "../../config/logger";
import { escapeHtml, maskEmail, queueEmail } from "../../utils/mailHelper";

/**
 * The landing page's "Get in touch" form: the enquiry is emailed to the team's inbox
 * (CONTACT_INBOX, else the address the app sends from), with Reply-To set to the visitor.
 * Nothing is sent to the visitor: an auto-reply to an address anyone can type would let
 * strangers use the form to mail third parties.
 */

const LIMITS = { name: 100, institution: 150, email: 254, message: 5000 };
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

const clean = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "") // control characters (keeps newlines)
    .trim()
    .slice(0, max);

const inbox = () => String(process.env.CONTACT_INBOX || config.email.from || config.email.smtp.auth.user || "").trim();

const bad = (message: string) => ({ error: true, statusCode: httpStatus.BAD_REQUEST, message });

const submitEnquiry = async (body: any, meta: { ip?: string; userAgent?: string }) => {
  // Honeypot: a field people never see. Bots fill every field; answer "sent" so they don't retry.
  if (String(body?.website ?? "").trim()) {
    logger.info("[Contact] Dropped a form submission that filled the hidden field (bot).");
    return { error: false, statusCode: httpStatus.OK, message: "Your message has been sent. Our team will get back to you shortly." };
  }

  const name = clean(body?.name, LIMITS.name).replace(/\s+/g, " ");
  const institution = clean(body?.institution, LIMITS.institution).replace(/\s+/g, " ");
  const email = clean(body?.email, LIMITS.email).toLowerCase();
  const message = clean(body?.message, LIMITS.message);

  // Every field is required, and the email must be a real address (the form checks the same).
  if (name.length < 2) return bad("Please enter your full name.");
  if (institution.length < 2) return bad("Please enter your institution or university.");
  if (!email) return bad("Please enter your email address.");
  if (!EMAIL_RE.test(email)) return bad("Please enter a valid email address, like name@school.edu.");
  if (message.length < 10) return bad("Please tell us a little more (at least 10 characters).");
  const replyTo: string | undefined = email;
  const shown = (v: string) => escapeHtml(v);

  const to = inbox();
  if (!to) {
    logger.error("[Contact] No inbox for contact messages: set CONTACT_INBOX (or EMAIL_FROM).");
    return { error: true, statusCode: httpStatus.SERVICE_UNAVAILABLE, message: "We couldn't send your message right now. Please email us instead." };
  }

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#667085;vertical-align:top;white-space:nowrap">${label}</td><td style="padding:6px 0;color:#101828">${value}</td></tr>`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#101828;max-width:640px">
      <h2 style="font-size:18px;margin:0 0 12px">New enquiry from the ViaExam website</h2>
      <table style="border-collapse:collapse;margin-bottom:16px">
        ${row("Name", shown(name))}
        ${row("Institution", shown(institution))}
        ${row("Email", replyTo ? `<a href="mailto:${escapeHtml(replyTo)}">${escapeHtml(replyTo)}</a>` : shown(email))}
        ${row("Received", escapeHtml(new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })) + " IST")}
      </table>
      <div style="padding:12px 14px;border:1px solid #eaecf0;border-radius:8px;background:#f9fafb;white-space:pre-wrap">${shown(message)}</div>
      <p style="color:#667085;font-size:12px;margin-top:16px">${
        replyTo ? `Reply to this email to answer ${name ? escapeHtml(name) : "them"} directly.` : "No valid email was given, so this enquiry can't be answered by reply."
      }</p>
    </div>`;

  // Line breaks can't reach the subject (clean() + the space collapse above).
  const who = [name, institution && `(${institution})`].filter(Boolean).join(" ") || "someone";
  await queueEmail({
    kind: "contact",
    message: { to, ...(replyTo ? { replyTo } : {}), subject: `Website enquiry: ${who}`.slice(0, 200), html },
    attempts: 6,
  });
  logger.info(`[Contact] Enquiry${replyTo ? ` from ${maskEmail(replyTo)}` : ""} queued for the team inbox${meta.ip ? ` (ip ${meta.ip})` : ""}.`);

  return { error: false, statusCode: httpStatus.OK, message: "Your message has been sent. Our team will get back to you shortly." };
};

export default { submitEnquiry };
