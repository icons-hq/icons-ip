'use client';

import { startTransition, useActionState, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveAdminHomeLayoutAction } from '@/app/admin/home-layout-actions';
import { ActionNotice } from '@/components/admin/fields';
import type { AdminCurationRecord } from '@/lib/admin/curations.server';
import type { CurationPublicPreview } from '@/lib/admin/curation-editor';
import type { AdminHomeLayout, AdminHomeLayoutActionState } from '@/lib/admin/home-layout';
import { resolveHomeLayoutBlocks, type HomeBlockKey, type HomeRankingBlockKey } from '@/lib/home-layout';
import { CurationPreview, type CurationPreviewDevice } from './CurationPreview';
import { buildHomeProductCollectionBand, isHomeProductCollectionTitle, parseHomeProductCollectionPayload } from '@/lib/home-product-collection';

const LABELS: Record<string, string> = { hero: '프로모션 배너', editor_picks: '추천 콘텐츠', category_best: '카테고리 BEST', popular: '인기템', benefits: '혜택', stories: '쇼핑스토리' };

export function CurationLayoutEditor({ layout, operationId, preview, records, device, onDirty, onSaved }: {
  layout: AdminHomeLayout; operationId: string; preview: CurationPublicPreview; records: AdminCurationRecord[];
  device: CurationPreviewDevice; onDirty: () => void; onSaved: (message: string) => void;
}) {
  const router = useRouter();
  const bands = useMemo(() => records.filter((record) => record.kind === 'band_banner').sort((a, b) => a.displayOrder - b.displayOrder || a.activeFrom.localeCompare(b.activeFrom) || a.id.localeCompare(b.id)), [records]);
  const rankingRecords = useMemo(() => records.filter((record) => record.kind === 'sales_best' || record.kind === 'review_best' || record.kind === 'product_mosaic' || record.kind === 'product_collection')
    .sort((a, b) => (a.kind === 'sales_best' ? 0 : 1) - (b.kind === 'sales_best' ? 0 : 1)
      || a.displayOrder - b.displayOrder || a.activeFrom.localeCompare(b.activeFrom) || a.id.localeCompare(b.id)), [records]);
  const rankingKeys = rankingRecords.map((record): HomeRankingBlockKey => `${record.kind === 'sales_best' ? 'sales' : record.kind === 'review_best' ? 'reviews' : record.kind === 'product_mosaic' ? 'mosaic' : 'products'}:${record.id}`);
  // The public RPC omits layout-hidden collections. The authorized editor uses
  // saved candidates plus public goods to preview an explicit unhide before save.
  const previewCollections = useMemo(() => records.flatMap(record => {
    if (record.kind !== 'product_collection' || record.status !== 'active' || !isHomeProductCollectionTitle(record.title)) return [];
    const payload = parseHomeProductCollectionPayload(record.payload);
    return payload ? [buildHomeProductCollectionBand(record.id, record.title, payload, preview.goods)] : [];
  }), [records, preview.goods]);
  const [blocks, setBlocks] = useState(() => resolveHomeLayoutBlocks(layout.blocks, bands.map((band) => band.id), rankingKeys));
  const [state, action, pending] = useActionState(async (previous: AdminHomeLayoutActionState, formData: FormData) => {
    const result = await saveAdminHomeLayoutAction(previous, formData);
    if (result.message && !result.errors) onSaved(result.message);
    return result;
  }, {});
  const labels = new Map<HomeBlockKey, string>(bands.map((band) => [`band:${band.id}`, band.title]));
  rankingRecords.forEach((record, index) => labels.set(rankingKeys[index], record.title));
  const publicRankingKeys: HomeRankingBlockKey[] = [
    ...(preview.curation.salesBestBands ?? []).map((band): HomeRankingBlockKey => `sales:${band.id}`),
    ...(preview.curation.reviewBestBands ?? []).map((band): HomeRankingBlockKey => `reviews:${band.id}`),
    ...(preview.curation.mosaicBands ?? []).map((band): HomeRankingBlockKey => `mosaic:${band.id}`),
    ...previewCollections.map((band): HomeRankingBlockKey => `products:${band.id}`),
  ];
  const publicOrder = resolveHomeLayoutBlocks(blocks, preview.curation.goodsBands.map((band) => band.id), publicRankingKeys).filter((block) => block.enabled).map((block) => block.key);
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    setBlocks((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    onDirty();
  }

  return <div className="admin-store-editor__workspace admin-store-editor__workspace--layout">
    <form className="admin-store-editor__form wc-admin-kit" aria-label="홈 영역 순서" action={action} onSubmit={(event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      startTransition(() => action(formData));
    }}>
      <input name="operationId" type="hidden" value={operationId} />
      <input name="expectedRevision" type="hidden" value={layout.revision} />
      <input name="blocks" type="hidden" value={JSON.stringify(blocks)} />
      <header><h3>홈 영역 순서·노출</h3><p>영역을 위아래로 옮기고 홈 노출을 설정하세요. 기획전·판매량 BEST·베스트리뷰·자유상품·모자이크는 각각 배치할 수 있습니다.</p></header>
      <fieldset disabled={pending}>
        <ol className="admin-store-editor__layout-list">{blocks.map((block, index) => {
          const label = labels.get(block.key) ?? LABELS[block.key] ?? '기획전 배너';
          return <li key={block.key}>
            <span className="admin-store-editor__layout-number">{index + 1}</span>
            <div><strong>{label}</strong><label><input aria-label={`${label} 홈 노출`} checked={block.enabled} onChange={(event) => {
              setBlocks((current) => current.map((item) => item.key === block.key ? { ...item, enabled: event.target.checked } : item));
              onDirty();
            }} type="checkbox" />{block.enabled ? '노출함' : '노출안함'}</label></div>
            <span><button aria-label={`${label} 위로`} disabled={index === 0} onClick={() => move(index, -1)} type="button">↑</button><button aria-label={`${label} 아래로`} disabled={index === blocks.length - 1} onClick={() => move(index, 1)} type="button">↓</button></span>
          </li>;
        })}</ol>
        <div className="admin-store-editor__form-section"><p>구성의 개별 노출 기간·노출 설정도 함께 적용됩니다. 상품이나 콘텐츠가 없는 영역은 표시하지 않습니다.</p><p>새 개별 구성은 마지막에 추가됩니다. 상단 띠배너는 스토어 상단에 고정됩니다.</p></div>
      </fieldset>
      <footer className="admin-store-editor__form-footer"><ActionNotice state={{ errors: state.errors }} />
        {state.conflict ? <button onClick={() => router.refresh()} type="button">최신 구성 다시 불러오기</button> : null}
        <button className="admin-store-editor__primary" disabled={pending} type="submit">{pending ? '적용 중…' : '전체 순서·노출 적용하기'}</button>
      </footer>
    </form>
    <aside className="admin-store-editor__preview" aria-label="홈 영역 순서 미리보기">
      <header><h3>전체 홈 미리보기</h3><span>{device === 'mobile' ? '390px' : '1212px'}</span></header>
      <div className="admin-store-editor__preview-note">현재 공개된 콘텐츠에 편집 중인 영역 순서·노출을 적용한 모습입니다.</div>
      <CurationPreview cardRewardsEnabled={preview.cardRewardsEnabled} curation={{ ...preview.curation, productCollections: previewCollections, layoutOrder: publicOrder }} noticeBar={preview.noticeBar ?? null} noticeStrip={preview.noticeStrip} device={device} />
    </aside>
  </div>;
}
