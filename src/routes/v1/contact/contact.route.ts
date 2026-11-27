import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import httpStatus from "http-status";
import ContactService from "../../../services/contact/contact.service";

// Public: the landing page's "Get in touch" form (no sign-in). Every submission counts toward
// the limit, valid or not, so the form can't be used to flood the team inbox.
const router = Router();

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  handler: (_req, res) =>
    res.status(httpStatus.TOO_MANY_REQUESTS).json({
      error: true,
      statusCode: httpStatus.TOO_MANY_REQUESTS,
      message: "You've sent several messages already. Please try again in an hour, or email us directly.",
    }),
});

// POST /v1/contact  { name, institution, email, message, website (hidden, must be empty) }
router.post("/", contactLimiter, async (req: Request, res: Response) => {
  const result = await ContactService.submitEnquiry(req.body, { ip: req.ip, userAgent: req.headers["user-agent"] });
  return res.status(result.statusCode).json(result);
});

export default router;
