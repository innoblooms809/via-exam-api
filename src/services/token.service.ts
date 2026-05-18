import jwt from "jsonwebtoken";
import moment, { Moment } from "moment";
import httpStatus from "http-status";
import config from "../config/config";
import ApiError from "../utils/ApiError";

import { AuthTokensResponse } from "../types/response";
import { TOKEN_TYPE } from "../utils/Constants";
// import clientPromise from "../db";
// import candidateService from './candidate/candidate.service';

/**
 * Generate token
 * @param {number} userId
 * @param {Moment} expires
 * @param {string} type
 * @param {string} [secret]
 * @returns {string}
 */
const generateToken = (
  userId: any,
  expires: Moment,
  type: string,
  secret = config.jwt.secret
): string => {
  const payload = {
    sub: userId,
    iat: moment().unix(),
    exp: expires.unix(),
    type,
  };
  return jwt.sign(payload, secret);
};

/**
 * Generate token
 * @param {number} userId
 * @param {Moment} expires
 * @param {string} type
 * @param {string} [secret]
 * @returns {string}
 */
const generateUserToken = (
  user: any,
  expires: Moment,
  type: string,
  secret = config.jwt.secret
): string => {
  const subject =
    typeof user === "object" && user?.userId
      ? { userId: user.userId }
      : user;

  const payload = {
    sub: subject,
    iat: moment().unix(),
    exp: expires.unix(),
    type,
  };
  return jwt.sign(payload, secret);
};

const getUserTokenSubject = (user: any) => {
  const plainUser =
    user && typeof user.toJSON === "function" ? user.toJSON() : user;

  if (!plainUser || typeof plainUser !== "object") {
    return plainUser;
  }

  return {
    id: plainUser.id,
    userId: plainUser.userId,
    userName: plainUser.userName,
    emailId: plainUser.emailId,
    phoneNumber: plainUser.phoneNumber,
    roleId: plainUser.roleId,
    instituteId: plainUser.instituteId,
    status: plainUser.status,
  };
};
/**
 * Save a token
 * @param {string} token
 * @param {number} userId
 * @param {Moment} expires
 * @param {string} type
 * @param {boolean} [blacklisted]
 * @returns {Promise<Token>}
 */
// const saveToken = async (
//   token: string,
//   registrationid: number | string,
//   expires: Moment,
//   type: any,
//   blacklisted = false
// ): Promise<any> => {
//   let db = await clientPromise;
//   let tokenCollections = await db.collection("tokens");
//   return tokenCollections.replaceOne(
//     { registrationid: registrationid },
//     {
//       token,
//       registrationid: registrationid,
//       expires: expires.toDate(),
//       type,
//       blacklisted,
//     }
//   );

//   // const createdToken = prisma.token.create({
//   //   data: {
//   //     token,
//   //     userId: userId,
//   //     expires: expires.toDate(),
//   //     type,
//   //     blacklisted
//   //   }
//   // });
//   // return createdToken;
// };

// const savedUserToken = async (
//   token: string,
//   registrationid: string,
//   expires: string, // Assuming Moment is formatted to a string or ISO date string
//   type: string,
//   blacklisted = false
// ): Promise<any> => {
//   // Try to find the existing token record based on uuid and type
//   let data: any = await Token.findOne({
//     where: {
//       uuid: registrationid,
//       type: type,
//     },
//   });

//   // If the token exists, update it
//   if (data) {
//     // Update the existing record
//     data.token = token;
//     data.expires = expires;
//     data.blacklisted = blacklisted;
//     await data.save(); // Save the updated data

//     return data; // Return the updated record
//   }

//   // If no token exists, create a new one
//   let newToken = await Token.create({
//     token,
//     uuid: registrationid,
//     expires,
//     type,
//     blacklisted,
//   });

//   return newToken; // Return the newly created token
// };

/**
 * Verify token and return token doc (or throw an error if it is not valid)
 * @param {string} token
 * @param {string} type
 * @returns {Promise<Token>}
 */

// const verifyCandidateToken = async (token: string, type: any): Promise<any> => {
//   const payload = jwt.verify(token, config.jwt.secret);
//   const { registrationid }: any = payload.sub;
//   let query = { token, type, uuid: registrationid };
//   let doc = await Tokens.findOne(query);
//   if (!doc) {
//     throw new Error("Token not found");
//   }
//   return doc;
// };

/**
 * Generate auth tokens
 * @param {User} user
 * @returns {Promise<AuthTokensResponse>}
 */

/**
 * Generate auth tokens
 * @param {User} user
 * @returns {Promise<AuthTokensResponse>}
 */
const generateUserAuthTokens = async (
  user: any
): Promise<AuthTokensResponse> => {
  const accessTokenExpires = moment().add(
    config.jwt.accessExpirationMinutes,
    "minutes"
  );
  const accessToken = generateUserToken(
    user,
    accessTokenExpires,
    TOKEN_TYPE.ACCESS
  );
  const refreshTokenExpires: any = moment().add(
    config.jwt.refreshExpirationDays,
    "days"
  );
  const refreshToken = generateUserToken(
    user,
    refreshTokenExpires,
    TOKEN_TYPE.REFRESH
  );

  return {
    access: {
      token: accessToken,
      expires: accessTokenExpires.toDate(),
    },
    refresh: {
      token: refreshToken,
      expires: refreshTokenExpires.toDate(),
    },
  };
};

/**
 * Generate reset password token
 * @param {string} email
 * @returns {Promise<string>}
 */
// const generateResetPasswordToken = async (email: string): Promise<string> => {
//   const user = await userService.getUserByEmail(email);
//   if (!user) {
//     throw new ApiError(httpStatus.NOT_FOUND, 'No users found with this email');
//   }
//   const expires = moment().add(config.jwt.resetPasswordExpirationMinutes, 'minutes');
//   const resetPasswordToken = generateToken(user.id as number, expires, TokenType.RESET_PASSWORD);
//   await saveToken(resetPasswordToken, user.id as number, expires, TokenType.RESET_PASSWORD);
//   return resetPasswordToken;
// };
// const generateResetPasswordToken = async (email: string): Promise<string> => {
//   let candidate = await candidateService.getCandidateByEmail(email);
//   let resetPasswordToken = '';
//   if (candidate && Array.isArray(candidate) && candidate.length > 0) {
//     candidate = candidate[0];
//     if (!candidate) {
//       throw new ApiError(httpStatus.NOT_FOUND, 'No candidates found with this email');
//     }
//     const expires = moment().add(config.jwt.resetPasswordExpirationMinutes, 'minutes');
//     resetPasswordToken = generateToken(candidate as string, expires, TOKEN_TYPE.RESET_PASSWORD);
//     await savedUserToken(
//       resetPasswordToken,
//       candidate.registrationid as string,
//       expires,
//       TOKEN_TYPE.RESET_PASSWORD
//     );
//   }
//   if (candidate == null) {
//     throw new ApiError(httpStatus.UNAUTHORIZED, 'No candidates found with this email');
//   }
//   return resetPasswordToken;
// };

/**
 * Generate verify email token
 * @param {User} user
 * @returns {Promise<string>}
 */
// const generateVerifyEmailToken = async (user: any): Promise<string> => {
//   const expires = moment().add(
//     config.jwt.verifyEmailExpirationMinutes,
//     "minutes"
//   );
//   const verifyEmailToken = generateToken(
//     user.id,
//     expires,
//     TOKEN_TYPE.VERIFY_EMAIL
//   );
//   await saveToken(verifyEmailToken, user.id, expires, TOKEN_TYPE.VERIFY_EMAIL);
//   return verifyEmailToken;
// };

// const verifyCandidateTokenForResetPass = async (
//   token: string
// ): Promise<any> => {
//   const payload = jwt.verify(token, config.jwt.secret);
//   const { candidateEmail }: any = payload.sub;
//   return candidateEmail;
// };

export default {
  generateToken,
  // saveToken,
  //   generateResetPasswordToken,
  // generateVerifyEmailToken,
  generateUserAuthTokens,
  // verifyCandidateToken,
  // verifyCandidateTokenForResetPass,
};
