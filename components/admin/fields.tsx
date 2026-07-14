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
  name,
  placeholder,
  required,
  step,
  type = 'text',
}: {
  defaultValue?: string | number | null;
  error?: string;
  label: string;
  name: string;
  placeholder?: string;
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
        name={name}
        placeholder={placeholder}
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
  error,
  label,
  name,
}: {
  children: React.ReactNode;
  defaultValue?: string | null;
  error?: string;
  label: string;
  name: string;
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
        defaultValue={defaultValue ?? ''}
        name={name}
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
  pending,
  state,
}: {
  pending: boolean;
  state: AdminCatalogActionState;
}) {
  return (
    <>
      <ActionNotice state={state} />
      <button className="btn btn-holo" disabled={pending} style={{ justifySelf: 'start', minWidth: 150 }}>
        <Icon name="check" size={15} /> {pending ? '저장 중' : '저장'}
      </button>
    </>
  );
}

export function RecordList<T extends { id: string }>({
  activeId,
  items,
  labelFor,
  onNew,
  onSelect,
}: {
  activeId: string | null;
  items: T[];
  labelFor: (item: T) => string;
  onNew: () => void;
  onSelect: (item: T) => void;
}) {
  return (
    <aside className="card" style={{ alignSelf: 'start', borderRadius: 10, padding: 14 }}>
      <button className="btn btn-holo" onClick={onNew} style={{ width: '100%' }} type="button">
        <Icon name="plus" size={15} /> 새로 등록
      </button>
      <div className="col" style={{ gap: 8, marginTop: 14, maxHeight: 520, overflow: 'auto' }}>
        {items.map((item) => (
          <button
            key={item.id}
            className={activeId === item.id ? 'chip on' : 'chip'}
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
