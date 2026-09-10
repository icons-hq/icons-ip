'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { cloneAdminGoodAction, type GoodCloneActionState } from '@/app/admin/good-clone-actions';
import { goodCloneMatrixRows } from '@/lib/admin/good-clone';

const EMPTY: GoodCloneActionState = {};

export function GoodClonePanel({
  goodId,
  goodName,
  goodCode,
  operationId,
}: {
  goodId: string;
  goodName?: string | null;
  goodCode?: string | null;
  operationId: string;
}) {
  const [state, action, pending] = useActionState(cloneAdminGoodAction, EMPTY);
  const [initialOperationId] = useState(operationId);
  const values = state.values ?? {};
  const value = (name: string) => values[name] ?? '';
  const completed = Boolean(state.savedGood);

  return (
    <section aria-labelledby={`good-clone-${goodId}`} className="card col" style={{ gap: 14, padding: 18 }}>
      <div>
        <h2 id={`good-clone-${goodId}`} style={{ fontSize: 18, margin: 0 }}>상품 복사</h2>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '8px 0 0' }}>
          {goodName || goodId} · {goodCode || '자체 상품코드 확인 중'}을 새 초안으로 복사합니다. 원본 주문·재고·외부 식별자는 연결하지 않습니다.
        </p>
      </div>
      <form
        action={action}
        className="col"
        key={`${goodId}:${state.attempt ?? 0}:${completed ? state.savedGood?.id ?? 'done' : 'ready'}`}
        style={{ gap: 10 }}
      >
        <input name="operationId" type="hidden" value={state.operationId ?? initialOperationId} />
        <input name="sourceGoodId" type="hidden" value={goodId} />
        <label className="col" style={{ gap: 5 }}>새 상품 URL (선택)<input className="admin-field-control" defaultValue={value('newId')} disabled={pending || completed} name="newId" placeholder="비우면 자동 생성" /></label>
        <label className="col" style={{ gap: 5 }}>새 상품코드 (선택)<input className="admin-field-control" defaultValue={value('newCode')} disabled={pending || completed} name="newCode" placeholder="비우면 자동 생성" /></label>
        <label className="col" style={{ gap: 5 }}>새 상품 이름 (선택)<input className="admin-field-control" defaultValue={value('newName')} disabled={pending || completed} name="newName" placeholder="비우면 원본 이름에 복사본을 붙입니다" /></label>
        <div className="col" style={{ gap: 4 }}>
          <strong>복사 행렬</strong>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{goodCloneMatrixRows().map((row) => <li key={row.label}><strong>{row.label}:</strong> {row.value}</li>)}</ul>
        </div>
        {state.errors?.sourceGoodId ? <p role="alert" style={{ color: 'var(--pink)', margin: 0 }}>{state.errors.sourceGoodId}</p> : null}
        {state.errors?.newId ? <p role="alert" style={{ color: 'var(--pink)', margin: 0 }}>{state.errors.newId}</p> : null}
        {state.errors?.newCode ? <p role="alert" style={{ color: 'var(--pink)', margin: 0 }}>{state.errors.newCode}</p> : null}
        {state.errors?.newName ? <p role="alert" style={{ color: 'var(--pink)', margin: 0 }}>{state.errors.newName}</p> : null}
        {state.errors?.form ? <p role="alert" style={{ color: 'var(--pink)', margin: 0 }}>{state.errors.form}</p> : null}
        {state.message ? <p role="status" style={{ color: 'var(--mint)', margin: 0 }}>{state.message} <Link href={`/admin/catalog/goods?goodId=${encodeURIComponent(state.savedGood?.id ?? '')}`}>새 초안 열기</Link></p> : null}
        <button className="wc-admin-kit__button" disabled={pending || completed} type="submit">{pending ? '복사 중' : completed ? '복사 완료' : '새 초안으로 복사'}</button>
      </form>
    </section>
  );
}
