import { HttpException, HttpStatus } from '@nestjs/common';

export function tooManyAttempts(retryAfterSeconds: number): HttpException {
  return new HttpException(
    {
      error: 'too_many_attempts',
      message: 'Too many failed attempts. Please wait before trying again.',
      retryAfterSeconds,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
