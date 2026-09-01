/*
 * 어드민 사용 가이드 콘텐츠 스키마.
 *
 * 본문은 마크다운이 아니라 타입드 데이터다 — 법정 고지(lib/legal/documents.ts)와
 * 같은 구조라서, 렌더러는 무상태 컴포넌트 하나로 끝나고 콘텐츠 무결성은
 * vitest(lib/admin/guide/topics.test.ts)가 지킨다.
 *
 * 화면 링크는 href만 담는다. 라벨을 여기 다시 적으면 화면 이름이 바뀔 때 가이드만
 * 옛 이름으로 남는다 — 렌더러가 lib/admin/navigation.ts에서 현재 라벨을 조회한다.
 */

export type AdminGuideTopicSlug =
  | 'getting-started'
  | 'goods-sales'
  | 'orders-shipping'
  | 'bank-transfer'
  | 'claims'
  | 'inquiries-reviews'
  | 'cards-games'
  | 'events-tickets'
  | 'display-messaging'
  | 'promotions'
  | 'members-roles'
  | 'stats'
  | 'troubleshooting'
  | 'dev-requests';

export interface AdminGuideTable {
  columns: string[];
  rows: string[][];
}

/** info=참고 · warning=함정/주의 · danger=되돌릴 수 없는 조작 */
export type AdminGuideCalloutTone = 'info' | 'warning' | 'danger';

export interface AdminGuideCallout {
  tone: AdminGuideCalloutTone;
  title: string;
  body: string[];
}

export interface AdminGuideScreenLink {
  /** ADMIN_NAV_GROUPS에 실존하는 ready 화면의 href여야 한다(테스트 강제). */
  href: string;
  /** admin 전용 화면이면 필수(테스트 강제) — staff 독자에게 접근 조건을 밝힌다. */
  note?: string;
}

export interface AdminGuideStep {
  text: string;
  detail?: string[];
  /** 이 단계에서 여는 화면. href 규칙은 AdminGuideScreenLink와 같다. */
  screenHref?: string;
}

export interface AdminGuideSection {
  /** 주제 안에서 유일한 kebab-case 앵커 id. */
  id: string;
  heading: string;
  paragraphs?: string[];
  /** 순서 있는 절차. */
  steps?: AdminGuideStep[];
  /** 순서 없는 항목·체크리스트. */
  list?: string[];
  table?: AdminGuideTable;
  callouts?: AdminGuideCallout[];
  /** 섹션과 관련된 화면 바로가기. */
  screens?: AdminGuideScreenLink[];
}

export interface AdminGuideTopic {
  slug: AdminGuideTopicSlug;
  /** 주제 페이지의 h1. 헤더 제목은 내비 정의("사용 가이드")가 따로 맡는다. */
  title: string;
  /** 인덱스 카드·이전/다음 내비에 쓰는 짧은 이름. */
  navLabel: string;
  summary: string;
  sections: AdminGuideSection[];
}

/**
 * 자주 만나는 오류 사례. quote는 화면에 뜨는 문구 원문이어야 하고,
 * sourceFile(리포 루트 상대 경로)의 소스에 그대로 존재하는지 테스트가 대조한다 —
 * 코드 문구가 바뀌면 가이드가 유령 문구를 인용하는 순간 테스트가 깨진다.
 */
export interface AdminGuideErrorCase {
  quote: string;
  sourceFile: string;
  cause: string;
  fix: string;
}
