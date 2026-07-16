import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { IpSection } from './IpSection';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('../../../lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: vi.fn() }));

describe('IpSection', () => {
  it('uses the shared artwork field and states the horizontal key-art rule', () => {
    const html = renderToStaticMarkup(
      <IpSection
        action={vi.fn()}
        onSelect={vi.fn()}
        pending={false}
        records={[]}
        selected={null}
        state={{}}
        verticals={[{ key: 'global', label: '글로벌 IP', color: '#2DE2FF' }]}
      />,
    );

    expect(html).toContain('data-artwork-kind="ip"');
    expect(html).toContain('name="imagePath"');
    expect(html).toContain('가로형');
  });
});
