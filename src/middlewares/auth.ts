// import jwt from "jsonwebtoken";
// import UserModel from "../modals/User.modal";
// import config from "../config/config";
// import { NextFunction, Request, Response } from "express";


// const authenticate = async (req: any, res: Response, next: NextFunction) => {
//   const token = req.headers.authorization?.split(" ")[1];

//   if (!token) {
//     return res.status(401).json({ message: "Authentication required" });
//   }

//   try {
//     const decodedToken: any = jwt.verify(token, config.jwt.secret);
//     const user = await UserModel.findOne({where:{userId:decodedToken?.sub.userId}});
//     if (!user) {
//       return res.status(404).json({ message: "User not found" });
//     }
//     req.user = user;
//     next();
//   } catch (error) {
//     res.status(401).json({ message: "Invalid token" });
//   }
// };

// export default authenticate;

import jwt from "jsonwebtoken";
import { NextFunction, Response } from "express";
import httpStatus from "http-status";
import UserModal from "../modals/User.modal";
import Role from "../modals/Role.modal";
import config from "../config/config";

// ─── Authenticate ─────────────────────────────────────────────────────────────
// Verifies JWT and attaches user to req.viaExamUser
// Use on every protected route

const authenticate = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(httpStatus.UNAUTHORIZED).json({
        error: true,
        statusCode: httpStatus.UNAUTHORIZED,
        message: "Access token missing.",
      });
    }

    const token = authHeader.split(" ")[1];

    // Verify token
    let decoded: any;
    try {
      decoded = jwt.verify(token, config.jwt.secret);
    } catch (err: any) {
      return res.status(httpStatus.UNAUTHORIZED).json({
        error: true,
        statusCode: httpStatus.UNAUTHORIZED,
        message:
          err.name === "TokenExpiredError"
            ? "Token has expired. Please login again."
            : "Invalid token.",
      });
    }

    // Extract userId — handles both { sub: "userId" } and { sub: { userId: "..." } }
    const userId =
      typeof decoded.sub === "object"
        ? decoded.sub?.userId
        : decoded.sub ?? decoded.userId;

    if (!userId) {
      return res.status(httpStatus.UNAUTHORIZED).json({
        error: true,
        statusCode: httpStatus.UNAUTHORIZED,
        message: "Invalid token payload.",
      });
    }

    // Fetch fresh user with role
    const user = await UserModal.findOne({
      include: [{ model: Role, as: "role" }],
      where: { userId },
    });

    if (!user) {
      return res.status(httpStatus.UNAUTHORIZED).json({
        error: true,
        statusCode: httpStatus.UNAUTHORIZED,
        message: "User not found.",
      });
    }

    // Status checks
    if (user.status === 0) {
      return res.status(httpStatus.UNAUTHORIZED).json({
        error: true,
        statusCode: httpStatus.UNAUTHORIZED,
        message: "Your account is inactive. Please contact support.",
      });
    }

    if (user.status === 2) {
      return res.status(httpStatus.UNAUTHORIZED).json({
        error: true,
        statusCode: httpStatus.UNAUTHORIZED,
        message: "Your account has been suspended.",
      });
    }

    // Lock check
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const minutesLeft = Math.ceil(
        (new Date(user.lockedUntil).getTime() - Date.now()) / 60000
      );
      return res.status(httpStatus.TOO_MANY_REQUESTS).json({
        error: true,
        statusCode: httpStatus.TOO_MANY_REQUESTS,
        message: `Account locked. Try again in ${minutesLeft} minute(s).`,
      });
    }

    // Attach to request — using viaExamUser to avoid conflicts with your old middleware
    req.viaExamUser = user;
    next();

  } catch (e: any) {
    console.error("Authenticate error:", e.message);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Authentication failed.",
    });
  }
};

// ─── Authorize ────────────────────────────────────────────────────────────────
// Call AFTER authenticate — checks if user's role is in the allowed list
// Usage: router.get("/route", authenticate, authorize(["super_admin", "admin"]), controller)

const authorize = (allowedRoles: string[]) => {
  return (req: any, res: Response, next: NextFunction): any => {
    const userRole = req.viaExamUser?.role?.roleName;

    if (!userRole) {
      return res.status(httpStatus.FORBIDDEN).json({
        error: true,
        statusCode: httpStatus.FORBIDDEN,
        message: "Role not found on user.",
      });
    }

    if (!allowedRoles.includes(userRole)) {
      return res.status(httpStatus.FORBIDDEN).json({
        error: true,
        statusCode: httpStatus.FORBIDDEN,
        message: `Access denied. Allowed roles: ${allowedRoles.join(", ")}`,
      });
    }

    next();
  };
};

export { authenticate, authorize };
