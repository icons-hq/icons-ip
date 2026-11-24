import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { emptyCurationPreview } from '@/lib/admin/curation-editor';
import type { AdminCurationRecord } from '@/lib/admin/curations.server';
import { CurationLayoutEditor } from './CurationLayoutEditor';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/home-layout-actions', () => ({ saveAdminHomeLayoutAction: vi.fn() }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

/* LD-15(12 §4) — 혜택 밴드는 카드팩·게임만의 밴드가 아니다. 카드 리워드가 중지돼도 카드팩·게임으로 가는 타일만 숨고
   쿠폰·이벤트 타일은 남으므로, 영역 순서의 이름도 공개 홈의 밴드 제목('혜택')과 같아야 한다. */
describe('CurationLayoutEditor', () => {
  it('혜택 영역을 목적지와 무관한 이름(혜택)으로 부른다', () => {
    const html = renderToStaticMarkup(<CurationLayoutEditor
      device="mobile" layout={{ blocks: null, revision: 1, updatedAt: '2026-10-23T00:00:00.000Z' }} onDirty={vi.fn()} onSaved={vi.fn()}
      operationId="33333333-3333-4333-8333-333333333333" preview={{ curation: emptyCurationPreview(), noticeStrip: null, goods: [] }} records={[]}
    />);

    expect(html).toMatch(/<strong[^>]*>혜택<\/strong>/);
    expect(html).toContain('aria-label="혜택 홈 노출"');
    expect(html).not.toContain('카드팩·게임 혜택');
  });

  /* kit Button은 type을 주지 않으면 type="button"이라 폼을 제출하지 않는다. */
  it('전체 순서·노출 적용하기 버튼은 영역 순서 폼을 제출한다', () => {
    const html = renderToStaticMarkup(<CurationLayoutEditor
      device="mobile" layout={{ blocks: null, revision: 1, updatedAt: '2026-10-23T00:00:00.000Z' }} onDirty={vi.fn()} onSaved={vi.fn()}
      operationId="33333333-3333-4333-8333-333333333333" preview={{ curation: emptyCurationPreview(), noticeStrip: null, goods: [] }} records={[]}
    />);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>전체 순서·노출 적용하기<\/button>/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-label="혜택 위로"/);
  });

  /* X SQUARE 홈(ADR-0043)의 새 고정 영역 두 개와 이름이 바뀐 추천 콘텐츠는 공개 홈에 보이는 이름으로 부른다. */
  it('새 고정 영역과 바뀐 영역 이름을 공개 홈 어휘로 보인다', () => {
    const html = renderToStaticMarkup(<CurationLayoutEditor
      device="mobile" layout={{ blocks: null, revision: 1, updatedAt: '2026-10-23T00:00:00.000Z' }} onDirty={vi.fn()} onSaved={vi.fn()}
      operationId="33333333-3333-4333-8333-333333333333" preview={{ curation: emptyCurationPreview(), noticeStrip: null, goods: [] }} records={[]}
    />);

    expect(html).toMatch(/<strong[^>]*>IP 바로가기\(추천 콘텐츠\)<\/strong>/);
    expect(html).toMatch(/<strong[^>]*>NEW ARRIVAL\(최신 상품 자동\)<\/strong>/);
    expect(html).toMatch(/<strong[^>]*>홈 스트립 배너<\/strong>/);
    expect(html).toContain('aria-label="NEW ARRIVAL(최신 상품 자동) 홈 노출"');
    expect(html).toContain('aria-label="홈 스트립 배너 위로"');
    expect(html).not.toContain('>추천 콘텐츠<');
    /* 기본 순서(저장 레이아웃 없음)는 공개 홈과 같다: 히어로 → IP 바로가기 → NEW ARRIVAL → 스트립 → … */
    const order = ['프로모션 배너', 'IP 바로가기(추천 콘텐츠)', 'NEW ARRIVAL(최신 상품 자동)', '홈 스트립 배너', '카테고리 BEST', '인기템', '혜택']
      .map((label) => html.indexOf(`>${label}</strong>`));
    expect(order.every((position) => position > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  /* 기획전 배너는 연달아 놓이면 홈에서 ICONS PICK 한 줄로 묶인다 — 영역 이름 아래에 그 사실을 적고, 머리 안내에도 알린다. */
  it('기획전 영역은 X SQUARE PICK 카드 표시를 이름 아래에 적고 묶임 규칙을 안내한다', () => {
    const band = { id: '11111111-1111-4111-8111-111111111111', kind: 'band_banner', title: '팝업 인기 굿즈', displayOrder: 0, activeFrom: '2026-10-01T00:00:00.000Z',
      status: 'active' } as unknown as AdminCurationRecord;
    const html = renderToStaticMarkup(<CurationLayoutEditor
      device="mobile" layout={{ blocks: null, revision: 1, updatedAt: '2026-10-23T00:00:00.000Z' }} onDirty={vi.fn()} onSaved={vi.fn()}
      operationId="33333333-3333-4333-8333-333333333333" preview={{ curation: emptyCurationPreview(), noticeStrip: null, goods: [] }} records={[band]}
    />);

    expect(html).toMatch(/<strong[^>]*>팝업 인기 굿즈<\/strong><small[^>]*>X SQUARE PICK 카드\(기획전\)<\/small>/);
    expect(html).toContain('aria-label="팝업 인기 굿즈 홈 노출"');
    expect(html).toContain('연달아 놓은 기획전은 홈에서 &#x27;X SQUARE PICK&#x27; 한 줄(3장)로 묶여 보입니다.');
  });
});

