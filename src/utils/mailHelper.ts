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


import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import config from '../config/config';

// Create the transporter
const transporter = nodemailer.createTransport({
  host:  config.email.smtp.host,
  port: config.email.smtp.host,
  secure: false,
  service: 'Gmail',
  auth: {
    user: config.email.smtp.auth.user,
    pass: config.email.smtp.auth.pass
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Function to send OTP email with external HTML content
export const sendEmailToNewUser = async (requestBody: any) => {
  const { emailId, phoneNumber, userName, password } = requestBody;
console.log(emailId, phoneNumber, userName, password )
  // Read the HTML file asynchronously
  const htmlContent = await fs.promises.readFile(path.join(__dirname, 'welcome.html'), 'utf8');

  // You can modify the HTML content, e.g., replacing placeholders with dynamic data
  const htmlContentFile = htmlContent.replace('{{emailId}}', emailId)
                                 .replace('{{mobilleNo}}', phoneNumber)
                                 .replace('{{userName}}', userName)
                                 .replace('{{name}}', userName)
                                 .replace('{{temp_password}}', password);

  // Email options
  const mailOptions = {
    to: emailId,  // Recipient email address
    subject: 'Registration Completed',
    html: htmlContentFile  // The HTML content to be sent
  };

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
};
