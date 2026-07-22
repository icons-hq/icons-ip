import type { AdminCatalogActionState } from '@/app/admin/actions';
import { Icon } from '@/components/ui/Icon';

export function ErrorText({ children, id }: { children?: string; id?: string }) {
  if (!children) return null;
  return <span id={id} role="alert" style={{ color: 'var(--pink)', fontSize: 12, fontWeight: 700 }}>{children}</span>;
}

export function Field({
  defaultValue,
  error,
  label,
  max,
  min,
  name,
  placeholder,
  readOnly,
  required,
  step,
  type = 'text',
}: {
  defaultValue?: string | number | null;
  error?: string;
  label: string;
  max?: number;
  min?: number;
  name: string;
  placeholder?: string;
  readOnly?: boolean;
  required?: boolean;
  step?: number;
  type?: string;
}) {
  const errorId = error ? `${name}-error` : undefined;

  return (
    <label className="col" style={{ gap: 7 }}>
      <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>
        {label}
      </span>
      <input
        aria-describedby={errorId}
        aria-invalid={Boolean(error)}
        className="admin-field-control"
        defaultValue={defaultValue ?? ''}
        max={max}
        min={min}
        name={name}
        placeholder={placeholder}
        readOnly={readOnly}
        required={required}
        step={step}
        type={type}
        style={{
          background: 'rgba(255,255,255,.045)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          color: 'var(--text)',
          fontFamily: 'inherit',
          fontSize: 14,
          minHeight: 42,
          outline: 'none',
          padding: '0 12px',
          width: '100%',
        }}
      />
      <ErrorText id={errorId}>{error}</ErrorText>
    </label>
  );
}

export function TextArea({
  defaultValue,
  error,
  label,
  name,
  placeholder,
  maxLength,
  required,
}: {
  defaultValue?: string | null;
  error?: string;
  label: string;
  name: string;
  placeholder?: string;
  maxLength?: number;
  required?: boolean;
}) {
  const errorId = error ? `${name}-error` : undefined;

  return (
    <label className="col" style={{ gap: 7 }}>
      <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>
        {label}
      </span>
      <textarea
        aria-describedby={errorId}
        aria-invalid={Boolean(error)}
        className="admin-field-control"
        defaultValue={defaultValue ?? ''}
        maxLength={maxLength}
        name={name}
        placeholder={placeholder}
        required={required}
        rows={3}
        style={{
          background: 'rgba(255,255,255,.045)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          color: 'var(--text)',
          fontFamily: 'inherit',
          fontSize: 14,
          minHeight: 88,
          outline: 'none',
          padding: '12px',
          resize: 'vertical',
          width: '100%',
        }}
      />
      <ErrorText id={errorId}>{error}</ErrorText>
    </label>
  );
}

export function SelectField({
  children,
  defaultValue,
  disabled,
  error,
  label,
  name,
  onChange,
  required,
  value,
}: {
  children: React.ReactNode;
  defaultValue?: string | null;
  disabled?: boolean;
  error?: string;
  label: string;
  name: string;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
  required?: boolean;
  value?: string;
}) {
  const errorId = error ? `${name}-error` : undefined;

  return (
    <label className="col" style={{ gap: 7 }}>
      <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>
        {label}
      </span>
      <select
        aria-describedby={errorId}
        aria-invalid={Boolean(error)}
        className="admin-field-control"
        defaultValue={value === undefined ? (defaultValue ?? '') : undefined}
        disabled={disabled}
        name={name}
        onChange={onChange}
        required={required}
        value={value}
        style={{
          background: 'rgba(255,255,255,.045)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          color: 'var(--text)',
          fontFamily: 'inherit',
          fontSize: 14,
          minHeight: 42,
          outline: 'none',
          padding: '0 12px',
          width: '100%',
        }}
      >
        {children}
      </select>
      <ErrorText id={errorId}>{error}</ErrorText>
    </label>
  );
}

export function ActionNotice({ state }: { state: AdminCatalogActionState }) {
  if (state.errors?.form) {
    return (
      <div className="card" role="alert" style={{ color: 'var(--pink)', padding: 12, borderRadius: 10, fontWeight: 700 }}>
        {state.errors.form}
      </div>
    );
  }
  if (state.message) {
    return (
      <div className="card" role="status" style={{ color: 'var(--mint)', padding: 12, borderRadius: 10, fontWeight: 700 }}>
        {state.message}
      </div>
    );
  }
  return null;
}

export function InlineNotice({ state }: { state: AdminCatalogActionState }) {
  if (state.errors?.form) {
    return <span role="alert" style={{ color: 'var(--pink)', fontSize: 12, fontWeight: 700 }}>{state.errors.form}</span>;
  }
  if (state.message) {
    return <span role="status" style={{ color: 'var(--mint)', fontSize: 12, fontWeight: 700 }}>{state.message}</span>;
  }
  return null;
}

export function FormShell({
  disabled,
  pending,
  state,
}: {
  disabled?: boolean;
  pending: boolean;
  state: AdminCatalogActionState;
}) {
  return (
    <>
      <ActionNotice state={state} />
      <button className="btn btn-holo" disabled={disabled || pending} style={{ justifySelf: 'start', minWidth: 150 }}>
        <Icon name="check" size={15} /> {pending ? '저장 중' : '저장'}
      </button>
    </>
  );
}

export function RecordList<T extends { id: string }>({
  activeId,
  ariaLabel = '관리 항목 목록',
  emptyMessage,
  itemClassName,
  items,
  labelFor,
  newLabel = '새로 등록',
  onNew,
  onSelect,
}: {
  activeId: string | null;
  ariaLabel?: string;
  emptyMessage?: string;
  itemClassName?: string;
  items: T[];
  labelFor: (item: T) => React.ReactNode;
  newLabel?: string;
  onNew: () => void;
  onSelect: (item: T) => void;
}) {
  return (
    <aside aria-label={ariaLabel} className="card" style={{ alignSelf: 'start', borderRadius: 10, padding: 14 }}>
      <button className="btn btn-holo" onClick={onNew} style={{ width: '100%' }} type="button">
        <Icon name="plus" size={15} /> {newLabel}
      </button>
      <div className="col" style={{ gap: 8, marginTop: 14, maxHeight: 520, overflow: 'auto' }}>
        {!items.length && emptyMessage && (
          <p style={{ color: 'var(--dim)', fontSize: 13, margin: 0 }}>{emptyMessage}</p>
        )}
        {items.map((item) => (
          <button
            key={item.id}
            aria-current={activeId === item.id ? 'true' : undefined}
            className={[
              activeId === item.id ? 'chip on' : 'chip',
              itemClassName,
            ].filter(Boolean).join(' ')}
            onClick={() => onSelect(item)}
            style={{ justifyContent: 'flex-start', minHeight: 38, overflow: 'hidden', textAlign: 'left' }}
            type="button"
          >
            {labelFor(item)}
          </button>
        ))}
      </div>
    </aside>
  );
}
