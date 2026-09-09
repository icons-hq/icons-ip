import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ canView: vi.fn(), experience: vi.fn(() => <div>AOUAD</div>) }));
vi.mock('@/lib/aouad-popup.server', () => ({ canViewAouadPopup: mocks.canView }));
vi.mock('@/components/online-popup/aouad/AouadExperience', () => ({ AouadExperience: mocks.experience }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
import Page, { metadata, dynamic } from './page';

beforeEach(() => { mocks.canView.mockReset().mockResolvedValue(false); mocks.experience.mockClear(); });

describe('/ip/aouad 서버 페이지', () => {
  it('권한이 없는 직접 URL 진입은 경험을 렌더하지 않는다', async () => {
    await expect(Page()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.experience).not.toHaveBeenCalled();
  });

  it('서버 허가 후에만 독립 경험을 렌더한다', async () => {
    mocks.canView.mockResolvedValue(true);
    expect(renderToStaticMarkup(await Page())).toContain('AOUAD');
  });

  it('검색 노출과 공유 캐시를 사용하지 않는다', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(dynamic).toBe('force-dynamic');
  });
});
