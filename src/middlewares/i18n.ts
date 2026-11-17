import { RequestHandler } from 'express';
import { handle } from 'i18next-http-middleware';
import i18next from '../i18n';
import { localizeBody } from '../i18n/message';

/** Picks the request's language from Accept-Language and gives it req.t and req.language. */
export const detectLanguage = handle(i18next);

/**
 * Answers every JSON response in the request's language, so controllers keep writing English:
 * messages with values (msg(), see i18n/message.ts) wherever they are in the body, and a fixed
 * `message` by its English text. res.send(object) and the error handler go through res.json too.
 */
export const translateMessages: RequestHandler = (req, res, next) => {
  const lng = req.i18n?.resolvedLanguage || req.language || 'en';
  // Name the answer's language, and tell caches it depends on Accept-Language.
  res.setHeader('Content-Language', lng);
  res.vary('Accept-Language');
  const t = req.t ?? i18next.getFixedT(lng);
  const json = res.json.bind(res);
  res.json = (body?: unknown) => {
    const localized = localizeBody(body, t, lng);
    if (localized && typeof localized === 'object' && typeof (localized as { message?: unknown }).message === 'string') {
      const { message } = localized as { message: string };
      return json({ ...(localized as object), message: t(message) });
    }
    return json(localized);
  };
  next();
};
