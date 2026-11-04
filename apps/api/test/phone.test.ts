import { describe, expect, it } from 'vitest';
import { maskPhone, normalizeBdPhone } from '../src/auth/phone';

describe('normalizeBdPhone', () => {
  it.each([
    ['01712345678', '+8801712345678'],
    ['01712-345678', '+8801712345678'],
    ['+880 1712 345678', '+8801712345678'],
    ['8801912345678', '+8801912345678'],
    ['008801312345678', '+8801312345678'],
    ['1812345678', '+8801812345678'],
  ])('reads %s as %s', (input, expected) => {
    expect(normalizeBdPhone(input)).toBe(expected);
  });

  it.each(['', '0171234567', '017123456789', '01212345678', '+447700900123', '02-9876543', 'abc'])(
    'refuses %s',
    (input) => {
      expect(normalizeBdPhone(input)).toBeNull();
    },
  );

  it('masks the middle of a number', () => {
    expect(maskPhone('+8801712345678')).toBe('+880 1712-***678');
  });
});
