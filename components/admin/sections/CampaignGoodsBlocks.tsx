'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import { resolveGoodReferencesAction } from '@/app/admin/good-reference-actions';
import { CategoryDisplayGoodsPicker } from '@/components/admin/CategoryDisplayGoodsPicker';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { ADMIN_CAMPAIGN_MAX_SECTIONS, campaignGoodsBlocks, parseAdminCampaignSections, replaceCampaignGoodsBlock } from '@/lib/admin/campaigns';
import { discountPromotionListHref, newDiscountPromotionHref } from '@/lib/admin/discount-promotions';

/** 캠페인 굿즈 블록 한 개에 넣을 수 있는 상품 수(DB validate_campaign_sections와 같다). */
const GOODS_BLOCK_LIMIT = 8;

/**
 * 기획전(캠페인) 본문의 굿즈 블록 상품을 선택기로 고른다(1014-112). 고른 결과는 아래 구성 코드(JSON)에 그대로 쓰이고,
 * JSON 직접 편집은 고급 입력으로 남는다. 저장은 캠페인 저장 버튼 하나다.
 * 저장된 기획전이면 그 상품에 할인 프로모션을 만들거나 이 기획전의 할인을 볼 수 있다(1014-109).
 */
export function CampaignGoodsBlocks({ sectionsText, onSectionsTextChange, campaignId, disabled = false }: {
  sectionsText: string; onSectionsTextChange: (next: string) => void; campaignId: string | null; disabled?: boolean;
}) {
  const parsed = useMemo(() => parseAdminCampaignSections(sectionsText), [sectionsText]);
  const blocks = useMemo(() => parsed.ok ? campaignGoodsBlocks(parsed.value) : [], [parsed]);
  const [picker, setPicker] = useState<{ index: number | null; selected: string[] } | null>(null);
  const [names, setNames] = useState<Map<string, { label: string; missing: boolean }>>(new Map());
  const [message, setMessage] = useState('');
  const requested = useRef(new Set<string>());
  const ids = useMemo(() => [...new Set(blocks.flatMap(block => block.goodIds))], [blocks]);
  /* 고른 상품의 이름을 한 번에 확인한다. 조회에 실패해도 상품번호로 보이고 편집은 막지 않는다. */
  useEffect(() => {
    const unknown = ids.filter(id => !requested.current.has(id) && id === id.trim() && id.length <= 200);
    if (!unknown.length) return;
    unknown.forEach(id => requested.current.add(id));
    let alive = true;
    void resolveGoodReferencesAction(unknown.slice(0, 1000)).then(result => {
      if (!alive || !result.ok) return;
      setNames(current => {
        const next = new Map(current);
        for (const match of result.matches) {
          next.set(match.ref, match.status === 'found' && match.name
            ? { label: `${match.name}${match.archived ? ' (보관됨)' : match.published ? '' : ' (비공개)'}`, missing: match.archived }
            : { label: '찾을 수 없는 상품', missing: true });
        }
        return next;
      });
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [ids]);
  function apply(next: string[]) {
    if (!picker || !parsed.ok) return;
    if (!next.length) { setMessage('상품 묶음에는 상품을 1개 이상 골라야 합니다. 블록을 빼려면 구성 코드에서 지워주세요.'); setPicker(null); return; }
    onSectionsTextChange(JSON.stringify(replaceCampaignGoodsBlock(parsed.value, picker.index, next), null, 2));
    setMessage(picker.index === null ? `상품 묶음 블록을 추가했습니다(상품 ${next.length}개). 캠페인을 저장해야 반영됩니다.` : `상품 묶음의 상품을 바꿨습니다(상품 ${next.length}개). 캠페인을 저장해야 반영됩니다.`);
    setPicker(null);
  }
  return <div className="flex min-w-0 flex-col gap-3" data-campaign-goods-blocks="">
    {!parsed.ok ? <AdminNotice role="alert" title="구성 코드에 오류가 있어 상품 묶음을 고를 수 없습니다" tone="warning">아래 ‘이미지·랜딩 구성’의 구성 코드를 먼저 고쳐주세요.</AdminNotice> : null}
    {parsed.ok && !blocks.length ? <p className="text-sm text-muted-foreground">상품 묶음 블록이 없습니다. 블록을 추가하면 기획전 본문에 상품이 진열됩니다.</p> : null}
    {blocks.length ? <ol className="flex min-w-0 flex-col gap-2">{blocks.map((block, order) => <li className="flex min-w-0 flex-col gap-2 rounded-lg border px-3.5 py-3" key={block.index}>
      <div className="flex flex-wrap items-center gap-2"><strong className="text-sm font-semibold">상품 묶음 {order + 1}</strong>
        <span className="text-xs text-muted-foreground tabular-nums">본문 {block.index + 1}번째 블록 · 상품 {block.goodIds.length}/{GOODS_BLOCK_LIMIT}개{block.anchor ? ` · 목차 ${block.anchor}` : ''}</span>
        <Button className="ml-auto" disabled={disabled} onClick={() => { setMessage(''); setPicker({ index: block.index, selected: block.goodIds }); }} size="sm" type="button" variant="outline">상품 고르기</Button></div>
      <ul className="flex flex-wrap gap-1.5 text-xs">{block.goodIds.map(id => <li className={`rounded-md border px-2 py-1 [overflow-wrap:anywhere]${names.get(id)?.missing ? ' border-warning-border bg-warning-soft' : ''}`} key={id}>
        {names.get(id)?.label ?? id}<small className="ml-1 text-muted-foreground">{id}</small></li>)}</ul>
    </li>)}</ol> : null}
    {parsed.ok ? <div><Button disabled={disabled || parsed.value.length >= ADMIN_CAMPAIGN_MAX_SECTIONS} onClick={() => { setMessage(''); setPicker({ index: null, selected: [] }); }} size="sm" type="button" variant="outline"><Plus aria-hidden="true" />상품 묶음 블록 추가</Button></div> : null}
    {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
    <div className="flex flex-col gap-2 border-t pt-3">
      <p className="text-sm font-medium text-foreground">이 기획전 상품 할인</p>
      {campaignId ? <><p className="text-xs leading-relaxed text-muted-foreground">저장된 상품 묶음 블록의 상품에 같은 할인율을 한 번에 걸고, 한두 상품만 다른 할인율·예외가로 정할 수 있습니다. 블록을 바꿨다면 캠페인을 먼저 저장하세요.</p>
        <div className="flex flex-wrap gap-2"><Link className={buttonVariants({ size: 'sm' })} data-slot="button" href={newDiscountPromotionHref({ campaign: campaignId })}>이 기획전 할인 만들기</Link>
          <Link className={buttonVariants({ size: 'sm', variant: 'outline' })} data-slot="button" href={discountPromotionListHref({ campaign: campaignId })}>이 기획전 할인 보기</Link></div></>
        : <p className="text-xs text-muted-foreground">캠페인을 저장한 뒤 이 기획전 상품에 할인 프로모션을 만들 수 있습니다.</p>}
    </div>
    {/* 선택기의 검색 폼이 캠페인 폼 안에 겹치지 않게(그리고 입력·제출 이벤트가 캠페인 폼까지 오르지 않게) 본문 밖에 띄운다. */}
    {picker && typeof document !== 'undefined' ? createPortal(<div className="wc-admin" onChange={event => event.stopPropagation()} onSubmit={event => event.stopPropagation()}>
      <CategoryDisplayGoodsPicker limit={GOODS_BLOCK_LIMIT} onApply={ids => apply(ids)} onClose={() => setPicker(null)} selected={picker.selected} title="상품 묶음에 넣을 상품 선택" />
    </div>, document.body) : null}
  </div>;
}
