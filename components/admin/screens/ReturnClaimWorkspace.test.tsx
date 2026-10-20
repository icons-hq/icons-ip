import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReturnClaimWorkspace, type ReturnClaimProgress } from './ReturnClaimWorkspace';

const base: ReturnClaimProgress = { stage: 'collected', heldFrom: null, collectionPolicy: 'origin',
  collectionComplete: true, collectedAt: '2026-10-15T00:00:00Z', collectionCount: 2, collectedCount: 2,
  refundLedgerOpen: true, refundFiled: false, refundCompleted: false };
function render(progress: Partial<ReturnClaimProgress> = {}) {
  return renderToStaticMarkup(<ReturnClaimWorkspace progress={{ ...base, ...progress }}
    review={<form data-action="review" />} collection={<form data-action="collection" />}
    hold={<form data-action="hold" />} refund={<form data-action="refund" />} exception={null} />);
}

describe('return workspace evidence and navigation', () => {
  it('미보류 건은 보류 단계 선택 없이 환불 확인으로 안내하고 각 입력을 한 번만 배치한다', () => {
    const html = render();
    expect(html).toContain('다음 확인: 환불 처리');
    expect(html).toContain('보류는 필요한 경우에만 설정');
    expect(html).toContain('보류 상태 · 필요 시 처리');
    for (const action of ['review', 'collection', 'hold', 'refund']) expect(html.match(new RegExp(`data-action="${action}"`, 'g'))).toHaveLength(1);
    expect(html.match(/<form/g)).toHaveLength(4);
    expect(html.match(/<\/form>/g)).toHaveLength(4);
    let depth = 0;
    for (const form of html.match(/<\/?form\b[^>]*>/g) ?? []) {
      depth += form.startsWith('</') ? -1 : 1;
      expect(depth).toBeGreaterThanOrEqual(0); expect(depth).toBeLessThanOrEqual(1);
    }
    expect(depth).toBe(0);
  });
  it('legacy 전체 게이트만으로 입고 완료나 환불 작업을 안내하지 않는다', () => {
    const html = render({ collectionPolicy: 'legacy', collectedAt: null });
    expect(html).toContain('입고 확인 기록 없음');
    expect(html).toContain('다음 확인: 회수 확인');
    expect(html).not.toContain('전체 회수 확인 완료');
  });
  it('서버에서 보류가 해제되고 회수 증빙을 읽은 뒤에만 다음 확인이 환불로 바뀐다', () => {
    expect(render({ stage: 'on_hold', heldFrom: 'collected' })).toContain('다음 확인: 보류 상태 · 필요 시 처리');
    expect(render()).toContain('다음 확인: 환불 처리');
  });
  it('종결 단계만으로 환불완료를 추정하지 않고 원장과 완료 시각을 구분한다', () => {
    const incomplete = render({ stage: 'completed', refundFiled: true });
    expect(incomplete).toContain('환불 접수 기록 있음 · 완료 시각 없음');
    expect(incomplete).toContain('다음 확인: 환불 처리');
    expect(incomplete).not.toContain('반품과 환불 완료 기록을 확인했습니다');
    const missing = render({ stage: 'completed', refundLedgerOpen: false });
    expect(missing).toContain('환불 원장 없음');
    const complete = render({ stage: 'completed', refundCompleted: true });
    expect(complete).toContain('반품과 환불 완료 기록을 확인했습니다');
    expect(complete).not.toContain('다음 작업 보기');
  });
  it.each(['withdrawn', 'rejected'] as const)('%s는 다음 작업 버튼 없이 종결과 증빙 확인을 안내한다', stage => {
    const html = render({ stage });
    expect(html).toContain('요청 처리가 종료됐습니다');
    expect(html).not.toContain('다음 작업 보기');
    expect(html).toContain('환불 원장 열림 · 완료 시각 없음');
  });
});
