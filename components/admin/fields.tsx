import { useId } from 'react';
import { AdminField, AdminSidePanel } from './console/AdminKit';
import { AdminSelect } from './console/AdminSelect';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import { Check, Plus } from 'lucide-react';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { adminArtworkAspectRatio, type AdminArtworkKind } from '@/lib/admin/artwork';

/* kit Input · Textarea와 같은 모양(ADR-0028). 폼 제출·기본값·검증 속성은 네이티브 그대로다. */
const CONTROL_CLASS = 'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-placeholder focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-secondary-foreground disabled:opacity-100 read-only:border-dashed read-only:bg-muted/50 read-only:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20';
const TEXTAREA_CLASS = 'flex min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-placeholder focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted disabled:text-secondary-foreground disabled:opacity-100 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20';

export function ErrorText({ children, id }: { children?: string; id?: string }) {
  if (!children) return null;
  return <span className="text-sm text-destructive" id={id} role="alert">{children}</span>;
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
        className={CONTROL_CLASS}
        data-slot="input"
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
        className={TEXTAREA_CLASS}
        data-slot="textarea"
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
        className="h-8 w-16 cursor-pointer rounded-lg border border-input bg-transparent p-1 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-0"
        data-slot="input"
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
      <AdminSelect
        id={inputId}
        aria-describedby={errorId}
        aria-invalid={Boolean(error)}
        defaultValue={value === undefined ? (defaultValue ?? '') : undefined}
        disabled={disabled}
        name={name}
        onChange={onChange}
        required={required}
        value={value}
      >
        {children}
      </AdminSelect>
    </AdminField>
  );
}

export function ActionNotice({ state }: { state: AdminCatalogActionState }) {
  if (state.errors?.form) {
    return (
      <div className="rounded-lg border border-danger-border bg-danger-soft px-3 py-2.5 text-sm font-medium text-destructive" role="alert">
        {state.errors.form}
      </div>
    );
  }
  if (state.message) {
    return (
      <div className="rounded-lg border border-success-border bg-success-soft px-3 py-2.5 text-sm font-medium text-success" role="status">
        {state.message}
      </div>
    );
  }
  return null;
}

export function InlineNotice({ state }: { state: AdminCatalogActionState }) {
  if (state.errors?.form) {
    return <span className="text-sm font-medium text-destructive" role="alert">{state.errors.form}</span>;
  }
  if (state.message) {
    return <span className="text-sm font-medium text-success" role="status">{state.message}</span>;
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
      <button className={`${buttonVariants()} justify-self-start self-start`} data-slot="button" disabled={disabled || pending}>
        <Check aria-hidden="true" /> {pending ? '저장 중' : '저장'}
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
      className="w-[52px] flex-none overflow-hidden rounded-md bg-muted"
      style={{ aspectRatio: adminArtworkAspectRatio(kind) }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        decoding="async"
        loading="lazy"
        src={url}
        className={`block size-full ${kind === 'event' ? 'object-contain' : 'object-cover'}`}
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
      <button className={`${buttonVariants({ variant: 'outline' })} w-full`} data-slot="button" onClick={onNew} type="button">
        <Plus aria-hidden="true" /> {newLabel}
      </button>
      <div className="flex max-h-[520px] flex-col gap-1 overflow-auto">
        {!items.length && emptyMessage && (
          <p className="m-0 text-sm text-muted-foreground">{emptyMessage}</p>
        )}
        {items.map((item) => {
          const thumbnailUrl = thumbnailKind && thumbnailUrlFor ? thumbnailUrlFor(item) : null;
          const label = labelFor(item);

          return (
            <button
              key={item.id}
              aria-current={activeId === item.id ? 'true' : undefined}
              className={[
                'flex min-h-9 w-full shrink-0 items-center justify-start gap-2.5 overflow-hidden rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=true]:bg-primary-soft aria-[current=true]:font-medium aria-[current=true]:text-primary-soft-foreground',
                itemClassName,
              ].filter(Boolean).join(' ')}
              data-slot="button"
              onClick={() => onSelect(item)}
              type="button"
            >
              {thumbnailKind && thumbnailUrl && (
                <RecordThumbnail kind={thumbnailKind} url={thumbnailUrl} />
              )}
              {typeof label === 'string'
                ? <span className="min-w-0 truncate" title={label}>{label}</span>
                : label}
            </button>
          );
        })}
      </div>
    </AdminSidePanel>
  );
}
