import { describe, expect, it } from 'vitest';
import { validateDueDate, validateTitle } from './validation';

describe('validateTitle', () => {
  it('accepts 1 to 200 characters', () => {
    expect(validateTitle('a')).toBeUndefined();
    expect(validateTitle('a'.repeat(200))).toBeUndefined();
  });

  it('rejects empty and over-long titles', () => {
    expect(validateTitle('')).toBe('Title is required.');
    expect(validateTitle('a'.repeat(201))).toMatch(/200 characters/);
  });
});

describe('validateDueDate', () => {
  it('accepts an empty value or a real date', () => {
    expect(validateDueDate('')).toBeUndefined();
    expect(validateDueDate('2028-02-29')).toBeUndefined();
  });

  it('rejects other formats and impossible dates', () => {
    expect(validateDueDate('29/02/2028')).toBeDefined();
    expect(validateDueDate('2027-02-29')).toBeDefined();
    expect(validateDueDate('2026-13-01')).toBeDefined();
  });
});
