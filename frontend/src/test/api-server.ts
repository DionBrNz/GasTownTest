import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import type { NewTodo, Todo, TodoPatch } from '../api';
import type { RuntimeConfig } from '../config';

export const TEST_CONFIG: RuntimeConfig = {
  region: 'us-east-1',
  userPoolId: 'us-east-1_TestPool1',
  clientId: 'testclientid0123456789abcd',
  cognitoDomain: 'todo-test.auth.us-east-1.amazoncognito.com',
  apiUrl: 'https://api.example.test/prod',
};

export const ACCESS_TOKEN = 'test-access-token';

const API = TEST_CONFIG.apiUrl;

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** In-memory stand-in for the todo API, following the contract in the epic. */
class FakeApi {
  todos: Todo[] = [];
  /** Server-side page size cap, to exercise nextToken pagination. */
  pageSize = 100;
  /** When set, mutating requests fail with this status. */
  failMutationsWith: number | undefined;
  requests: RecordedRequest[] = [];
  private seq = 0;

  reset(todos: Todo[] = []) {
    this.todos = [...todos];
    this.pageSize = 100;
    this.failMutationsWith = undefined;
    this.requests = [];
  }

  nextId(): string {
    this.seq += 1;
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`;
  }
}

export const fakeApi = new FakeApi();

function unauthorized(request: Request) {
  return request.headers.get('Authorization') !== `Bearer ${ACCESS_TOKEN}`
    ? HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
    : undefined;
}

async function record(request: Request): Promise<unknown> {
  const url = new URL(request.url);
  const text = request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text();
  const body: unknown = text === '' ? undefined : JSON.parse(text);
  fakeApi.requests.push({ method: request.method, path: url.pathname + url.search, body });
  return body;
}

function failure() {
  return fakeApi.failMutationsWith === undefined
    ? undefined
    : HttpResponse.json({ message: 'Internal error' }, { status: fakeApi.failMutationsWith });
}

export const server = setupServer(
  http.get(`${API}/todos`, async ({ request }) => {
    const denied = unauthorized(request);
    if (denied) return denied;
    await record(request);
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? '100'), fakeApi.pageSize);
    const start = Number(url.searchParams.get('nextToken') ?? '0');
    const items = fakeApi.todos.slice(start, start + limit);
    const end = start + items.length;
    return HttpResponse.json(
      end < fakeApi.todos.length ? { items, nextToken: String(end) } : { items },
    );
  }),

  http.post(`${API}/todos`, async ({ request }) => {
    const denied = unauthorized(request);
    if (denied) return denied;
    const body = (await record(request)) as NewTodo;
    const failed = failure();
    if (failed) return failed;
    const now = new Date().toISOString();
    const todo: Todo = {
      id: fakeApi.nextId(),
      title: body.title,
      completed: false,
      priority: body.priority ?? 'medium',
      dueDate: body.dueDate ?? null,
      createdAt: now,
      updatedAt: now,
    };
    fakeApi.todos.push(todo);
    return HttpResponse.json(todo, { status: 201 });
  }),

  http.patch(`${API}/todos/:id`, async ({ request, params }) => {
    const denied = unauthorized(request);
    if (denied) return denied;
    const patch = (await record(request)) as TodoPatch;
    const failed = failure();
    if (failed) return failed;
    const index = fakeApi.todos.findIndex((t) => t.id === params.id);
    const existing = fakeApi.todos[index];
    if (existing === undefined) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    const updated: Todo = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    fakeApi.todos[index] = updated;
    return HttpResponse.json(updated);
  }),

  http.delete(`${API}/todos/:id`, async ({ request, params }) => {
    const denied = unauthorized(request);
    if (denied) return denied;
    await record(request);
    const failed = failure();
    if (failed) return failed;
    const before = fakeApi.todos.length;
    fakeApi.todos = fakeApi.todos.filter((t) => t.id !== params.id);
    if (fakeApi.todos.length === before) {
      return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    }
    return new HttpResponse(null, { status: 204 });
  }),
);

/** Builds a todo with deterministic timestamps: a higher `n` is created later. */
export function makeTodo(n: number, overrides: Partial<Todo> = {}): Todo {
  const created = new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
  return {
    id: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`,
    title: `Todo ${String(n)}`,
    completed: false,
    priority: 'medium',
    dueDate: null,
    createdAt: created,
    updatedAt: created,
    ...overrides,
  };
}
