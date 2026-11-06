'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import {
  listGoodsPurchaseCostsAction, listGoodsPurchaseCostHistoryAction, saveGoodsPurchaseCostAction,
} from '@/app/admin/goods-purchase-cost-actions';
import {
  PURCHASE_TAX_BASIS_LABELS, purchaseCostLabel,
  type AdminGoodsPurchaseCost, type PurchaseCostChange,
} from '@/lib/admin/goods-purchase-costs';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import { Button } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { GOOD_NUMBER_INPUT_CLASS } from './GoodEditorParts';

/* 템플릿 룩(ADR-0028). 운영 섹션 안의 묶음 상자 하나에 옵션별 매입단가를 차례로 둔다. */
const FIELD_LABEL_CLASS = 'flex min-w-0 flex-col gap-1.5 text-sm font-medium text-foreground';

function CostEditor({ cost, variant, onSaved }: {
  cost: AdminGoodsPurchaseCost; variant: AdminGoodsVariant; onSaved: (message: string) => void;
}) {
  const [amount, setAmount] = useState(String(cost.unitCostKrw ?? ''));
  const [basis, setBasis] = useState(cost.taxBasis ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await saveGoodsPurchaseCostAction(data);
      if (result.ok) { setError(null); onSaved(result.message); } else setError(result.error);
    });
  }
  const basisId = `purchase-cost-${cost.variantId}-basis`;
  return <form className="flex min-w-0 flex-col gap-3" onSubmit={save}>
    <input type="hidden" name="goodId" value={cost.goodId} />
    <input type="hidden" name="variantId" value={cost.variantId} />
    <input type="hidden" name="expectedRevision" value={cost.revision ?? ''} />
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className={FIELD_LABEL_CLASS}>매입단가 (원)
        <input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" name="unitCostKrw" aria-label={`${variant.name} 매입단가`} type="number" min={0} max={2147483647} step={1}
          value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="미설정" disabled={pending} />
      </label>
      <div className={FIELD_LABEL_CLASS}>
        <label htmlFor={basisId}>세금 구분</label>
        <NativeSelect className="w-full" id={basisId} name="taxBasis" aria-label={`${variant.name} 매입단가 세금 구분`} value={basis}
          onChange={(event) => setBasis(event.target.value)} disabled={pending}>
          <option value="">미설정</option>
          {Object.entries(PURCHASE_TAX_BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </NativeSelect>
      </div>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={pending}>{pending ? '저장 중…' : '매입단가 저장'}</Button>
      <Button type="button" variant="outline" disabled={pending} onClick={() => { setAmount(''); setBasis(''); }}>입력 비우기</Button>
    </div>
    <small className="text-xs text-muted-foreground">저장된 값: {purchaseCostLabel(cost)}</small>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
  </form>;
}

function CostHistory({ goodId, variantId }: { goodId: string; variantId: string }) {
  const [history, setHistory] = useState<PurchaseCostChange[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function load(more: boolean) {
    const before = more ? history?.at(-1)?.revision : undefined;
    startTransition(async () => {
      const result = await listGoodsPurchaseCostHistoryAction(goodId, variantId, before);
      if (!result.ok) { setError(result.error); return; }
      setError(null); setHasMore(result.hasMore);
      setHistory((previous) => more ? [...(previous ?? []), ...result.history] : result.history);
    });
  }
  return <div className="flex min-w-0 flex-col items-start gap-2">
    <Button size="sm" type="button" variant="outline" onClick={() => load(false)} disabled={pending}>
      {pending ? '불러오는 중…' : history === null ? '변경 이력 보기' : '변경 이력 새로고침'}
    </Button>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    {history?.length === 0 && <p className="text-sm text-muted-foreground">등록된 변경 이력이 없습니다.</p>}
    {history && history.length > 0 && <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
      {history.map((entry) => <li key={entry.id}>
        <span className="tabular-nums">{purchaseCostLabel(entry.before)} → {purchaseCostLabel(entry.after)}</span>
        <small className="mt-1 block text-xs text-muted-foreground">
          {new Date(entry.changedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · {entry.actorName ?? '관리자'}
        </small>
      </li>)}
    </ol>}
    {hasMore && <Button size="sm" type="button" variant="outline" onClick={() => load(true)} disabled={pending}>이전 이력 더 보기</Button>}
  </div>;
}

/** Mount only for auth.role === 'admin', outside the product form. Every data
 * request also enforces that current role in its server action and database RPC. */
export function GoodsPurchaseCostsPanel({ goodId, variants }: { goodId: string; variants: AdminGoodsVariant[] }) {
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState<{ goodId: string; message: string } | null>(null);
  const [loaded, setLoaded] = useState<{ goodId: string; costs?: AdminGoodsPurchaseCost[]; error?: string } | null>(null);
  useEffect(() => {
    let canceled = false;
    void listGoodsPurchaseCostsAction(goodId).then((result) => {
      if (!canceled) setLoaded(result.ok ? { goodId, costs: result.costs } : { goodId, error: result.error });
    }).catch(() => {
      if (!canceled) setLoaded({ goodId, error: '매입단가를 불러오지 못했습니다. 다시 시도해주세요.' });
    });
    return () => { canceled = true; };
  }, [goodId, refresh]);
  const visible = loaded?.goodId === goodId ? loaded : null;
  const reload = () => setRefresh((value) => value + 1);
  const saved = (message: string) => { setNotice({ goodId, message }); reload(); };
  return <section className="flex min-w-0 flex-col gap-4 rounded-lg border p-4 text-sm" aria-labelledby={`purchase-costs-${goodId}`} data-good-purchase-costs="">
    <div className="flex flex-col gap-1">
      <h2 id={`purchase-costs-${goodId}`} className="text-base leading-snug font-medium">매입단가 · 관리자 전용</h2>
      <p className="text-sm text-muted-foreground">공급처에서 사오는 옵션 1개의 매입단가를 원 단위로 입력합니다.
        금액과 세금 구분을 함께 저장하며, 실제 0원도 기록할 수 있습니다. 금액을 정하지 않은 옵션은 두 값을 모두 비워 미설정으로 두세요.</p>
    </div>
    {notice?.goodId === goodId && <p className="text-sm text-[var(--wc-success)]" role="status">{notice.message}</p>}
    {!visible ? <p className="text-sm text-muted-foreground" role="status">매입단가를 불러오는 중입니다…</p> : visible.error ? <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-destructive" role="alert">{visible.error}</p><Button size="sm" type="button" variant="outline" onClick={reload}>다시 불러오기</Button>
    </div> : <>
      {visible.costs?.map((cost) => {
        const variant = variants.find((item) => item.id === cost.variantId && item.goodId === goodId);
        if (!variant) return null;
        return <article key={`${cost.variantId}:${cost.revision ?? 'unset'}`} className="flex min-w-0 flex-col gap-3 border-t pt-4">
          <div className="min-w-0 wrap-anywhere"><strong className="font-medium">{variant.name}{variant.archivedAt ? ' · 사용 중지' : ''}</strong><small className="block text-xs text-muted-foreground">{variant.code}</small></div>
          <CostEditor cost={cost} variant={variant} onSaved={saved} />
          <CostHistory goodId={goodId} variantId={cost.variantId} />
        </article>;
      })}
      {!visible.costs?.length && <p className="text-sm text-muted-foreground">매입단가를 입력할 옵션이 없습니다.</p>}
      <Button className="self-start" type="button" variant="outline" onClick={reload}>매입단가 목록 새로고침</Button>
    </>}
  </section>;
}
