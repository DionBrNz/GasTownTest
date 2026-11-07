import { z } from 'zod';

export const PRIORITIES = ['low', 'medium', 'high'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Used when a todo is created without a priority. */
export const DEFAULT_PRIORITY: Priority = 'medium';
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

const titleSchema = z.string().min(1).max(200);
const dueDateSchema = z.iso.date();

export const createTodoSchema = z.strictObject({
  title: titleSchema,
  priority: z.enum(PRIORITIES).optional(),
  dueDate: dueDateSchema.optional(),
});

export const updateTodoSchema = z
  .strictObject({
    title: titleSchema.optional(),
    completed: z.boolean().optional(),
    priority: z.enum(PRIORITIES).optional(),
    // null clears the due date.
    dueDate: dueDateSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  nextToken: z.string().min(1).max(1024).optional(),
});

export const todoIdSchema = z.uuid();

/** Stored DynamoDB item. `dueDate` is absent when unset. */
export interface TodoItem {
  userId: string;
  todoId: string;
  title: string;
  completed: boolean;
  priority: Priority;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

/** Public shape, matching the API contract in the epic. */
export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  priority: Priority;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toTodo(item: TodoItem): Todo {
  return {
    id: item.todoId,
    title: item.title,
    completed: item.completed,
    priority: item.priority,
    dueDate: item.dueDate ?? null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
