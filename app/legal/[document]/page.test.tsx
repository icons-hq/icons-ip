import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LegalDocumentScreen } from '@/components/screens/LegalDocument';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_SLUGS } from '@/lib/legal/documents';
import Page, { generateMetadata, generateStaticParams } from './page';

vi.mock('@/lib/legal/business-info.server', async () => { const {BUSINESS_INFO}=await import('@/lib/legal/business-info'); return {getBusinessInfo:async()=>BUSINESS_INFO}; });

/* 운영 상수는 배포 직전에 날짜가 커밋된다(기본 null). 라우트 시험은 주입한 날짜로 세 상태를 고정한다. */
vi.mock('@/lib/legal/shipping-bundle-wording-revision', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/legal/shipping-bundle-wording-revision')>()),
  SHIPPING_BUNDLE_WORDING_REVISION: { announcedDate: '2026-11-20', effectiveDate: '2026-11-27' },
}));

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

  /* 오픈 전 최초 판(2026-11-06)이라 실제 문서에는 사전 공지·개정 안내·이전 본문이 없다.
     오픈 뒤 첫 개정에서 다시 쓰므로 fixture로 지켜 둔다 — 실제 문서에서 사라졌다고
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

  /* '출고지' 표기 예약 개정(1027T-010)은 요청 시각(KST)으로 상태가 갈린다 — 라우트는 요청마다 오늘 날짜로 문서를 만든다.
     시계를 공지 전날·공지일·시행일 정오(KST)에 세워 세 상태를 고정한다. */
  describe("'출고지' 표기 개정 렌더", () => {
    const announcedDate = '2026-11-20';
    const effectiveDate = '2026-11-27';
    const noonKst = (date: string, days = 0) => {
      const at = new Date(`${date}T03:00:00Z`);
      at.setUTCDate(at.getUTCDate() + days);
      return at;
    };
    const render = async (slug: string, now: Date) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(now);
      try {
        return renderToStaticMarkup(await Page({ params: Promise.resolve({ document: slug }) }));
      } finally {
        vi.useRealTimers();
      }
    };

    it.each(LEGAL_DOCUMENT_SLUGS)('%s 문서는 공지 전에는 오픈 전 최초 판(2026-11-06)만 보이고 개정 안내·이전 본문이 없다', async (slug) => {
      const html = await render(slug, noonKst(announcedDate, -1));
      expect(html).toContain('<p class="wc-document__effective">시행일 2026-11-06</p>');
      for (const absent of ['개정 사전 공지', '개정 안내', '이전 정책 본문', '<details class="wc-document__previous">']) {
        expect(html, absent).not.toContain(absent);
      }
    });

    it('개인정보처리방침은 공지 기간·시행 뒤에도 최초 판 그대로다', async () => {
      for (const now of [noonKst(announcedDate), noonKst(effectiveDate)]) {
        const html = await render('privacy', now);
        expect(html).toContain('<p class="wc-document__effective">시행일 2026-11-06</p>');
        expect(html).not.toContain('개정 사전 공지');
        expect(html).not.toContain('<details class="wc-document__previous">');
      }
    });

    it.each(['terms', 'shipping'])('%s 문서는 공지 기간에 현행 본문 앞에 사전 공지(공지일·시행 예정일)를 보인다', async (slug) => {
      const html = await render(slug, noonKst(announcedDate));
      expect(html).toContain('<p class="wc-document__effective">시행일 2026-11-06</p>');
      expect(html).toContain('개정 사전 공지');
      expect(html).toContain(`공지일 ${announcedDate}`);
      expect(html).toContain(`시행 예정일 ${effectiveDate}`);
      expect(html.indexOf('개정 사전 공지')).toBeLessThan(html.indexOf('wc-document__body'));
      /* 공지 기간의 현행 본문은 아직 '출고지별' 그대로다. */
      expect(html.slice(html.indexOf('wc-document__body'))).toContain('출고지별');
      expect(html).not.toContain('<details class="wc-document__previous">');
    });

    it.each(['terms', 'shipping'])('%s 문서는 시행일부터 배송 묶음 본문·개정 안내를 보이고 직전 본문을 이전 판으로 남긴다', async (slug) => {
      const html = await render(slug, noonKst(effectiveDate));
      expect(html).toContain(`<p class="wc-document__effective">시행일 ${effectiveDate}</p>`);
      expect(html).toContain(`<aside class="wc-document__notice" aria-label="${effectiveDate} 개정 안내">`);
      expect(html).not.toContain('개정 사전 공지');
      const previousAt = html.indexOf('<details class="wc-document__previous">');
      expect(previousAt).toBeGreaterThan(-1);
      const current = html.slice(html.indexOf('wc-document__body'), previousAt);
      expect(current).toContain('배송 묶음별');
      expect(current).not.toContain('출고지');
      expect(html.slice(previousAt)).toContain('이전 정책 본문 (시행일 2026-11-06)');
      expect(html.slice(previousAt)).toContain('출고지별');
    });
  });

  it('개인정보처리방침은 성인 인증·주소록·결제대행사 수탁자를 본문에 담는다', async () => {
    const privacy = renderToStaticMarkup(await Page({ params: Promise.resolve({ document: 'privacy' }) }));
    for (const text of ['성인 인증 (휴대폰 본인확인)', '엔에이치엔케이씨피 주식회사', '주소록 (선택)', '토스페이먼츠 주식회사', '나이스정보통신 주식회사']) {
      expect(privacy, text).toContain(text);
    }
    expect(privacy).not.toContain('코페이');
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

    expect(html).toContain('<main class="wc-root wc-document"><article class="wc-document__page">');
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

  /* 오픈 뒤 개정의 렌더 계약 — 개정 안내는 본문 앞, 이전 본문은 접힌 상세로 본문 뒤에 구별해 둔다. */
  it('개정 안내와 이전 공개 본문을 현재 안내와 구별해 열람할 수 있다', () => {
    const current = LEGAL_DOCUMENTS.shipping;
    const html = renderToStaticMarkup(
      <LegalDocumentScreen
        document={{
          ...current,
          effectiveDate: '2027-01-01',
          revisionChanges: ['개정된 내용입니다.'],
          previousVersion: {
            effectiveDate: current.effectiveDate,
            articles: [{ heading: '1. 이전 조항', paragraphs: ['이전 본문 문장입니다.'] }],
          },
        }}
      />,
    );
    expect(html).toContain('<aside class="wc-document__notice" aria-label="2027-01-01 개정 안내">');
    expect(html).toContain('개정된 내용입니다.');
    expect(html).toContain('<details class="wc-document__previous">');
    expect(html).toContain(`이전 정책 본문 (시행일 ${current.effectiveDate})`);
    expect(html).toContain('고객지원 연락처는 현재 정보로 표시합니다');
    expect(html).toContain('개별 이용자의 약관 동의 기록은 아닙니다');
    const currentEnd = html.indexOf('<details');
    expect(html.slice(0, currentEnd)).toContain('직접 취소 신청은 발주확인 전까지');
    expect(html.slice(0, currentEnd)).not.toContain('이전 본문 문장입니다.');
    expect(html.slice(currentEnd)).toContain('이전 본문 문장입니다.');
  });
});
