import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PopupHud, { HudBody } from './source/components/popup/PopupHud';
import PopupFloorplan from './source/components/popup/PopupFloorplan';

const noop = () => {};

describe('지우학 HUD 접근성과 탐색 계약', () => {
  it('모바일 제어가 연결된 패널과 상태를 읽어준다', () => {
    const html = renderToStaticMarkup(<PopupHud
      identity={{ name: '남온조', title: '학생증', onClick: noop }}
      context={{ key: 'gate', label: '교문', kind: 'intro', intro: { text: '효산고에 오신 것을 환영합니다.' } }}
      nav={{ chapters: ['교문', '급식실'], sceneCountOf: [1, 1], subScenes: [], section: 0, scene: 0 }}
      onSection={noop} onSceneJump={noop} onReset={noop}
    />);
    expect(html).toContain('aria-label="교문 안내 펼치기"');
    expect(html).toContain('aria-label="학교 안내도 열기 · 현 위치 교문"');
    expect(html).toContain('aria-label="시연 진행 초기화"');
    expect(html).toContain('aria-controls=');
    expect(html).not.toContain('role="tablist"');
  });

  it('넘겨진 목록 페이지는 보조기기와 키보드 탐색에서 함께 제외한다', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i), name: `구매권 ${i}`, sub: '기록 없음', go: { label: '도전하기', act: noop } }));
    const html = renderToStaticMarkup(<HudBody cur={{ kind: 'list', rows }} bodyKey="rights" />);
    expect(html).toContain('aria-hidden="true" inert=""');
    expect(html).toContain('aria-label="목록 다음 페이지"');
    expect(html).toContain('aria-label="2쪽 중 1쪽"');
  });

  it('지도는 현재 위치·잠금·진행 상태를 색과 별개로 읽어준다', () => {
    const html = renderToStaticMarkup(<PopupFloorplan current="gate" onJump={noop} booths={[
      { id: 'gate', name: '교문', x: 0, y: 0, w: 80, h: 50 },
      { id: 'roof', name: '옥상', x: 100, y: 0, w: 80, h: 50, state: 'locked', stateLabel: '체험 0/3' },
    ]} />);
    expect(html).toContain('aria-current="location"');
    expect(html).toContain('aria-label="교문 · 현 위치"');
    expect(html).toContain('aria-label="옥상 · 잠김 · 체험 0/3"');
  });

  it('장바구니 수량 버튼은 대상 상품을 명확히 읽어준다', () => {
    const html = renderToStaticMarkup(<HudBody cur={{ kind: 'cart', scroll: true,
      rows: [{ id: 'keyring', name: '교복 키링', qty: 2, max: 3, onQty: noop, right: '24,000원' }],
    }} bodyKey="cart" />);
    expect(html).toContain('aria-label="교복 키링 수량 줄이기"');
    expect(html).toContain('aria-label="교복 키링 수량 늘리기"');
  });
});
