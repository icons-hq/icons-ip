import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Field, RecordList, SelectField, TextArea } from './fields';

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

    const errors = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((match) => match[1]);
    expect(errors).toHaveLength(2);
    for (const id of errors) expect(html).toContain(`id="${id}" role="alert"`);
  });

  it('associates select errors and leaves valid controls undescribed', () => {
    const invalidHtml = renderToStaticMarkup(
      <SelectField error="상태 오류" label="상태" name="status">
        <option value="ok">ok</option>
      </SelectField>,
    );
    const validHtml = renderToStaticMarkup(<Field label="이름" name="name" />);

    const errorId = invalidHtml.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(errorId).toBeTruthy();
    expect(invalidHtml).toContain(`id="${errorId}" role="alert"`);
    expect(validHtml).not.toContain('aria-describedby');
  });

  it('keeps labels and error targets unique when two editors use the same field name', () => {
    const html = renderToStaticMarkup(<><Field error="첫 오류" label="첫 상태" name="status" /><Field error="두 번째 오류" label="두 번째 상태" name="status" /></>);
    const labels = [...html.matchAll(/<label[^>]*for="([^"]+)"/g)].map((match) => match[1]);
    expect(labels).toHaveLength(2);
    expect(new Set(labels).size).toBe(2);
    for (const id of labels) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`aria-describedby="${id}-error"`);
      expect(html).toContain(`id="${id}-error" role="alert"`);
    }
  });

  it('forwards numeric bounds, readonly state, and required select semantics', () => {
    const html = renderToStaticMarkup(
      <>
        <Field label="정원" min={3} name="capacity" readOnly step={1} type="number" />
        <SelectField label="이벤트" name="eventId" required>
          <option value="e100">이벤트</option>
        </SelectField>
      </>,
    );

    expect(html).toContain('min="3"');
    expect(html).toContain('step="1"');
    expect(html).toContain('readOnly=""');
    expect(html).toContain('<select');
    expect(html).toContain('required=""');
  });

  /* #182 — 목록에서 레코드를 눈으로 식별할 수 있어야 한다. */
  it('shows a decorative thumbnail only for records that have artwork', () => {
    const html = renderToStaticMarkup(
      <RecordList
        activeId={null}
        items={[
          { id: 'g13', imageUrl: 'https://cdn.test/g13.png' },
          { id: 'g14', imageUrl: null },
        ]}
        labelFor={(good) => good.id}
        onNew={() => {}}
        onSelect={() => {}}
        thumbnailKind="good"
        thumbnailUrlFor={(good) => good.imageUrl}
      />,
    );

    expect(html).toContain('src="https://cdn.test/g13.png"');
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('loading="lazy"');
    /* 아트워크가 없는 g14 는 이미지 없이 라벨만 렌더된다. */
    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html).toContain('g14');
  });

  it('keeps the list free of thumbnails when a section does not opt in', () => {
    const html = renderToStaticMarkup(
      <RecordList
        activeId={null}
        items={[{ id: 'e100' }]}
        labelFor={(event) => event.id}
        onNew={() => {}}
        onSelect={() => {}}
      />,
    );

    expect(html).not.toContain('<img');
  });
});
