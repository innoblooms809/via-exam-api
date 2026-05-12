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
exports.sendAdminCredentials = exports.sendEmailToNewUser = void 0;
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
// console.log(emailId, phoneNumber, userName, password )
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
//       console.log("Email sent successfully");
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
const config_1 = __importDefault(require("../config/config"));
// ─── Transporter ──────────────────────────────────────────────────────────────
const transporter = nodemailer_1.default.createTransport({
    host: config_1.default.email.smtp.host,
    port: Number(config_1.default.email.smtp.port),
    secure: true,
    auth: {
        user: config_1.default.email.smtp.auth.user,
        pass: config_1.default.email.smtp.auth.pass,
    },
    tls: {
        rejectUnauthorized: false,
    },
});
// ─── Existing function — keep as is ───────────────────────────────────────────
const sendEmailToNewUser = (requestBody) => __awaiter(void 0, void 0, void 0, function* () {
    const { emailId, phoneNumber, userName, password } = requestBody;
    console.log(emailId, phoneNumber, userName, password);
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
        yield transporter.sendMail({
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
// ─── NEW — Send admin credentials after institute registration ─────────────────
const sendAdminCredentials = (data) => __awaiter(void 0, void 0, void 0, function* () {
    try {
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
        yield transporter.sendMail({
            from: `"ViaExam" <${config_1.default.email.smtp.auth.user}>`,
            to: data.adminEmail,
            subject: `Welcome to ViaExam — Your Admin Credentials for ${data.instituteName}`,
            html,
        });
        console.log(`✅ Credentials email sent to ${data.adminEmail}`);
        return true;
    }
    catch (e) {
        console.error("❌ sendAdminCredentials failed:", e.message);
        return false; // don't throw — email failure won't break registration
    }
});
exports.sendAdminCredentials = sendAdminCredentials;
