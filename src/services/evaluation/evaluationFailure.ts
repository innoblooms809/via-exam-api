/**
 * Why an evaluation run failed, as a code the queue page explains in the teacher's language and
 * a detail a developer can act on. Saved with the run (AIEvaluation.failure); older rows have
 * only their text, which `failureOf` reads the same way.
 *
 *   ocr_unreachable   the OCR server couldn't be reached (down, wrong address, connection refused)
 *   ocr_timeout       the OCR server didn't answer within EVAL_OCR_TIMEOUT_MIN
 *   ocr_error         the OCR server failed while reading (an error status, a dropped connection)
 *   ocr_rejected      the OCR server refused the request (a file it can't read, a missing token)
 *   ai_unreachable, ai_timeout, ai_error, ai_rejected   the same for the AI evaluation server
 *   sheet_missing     the answer sheet was deleted while it waited
 *   stuck             the run didn't finish within EVAL_STUCK_HOURS
 *   interrupted       the run's job was lost (a restart or crash); the watchdog stopped it
 *   unknown           anything else; the detail says what
 *
 * "Unreachable" fails a run once its attempts are used up while the server is down (see
 * handleServiceError in pipeline6.service). A failed run is never re-run on its own.
 */

export type FailureStage = "ocr" | "ai";

export type FailureCode =
  | "ocr_unreachable"
  | "ocr_timeout"
  | "ocr_error"
  | "ocr_rejected"
  | "ai_unreachable"
  | "ai_timeout"
  | "ai_error"
  | "ai_rejected"
  | "sheet_missing"
  | "stuck"
  | "interrupted"
  | "unknown";

export interface EvaluationFailure {
  code: FailureCode;
  stage: FailureStage | null;
  /** What went wrong, as the server or the network said it (English, for developers). */
  detail: string;
  /** Attempts made / allowed when it gave up. */
  attempts?: number;
  maxAttempts?: number;
  /** The service address that failed (shows a wrong or stale address at a glance). */
  target?: string;
  /** The API process that recorded it (host#pid). */
  instance?: string;
  at?: string;
}

/** What kind of trouble a call to a Python service ran into. */
export type ServiceProblem = "down" | "timeout" | "busy" | "rejected" | "error";

const DOWN_CODES = new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EHOSTDOWN", "ENOTFOUND", "EAI_AGAIN"]);

export function serviceProblem(err: any): ServiceProblem {
  const status: number | undefined = err?.response?.status;
  if (status === 503 || status === 429) return "busy";
  if (status && status >= 400 && status < 500 && status !== 408) return "rejected";
  if (status) return "error";
  const code = String(err?.code || "");
  const message = String(err?.message || "");
  // axios: "timeout of 3600000ms exceeded" (ECONNABORTED, or ETIMEDOUT with clarified timeouts).
  if (/timeout of \d+ms exceeded/i.test(message)) return "timeout";
  if (DOWN_CODES.has(code) || (code === "ETIMEDOUT" && /\bconnect\b/i.test(message))) return "down";
  return "error"; // ECONNRESET, socket hang up, EPIPE, …: it answered, then broke off
}

/** A stage error that carries its failure code (kept by both queue drivers through to onFailed). */
export class StageFailure extends Error {
  readonly failureCode: FailureCode;
  constructor(failureCode: FailureCode, message: string, options: { permanent: boolean }) {
    super(message);
    this.failureCode = failureCode;
    // isPermanent() goes by the name, so the queue doesn't retry a permanent one.
    this.name = options.permanent ? "PermanentJobError" : "StageFailure";
  }
}

const STAGE_PREFIX = /^(?:Re-evaluation failed:\s*)?(OCR|AI evaluation) failed:\s*/i;

const stageOfText = (text: string): FailureStage | null => {
  const prefix = STAGE_PREFIX.exec(text)?.[1];
  if (prefix) return /^OCR$/i.test(prefix) ? "ocr" : "ai";
  if (/\bOCR (?:server|step|service)\b/i.test(text)) return "ocr";
  if (/\bAI (?:server|step|service)\b/i.test(text)) return "ai";
  return null;
};

/** The code of a stored failure text (rows saved before codes, and errors without one). */
export function classifyFailureText(text: string): { code: FailureCode; stage: FailureStage | null } {
  const t = String(text || "");
  const stage = stageOfText(t);
  if (/answer sheet was deleted/i.test(t)) return { code: "sheet_missing", stage };
  if (/did not finish within \d+ hours/i.test(t)) return { code: "stuck", stage: null };
  if (/evaluation was interrupted/i.test(t)) return { code: "interrupted", stage: null };
  if (!stage) return { code: "unknown", stage: null };
  if (/timeout of \d+ms exceeded|didn['’]t answer within|did not answer within/i.test(t)) return { code: `${stage}_timeout`, stage };
  if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|ENOTFOUND|EAI_AGAIN|connect ETIMEDOUT/i.test(t)) return { code: `${stage}_unreachable`, stage };
  if (/\bwas refused \(\d{3}\)|could not process this sheet \(\d{3}\)/i.test(t)) return { code: `${stage}_rejected`, stage };
  if (/unreachable/i.test(t) && !/ECONNRESET|socket hang up|EPIPE/i.test(t)) return { code: `${stage}_unreachable`, stage };
  return { code: `${stage}_error`, stage };
}

/** The failure of a run as saved, or read from its text when no code was saved with it. */
export function failureOf(row: { error?: string | null; failure?: EvaluationFailure | null } | null | undefined): EvaluationFailure | null {
  const error = String(row?.error ?? "").trim();
  if (!error) return null;
  const saved = row?.failure;
  // A code is trusted only with the text it was saved with (an older API may have replaced the text).
  if (saved?.code && saved.detail && error.includes(saved.detail)) return saved;
  const { code, stage } = classifyFailureText(error);
  return { code, stage, detail: error.replace(/^Re-evaluation failed:\s*/i, "").replace(STAGE_PREFIX, "").replace(/\s*The earlier marks are kept\.$/, "") };
}
