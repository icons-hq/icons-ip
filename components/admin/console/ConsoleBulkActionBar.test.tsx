import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConsoleBulkActionBar } from './ConsoleBulkActionBar';

const ACTIONS = [
  { label: '발송처리', name: 'bulkAction', value: 'ship' },
  { confirmLabel: '선택한 주문을 취소할까요?', label: '취소처리', name: 'bulkAction', value: 'cancel', variant: 'danger' as const },
];

describe('ConsoleBulkActionBar', () => {
  /* 선택이 없는데 바가 떠 있으면 대상 없는 일괄 처리를 누를 수 있는 것처럼 보인다. */
  it('선택된 행이 0건이면 아무것도 렌더하지 않는다', () => {
    expect(renderToStaticMarkup(
      <ConsoleBulkActionBar actions={ACTIONS} selectedCount={0} />,
    )).toBe('');
    expect(renderToStaticMarkup(
      <ConsoleBulkActionBar actions={ACTIONS} selectedCount={-1} />,
    )).toBe('');
  });

  it('선택 건수와 액션 버튼을 보여준다', () => {
    const html = renderToStaticMarkup(
      <ConsoleBulkActionBar actions={ACTIONS} label="선택한 주문" selectedCount={1234} />,
    );

    expect(html).toContain('선택한 주문');
    expect(html).toContain('1,234');
    expect(html).toContain('aria-label="선택한 주문 일괄 처리"');
    expect(html).toContain('발송처리');
    expect(html).toContain('취소처리');
  });

  it('제출은 호출자 form이 맡도록 name·value·type만 통과시킨다', () => {
    const html = renderToStaticMarkup(
      <ConsoleBulkActionBar actions={ACTIONS} selectedCount={2} />,
    );

    expect(html).toContain('name="bulkAction"');
    expect(html).toContain('value="ship"');
    expect(html).toContain('value="cancel"');
    expect(html).toContain('type="submit"');
    /* 바 자체는 form이 아니다 — 감싼 form의 server action이 제출을 받는다. */
    expect(html).not.toContain('<form');
  });

  /* 확인 대화는 이 컴포넌트가 띄우지 않는다. 감싼 form이 읽을 수 있게 속성만 남긴다. */
  it('확인 문구를 data-confirm 속성으로 노출한다', () => {
    const html = renderToStaticMarkup(
      <ConsoleBulkActionBar actions={ACTIONS} selectedCount={2} />,
    );

    expect(html).toContain('data-confirm="선택한 주문을 취소할까요?"');
    expect(html).toContain('admin-console-bulk-action--danger');
  });

  it('비활성 액션은 disabled로 렌더한다', () => {
    const html = renderToStaticMarkup(
      <ConsoleBulkActionBar
        actions={[{ disabled: true, label: '발송처리', name: 'ship' }]}
        selectedCount={1}
      />,
    );

    expect(html).toContain('disabled=""');
  });
});
