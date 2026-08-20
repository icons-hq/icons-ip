import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LegalDocumentScreen } from '@/components/screens/LegalDocument';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_SLUGS } from '@/lib/legal/documents';
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

  /* 2026-08-21 개정으로 세 문서의 사전 공지를 모두 본문으로 승격했다(#207).
     배너는 다음 개정에서 다시 쓰므로 fixture로 지켜 둔다 — 실제 문서에서 사라졌다고
     컴포넌트 분기의 검증까지 함께 잃으면, 다음 공지가 조용히 렌더되지 않는다. */
  it('사전 공지가 있는 문서는 공지일·시행 예정일과 변경 내용을 본문 앞에 노출한다', () => {
    const notice = {
      announcedDate: '2026-09-01',
      effectiveDate: '2026-09-08',
      heading: '개정 예정 안내',
      changes: ['첫 번째 변경 내용입니다.', '두 번째 변경 내용입니다.'],
    };
    const html = renderToStaticMarkup(
      <LegalDocumentScreen document={{ ...LEGAL_DOCUMENTS.terms, pendingRevision: notice }} />,
    );

    expect(html).toContain('개정 사전 공지');
    expect(html).toContain(`공지일 ${notice.announcedDate}`);
    expect(html).toContain(`시행 예정일 ${notice.effectiveDate}`);
    expect(html).toContain(notice.heading);
    for (const change of notice.changes) {
      expect(html).toContain(change);
    }
  });

  it('현재 세 문서는 시행이 끝나 사전 공지 배너를 렌더하지 않는다', async () => {
    for (const slug of LEGAL_DOCUMENT_SLUGS) {
      const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ document: slug }) }));

      expect(html, slug).not.toContain('개정 사전 공지');
    }
  });

  it('다른 두 문서로 서로 이동할 수 있다', async () => {
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ document: 'terms' }) }));

    expect(html).toContain('href="/legal/privacy"');
    expect(html).toContain('href="/legal/shipping"');
    expect(html).not.toContain('href="/legal/terms"');
  });
});
