import { useActionState, useEffect, useState } from 'react';
import { GoodEditor } from '../../components/admin/GoodEditor';
import { GoodsKcPanel } from '../../components/admin/GoodsKcPanel';
import { GoodsNoticePresetForm } from '../../components/admin/screens/GoodsNoticePresetForm';
import { GoodsKcTemplateProvider, useGoodsKcTemplate } from '../../components/admin/useGoodsKcTemplate';
import type { AdminCatalogActionState } from '../../app/admin/actions';
import type { AdminGoodRecord } from '../../lib/admin/catalog.server';
import type { Ip } from '../../lib/data';
import { fixtureKcVariant } from './kc-actions';
import { fixtureNoticePreset } from './editor-actions';

const ip: Ip = { id: 'fixture-ip', title: '합성 IP', sub: '', v: { key: 'character', label: '캐릭터', color: '#ddd' },
  glyph: 'IP', bg: '#eee', fans: 0, goods: 0, cards: 0, featured: false, tagline: '', synopsis: '' };
function record(id: string, name = '합성 KC 상품'): AdminGoodRecord {
  return { id, code: 'FIXTURE-GOOD', name, ipId: ip.id, firstPublishedAt: null, publishedAt: null, archivedAt: null,
    type: '문구', price: 1000, compareAtPrice: null, badge: null, stock: 'ok', stockQty: 0, allowBankTransfer: true,
    saleRestriction: 'none', bg: null, imagePath: null, notice: fixtureNoticePreset.notice, description: null,
    galleryPaths: [], galleryUrls: [], detailImagePath: null, detailImageUrl: null };
}

export function KcPresetFixture() {
  return <section className="wc-admin-kit"><h2>KC 프리셋 합성 검증</h2><GoodsNoticePresetForm preset={fixtureNoticePreset}/></section>;
}

/** Real form, selection bridge and KC panel, with explicitly local-only save actions. */
export function KcTemplateFixture() {
  const [selected, setSelected] = useState<AdminGoodRecord | null>(null);
  const selectionKey = selected ? `good:${selected.id}` : 'create:any';
  return <GoodsKcTemplateProvider selectionKey={selectionKey}>
    <KcTemplateFixtureForm key={selectionKey} selected={selected} onNavigate={setSelected}/>
  </GoodsKcTemplateProvider>;
}

function KcTemplateFixtureForm({ selected, onNavigate }: {
  selected: AdminGoodRecord | null;
  onNavigate: (record: AdminGoodRecord | null) => void;
}) {
  const [state, action, pending] = useActionState<AdminCatalogActionState, FormData>(async (previous, form) => {
    const id = selected?.id ?? `fixture-new-${crypto.randomUUID()}`;
    void form;
    return { message: '합성 상품 저장 성공', savedGoodId: id, attempt: (previous.attempt ?? 0) + 1 };
  }, {});
  const template = useGoodsKcTemplate(selected?.id ?? null);
  const { bindSavedGood } = template;
  useEffect(() => {
    if (!selected && state.savedGoodId) {
      bindSavedGood(state.savedGoodId);
      onNavigate(record(state.savedGoodId));
    }
  }, [selected, state.savedGoodId, onNavigate, bindSavedGood]);
  return <section className="wc-admin-kit col" style={{ gap: 16 }}>
    <h2>KC 프리셋 적용 · 합성 상품</h2>
    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
      <button onClick={() => onNavigate(null)}>신규 상품 선택</button>
      <button onClick={() => onNavigate(record('fixture-other'))}>다른 상품 선택</button>
      <button onClick={() => onNavigate({ ...record('fixture-reviewed'), kcDisclosures: [{ family: 'living', scheme: 'not_applicable',
        productCategory: '합성 분류', modelName: '합성 검토 모델', businessRole: 'manufacturer', businessName: '합성 제조자', identifier: '',
        publicNote: '합성 해당 없음 고시', variants: [{ id: fixtureKcVariant.id, name: fixtureKcVariant.name }] }] })}>검토된 합성 상품 선택</button>
    </div>
    <p role="status">선택: {selected?.id ?? '신규 상품'}</p>
    <GoodEditor accountId="fixture-kc-509" action={action} pending={pending} state={state} selected={selected} initialIpId={ip.id}
      onApplyKcTemplate={template.apply} catalogIps={[ip]} ipOptions={[{ id: ip.id, title: ip.title, archivedAt: null }]}
      variants={[]} origins={[]} categories={[]} shippingNoticeOptions={[]} regionSummaries={[]} />
    {selected ? <section aria-label="합성 KC 검토 영역"><h3>KC 자료·검토</h3><GoodsKcPanel key={selected.id} goodId={selected.id}
      templateRequest={template.request} onTemplateApplied={template.consume}/></section> : null}
  </section>;
}
