import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LEGAL_DOCUMENTS } from '@/lib/legal/documents';
import Page, { generateMetadata, generateStaticParams } from './page';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

describe('/legal/[document] 라우트', () => {
  it('세 문서를 정적으로 만들어 공개 접근을 보장한다', async () => {
    expect(await generateStaticParams()).toEqual([
      { document: 'terms' },
      { document: 'privacy' },
      { document: 'shipping' },
    ]);
  });

  it('문서 제목을 metadata로 노출한다', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ document: 'privacy' }) });

    expect(metadata.title).toBe(`${LEGAL_DOCUMENTS.privacy.title} — ICONS`);
  });

  it('알 수 없는 문서는 404다', async () => {
    await expect(Page({ params: Promise.resolve({ document: 'refund' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(generateMetadata({ params: Promise.resolve({ document: 'refund' }) })).resolves.toEqual({
      title: 'ICONS',
    });
  });

  it.each(['terms', 'privacy', 'shipping'] as const)('%s 문서를 로그인 없이 본문까지 렌더한다', async (slug) => {
    const document = LEGAL_DOCUMENTS[slug];
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ document: slug }) }));

    expect(html).toContain(document.title);
    expect(html).toContain(document.effectiveDate);
    for (const article of document.articles) {
      expect(html).toContain(article.heading);
    }
  });

  it('표가 있는 문서는 표 머리글과 셀을 함께 렌더한다', async () => {
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ document: 'privacy' }) }));
    const consignment = LEGAL_DOCUMENTS.privacy.articles.find((article) => article.heading.includes('위탁'))!;

    for (const column of consignment.table!.columns) {
      expect(html).toContain(column);
    }
    expect(html).toContain('Supabase, Inc.');
    expect(html).toContain('확인 중');
  });

  it('다른 두 문서로 서로 이동할 수 있다', async () => {
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ document: 'terms' }) }));

    expect(html).toContain('href="/legal/privacy"');
    expect(html).toContain('href="/legal/shipping"');
    expect(html).not.toContain('href="/legal/terms"');
  });
});
