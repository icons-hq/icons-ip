import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Field, SelectField, TextArea } from './fields';

vi.mock('@/components/ui/Icon', () => ({
  Icon: () => null,
}));

describe('admin fields', () => {
  it('associates input and textarea errors with alert text', () => {
    const html = renderToStaticMarkup(
      <>
        <Field error="수량 오류" label="수량" name="quantity" />
        <TextArea error="사유 오류" label="사유" name="reason" />
      </>,
    );

    expect(html).toContain('aria-describedby="quantity-error"');
    expect(html).toContain('id="quantity-error" role="alert"');
    expect(html).toContain('aria-describedby="reason-error"');
    expect(html).toContain('id="reason-error" role="alert"');
  });

  it('associates select errors and leaves valid controls undescribed', () => {
    const invalidHtml = renderToStaticMarkup(
      <SelectField error="상태 오류" label="상태" name="status">
        <option value="ok">ok</option>
      </SelectField>,
    );
    const validHtml = renderToStaticMarkup(<Field label="이름" name="name" />);

    expect(invalidHtml).toContain('aria-describedby="status-error"');
    expect(invalidHtml).toContain('id="status-error" role="alert"');
    expect(validHtml).not.toContain('aria-describedby');
  });
});
