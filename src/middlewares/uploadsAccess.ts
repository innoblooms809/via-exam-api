/**
 * Keeps uploads/private/ out of the public /uploads static server (see utils/localFileStorage).
 *
 *   private/model-answers/<institute>/…  only to a signed-in admin or teacher of that institute,
 *                                        or the super admin — by the sign-in cookie the browser
 *                                        sends with an <img>, an iframe or a PDF.js request
 *   anything else under private/         never: answer sheets are read through
 *                                        GET /v1/scanner/getFile/:sheetId, which checks access
 *                                        to the sheet
 *
 * Paths are compared as the file system resolves them (fs.realpath.native), so "..", encoded
 * slashes, letter case, symbolic links and Windows short names or trailing dots can't reach a
 * private file through a public-looking address.
 */

import fs from "fs";
import path from "path";
import { promisify } from "util";
import { NextFunction, Request, Response } from "express";
import { authenticate, authorize } from "./auth";
import { ACADEMIC, SUPER_ADMIN } from "../config/roles";
import { isInside } from "../utils/localFileStorage";

const realpath = promisify(fs.realpath.native);

const notFound = (res: Response) => res.status(404).end();

const isSuperAdmin = (user: any) =>
  String(user?.role?.role ?? "").toUpperCase().replace(/[\s_-]+/g, "") === "SUPERADMIN";

/** @param uploadsRoot the folder the static server serves (its private/ part is guarded). */
export const guardPrivateUploads = (uploadsRoot: string) => {
  const privateRoot = path.join(uploadsRoot, "private");
  const modelAnswersRoot = path.join(privateRoot, "model-answers");
  const readers = authorize([...ACADEMIC, ...SUPER_ADMIN]);

  // Their real paths, once the folders exist.
  let roots: Promise<{ privateRoot: string; modelAnswers: string }> | null = null;
  const realRoots = () => {
    if (!roots) {
      roots = (async () => {
        await fs.promises.mkdir(modelAnswersRoot, { recursive: true });
        return { privateRoot: await realpath(privateRoot), modelAnswers: await realpath(modelAnswersRoot) };
      })();
      roots.catch(() => {
        roots = null;
      });
    }
    return roots;
  };

  return async (req: Request, res: Response, next: NextFunction) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(req.path || "");
    } catch {
      return res.status(400).end();
    }
    if (decoded.includes("\0")) return res.status(400).end();

    let r: { privateRoot: string; modelAnswers: string };
    try {
      r = await realRoots();
    } catch {
      return notFound(res); // can't tell what is private: serve nothing
    }

    let real: string;
    try {
      real = await realpath(path.join(uploadsRoot, decoded));
    } catch (err: any) {
      // Nothing there: the static server answers 404 for it too.
      return err?.code === "ENOENT" || err?.code === "ENOTDIR" ? next() : notFound(res);
    }

    if (!isInside(real, r.privateRoot)) return next();
    if (real === r.modelAnswers || !isInside(real, r.modelAnswers)) return notFound(res);

    const instituteId = path.relative(r.modelAnswers, real).split(path.sep)[0];
    return authenticate(req, res, () =>
      readers(req, res, () => {
        const user = (req as any).viaExamUser;
        // 404, not 403: an outsider learns nothing about which files exist.
        if (!isSuperAdmin(user) && String(user?.instituteId ?? "") !== instituteId) return notFound(res);
        res.setHeader("Cache-Control", "private, no-store");
        return next();
      }),
    );
  };
};
