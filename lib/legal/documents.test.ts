import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
import { PRIVACY_ADDRESS_BOOK_REVISION, kstToday, koreanLegalDate, privacyAddressBookRevisionInEffect } from './privacy-address-book-revision';
import { SOCIAL_LOGIN_LABELS } from './social-login';

/* 주소록 예약 개정(L7 · MY-11)은 날짜(KST)로 시행 여부가 갈린다 — 시행 전날과 시행일 두 상태를 고정해 검사한다.
   LEGAL_DOCUMENTS(오늘 날짜)는 어느 쪽이든 성립해야 하는 검사에만 쓴다. */
const BEFORE_ADDRESS_BOOK = createLegalDocuments(BUSINESS_INFO, '2026-11-05');
const AFTER_ADDRESS_BOOK = createLegalDocuments(BUSINESS_INFO, PRIVACY_ADDRESS_BOOK_REVISION.effectiveDate);
const documents = [
  ...LEGAL_DOCUMENT_SLUGS.map((slug) => LEGAL_DOCUMENTS[slug]),
  BEFORE_ADDRESS_BOOK.privacy,
  AFTER_ADDRESS_BOOK.privacy,
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

  it('시행일은 문서마다 따로 관리한다 — 하나만 개정해도 나머지가 따라 바뀌지 않는다', () => {
    expect(Object.keys(LEGAL_EFFECTIVE_DATES).sort()).toEqual([...LEGAL_DOCUMENT_SLUGS].sort());

    for (const slug of LEGAL_DOCUMENT_SLUGS) {
      expect(BEFORE_ADDRESS_BOOK[slug].effectiveDate, slug).toBe(LEGAL_EFFECTIVE_DATES[slug]);
      /* 주소록 예약 개정은 개인정보처리방침의 시행일만 옮긴다. */
      expect(AFTER_ADDRESS_BOOK[slug].effectiveDate, slug).toBe(
        slug === 'privacy' ? PRIVACY_ADDRESS_BOOK_REVISION.effectiveDate : LEGAL_EFFECTIVE_DATES[slug],
      );
      /* 각 문서가 자기 슬러그의 시행일만 참조해야 개별 개정이 가능하다. */
      expect(source().match(new RegExp(`LEGAL_EFFECTIVE_DATES\\.${slug}`, 'g')), slug).toHaveLength(1);
    }

    expect(source(), '문서 셋이 시행일 상수 하나를 공유하면 개정 이력을 만들 수 없다').not.toMatch(/const EFFECTIVE_DATE\b/);
  });

  it('신청 안내·선택 성별 수집의 개정일을 문서별로 보존한다', () => {
    for (const set of [BEFORE_ADDRESS_BOOK, AFTER_ADDRESS_BOOK]) {
      expect(set.terms.effectiveDate).toBe('2026-09-09');
      expect(set.shipping.effectiveDate).toBe('2026-09-09');
      expect(set.terms.pendingRevision).toBeUndefined();
      expect(set.shipping.pendingRevision).toBeUndefined();
    }
    /* 지금 효력이 있는 개인정보처리방침은 선택 성별 수집을 더한 2026-10-19 본문이다. */
    const privacy = BEFORE_ADDRESS_BOOK.privacy;
    expect(privacy.effectiveDate).toBe('2026-10-19');
    expect(privacy.previousVersion?.effectiveDate).toBe('2026-08-22');
    expect(JSON.stringify(privacy.previousVersion)).not.toContain('성별 정보의 선택');
    expect(JSON.stringify(privacy.articles)).toContain('10명 이상');
  });

  /* 주소록 개정(L7 · MY-11) — 제13조대로 시행 7일 전부터 사전 공지하고, 시행일 전에는 현행 본문을 바꾸지 않는다(L7 QA). */
  it('주소록 개정은 시행일 전까지 현행 본문에 사전 공지로만 붙고, 시행일부터 개정 본문이 현행이 된다', () => {
    const { announcedDate, effectiveDate } = PRIVACY_ADDRESS_BOOK_REVISION;
    const days = (Date.parse(`${effectiveDate}T00:00:00+09:00`) - Date.parse(`${announcedDate}T00:00:00+09:00`)) / 86_400_000;
    expect(days, '시행 7일 전부터 공지').toBeGreaterThanOrEqual(7);

    const before = BEFORE_ADDRESS_BOOK.privacy;
    expect(before.effectiveDate).toBe('2026-10-19');
    expect(before.pendingRevision).toEqual({
      announcedDate,
      effectiveDate,
      heading: '주소록(배송지 관리) 도입에 따른 개정 예정 안내',
      changes: expect.arrayContaining([expect.stringContaining('주소록(배송지 관리)에 저장하는')]),
    });
    expect(before.pendingRevision!.changes.join('\n')).toContain('개정 방침이 시행되는 날부터 이용할 수 있습니다');
    expect(JSON.stringify(before.articles), '시행 전 현행 본문에는 주소록이 없다').not.toContain('주소록');
    expect(before.revisionChanges?.join('\n')).not.toContain('주소록');

    const after = AFTER_ADDRESS_BOOK.privacy;
    expect(after.effectiveDate).toBe(effectiveDate);
    expect(after.pendingRevision).toBeUndefined();
    /* 직전 공개 본문(2026-10-19, 선택 성별 수집 포함)을 이전 판으로 그대로 보존한다. */
    expect(after.previousVersion).toEqual({ effectiveDate: '2026-10-19', articles: before.articles });
    expect(JSON.stringify(after.articles)).toContain('주소록');
    expect(JSON.stringify(after.articles)).toContain('10명 이상');
    expect(after.revisionChanges?.join('\n')).toContain('주소록');
    /* 사전 공지한 변경 내용이 시행일의 개정 안내와 같다. */
    for (const change of after.revisionChanges!) expect(before.pendingRevision!.changes).toContain(change);
  });

  it('시행 여부는 한국 시간 날짜로 가른다 — 시행일 0시(KST)부터 개정 본문이다', () => {
    expect(kstToday(new Date('2026-11-05T14:59:59Z'))).toBe('2026-11-05');
    expect(kstToday(new Date('2026-11-05T15:00:00Z'))).toBe('2026-11-06');
    expect(privacyAddressBookRevisionInEffect('2026-11-05')).toBe(false);
    expect(privacyAddressBookRevisionInEffect('2026-11-06')).toBe(true);
    expect(createLegalDocuments(BUSINESS_INFO, '2026-11-05').privacy.pendingRevision).toBeDefined();
    expect(createLegalDocuments(BUSINESS_INFO, '2026-11-06').privacy.pendingRevision).toBeUndefined();
    expect(createLegalDocuments(BUSINESS_INFO, '2027-01-01').privacy.effectiveDate).toBe('2026-11-06');
    expect(koreanLegalDate('2026-11-06')).toBe('2026년 11월 6일');
  });

  it('본문이 Korpay 신규 카드 결제와 Toss 기존 결제 조회·취소·환급 유지를 함께 밝힌다', () => {
    const termsPayment = LEGAL_DOCUMENTS.terms.articles
      .find((article) => article.heading.includes('지급방법'))!
      .paragraphs!.join('\n');

    /* 신규 결제는 코페이, 기존 기록은 토스 — 한쪽만 적으면 이용자가 자기 결제의
       처리 주체와 취소·환급 경로를 특정할 수 없다. */
    expect(termsPayment).toMatch(/코페이/);
    expect(termsPayment).toMatch(/토스페이먼츠/);

    const processorRows = LEGAL_DOCUMENTS.privacy.articles
      .find((article) => article.heading.includes('위탁'))!
      .table!.rows;
    const processors = new Map(processorRows.map((row) => [row[0], row.join(' ')]));

    expect([...processors.keys()]).toContain('주식회사 코페이');
    /* 토스는 목록에서 빠지지 않는다 — 기존 거래의 취소·환급 주체가 사라지면 안 된다. */
    for (const operation of ['조회', '취소', '환급']) {
      expect(processors.get('토스페이먼츠 주식회사'), operation).toContain(operation);
    }
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
    expect(text).toContain('출고지별 반송 대상 굿즈와 수량의 실제 입고');
    expect(text).toContain('교환품 전체의 실제 배송 완료');
    expect(text).toContain('기존 신청 기한이 자동으로 연장되지는 않습니다');
    expect(text).not.toContain('취소는 발송 전');
    expect(text).not.toContain('문의는 질문과 답변을 주고받는 창구이며 청약철회 접수를 대신하지 않습니다');
    if (!contact.email) expect(text).toContain('공개 문의 연락처는 사업자 등록 절차가 끝나는 대로');
  });

  it('이전 공개본을 보존하고 권리·계약·금액·비용·기한 조항은 바꾸지 않는다', () => {
    const terms = LEGAL_DOCUMENTS.terms;
    const shipping = LEGAL_DOCUMENTS.shipping;
    expect(terms.previousVersion?.effectiveDate).toBe('2026-08-22');
    expect(shipping.previousVersion?.effectiveDate).toBe('2026-08-21');
    expect(BEFORE_ADDRESS_BOOK.privacy.previousVersion?.effectiveDate).toBe('2026-08-22');
    expect(AFTER_ADDRESS_BOOK.privacy.previousVersion?.effectiveDate).toBe('2026-10-19');
    for (const [document, headings] of [
      [terms, ['제3조 (약관의 명시와 개정)', '제4조 (서비스의 제공과 변경)', '제15조 (청약철회 등)', '제16조 (청약철회 등의 효과)']],
      [shipping, ['4. 청약철회가 제한되는 경우', '7. 환급 계좌', '8. 환급', '9. 하자·오배송 시 재발송']],
    ] as const) {
      for (const heading of headings) {
        const current = document.articles.find((article) => article.heading === heading);
        const previous = document.previousVersion!.articles.find((article) => article.heading === heading);
        expect(current, heading).toEqual(previous);
      }
    }
    const currentCost = shipping.articles.find((article) => article.heading === '5. 반송비 부담')!;
    const previousCost = shipping.previousVersion!.articles.find((article) => article.heading === '5. 반송비 부담')!;
    expect(currentCost.table).toEqual(previousCost.table);
    expect(currentCost.closing![0]).toBe(previousCost.closing![0]);
    const currentTwelve = terms.articles.find((article) => article.heading.startsWith('제12조 '))!;
    const previousTwelve = terms.previousVersion!.articles.find((article) => article.heading.startsWith('제12조 '))!;
    expect(currentTwelve.paragraphs!.slice(0, 2)).toEqual(previousTwelve.paragraphs);
  });

  it('보존 원문은 개인 연락처 대신 참조만 담고 현재 연락처로만 표시한다', () => {
    const bytes = readFileSync(new URL('./archive/pre-2026-09-09.json', import.meta.url));
    // Captured from the former production source 7ea5d1fd, with contact references preserved.
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('a6b34eae5c3b650d1f278aee76f0d8775f4672414aabf681423c1e1fb45c1379');
    expect(bytes.toString()).toContain('{{CURRENT_CUSTOMER_SUPPORT}}');
    expect(bytes.toString()).not.toMatch(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
    const current = getLegalDocument('shipping', { ...BUSINESS_INFO, phone: '', email: 'archive@example.test' })!;
    expect(JSON.stringify(current.previousVersion)).toContain('archive@example.test');
    expect(JSON.stringify(current.previousVersion)).not.toContain('{{CURRENT_CUSTOMER_SUPPORT}}');
    const blank = getLegalDocument('shipping', { ...BUSINESS_INFO, phone: '', email: '' })!;
    expect(JSON.stringify(blank.previousVersion)).toContain('1:1 문의(/my/inquiries)');
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
  /* 주소록 개정 시행 뒤의 본문(시행 전 본문은 그 이전 판과 같다 — 위 레지스트리 검사). */
  const privacy = AFTER_ADDRESS_BOOK.privacy;
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
    /* 개정 시행일은 직전 판보다 뒤다(과거로 소급하지 않는다). */
    expect(privacy.effectiveDate > privacy.previousVersion!.effectiveDate).toBe(true);
  });

  it('결제수단 인증정보를 보유하지 않는다는 사실을 밝힌다', () => {
    expect(text).toMatch(/저장하지 않습니다/);
  });

  it('처리위탁 목록에 실제 수탁자를 모두 담는다', () => {
    const consignment = privacy.articles.find((article) => article.heading.includes('위탁'));
    expect(consignment?.table).toBeDefined();

    const processors = consignment!.table!.rows.map((row) => row[0]);
    expect(processors).toEqual(
      expect.arrayContaining(['Supabase, Inc.', 'Vercel, Inc.', '토스페이먼츠 주식회사', '한진택배', 'Resend']),
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
  const shipping = LEGAL_DOCUMENTS.shipping;
  const text = plainText(shipping);

  it('출고지별 DB 정책 안내와 합산 기준을 설명하고 고정 금액을 복제하지 않는다', () => {
    expect(text).toContain('출고지별');
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
