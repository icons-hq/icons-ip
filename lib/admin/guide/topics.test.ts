import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_SCREENS } from '@/lib/admin/navigation';
import { GOODS_NOTICE_FIELDS } from '@/lib/goods-notice';
import { ADMIN_VOCABULARY, adminGoodsCopy, adminClaimCopy } from '@/lib/admin/vocabulary';
import {
  ADMIN_GUIDE_TOPIC_SLUGS,
  ADMIN_GUIDE_TOPICS,
  adjacentAdminGuideTopics,
  adminGuideTopicHref,
  getAdminGuideTopic,
  type AdminGuideTopic,
} from './topics';
import { ADMIN_GUIDE_ERROR_CASES, TROUBLESHOOTING_TOPIC } from './topics/troubleshooting';
import { ADMIN_WEEKLY_CHANGES } from './changes';

const topics = ADMIN_GUIDE_TOPIC_SLUGS.map((slug) => ADMIN_GUIDE_TOPICS[slug]);

function repoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

/** 본문 전체를 한 문자열로 펼친다 — 용어·인용 검사는 표·단계·콜아웃까지 봐야 의미가 있다. */
function plainText(topic: AdminGuideTopic): string {
  return [
    topic.title,
    topic.navLabel,
    topic.summary,
    ...topic.sections.flatMap((section) => [
      section.heading,
      ...(section.paragraphs ?? []),
      ...(section.list ?? []),
      ...(section.steps ?? []).flatMap((step) => [step.text, ...(step.detail ?? [])]),
      ...(section.callouts ?? []).flatMap((callout) => [callout.title, ...callout.body]),
      ...(section.table ? [...section.table.columns, ...section.table.rows.flat()] : []),
      ...(section.screens ?? []).map((screen) => screen.note ?? ''),
    ]),
  ].join('\n');
}

/** 주제가 참조하는 어드민 화면 href 전부 — 섹션 chip과 단계의 바로가기를 합친다. */
function referencedHrefs(topic: AdminGuideTopic): string[] {
  return topic.sections.flatMap((section) => [
    ...(section.screens ?? []).map((screen) => screen.href),
    ...(section.steps ?? []).flatMap((step) => (step.screenHref ? [step.screenHref] : [])),
  ]);
}

describe('어드민 가이드 레지스트리', () => {
  it('순서 배열과 레코드가 변경 로그를 포함한 같은 주제를 가리킨다', () => {
    expect(getAdminGuideTopic('whats-new')).toMatchObject({ title: '업데이트 내역', navLabel: '업데이트 내역' });
    expect(new Set(ADMIN_GUIDE_TOPIC_SLUGS).size).toBe(ADMIN_GUIDE_TOPIC_SLUGS.length);
    expect([...ADMIN_GUIDE_TOPIC_SLUGS].sort()).toEqual(Object.keys(ADMIN_GUIDE_TOPICS).sort());

    for (const slug of ADMIN_GUIDE_TOPIC_SLUGS) {
      expect(getAdminGuideTopic(slug)?.slug).toBe(slug);
    }
  });

  it('알 수 없는 슬러그는 null이다 — 라우트가 404로 떨어질 수 있어야 한다', () => {
    expect(getAdminGuideTopic('unknown')).toBeNull();
    expect(getAdminGuideTopic('')).toBeNull();
    expect(getAdminGuideTopic('__proto__')).toBeNull();
    expect(getAdminGuideTopic('constructor')).toBeNull();
  });

  it('주소 헬퍼와 이전/다음 내비가 순서 배열을 따른다', () => {
    expect(adminGuideTopicHref('claims')).toBe('/admin/guide/claims');

    const first = adjacentAdminGuideTopics(ADMIN_GUIDE_TOPIC_SLUGS[0]);
    expect(first.previous).toBeNull();
    expect(first.next?.slug).toBe(ADMIN_GUIDE_TOPIC_SLUGS[1]);

    const last = adjacentAdminGuideTopics(ADMIN_GUIDE_TOPIC_SLUGS[ADMIN_GUIDE_TOPIC_SLUGS.length - 1]);
    expect(last.next).toBeNull();
    expect(last.previous?.slug).toBe(ADMIN_GUIDE_TOPIC_SLUGS[ADMIN_GUIDE_TOPIC_SLUGS.length - 2]);
  });
});

describe('어드민 가이드 콘텐츠 무결성', () => {
  it('변경 기록은 최신 날짜부터 유일한 날짜와 운영 행동을 제공한다', () => {
    const dates = ADMIN_WEEKLY_CHANGES.map((entry) => entry.week);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).toEqual(expect.arrayContaining(['2026-09-11', '2026-09-14']));
    for (const entry of ADMIN_WEEKLY_CHANGES) {
      expect(entry.week).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isFinite(Date.parse(entry.week))).toBe(true);
      expect(entry.changes.length).toBeGreaterThan(0);
    }
  });

  it('주제마다 제목·요약·섹션을 갖고, 섹션마다 본문이 있다', () => {
    for (const topic of topics) {
      expect(topic.title.length, topic.slug).toBeGreaterThan(0);
      expect(topic.navLabel.length, topic.slug).toBeGreaterThan(0);
      expect(topic.summary.length, topic.slug).toBeGreaterThan(0);
      expect(topic.sections.length, topic.slug).toBeGreaterThan(0);

      for (const section of topic.sections) {
        const label = `${topic.slug} · ${section.id}`;
        const hasBody = Boolean(
          section.paragraphs?.length
          || section.steps?.length
          || section.list?.length
          || section.table
          || section.callouts?.length,
        );
        expect(hasBody, label).toBe(true);
        expect(section.heading.length, label).toBeGreaterThan(0);
        expect(section.id, label).toMatch(/^[a-z0-9-]+$/);

        for (const step of section.steps ?? []) {
          expect(step.text.length, label).toBeGreaterThan(0);
        }
        for (const callout of section.callouts ?? []) {
          expect(callout.title.length, label).toBeGreaterThan(0);
          expect(callout.body.length, label).toBeGreaterThan(0);
        }
        if (section.table) {
          for (const row of section.table.rows) {
            expect(row, label).toHaveLength(section.table.columns.length);
          }
        }
      }

      /* 앵커 id는 주제 안에서 유일해야 목차가 올바른 섹션으로 점프한다. */
      const ids = topic.sections.map((section) => section.id);
      expect(new Set(ids).size, topic.slug).toBe(ids.length);
    }
  });

  /* 어드민은 staff 내부 화면이지만 용어는 CONTEXT.md를 따른다 — 실물은 "굿즈"고,
     폐기된 유료 모델의 어휘는 안내문에 되살리지 않는다. '뽑기'는 화면 라벨
     "뽑기권 발급 정책"에 살아 있는 도메인 용어라 금지 목록에 넣지 않는다.
     ADR-0014 이후 어드민은 실물 굿즈를 '상품'으로 표시한다.
     디지털 카드·티켓의 이름은 별도 화면 어휘 계약으로 보호한다. */
  it('CONTEXT.md가 피하라고 한 어휘를 쓰지 않는다', () => {
    for (const topic of topics) {
      const text = plainText(topic);
      for (const word of ['가챠', '천장', '충전']) {
        expect(text, `${topic.slug} · ${word}`).not.toMatch(new RegExp(word));
      }
    }
  });
  /* 같은 제품의 판매 구성을 묶은 상품군은 CONTEXT.md의 정본 이름 '그룹상품'으로 부른다 — 어드민 메뉴(그룹상품 등록·
     그룹상품 조회/수정)와 같은 말이어야 운영자가 같은 것인지 추측하지 않는다. 홈 베스트리뷰의 리뷰 합산 범위와
     리뷰도움수의 한 표 집계 범위가 이 그룹이다. 모든 안내 주제·오류 사례·업데이트 내역을 검사한다. */
  it('모든 안내 주제와 업데이트 내역은 그룹 개념을 정본 용어(그룹상품)로 부른다', () => {
    expect(plainText(ADMIN_GUIDE_TOPICS['display-messaging'])).toContain('같은 그룹상품으로 묶인 상품들의 공개 리뷰를 합쳐');
    expect(plainText(ADMIN_GUIDE_TOPICS['inquiries-reviews'])).toContain('같은 그룹상품의 여러 상세 페이지에 보이는 동일 리뷰');
    const sources: (readonly [string, string])[] = [
      ...topics.map((topic) => [topic.slug, plainText(topic)] as const),
      ['troubleshooting · 오류 사례', JSON.stringify(ADMIN_GUIDE_ERROR_CASES)] as const,
      ...ADMIN_WEEKLY_CHANGES.map((entry) => [`업데이트 내역 ${entry.week}`, [entry.title, ...entry.changes].join('\n')] as const),
    ];
    expect(sources.length).toBeGreaterThan(ADMIN_GUIDE_TOPIC_SLUGS.length);
    for (const [label, text] of sources) expect(text, label).not.toContain('상품그룹');
  });
  it('운영 안내는 매핑표에 결속하고 카드·티켓 안내는 상품이라 부르지 않는다', () => {
    expect(ADMIN_GUIDE_TOPICS['goods-sales'].title).toContain(ADMIN_VOCABULARY.goods);
    expect(ADMIN_GUIDE_TOPICS.claims.title).toBe(ADMIN_VOCABULARY.claims);
    expect(plainText(ADMIN_GUIDE_TOPICS['cards-games'])).not.toContain('상품');
    expect(plainText(ADMIN_GUIDE_TOPICS['events-tickets'])).not.toContain('상품');
    const renderedErrors = plainText(ADMIN_GUIDE_TOPICS.troubleshooting);
    for (const item of ADMIN_GUIDE_ERROR_CASES) expect(renderedErrors).toContain(adminClaimCopy(adminGoodsCopy(item.quote)));
  });
});

describe('어드민 가이드 ↔ 어드민 IA 정합', () => {
  const readyHrefs = new Set(
    ADMIN_SCREENS.filter((screen) => screen.status === 'ready').map((screen) => screen.href),
  );
  const adminOnlyHrefs = new Set(
    ADMIN_SCREENS.filter((screen) => screen.adminOnly).map((screen) => screen.href),
  );

  it('가이드가 가리키는 화면은 전부 내비에 실존하는 ready 화면이다', () => {
    for (const topic of topics) {
      for (const href of referencedHrefs(topic)) {
        expect(readyHrefs.has(href), `${topic.slug} → ${href}`).toBe(true);
      }
    }
  });

  it('admin 전용 화면을 가리킬 때는 같은 주제의 chip이 접근 조건을 밝힌다', () => {
    for (const topic of topics) {
      const noted = new Set(
        topic.sections
          .flatMap((section) => section.screens ?? [])
          .filter((screen) => Boolean(screen.note?.trim()))
          .map((screen) => screen.href),
      );

      for (const href of referencedHrefs(topic)) {
        if (!adminOnlyHrefs.has(href)) continue;
        expect(noted.has(href), `${topic.slug} → ${href} 에 note 있는 chip 필요`).toBe(true);
      }
    }
  });

  /* 역방향 커버리지 — 새 어드민 화면이 생기면 가이드에 그 화면 항목을 쓰기 전까지
   * 이 테스트가 깨진다. 다루지 않기로 결정한 화면만 여기 명시적으로 남긴다. */
  const GUIDE_COVERAGE_EXEMPT: string[] = [
    '/admin/guide', // 가이드 자신 — 자기 자신을 안내할 필요는 없다.
  ];

  it('모든 ready 화면이 가이드 어딘가에서 다뤄진다', () => {
    const covered = new Set(topics.flatMap((topic) => referencedHrefs(topic)));

    for (const href of readyHrefs) {
      if (GUIDE_COVERAGE_EXEMPT.includes(href)) continue;
      expect(covered.has(href), `${href} 를 다루는 주제가 없다`).toBe(true);
    }
  });
});

describe('어드민 가이드 인용·수치 정합', () => {
  it('오류 표의 문구는 화면 코드의 원문 그대로다', () => {
    expect(ADMIN_GUIDE_ERROR_CASES.length).toBeGreaterThan(0);

    for (const item of ADMIN_GUIDE_ERROR_CASES) {
      expect(item.cause.length, item.quote).toBeGreaterThan(0);
      expect(item.fix.length, item.quote).toBeGreaterThan(0);
      expect(repoFile(item.sourceFile), `${item.sourceFile} 에 없음: ${item.quote}`)
        .toContain(item.quote);
    }
  });

  it('오류 사례가 전부 오류 해결 주제의 본문에 실린다', () => {
    const text = plainText(TROUBLESHOOTING_TOPIC);
    for (const item of ADMIN_GUIDE_ERROR_CASES) {
      expect(text, item.quote).toContain(item.quote);
    }
  });

  it('고시정보 표는 폼·공개 표와 같은 진실원(GOODS_NOTICE_FIELDS)에서 파생된다', () => {
    const table = ADMIN_GUIDE_TOPICS['goods-sales'].sections
      .find((section) => section.id === 'good-form')?.table;

    expect(table?.rows).toEqual(GOODS_NOTICE_FIELDS.map((field) => [field.label, field.placeholder]));
  });

  /* 아래 수치는 export되지 않은 상수·화면 문구를 프로즈로 옮긴 것이다.
   * 소스가 바뀌면 여기가 깨진다 — 그때 가이드 본문도 함께 고친다. */
  it('프로즈에 옮겨 적은 수치가 소스와 어긋나지 않는다', () => {
    /* 역할 화면 목록 상한 — getting-started·members-roles·dev-requests의 "최근 가입 50명". */
    expect(repoFile('lib/admin/roles.server.ts')).toContain('PROFILE_LIMIT = 50');
    /* 일괄 발주확인 상한 — orders-shipping의 "한 번에 100건". */
    expect(repoFile('app/admin/order-actions.ts')).toContain('BULK_CONFIRM_LIMIT = 100');
    /* 자동 발주확인 기본 시각 — orders-shipping·dev-requests·bank-transfer의 "기본 16:30"(ADR-0025). */
    expect(repoFile('lib/admin/auto-order-confirmation.ts')).toContain("AUTO_ORDER_CONFIRMATION_DEFAULT_TIME = '16:30'");
    expect(repoFile('supabase/migrations/20261027130000_auto_order_confirmation.sql')).toContain("values(true,true,'16:30',clock_timestamp())");
    /* 자동 구매확정 소급 — orders-shipping의 "이미 배송완료된 주문도"(D11). */
    expect(repoFile('components/admin/PurchaseConfirmationPolicyForm.tsx')).toContain('켜면 이미 배송완료된 주문도 배송완료일 기준으로 확정됩니다');
    /* 자동 확정은 운영자가 기간을 설정해 활성화한 뒤 적용한다. */
    expect(repoFile('components/admin/screens/SettledScreen.tsx')).toContain('자동 확정은 기본 꺼짐');
    /* 추가 이미지 상한 — goods-sales·주간 변경의 "추가 이미지 최대 9장"·"갤러리 1~9". */
    expect(repoFile('lib/admin/catalog.ts')).toContain('GOODS_GALLERY_MAX = 9');
    expect(repoFile('lib/admin/goods-workbook.ts')).toContain("galleryUrl8: '갤러리 9 URL'");
    /* 무통장 기한 연장 폭 — bank-transfer의 "24시간 연장". */
    expect(repoFile('app/admin/unpaid-actions.ts')).toContain('입금 기한을 24시간 연장했습니다.');
  });

  /* 출고지시 양식 기본값(10/14 회의 A2·T4) — 화면은 양식을 고르지 않으면 출고지 기본 양식을 쓰고 버튼마다 실제 양식을 적는다.
     안내가 "기본은 74열"로 되돌아가면 남양주 담당자가 74열을 받는다고 오해한다. */
  it('출고지시 기본 양식과 입금 확인 뒤 발주확인 안내가 화면 계약과 같다', () => {
    const grid = repoFile('components/admin/screens/ShipmentConsoleGrid.tsx');
    expect(grid).toContain('출고지 기본 양식 (남양주: 서원 송장양식 · 그 밖: 스마트스토어 74열)');
    expect(grid).toContain('CSV를 골라도 남양주(서원) 송장양식은 XLSX로 받습니다.');
    for (const slug of ['orders-shipping', 'store-settings'] as const) {
      const text = plainText(ADMIN_GUIDE_TOPICS[slug]);
      expect(text, slug).toContain('출고지 기본 양식');
      expect(text, slug).toContain('서원 송장양식 XLSX(비밀번호 없음)');
      expect(text, slug).not.toMatch(/기본은 스마트스토어|기본 내보내기는 스마트스토어|위에서 고른 양식/);
    }
    expect(plainText(ADMIN_GUIDE_TOPICS['orders-shipping'])).toContain('버튼에 적힌 양식');
    const bank = plainText(ADMIN_GUIDE_TOPICS['bank-transfer']);
    expect(bank).toContain('다음 실행 시각(기본 매일 16:30)에 시스템이 발주확인');
    expect(bank).toContain('직접 발주확인하면 고객 직접 취소가 그때 닫힙니다');
  });
});
