import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { krwAmountWords } from '../format';
import { FREE_SHIPPING_THRESHOLD, SHIPPING_FEE } from '../shipping';
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
import { SOCIAL_LOGIN_LABELS } from './social-login';

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

    for (const label of Object.values(SOCIAL_LOGIN_LABELS)) {
      expect(text, label).toContain(label);
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

  /* 온보딩(app/onboarding/actions.ts)의 readBirthDate는 나이를 계산하지 않는다.
     저장소에 나이 게이트가 없으므로 약관이 자동 차단을 약속하면 안 된다. */
  it('나이를 자동 검증하지 않는다는 사실을 회원가입 조문에 밝힌다', () => {
    const signup = terms.articles.find((article) => article.heading.includes('회원가입'));
    expect(signup?.closing?.join('\n')).toMatch(/나이를 자동 검증해 가입을 차단하지 않습니다/);
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
    } else {
      expect(body).toMatch(/연락처를 공개하는 즉시 그 창구로 탈퇴 요청을 접수합니다/);
      /* 연락처가 없는 동안에도 이용자가 지금 할 수 있는 행동이 남아 있어야 한다. */
      expect(body).toMatch(/설정 화면/);
    }
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
   * 저장소 어디에도 나이 게이트가 없다 — readBirthDate는 "존재하는 날짜"와 "오늘 이전"만 본다.
   * "수집하지 않습니다"는 수집을 막는 장치가 있다는 뜻이 되어 사실과 어긋난다.
   * 게이트 도입은 법정대리인 동의 설계가 따로 필요한 별도 작업이다.
   */
  it('만 14세 미만 처리 고지를 나이 게이트 없는 현재 동작에 맞춘다', () => {
    const rights = privacy.articles.find((article) => article.heading.includes('정보주체의 권리'));
    const body = rights!.paragraphs!.join('\n');

    expect(text).not.toMatch(/만 14세 미만 아동의 개인정보는 수집하지 않습니다/);
    expect(body).toMatch(/나이를 자동 검증해 가입을 차단하지는 않으므로/);
    expect(body).toMatch(/알게 된 경우/);
    /* 처리 목적도 존재하지 않는 "가입 제한"을 근거로 삼으면 안 된다. */
    expect(text).not.toMatch(/만 14세 미만 가입 제한/);
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

  /* 정책값을 문서가 다시 선언하면 lib/shipping.ts를 고쳐도 공개 고지만 옛값에 남는다.
     리터럴이 아니라 상수를 참조해야 이 테스트가 그 어긋남을 잡는다. */
  it('배송비 고지가 lib/shipping.ts의 정책값을 그대로 따른다 (계획 D5)', () => {
    expect(text).toContain(krwAmountWords(SHIPPING_FEE));
    expect(text).toContain(`${krwAmountWords(FREE_SHIPPING_THRESHOLD)} 이상`);
    expect(source(), '배송비 상수를 문서가 자체 선언하면 정책 변경이 갈라진다')
      .not.toMatch(/const\s+(SHIPPING_FEE|FREE_SHIPPING_THRESHOLD)\w*\s*=/);
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
