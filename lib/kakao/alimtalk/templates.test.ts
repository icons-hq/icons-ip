import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALIMTALK_ITEM_SUMMARY_MAX,
  ALIMTALK_TEMPLATES,
  alimtalkAmount,
  alimtalkItemSummary,
  orderConfirmationParameters,
  orderShippedParameters,
} from './templates';

function placeholders(text: string): string[] {
  return [...text.matchAll(/#\{([^}]+)\}/g)].map((match) => match[1]);
}

describe('알림톡 템플릿 정본', () => {
  it('본문·버튼 링크의 #{변수}가 선언한 변수와 정확히 같다', () => {
    for (const draft of Object.values(ALIMTALK_TEMPLATES)) {
      const used = new Set([
        ...placeholders(draft.body),
        ...draft.buttons.flatMap((button) => [...placeholders(button.linkMo ?? ''), ...placeholders(button.linkPc ?? '')]),
      ]);
      expect([...used].sort()).toEqual([...draft.variables].sort());
      expect(draft.suggestedCode.length).toBeLessThanOrEqual(20);
      /* 알림톡 기본형 본문 한도(1,000자) 안에서 변수가 채워져도 넉넉해야 한다. */
      expect(draft.body.length).toBeLessThan(400);
    }
  });

  it('발송값이 템플릿 변수를 빠짐없이, 그 밖의 키 없이 채운다', () => {
    const confirmation = orderConfirmationParameters({ orderId: 'order-id', orderReference: '2026111910000001', itemNames: ['키링'], total: 32000 });
    expect(Object.keys(confirmation).sort()).toEqual([...ALIMTALK_TEMPLATES.order_confirmation.variables].sort());
    const shipped = orderShippedParameters({ orderId: 'order-id', orderReference: '2026111910000001', itemNames: ['키링'], carrierLabel: ' 한진택배 ', trackingNumber: ' 512345678901 ' });
    expect(Object.keys(shipped).sort()).toEqual([...ALIMTALK_TEMPLATES.order_shipped.variables].sort());
    expect(shipped).toMatchObject({ 택배사: '한진택배', 송장번호: '512345678901' });
  });

  it('정보성 문구만 담는다 — 광고·혜택 표현과 받는 분 개인정보 변수가 없다', () => {
    for (const draft of Object.values(ALIMTALK_TEMPLATES)) {
      expect(draft.body).not.toMatch(/쿠폰|이벤트|할인|혜택|추천|\(광고\)/);
      expect(draft.variables.join(',')).not.toMatch(/이름|주소|연락처|전화/);
      for (const button of draft.buttons) {
        if (button.type === 'WL') expect(button.linkMo).toMatch(/^https:\/\/xsquare\.kr\/orders\/#\{주문ID\}$/);
      }
    }
  });

  it('런북의 심사 제출용 본문이 정본과 같다', () => {
    const runbook = readFileSync(path.resolve(__dirname, '../../../docs/runbooks/kakao-alimtalk.md'), 'utf8');
    for (const draft of Object.values(ALIMTALK_TEMPLATES)) {
      expect(runbook).toContain(['```text', draft.body, '```'].join('\n'));
      expect(runbook).toContain(`코드 제안 \`${draft.suggestedCode}\``);
      for (const button of draft.buttons) {
        expect(runbook).toContain(`| ${button.name} |`);
        if (button.linkMo) expect(runbook).toContain(`\`${button.linkMo}\``);
      }
    }
  });
});

describe('알림톡 변수 값', () => {
  it('상품 요약은 첫 상품과 나머지 건수이고, 길면 말줄임하되 건수는 남긴다', () => {
    expect(alimtalkItemSummary(['메이플스토리 아크릴 키링'])).toBe('메이플스토리 아크릴 키링');
    expect(alimtalkItemSummary(['키링', '  스티커  ', '엽서'])).toBe('키링 외 2건');
    expect(alimtalkItemSummary([])).toBe('주문 상품');
    const long = alimtalkItemSummary(['가'.repeat(60), '나']);
    expect(long.endsWith('… 외 1건')).toBe(true);
    expect([...long].length).toBeLessThanOrEqual(ALIMTALK_ITEM_SUMMARY_MAX);
    expect([...alimtalkItemSummary(['가'.repeat(60)])].length).toBe(ALIMTALK_ITEM_SUMMARY_MAX);
  });

  it('결제금액은 원 단위 천 구분 숫자다', () => {
    expect(alimtalkAmount(32000)).toBe('32,000');
    expect(alimtalkAmount(0)).toBe('0');
    expect(alimtalkAmount(-1)).toBe('0');
  });
});
