import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Normalizes every error response into a consistent JSON envelope:
 * { statusCode, message, error, path, timestamp }
 *
 * An exception whose response is a plain object (not just a string or a
 * bare `{message}`, e.g. PlanLimitExceededException's structured
 * `{code, feature, limit, usage, remaining}` body) has those extra fields
 * merged in too — spread first, so the five canonical fields below always
 * win if a name ever collided. Every existing exception in this codebase
 * only ever passes a string or `{message}`, so this is purely additive:
 * spreading `{message}` and then setting `message` again to the same
 * value changes nothing observable.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = isHttpException
      ? exception.getResponse()
      : 'Internal server error';

    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : ((exceptionResponse as { message?: string | string[] }).message ??
          'Unexpected error');

    if (!isHttpException) {
      this.logger.error(exception);
    }

    const extra =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? (exceptionResponse as Record<string, unknown>)
        : {};

    response.status(status).json({
      ...extra,
      statusCode: status,
      message,
      error: HttpStatus[status] ?? 'Error',
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
