import { useId } from 'react';
import { AdminField, AdminSidePanel } from './console/AdminKit';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import { Icon } from '@/components/ui/Icon';
import { adminArtworkAspectRatio, type AdminArtworkKind } from '@/lib/admin/artwork';

export function ErrorText({ children, id }: { children?: string; id?: string }) {
  if (!children) return null;
  return <span id={id} role="alert" style={{ color: 'var(--wc-danger)', fontSize: 12, fontWeight: 700 }}>{children}</span>;
}

export function Field({
  defaultValue,
  error,
  label,
  max,
  maxLength,
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
  maxLength?: number;
  min?: number;
  name: string;
  placeholder?: string;
  readOnly?: boolean;
  required?: boolean;
  step?: number;
  type?: string;
}) {
  const inputId = useId();
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <AdminField inputId={inputId} label={label} error={error}>
      <input
        id={inputId}
        aria-describedby={errorId}
        aria-invalid={Boolean(error)}
        className="admin-field-control"
        defaultValue={defaultValue ?? ''}
        max={max}
        maxLength={maxLength}
        min={min}
        name={name}
        placeholder={placeholder}
        readOnly={readOnly}
        required={required}
        step={step}
        type={type}
      />
    </AdminField>
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
  const inputId = useId();
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <AdminField inputId={inputId} label={label} error={error}>
      <textarea
        id={inputId}
        aria-describedby={errorId}
        aria-invalid={Boolean(error)}
        className="admin-field-control"
        defaultValue={defaultValue ?? ''}
        maxLength={maxLength}
        name={name}
        placeholder={placeholder}
        required={required}
        rows={3}
      />
    </AdminField>
  );
}

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/*
 * 색상은 hex 문자열이 아니라 색으로 고른다 (#183).
 * 저장 형식은 그대로 #RRGGBB 라서 기존 데이터와 소비 지점이 바뀌지 않는다.
 */
export function ColorField({
  defaultValue,
  error,
  fallback,
  label,
  name,
}: {
  defaultValue?: string | null;
  error?: string;
  fallback: string;
  label: string;
  name: string;
}) {
  const inputId = useId();
  const errorId = error ? `${inputId}-error` : undefined;
  const value = defaultValue && COLOR_PATTERN.test(defaultValue) ? defaultValue : fallback;

  return (
    <AdminField inputId={inputId} label={label} error={error}>
      <input
        id={inputId}
        aria-describedby={errorId}
        aria-invalid={Boolean(error)}
        className="admin-field-control"
        defaultValue={value}
        name={name}
        type="color"
      />
    </AdminField>
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
  const inputId = useId();
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <AdminField inputId={inputId} label={label} error={error}>
      <select
        id={inputId}
        aria-describedby={errorId}
        aria-invalid={Boolean(error)}
        className="admin-field-control"
        defaultValue={value === undefined ? (defaultValue ?? '') : undefined}
        disabled={disabled}
        name={name}
        onChange={onChange}
        required={required}
        value={value}
      >
        {children}
      </select>
    </AdminField>
  );
}

export function ActionNotice({ state }: { state: AdminCatalogActionState }) {
  if (state.errors?.form) {
    return (
      <div className="card" role="alert" style={{ color: 'var(--wc-danger)', padding: 12, borderRadius: 10, fontWeight: 700 }}>
        {state.errors.form}
      </div>
    );
  }
  if (state.message) {
    return (
      <div className="card" role="status" style={{ color: 'var(--wc-success)', padding: 12, borderRadius: 10, fontWeight: 700 }}>
        {state.message}
      </div>
    );
  }
  return null;
}

export function InlineNotice({ state }: { state: AdminCatalogActionState }) {
  if (state.errors?.form) {
    return <span role="alert" style={{ color: 'var(--wc-danger)', fontSize: 12, fontWeight: 700 }}>{state.errors.form}</span>;
  }
  if (state.message) {
    return <span role="status" style={{ color: 'var(--wc-success)', fontSize: 12, fontWeight: 700 }}>{state.message}</span>;
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
      <button className="wc-admin-kit wc-admin-kit__button" disabled={disabled || pending} style={{ justifySelf: 'start', minWidth: 150 }}>
        <Icon name="check" size={15} /> {pending ? '저장 중' : '저장'}
      </button>
    </>
  );
}

/*
 * 목록 썸네일 (#182). 라벨이 이미 ID·이름을 읽어주므로 이미지는 장식이다 —
 * alt 를 비우고 스크린리더에서 제외한다. 아트워크가 없는 레코드는 이미지를
 * 렌더하지 않고 기존처럼 텍스트만 보여준다.
 */
function RecordThumbnail({ kind, url }: { kind: AdminArtworkKind; url: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        aspectRatio: adminArtworkAspectRatio(kind),
        background: 'var(--wc-surface-grey)',
        borderRadius: 6,
        flex: '0 0 auto',
        overflow: 'hidden',
        width: 52,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        decoding="async"
        loading="lazy"
        src={url}
        style={{ display: 'block', height: '100%', objectFit: 'cover', width: '100%' }}
      />
    </span>
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
  thumbnailKind,
  thumbnailUrlFor,
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
  thumbnailKind?: AdminArtworkKind;
  thumbnailUrlFor?: (item: T) => string | null | undefined;
}) {
  return (
    <AdminSidePanel title={ariaLabel}>
      <button className="wc-admin-kit wc-admin-kit__button" onClick={onNew} style={{ width: '100%' }} type="button">
        <Icon name="plus" size={15} /> {newLabel}
      </button>
      <div className="col" style={{ gap: 8, marginTop: 14, maxHeight: 520, overflow: 'auto' }}>
        {!items.length && emptyMessage && (
          <p style={{ color: 'var(--wc-ink-tertiary)', fontSize: 13, margin: 0 }}>{emptyMessage}</p>
        )}
        {items.map((item) => {
          const thumbnailUrl = thumbnailKind && thumbnailUrlFor ? thumbnailUrlFor(item) : null;
          const label = labelFor(item);

          return (
            <button
              key={item.id}
              aria-current={activeId === item.id ? 'true' : undefined}
              className={[
                activeId === item.id ? 'chip on' : 'chip',
                itemClassName,
              ].filter(Boolean).join(' ')}
              onClick={() => onSelect(item)}
              style={{ gap: 10, justifyContent: 'flex-start', minHeight: 38, overflow: 'hidden', textAlign: 'left' }}
              type="button"
            >
              {thumbnailKind && thumbnailUrl && (
                <RecordThumbnail kind={thumbnailKind} url={thumbnailUrl} />
              )}
              {typeof label === 'string'
                ? <span className="admin-record-label" title={label}>{label}</span>
                : label}
            </button>
          );
        })}
      </div>
    </AdminSidePanel>
  );
}
