import { RequestHandler } from 'express';
import { handle } from 'i18next-http-middleware';
import i18next from '../i18n';

/** Picks the request's language from Accept-Language and gives it req.t and req.language. */
export const detectLanguage = handle(i18next);

/**
 * Answers every JSON response's `message` in the request's language, so controllers keep
 * writing English. res.send(object) and the error handler go through res.json as well.
 */
export const translateMessages: RequestHandler = (req, res, next) => {
  // Name the answer's language, and tell caches it depends on Accept-Language.
  res.setHeader('Content-Language', req.i18n?.resolvedLanguage || req.language || 'en');
  res.vary('Accept-Language');
  const json = res.json.bind(res);
  res.json = (body?: unknown) => {
    if (body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string') {
      const { message } = body as { message: string };
      return json({ ...body, message: req.t(message) });
    }
    return json(body);
  };
  next();
};
