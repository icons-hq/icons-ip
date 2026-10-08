'use client';

import { useEffect, useRef, useState } from 'react';
import { categoryPath, type AdminCategoryNode } from '@/lib/admin/category';

/**
 * 상위가 대표 카테고리를 바꾸면(예: ERP 카테고리로 바꾸기) select에 bubbling change 이벤트를 보낸다.
 * 상품 폼의 미리보기·브라우저 복구 기록은 input/change 이벤트로 폼을 다시 읽기 때문이다.
 * 사용자가 select에서 직접 고른 값은 이미 change가 났으므로 다시 보내지 않는다.
 */
export function createPrimaryChangeAnnouncer(initial: string) {
  let announced = initial;
  return {
    /** select에서 직접 고른 값 */
    chosen(value: string) { announced = value; },
    /** 화면에 반영된 값. 알리지 않은 변경이면 change를 보내고 true */
    committed(value: string, target: EventTarget | null | undefined): boolean {
      if (value === announced) return false;
      announced = value;
      target?.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
  };
}

/**
 * 대표·추가 고객 카테고리 선택. 기본은 내부 상태를 갖는 비제어 입력이다.
 * `primary`·`onPrimaryChange`를 함께 주면 대표 카테고리를 상위에서 제어한다
 * (예: 옵션의 ERP 품목 선택이 대표 카테고리를 채울 때). DOM 값만 바꾸면 React 상태와 어긋난다.
 */
export function CategoryAssignmentField({
  categories,
  value = '',
  error,
  additionalValue,
  additionalError,
  primary: controlledPrimary,
  onPrimaryChange,
}: {
  categories: AdminCategoryNode[];
  /** 비제어 모드의 초기 대표 카테고리 */
  value?: string;
  error?: string;
  additionalValue?: string;
  additionalError?: string;
  /** 제어 모드의 현재 대표 카테고리 */
  primary?: string;
  onPrimaryChange?: (id: string) => void;
}) {
  const [uncontrolledPrimary, setUncontrolledPrimary] = useState(value);
  const controlled = controlledPrimary !== undefined && onPrimaryChange !== undefined;
  const primary = controlled ? controlledPrimary : uncontrolledPrimary;
  const setPrimary = controlled ? onPrimaryChange : setUncontrolledPrimary;
  const selectRef = useRef<HTMLSelectElement>(null);
  const [announcer] = useState(() => createPrimaryChangeAnnouncer(primary));
  /* 커밋된 뒤 보내야 폼 관찰자가 새 값을 읽는다. */
  useEffect(() => { announcer.committed(primary, selectRef.current); }, [announcer, primary]);
  const [additional, setAdditional] = useState<string[]>(() => {
    try {
      const values: unknown = JSON.parse(additionalValue ?? '[]');
      return Array.isArray(values) ? values.filter((id): id is string => typeof id === 'string' && id !== value) : [];
    } catch { return []; }
  });
  const activeLeaves = categories.filter((category) => !category.archivedAt && category.childCount === 0);
  const selectedArchived = primary
    ? categories.find((category) => category.id === primary && category.archivedAt && category.childCount === 0)
    : undefined;
  const leaves = selectedArchived ? [selectedArchived, ...activeLeaves] : activeLeaves;
  return (
    <div className="col" style={{ gap: 7 }}>
      <label className="mono" htmlFor="category-assignment" style={{ color: 'var(--dim)', fontSize: 11 }}>대표 카테고리</label>
      <select aria-describedby="category-assignment-hint" aria-invalid={error ? 'true' : undefined} className="admin-field-control" value={primary} id="category-assignment" name="categoryId" ref={selectRef} onChange={(event) => {
        announcer.chosen(event.target.value);
        setPrimary(event.target.value);
        setAdditional(current => current.filter(id => id !== event.target.value));
      }}>
        <option value="">미분류</option>
        {leaves.map((category) => <option aria-disabled={category.archivedAt ? 'true' : undefined} key={category.id} value={category.id}>{category.archivedAt ? '보관됨 · ' : ''}{categoryPath(categories, category.id).join(' > ')} ({category.code})</option>)}
      </select>
      <span className="muted" id="category-assignment-hint" style={{ fontSize: 12 }}>
        대표 말단 하나를 고릅니다. ERP 분류는 대표 카테고리를 사용합니다. 보관된 현재 값은 명시적으로 미분류를 선택해야 해제됩니다. 비워도 기존 유형과 전체 상품 판매는 유지됩니다.
      </span>
      {error ? <span role="alert" style={{ color: 'var(--pink)', fontSize: 12 }}>{error}</span> : null}
      {additionalValue !== undefined && <>
        {/* 상위에서 대표를 바꿔도 같은 분류가 추가 분류에 중복 저장되지 않는다. */}
        <input name="additionalCategoryIds" type="hidden" value={JSON.stringify(additional.filter(id => id !== primary))} />
        <label className="mono" htmlFor="additional-category-assignment">추가 카테고리 (선택)</label>
        <select className="admin-field-control" id="additional-category-assignment" aria-describedby="additional-category-hint" aria-invalid={additionalError ? 'true' : undefined} value="" onChange={(event) => {
          const id = event.target.value;
          if (id) setAdditional(current => [...new Set([...current, id])]);
        }}>
          <option value="">추가할 말단 선택</option>
          {activeLeaves.filter(category => category.id !== primary && !additional.includes(category.id)).map(category =>
            <option key={category.id} value={category.id}>{categoryPath(categories, category.id).join(' > ')} ({category.code})</option>)}
        </select>
        {additional.filter(id => id !== primary).map(id => {
          const category = categories.find(category => category.id === id);
          return <div className="row" key={id} style={{ flexWrap: 'wrap', gap: 8 }}>
            <span>{category?.archivedAt ? '보관됨 · ' : ''}{category ? categoryPath(categories, id).join(' > ') : id}</span>
            <button type="button" className="wc-admin-kit__button" aria-label={`${category?.name ?? id} 추가 분류 해제`} onClick={() => setAdditional(current => current.filter(value => value !== id))}>해제</button>
          </div>;
        })}
        <span className="muted" id="additional-category-hint">관리자 목록에서 대표·추가 분류와 하위 분류로 찾을 수 있습니다. 기본 상품 저장으로 반영합니다.</span>
        {additionalError && <span role="alert">{additionalError}</span>}
      </>}
    </div>
  );
}
