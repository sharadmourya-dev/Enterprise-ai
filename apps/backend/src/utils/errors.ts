import { IApiErrorDetails } from '@enterprise-ai/shared-types';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly isOperational = true;
  public readonly details?: IApiErrorDetails[];

  constructor(message: string, statusCode = 500, errorCode = 'INTERNAL_SERVER_ERROR', details?: IApiErrorDetails[]) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad Request', errorCode = 'BAD_REQUEST', details?: IApiErrorDetails[]) {
    super(message, 400, errorCode, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', errorCode = 'UNAUTHORIZED', details?: IApiErrorDetails[]) {
    super(message, 401, errorCode, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', errorCode = 'FORBIDDEN', details?: IApiErrorDetails[]) {
    super(message, 403, errorCode, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource Not Found', errorCode = 'NOT_FOUND') {
    super(message, 404, errorCode);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', errorCode = 'CONFLICT') {
    super(message, 409, errorCode);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation Failed', details?: IApiErrorDetails[]) {
    super(message, 422, 'VALIDATION_ERROR', details);
  }
}

export class BadGatewayError extends AppError {
  constructor(message = 'Bad Gateway', errorCode = 'BAD_GATEWAY', details?: IApiErrorDetails[]) {
    super(message, 502, errorCode, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service Unavailable', errorCode = 'SERVICE_UNAVAILABLE', details?: IApiErrorDetails[]) {
    super(message, 503, errorCode, details);
  }
}
