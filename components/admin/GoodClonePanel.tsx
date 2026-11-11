'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { cloneAdminGoodAction, type GoodCloneActionState } from '@/app/admin/good-clone-actions';
import { goodCloneMatrixRows } from '@/lib/admin/good-clone';
import { readGoodsAttributesAction } from '@/app/admin/goods-attribute-actions';
import { goodsAttributeEntryMatches, validGoodsAttributeValue } from '@/lib/goods-attributes';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { GOOD_INPUT_CLASS, GOOD_NOTE_CLASS, GOOD_SUBPANEL_CLASS } from './GoodEditorParts';

/* 템플릿 룩(ADR-0028). 라벨이 입력을 감싸므로 라벨 글자만 굵게 한다. */
const FIELD_CLASS = 'flex min-w-0 flex-col gap-2 text-sm';

const EMPTY: GoodCloneActionState = {};

export function GoodClonePanel({
  goodId,
  goodName,
  goodCode,
  operationId,
  categoryId = null,
}: {
  goodId: string;
  goodName?: string | null;
  goodCode?: string | null;
  operationId: string;
  /** 원본 상품의 대표 카테고리. 복사가 필수 속성 때문에 막히면 어떤 속성이 비었는지 찾는 데 쓴다. */
  categoryId?: string | null;
}) {
  const [state, action, pending] = useActionState(cloneAdminGoodAction, EMPTY);
  const [initialOperationId] = useState(operationId);
  const values = state.values ?? {};
  const value = (name: string) => values[name] ?? '';
  const completed = Boolean(state.savedGood);
  /* 서버는 "필수값을 확인"이라고만 답한다. 원본의 속성을 다시 읽어 어떤 속성이 비었는지 이름을 보인다. */
  const attributeBlocked = Boolean(state.errors?.form?.includes('속성'));
  const [missingAttributes, setMissingAttributes] = useState<string[]>([]);
  useEffect(() => {
    if (!attributeBlocked || !categoryId) return;
    let alive = true;
    readGoodsAttributesAction(categoryId, goodId).then((result) => {
      if (!alive || !result.data?.schema) return;
      const entries = result.data.document.entries;
      setMissingAttributes(result.data.schema.fields.filter((field) => {
        const entry = entries.find((item) => item.field.id === field.id);
        return field.required && !(entry && goodsAttributeEntryMatches(entry, field) && validGoodsAttributeValue(field, entry.value));
      }).map((field) => field.name));
    }).catch(() => {});
    return () => { alive = false; };
  }, [attributeBlocked, categoryId, goodId, state.attempt]);

  return (
    <section aria-labelledby={`good-clone-${goodId}`} className={`${GOOD_SUBPANEL_CLASS} text-sm`} data-good-clone="">
      <div className="flex flex-col gap-1">
        <h2 id={`good-clone-${goodId}`} className="text-base leading-snug font-medium">상품 복사</h2>
        <p className="text-sm text-muted-foreground">
          {goodName || goodId} · {goodCode || '자체 상품코드 확인 중'}을 새 초안으로 복사합니다. 원본 주문·재고·외부 식별자는 연결하지 않습니다.
        </p>
      </div>
      <form
        action={action}
        className="flex min-w-0 flex-col gap-4"
        key={`${goodId}:${state.attempt ?? 0}:${completed ? state.savedGood?.id ?? 'done' : 'ready'}`}
      >
        <input name="operationId" type="hidden" value={state.operationId ?? initialOperationId} />
        <input name="sourceGoodId" type="hidden" value={goodId} />
        <div className="grid min-w-0 gap-4 md:grid-cols-3">
          <label className={FIELD_CLASS}><span className="font-medium">새 상품 URL (선택)</span><input className={GOOD_INPUT_CLASS} data-slot="input" defaultValue={value('newId')} disabled={pending || completed} name="newId" placeholder="비우면 자동 생성" /></label>
          <label className={FIELD_CLASS}><span className="font-medium">새 상품코드 (선택)</span><input className={GOOD_INPUT_CLASS} data-slot="input" defaultValue={value('newCode')} disabled={pending || completed} name="newCode" placeholder="비우면 자동 생성" /></label>
          <label className={FIELD_CLASS}><span className="font-medium">새 상품 이름 (선택)</span><input className={GOOD_INPUT_CLASS} data-slot="input" defaultValue={value('newName')} disabled={pending || completed} name="newName" placeholder="비우면 원본 이름에 복사본을 붙입니다" /></label>
        </div>
        <div className={`${GOOD_NOTE_CLASS} flex flex-col gap-1.5`}>
          <strong className="font-medium">복사되는 항목</strong>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">{goodCloneMatrixRows().map((row) => <li key={row.label}><strong className="font-medium text-foreground">{row.label}:</strong> {row.value}</li>)}</ul>
        </div>
        {state.errors?.sourceGoodId ? <p className="text-destructive" role="alert">{state.errors.sourceGoodId}</p> : null}
        {state.errors?.newId ? <p className="text-destructive" role="alert">{state.errors.newId}</p> : null}
        {state.errors?.newCode ? <p className="text-destructive" role="alert">{state.errors.newCode}</p> : null}
        {state.errors?.newName ? <p className="text-destructive" role="alert">{state.errors.newName}</p> : null}
        {state.errors?.form ? <p className="text-destructive" role="alert">{state.errors.form}</p> : null}
        {attributeBlocked && missingAttributes.length ? <p className="text-destructive" data-good-clone-missing="" role="alert">비어 있는 필수 상품속성: {missingAttributes.join(', ')}. 기본 정보 카드의 상품속성에서 입력하고 저장한 뒤 다시 복사해주세요.</p> : null}
        {/* 같은 화면 이동이라 스크롤이 맨 아래에 남으면 다른 상품을 연 줄 모른다. 맨 위에서 새 초안을 시작한다. */}
        {state.message ? <p className="font-medium text-[var(--wc-success)]" role="status">{state.message} <Link className="text-foreground underline underline-offset-4" href={`/admin/catalog/goods?goodId=${encodeURIComponent(state.savedGood?.id ?? '')}`} onClick={() => window.scrollTo({ top: 0, behavior: 'instant' })}>새 초안 열기</Link></p> : null}
        <button className={`${buttonVariants({ variant: 'outline' })} self-start`} data-slot="button" disabled={pending || completed} type="submit">{pending ? '복사 중' : completed ? '복사 완료' : '새 초안으로 복사'}</button>
      </form>
    </section>
  );
}
