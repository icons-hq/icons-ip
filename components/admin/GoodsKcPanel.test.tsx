import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { emptyGoodsKcModel, type AdminGoodsKc } from '@/lib/admin/goods-kc';
import { GoodsKcEditor } from './GoodsKcPanel';

vi.mock('@/app/admin/goods-kc-actions', () => ({ readGoodsKcAction: vi.fn(), saveGoodsKcAction: vi.fn() }));
const variant = { id: '00000000-0000-4000-8000-000000000001', code: 'OPTION-1', name: '기본 옵션', active: true };
const draft: AdminGoodsKc = { revision: null, status: 'unreviewed', models: [], contextFingerprint: 'a'.repeat(64),
  publishedAt: null, archivedAt: null, reviewedAt: null, reviewerName: null, variants: [variant], history: [] };
describe('KC 모델 검토 화면', () => {
  it('유형 틀만 제공하고 실제 증빙 없는 최초 검토 완료는 비활성화한다', () => {
    const html = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={draft} onSaved={() => {}} />);
    expect(html).toContain('유형 틀로 모델 추가');
    expect(html).toContain('미검토로 저장');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>KC 검토 완료/);
    expect(html).toContain('원본 근거와 실제 모델');
    expect(html).not.toContain('TEST-ONLY');
  });
  it('기존 공개 미기록을 자동 승인하지 않고 비공개 후 검토할 수 있게 안내한다', () => {
    const html = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, publishedAt: '2026-09-10T00:00:00Z' }} onSaved={() => {}} />);
    expect(html).toContain('기존 공개 · KC 미기록');
    expect(html).toContain('먼저 상품을 비공개');
    expect(html).not.toContain('>KC 검토 완료</button>');
    expect(html).not.toContain('>미검토로 저장</button>');
  });
  it('모델·옵션·사내근거를 따로 입력하고 잘못된 기존 옵션 연결도 해제할 수 있다', () => {
    const html = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, revision: 1,
      models: [{ ...emptyGoodsKcModel(), family: 'children', scheme: 'safety_confirmation',
        variantIds: ['00000000-0000-4000-8000-000000000002'] }] }} onSaved={() => {}} />);
    for (const text of ['모델 1 모델명', '모델 1 인증·신고번호', '모델 1 적용 옵션 기본 옵션', '모델 1 적용 판단 사유',
      '모델 1 인증·신고문서 참조', '모델 1 삭제된 옵션 연결 해제']) expect(html).toContain(text);
    expect(html).toContain('고객에게 공개되지 않습니다');
    expect(html).not.toContain('고객 고시 미리보기');
  });
});
