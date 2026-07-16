import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EventSection } from './EventSection';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('../../../lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: vi.fn() }));

describe('EventSection', () => {
  it('uses the shared artwork upload field', () => {
    const html = renderToStaticMarkup(
      <EventSection
        action={vi.fn()}
        ipOptions={[]}
        onSelect={vi.fn()}
        pending={false}
        records={[]}
        selected={null}
        state={{}}
      />,
    );

    expect(html).toContain('data-artwork-kind="event"');
    expect(html).toContain('name="imagePath"');
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
  });
});
