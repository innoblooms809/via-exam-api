import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import httpStatus from 'http-status';

/**
 * Brute-force limits on sign-in, password recovery and password change. Only failed attempts
 * count (a successful sign-in costs nothing), keyed by the visitor's address *and* the account:
 * guessing one account's password is slowed, and nobody can lock everyone else out. Behind a
 * proxy, TRUST_PROXY (app.ts) makes the address the visitor's rather than the proxy's; without it
 * the limit is simply per account.
 *
 * Counted in this process's memory: with several API processes each one counts on its own.
 */
const WINDOW_MINUTES = 15;

const limitFailures = (max: number, key: (req: Request) => string) =>
  rateLimit({
    windowMs: WINDOW_MINUTES * 60 * 1000,
    max,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip}|${key(req).trim().toLowerCase().slice(0, 320)}`,
    skip: () => process.env.NODE_ENV === 'test',
    handler: (_req, res) =>
      res.status(httpStatus.TOO_MANY_REQUESTS).json({
        error: true,
        statusCode: httpStatus.TOO_MANY_REQUESTS,
        message: `Too many attempts. Please wait ${WINDOW_MINUTES} minutes and try again.`,
      }),
  });

/** POST /login: 10 wrong passwords per account and address in 15 minutes. */
export const loginLimiter = limitFailures(10, (req) => String(req.body?.emailId ?? ''));

/** Forgot password, OTP check, reset, resend login details. */
export const recoveryLimiter = limitFailures(10, (req) => String(req.body?.email ?? ''));

/** Change password (after authenticate): wrong current passwords of a signed-in user. */
export const passwordChangeLimiter = limitFailures(5, (req: any) => String(req.viaExamUser?.userId ?? ''));
