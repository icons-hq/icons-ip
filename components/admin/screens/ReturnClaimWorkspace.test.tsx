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
    expect(missing).toContain('환불 기록 없음');
    const complete = render({ stage: 'completed', refundCompleted: true });
    expect(complete).toContain('반품과 환불 완료 기록을 확인했습니다');
    expect(complete).not.toContain('다음 작업 보기');
  });
  /* 사람 눈 판정: 지금 할 일이 끝난 단계에 밀려 첫 화면 맨 아래에 있었고, 끝난·지금·남은 단계가 구분되지 않았다. */
  it('지금 단계만 펼치고 끝난 단계·지금 단계·남은 단계를 표시와 글자로 나눈다', () => {
    const html = render({ stage: 'collecting', collectionComplete: false, collectedAt: null, collectedCount: 0 });
    expect(html.match(/<details[^>]*\bopen=""/g)).toHaveLength(1);
    expect(html).toMatch(/<details[^>]*data-step-state="current"[^>]*open=""[^>]*><summary[^>]*><h4[^>]*id="return-collection"/);
    expect(html).toMatch(/aria-current="step"[^>]*data-step-state="current"/);
    expect(html.match(/<button[^>]*data-step-state="done"/g)).toHaveLength(1);
    expect(html.match(/<button[^>]*data-step-state="todo"/g)).toHaveLength(1);
    expect(html.match(/<button[^>]*data-step-state="optional"/g)).toHaveLength(1);
    for (const caption of ['>완료<', '>지금 할 일<', '>남은 단계<', '>필요 시<']) expect(html).toContain(caption);
    /* 지금 할 일이 바로 아래에 펼쳐지므로 이동 버튼을 따로 두지 않는다. */
    expect(html).not.toContain('다음 작업 보기');
  });
  /* 사람 눈 판정(3라운드): 위 단계 칸과 아래 접이 줄이 같은 말을 두 번 해 어느 쪽을 눌러야 할지 망설였다. */
  it('지금 할 일이 있으면 위 단계 칸이 유일한 이동 수단이고 아래에는 펼친 단계만 남는다', () => {
    const html = render({ stage: 'collecting', collectionComplete: false, collectedAt: null, collectedCount: 0 });
    const sections = html.match(/<details[^>]*>/g) ?? [];
    expect(sections).toHaveLength(4);
    for (const tag of sections) expect(tag).toContain('[&amp;:not([open])]:hidden');
    /* 지금 단계 칸은 접지 않으므로 접기 표시가 없고, 다음 할 일 문구는 화면 낭독기로만 읽는다. */
    const at = html.indexOf('id="return-collection"');
    expect(html.slice(at, html.indexOf('</summary>', at))).not.toContain('lucide-chevron-down');
    expect(html).toMatch(/<p class="sr-only" role="status">다음 확인: 회수 확인</);
    /* 강조 테두리는 지금 단계 칸 하나다. */
    expect(sections.filter(tag => tag.includes('data-step-state="current"'))).toHaveLength(1);
  });
  it('할 일이 끝난 요청은 접이 줄을 모두 남겨 기록을 찾아볼 수 있다', () => {
    const html = render({ stage: 'completed', refundCompleted: true });
    for (const tag of html.match(/<details[^>]*>/g) ?? []) expect(tag).not.toContain(':hidden');
    expect(html).toContain('lucide-chevron-down');
  });
  it.each(['withdrawn', 'rejected'] as const)('%s는 다음 작업 버튼 없이 종결과 증빙 확인을 안내한다', stage => {
    const html = render({ stage });
    expect(html).toContain('요청 처리가 종료됐습니다');
    expect(html).not.toContain('다음 작업 보기');
    expect(html).toContain('환불 원장 열림 · 완료 시각 없음');
  });
});
