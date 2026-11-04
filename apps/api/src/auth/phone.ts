/**
 * Bangladesh mobile numbers. Accepts what people type (01712-345678, 8801712345678,
 * +880 1712 345678) and returns E.164 (+8801712345678), or null if it is not a BD mobile.
 * Mobile numbers are 01 followed by an operator digit 3-9 and eight more digits.
 */
const BD_MOBILE = /^\+8801[3-9]\d{8}$/;

export function normalizeBdPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '');
  let e164: string;
  if (digits.startsWith('+880')) e164 = digits;
  else if (digits.startsWith('00880')) e164 = `+${digits.slice(2)}`;
  else if (digits.startsWith('880')) e164 = `+${digits}`;
  else if (digits.startsWith('01')) e164 = `+88${digits}`;
  else if (digits.startsWith('1') && digits.length === 10) e164 = `+880${digits}`;
  else return null;
  return BD_MOBILE.test(e164) ? e164 : null;
}

/** +8801712345678 -> +880 1712-***678, for logs and the app's "code sent to" line. */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 4)} ${e164.slice(4, 8)}-***${e164.slice(-3)}`;
}
