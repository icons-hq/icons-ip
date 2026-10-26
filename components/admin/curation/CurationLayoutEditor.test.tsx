import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { emptyCurationPreview } from '@/lib/admin/curation-editor';
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
      operationId="33333333-3333-4333-8333-333333333333" preview={{ curation: emptyCurationPreview(), noticeStrip: null, goods: [], cardRewardsEnabled: false }} records={[]}
    />);

    expect(html).toContain('<strong>혜택</strong>');
    expect(html).toContain('aria-label="혜택 홈 노출"');
    expect(html).not.toContain('카드팩·게임 혜택');
  });
});
