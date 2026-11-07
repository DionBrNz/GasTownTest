import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type {
  ColumnFiltersState,
  FilterFn,
  Header,
  PaginationState,
  SortingFn,
  SortingState,
} from '@tanstack/react-table';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Priority, Todo } from '../api';
import { isPending } from '../todos';
import { TITLE_MAX_LENGTH, validateTitle } from '../validation';

type StatusFilter = 'all' | 'active' | 'completed';

function isStatusFilter(value: string): value is StatusFilter {
  return value === 'all' || value === 'active' || value === 'completed';
}

const PRIORITY_RANK: Record<Priority, number> = { low: 0, medium: 1, high: 2 };

const byPriority: SortingFn<Todo> = (a, b, columnId) =>
  PRIORITY_RANK[a.getValue<Priority>(columnId)] - PRIORITY_RANK[b.getValue<Priority>(columnId)];

const byStatus: FilterFn<Todo> = (row, columnId, value: StatusFilter) => {
  const completed = row.getValue<boolean>(columnId);
  return value === 'completed' ? completed : !completed;
};

const PAGE_SIZE = 10;

interface Props {
  readonly todos: Todo[];
  readonly onToggle: (todo: Todo) => void;
  readonly onRename: (todo: Todo, title: string) => void;
  readonly onDelete: (todo: Todo) => void;
}

const column = createColumnHelper<Todo>();

export function TodoTable({ todos, onToggle, onRename, onDelete }: Props) {
  const id = useId();
  const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  });
  const columnFilters = useMemo<ColumnFiltersState>(
    () => (status === 'all' ? [] : [{ id: 'completed', value: status }]),
    [status],
  );

  const columns = useMemo(
    () => [
      column.accessor('completed', {
        header: 'Done',
        enableSorting: false,
        enableGlobalFilter: false,
        filterFn: byStatus,
        cell: ({ row }) => {
          const todo = row.original;
          return (
            <input
              type="checkbox"
              checked={todo.completed}
              disabled={isPending(todo)}
              aria-label={`Mark "${todo.title}" complete`}
              onChange={() => {
                onToggle(todo);
              }}
            />
          );
        },
      }),
      column.accessor('title', {
        header: 'Title',
        sortingFn: 'text',
        cell: ({ row }) => <TitleCell todo={row.original} onRename={onRename} />,
      }),
      column.accessor('priority', {
        header: 'Priority',
        sortingFn: byPriority,
        enableGlobalFilter: false,
        cell: ({ getValue }) => {
          const priority = getValue();
          return <span className={`priority priority-${priority}`}>{priority}</span>;
        },
      }),
      column.accessor((todo) => todo.dueDate ?? undefined, {
        id: 'dueDate',
        header: 'Due',
        sortingFn: 'basic',
        sortUndefined: 'last',
        enableGlobalFilter: false,
        cell: ({ getValue }) => getValue() ?? '—',
      }),
      column.accessor('createdAt', {
        header: 'Created',
        sortingFn: 'basic',
        enableGlobalFilter: false,
        cell: ({ getValue }) => {
          const createdAt = getValue();
          return (
            <time dateTime={createdAt}>
              {new Date(createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            </time>
          );
        },
      }),
      column.display({
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => {
          const todo = row.original;
          return (
            <button
              type="button"
              className="button-danger"
              disabled={isPending(todo)}
              aria-label={`Delete "${todo.title}"`}
              onClick={() => {
                if (window.confirm(`Delete "${todo.title}"? This can't be undone.`)) {
                  onDelete(todo);
                }
              }}
            >
              Delete
            </button>
          );
        },
      }),
    ],
    [onToggle, onRename, onDelete],
  );

  // TanStack Table is a non-memoizable library hook; the React Compiler skips this component.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: todos,
    columns,
    getRowId: (todo) => todo.id,
    state: { sorting, globalFilter, columnFilters, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    globalFilterFn: 'includesString',
    // Keep the current page when a row is toggled or edited; filter changes reset it below.
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // After deletes, the current page can be past the end: step back to the last page.
  const lastPage = Math.max(table.getPageCount() - 1, 0);
  if (pagination.pageIndex > lastPage) {
    setPagination({ ...pagination, pageIndex: lastPage });
  }

  const resetPage = () => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  };
  const rows = table.getRowModel().rows;
  const matching = table.getFilteredRowModel().rows.length;

  return (
    <section aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Your todos</h2>
      <div className="table-controls">
        <div className="field field-grow">
          <label htmlFor={`${id}-search`}>Search titles</label>
          <input
            id={`${id}-search`}
            type="search"
            value={globalFilter}
            onChange={(e) => {
              setGlobalFilter(e.target.value);
              resetPage();
            }}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-status`}>Status</label>
          <select
            id={`${id}-status`}
            value={status}
            onChange={(e) => {
              if (isStatusFilter(e.target.value)) setStatus(e.target.value);
              resetPage();
            }}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      <div className="table-scroll">
        <table>
          <caption className="visually-hidden">
            Todos. Column headers with buttons sort the table.
          </caption>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <HeaderCell key={header.id} header={header} />
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="empty">
                  {todos.length === 0 ? 'No todos yet. Add one above.' : 'No todos match.'}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  aria-busy={isPending(row.original)}
                  className={row.original.completed ? 'row-done' : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={`cell-${cell.column.id}`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <nav className="pagination" aria-label="Pagination">
        <button
          type="button"
          onClick={() => {
            table.previousPage();
          }}
          disabled={!table.getCanPreviousPage()}
        >
          Previous
        </button>
        <p aria-live="polite">
          Page {table.getState().pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
          {' · '}
          {matching} {matching === 1 ? 'todo' : 'todos'}
        </p>
        <button
          type="button"
          onClick={() => {
            table.nextPage();
          }}
          disabled={!table.getCanNextPage()}
        >
          Next
        </button>
      </nav>
    </section>
  );
}

function HeaderCell({ header }: { readonly header: Header<Todo, unknown> }) {
  const label = flexRender(header.column.columnDef.header, header.getContext());
  if (!header.column.getCanSort()) {
    return <th scope="col">{label}</th>;
  }
  const direction = header.column.getIsSorted();
  return (
    <th
      scope="col"
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
    >
      <button
        type="button"
        className="sort-button"
        onClick={header.column.getToggleSortingHandler()}
      >
        {label}
        <span className="sort-indicator" aria-hidden="true">
          {direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '↕'}
        </span>
      </button>
    </th>
  );
}

function TitleCell({
  todo,
  onRename,
}: {
  readonly todo: Todo;
  readonly onRename: (todo: Todo, title: string) => void;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(todo.title);
  const [error, setError] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  // Move focus into the editor when it opens, and back to the Edit button when it closes.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      editButtonRef.current?.focus();
    }
  }, [editing]);

  function close() {
    restoreFocus.current = true;
    setEditing(false);
  }

  function save() {
    const title = draft.trim();
    const titleError = validateTitle(title);
    if (titleError !== undefined) {
      setError(titleError);
      return;
    }
    if (title !== todo.title) onRename(todo, title);
    close();
  }

  if (!editing) {
    return (
      <div className="title-cell">
        <span className="title-text">{todo.title}</span>
        <button
          ref={editButtonRef}
          type="button"
          className="button-quiet"
          disabled={isPending(todo)}
          aria-label={`Edit title of "${todo.title}"`}
          onClick={() => {
            setDraft(todo.title);
            setError(undefined);
            setEditing(true);
          }}
        >
          Edit
        </button>
      </div>
    );
  }

  const errorId = `${id}-error`;
  return (
    <form
      className="title-edit"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label htmlFor={`${id}-input`} className="visually-hidden">
        New title for &quot;{todo.title}&quot;
      </label>
      <input
        ref={inputRef}
        id={`${id}-input`}
        type="text"
        value={draft}
        maxLength={TITLE_MAX_LENGTH}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
      />
      <button type="submit" className="button-quiet">
        Save
      </button>
      <button type="button" className="button-quiet" onClick={close}>
        Cancel
      </button>
      {error !== undefined && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </form>
  );
}
