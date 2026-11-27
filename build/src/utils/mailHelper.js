"use strict";
// import nodemailer from 'nodemailer';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.composeOtpEmail = exports.composeAdminCredentials = exports.composeUserCredentials = exports.queueUserCredentials = exports.cancelQueuedEmail = exports.queueEmail = exports.maskEmail = exports.escapeHtml = exports.sendEmailToNewUser = void 0;
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
const nodemailer_1 = __importDefault(require("nodemailer"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const config_1 = __importDefault(require("../config/config"));
const logger_1 = __importDefault(require("../config/logger"));
const User_model_1 = __importDefault(require("../models/User.model"));
const session_service_1 = require("../services/auth/session.service");
const queue_1 = require("../queue");
const config_2 = require("../queue/config");
const sealed_1 = require("../queue/sealed");
// ─── Transporter ──────────────────────────────────────────────────────────────
const transporter = nodemailer_1.default.createTransport({
    host: config_1.default.email.smtp.host || "smtp.gmail.com",
    port: Number(config_1.default.email.smtp.port || 465),
    secure: Number(config_1.default.email.smtp.port || 465) === 465,
    auth: {
        user: config_1.default.email.smtp.auth.user,
        pass: (config_1.default.email.smtp.auth.pass || "").replace(/\s+/g, ""),
    },
    tls: {
        rejectUnauthorized: false,
    },
});
// ─── Existing function — keep as is ───────────────────────────────────────────
const sendEmailToNewUser = (requestBody) => __awaiter(void 0, void 0, void 0, function* () {
    const { emailId, phoneNumber, userName, password } = requestBody;
    const htmlContent = yield fs_1.default.promises.readFile(path_1.default.join(__dirname, "welcome.html"), "utf8");
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
        const info = yield transporter.sendMail({
            from: `"ViaExam" <${config_1.default.email.smtp.auth.user}>`,
            to: emailId,
            subject: "Registration Completed",
            html: htmlContentFile,
        });
        return true;
    }
    catch (error) {
        console.error("Error sending email:", error);
        return false;
    }
});
exports.sendEmailToNewUser = sendEmailToNewUser;
// ─── Login details for teachers, scanner staff and students ────────────────────
// kind: "created" (new account), "reset" (a new password was set for them) or
// "details" (their login email and sign-in link only; the password is unchanged and is
// not in the email, because it is stored encrypted and can't be read back).
/** Text from the database or a form, safe to put inside the email's HTML. */
const escapeHtml = (v) => String(v !== null && v !== void 0 ? v : "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
exports.escapeHtml = escapeHtml;
/** Sends one email now; throws when the mail server refuses it. */
const deliverMail = (message) => __awaiter(void 0, void 0, void 0, function* () {
    yield transporter.sendMail(Object.assign({ from: `"ViaExam" <${config_1.default.email.smtp.auth.user}>`, to: message.to, subject: message.subject, html: message.html }, (message.replyTo ? { replyTo: message.replyTo } : {})));
});
/** "ad***@gmail.com": enough to tell addresses apart in a log, not to collect them. */
const maskEmail = (email) => {
    const [name, domain] = String(email !== null && email !== void 0 ? email : "").split("@");
    return domain ? `${name.slice(0, 2)}***@${domain}` : "***";
};
exports.maskEmail = maskEmail;
const KIND_LABEL = {
    contact: "contact form",
    "subscription-reminder": "plan renewal reminder",
    otp: "sign-in code",
    "password-reset": "new password",
    "login-details": "login details",
    "new-account": "new account's login details",
    "admin-credentials": "admin login details",
};
const SENT = { sent: true };
/** Saves a reset's password (the email with it has been accepted) and ends the user's sessions. */
const applyPassword = ({ userId, hash }) => __awaiter(void 0, void 0, void 0, function* () {
    const [count] = yield User_model_1.default.update({ password: hash }, { where: { userId, isDeleted: false } });
    if (!count)
        logger_1.default.warn(`[Email] User ${userId} no longer exists; the emailed password was not saved.`);
    else
        yield (0, session_service_1.endAllSessions)(userId, "password-reset");
});
const isRejection = (err) => {
    // 5xx from the mail server (no such mailbox, address rejected) won't change on retry.
    const code = Number(err === null || err === void 0 ? void 0 : err.responseCode);
    return (code >= 500 && code < 600) || (err === null || err === void 0 ? void 0 : err.code) === "EENVELOPE";
};
const emailQueue = (0, queue_1.defineQueue)({
    name: "emails",
    concurrency: (0, config_2.positiveInt)(process.env.EMAIL_QUEUE_CONCURRENCY, 2),
    defaults: { attempts: 6, backoff: { type: "exponential", delayMs: 60000 }, keepCompletedSec: 0, keepFailedSec: 3 * 24 * 3600 },
    processor: (job) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const { kind, notAfter } = job.data;
        if (notAfter && Date.now() > notAfter) {
            logger_1.default.warn(`[Email] A ${KIND_LABEL[kind]} email expired before the mail server took it; dropped.`);
            return { skipped: "expired" };
        }
        const email = (0, sealed_1.unseal)(job.data.sealed);
        // A retry after the email went out (the password save failed) doesn't send it twice.
        if (!((_a = job.lastProgress) === null || _a === void 0 ? void 0 : _a.sent)) {
            try {
                yield deliverMail(email.message);
            }
            catch (err) {
                if (isRejection(err))
                    throw new queue_1.PermanentJobError(`The mail server rejected the email: ${(err === null || err === void 0 ? void 0 : err.message) || err}`);
                throw err;
            }
            yield job.progress(SENT);
        }
        if (email.setPassword)
            yield applyPassword(email.setPassword);
        return SENT;
    }),
    onFailed: (job, err) => __awaiter(void 0, void 0, void 0, function* () {
        var _b;
        let to = "***";
        let resetsPassword = false;
        try {
            const email = (0, sealed_1.unseal)(job.data.sealed);
            to = (0, exports.maskEmail)(email.message.to);
            resetsPassword = !!email.setPassword;
        }
        catch (_c) {
            /* unreadable: say what we know */
        }
        const reason = String((err === null || err === void 0 ? void 0 : err.message) || err).slice(0, 200);
        const label = (_b = KIND_LABEL[job.data.kind]) !== null && _b !== void 0 ? _b : "email";
        logger_1.default.error(`[Email] The ${label} email to ${to} could not be sent${resetsPassword ? " (the password was not changed)" : ""}: ${reason}`);
        const notify = job.data.notify;
        if (!notify)
            return;
        const { notifyAll } = require("../services/notification/notifyPeople");
        yield notifyAll([
            {
                instituteId: notify.instituteId,
                userId: notify.userId,
                type: "EMAIL_NOT_SENT",
                title: `Email not sent: ${label}`,
                message: `The ${label} email to ${to} could not be sent (${reason}).${resetsPassword ? " Their password was not changed." : ""} Check the address and send it again.`,
                referenceId: job.id,
            },
        ]);
    }),
});
/** Sends now, in this process, when the queue can't take the email. Never throws. */
const sendInBackground = (email, kind) => {
    void (() => __awaiter(void 0, void 0, void 0, function* () {
        try {
            yield deliverMail(email.message);
            if (email.setPassword)
                yield applyPassword(email.setPassword);
        }
        catch (err) {
            logger_1.default.error(`[Email] The ${KIND_LABEL[kind]} email to ${(0, exports.maskEmail)(email.message.to)} could not be sent: ${(err === null || err === void 0 ? void 0 : err.message) || err}`);
        }
    }))();
};
/** Queues an email. Never throws: when the queue is down it is sent from this process instead. */
const queueEmail = (request) => __awaiter(void 0, void 0, void 0, function* () {
    var _d;
    const email = Object.assign({ message: request.message }, (request.setPassword ? { setPassword: request.setPassword } : {}));
    // A unique id, so a deduplicated add is told apart by the id that comes back.
    const jobId = (_d = request.jobId) !== null && _d !== void 0 ? _d : `${request.kind}-${(0, crypto_1.randomUUID)()}`;
    try {
        const id = yield emailQueue.add(request.kind, Object.assign(Object.assign({ sealed: (0, sealed_1.seal)(email), kind: request.kind }, (request.notAfter ? { notAfter: request.notAfter.getTime() } : {})), (request.notify ? { notify: request.notify } : {})), Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ jobId }, (request.dedupeKey ? { dedupeKey: request.dedupeKey } : {})), (request.bulk ? { priority: 10 } : {})), (request.attempts ? { attempts: request.attempts } : {})), (request.retryMs ? { backoff: { type: "exponential", delayMs: request.retryMs } } : {})), (request.notAfter ? { keepFailedSec: 3600 } : {})));
        return { queued: true, duplicate: id !== jobId };
    }
    catch (err) {
        logger_1.default.warn(`[Email] Queue unavailable (${(err === null || err === void 0 ? void 0 : err.message) || err}); sending the ${KIND_LABEL[request.kind]} email to ${(0, exports.maskEmail)(request.message.to)} directly.`);
        sendInBackground(email, request.kind);
        return { queued: false, duplicate: false };
    }
});
exports.queueEmail = queueEmail;
/** Takes a queued email out before it is sent (e.g. the OTP a newer one replaced). False if it already ran. */
const cancelQueuedEmail = (jobId) => emailQueue.remove(jobId).catch(() => false);
exports.cancelQueuedEmail = cancelQueuedEmail;
/** Login details of a new account (bulk: an import queues hundreds). */
const queueUserCredentials = (data) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, exports.queueEmail)({ kind: "new-account", message: (0, exports.composeUserCredentials)(data), bulk: true });
});
exports.queueUserCredentials = queueUserCredentials;
const composeUserCredentials = (data) => {
    var _a, _b;
    const kind = (_a = data.kind) !== null && _a !== void 0 ? _a : "created";
    const e = {
        name: (0, exports.escapeHtml)(data.userName),
        email: (0, exports.escapeHtml)(data.email),
        phone: (0, exports.escapeHtml)(data.phone),
        password: (0, exports.escapeHtml)((_b = data.password) !== null && _b !== void 0 ? _b : ""),
        role: (0, exports.escapeHtml)(data.role),
        url: (0, exports.escapeHtml)(data.loginUrl),
    };
    const intro = kind === "details"
        ? `Here are the login details for your <strong>${e.role}</strong> account on ViaExam. Your password has not changed.`
        : kind === "reset"
            ? `Your school has set a new password for your <strong>${e.role}</strong> account on ViaExam. Your old password no longer works.`
            : `Your <strong>${e.role}</strong> account has been successfully created on ViaExam. Below are your login credentials.`;
    const note = kind === "details"
        ? "Sign in with your current password. If you have forgotten it, use “Forgot password” on the sign-in page, or ask your school to send you a new one."
        : "⚠️ Please change your password immediately after your first login.";
    const subject = kind === "details"
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
exports.composeUserCredentials = composeUserCredentials;
const composeAdminCredentials = (raw) => {
    var _a;
    const data = {
        adminName: (0, exports.escapeHtml)(raw.adminName),
        adminEmail: (0, exports.escapeHtml)(raw.adminEmail),
        adminPassword: (0, exports.escapeHtml)(raw.adminPassword),
        instituteName: (0, exports.escapeHtml)(raw.instituteName),
        loginUrl: (0, exports.escapeHtml)(raw.loginUrl),
        plan: (0, exports.escapeHtml)(String((_a = raw.plan) !== null && _a !== void 0 ? _a : "")),
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
              Your institute <strong>${data.instituteName}</strong> has been successfully 
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
                <span class="cred-value" style="font-size:11px">${data.loginUrl}</span>
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
exports.composeAdminCredentials = composeAdminCredentials;
// ─── Role-specific OTP email templates ──────────────────────────────────────────
const composeOtpEmail = ({ toEmail, userName, otp, role, }) => {
    // Roles are stored in capitals ("TEACHER"); the templates are keyed in lower case.
    const roleSpecificContent = getRoleSpecificOTPContent(String(role !== null && role !== void 0 ? role : "").toLowerCase());
    return {
        to: toEmail,
        subject: roleSpecificContent.subject,
        html: roleSpecificContent.html((0, exports.escapeHtml)(userName), (0, exports.escapeHtml)(otp)),
    };
};
exports.composeOtpEmail = composeOtpEmail;
// Helper function to get role-specific email content
function getRoleSpecificOTPContent(role) {
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
            html: (userName, otp) => `
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
            html: (userName, otp) => `
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
            html: (userName, otp) => `
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
            html: (userName, otp) => `
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
            html: (userName, otp) => `
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
    return roleMessages[role] || roleMessages.student;
}
