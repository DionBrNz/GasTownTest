import { useId, useState } from 'react';
import type { NewTodo, Priority } from '../api';
import {
  PRIORITIES,
  TITLE_MAX_LENGTH,
  isPriority,
  validateDueDate,
  validateTitle,
} from '../validation';

interface Props {
  readonly onAdd: (input: NewTodo) => void;
}

interface Errors {
  title?: string;
  dueDate?: string;
}

export function AddTodoForm({ onAdd }: Props) {
  const id = useId();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  function handleSubmit() {
    const trimmed = title.trim();
    const next: Errors = {};
    const titleError = validateTitle(trimmed);
    const dueDateError = validateDueDate(dueDate);
    if (titleError !== undefined) next.title = titleError;
    if (dueDateError !== undefined) next.dueDate = dueDateError;
    setErrors(next);
    if (titleError !== undefined || dueDateError !== undefined) return;

    onAdd(dueDate === '' ? { title: trimmed, priority } : { title: trimmed, priority, dueDate });
    setTitle('');
    setPriority('medium');
    setDueDate('');
  }

  const titleErrorId = `${id}-title-error`;
  const dueErrorId = `${id}-due-error`;

  return (
    <form
      className="add-form"
      aria-label="Add a todo"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <div className="field field-grow">
        <label htmlFor={`${id}-title`}>Title</label>
        <input
          id={`${id}-title`}
          name="title"
          type="text"
          value={title}
          maxLength={TITLE_MAX_LENGTH}
          required
          autoComplete="off"
          aria-invalid={errors.title !== undefined}
          aria-describedby={errors.title !== undefined ? titleErrorId : undefined}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
        {errors.title !== undefined && (
          <p id={titleErrorId} className="field-error">
            {errors.title}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor={`${id}-priority`}>Priority</label>
        <select
          id={`${id}-priority`}
          name="priority"
          value={priority}
          onChange={(e) => {
            if (isPriority(e.target.value)) setPriority(e.target.value);
          }}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-due`}>Due date</label>
        <input
          id={`${id}-due`}
          name="dueDate"
          type="date"
          value={dueDate}
          aria-invalid={errors.dueDate !== undefined}
          aria-describedby={errors.dueDate !== undefined ? dueErrorId : undefined}
          onChange={(e) => {
            setDueDate(e.target.value);
          }}
        />
        {errors.dueDate !== undefined && (
          <p id={dueErrorId} className="field-error">
            {errors.dueDate}
          </p>
        )}
      </div>
      <button type="submit" className="button-primary">
        Add todo
      </button>
    </form>
  );
}
