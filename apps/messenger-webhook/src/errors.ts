/** Error thrown when the Facebook request signature check fails. */
export class SignatureVerificationError extends Error {
  readonly statusCode = 403;

  constructor(message = 'Invalid webhook signature') {
    super(message);
    this.name = 'SignatureVerificationError';
  }
}

/** Raised when Facebook's GET verification request specifies an invalid token. */
export class VerificationTokenError extends Error {
  readonly statusCode = 403;

  constructor(message = 'Invalid verification token') {
    super(message);
    this.name = 'VerificationTokenError';
  }
}

/** Wraps failures that occur while relaying events to AG-UI. */
export class DispatchError extends Error {
  readonly statusCode = 502;

  constructor(
    message = 'Failed to dispatch events to AG-UI',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DispatchError';
  }
}
