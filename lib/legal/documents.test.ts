import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { businessContactWords } from './business-info';
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_SLUGS,
  LEGAL_EFFECTIVE_DATES,
  getLegalDocument,
  legalDocumentHref,
  PENDING_PROCESSOR_LABEL,
  type LegalDocument,
} from './documents';
import { SOCIAL_LOGIN_PROVIDERS, overseasSocialLogins } from './social-login';

const documents = LEGAL_DOCUMENT_SLUGS.map((slug) => LEGAL_DOCUMENTS[slug]);

function source() {
  return readFileSync(new URL('./documents.ts', import.meta.url), 'utf8');
}

/** 문서 본문 전체를 한 문자열로 펼친다 — 용어 검사는 표·목록까지 포함해야 의미가 있다. */
function plainText(document: LegalDocument): string {
  return document.articles
    .flatMap((article) => [
      article.heading,
      ...(article.paragraphs ?? []),
      ...(article.list ?? []),
      ...(article.table ? [...article.table.columns, ...article.table.rows.flat()] : []),
      ...(article.closing ?? []),
    ])
    .join('\n');
}

describe('법정 문서 레지스트리', () => {
  it('세 문서만 공개하고 슬러그로 조회한다', () => {
    expect(LEGAL_DOCUMENT_SLUGS).toEqual(['terms', 'privacy', 'shipping']);

    for (const slug of LEGAL_DOCUMENT_SLUGS) {
      expect(getLegalDocument(slug)?.slug).toBe(slug);
    }
  });

  it('알 수 없는 슬러그는 null이다 — 라우트가 404로 떨어질 수 있어야 한다', () => {
    expect(getLegalDocument('unknown')).toBeNull();
    expect(getLegalDocument('')).toBeNull();
    expect(getLegalDocument('__proto__')).toBeNull();
    expect(getLegalDocument('constructor')).toBeNull();
  });

  it('문서마다 제목·시행일·조문을 갖는다', () => {
    for (const document of documents) {
      expect(document.title.length).toBeGreaterThan(0);
      expect(document.navLabel.length).toBeGreaterThan(0);
      expect(document.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(document.articles.length).toBeGreaterThan(3);

      for (const article of document.articles) {
        const hasBody = Boolean(
          article.paragraphs?.length || article.list?.length || article.table || article.closing?.length,
        );
        expect(hasBody, `${document.slug} · ${article.heading}`).toBe(true);
      }

      if (document.articles.some((article) => article.table)) {
        for (const article of document.articles) {
          if (!article.table) continue;
          for (const row of article.table.rows) {
            expect(row).toHaveLength(article.table.columns.length);
          }
        }
      }
    }
  });

  it('라우트 헬퍼가 공개 경로를 만든다', () => {
    expect(legalDocumentHref('terms')).toBe('/legal/terms');
    expect(legalDocumentHref('privacy')).toBe('/legal/privacy');
    expect(legalDocumentHref('shipping')).toBe('/legal/shipping');
  });

  /* /legal/* 은 로그인 없이 열리는 공개 화면이라 사용자-facing 금지 어휘가 그대로 적용된다.
     CONTEXT.md "Flagged ambiguities" — 가챠·뽑기·충전·확률·천장은 폐기된 유료 모델의 어휘다. */
  it('CONTEXT.md가 금지한 어휘를 본문에 쓰지 않는다', () => {
    for (const document of documents) {
      const text = plainText(document);
      for (const word of ['상품', '가챠', '뽑기', '확률', '충전', '천장']) {
        expect(text, `${document.slug} · ${word}`).not.toMatch(new RegExp(word));
      }
    }
  });

  it('시행일은 문서마다 따로 관리한다 — 하나만 개정해도 나머지가 따라 바뀌지 않는다', () => {
    expect(Object.keys(LEGAL_EFFECTIVE_DATES).sort()).toEqual([...LEGAL_DOCUMENT_SLUGS].sort());

    for (const slug of LEGAL_DOCUMENT_SLUGS) {
      expect(LEGAL_DOCUMENTS[slug].effectiveDate, slug).toBe(LEGAL_EFFECTIVE_DATES[slug]);
      /* 각 문서가 자기 슬러그의 시행일만 참조해야 개별 개정이 가능하다. */
      expect(source().match(new RegExp(`LEGAL_EFFECTIVE_DATES\\.${slug}`, 'g')), slug).toHaveLength(1);
    }

    expect(source(), '문서 셋이 시행일 상수 하나를 공유하면 개정 이력을 만들 수 없다').not.toMatch(/const EFFECTIVE_DATE\b/);
  });

  it('문의처 문장은 사업자 정보에서 파생된다 — 연락처가 비어 있으면 없는 창구를 가리키지 않는다 (#87)', () => {
    const contact = businessContactWords();
    const privacyText = plainText(LEGAL_DOCUMENTS.privacy);
    const shippingText = plainText(LEGAL_DOCUMENTS.shipping);
    const termsText = plainText(LEGAL_DOCUMENTS.terms);

    for (const text of [privacyText, shippingText, termsText]) {
      if (contact) {
        expect(text).toContain(contact);
      } else {
        expect(text).toContain('공개된 연락처가 없습니다');
        expect(text).not.toMatch(/사업자 정보에 표기된 (대표자와 )?연락처/);
      }
    }

    /* 연락처가 없는 동안에도 이용자가 실제로 쓸 수 있는 경로가 남아 있어야 한다. */
    expect(shippingText).toMatch(/주문 상세/);
    expect(privacyText).toMatch(/개인정보침해 신고센터/);
  });

  it('로그인 화면이 실제로 제공하는 소셜 로그인 제공자를 빠짐없이 기재한다 (#169)', () => {
    const text = [plainText(LEGAL_DOCUMENTS.privacy), plainText(LEGAL_DOCUMENTS.terms)].join('\n');

    for (const provider of Object.values(SOCIAL_LOGIN_PROVIDERS)) {
      expect(text, provider.label).toContain(provider.label);
    }

    const transfer = LEGAL_DOCUMENTS.privacy.articles.find((article) => article.heading.includes('국외'));
    const receivers = transfer!.table!.rows.map((row) => row[0]);
    for (const provider of overseasSocialLogins()) {
      expect(receivers, provider.label).toContain(provider.entity);
    }
  });
});

describe('이용약관', () => {
  const terms = LEGAL_DOCUMENTS.terms;
  const text = plainText(terms);

  it('무상 카드 리워드 모델을 약관에 고정한다', () => {
    expect(text).toMatch(/카드팩/);
    expect(text).toMatch(/무상/);
    expect(text).toMatch(/유상으로 판매하지 않습니다/);
  });

  /* 사용자-facing 공시 화면이 없다. 이행할 수 없는 공개 의무를 약관에 지지 않는다(ADR-0003·0004). */
  it('개봉 결과는 서버가 정한다고만 밝히고 공시 의무를 만들지 않는다', () => {
    const cardArticle = terms.articles.find((article) => article.heading.includes('카드팩'));

    expect(cardArticle?.paragraphs?.join('\n')).toMatch(/서버가 무작위로 결정/);
    expect(cardArticle?.paragraphs?.join('\n')).not.toMatch(/공개합니다/);
  });

  it('교환·마켓이 아직 제공되지 않는다는 사실을 밝힌다', () => {
    expect(text).toMatch(/교환/);
    expect(text).toMatch(/마켓/);
    expect(text).toMatch(/제공하지 않습니다/);
  });

  it('공급받은 날부터 7일 청약철회를 명시한다', () => {
    expect(text).toMatch(/공급받은 날부터 7일/);
  });
});

describe('개인정보처리방침', () => {
  const privacy = LEGAL_DOCUMENTS.privacy;
  const text = plainText(privacy);

  it('코드가 실제로 수집하는 항목을 기술한다', () => {
    for (const item of ['닉네임', '생년월일', '수령인', '우편번호', '주소', '동의']) {
      expect(text, item).toMatch(new RegExp(item));
    }
  });

  it('결제수단 인증정보를 보유하지 않는다는 사실을 밝힌다', () => {
    expect(text).toMatch(/저장하지 않습니다/);
  });

  it('처리위탁 목록에 실제 수탁자를 모두 담는다', () => {
    const consignment = privacy.articles.find((article) => article.heading.includes('위탁'));
    expect(consignment?.table).toBeDefined();

    const processors = consignment!.table!.rows.map((row) => row[0]);
    expect(processors).toEqual(
      expect.arrayContaining(['Supabase, Inc.', 'Vercel, Inc.', '토스페이먼츠 주식회사', '한진택배']),
    );
  });

  it('법인명을 모르는 WMS 운영사는 지어내지 않고 확인 중으로 남긴다 (#177 H7)', () => {
    const consignment = privacy.articles.find((article) => article.heading.includes('위탁'));
    const wmsRow = consignment!.table!.rows.find((row) => row.join(' ').includes('WMS'));

    expect(wmsRow?.[0]).toBe(PENDING_PROCESSOR_LABEL);
    expect(PENDING_PROCESSOR_LABEL).toBe('확인 중');
  });
});

describe('배송·반품 정책', () => {
  const shipping = LEGAL_DOCUMENTS.shipping;
  const text = plainText(shipping);

  it('확정된 배송비 정책값을 담는다 (계획 D5)', () => {
    expect(text).toMatch(/3,000원/);
    expect(text).toMatch(/50,000원 이상/);
  });

  it('반송비 부담 주체를 사유별로 나눈다', () => {
    expect(text).toMatch(/착불/);
    expect(text).toMatch(/회사가 부담/);
  });

  it('공급받은 날부터 7일 청약철회와 예외를 함께 안내한다', () => {
    expect(text).toMatch(/공급받은 날부터 7일/);
    expect(shipping.articles.some((article) => article.heading.includes('제한'))).toBe(true);
  });

  it('도서산간 추가요금은 확정 전이므로 별도 안내로 남긴다 (#177 H6)', () => {
    expect(text).toMatch(/도서산간/);
    expect(text).toMatch(/별도 안내/);
  });

  it('반품 주소는 확정 전이므로 승인 시 안내로 남긴다 (#177 H5)', () => {
    expect(text).toMatch(/반송 주소/);
  });
});
