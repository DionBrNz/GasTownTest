import type { Priority } from './api';

/** Same limits as the API contract. */
export const TITLE_MAX_LENGTH = 200;
export const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high'];

export function isPriority(value: string): value is Priority {
  return (PRIORITIES as readonly string[]).includes(value);
}

/** Returns an error message, or undefined if the (already trimmed) title is valid. */
export function validateTitle(title: string): string | undefined {
  if (title.length === 0) return 'Title is required.';
  if (title.length > TITLE_MAX_LENGTH) {
    return `Title must be ${String(TITLE_MAX_LENGTH)} characters or fewer.`;
  }
  return undefined;
}

/** Returns an error message, or undefined if empty or a real calendar date (YYYY-MM-DD). */
export function validateDueDate(value: string): string | undefined {
  if (value === '') return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return 'Due date must be a date (YYYY-MM-DD).';
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return 'Due date must be a real date.';
  }
  return undefined;
}
