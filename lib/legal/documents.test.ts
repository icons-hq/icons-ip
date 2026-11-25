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
import { CONTACT_CHANNELS_PRIVACY_EFFECTIVE_DATE, KAKAO_ALIMTALK_PRIVACY_EFFECTIVE_DATE } from '../auth/contact-channels';
import { SOCIAL_LOGIN_LABELS } from './social-login';

/* 연락처가 빈 사업자 정보로 만든 문서 셋 — 문의처 문장이 갈리는 두 갈래를 모두 검사한다. */
const NO_CONTACT = createLegalDocuments({ ...BUSINESS_INFO, phone: '', email: '' });

const documents = [
  ...LEGAL_DOCUMENT_SLUGS.map((slug) => LEGAL_DOCUMENTS[slug]),
  ...LEGAL_DOCUMENT_SLUGS.map((slug) => NO_CONTACT[slug]),
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

function article(document: LegalDocument, prefix: string) {
  const found = document.articles.filter((item) => item.heading.startsWith(prefix));
  expect(found, prefix).toHaveLength(1);
  return found[0]!;
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
      for (const word of ['굿즈', '카드팩', '가챠', '뽑기', '확률', '충전', '천장']) {
        expect(text, `${document.slug} · ${word}`).not.toMatch(new RegExp(word));
      }
    }
  });

  /* 서비스 공개(오픈) 전이라 실사용자가 없다 — 세 문서는 개정 안내·이전 본문·사전 공지 없이 2026-11-25에 작성한 최초 판 하나다.
     오픈 뒤 개정부터는 약관 제3조·방침 제13조대로 사전 공지와 이전 본문 보존을 쓴다(렌더 경로는 라우트 시험이 fixture로 지킨다). */
  it('오픈 전 최초 판이다 — 세 문서 모두 2026-11-25 시행이고 사전 공지·개정 안내·이전 본문이 없다', () => {
    expect(Object.keys(LEGAL_EFFECTIVE_DATES).sort()).toEqual([...LEGAL_DOCUMENT_SLUGS].sort());

    for (const document of documents) {
      expect(document.effectiveDate, document.slug).toBe('2026-11-25');
      expect(document.effectiveDate, document.slug).toBe(LEGAL_EFFECTIVE_DATES[document.slug]);
      expect(document.pendingRevision, document.slug).toBeUndefined();
      expect(document.additionalPendingRevisions, document.slug).toBeUndefined();
      expect(document.revisionChanges, document.slug).toBeUndefined();
      expect(document.previousVersion, document.slug).toBeUndefined();
    }
    for (const slug of LEGAL_DOCUMENT_SLUGS) {
      /* 한 문서만 개정할 수 있도록 각 문서는 자기 슬러그의 시행일만 참조한다. */
      expect(source().match(new RegExp(`LEGAL_EFFECTIVE_DATES\\.${slug}`, 'g')), slug).toHaveLength(1);
    }
    expect(source(), '문서 셋이 시행일 상수 하나를 공유하면 개별 개정을 할 수 없다').not.toMatch(/const EFFECTIVE_DATE\b/);
    /* 날짜로 개정본을 고르는 장치가 남아 있지 않다. */
    expect(source()).not.toMatch(/-revision'/);
  });

  it('방침을 읽는 운영 게이트(휴대폰 번호 인증·알림톡)는 최초 판 시행일을 쓴다', () => {
    expect(CONTACT_CHANNELS_PRIVACY_EFFECTIVE_DATE).toBe(LEGAL_EFFECTIVE_DATES.privacy);
    expect(KAKAO_ALIMTALK_PRIVACY_EFFECTIVE_DATE).toBe(LEGAL_EFFECTIVE_DATES.privacy);
  });


  it('오픈 전에 없던 과거 결제·개정 이력을 본문에 남기지 않는다', () => {
    for (const document of documents) {
      const text = plainText(document);
      for (const word of ['코페이', '2026년 8월 21일', '이전 정책', '개정 전']) {
        expect(text, `${document.slug} · ${word}`).not.toContain(word);
      }
    }
  });

  it('주소록은 이미 열려 있고 최초 판이 그 수집을 고지한다 — 시행일은 한국 시간 날짜로 센다', () => {
    /* 주소록은 2026-11-06에 열렸고, 2026-11-25 최초 판이 주소록 수집을 본문에 담는다. */
    expect(PRIVACY_ADDRESS_BOOK_REVISION.effectiveDate <= LEGAL_EFFECTIVE_DATES.privacy).toBe(true);
    expect(plainText(LEGAL_DOCUMENTS.privacy)).toContain('주소록 (선택)');
    expect(kstToday(new Date('2026-11-05T14:59:59Z'))).toBe('2026-11-05');
    expect(kstToday(new Date('2026-11-05T15:00:00Z'))).toBe('2026-11-06');
    expect(koreanLegalDate('2026-11-06')).toBe('2026년 11월 6일');
  });

  /* 결제대행사는 서버가 주문 단위로 정한다(ADR-0013) — 2026-11-25부터 19금 상품 주문도 토스페이먼츠(ADR-0053). */
  it('지급방법과 처리위탁이 실제 결제대행사(19금 상품 주문도 토스페이먼츠)를 밝힌다', () => {
    const termsPayment = LEGAL_DOCUMENTS.terms.articles
      .find((article) => article.heading.includes('지급방법'))!
      .paragraphs!.join('\n');
    expect(termsPayment).toMatch(/상품과 티켓 대금은 결제대행사인 토스페이먼츠 주식회사를 통해/);
    expect(termsPayment).not.toMatch(/나이스정보통신/);
    expect(termsPayment).not.toMatch(/19금 상품이 담긴 주문에는 제공하지 않습니다/);

    const processorRows = LEGAL_DOCUMENTS.privacy.articles
      .find((article) => article.heading.includes('위탁'))!
      .table!.rows;
    const processors = new Map(processorRows.map((row) => [row[0], row.join(' ')]));
    for (const operation of ['결제 처리', '취소', '환급']) {
      expect(processors.get('토스페이먼츠 주식회사'), operation).toContain(operation);
    }
    expect(processors.has('나이스정보통신 주식회사')).toBe(false);
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
    expect(text).toContain('반송 대상 상품과 수량의 실제 입고');
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

  /* 카드·카드팩·참여형 게임·마켓·트레이드는 2026-11-24 일반 쇼핑몰 전환으로 지웠다(ADR-0052). 약관에도 그 조항과 언급이 없다. */
  it('카드·카드팩·마켓·트레이드 조항과 언급이 없고, 조문 번호가 이어진다', () => {
    for (const word of ['카드팩', '수집형', '개봉', '트레이드', '마켓', '리워드', '카드 이미지']) expect(text, word).not.toContain(word);
    expect(terms.articles.map((article) => article.heading.split(' ')[0])).toEqual([
      '제1조', '제2조', '제3조', '제4조', '제5조', '제6조', '제7조', '제8조', '제9조', '제10조', '제11조', '제11조의2', '제12조',
      '제13조', '제14조', '제15조', '제16조', '제16조의2', '제16조의3', '제17조', '제18조', '제19조', '제20조', '제21조', '제22조',
    ]);
    expect(article(terms, '제17조 ').heading).toBe('제17조 (팝업 티켓)');
    /* 청약철회 조문이 팝업 티켓 조문(제17조)을 가리킨다. */
    expect(article(terms, '제15조 ').closing!.join('\n')).toContain('팝업 티켓의 취소·환불은 제17조를 따릅니다.');
    expect(article(terms, '제2조 ').list).toContain('"상품"이란 회사가 판매하는 실물 공식 라이선스 재화를 말합니다.');
  });

  it('공급받은 날부터 7일 청약철회를 명시한다', () => {
    expect(text).toMatch(/공급받은 날부터 7일/);
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

  /* 탈퇴 처리(20261126104000)의 실제 동작 — 법정 보존분 외 즉시 파기, 이메일 3일, 재가입 1년 차단, 게시물 익명 표시. */
  it('제7조는 탈퇴 처리의 파기 범위·이메일 보관·게시물·재가입 제한을 실제 동작과 같게 밝힌다', () => {
    const body = terms.articles.find((article) => article.heading.includes('회원 탈퇴'))!.paragraphs!.join('\n');
    expect(body).toContain('개인정보처리방침 제3조가 정한 정보를 제외한 개인정보를 지체 없이 파기합니다');
    expect(body).toContain('이메일 주소는 탈퇴 처리일부터 3일 동안 보관한 뒤 파기합니다');
    expect(body).toContain('쓰지 않은 쿠폰과 적립금은 더 이상 사용할 수 없습니다');
    expect(body).toContain('작성자를 "탈퇴한 회원"으로 표시해 남습니다');
    expect(body).toContain('1년 동안은 같은 이메일 주소나 같은 소셜 로그인 계정으로 다시 가입할 수 없습니다');
    expect(body).toContain('끝나지 않은 거래가 있으면 그 거래가 끝난 뒤 처리합니다');
    expect(body).toContain('카카오가 보내는 계정 탈퇴 알림을 근거로 같은 방법으로 탈퇴를 처리할 수 있습니다');
    expect(body).not.toContain('탈퇴를 처리하면 회사는 개인정보를 지체 없이 파기합니다');
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
    const order = rows.findIndex((row) => row[0] === '상품 주문·배송');
    expect(rows[order + 1]?.[0]).toBe('주소록 (선택)');
    expect(rows[order + 1]?.[1]).toBe('배송지 이름, 받는 분 이름, 연락처, 우편번호, 주소');
    expect(rows[order + 1]?.[2]).toMatch(/배송지를 저장한 경우/);
    /* 주문 배송지 행은 그대로다 — 주소록은 주문에 저장되는 배송지를 대신하지 않는다. */
    expect(rows[order]).toEqual(['상품 주문·배송', '수령인 이름, 연락처, 우편번호, 주소, 배송 요청사항', '주문 시']);
    expect(article('제2조 ').list!.join('\n')).toMatch(/주소록\)를 주문서에 불러오는/);
    expect(article('제3조 ').closing!.join('\n')).toMatch(/주소록에 저장한 배송지는 회원이 배송지 관리에서 언제든 직접 삭제할 수 있으며, 회사가 회원 탈퇴를 처리하면 지체 없이 파기합니다/);
    expect(article('제3조 ').closing!.join('\n')).toMatch(/이미 한 주문의 배송지는 주문 정보의 일부로/);
    expect(article('제7조 ').paragraphs!.join('\n')).toContain('배송지 관리(/my/addresses)에서 직접 열람·수정·삭제');
  });

  /* 성인 인증(ADR-0024) — 본인확인기관 결과 원문은 판정에만 쓰고, 회사는 인증 여부·기간과 복원 불가 다이제스트만 보관한다. */
  it('성인 인증의 수집 항목·목적·보관 항목·유효기간·수탁자를 밝힌다', () => {
    const article = (prefix: string) => privacy.articles.find((item) => item.heading.startsWith(prefix))!;
    const rows = article('제1조 ').table!.rows;
    const row = rows.find((item) => item[0] === '성인 인증 (휴대폰 본인확인)');
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
        'Supabase, Inc.', 'Vercel, Inc.', '토스페이먼츠 주식회사', '엔에이치엔케이씨피 주식회사', '한진택배', 'Resend',
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

  /* 원장 CUS-095: 남양주 출고지는 우체국택배로 나가고 남양주 창고(별도 회사)가 출고지시 파일을 받는다(ADR-0016,
     20261012130000). 서비스 이름은 확인된 것만 적고, 법인명이 확인되지 않은 창고 운영 수탁자는 확인 중으로 남긴다. */
  it('처리위탁 표는 남양주 출고의 우체국택배와 김포·남양주 물류창고 운영 수탁자를 모두 담는다 (CUS-095)', () => {
    const consignment = privacy.articles.find((article) => article.heading.includes('위탁'))!;
    const rows = consignment.table!.rows;
    const names = rows.map((row) => row[0]);
    expect(names[names.indexOf('한진택배') + 1]).toBe('우체국택배');
    expect(rows.find((row) => row[0] === '우체국택배')![1]).toContain('남양주 물류창고에서 출고하는 상품의 배송');
    const warehouses = rows.filter((row) => row[0] === PENDING_PROCESSOR_LABEL).map((row) => row[1]);
    expect(warehouses).toEqual(['김포 물류창고 보관·출고 관리(WMS) 운영', '남양주 물류창고 보관·포장·출고(출고 요청 파일 처리)']);
    expect(consignment.closing!.join('\n')).toContain('김포·남양주 물류창고 운영 수탁자의 법인명은 확정되는 대로');
    /* 확인되지 않은 법인명을 지어 넣지 않는다. */
    expect(names.join(' ')).not.toMatch(/서원|우정사업본부|난소프트/);
  });

  it('제3조는 탈퇴 처리 때 지우는 것, 이메일 3일 보관, 재가입 방지 값·동의 기록 1년, 게시물 익명 표시를 밝힌다 (CUS-036)', () => {
    const retention = privacy.articles.find((article) => article.heading.startsWith('제3조 '))!;
    expect(retention.paragraphs!.join('\n')).toContain('회원 탈퇴를 처리하면 회원의 개인정보를 지체 없이 파기합니다');
    const rows = retention.table!.rows.map((row) => row[0]);
    expect(rows[0]).toContain('주문 배송지');
    expect(rows[2]).toBe('소비자의 불만 또는 분쟁처리에 관한 기록(1:1 문의·상품 문의와 답변, 상담 기록)');
    const closing = retention.closing!.join('\n');
    for (const item of ['위시리스트', '장바구니', '알림함', 'IP 팔로우', '쓰지 않은 쿠폰', '출석 코인', '소셜 로그인 연결 정보', '성인 인증 기록']) {
      expect(closing, item).toContain(item);
    }
    expect(closing).toContain('계정 이메일 주소는 탈퇴 처리 결과를 알리기 위해 탈퇴 처리일부터 3일 동안 보관한 뒤 파기합니다');
    expect(closing).toContain('복원할 수 없게 변환한 값을 탈퇴 처리일부터 1년 동안 보관');
    expect(closing).toContain('마케팅 정보 수신 동의·철회 기록(수단·동의 여부·일시)은 동의 철회 사실을 확인하기 위해 탈퇴 처리일부터 1년');
    expect(closing).toContain('작성자는 "탈퇴한 회원"으로 표시됩니다');
    expect(closing).not.toContain('다른 회원 정보와 함께 회원 탈퇴 시 파기합니다');
    expect(privacy.articles.find((article) => article.heading.startsWith('제2조 ('))!.list)
      .toContain('탈퇴한 회원이 같은 이메일 주소·소셜 로그인 계정으로 곧바로 다시 가입하는 부정 이용 방지');
  });

  /*
   * signInWithSocialAction은 supabase.auth.signInWithOAuth로 만든 인가 요청 URL로 redirect할 뿐이다.
   * 계정 식별자와 이메일은 제공자가 Supabase로 보내오는 값이라 방향이 반대다 —
   * 제공자를 이전받는 자로 적으면 감사에서 제시할 전송 코드 경로가 없다.
   */
  it('국외 이전 표에 실제 전송 경로만 적는다 — 소셜 로그인 제공자는 이전받는 자가 아니다', () => {
    const transfer = privacy.articles.find((article) => article.heading.includes('국외'));
    const receivers = transfer!.table!.rows.map((row) => row[0]);

    expect(receivers).toEqual(['Supabase, Inc.', 'Vercel, Inc.', 'Cloudflare, Inc.', 'Twilio Inc.', 'Resend']);
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

  it('배송 묶음별 DB 정책 안내와 합산 기준을 설명하고 고정 금액을 복제하지 않는다', () => {
    expect(text).toContain('배송 묶음별');
    expect(text).not.toContain('출고지');
    expect(text).toContain('할인 전');
    expect(text).toContain('상품당 한 번');
    /* 배송비 금액은 상품 상세·주문 화면이 출고지 설정에서 고지한다 — 배송 안내 표는 금액을 복제하지 않는다. */
    const delivery = plainText({ ...shipping, articles: [shipping.articles[0]!] });
    expect(delivery).not.toContain('3,000원');
    expect(delivery).not.toContain('50,000원 이상');
  });

  /* 부분 반품(ADR-0047) — 주문 전체 또는 고른 상품·수량 단위로 청약철회하고, 그 상품에 배분된 금액을 환급한다. */
  it('일부 상품·수량 반품과 그 환급 범위를 안내한다', () => {
    expect(text).toMatch(/청약철회는 주문 전체 또는 고른 상품·수량 단위로 신청할 수 있습니다/);
    expect(text).toMatch(/그 상품만 담긴 배송 묶음의 배송비를 환급/);
    expect(text).toMatch(/일부만 반송하고 싶다면 주문 상세의 반품 신청에서 반송할 상품과 수량을 골라주세요/);
    expect(text).not.toMatch(/청약철회는 주문 단위로만 신청할 수 있습니다/);
  });

  it('시스템이 하지 않는 배송비 공제를 고지하지 않는다', () => {
    expect(text).not.toMatch(/공제될 수 있습니다/);
    expect(text).toMatch(/공제하지 않습니다/);
  });

  it('반송비 부담 주체를 사유별로 나눈다', () => {
    expect(text).toMatch(/반품배송비\(편도 3,000원\)를 환급액에서 차감/);
    expect(text).toMatch(/처음 반품할 때 한 번 왕복 6,000원/);
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

/* 오픈 전(2026-11-25)까지 정한 변경은 개정 이력 없이 최초 판 본문에 바로 들어 있다(운영 책임자 결정). */
describe('오픈 전 최초 판(2026-11-25)이 담는 내용', () => {
  const { terms, privacy, shipping } = LEGAL_DOCUMENTS;
  const rowNames = (document: LegalDocument, prefix: string) => article(document, prefix).table!.rows.map((row) => row[0]);
  const after = (names: string[], anchor: string) => names[names.indexOf(anchor) + 1];

  it('이용약관 제1조는 법인 상호와 서비스 이름(엑스스퀘어)을 쓰고 옛 이름이 없다', () => {
    expect(article(terms, '제1조 ').paragraphs![0]).toContain('이 약관은 주식회사 아이콘스(이하 "회사")가 운영하는 온라인 서비스 엑스스퀘어(이하 "서비스")에서');
    expect(plainText(terms)).not.toContain('ICONS');
  });

  it('지급방법은 계좌이체·가상계좌와 구매안전서비스를 밝히고, 회사 계좌 무통장 입금 조문은 따로 둔다', () => {
    const payment = article(terms, '제11조 (지급방법)').paragraphs!.join('\n');
    expect(payment).toContain('신용·체크카드, 간편결제, 계좌이체 또는 가상계좌(무통장입금)로 지급할 수 있습니다');
    expect(payment).toContain('구매안전서비스(결제대금예치, 에스크로)');
    expect(payment).toContain('계좌이체로 지급한 대금을 취소·환급하는 경우');
    expect(article(terms, '제11조의2 ').paragraphs!.join('\n')).toContain('입금 기한은 주문이 성립한 때부터 24시간입니다');
    expect(rowNames(shipping, '1. 배송 안내')).toContain('가상계좌 입금 기한');
    expect(article(shipping, '7. 환급 계좌').paragraphs!.join('\n')).toContain('가상계좌 발급일부터 180일이 지나면 파기합니다');
  });

  it("배송 단위는 '배송 묶음'으로 쓰고 '출고지'라는 말을 쓰지 않는다", () => {
    for (const document of documents) expect(plainText(document), document.slug).not.toContain('출고지');
    expect(article(terms, '제16조의2 ').paragraphs![0]).toContain('환급·재배송은 배송 묶음별 실물 회수를 모두 확인한 뒤 진행합니다.');
  });

  it('이용약관은 일부 상품 청약철회와 단순 변심 반품배송비 차감을 밝힌다', () => {
    const effects = article(terms, '제16조 ').paragraphs!.join('\n');
    expect(effects).toContain('단순 변심에 따른 반품의 반환 비용(반품배송비)은 환급액에서 차감할 수 있습니다');
    expect(effects).toContain('청약철회는 주문 전체 또는 이용자가 고른 상품·수량 단위로 할 수 있습니다');
    expect(article(terms, '제16조의2 ').paragraphs!.join('\n')).toContain('반품은 한 주문에 담긴 상품 중 일부 상품·수량만 신청할 수 있고, 교환은 주문 단위로 처리됩니다');
  });

  it('방침 제1조는 휴대폰 번호 인증·이메일 변경·IP 팔로우·가상계좌 환급 계좌·자동 가입 방지 확인을 제자리에 담는다', () => {
    const names = rowNames(privacy, '제1조 ');
    expect(names.slice(names.indexOf('온보딩'), names.indexOf('온보딩') + 4)).toEqual(['온보딩', '휴대폰 번호 인증', '이메일 변경 (선택)', 'IP 팔로우']);
    expect(after(names, '취소·반품 환급 계좌')).toBe('가상계좌 결제 환급 계좌');
    expect(after(names, '자동 생성')).toBe('자동 가입 방지 확인');
    expect(article(privacy, '제1조 ').table!.rows.find((row) => row[0] === '온보딩')![1]).not.toContain('팔로우한 IP');
  });

  it('방침 제2조·제3조는 봇 차단·휴대폰 번호 인증 목적과 보유 기간을 밝히고, 인증 번호는 알림톡 주문 안내에만 쓴다', () => {
    const purposes = article(privacy, '제2조 (').list!;
    expect(after(purposes, '회원 식별, 로그인 유지, 가입 자격 확인 등 회원 관리')).toContain('봇');
    expect(purposes.join('\n')).toContain('휴대폰 번호 인증을 통한 회원 연락처 확인');
    expect(purposes).toContain('알림함·이메일·카카오톡 알림톡을 통한 거래 진행 안내와 서비스 공지');
    const closing = article(privacy, '제2조 (').closing!.join('\n');
    expect(closing).toContain('카카오톡 알림톡 발송에만 이용합니다');
    expect(closing).toContain('마케팅 정보 발송에는 이용하지 않습니다');
    const retention = article(privacy, '제3조 ').closing!.join('\n');
    for (const text of ['인증·해제 이력(일시·종류)은 발생 1년 뒤 삭제', '이메일 변경 인증 요청 기록(요청 일시·결과)은 요청 2일 뒤 삭제', '비밀번호 재설정 요청 기록(요청 일시·종류)은 요청 2일 뒤 삭제']) {
      expect(retention).toContain(text);
    }
  });

  it('방침 제5조·제6조는 Cloudflare·Twilio·알림톡 수탁자를 위탁·국외 이전에 올린다', () => {
    const processors = rowNames(privacy, '제5조 ');
    expect(after(processors, 'Vercel, Inc.')).toBe('Cloudflare, Inc.');
    expect(after(processors, '엔에이치엔케이씨피 주식회사')).toBe('Twilio Inc.');
    expect(processors.slice(processors.indexOf('Resend') + 1, processors.indexOf('Resend') + 3)).toEqual(['엔에이치엔클라우드 주식회사', '주식회사 카카오']);
    expect(article(privacy, '제5조 ').closing!.at(-1)).toContain('카카오톡 알림톡 수탁자(엔에이치엔클라우드 주식회사, 주식회사 카카오)에는 인증한 휴대폰 번호와 안내 내용');
    const transfers = article(privacy, '제6조 ').table!.rows;
    expect(transfers.find((row) => row[0] === 'Cloudflare, Inc.')![1]).toBe('미국');
    expect(transfers.find((row) => row[0] === 'Twilio Inc.')![1]).toBe('미국');
  });

  it('방침 제7조는 휴대폰 번호의 직접 수정과 소셜 로그인 회원의 이메일 변경을 안내한다', () => {
    const rights = article(privacy, '제7조 ').paragraphs!.join('\n');
    expect(rights).toContain('마케팅 정보 수신 동의 여부, 휴대폰 번호는 설정 화면에서 직접 열람·수정할 수 있습니다');
    expect(rights).toContain('설정 또는 온보딩에서 다른 이메일을 입력하고 인증번호로 확인해 계정 이메일을 바꿀 수 있습니다');
  });

  it.each([
    ['연락처가 있을 때', LEGAL_DOCUMENTS.privacy],
    ['연락처가 비어 있을 때', NO_CONTACT.privacy],
  ])('방침 제11조는 %s도 개인정보 보호책임자(대표이사 정승준)를 지정 문단 바로 뒤에 밝힌다', (_label, document) => {
    const paragraphs = article(document, '제11조 (개인정보 보호책임자').paragraphs!;
    expect(paragraphs[0]).toContain('개인정보 보호책임자를 지정');
    expect(paragraphs[1]).toBe('개인정보 보호책임자는 대표이사 정승준이며, 보호책임자의 연락처는 위 문의 창구와 같습니다.');
  });
});
