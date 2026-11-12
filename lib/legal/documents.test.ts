import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUSINESS_INFO, businessContactWords } from './business-info';
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_SLUGS,
  LEGAL_EFFECTIVE_DATES,
  createLegalDocuments,
  getLegalDocument,
  legalDocumentHref,
  PENDING_PROCESSOR_LABEL,
  type LegalDocument,
} from './documents';
import { PRIVACY_ADDRESS_BOOK_REVISION, kstToday, koreanLegalDate } from './privacy-address-book-revision';
import {
  SHIPPING_BUNDLE_WORDING_REVISION,
  type ShippingBundleWordingRevision,
  shippingBundleWordingRevisionAnnounced,
  shippingBundleWordingRevisionInEffect,
} from './shipping-bundle-wording-revision';
import { SOCIAL_LOGIN_LABELS } from './social-login';

/** KST 달력 날짜(`YYYY-MM-DD`)를 하루 단위로 옮긴다. */
function shiftDay(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/* '출고지' 표기 예약 개정(1027T-010)은 날짜(KST)로 상태가 갈린다 — 공지 전날·공지일·시행 전날·시행일을 개정 상수에서 파생해
   고정한다(병합 때 날짜를 옮겨도 시험이 따라온다). LEGAL_DOCUMENTS(오늘 날짜)는 어느 상태든 성립해야 하는 검사에만 쓴다. */
/* 운영 상수(SHIPPING_BUNDLE_WORDING_REVISION)는 배포 직전에 날짜가 커밋되므로 시험은 주입한 날짜로 세 상태를 고정한다. */
const BUNDLE_REVISION: ShippingBundleWordingRevision = { announcedDate: '2026-11-20', effectiveDate: '2026-11-27' };
const { announcedDate: BUNDLE_ANNOUNCED, effectiveDate: BUNDLE_EFFECTIVE } = BUNDLE_REVISION;
const BEFORE_BUNDLE = createLegalDocuments(BUSINESS_INFO, shiftDay(BUNDLE_ANNOUNCED, -1), BUNDLE_REVISION);
const DURING_BUNDLE = createLegalDocuments(BUSINESS_INFO, BUNDLE_ANNOUNCED, BUNDLE_REVISION);
const LAST_NOTICE_DAY = createLegalDocuments(BUSINESS_INFO, shiftDay(BUNDLE_EFFECTIVE, -1), BUNDLE_REVISION);
const AFTER_BUNDLE = createLegalDocuments(BUSINESS_INFO, BUNDLE_EFFECTIVE, BUNDLE_REVISION);

const documents = [
  ...LEGAL_DOCUMENT_SLUGS.map((slug) => LEGAL_DOCUMENTS[slug]),
  ...[BEFORE_BUNDLE, DURING_BUNDLE, AFTER_BUNDLE].flatMap((set) => LEGAL_DOCUMENT_SLUGS.map((slug) => set[slug])),
];

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

  /* 서비스 공개(오픈) 전이라 실사용자가 없었다 — 세 문서는 개정 안내·이전 본문 없이 2026-11-06 최초 판 하나로 시작했다.
     오픈 뒤 개정부터는 약관 제3조·방침 제13조대로 사전 공지와 이전 본문 보존을 쓴다(아래 '출고지' 표기 개정이 첫 사례다). */
  it('공지 전에는 오픈 전 최초 판이다 — 세 문서 모두 2026-11-06 시행이고 사전 공지·개정 안내·이전 본문이 없다', () => {
    expect(Object.keys(LEGAL_EFFECTIVE_DATES).sort()).toEqual([...LEGAL_DOCUMENT_SLUGS].sort());

    for (const slug of LEGAL_DOCUMENT_SLUGS) {
      const document = BEFORE_BUNDLE[slug];
      expect(document.effectiveDate, slug).toBe('2026-11-06');
      expect(document.effectiveDate, slug).toBe(LEGAL_EFFECTIVE_DATES[slug]);
      expect(document.pendingRevision, slug).toBeUndefined();
      expect(document.revisionChanges, slug).toBeUndefined();
      expect(document.previousVersion, slug).toBeUndefined();
      /* 한 문서만 개정할 수 있도록 각 문서는 자기 슬러그의 시행일만 참조한다. */
      expect(source().match(new RegExp(`LEGAL_EFFECTIVE_DATES\\.${slug}`, 'g')), slug).toHaveLength(1);
    }

    expect(source(), '문서 셋이 시행일 상수 하나를 공유하면 개별 개정을 할 수 없다').not.toMatch(/const EFFECTIVE_DATE\b/);
  });

  /* 1027T-010 '전부 제거' — 개인정보처리방침에는 '출고지'가 없어 이 개정과 무관하다. 어느 상태에서도 최초 판 그대로다. */
  it('개인정보처리방침은 출고지 표기 개정과 무관하게 2026-11-06 최초 판 그대로다', () => {
    for (const set of [BEFORE_BUNDLE, DURING_BUNDLE, LAST_NOTICE_DAY, AFTER_BUNDLE]) {
      expect(set.privacy).toEqual(BEFORE_BUNDLE.privacy);
      expect(plainText(set.privacy)).not.toContain('출고지');
    }
  });

  /* 약관 제3조·방침 제13조 — 적용일자 7일 전부터 현행 본문과 함께 공지한다. 날짜는 병합·배포 때 정하지만 간격은 여기서 지킨다. */
  it("'출고지' 표기 개정은 시행 7일 전 이상부터 공지하고, 공지 기간에는 현행 본문을 바꾸지 않는다", () => {
    const days = (Date.parse(`${BUNDLE_EFFECTIVE}T00:00:00+09:00`) - Date.parse(`${BUNDLE_ANNOUNCED}T00:00:00+09:00`)) / 86_400_000;
    expect(days, '시행 7일 전부터 공지').toBeGreaterThanOrEqual(7);
    /* 오픈 전 최초 판(2026-11-06) 뒤의 개정이다 — 최초 판보다 앞선 날짜를 공지일로 쓰지 않는다. */
    expect(BUNDLE_ANNOUNCED >= LEGAL_EFFECTIVE_DATES.terms && BUNDLE_ANNOUNCED >= LEGAL_EFFECTIVE_DATES.shipping).toBe(true);

    for (const set of [DURING_BUNDLE, LAST_NOTICE_DAY]) {
      for (const slug of ['terms', 'shipping'] as const) {
        const during = set[slug];
        /* 공지 기간의 현행 본문·시행일은 공지 전과 같다 — 사전 공지만 붙는다. */
        expect(during.articles, slug).toEqual(BEFORE_BUNDLE[slug].articles);
        expect(during.effectiveDate, slug).toBe('2026-11-06');
        expect(during.previousVersion, slug).toBeUndefined();
        expect(during.revisionChanges, slug).toBeUndefined();
        expect(during.pendingRevision, slug).toMatchObject({
          announcedDate: BUNDLE_ANNOUNCED,
          effectiveDate: BUNDLE_EFFECTIVE,
          heading: '배송 단위 표기(배송 묶음) 통일에 따른 개정 예정 안내',
        });
        const notice = during.pendingRevision!.changes.join('\n');
        expect(notice, slug).toContain('개정 사유');
        expect(notice, slug).toContain("'배송 묶음");
        expect(notice, slug).toContain('바뀌지 않습니다');
      }
    }
    expect(DURING_BUNDLE.terms.pendingRevision!.changes.join('\n')).toContain('제16조의2(반품과 교환)');
    expect(DURING_BUNDLE.shipping.pendingRevision!.changes.join('\n')).toContain('1. 배송 안내');
  });

  /* 시행일부터 바뀐 본문이 현행이 되고, 직전 공개 본문을 이전 판으로 그대로 남긴다(약관 제3조 개정 이력). */
  it("'출고지' 표기 개정은 시행일부터 본문에서 출고지를 배송 묶음으로 바꾸고 직전 본문을 이전 판으로 보존한다", () => {
    for (const slug of ['terms', 'shipping'] as const) {
      const before = BEFORE_BUNDLE[slug];
      const after = AFTER_BUNDLE[slug];
      expect(plainText(before), slug).toContain('출고지별');
      expect(plainText(after), slug).not.toContain('출고지');
      expect(plainText(after), slug).toContain('배송 묶음별');
      expect(after.effectiveDate, slug).toBe(BUNDLE_EFFECTIVE);
      expect(after.pendingRevision, slug).toBeUndefined();
      expect(after.previousVersion, slug).toEqual({ effectiveDate: '2026-11-06', articles: before.articles });
      expect(after.revisionChanges?.length, slug).toBeGreaterThan(0);
      for (const change of after.revisionChanges!) expect(DURING_BUNDLE[slug].pendingRevision!.changes, slug).toContain(change);
      /* 표기 말고는 바뀌지 않는다 — 조문 제목·수·표 머리글이 그대로다. */
      expect(after.articles.map((article) => article.heading), slug).toEqual(before.articles.map((article) => article.heading));
      expect(after.articles.map((article) => article.table?.columns ?? null), slug).toEqual(before.articles.map((article) => article.table?.columns ?? null));
    }

    const shippingRows = AFTER_BUNDLE.shipping.articles[0]!.table!.rows;
    expect(shippingRows).toContainEqual(['배송 방법', '배송 묶음별 지정 택배사']);
    expect(shippingRows.find(([label]) => label === '기본 배송비')?.[1]).toBe(
      '굿즈 상세와 주문 화면에 표시된 배송 묶음별 배송 정책에 따릅니다. 배송 묶음이 다르면 배송비를 각각 더합니다.',
    );
    expect(shippingRows.find(([label]) => label === '무료 배송 조건')?.[1]).toMatch(/^같은 배송 묶음의 정책 적용 굿즈 할인 전 소계로 확인합니다/);
    const procedure = AFTER_BUNDLE.shipping.articles.find((article) => article.heading.startsWith('6. '))!.list!.join('\n');
    expect(procedure).toContain('배송 묶음별 반송 주소와 회수 방법을 안내합니다');
    expect(procedure).toContain('배송 묶음별 반송 대상 굿즈와 수량의 실제 입고를 확인합니다');
    expect(AFTER_BUNDLE.terms.articles.find((article) => article.heading.startsWith('제16조의2 '))!.paragraphs![0])
      .toContain('환급·재배송은 배송 묶음별 실물 회수를 모두 확인한 뒤 진행합니다.');
  });

  it("'출고지' 표기 개정의 공지·시행은 한국 시간 날짜로 가른다", () => {
    expect(shippingBundleWordingRevisionAnnounced(shiftDay(BUNDLE_ANNOUNCED, -1), BUNDLE_REVISION)).toBe(false);
    expect(shippingBundleWordingRevisionAnnounced(BUNDLE_ANNOUNCED, BUNDLE_REVISION)).toBe(true);
    expect(shippingBundleWordingRevisionAnnounced(shiftDay(BUNDLE_EFFECTIVE, -1), BUNDLE_REVISION)).toBe(true);
    expect(shippingBundleWordingRevisionAnnounced(BUNDLE_EFFECTIVE, BUNDLE_REVISION)).toBe(false);
    expect(shippingBundleWordingRevisionInEffect(shiftDay(BUNDLE_EFFECTIVE, -1), BUNDLE_REVISION)).toBe(false);
    expect(shippingBundleWordingRevisionInEffect(BUNDLE_EFFECTIVE, BUNDLE_REVISION)).toBe(true);
    /* 시행일 0시(KST)는 전날 15:00 UTC다. */
    expect(kstToday(new Date(`${shiftDay(BUNDLE_EFFECTIVE, -1)}T14:59:59Z`))).toBe(shiftDay(BUNDLE_EFFECTIVE, -1));
    expect(kstToday(new Date(`${shiftDay(BUNDLE_EFFECTIVE, -1)}T15:00:00Z`))).toBe(BUNDLE_EFFECTIVE);
  });

  /* 예약 없음(null)이 기본이다 — 공지·개정이 모두 꺼져 어느 날짜에도 현행 본문 그대로다. 운영 날짜는 배포 직전에 커밋한다. */
  it("'출고지' 표기 개정 예약이 없으면(null) 어느 날짜에도 공지·개정 없이 현행 본문 그대로다", () => {
    expect(shippingBundleWordingRevisionAnnounced('2026-12-31', null)).toBe(false);
    expect(shippingBundleWordingRevisionInEffect('2099-01-01', null)).toBe(false);
    for (const today of ['2026-11-20', '2026-12-31', '2099-01-01']) {
      const set = createLegalDocuments(BUSINESS_INFO, today, null);
      for (const slug of ['terms', 'shipping'] as const) {
        expect(set[slug].pendingRevision, `${slug} ${today}`).toBeUndefined();
        expect(set[slug].previousVersion, `${slug} ${today}`).toBeUndefined();
        expect(set[slug].revisionChanges, `${slug} ${today}`).toBeUndefined();
        expect(set[slug], `${slug} ${today}`).toEqual(BEFORE_BUNDLE[slug]);
        expect(plainText(set[slug])).toContain('출고지별');
      }
    }
  });

  it('운영 상수에 날짜가 들어 있으면 시행일은 공지일 + 7일 이상이고 최초 판 뒤다', () => {
    if (SHIPPING_BUNDLE_WORDING_REVISION === null) return;
    const { announcedDate, effectiveDate } = SHIPPING_BUNDLE_WORDING_REVISION;
    const days = (Date.parse(`${effectiveDate}T00:00:00+09:00`) - Date.parse(`${announcedDate}T00:00:00+09:00`)) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(7);
    expect(announcedDate >= LEGAL_EFFECTIVE_DATES.terms).toBe(true);
  });

  it('오픈 전에 없던 과거 결제·개정 이력을 본문에 남기지 않는다', () => {
    for (const document of documents) {
      const text = plainText(document);
      for (const word of ['코페이', '2026년 8월 21일', '이전 정책', '개정 전']) {
        expect(text, `${document.slug} · ${word}`).not.toContain(word);
      }
    }
  });

  it('주소록은 처리방침이 고지하는 날(최초 판 시행일)부터 열리고, 시행일은 한국 시간 날짜로 센다', () => {
    expect(PRIVACY_ADDRESS_BOOK_REVISION.effectiveDate).toBe(LEGAL_EFFECTIVE_DATES.privacy);
    expect(kstToday(new Date('2026-11-05T14:59:59Z'))).toBe('2026-11-05');
    expect(kstToday(new Date('2026-11-05T15:00:00Z'))).toBe('2026-11-06');
    expect(koreanLegalDate('2026-11-06')).toBe('2026년 11월 6일');
  });

  /* 결제대행사는 서버가 주문 단위로 정한다(ADR-0013) — 기본 토스페이먼츠, 19금 굿즈 주문의 카드 결제만 나이스페이. */
  it('지급방법과 처리위탁이 실제 결제대행사(토스페이먼츠 기본, 19금 굿즈 주문은 나이스정보통신)를 밝힌다', () => {
    const termsPayment = LEGAL_DOCUMENTS.terms.articles
      .find((article) => article.heading.includes('지급방법'))!
      .paragraphs!.join('\n');
    expect(termsPayment).toMatch(/굿즈와 티켓 대금은 결제대행사인 토스페이먼츠 주식회사를 통해/);
    expect(termsPayment).toMatch(/19금 굿즈가 담긴 주문의 카드 대금은 결제대행사인 나이스정보통신 주식회사를 통해/);

    const processorRows = LEGAL_DOCUMENTS.privacy.articles
      .find((article) => article.heading.includes('위탁'))!
      .table!.rows;
    const processors = new Map(processorRows.map((row) => [row[0], row.join(' ')]));
    for (const operation of ['결제 처리', '취소', '환급']) {
      expect(processors.get('토스페이먼츠 주식회사'), operation).toContain(operation);
      expect(processors.get('나이스정보통신 주식회사'), operation).toContain(operation);
    }
    expect(processors.get('나이스정보통신 주식회사')).toContain('19금 굿즈');
    expect([...processors.keys()].join(' ')).not.toMatch(/코페이/);
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
        /* 공개 연락처는 여전히 #239가 확정한다. 다만 "창구가 없다"고 쓰면 거짓이다 —
           인앱 1:1 문의(#253)가 실제로 열려 있는 접수 경로다. */
        expect(text).toMatch(/공개 문의 연락처는 사업자 등록 절차가 끝나는 대로/);
        expect(text).not.toMatch(/사업자 정보에 표기된 (대표자와 )?연락처/);
        expect(text).not.toMatch(/공개된 연락처가 없습니다/);
      }
      expect(text).toContain('1:1 문의(/my/inquiries)');
    }

    /* 연락처가 없는 동안에도 이용자가 실제로 쓸 수 있는 경로가 남아 있어야 한다. */
    expect(shippingText).toMatch(/주문 상세/);
    expect(privacyText).toMatch(/개인정보침해 신고센터/);
  });

  it('로그인 화면이 실제로 제공하는 소셜 로그인 제공자를 빠짐없이 기재한다 (#169)', () => {
    const text = [plainText(LEGAL_DOCUMENTS.privacy), plainText(LEGAL_DOCUMENTS.terms)].join('\n');

    for (const label of Object.values(SOCIAL_LOGIN_LABELS)) {
      expect(text, label).toContain(label);
    }
  });
});

describe('승인된 배송 중 접수 정책과 고객지원 안내', () => {
  it.each([
    { phone: '', email: '' },
    { phone: '000-0000-0000', email: 'policy@example.test' },
  ])('연락처 $email 유무와 관계없이 의사표시 통로와 전체 배송 조건을 안내한다', (contact) => {
    const shipping = getLegalDocument('shipping', { ...BUSINESS_INFO, ...contact })!;
    const text = plainText(shipping);
    expect(text).toContain('직접 취소 신청은 발주확인 전까지');
    expect(text).toContain('배송 중부터 주문 전체');
    expect(text).toContain('의사표시와 최초 접수 시각');
    expect(text).toContain('1:1 문의(/my/inquiries)');
    expect(text).toContain('문의 접수만으로 환급이 승인되거나');
    /* 표기('출고지별'→'배송 묶음별', 1027T-010)는 개정 시행일로 바뀐다 — 오늘 날짜와 무관한 공통 부분만 본다. */
    expect(text).toContain('반송 대상 굿즈와 수량의 실제 입고');
    expect(text).toContain('교환품 전체의 실제 배송 완료');
    expect(text).toContain('기존 신청 기한이 자동으로 연장되지는 않습니다');
    expect(text).not.toContain('취소는 발송 전');
    expect(text).not.toContain('문의는 질문과 답변을 주고받는 창구이며 청약철회 접수를 대신하지 않습니다');
    if (!contact.email) expect(text).toContain('공개 문의 연락처는 사업자 등록 절차가 끝나는 대로');
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

  /*
   * 사용자-facing 공시 화면이 없다. 이행할 수 없는 공개 의무를 약관에 지지 않는다(ADR-0003·0004).
   * 동시에 결제가 카드팩을 무상 지급할 수 있다는 사실(confirm_order_payment의 order_paid 트리거)을
   * 부정하지 않는다 — "대금 지급 경로가 없다"고 쓰면 실제 동작과 정반대가 된다.
   * 발급 후 구성 변경(ADR-0004)도 고지 대상이다.
   */
  it('개봉 결과의 결정 주체와 무상 지급 조건을 사실대로 밝힌다', () => {
    const cardArticle = terms.articles.find((article) => article.heading.includes('카드팩'));
    const body = cardArticle?.paragraphs?.join('\n') ?? '';

    expect(body).toMatch(/서버가 결정/);
    expect(body).toMatch(/판매하지 않습니다/);
    expect(body).toMatch(/조건을 충족하면 카드팩이 대가 없이 지급될 수 있습니다/);
    expect(body).toMatch(/개봉 시점의 구성/);
    expect(body).not.toMatch(/공개합니다/);
    expect(body).not.toMatch(/영향을 줄 수 있는 경로는 없습니다/);
  });

  it('교환·마켓이 아직 제공되지 않는다는 사실을 밝힌다', () => {
    expect(text).toMatch(/교환/);
    expect(text).toMatch(/마켓/);
    expect(text).toMatch(/제공하지 않습니다/);
  });

  it('공급받은 날부터 7일 청약철회를 명시한다', () => {
    expect(text).toMatch(/공급받은 날부터 7일/);
  });

  /*
   * finalize_order_cancellation_with_provider_evidence가 source='order_paid' ·
   * consumed_at is null인 카드팩에 revoked_at을 찍어 회수한다. 회수 사실을 약관이
   * 밝히지 않으면 이용자는 /packs에서 사라진 카드팩의 근거를 어디서도 찾을 수 없다.
   */
  it('청약철회 시 미개봉 카드팩이 회수된다는 사실을 밝힌다', () => {
    const cardArticle = terms.articles.find((article) => article.heading.includes('카드팩'));
    const body = cardArticle?.paragraphs?.join('\n') ?? '';

    expect(body).toMatch(/청약철회가 처리되면 회수/);
    expect(body).toMatch(/개봉하지 않은 카드팩/);
    /* 이미 개봉한 카드팩과 그 카드는 보존된다(ADR-0003·0004). 반대로 적으면 사실과 어긋난다. */
    expect(body).toMatch(/이미 개봉해 카드를 받은 카드팩과 그 카드는 회수하지 않습니다/);
    /* 만료되지 않는다는 문장이 회수 고지와 충돌하지 않아야 한다. */
    expect(body).toMatch(/시간이 지나 만료되지 않으며/);
  });

  /* #188 · ADR-0009 — 게이트가 생겼다. 앱 폼과 profiles 트리거가 만 14세 미만 생년월일
     저장을 거부하므로, 문서가 계속 "차단하지 않는다"고 말하면 실제 동작과 정반대가 된다. */
  it('만 14세 가입 게이트를 회원가입 조문에 밝힌다', () => {
    const signup = terms.articles.find((article) => article.heading.includes('회원가입'));
    const closing = signup!.closing!.join('\n');

    expect(closing).toMatch(/만 14세 미만인 경우 회원가입을 완료할 수 없습니다/);
    expect(closing).toMatch(/법정대리인의 동의를 통한 가입 경로는 제공하지 않습니다/);
    expect(closing).not.toMatch(/자동 검증해 가입을 차단하지 않습니다/);
    /* 판정 기준 시간대가 문서에 있어야 이용자가 경계일 결과를 예측할 수 있다. */
    expect(closing).toMatch(/한국 표준시/);
  });

  /* /my에도 /settings에도 탈퇴 컨트롤이 없고 계정 삭제 액션·RPC도 없다(#102·#137).
     "즉시 처리합니다"는 이용자가 찾을 수 없는 기능을 가리키는 고지다. */
  it('탈퇴는 실제로 열려 있는 경로만 가리킨다', () => {
    const withdrawal = terms.articles.find((article) => article.heading.includes('회원 탈퇴'));
    const body = withdrawal!.paragraphs!.join('\n');

    expect(body).not.toMatch(/회사는 즉시 탈퇴를 처리합니다/);
    expect(body).toMatch(/직접 탈퇴를 실행하는 기능은 아직 없/);
    if (businessContactWords()) {
      expect(body).toContain(businessContactWords());
    }
    /* 연락처 공개 여부와 무관하게, 지금 열려 있는 접수 경로를 가리켜야 한다(#253). */
    expect(body).toMatch(/1:1 문의\(\/my\/inquiries\)/);
    expect(body).toMatch(/탈퇴 요청은/);
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

  /* 주소록(L7 · MY-11) — 주문 배송지와 별개로 회원이 저장하는 배송지라 수집 시점·목적·보유 기간·자가 열람 경로를 따로 적는다. */
  it('주소록의 수집 항목·시점·목적·보유 기간·자가 열람 경로를 밝힌다', () => {
    const article = (prefix: string) => privacy.articles.find((item) => item.heading.startsWith(prefix))!;
    const rows = article('제1조 ').table!.rows;
    const order = rows.findIndex((row) => row[0] === '굿즈 주문·배송');
    expect(rows[order + 1]?.[0]).toBe('주소록 (선택)');
    expect(rows[order + 1]?.[1]).toBe('배송지 이름, 받는 분 이름, 연락처, 우편번호, 주소');
    expect(rows[order + 1]?.[2]).toMatch(/배송지를 저장한 경우/);
    /* 주문 배송지 행은 그대로다 — 주소록은 주문에 저장되는 배송지를 대신하지 않는다. */
    expect(rows[order]).toEqual(['굿즈 주문·배송', '수령인 이름, 연락처, 우편번호, 주소, 배송 요청사항', '주문 시']);
    expect(article('제2조 ').list!.join('\n')).toMatch(/주소록\)를 주문서에 불러오는/);
    expect(article('제3조 ').closing!.join('\n')).toMatch(/주소록에 저장한 배송지는 회원이 배송지 관리에서 언제든 직접 삭제할 수 있으며, 회사가 회원 탈퇴를 처리하면 지체 없이 파기합니다/);
    expect(article('제3조 ').closing!.join('\n')).toMatch(/이미 한 주문의 배송지는 주문 정보의 일부로/);
    expect(article('제7조 ').paragraphs!.join('\n')).toContain('배송지 관리(/my/addresses)에서 직접 열람·수정·삭제');
  });

  /* 성인 인증(ADR-0024) — 본인확인기관 결과 원문은 판정에만 쓰고, 회사는 인증 여부·기간과 복원 불가 다이제스트만 보관한다. */
  it('성인 인증의 수집 항목·목적·보관 항목·유효기간·수탁자를 밝힌다', () => {
    const article = (prefix: string) => privacy.articles.find((item) => item.heading.startsWith(prefix))!;
    const rows = article('제1조 ').table!.rows;
    const row = rows[rows.findIndex((item) => item[0] === '온보딩') + 1];
    expect(row?.[0]).toBe('성인 인증 (휴대폰 본인확인)');
    expect(row?.[1]).toMatch(/연계정보\(CI\), 중복가입확인정보\(DI\)/);
    expect(row?.[1]).toMatch(/19세 이상 여부 판정에만 쓰고 저장하지 않으며/);
    expect(row?.[2]).toMatch(/성인 인증을 진행한 경우/);
    expect(article('제2조 ').list!.join('\n')).toMatch(/청소년 보호법에 따른 19세 이상 여부 확인/);
    expect(article('제3조 ').closing!.join('\n')).toMatch(/성인 인증 기록의 유효기간은 인증일부터 1년/);
    expect(article('제5조 ').table!.rows).toContainEqual(
      ['엔에이치엔케이씨피 주식회사', '휴대폰 본인확인(성인 인증) 서비스 제공', '위탁계약 종료 시까지'],
    );
  });

  it('선택 성별 수집의 목적·항목·보관·철회를 별도 조로 밝힌다', () => {
    const article = privacy.articles.find((item) => item.heading.startsWith('제2조의2 '));
    expect(article?.heading).toBe('제2조의2 (성별 정보의 선택 수집·이용)');
    expect(JSON.stringify(privacy.articles)).toContain('10명 이상');
    expect(privacy.articles[0]!.table!.rows.map((row) => row[0])).toContain('성별·연령 고객 통계 (선택)');
  });

  it('결제수단 인증정보를 보유하지 않는다는 사실을 밝힌다', () => {
    expect(text).toMatch(/저장하지 않습니다/);
  });

  it('처리위탁 목록에 실제 수탁자를 모두 담는다', () => {
    const consignment = privacy.articles.find((article) => article.heading.includes('위탁'));
    expect(consignment?.table).toBeDefined();

    const processors = consignment!.table!.rows.map((row) => row[0]);
    expect(processors).toEqual(
      expect.arrayContaining([
        'Supabase, Inc.', 'Vercel, Inc.', '토스페이먼츠 주식회사', '나이스정보통신 주식회사', '엔에이치엔케이씨피 주식회사', '한진택배', 'Resend',
      ]),
    );
  });

  /*
   * 주문 확인 메일은 lib/email/templates.ts의 addressLines()가 만든 배송지 전체를 담고
   * lib/email/provider.server.ts가 기본 엔드포인트(api.resend.com, 미국)로 POST한다.
   * 전송 코드 경로가 있는 수탁자를 표에서 빠뜨리면 위탁·국외이전 고지가 사실과 어긋난다.
   */
  it('트랜잭션 이메일 provider를 위탁·국외이전 표에 함께 담는다', () => {
    const consignment = privacy.articles.find((article) => article.heading.includes('위탁'));
    const transfer = privacy.articles.find((article) => article.heading.includes('국외'));

    expect(consignment!.table!.rows.map((row) => row[0])).toContain('Resend');
    expect(transfer!.table!.rows.map((row) => row[0])).toContain('Resend');

    const emailTransfer = transfer!.table!.rows.find((row) => row[0] === 'Resend')!;
    expect(emailTransfer[1]).toBe('미국');
    for (const item of ['이메일 주소', '수령인 이름', '우편번호', '주소']) {
      expect(emailTransfer[2], item).toContain(item);
    }
  });

  it('법인명을 모르는 WMS 운영사는 지어내지 않고 확인 중으로 남긴다 (#177 H7)', () => {
    const consignment = privacy.articles.find((article) => article.heading.includes('위탁'));
    const wmsRow = consignment!.table!.rows.find((row) => row.join(' ').includes('WMS'));

    expect(wmsRow?.[0]).toBe(PENDING_PROCESSOR_LABEL);
    expect(PENDING_PROCESSOR_LABEL).toBe('확인 중');
  });

  /*
   * signInWithSocialAction은 supabase.auth.signInWithOAuth로 만든 인가 요청 URL로 redirect할 뿐이다.
   * 계정 식별자와 이메일은 제공자가 Supabase로 보내오는 값이라 방향이 반대다 —
   * 제공자를 이전받는 자로 적으면 감사에서 제시할 전송 코드 경로가 없다.
   */
  it('국외 이전 표에 실제 전송 경로만 적는다 — 소셜 로그인 제공자는 이전받는 자가 아니다', () => {
    const transfer = privacy.articles.find((article) => article.heading.includes('국외'));
    const receivers = transfer!.table!.rows.map((row) => row[0]);

    expect(receivers).toEqual(['Supabase, Inc.', 'Vercel, Inc.', 'Resend']);
    for (const entity of ['Google LLC', 'Apple Inc.', '카카오']) {
      expect(receivers, entity).not.toContain(entity);
    }

    /* 제공자가 표에서 빠진 이유는 로그인이 없어서가 아니라 방향이 반대여서다. */
    const closing = transfer!.closing?.join('\n') ?? '';
    expect(closing).toMatch(/이전하는 개인정보는 없습니다/);
    expect(closing).toMatch(/Supabase, Inc\. 행의 이전 항목에 포함/);
  });

  /*
   * 설정 화면(app/settings/actions.ts)은 nickname·avatarPath·marketing만 읽는다.
   * 생년월일 입력 필드가 없는데도 방침이 설정 화면을 정정 경로로 가리키면,
   * 문의 연락처가 비어 있는 지금 이용자에게 존재하지 않는 경로를 안내하게 된다.
   */
  it('자가 정정 경로로 설정 화면이 실제로 여는 항목만 안내한다', () => {
    const rights = privacy.articles.find((article) => article.heading.includes('정보주체의 권리'));
    const paragraphs = rights!.paragraphs!;
    const selfService = paragraphs.find((paragraph) => paragraph.includes('설정 화면에서 직접 열람·수정'));

    expect(selfService).toBeDefined();
    expect(selfService).toContain('닉네임');
    expect(selfService, '설정 화면에 생년월일 입력 필드가 없다').not.toMatch(/생년월일/);
    expect(paragraphs.join('\n')).toMatch(/생년월일은 설정 화면에서 수정할 수 없습니다/);

    const contact = privacy.articles.find((article) => article.heading.includes('문의처'));
    const contactText = contact!.paragraphs!.join('\n');
    if (!businessContactWords()) {
      /* 연락처가 없는 동안 "개인정보를" 통째로 정정할 수 있다고 안내하면 안 된다. */
      expect(contactText).not.toMatch(/개인정보를 직접 열람·정정/);
      expect(contactText).toContain('닉네임');
    }
  });

  /*
   * #188 · ADR-0009 — 게이트가 생겼으므로 "수집하지 않습니다"가 사실이 됐다.
   * 다만 게이트가 있어도 우회 가입이 드러날 수 있으므로 사후 정지·파기 절차는 남긴다.
   */
  it('만 14세 미만 처리 고지가 실제 게이트와 일치한다', () => {
    const rights = privacy.articles.find((article) => article.heading.includes('정보주체의 권리'));
    const body = rights!.paragraphs!.join('\n');

    expect(body).toMatch(/만 14세 미만 아동의 개인정보를 수집하지 않습니다/);
    expect(body).not.toMatch(/차단하지는 않으므로/);
    expect(body).toMatch(/알게 된 경우/);
  });

  it('삭제·처리정지 요구를 약관 제7조의 탈퇴 경로로 연결한다', () => {
    const rights = privacy.articles.find((article) => article.heading.includes('정보주체의 권리'));
    const body = rights!.paragraphs!.join('\n');

    expect(body).toMatch(/이용약관 제7조의 탈퇴 요청/);
    expect(body).toMatch(/직접 탈퇴를 실행하는 기능은 아직 없/);
  });
});

describe('배송·반품 정책', () => {
  /* 시행일 뒤의 현행 본문('배송 묶음' 표기)을 본다 — 바뀐 것은 표기뿐이라 나머지 검사는 개정 전 본문에도 그대로 성립한다. */
  const shipping = AFTER_BUNDLE.shipping;
  const text = plainText(shipping);

  it('배송 묶음별 DB 정책 안내와 합산 기준을 설명하고 고정 금액을 복제하지 않는다', () => {
    expect(text).toContain('배송 묶음별');
    expect(text).not.toContain('출고지');
    expect(text).toContain('할인 전');
    expect(text).toContain('굿즈당 한 번');
    expect(text).not.toContain('3,000원');
    expect(text).not.toContain('50,000원 이상');
  });

  /* 주문 상세의 청약철회는 주문 단위 하나뿐이고, cancelTossPayment가 cancelAmount 없이
     전액을 취소한다. 부분 환불은 계획 §6의 명시적 제외 항목이다 — 문서가 약속하면 안 된다. */
  it('부분 환급을 약속하지 않고 주문 단위 전액 취소만 안내한다', () => {
    expect(text).not.toMatch(/일부만 반품하는 경우 반품 대상 굿즈의 대금을 기준으로 환급/);
    expect(text).toMatch(/청약철회는 주문 단위로만 신청할 수 있습니다/);
    expect(text).toMatch(/결제금액 전액이 취소/);
    /* 일부만 반송하려는 이용자에게 실제로 할 수 있는 행동을 남긴다. */
    expect(text).toMatch(/일부만 반송하고 싶다면/);
  });

  it('시스템이 하지 않는 배송비 공제를 고지하지 않는다', () => {
    expect(text).not.toMatch(/공제될 수 있습니다/);
    expect(text).toMatch(/공제하지 않습니다/);
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

it("설정 연락처 변경을 모든 법정 문서에 반영한다",()=>{for(const slug of LEGAL_DOCUMENT_SLUGS){const rendered=JSON.stringify(getLegalDocument(slug,{...BUSINESS_INFO,phone:"",email:"current@example.test"}));expect(rendered).toContain("current@example.test");expect(rendered).not.toContain(BUSINESS_INFO.phone);}});
