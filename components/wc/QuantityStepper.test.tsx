import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QuantityStepper } from './QuantityStepper';

const noop = () => {};

describe('QuantityStepper', () => {
  /* 버튼 두 개와 입력칸이 하나의 '수량' 컨트롤로 묶여 읽혀야 한다. */
  it('groups the controls under one label', () => {
    const html = renderToStaticMarkup(<QuantityStepper onChange={noop} value={1} />);

    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="수량"');
    expect(html).toContain('class="wc-stepper"');
  });

  /* − / + 는 기호 하나뿐이라 aria-label 이 없으면 접근 가능한 이름이 사실상 비어 있다. */
  it('names both buttons', () => {
    const html = renderToStaticMarkup(<QuantityStepper onChange={noop} value={2} />);

    expect(html).toContain('aria-label="수량 줄이기"');
    expect(html).toContain('aria-label="수량 늘리기"');
    expect(html).toContain('type="number"');
    /* React 는 이 속성을 카멜케이스 그대로 직렬화한다 — HTML 속성명은 대소문자를 안 가려
       브라우저에서는 동일하지만, 문자열 단언은 케이스를 풀어줘야 한다. */
    expect(html).toMatch(/inputmode="numeric"/i);
    expect(html).toContain('value="2"');
  });

  /* 경계에서 실제 disabled 를 걸면 초점이 사라져 키보드 사용자가 컨트롤 밖으로 튕긴다.
     한계는 시각 클래스로만 알리고 클릭은 조용히 무시한다. */
  it('marks the lower limit visually instead of disabling the button', () => {
    const html = renderToStaticMarkup(<QuantityStepper onChange={noop} value={1} />);

    const minus = html.match(/<button\b[^>]*aria-label="수량 줄이기"[^>]*>/)?.[0] ?? '';
    const plus = html.match(/<button\b[^>]*aria-label="수량 늘리기"[^>]*>/)?.[0] ?? '';
    expect(minus).toContain('wc-stepper__btn is-limit');
    expect(minus).not.toContain('disabled');
    expect(plus).toContain('class="wc-stepper__btn"');
  });

  it('marks the upper limit the same way', () => {
    const html = renderToStaticMarkup(<QuantityStepper max={5} onChange={noop} value={5} />);

    const minus = html.match(/<button\b[^>]*aria-label="수량 줄이기"[^>]*>/)?.[0] ?? '';
    const plus = html.match(/<button\b[^>]*aria-label="수량 늘리기"[^>]*>/)?.[0] ?? '';
    expect(plus).toContain('wc-stepper__btn is-limit');
    expect(plus).not.toContain('disabled');
    expect(minus).toContain('class="wc-stepper__btn"');
  });

  it('uses a custom label on the group and the input', () => {
    const html = renderToStaticMarkup(
      <QuantityStepper label="구매 수량" onChange={noop} value={3} />,
    );

    expect((html.match(/aria-label="구매 수량"/g) ?? []).length).toBe(2);
  });
});
