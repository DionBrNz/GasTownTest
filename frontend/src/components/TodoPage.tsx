import { useCallback, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import type { NewTodo, Todo } from '../api';
import { newPendingId, useCreateTodo, useDeleteTodo, useTodos, useUpdateTodo } from '../todos';
import { AddTodoForm } from './AddTodoForm';
import { TodoTable } from './TodoTable';

interface Props {
  readonly onSignOut: () => void;
}

export function TodoPage({ onSignOut }: Props) {
  const auth = useAuth();
  const todos = useTodos();
  const createTodo = useCreateTodo();
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();
  const [error, setError] = useState<string | undefined>();

  const { mutate: create } = createTodo;
  const { mutate: update } = updateTodo;
  const { mutate: remove } = deleteTodo;

  const handleAdd = useCallback(
    (input: NewTodo) => {
      setError(undefined);
      create(
        { input, pendingId: newPendingId() },
        {
          onError: () => {
            setError("Couldn't add the todo. Please try again.");
          },
        },
      );
    },
    [create],
  );

  const handleToggle = useCallback(
    (todo: Todo) => {
      setError(undefined);
      update(
        { id: todo.id, patch: { completed: !todo.completed } },
        {
          onError: () => {
            setError("Couldn't update the todo. Your change was undone.");
          },
        },
      );
    },
    [update],
  );

  const handleRename = useCallback(
    (todo: Todo, title: string) => {
      setError(undefined);
      update(
        { id: todo.id, patch: { title } },
        {
          onError: () => {
            setError("Couldn't rename the todo. Your change was undone.");
          },
        },
      );
    },
    [update],
  );

  const handleDelete = useCallback(
    (todo: Todo) => {
      setError(undefined);
      remove(todo.id, {
        onError: () => {
          setError("Couldn't delete the todo. It has been restored.");
        },
      });
    },
    [remove],
  );

  const email = auth.user?.profile.email;

  return (
    <>
      <header className="app-header">
        <h1>Todos</h1>
        <div className="account">
          {email !== undefined && <span className="account-email">{email}</span>}
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="content">
        <AddTodoForm onAdd={handleAdd} />
        <div className="alert-region" role="alert">
          {error}
        </div>
        {todos.isPending ? (
          <p role="status">Loading todos…</p>
        ) : todos.isError ? (
          <div role="alert">
            <p>Couldn&apos;t load your todos.</p>
            <button
              type="button"
              onClick={() => {
                void todos.refetch();
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <TodoTable
            todos={todos.data}
            onToggle={handleToggle}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        )}
      </main>
    </>
  );
}
