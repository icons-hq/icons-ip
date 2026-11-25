/* eslint-disable @next/next/no-img-element -- 연결한 상품의 썸네일은 이미 호스팅된 공개 이미지를 고정 크기로 보인다. */
'use client';

import { useState } from 'react';
import { checkGoodsAdditionalCandidateAction } from '@/app/admin/goods-additional-actions';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { MAX_ADDITIONAL_GOODS, type AdminAdditionalGood } from '@/lib/admin/goods-additional';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { AdminGoodsPicker, type AdminGoodsPickerRow } from './AdminGoodsPicker';

/*
 * 추가 구성 상품 연결 목록(저장 전 등록 화면과 저장된 상품의 독립 패널이 같이 쓴다).
 * 상품은 공용 상품 선택창(화면 규칙 1)에서 찾아 연결 목록 맨 뒤에 붙이고, 목록은 사진·상품명·상품 자동코드로 보인다(내부 번호는 보이지 않는다 — 규칙 8).
 * 선택창의 상품 조회는 보관하지 않은 모든 상품을 보여 주므로, 줄에서 바로 알 수 있는 것(공개 전 상품·지금 편집 중인 상품·50개 가득)은 줄에 이유를 보이고,
 * 나머지(품절·재고 없음·판매 제한 등)는 고른 순간 저장 함수와 같은 조건으로 확인해 선택창 안에 이유를 보이고 연결하지 않는다.
 */

/** 두 화면(저장 전 등록·저장된 상품)이 같은 한 줄 안내를 쓴다. 품절·판매 중지 상품은 연결해 둬도 고객에게 보이지 않는다(저장 함수의 판매 가능 조건과 같다). */
export const GOODS_ADDITIONAL_INTRO = '연결한 상품은 각자의 옵션·가격 그대로 팔립니다. 품절·판매 중지 상품은 고객에게 보이지 않습니다.';

/** 이 창에서 연결하지 못한 이유(상품 이름 뒤에 붙인다). 조건은 저장 함수(admin_save_goods_additional)가 쓰는 '지금 고객이 살 수 있음'과 같다. */
export const ADDITIONAL_NOT_SELLABLE_REASON = '지금 고객이 살 수 없는 상품이라 연결할 수 없습니다. 공개 상태·재고·판매상태·판매 제한을 확인해주세요.';

export function GoodsAdditionalLinks({ baseGoodId, items, onChange, disabled = false }: {
  /** 저장된 상품의 상품 URL. 저장 전인 새 상품은 null. 이 상품은 자기 자신을 연결할 수 없다. */
  baseGoodId: string | null;
  items: readonly AdminAdditionalGood[];
  /** 연결 목록을 바꾼다. 선택창은 확인 응답을 기다린 뒤 바꾸므로, 부른 때의 목록이 아니라 그때의 목록을 받아 고친다. */
  onChange: (update: (current: AdminAdditionalGood[]) => AdminAdditionalGood[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState('');
  const linked = new Set(items.map((item) => item.goodId));
  const full = items.length >= MAX_ADDITIONAL_GOODS;
  async function pick(good: AdminGoodsPickerRow) {
    setProblem('');
    const result = await checkGoodsAdditionalCandidateAction(baseGoodId, good.id);
    if (!result.ok) { setProblem(result.error); return false; }
    if (result.verdict === 'unavailable') { setProblem(`${good.name}: ${ADDITIONAL_NOT_SELLABLE_REASON}`); return false; }
    onChange((current) => current.length >= MAX_ADDITIONAL_GOODS || current.some((item) => item.goodId === good.id) ? current
      : [...current, { goodId: good.id, name: good.name, available: true, code: good.code, imageUrl: good.imageUrl }]);
  }
  const move = (index: number, direction: -1 | 1) => onChange((current) => {
    const destination = index + direction;
    if (destination < 0 || destination >= current.length) return current;
    const next = [...current]; [next[index], next[destination]] = [next[destination], next[index]]; return next;
  });
  return <div className="flex min-w-0 flex-col gap-3" data-good-additional-links="">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <strong className="font-medium tabular-nums">연결 순서 · {items.length}/{MAX_ADDITIONAL_GOODS}</strong>
      <button className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={disabled} onClick={() => setOpen(true)} type="button">{adminGoodsCopy('추가 구성 상품 찾기')}</button>
    </div>
    {items.length === 0 ? <p className="text-muted-foreground">연결한 상품이 없습니다.</p> : <ol className="m-0 flex list-decimal flex-col gap-3 pl-6">
      {items.map((item, index) => <li key={item.goodId}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            {item.imageUrl ? <img alt="" className="size-10 shrink-0 rounded-md bg-muted object-cover" height={40} src={item.imageUrl} width={40} /> : <span aria-hidden="true" className="size-10 shrink-0 rounded-md bg-muted" />}
            <div className="min-w-0 wrap-anywhere"><span>{item.name}</span>
              {item.code || !item.available ? <small className={`block text-xs ${item.available ? 'text-muted-foreground' : 'text-[var(--wc-warning)]'}`}>{[item.code, item.available ? null : '지금은 고객이 살 수 없음'].filter(Boolean).join(' · ')}</small> : null}</div>
          </div>
          <div className="flex gap-1">
            <button aria-label={`${item.name} 위로 이동`} className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" disabled={disabled || index === 0} onClick={() => move(index, -1)} type="button">위로</button>
            <button aria-label={`${item.name} 아래로 이동`} className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" disabled={disabled || index === items.length - 1} onClick={() => move(index, 1)} type="button">아래로</button>
            <button aria-label={`${item.name} 연결에서 빼기`} className={buttonVariants({ variant: 'ghost', size: 'sm' })} data-slot="button" disabled={disabled} onClick={() => onChange((current) => current.filter((entry) => entry.goodId !== item.goodId))} type="button">빼기</button>
          </div>
        </div>
      </li>)}
    </ol>}
    {open ? <AdminGoodsPicker
      blockedReason={disabled ? '저장하는 중이라 지금은 고를 수 없습니다. 끝난 뒤 다시 열어주세요.' : null}
      description="고른 상품은 연결 목록 맨 뒤에 붙습니다. 지금 고객이 살 수 있는 상품만 연결할 수 있습니다."
      footer={problem ? <p className="text-sm text-destructive wrap-anywhere" role="alert">{problem}</p> : null}
      multiple
      onClose={() => { setOpen(false); setProblem(''); }}
      onDeselect={(good) => onChange((current) => current.filter((entry) => entry.goodId !== good.id))}
      onSelect={pick}
      rowBlocked={(good) => linked.has(good.id) ? null : good.id === baseGoodId ? '지금 편집 중인 상품' : full ? `최대 ${MAX_ADDITIONAL_GOODS}개까지` : good.published ? null : '공개 전 상품은 연결할 수 없음'}
      selectedKeys={[...linked]}
      title={adminGoodsCopy('추가 구성 상품 선택')}
    /> : null}
  </div>;
}
