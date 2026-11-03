// import nodemailer from 'nodemailer';

// const transporter = nodemailer.createTransport({
//   host: 'smtp.gmail.com',
//   port: 465,
//   secure: false,
//   service: 'Gmail',

//   auth: {
//     user: 'sarveshcipl@gmail.com',
//     pass: 'mzmeovfpmddyrwhu'
//   },
//   tls: {
//     rejectUnauthorized: false
//   }
// });

// export const sendEmailOtp = async (requestBody: any) => {
//   const { otpValue, otpTypeId, message, expiryMinutes } = requestBody;

//   const mailOptions = {
//     to: otpTypeId,
//     subject: 'OTP for Email Verification',
//     html: `<head>
//       <meta charset="UTF-8">
//       <title>Emailer</title>
//       <style>
//           /* Inline CSS for styling */
//           body {
//               font-family: Arial, sans-serif;
//           }
//           .container {
//               width: 100%;
//               max-width: 600px;
//               margin: 0 auto;
//           }
//                   .header {
//                       background-color: #00008B;
//                       padding: 20px;
//                       text-align: center;
//                       color:white;
//                   }
//           .content {
//               padding: 20px;
//           }
//           .footer {
//               background-color: #f2f2f2;
//               padding: 10px;
//               text-align: center;
//           }
//       </style>
//   </head>
//   <body>
//       <div class="container">
//           <div class="header">
//               <img src="https://upsc.gov.in/sites/all/themes/upsc/images/emblem-dark.png" alt="Logo">
//               <h1>Welcome to UPSC!</h1>
//           </div>
//           <div class="content">
//               <h2>Latest News</h2>
//               </div>
//               <div class="content">
//               <p>Hi, your <b>OTP</b> for <b>${message}</b> is <b>${otpValue}.</b> This otp is valid for ${expiryMinutes} mins.</p>
//           </div>
//       </div>
//   </body>`
//   };
//   try {
//     await transporter.sendMail(mailOptions);
//     return true;
//   } catch (error) {
//     return false;
//   }
// };

// // export const sendAddClaimMail = async (req: any, res: any) => {
// //   const {
// //     formerDetails,
// //     billType,
// //     currentStatus,
// //     claimPeriodFrom,
// //     claimPeriodTo,
// //     totalClaimedAmount
// //   } = req.body;

// //   const mailOptions = {
// //     to: formerDetails.email,
// //     subject: `Claim Update`,
// //     html:
// //       `<h3>Hi ${formerDetails.name},</h3>` +
// //       `<p>The status of your <b>${billType}</b> claim  for period from <b>${claimPeriodFrom}</b> to <b>${claimPeriodTo}</b> of <b>Rs. ${totalClaimedAmount}</b> is updated.</p>` +
// //       `<p>Current Status: <b>${currentStatus}</b></p>` +
// //       `<p>Warm regards,</p>` +
// //       `<p>Team UPSC</p>`
// //   };
// //   try {
// //     await transporter.sendMail(mailOptions);
// //     return true;
// //   } catch (error) {
// //     return false;
// //   }
// // };

// // export const sendUserLoginCred = async (req: any, res: any) => {
// //   const { name, email, pass } = req.body;

// //   const mailOptions = {
// //     to: email,
// //     subject: 'Account Successfully Created and Login Credentials',
// //     html: `<head>
// //       <meta charset="UTF-8">
// //       <title>Emailer</title>
// //       <style>
// //           /* Inline CSS for styling */
// //           body {
// //               font-family: Arial, sans-serif;
// //           }
// //           .container {
// //               width: 100%;
// //               max-width: 600px;
// //               margin: 0 auto;
// //           }
// //                   .header {
// //                       background-color: #00008B;
// //                       padding: 20px;
// //                       text-align: center;
// //                       color:white;
// //                   }
// //           .content {
// //               padding: 20px;
// //           }
// //           .footer {
// //               background-color: #f2f2f2;
// //               padding: 10px;
// //               text-align: center;
// //           }
// //       </style>
// //   </head>
// //   <body>
// //       <div class="container">
// //           <div class="header">
// //               <img src="https://upsc.gov.in/sites/all/themes/upsc/images/emblem-dark.png" alt="Logo">
// //             <!-- <img src=${process.env.UI_BASE_URl}Logo.png alt="Logo"> -->
// //               <h1>Welcome to UPSC!</h1>
// //           </div>
// //           <div class="content">
// //               <h2>Latest News</h2>
// //               <p>Hi ${name}, your Bill Monitoring account is successfully opened.</p>
// //               </div>
// //               <div class="content">
// //               <p>Here are your login Details - you can login with these details and can change your password.</p>
// //               <h3>User name:- </h3>${email}
// //               <h3>Password:- </h3> ${pass}
// //           </div>
// //           <div class="footer">
// //               <a class="custom-link" href=${process.env.UI_BASE_URl}/FormersLogin>Login</a>
// //           </div>
// //       </div>
// //   </body>`
// //   };
// //   try {
// //     await transporter.sendMail(mailOptions);
// //     return true;
// //   } catch (error) {
// //     return false;
// //   }
// // };

// import nodemailer from 'nodemailer';
// import fs from 'fs';
// import path from 'path';
// import config from '../config/config';

// // Create the transporter
// const transporter = nodemailer.createTransport({
//   host:  config.email.smtp.host,
//   port: config.email.smtp.host,
//   secure: false,
//   service: 'Gmail',
//   auth: {
//     user: config.email.smtp.auth.user,
//     pass: config.email.smtp.auth.pass
//   },
//   tls: {
//     rejectUnauthorized: false
//   }
// });

// // Function to send OTP email with external HTML content
// export const sendEmailToNewUser = async (requestBody: any) => {
//   const { emailId, phoneNumber, userName, password } = requestBody;

//   // Read the HTML file asynchronously
//   const htmlContent = await fs.promises.readFile(path.join(__dirname, 'welcome.html'), 'utf8');

//   // You can modify the HTML content, e.g., replacing placeholders with dynamic data
//   const htmlContentFile = htmlContent.replace('{{emailId}}', emailId)
//                                  .replace('{{mobilleNo}}', phoneNumber)
//                                  .replace('{{userName}}', userName)
//                                  .replace('{{name}}', userName)
//                                  .replace('{{temp_password}}', password);

//   // Email options
//   const mailOptions = {
//     to: emailId,  // Recipient email address
//     subject: 'Registration Completed',
//     html: htmlContentFile  // The HTML content to be sent
//   };

//   try {
//     await transporter.sendMail(mailOptions);
//     return true;
//   } catch (error) {
//     console.error('Error sending email:', error);
//     return false;
//   }
// };

// import nodemailer from "nodemailer";
// import { convert } from "html-to-text";

// class Email {
//   constructor(user) {
//     this.to = user.email;
//     this.firstName = user.firstName || (user.name ? user.name.split(" ")[0] : "");
//     this.from = process.env.EMAIL_FROM || process.env.Email_Username;
//   }

//   newTransport() {
//     return nodemailer.createTransport({
//       service: "gmail",
//       auth: {
//         user:"adityababu000041@gmail.com" ,
//         pass: "ypinjptukwktpmlm",
//       },
//       logger: true,
//       debug: true,
//     });
//   }

//   async send(subject, message, email = this.to) {
//     const mailOptions = {
//       from: this.from,
//       to: email,
//       subject,
//       html: message,
//       text: convert(message, { wordwrap: 130 }),
//     };

//     try {
//       await this.newTransport().sendMail(mailOptions);

//     } catch (err) {
//       console.error("Error sending email:", err);
//       throw new Error("Failed to send email.");
//     }
//   }

//   async sendWelcome() {
//     const message = `
//       <h1>Welcome to the BinaryV Website.</h1>
//       <p>Hi ${this.firstName},</p>
//       <p>Thank you for joining us! We're excited to have you.</p>
//     `;
//     await this.send("Welcome to the HealthTalk Family", message);
//   }

//   async sendPasswordReset(otp) {
//   const message = `
//     <h1>Password Reset Request</h1>
//     <p>Hi ${this.firstName},</p>
//     <p>We received a request to reset your password. Use the OTP below to reset it:</p>
//     <h2>${otp}</h2>
//     <p>This OTP is valid for 10 minutes.</p>
//   `;
//   await this.send(
//     "Your Password Reset OTP (Valid for 10 minutes)",
//     message
//   );
// }

//   async sendOtp(otp) {
//     const message = `
//       <h4>Your OTP for email verification is <b>${otp}</b></h4>
//     `;
//     await this.send(
//       "Your OTP for email verification (Valid for 5 minutes)",
//       message
//     );
//   }
// }

// Export the class for use in other files
// export default Email;

import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import config from "../config/config";
import logger from "../config/logger";
import UserModal from "../models/User.model";
import { defineQueue, PermanentJobError } from "../queue";
import { positiveInt } from "../queue/config";
import { seal, unseal } from "../queue/sealed";

// ─── Transporter ──────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: config.email.smtp.host || "smtp.gmail.com",
  port: Number(config.email.smtp.port || 465),
  secure: Number(config.email.smtp.port || 465) === 465,
  auth: {
    user: config.email.smtp.auth.user,
    pass: (config.email.smtp.auth.pass || "").replace(/\s+/g, ""),
  },
  tls: {
    rejectUnauthorized: false,
  },
});

// ─── Existing function — keep as is ───────────────────────────────────────────
export const sendEmailToNewUser = async (requestBody: any) => {
  const { emailId, phoneNumber, userName, password } = requestBody;


  const htmlContent = await fs.promises.readFile(
    path.join(__dirname, "welcome.html"),
    "utf8",
  );

  const htmlContentFile = htmlContent
    .replace("{{emailId}}", emailId)
    .replace("{{mobilleNo}}", phoneNumber)
    .replace("{{userName}}", userName)
    .replace("{{name}}", userName)
    .replace("{{temp_password}}", password);

  // const mailOptions = {
  //   to:      emailId,
  //   subject: 'Registration Completed',
  //   html:    htmlContentFile,
  // };

  try {
    const info = await transporter.sendMail({
      from: `"ViaExam" <${config.email.smtp.auth.user}>`,
      to: emailId,
      subject: "Registration Completed",
      html: htmlContentFile,
    });


    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
};
// ─── Login details for teachers, scanner staff and students ────────────────────
// kind: "created" (new account), "reset" (a new password was set for them) or
// "details" (their login email and sign-in link only; the password is unchanged and is
// not in the email, because it is stored encrypted and can't be read back).

/** Text from the database or a form, safe to put inside the email's HTML. */
const escapeHtml = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export interface UserCredentialsEmail {
  userName: string;
  email: string;
  phone: string;
  /** The new password; null for "details" (no password in the email). */
  password?: string | null;
  role: string;
  loginUrl: string;
  kind?: "created" | "reset" | "details";
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
}

/** Sends one email now; throws when the mail server refuses it. */
const deliverMail = async (message: MailMessage) => {
  await transporter.sendMail({
    from: `"ViaExam" <${config.email.smtp.auth.user}>`,
    to: message.to,
    subject: message.subject,
    html: message.html,
  });
};

/** "ad***@gmail.com": enough to tell addresses apart in a log, not to collect them. */
export const maskEmail = (email: string) => {
  const [name, domain] = String(email ?? "").split("@");
  return domain ? `${name.slice(0, 2)}***@${domain}` : "***";
};

// ─── Email queue ───────────────────────────────────────────────────────────────
// Every email the app sends goes out as a job: no request waits for the mail server, a
// 500-student import is sent a couple at a time, and an outage is retried with backoff.
//
//   • Interactive emails (sign-in codes, password resets, login details) have no priority,
//     so they run before every bulk one (an import's new-account emails, priority 10).
//   • The email, recipient included, is stored sealed (AES-256-GCM, queue/sealed.ts): the
//     queue tables never hold a readable code, password or address. The job is deleted as
//     soon as the email is sent.
//   • An OTP email carries its code's expiry and is dropped, not sent late, after it.
//   • A reset's new password is saved only once the mail server has accepted the email, so
//     an outage never leaves anyone locked out with a password they didn't get.

export type EmailKind = "otp" | "password-reset" | "login-details" | "new-account" | "admin-credentials";

const KIND_LABEL: Record<EmailKind, string> = {
  otp: "sign-in code",
  "password-reset": "new password",
  "login-details": "login details",
  "new-account": "new account's login details",
  "admin-credentials": "admin login details",
};

interface SealedEmail {
  message: MailMessage;
  /** Saved once the email is accepted (password resets). */
  setPassword?: { userId: string; hash: string };
}

interface EmailJob {
  sealed: string;
  kind: EmailKind;
  /** Epoch ms after which the email is no longer worth sending (an OTP's expiry). */
  notAfter?: number;
  /** Who to tell, in the app, if the email fails for good (the admin who asked for it). */
  notify?: { userId: string; instituteId: string };
}

export interface EmailRequest {
  kind: EmailKind;
  message: MailMessage;
  /** Bulk emails (an import's new accounts) wait behind interactive ones. */
  bulk?: boolean;
  jobId?: string;
  /** While a job with this key is queued, the same email isn't queued again (`duplicate`). */
  dedupeKey?: string;
  notAfter?: Date;
  setPassword?: SealedEmail["setPassword"];
  notify?: EmailJob["notify"] | null;
  attempts?: number;
  /** First retry delay (doubling after each); default 1 minute. */
  retryMs?: number;
}

export interface QueuedEmail {
  /** false: the queue was unavailable and the email is being sent from this process instead. */
  queued: boolean;
  /** true: an identical email (same dedupeKey) was already queued; nothing was added. */
  duplicate: boolean;
}

const SENT = { sent: true };

/** Saves a reset's password (the email with it has been accepted) and ends the user's sessions. */
const applyPassword = async ({ userId, hash }: NonNullable<SealedEmail["setPassword"]>) => {
  const [count] = await UserModal.update({ password: hash, refreshToken: null }, { where: { userId, isDeleted: false } });
  if (!count) logger.warn(`[Email] User ${userId} no longer exists; the emailed password was not saved.`);
};

const isRejection = (err: any) => {
  // 5xx from the mail server (no such mailbox, address rejected) won't change on retry.
  const code = Number(err?.responseCode);
  return (code >= 500 && code < 600) || err?.code === "EENVELOPE";
};

const emailQueue = defineQueue<EmailJob>({
  name: "emails",
  concurrency: positiveInt(process.env.EMAIL_QUEUE_CONCURRENCY, 2),
  defaults: { attempts: 6, backoff: { type: "exponential", delayMs: 60_000 }, keepCompletedSec: 0, keepFailedSec: 3 * 24 * 3600 },
  processor: async (job) => {
    const { kind, notAfter } = job.data;
    if (notAfter && Date.now() > notAfter) {
      logger.warn(`[Email] A ${KIND_LABEL[kind]} email expired before the mail server took it; dropped.`);
      return { skipped: "expired" };
    }
    const email = unseal<SealedEmail>(job.data.sealed);
    // A retry after the email went out (the password save failed) doesn't send it twice.
    if (!(job.lastProgress as any)?.sent) {
      try {
        await deliverMail(email.message);
      } catch (err: any) {
        if (isRejection(err)) throw new PermanentJobError(`The mail server rejected the email: ${err?.message || err}`);
        throw err;
      }
      await job.progress(SENT);
    }
    if (email.setPassword) await applyPassword(email.setPassword);
    return SENT;
  },
  onFailed: async (job, err) => {
    let to = "***";
    let resetsPassword = false;
    try {
      const email = unseal<SealedEmail>(job.data.sealed);
      to = maskEmail(email.message.to);
      resetsPassword = !!email.setPassword;
    } catch {
      /* unreadable: say what we know */
    }
    const reason = String(err?.message || err).slice(0, 200);
    const label = KIND_LABEL[job.data.kind] ?? "email";
    logger.error(`[Email] The ${label} email to ${to} could not be sent${resetsPassword ? " (the password was not changed)" : ""}: ${reason}`);
    const notify = job.data.notify;
    if (!notify) return;
    const { notifyAll } = require("../services/notification/notifyPeople");
    await notifyAll([
      {
        instituteId: notify.instituteId,
        userId: notify.userId,
        type: "EMAIL_NOT_SENT",
        title: `Email not sent: ${label}`,
        message: `The ${label} email to ${to} could not be sent (${reason}).${resetsPassword ? " Their password was not changed." : ""} Check the address and send it again.`,
        referenceId: job.id,
      },
    ]);
  },
});

/** Sends now, in this process, when the queue can't take the email. Never throws. */
const sendInBackground = (email: SealedEmail, kind: EmailKind) => {
  void (async () => {
    try {
      await deliverMail(email.message);
      if (email.setPassword) await applyPassword(email.setPassword);
    } catch (err: any) {
      logger.error(`[Email] The ${KIND_LABEL[kind]} email to ${maskEmail(email.message.to)} could not be sent: ${err?.message || err}`);
    }
  })();
};

/** Queues an email. Never throws: when the queue is down it is sent from this process instead. */
export const queueEmail = async (request: EmailRequest): Promise<QueuedEmail> => {
  const email: SealedEmail = { message: request.message, ...(request.setPassword ? { setPassword: request.setPassword } : {}) };
  // A unique id, so a deduplicated add is told apart by the id that comes back.
  const jobId = request.jobId ?? `${request.kind}-${randomUUID()}`;
  try {
    const id = await emailQueue.add(
      request.kind,
      {
        sealed: seal(email),
        kind: request.kind,
        ...(request.notAfter ? { notAfter: request.notAfter.getTime() } : {}),
        ...(request.notify ? { notify: request.notify } : {}),
      },
      {
        jobId,
        ...(request.dedupeKey ? { dedupeKey: request.dedupeKey } : {}),
        ...(request.bulk ? { priority: 10 } : {}),
        ...(request.attempts ? { attempts: request.attempts } : {}),
        ...(request.retryMs ? { backoff: { type: "exponential" as const, delayMs: request.retryMs } } : {}),
        // An expired code's failed job is no use to anyone.
        ...(request.notAfter ? { keepFailedSec: 3600 } : {}),
      }
    );
    return { queued: true, duplicate: id !== jobId };
  } catch (err: any) {
    logger.warn(`[Email] Queue unavailable (${err?.message || err}); sending the ${KIND_LABEL[request.kind]} email to ${maskEmail(request.message.to)} directly.`);
    sendInBackground(email, request.kind);
    return { queued: false, duplicate: false };
  }
};

/** Takes a queued email out before it is sent (e.g. the OTP a newer one replaced). False if it already ran. */
export const cancelQueuedEmail = (jobId: string): Promise<boolean> => emailQueue.remove(jobId).catch(() => false);

/** Login details of a new account (bulk: an import queues hundreds). */
export const queueUserCredentials = async (data: UserCredentialsEmail): Promise<void> => {
  await queueEmail({ kind: "new-account", message: composeUserCredentials(data), bulk: true });
};

export const composeUserCredentials = (data: UserCredentialsEmail): MailMessage => {
    const kind = data.kind ?? "created";
    const e = {
      name: escapeHtml(data.userName),
      email: escapeHtml(data.email),
      phone: escapeHtml(data.phone),
      password: escapeHtml(data.password ?? ""),
      role: escapeHtml(data.role),
      url: escapeHtml(data.loginUrl),
    };
    const intro =
      kind === "details"
        ? `Here are the login details for your <strong>${e.role}</strong> account on ViaExam. Your password has not changed.`
        : kind === "reset"
          ? `Your school has set a new password for your <strong>${e.role}</strong> account on ViaExam. Your old password no longer works.`
          : `Your <strong>${e.role}</strong> account has been successfully created on ViaExam. Below are your login credentials.`;
    const note =
      kind === "details"
        ? "Sign in with your current password. If you have forgotten it, use “Forgot password” on the sign-in page, or ask your school to send you a new one."
        : "⚠️ Please change your password immediately after your first login.";
    const subject =
      kind === "details"
        ? `Your ViaExam login details (${data.role})`
        : kind === "reset"
          ? `Your new ViaExam password (${data.role})`
          : `Welcome to ViaExam — Your ${data.role} Account Credentials`;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
          .wrapper { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
          .header { background: linear-gradient(135deg, #0f0e1a 0%, #1a1535 100%); padding: 32px 40px; text-align: center; }
          .header h1 { color: #fff; font-size: 22px; margin: 0; }
          .header p { color: rgba(255,255,255,0.45); font-size: 13px; margin: 6px 0 0; }
          .body { padding: 32px 40px; }
          .greeting { font-size: 16px; color: #111827; font-weight: 600; margin-bottom: 10px; }
          .text { font-size: 14px; color: #6b7280; line-height: 1.7; margin-bottom: 24px; }
          .cred-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px 24px; margin-bottom: 24px; }
          .cred-box h3 { font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 14px; }
          .cred-row { display: flex; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid #f3f4f6; }
          .cred-row:last-child { border-bottom: none; }
          .cred-label { font-size: 13px; color: #6b7280; }
          .cred-value { font-size: 13px; color: #111827; font-weight: 700; font-family: monospace; }
          .btn { display: block; width: fit-content; margin: 0 auto; background: linear-gradient(135deg, #534AB7, #3C3489); color: #fff; text-decoration: none; padding: 13px 30px; border-radius: 8px; font-size: 14px; font-weight: 600; }
          .warning { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px 18px; margin-top: 22px; }
          .warning p { font-size: 13px; color: #92400e; margin: 0; line-height: 1.6; }
          .footer { background: #f9fafb; padding: 18px 40px; text-align: center; }
          .footer p { font-size: 12px; color: #9ca3af; margin: 0; }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="header">
            <h1>🎓 ViaExam</h1>
            <p>Institute Management Platform</p>
          </div>
          <div class="body">
            <p class="greeting">Hello ${e.name},</p>
            <p class="text">${intro}</p>
            <div class="cred-box">
              <h3>Login Credentials</h3>
              <div class="cred-row">
                <span class="cred-label">Email: </span>
                <span class="cred-value">${e.email}</span>
              </div>
              <div class="cred-row">
                <span class="cred-label">Mobile: </span>
                <span class="cred-value">${e.phone}</span>
              </div>
              <div class="cred-row">
                <span class="cred-label">Username: </span>
                <span class="cred-value">${e.name}</span>
              </div>
              <div class="cred-row">
                <span class="cred-label">Password: </span>
                <span class="cred-value">${kind === "details" ? "Your current password (unchanged)" : e.password}</span>
              </div>
              <div class="cred-row">
                <span class="cred-label">Login URL: </span>
                <span class="cred-value" style="font-size:11px">${e.url}</span>
              </div>
            </div>
            <a href="${e.url}" class="btn">Login to Dashboard →</a>
            <div class="warning">
              <p>${note}</p>
            </div>
          </div>
          <div class="footer">
            <p>© 2026 ViaExam. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return { to: data.email, subject, html };
};

// ─── Admin credentials (institute registration, resends) ──────────────────────
export interface AdminCredentialsEmail {
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  instituteName: string;
  loginUrl: string;
  plan: string;
}

export const composeAdminCredentials = (raw: AdminCredentialsEmail): MailMessage => {
    const data = {
      adminName: escapeHtml(raw.adminName),
      adminEmail: escapeHtml(raw.adminEmail),
      adminPassword: escapeHtml(raw.adminPassword),
      instituteName: escapeHtml(raw.instituteName),
      loginUrl: escapeHtml(raw.loginUrl),
      plan: escapeHtml(String(raw.plan ?? "")),
    };
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
          .wrapper { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
          .header { background: linear-gradient(135deg, #0f0e1a 0%, #1a1535 100%); padding: 32px 40px; text-align: center; }
          .header h1 { color: #fff; font-size: 22px; margin: 0; }
          .header p { color: rgba(255,255,255,0.45); font-size: 13px; margin: 6px 0 0; }
          .body { padding: 32px 40px; }
          .greeting { font-size: 16px; color: #111827; font-weight: 600; margin-bottom: 10px; }
          .text { font-size: 14px; color: #6b7280; line-height: 1.7; margin-bottom: 24px; }
          .cred-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px 24px; margin-bottom: 24px; }
          .cred-box h3 { font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 14px; }
          .cred-row { display: flex; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid #f3f4f6; }
          .cred-row:last-child { border-bottom: none; }
          .cred-label { font-size: 13px; color: #6b7280; }
          .cred-value { font-size: 13px; color: #111827; font-weight: 700; font-family: monospace; }
          .btn { display: block; width: fit-content; margin: 0 auto; background: linear-gradient(135deg, #534AB7, #3C3489); color: #fff; text-decoration: none; padding: 13px 30px; border-radius: 8px; font-size: 14px; font-weight: 600; }
          .warning { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px 18px; margin-top: 22px; }
          .warning p { font-size: 13px; color: #92400e; margin: 0; line-height: 1.6; }
          .footer { background: #f9fafb; padding: 18px 40px; text-align: center; }
          .footer p { font-size: 12px; color: #9ca3af; margin: 0; }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="header">
            <h1>🎓 ViaExam</h1>
            <p>Institute Management Platform</p>
          </div>
          <div class="body">
            <p class="greeting">Hello ${data.adminName},</p>
            <p class="text">
              Your institute <strong>${
                data.instituteName
              }</strong> has been successfully 
              registered on ViaExam. Below are your admin login credentials.
            </p>
            <div class="cred-box">
              <h3>Login Credentials</h3>
              <div class="cred-row">
                <span class="cred-label">Institute: </span>
                <span class="cred-value">${data.instituteName}</span>
              </div>
              <div class="cred-row">
                <span class="cred-label">Plan: </span>
                <span class="cred-value">${data.plan.toUpperCase()}</span>
              </div>
              <div class="cred-row">
                <span class="cred-label">Email: </span>
                <span class="cred-value">${data.adminEmail}</span>
              </div>
              <div class="cred-row">
                <span class="cred-label">Password: </span>
                <span class="cred-value">${data.adminPassword}</span>
              </div>
              <div class="cred-row">
                <span class="cred-label">Login URL: </span>
                <span class="cred-value" style="font-size:11px">${
                  data.loginUrl
                }</span>
              </div>
            </div>
            <a href="${data.loginUrl}" class="btn">Login to Dashboard →</a>
            <div class="warning">
              <p>⚠️ Please change your password immediately after your first login.</p>
            </div>
          </div>
          <div class="footer">
            <p>© 2026 ViaExam. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return {
      to: raw.adminEmail,
      subject: `Welcome to ViaExam — Your Admin Credentials for ${raw.instituteName}`,
      html,
    };
};

// ─── Role-specific OTP email templates ──────────────────────────────────────────
export const composeOtpEmail = ({
  toEmail,
  userName,
  otp,
  role,
}: {
  toEmail: string;
  userName: string;
  otp: string;
  role?: string;
}): MailMessage => {
  // Roles are stored in capitals ("TEACHER"); the templates are keyed in lower case.
  const roleSpecificContent = getRoleSpecificOTPContent(String(role ?? "").toLowerCase());
  return {
    to: toEmail,
    subject: roleSpecificContent.subject,
    html: roleSpecificContent.html(escapeHtml(userName), escapeHtml(otp)),
  };
};

// Helper function to get role-specific email content
function getRoleSpecificOTPContent(role?: string) {
  const baseStyles = `
    body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #0f0e1a 0%, #1a1535 100%); padding: 32px 40px; text-align: center; }
    .header h1 { color: #fff; font-size: 22px; margin: 0; }
    .header p { color: rgba(255,255,255,0.45); font-size: 13px; margin: 6px 0 0; }
    .body { padding: 32px 40px; }
    .greeting { font-size: 16px; color: #111827; font-weight: 600; margin-bottom: 10px; }
    .text { font-size: 14px; color: #6b7280; line-height: 1.7; margin-bottom: 24px; }
    .otp-box { background: linear-gradient(135deg, #534AB7, #3C3489); color: #fff; border-radius: 10px; padding: 24px; text-align: center; margin: 24px 0; }
    .otp-code { font-size: 32px; font-weight: 700; letter-spacing: 8px; margin: 0; }
    .warning { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px 18px; margin-top: 22px; }
    .warning p { font-size: 13px; color: #92400e; margin: 0; line-height: 1.6; }
    .footer { background: #f9fafb; padding: 18px 40px; text-align: center; }
    .footer p { font-size: 12px; color: #9ca3af; margin: 0; }
  `;

  const roleMessages = {
    admin: {
      subject: "🔐 Password Reset OTP - ViaExam Admin Dashboard",
      html: (userName: string, otp: string) => `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8" />
          <style>${baseStyles}</style>
        </head>
        <body>
          <div class="wrapper">
            <div class="header">
              <h1>🎓 ViaExam</h1>
              <p>Admin Dashboard</p>
            </div>
            <div class="body">
              <p class="greeting">Hello ${userName},</p>
              <p class="text">
                We received a request to reset your <strong>Admin</strong> account password. 
                Use the OTP below to securely reset your password.
              </p>
              <div class="otp-box">
                <p class="otp-code">${otp}</p>
              </div>
              <p class="text">
                This OTP is valid for <strong>10 minutes</strong>. For security reasons, 
                please do not share this code with anyone.
              </p>
              <div class="warning">
                <p>⚠️ If you did not request this password reset, please ignore this email and contact support immediately.</p>
              </div>
            </div>
            <div class="footer">
              <p>© 2026 ViaExam. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `
    },
    teacher: {
      subject: "🔐 Password Reset OTP - ViaExam Teacher Portal",
      html: (userName: string, otp: string) => `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8" />
          <style>${baseStyles}</style>
        </head>
        <body>
          <div class="wrapper">
            <div class="header">
              <h1>🎓 ViaExam</h1>
              <p>Teacher Portal</p>
            </div>
            <div class="body">
              <p class="greeting">Hello ${userName},</p>
              <p class="text">
                We received a request to reset your <strong>Teacher</strong> account password. 
                Use the OTP below to securely reset your password.
              </p>
              <div class="otp-box">
                <p class="otp-code">${otp}</p>
              </div>
              <p class="text">
                This OTP is valid for <strong>10 minutes</strong>. For security reasons, 
                please do not share this code with anyone.
              </p>
              <div class="warning">
                <p>⚠️ If you did not request this password reset, please ignore this email and contact your institute administrator.</p>
              </div>
            </div>
            <div class="footer">
              <p>© 2026 ViaExam. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `
    },
    student: {
      subject: "🔐 Password Reset OTP - ViaExam Student Portal",
      html: (userName: string, otp: string) => `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8" />
          <style>${baseStyles}</style>
        </head>
        <body>
          <div class="wrapper">
            <div class="header">
              <h1>🎓 ViaExam</h1>
              <p>Student Portal</p>
            </div>
            <div class="body">
              <p class="greeting">Hello ${userName},</p>
              <p class="text">
                We received a request to reset your <strong>Student</strong> account password. 
                Use the OTP below to securely reset your password.
              </p>
              <div class="otp-box">
                <p class="otp-code">${otp}</p>
              </div>
              <p class="text">
                This OTP is valid for <strong>10 minutes</strong>. For security reasons, 
                please do not share this code with anyone.
              </p>
              <div class="warning">
                <p>⚠️ If you did not request this password reset, please ignore this email and contact your teacher or institute administrator.</p>
              </div>
            </div>
            <div class="footer">
              <p>© 2026 ViaExam. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `
    },
    scanner: {
      subject: "🔐 Password Reset OTP - ViaExam Scanner Portal",
      html: (userName: string, otp: string) => `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8" />
          <style>${baseStyles}</style>
        </head>
        <body>
          <div class="wrapper">
            <div class="header">
              <h1>🎓 ViaExam</h1>
              <p>Scanner Portal</p>
            </div>
            <div class="body">
              <p class="greeting">Hello ${userName},</p>
              <p class="text">
                We received a request to reset your <strong>Scanner</strong> account password. 
                Use the OTP below to securely reset your password.
              </p>
              <div class="otp-box">
                <p class="otp-code">${otp}</p>
              </div>
              <p class="text">
                This OTP is valid for <strong>10 minutes</strong>. For security reasons, 
                please do not share this code with anyone.
              </p>
              <div class="warning">
                <p>⚠️ If you did not request this password reset, please ignore this email and contact your institute administrator.</p>
              </div>
            </div>
            <div class="footer">
              <p>© 2026 ViaExam. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `
    },
    super_admin: {
      subject: "🔐 Password Reset OTP - ViaExam Super Admin Dashboard",
      html: (userName: string, otp: string) => `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8" />
          <style>${baseStyles}</style>
        </head>
        <body>
          <div class="wrapper">
            <div class="header">
              <h1>🎓 ViaExam</h1>
              <p>Super Admin Dashboard</p>
            </div>
            <div class="body">
              <p class="greeting">Hello ${userName},</p>
              <p class="text">
                We received a request to reset your <strong>Super Admin</strong> account password. 
                Use the OTP below to securely reset your password.
              </p>
              <div class="otp-box">
                <p class="otp-code">${otp}</p>
              </div>
              <p class="text">
                This OTP is valid for <strong>10 minutes</strong>. For security reasons, 
                please do not share this code with anyone.
              </p>
              <div class="warning">
                <p>⚠️ If you did not request this password reset, please ignore this email and contact platform support immediately.</p>
              </div>
            </div>
            <div class="footer">
              <p>© 2026 ViaExam. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `
    }
  };

  return roleMessages[role as keyof typeof roleMessages] || roleMessages.student;
}
