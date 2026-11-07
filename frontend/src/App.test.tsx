import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, makeTodo } from './test/api-server';
import { renderApp } from './test/render-app';

beforeEach(() => {
  fakeApi.reset();
});

async function findTable() {
  return screen.findByRole('table');
}

/** Titles of the rows on the current page, top to bottom. */
function visibleTitles(): string[] {
  const table = screen.getByRole('table');
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelector('.title-text')?.textContent ?? '');
}

describe('auth gate', () => {
  it('shows only a sign-in button when signed out, and starts the OIDC redirect', async () => {
    const { userManager } = await renderApp({ signedIn: false });
    const signinRedirect = vi.spyOn(userManager, 'signinRedirect').mockResolvedValue();

    const button = await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(fakeApi.requests).toHaveLength(0);

    await userEvent.click(button);
    expect(signinRedirect).toHaveBeenCalledOnce();
  });

  it('shows the todos to a signed-in user and sends the access token', async () => {
    fakeApi.reset([makeTodo(1)]);
    await renderApp();

    await findTable();
    expect(screen.getByText('ada@example.test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    // The fake API answers 401 to anything without the right Bearer token.
    expect(visibleTitles()).toEqual(['Todo 1']);
  });
});

describe('todo table', () => {
  it('loads every page from the API and renders each column', async () => {
    fakeApi.reset([
      makeTodo(1, { title: 'Buy milk', priority: 'high', dueDate: '2026-12-01' }),
      makeTodo(2, { title: 'Walk dog', completed: true }),
      makeTodo(3, { title: 'Write tests', priority: 'low' }),
    ]);
    fakeApi.pageSize = 2;
    await renderApp();
    await findTable();

    await waitFor(() => {
      expect(visibleTitles()).toHaveLength(3);
    });
    expect(fakeApi.requests.map((r) => r.path)).toEqual([
      '/prod/todos?limit=100',
      '/prod/todos?limit=100&nextToken=2',
    ]);
    // Newest first by default.
    expect(visibleTitles()).toEqual(['Write tests', 'Walk dog', 'Buy milk']);

    const milk = screen.getByRole('row', { name: /Buy milk/ });
    expect(within(milk).getByText('high')).toBeInTheDocument();
    expect(within(milk).getByText('2026-12-01')).toBeInTheDocument();
    expect(
      within(milk).getByRole('checkbox', { name: 'Mark "Buy milk" complete' }),
    ).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Mark "Walk dog" complete' })).toBeChecked();
  });

  it('shows an empty state', async () => {
    await renderApp();
    expect(await screen.findByText('No todos yet. Add one above.')).toBeInTheDocument();
  });

  it('sorts by title, priority, due date and created date', async () => {
    fakeApi.reset([
      makeTodo(1, { title: 'banana', priority: 'low', dueDate: '2026-03-01' }),
      makeTodo(2, { title: 'Apple', priority: 'high' }),
      makeTodo(3, { title: 'cherry', priority: 'medium', dueDate: '2026-02-01' }),
    ]);
    await renderApp();
    await findTable();
    const user = userEvent.setup();
    const sortBy = (name: string) =>
      user.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));

    expect(screen.getByRole('columnheader', { name: /Created/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    await sortBy('Title');
    expect(visibleTitles()).toEqual(['Apple', 'banana', 'cherry']);
    expect(screen.getByRole('columnheader', { name: /Title/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await sortBy('Title');
    expect(visibleTitles()).toEqual(['cherry', 'banana', 'Apple']);

    await sortBy('Priority');
    expect(visibleTitles()).toEqual(['banana', 'cherry', 'Apple']);

    await sortBy('Due');
    // Todos with no due date always go last.
    expect(visibleTitles()).toEqual(['cherry', 'banana', 'Apple']);
    await sortBy('Due');
    expect(visibleTitles()).toEqual(['banana', 'cherry', 'Apple']);

    await sortBy('Created');
    expect(visibleTitles()).toEqual(['banana', 'Apple', 'cherry']);
  });

  it('filters by title text and by completed status', async () => {
    fakeApi.reset([
      makeTodo(1, { title: 'Pay rent', completed: true }),
      makeTodo(2, { title: 'Pay gas bill' }),
      makeTodo(3, { title: 'Call mum' }),
    ]);
    await renderApp();
    await findTable();
    const user = userEvent.setup();

    await user.type(screen.getByRole('searchbox', { name: 'Search titles' }), 'PAY');
    expect(visibleTitles()).toEqual(['Pay gas bill', 'Pay rent']);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'completed');
    expect(visibleTitles()).toEqual(['Pay rent']);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'active');
    expect(visibleTitles()).toEqual(['Pay gas bill']);

    await user.type(screen.getByRole('searchbox', { name: 'Search titles' }), 'zzz');
    expect(screen.getByText('No todos match.')).toBeInTheDocument();
  });

  it('paginates ten rows per page', async () => {
    fakeApi.reset(Array.from({ length: 12 }, (_, i) => makeTodo(i + 1)));
    await renderApp();
    await findTable();
    const user = userEvent.setup();

    expect(visibleTitles()).toHaveLength(10);
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(visibleTitles()).toEqual(['Todo 2', 'Todo 1']);
    expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});

describe('adding todos', () => {
  it('posts a valid todo and shows it', async () => {
    await renderApp();
    await findTable();
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox', { name: 'Title' }), '  Plant tomatoes  ');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), 'high');
    await user.type(screen.getByLabelText('Due date'), '2026-12-24');
    await user.click(screen.getByRole('button', { name: 'Add todo' }));

    expect(await screen.findByRole('row', { name: /Plant tomatoes/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(fakeApi.requests.find((r) => r.method === 'POST')?.body).toEqual({
        title: 'Plant tomatoes',
        priority: 'high',
        dueDate: '2026-12-24',
      });
    });
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('');
    // Once the server confirms, the row's controls are enabled.
    await waitFor(() => {
      expect(
        screen.getByRole('checkbox', { name: 'Mark "Plant tomatoes" complete' }),
      ).toBeEnabled();
    });
  });

  it('rejects an empty title without calling the API', async () => {
    await renderApp();
    await findTable();
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox', { name: 'Title' }), '   ');
    await user.click(screen.getByRole('button', { name: 'Add todo' }));

    const title = screen.getByRole('textbox', { name: 'Title' });
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAccessibleDescription('Title is required.');
    expect(fakeApi.requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('removes the optimistic row if the API rejects it', async () => {
    await renderApp();
    await findTable();
    fakeApi.failMutationsWith = 500;
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Doomed');
    await user.click(screen.getByRole('button', { name: 'Add todo' }));

    expect(await screen.findByText("Couldn't add the todo. Please try again.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('row', { name: /Doomed/ })).not.toBeInTheDocument();
    });
  });
});

describe('editing todos', () => {
  it('toggles completed', async () => {
    const todo = makeTodo(1, { title: 'Stretch' });
    fakeApi.reset([todo]);
    await renderApp();
    await findTable();
    const user = userEvent.setup();

    const checkbox = screen.getByRole('checkbox', { name: 'Mark "Stretch" complete' });
    await user.click(checkbox);

    expect(checkbox).toBeChecked();
    await waitFor(() => {
      expect(fakeApi.requests.find((r) => r.method === 'PATCH')).toEqual({
        method: 'PATCH',
        path: `/prod/todos/${todo.id}`,
        body: { completed: true },
      });
    });
  });

  it('rolls back a toggle the API rejects', async () => {
    fakeApi.reset([makeTodo(1, { title: 'Stretch' })]);
    await renderApp();
    await findTable();
    fakeApi.failMutationsWith = 500;
    const user = userEvent.setup();

    const checkbox = screen.getByRole('checkbox', { name: 'Mark "Stretch" complete' });
    await user.click(checkbox);

    expect(
      await screen.findByText("Couldn't update the todo. Your change was undone."),
    ).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it('renames a todo inline with the keyboard', async () => {
    const todo = makeTodo(1, { title: 'Old name' });
    fakeApi.reset([todo]);
    await renderApp();
    await findTable();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Edit title of "Old name"' }));
    const input = screen.getByRole('textbox', { name: 'New title for "Old name"' });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, 'New name{Enter}');

    expect(await screen.findByRole('row', { name: /New name/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit title of "New name"' })).toHaveFocus();
    await waitFor(() => {
      expect(fakeApi.requests.find((r) => r.method === 'PATCH')?.body).toEqual({
        title: 'New name',
      });
    });
  });

  it('cancels an inline edit with Escape', async () => {
    fakeApi.reset([makeTodo(1, { title: 'Keep me' })]);
    await renderApp();
    await findTable();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Edit title of "Keep me"' }));
    await user.type(
      screen.getByRole('textbox', { name: 'New title for "Keep me"' }),
      ' changed{Escape}',
    );

    expect(screen.getByRole('row', { name: /Keep me/ })).toBeInTheDocument();
    expect(fakeApi.requests.some((r) => r.method === 'PATCH')).toBe(false);
  });
});

describe('deleting todos', () => {
  it('deletes after the user confirms', async () => {
    const todo = makeTodo(1, { title: 'Old task' });
    fakeApi.reset([todo, makeTodo(2, { title: 'Other task' })]);
    await renderApp();
    await findTable();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Delete "Old task"' }));

    expect(confirm).toHaveBeenCalledWith(`Delete "Old task"? This can't be undone.`);
    expect(screen.queryByRole('row', { name: /Old task/ })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(fakeApi.requests.find((r) => r.method === 'DELETE')?.path).toBe(
        `/prod/todos/${todo.id}`,
      );
    });
    expect(visibleTitles()).toEqual(['Other task']);
  });

  it('does nothing if the user cancels the confirm', async () => {
    fakeApi.reset([makeTodo(1, { title: 'Old task' })]);
    await renderApp();
    await findTable();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Delete "Old task"' }));

    expect(screen.getByRole('row', { name: /Old task/ })).toBeInTheDocument();
    expect(fakeApi.requests.some((r) => r.method === 'DELETE')).toBe(false);
  });
});
