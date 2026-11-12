import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GOODS_OTHER_CERTIFICATIONS_RELOAD_LABEL, goodsOtherCertificationsConflictMessage, type AdminGoodsOtherCertifications } from '@/lib/admin/goods-kc-other-certifications';

/* 저장된 상품의 기타 인증 패널은 기본 폼과 함께 다시 마운트돼도 키 밖 stash에서 상태를 이어 받는다. 정적 렌더에서는 그 상태를 직접 넣는다. */
const stash = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./GoodWorkspace', async () => {
  const actual = await vi.importActual<typeof import('./GoodWorkspace')>('./GoodWorkspace');
  return { ...actual, useGoodWorkspaceStash: () => [stash.value, vi.fn(), vi.fn()] as const };
});
vi.mock('@/app/admin/goods-kc-actions', () => ({ readGoodsKcAction: vi.fn(), saveGoodsKcAction: vi.fn(),
  readGoodsOtherCertificationsAction: vi.fn(), saveGoodsOtherCertificationsAction: vi.fn() }));
const { GoodsOtherCertificationsPanel } = await import('./GoodsKcPanel');

const radio = { kind: '방송통신기자재 적합성평가', agency: '국립전파연구원', number: 'R-R-TEST-0001', visible: true };
const latest: AdminGoodsOtherCertifications = { revision: 3, entries: [{ ...radio, visible: false }], publishedAt: '2026-11-12T00:00:00Z',
  archivedAt: null, updatedAt: '2026-11-12T01:00:00Z', updatedByName: '다른 운영자' };

describe('저장된 상품의 기타 인증 패널 — 다시 불러오기·버전 충돌(리뷰 T16a minor 3)', () => {
  it('불러온 뒤에도 저장된 기타 인증 다시 불러오기가 있다', () => {
    stash.value = { configuration: { ...latest, revision: 2, entries: [radio] }, entries: null, error: null };
    const html = renderToStaticMarkup(<GoodsOtherCertificationsPanel goodId="g1" />);
    expect(html).toContain(`>${GOODS_OTHER_CERTIFICATIONS_RELOAD_LABEL}</button>`);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>기타 인증 저장<\/button>/);
  });

  it('충돌 뒤에는 최신 버전을 받은 채 입력을 그대로 보이고, 다시 저장할 수 있으며 안내가 두 길을 말한다', () => {
    stash.value = { configuration: latest, entries: [radio], error: goodsOtherCertificationsConflictMessage(latest) };
    const html = renderToStaticMarkup(<GoodsOtherCertificationsPanel goodId="g1" />);
    /* 입력(고객 표시 켬)은 그대로이고 최신 저장값(표시 끔)과 달라 저장 버튼이 열려 있다. */
    expect(html).toMatch(/aria-label="기타 인증 1 고객 상세에 표시" checked=""/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>기타 인증 저장<\/button>/);
    expect(html).toContain('저장하지 않은 기타 인증이 있습니다.');
    expect(html).toContain('role="alert">다른 작업에서 기타 인증이 바뀌었습니다(최신 저장 1건: 방송통신기자재 적합성평가)');
    expect(html).toContain(`>${GOODS_OTHER_CERTIFICATIONS_RELOAD_LABEL}</button>`);
  });

  it('저장 결과의 최신 버전으로 바꾸고 입력은 지키며, 다시 불러오기는 미저장 입력을 지우기 전에 묻는다', () => {
    /* 정적 렌더로는 클릭할 수 없어 배선을 대조한다(GoodsKcPanel.test의 refreshKey 배선 검사와 같은 방식). */
    const panel = readFileSync('components/admin/GoodsKcPanel.tsx', 'utf8');
    expect(panel).toContain("else if ('latest' in result) setState((current) => ({ ...current, configuration: result.latest, entries: current.entries ?? entries, error: result.error }));");
    expect(panel).toContain("if (dirty && !await adminConfirm('저장하지 않은 기타 인증 입력을 지우고 저장된 값으로 바꿉니다. 계속할까요?')) return;");
    expect(panel).toContain('setState({ configuration: null, entries: null, error: null });');
  });
});
