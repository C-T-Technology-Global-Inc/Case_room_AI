/** Errors whose message is safe to show to the user. */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "The requested record was not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** The record changed since the user loaded it (stale revision, concurrent update). */
export class ConflictError extends AppError {
  constructor(message = "This record was changed by someone else. Reload and review the latest version.") {
    super(message);
    this.name = "ConflictError";
  }
}

/** Too many requests in a window; the message says when to retry. */
export class RateLimitError extends AppError {
  constructor(message = "Too many requests. Please wait a moment and try again.") {
    super(message);
    this.name = "RateLimitError";
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = "The upload is too large.") {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}
