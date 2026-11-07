import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import type { NewTodo, Todo, TodoApi, TodoPatch } from './api';

export const TodoApiContext = createContext<TodoApi | null>(null);

function useTodoApi(): TodoApi {
  const api = useContext(TodoApiContext);
  if (api === null) throw new Error('TodoApiContext is not provided');
  return api;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1 },
      mutations: { retry: 0 },
    },
  });
}

const TODOS_KEY = ['todos'] as const;

/** Prefix for client-side ids of todos that the server hasn't confirmed yet. */
export const PENDING_ID_PREFIX = 'pending-';

export function isPending(todo: Todo): boolean {
  return todo.id.startsWith(PENDING_ID_PREFIX);
}

export function useTodos() {
  const api = useTodoApi();
  // Loads every page (nextToken) so the table can sort, filter and paginate locally.
  return useQuery({ queryKey: TODOS_KEY, queryFn: () => api.listAll() });
}

interface Snapshot {
  readonly previous: Todo[] | undefined;
}

/**
 * Shared optimistic-update plumbing: cancel in-flight fetches, apply `change` to the
 * cache, roll back to the snapshot on error, and refetch once the mutation settles.
 */
function useOptimisticTodoMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  change: (todos: Todo[], variables: TVariables) => Todo[],
  onSuccess?: (result: TResult, variables: TVariables, todos: Todo[]) => Todo[],
) {
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TVariables, Snapshot>({
    mutationFn,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: TODOS_KEY });
      const previous = queryClient.getQueryData<Todo[]>(TODOS_KEY);
      queryClient.setQueryData<Todo[]>(TODOS_KEY, (todos = []) => change(todos, variables));
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context !== undefined) queryClient.setQueryData(TODOS_KEY, context.previous);
    },
    onSuccess: (result, variables) => {
      if (onSuccess === undefined) return;
      queryClient.setQueryData<Todo[]>(TODOS_KEY, (todos = []) =>
        onSuccess(result, variables, todos),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: TODOS_KEY }),
  });
}

interface CreateVariables {
  readonly input: NewTodo;
  readonly pendingId: string;
}

export function useCreateTodo() {
  const api = useTodoApi();
  return useOptimisticTodoMutation<CreateVariables, Todo>(
    ({ input }) => api.create(input),
    (todos, { input, pendingId }) => {
      const now = new Date().toISOString();
      const pending: Todo = {
        id: pendingId,
        title: input.title,
        completed: false,
        priority: input.priority ?? 'medium',
        dueDate: input.dueDate ?? null,
        createdAt: now,
        updatedAt: now,
      };
      return [...todos, pending];
    },
    (created, { pendingId }, todos) => todos.map((t) => (t.id === pendingId ? created : t)),
  );
}

export function newPendingId(): string {
  return `${PENDING_ID_PREFIX}${crypto.randomUUID()}`;
}

interface UpdateVariables {
  readonly id: string;
  readonly patch: TodoPatch;
}

export function useUpdateTodo() {
  const api = useTodoApi();
  return useOptimisticTodoMutation<UpdateVariables, Todo>(
    ({ id, patch }) => api.update(id, patch),
    (todos, { id, patch }) => todos.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    (updated, _variables, todos) => todos.map((t) => (t.id === updated.id ? updated : t)),
  );
}

export function useDeleteTodo() {
  const api = useTodoApi();
  return useOptimisticTodoMutation<string, unknown>(
    (id) => api.remove(id),
    (todos, id) => todos.filter((t) => t.id !== id),
  );
}
