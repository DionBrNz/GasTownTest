import { describe, expect, test } from 'vitest';
import { createTodoSchema, listQuerySchema, updateTodoSchema } from '../src/lib/todos.js';

describe('createTodoSchema', () => {
  test('accepts a title and optional fields', () => {
    expect(createTodoSchema.safeParse({ title: 'Buy milk' }).success).toBe(true);
    expect(
      createTodoSchema.safeParse({ title: 'x', priority: 'high', dueDate: '2026-12-31' }).success,
    ).toBe(true);
  });

  test.each([
    ['empty title', { title: '' }],
    ['title over 200 chars', { title: 'a'.repeat(201) }],
    ['unknown field', { title: 'x', userId: 'someone-else' }],
    ['bad priority', { title: 'x', priority: 'urgent' }],
    ['bad date format', { title: 'x', dueDate: '31/12/2026' }],
    ['impossible date', { title: 'x', dueDate: '2026-02-30' }],
    ['completed on create', { title: 'x', completed: true }],
  ])('rejects %s', (_label, input) => {
    expect(createTodoSchema.safeParse(input).success).toBe(false);
  });
});

describe('updateTodoSchema', () => {
  test('accepts a subset of fields, with null clearing dueDate', () => {
    expect(updateTodoSchema.safeParse({ completed: true }).success).toBe(true);
    expect(updateTodoSchema.safeParse({ dueDate: null }).success).toBe(true);
  });

  test('rejects an empty object and unknown fields', () => {
    expect(updateTodoSchema.safeParse({}).success).toBe(false);
    expect(updateTodoSchema.safeParse({ id: 'x' }).success).toBe(false);
    expect(updateTodoSchema.safeParse({ updatedAt: 'x' }).success).toBe(false);
  });
});

describe('listQuerySchema', () => {
  test('defaults the limit and enforces 1..100', () => {
    expect(listQuerySchema.parse({}).limit).toBe(50);
    expect(listQuerySchema.parse({ limit: '100' }).limit).toBe(100);
    expect(listQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(listQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(listQuerySchema.safeParse({ limit: 'abc' }).success).toBe(false);
  });
});
