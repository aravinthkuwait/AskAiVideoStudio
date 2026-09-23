// Application errors carry a SAFE public message. Anything else becomes a
// generic 500 with a reference id; details go only to protected server logs.
export class AppError extends Error {
  constructor(status, code, publicMessage, details) {
    super(publicMessage);
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
    this.details = details; // safe, user-facing structured details (e.g. validation issues)
  }
}

export const badRequest = (msg, details) => new AppError(400, 'BAD_REQUEST', msg, details);
export const validationError = (details) => new AppError(422, 'VALIDATION_FAILED', 'Some fields are invalid.', details);
export const unauthorized = (msg = 'Please sign in.') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have access to this resource.') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (msg, details) => new AppError(409, 'CONFLICT', msg, details);
export const tooLarge = (msg = 'Upload is too large.') => new AppError(413, 'PAYLOAD_TOO_LARGE', msg);
export const unsupported = (msg) => new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', msg);
export const tooMany = () => new AppError(429, 'RATE_LIMITED', 'Too many requests. Please wait and try again.');
