import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LegalDocumentScreen } from '@/components/screens/LegalDocument';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_SLUGS } from '@/lib/legal/documents';
import Page, { generateMetadata, generateStaticParams } from './page';

vi.mock('@/lib/legal/business-info.server', async () => { const {BUSINESS_INFO}=await import('@/lib/legal/business-info'); return {getBusinessInfo:async()=>BUSINESS_INFO}; });

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

  describe('주소록 예약 개정(L7 · MY-11) — 요청한 날(KST)로 사전 공지와 개정 본문을 가른다', () => {
    afterEach(() => { vi.useRealTimers(); });
    const at = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)); };

    it('시행일 전에는 개인정보처리방침만 현행 2026-10-19 본문에 사전 공지 배너를 붙인다', async () => {
      at('2026-11-05T23:59:00+09:00');
      for (const slug of LEGAL_DOCUMENT_SLUGS) {
        const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ document: slug }) }));
        if (slug !== 'privacy') {
          expect(html, slug).not.toContain('개정 사전 공지');
          continue;
        }
        expect(html).toContain('<p class="wc-document__effective">시행일 2026-10-19</p>');
        expect(html).toContain('<p class="wc-document__notice-kicker">개정 사전 공지</p>');
        expect(html).toContain('공지일 2026-10-28');
        expect(html).toContain('시행 예정일 2026-11-06');
        expect(html).toContain('이전 정책 본문 (시행일 2026-08-22)');
        expect(html).not.toContain('2026-11-06 개정 안내');
      }
    });

    it('시행일부터는 세 문서 모두 사전 공지 없이 개정 본문이 현행이다', async () => {
      at('2026-11-06T00:00:00+09:00');
      for (const slug of LEGAL_DOCUMENT_SLUGS) {
        const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ document: slug }) }));
        expect(html, slug).not.toContain('개정 사전 공지');
      }
      const privacy = renderToStaticMarkup(await Page({ params: Promise.resolve({ document: 'privacy' }) }));
      expect(privacy).toContain('<p class="wc-document__effective">시행일 2026-11-06</p>');
      expect(privacy).toContain('2026-11-06 개정 안내');
      expect(privacy).toContain('이전 정책 본문 (시행일 2026-10-19)');
    });
  });

  it('다른 두 문서로 서로 이동할 수 있다', async () => {
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ document: 'terms' }) }));

    expect(html).toContain('href="/legal/privacy"');
    expect(html).toContain('href="/legal/shipping"');
    expect(html).not.toContain('href="/legal/terms"');
  });

  /* 11 §8 EV-05 — R-06 §8 정책 문서 서식(620 한 칼럼·가운데 제목·조항 h2·본문 p)으로
     White Catalog 지면 안에서 그린다. 구 조판 클래스는 남기지 않는다. */
  it('620 document-page 서식으로 제목·조항·본문을 그린다', async () => {
    const document = LEGAL_DOCUMENTS.privacy;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ document: 'privacy' }) }));

    expect(html).toContain('<div class="wc-root wc-document"><article class="wc-document__page">');
    expect(html).toContain(`<h1 class="wc-document__title">${document.title}</h1>`);
    expect(html).toContain(`<p class="wc-document__effective">시행일 ${document.effectiveDate}</p>`);
    expect(html).toContain(`<h2 class="wc-document__heading">${document.articles[0]!.heading}</h2>`);
    expect(html).toContain('class="wc-document__paragraph"');
    expect(html).toContain('<div class="wc-document__table-scroll"><table class="wc-document__table">');
    expect(html).toContain('<nav aria-label="다른 법정 고지" class="wc-document__switch">');
    for (const legacy of ['legal-doc', 'class="screen', 'eyebrow', 'h-xl', 'mono', 'wrap']) {
      expect(html, legacy).not.toContain(legacy);
    }
  });

  it('개정 안내와 이전 공개 본문을 현재 안내와 구별해 열람할 수 있다', async () => {
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ document: 'shipping' }) }));
    expect(html).toContain('2026-09-09 개정 안내');
    expect(html).toContain('<details class="wc-document__previous">');
    expect(html).toContain('이전 정책 본문 (시행일 2026-08-21)');
    expect(html).toContain('<aside class="wc-document__notice" aria-label="2026-09-09 개정 안내">');
    expect(html).toContain('고객지원 연락처는 현재 정보로 표시합니다');
    expect(html).toContain('개별 이용자의 약관 동의 기록은 아닙니다');
    const currentEnd = html.indexOf('<details');
    expect(html.slice(0, currentEnd)).toContain('직접 취소 신청은 발주확인 전까지');
    expect(html.slice(0, currentEnd)).not.toContain('취소는 발송 전');
    expect(html.slice(currentEnd)).toContain('취소는 발송 전');
  });
});
