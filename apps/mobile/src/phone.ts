import { ApiError } from './api';

/** The number as an 11-digit local number (01XXXXXXXXX), accepting it with or without the 0. */
export function localNumber(typed: string): string {
  const digits = typed.replace(/\D/g, '');
  return digits.startsWith('1') ? `0${digits}` : digits;
}

/** A light check only; the API has the final say. */
export const looksValid = (typed: string): boolean => /^01[3-9]\d{8}$/.test(localNumber(typed));

export function waitText(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

export function codeRequestError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'We could not reach the server. Check your connection.';
  switch (error.code) {
    case 'invalid_phone':
      return 'That does not look like a Bangladesh mobile number. Check it and try again.';
    case 'too_many_codes':
      return error.retryAfterSeconds
        ? `You have asked for a lot of codes. Try again in ${waitText(error.retryAfterSeconds)}.`
        : 'You have asked for a lot of codes. Try again a little later.';
    case 'sms_failed':
      return 'We could not send the text message. Try again in a moment.';
    default:
      return error.message;
  }
}
