import type { ReactNode } from 'react';

export type ConsoleBulkActionVariant = 'primary' | 'ghost' | 'danger';

export interface ConsoleBulkAction {
  label: string;
  /** 제출 버튼의 `name`. server action이 어떤 액션인지 구분하는 키다. */
  name: string;
  /** 제출 버튼의 `value`. 기본은 `name`과 같다. */
  value?: string;
  variant?: ConsoleBulkActionVariant;
  /**
   * 확인 문구. 이 컴포넌트는 대화상자를 직접 띄우지 않고 `data-confirm` 속성으로만 노출한다.
   * 감싼 form이 `onSubmit`에서 읽어 `window.confirm`을 띄우는 것이 이 저장소 관용구다
   * (`components/admin/sections/Orders.tsx`의 `confirmAction`).
   */
  confirmLabel?: string;
  disabled?: boolean;
  /** 액션마다 다른 server action으로 보낼 때. 그대로 버튼에 통과시킨다. */
  formAction?: string | ((formData: FormData) => void | Promise<void>);
}

export interface ConsoleBulkActionBarProps {
  /** 선택된 행 수. 0 이하면 바 자체를 렌더하지 않는다. */
  selectedCount: number;
  actions: ConsoleBulkAction[];
  /** 건수 앞 문구. 기본 `'선택한 항목'`. */
  label?: string;
  /** 버튼 뒤에 붙일 추가 컨트롤(예: 사유 select). */
  children?: ReactNode;
  className?: string;
}

const VARIANT_CLASSES: Record<ConsoleBulkActionVariant, string> = {
  primary: 'btn btn-sm admin-console-bulk-action',
  ghost: 'btn btn-sm btn-ghost admin-console-bulk-action',
  danger: 'btn btn-sm admin-console-bulk-action admin-console-bulk-action--danger',
};

/**
 * 선택된 행이 있을 때만 뜨는 일괄 액션 바.
 *
 * 실제 제출은 호출자의 `<form>`과 server action이 맡는다. 이 컴포넌트는 `type="submit"`
 * 버튼만 그리고 `name`/`value`/`formAction`을 그대로 통과시킨다. 그래서 서버 컴포넌트로
 * 남을 수 있다 — 선택 건수만 바깥에서 받아온다.
 */
export function ConsoleBulkActionBar({
  actions,
  children,
  className,
  label = '선택한 항목',
  selectedCount,
}: ConsoleBulkActionBarProps) {
  /* 0건에서도 바가 떠 있으면 아무 행도 없는데 "일괄 처리"를 누를 수 있는 것처럼 보인다. */
  if (selectedCount <= 0) return null;

  return (
    <div
      aria-label={`${label} 일괄 처리`}
      className={`${className ? `${className} ` : ''}admin-console-bulk-bar`}
      role="group"
    >
      <p aria-live="polite" className="admin-console-bulk-count">
        {label} <strong>{selectedCount.toLocaleString('ko-KR')}</strong>건
      </p>
      <div className="admin-console-bulk-actions">
        {actions.map((action) => (
          <button
            className={VARIANT_CLASSES[action.variant ?? 'primary']}
            data-confirm={action.confirmLabel}
            disabled={action.disabled}
            formAction={action.formAction}
            key={`${action.name}:${action.value ?? action.name}`}
            name={action.name}
            type="submit"
            value={action.value ?? action.name}
          >
            {action.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}
