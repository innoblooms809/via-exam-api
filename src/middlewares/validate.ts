import fs from 'fs';
import httpStatus from 'http-status';
import ApiError from '../utils/ApiError';
import { NextFunction, Request, Response } from 'express';
import pick from '../utils/pick';
import Joi from 'joi';
import i18next, { LANGUAGE_INFO } from '../i18n';

/** Files multer wrote to disk for this request: a request that fails validation must not leave them behind. */
const removeUploadedFiles = (req: Request) => {
  const files: Express.Multer.File[] = [];
  if (Array.isArray(req.files)) files.push(...req.files);
  else if (req.files && typeof req.files === 'object') {
    for (const group of Object.values(req.files)) if (Array.isArray(group)) files.push(...group);
  }
  if (req.file) files.push(req.file);
  for (const file of files) if (file?.path) fs.promises.unlink(file.path).catch(() => undefined);
};

/**
 * Several problems in one message, in the request's language: sentences one after another,
 * Joi's short default messages ("\"classId\" is required") as a list.
 */
const joinMessages = (messages: string[], lng: string) => {
  if (messages.every((m) => /[.!?؟।]$/.test(m))) return messages.join(' ');
  return messages.join((LANGUAGE_INFO[lng]?.dir ?? i18next.dir(lng)) === 'rtl' ? '، ' : ', ');
};

const validate = (schema: object) => (req: Request, res: Response, next: NextFunction) => {
  const validSchema = pick(schema, ['params', 'query', 'body']);
  const obj = pick(req, Object.keys(validSchema));
  const { value, error } = Joi.compile(validSchema)
    .prefs({ errors: { label: 'key' }, abortEarly: false })
    .validate(obj);
  if (error) {
    removeUploadedFiles(req);
    // Each schema message is an English key (locales/<language>/*.json).
    const lng = req.i18n?.resolvedLanguage || req.language || 'en';
    const t = req.t ?? i18next.getFixedT(lng);
    const messages = [...new Set(error.details.map((details) => String(t(details.message))))];
    return next(new ApiError(httpStatus.BAD_REQUEST, joinMessages(messages, lng)));
  }
  Object.assign(req, value);
  return next();
};

export default validate;
