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
import Institute from "../modals/Institute.modal";
import config from "../config/config";

const getCookieValue = (req: any, name: string): string | undefined => {
  if (req.cookies?.[name]) {
    return req.cookies[name];
  }

  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return undefined;
  }

  return cookieHeader
    .split(";")
    .map((cookie: string) => cookie.trim())
    .find((cookie: string) => cookie.startsWith(`${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
};

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
    const cookieToken = getCookieValue(req, "accessToken");

    if ((!authHeader || !authHeader.startsWith("Bearer ")) && !cookieToken) {
      return res.status(httpStatus.UNAUTHORIZED).json({
        error: true,
        statusCode: httpStatus.UNAUTHORIZED,
        message: "Access token missing.",
      });
    }

    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : cookieToken;

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

    // Fetch fresh user with role and institute
    const user = await UserModal.findOne({
      include: [
        { model: Role, as: "role" },
        { model: Institute, as: "institute" },
      ],
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
    // NOTE: Disabled — existing users may have status=0 from before this check existed
    // if (user.status === 0) {
    //   return res.status(httpStatus.UNAUTHORIZED).json({
    //     error: true,
    //     statusCode: httpStatus.UNAUTHORIZED,
    //     message: "Your account is inactive. Please contact support.",
    //   });
    // }

    // if (user.status === 2) {
    //   return res.status(httpStatus.UNAUTHORIZED).json({
    //     error: true,
    //     statusCode: httpStatus.UNAUTHORIZED,
    //     message: "Your account has been suspended.",
    //   });
    // }

    // Lock check
    // if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    //   const minutesLeft = Math.ceil(
    //     (new Date(user.lockedUntil).getTime() - Date.now()) / 60000
    //   );
    //   return res.status(httpStatus.TOO_MANY_REQUESTS).json({
    //     error: true,
    //     statusCode: httpStatus.TOO_MANY_REQUESTS,
    //     message: `Account locked. Try again in ${minutesLeft} minute(s).`,
    //   });
    // }

    // ─────────────────────────────────────────────
    // TENANT BOUNDARY CHECK (X-School-Slug Header Guard)
    // ── Purpose: Prevents cross-school data leaks when a user opens a different school's
    // ── URL path in another browser tab or window.
    // ── Verifies that the requested URL school slug ('X-School-Slug') matches the school
    // ── assigned to the active user session in the database ('user.institute.slug').
    // ─────────────────────────────────────────────
    const userAny = user as any;
    const userRole = userAny.role?.role;
    // Extract school slug sent by frontend request interceptor
    const requestSlug = (req.headers["x-school-slug"] || req.headers["x-tenant-slug"]) as string | undefined;

    // SuperAdmin users ('SUPER_ADMIN') are exempted from tenant boundary locks so they can manage all schools
    if (userRole !== "SUPER_ADMIN" && requestSlug && userAny.institute?.slug) {
      const userSlug = userAny.institute.slug;
      // If active session school does not match requested route school, reject with HTTP 403 Forbidden
      if (userSlug !== requestSlug) {
        return res.status(httpStatus.FORBIDDEN).json({
          error: true,
          statusCode: httpStatus.FORBIDDEN,
          message: `Tenant mismatch. Your active session is for school '${userSlug}', but the requested route is '${requestSlug}'. Please log in again for '${requestSlug}'.`,
        });
      }
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
    const userRole = req.viaExamUser?.role?.role;

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
