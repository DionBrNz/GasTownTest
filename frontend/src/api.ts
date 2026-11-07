export type Priority = 'low' | 'medium' | 'high';

export interface Todo {
  readonly id: string;
  readonly title: string;
  readonly completed: boolean;
  readonly priority: Priority;
  readonly dueDate: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewTodo {
  readonly title: string;
  readonly priority?: Priority;
  readonly dueDate?: string;
}

export interface TodoPatch {
  readonly title?: string;
  readonly completed?: boolean;
  readonly priority?: Priority;
  readonly dueDate?: string | null;
}

interface TodoPage {
  readonly items: Todo[];
  readonly nextToken?: string;
}

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface TodoApi {
  listAll(): Promise<Todo[]>;
  create(input: NewTodo): Promise<Todo>;
  update(id: string, patch: TodoPatch): Promise<Todo>;
  remove(id: string): Promise<void>;
}

/** The API's maximum page size. */
const PAGE_LIMIT = 100;

export function createTodoApi(
  apiUrl: string,
  getAccessToken: () => Promise<string | undefined>,
): TodoApi {
  async function request(
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<Response> {
    const token = await getAccessToken();
    if (token === undefined) {
      throw new ApiError(401, 'Not signed in');
    }
    const headers = new Headers({ Accept: 'application/json', Authorization: `Bearer ${token}` });
    const requestInit: RequestInit = { method: init.method, headers, credentials: 'omit' };
    if (init.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      requestInit.body = JSON.stringify(init.body);
    }
    const response = await fetch(`${apiUrl}${path}`, requestInit);
    if (!response.ok) {
      let message = `Request failed (HTTP ${String(response.status)})`;
      try {
        const body: unknown = await response.json();
        if (typeof body === 'object' && body !== null && 'message' in body) {
          const bodyMessage = body.message;
          if (typeof bodyMessage === 'string') message = bodyMessage;
        }
      } catch {
        // Non-JSON error body: keep the generic message.
      }
      throw new ApiError(response.status, message);
    }
    return response;
  }

  const todoPath = (id: string) => `/todos/${encodeURIComponent(id)}`;

  return {
    async listAll() {
      const items: Todo[] = [];
      const seen = new Set<string>();
      let nextToken: string | undefined;
      do {
        const query = new URLSearchParams({ limit: String(PAGE_LIMIT) });
        if (nextToken !== undefined) query.set('nextToken', nextToken);
        const response = await request(`/todos?${query.toString()}`, { method: 'GET' });
        const page = (await response.json()) as TodoPage;
        items.push(...page.items);
        nextToken = page.nextToken;
        if (nextToken !== undefined) {
          if (seen.has(nextToken)) throw new ApiError(500, 'Pagination did not advance');
          seen.add(nextToken);
        }
      } while (nextToken !== undefined);
      return items;
    },

    async create(input) {
      const response = await request('/todos', { method: 'POST', body: input });
      return (await response.json()) as Todo;
    },

    async update(id, patch) {
      const response = await request(todoPath(id), { method: 'PATCH', body: patch });
      return (await response.json()) as Todo;
    },

    async remove(id) {
      await request(todoPath(id), { method: 'DELETE' });
    },
  };
}
