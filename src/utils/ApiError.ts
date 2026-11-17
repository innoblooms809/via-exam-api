import { LocalizedMessage, type Message } from '../i18n/message';

class ApiError extends Error {
  statusCode: number;
  isOperational: boolean;
  /** The message with its values, answered in the request's language (msg(), i18n/message.ts). */
  localized?: LocalizedMessage;

  constructor(statusCode: number, message: Message | undefined, isOperational = true, stack = '') {
    super(message === undefined ? undefined : String(message));
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    if (message instanceof LocalizedMessage) this.localized = message;
    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export default ApiError;
