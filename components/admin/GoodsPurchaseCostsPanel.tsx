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
  return <form className="wc-admin-kit col" onSubmit={save} style={{ gap: 10 }}>
    <input type="hidden" name="goodId" value={cost.goodId} />
    <input type="hidden" name="variantId" value={cost.variantId} />
    <input type="hidden" name="expectedRevision" value={cost.revision ?? ''} />
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
      <label>매입단가 (원)
        <input name="unitCostKrw" aria-label={`${variant.name} 매입단가`} type="number" min={0} max={2147483647} step={1}
          value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="미설정" disabled={pending} />
      </label>
      <label>세금 구분
        <select name="taxBasis" aria-label={`${variant.name} 매입단가 세금 구분`} value={basis}
          onChange={(event) => setBasis(event.target.value)} disabled={pending}>
          <option value="">미설정</option>
          {Object.entries(PURCHASE_TAX_BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </div>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <button className="btn" type="submit" disabled={pending}>{pending ? '저장 중…' : '매입단가 저장'}</button>
      <button className="btn btn-ghost" type="button" disabled={pending} onClick={() => { setAmount(''); setBasis(''); }}>입력 비우기</button>
    </div>
    <small className="muted">저장된 값: {purchaseCostLabel(cost)}</small>
    {error && <p role="alert">{error}</p>}
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
  return <div className="col" style={{ gap: 8 }}>
    <button className="btn btn-ghost" type="button" onClick={() => load(false)} disabled={pending}>
      {pending ? '불러오는 중…' : history === null ? '변경 이력 보기' : '변경 이력 새로고침'}
    </button>
    {error && <p role="alert">{error}</p>}
    {history?.length === 0 && <p className="muted">등록된 변경 이력이 없습니다.</p>}
    {history && history.length > 0 && <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 12 }}>
      {history.map((entry) => <li key={entry.id}>
        <span>{purchaseCostLabel(entry.before)} → {purchaseCostLabel(entry.after)}</span>
        <small className="muted" style={{ display: 'block', marginTop: 4 }}>
          {new Date(entry.changedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · {entry.actorName ?? '관리자'}
        </small>
      </li>)}
    </ol>}
    {hasMore && <button type="button" className="btn btn-ghost" onClick={() => load(true)} disabled={pending}>이전 이력 더 보기</button>}
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
  return <section className="card col wc-admin-kit" aria-labelledby={`purchase-costs-${goodId}`} style={{ borderRadius: 10, gap: 18, padding: 18 }}>
    <div>
      <h2 id={`purchase-costs-${goodId}`} style={{ fontSize: 18, margin: 0 }}>매입단가 · 관리자 전용</h2>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>공급처에서 사오는 옵션 1개의 매입단가를 원 단위로 입력합니다.
        금액과 세금 구분을 함께 저장하며, 실제 0원도 기록할 수 있습니다. 금액을 정하지 않은 옵션은 두 값을 모두 비워 미설정으로 두세요.</p>
    </div>
    {notice?.goodId === goodId && <p role="status">{notice.message}</p>}
    {!visible ? <p role="status">매입단가를 불러오는 중입니다…</p> : visible.error ? <div>
      <p role="alert">{visible.error}</p><button className="btn btn-ghost" type="button" onClick={reload}>다시 불러오기</button>
    </div> : <>
      {visible.costs?.map((cost) => {
        const variant = variants.find((item) => item.id === cost.variantId && item.goodId === goodId);
        if (!variant) return null;
        return <article key={`${cost.variantId}:${cost.revision ?? 'unset'}`} className="col" style={{ gap: 14, borderBottom: '1px solid var(--line)', paddingBottom: 18 }}>
          <div><strong>{variant.name}{variant.archivedAt ? ' · 사용 중지' : ''}</strong><small className="muted" style={{ display: 'block' }}>{variant.code}</small></div>
          <CostEditor cost={cost} variant={variant} onSaved={saved} />
          <CostHistory goodId={goodId} variantId={cost.variantId} />
        </article>;
      })}
      {!visible.costs?.length && <p className="muted">매입단가를 입력할 옵션이 없습니다.</p>}
      <button className="btn btn-ghost" type="button" onClick={reload}>매입단가 목록 새로고침</button>
    </>}
  </section>;
}
