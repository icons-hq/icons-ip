import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IpIdentityForm } from './IpIdentityForm';

describe('IP identity form', () => {
  it('separates the internal id, editable public slug and preserved aliases', () => {
    const html = renderToStaticMarkup(<IpIdentityForm identity={{
      internalId: 'hwasan', publicSlug: 'mountain-fire', aliases: ['hwasan', 'old-fire'],
    }} />);
    expect(html).toContain('name="id" value="hwasan"');
    expect(html).toContain('name="expectedPublicSlug" value="mountain-fire"');
    expect(html).toContain('name="publicSlug"');
    expect(html).toContain('value="mountain-fire"');
    expect(html).toContain('old-fire');
    expect(html).toContain('내부 ID·기존 별칭은 수정하거나 삭제하지 않습니다.');
  });
});
