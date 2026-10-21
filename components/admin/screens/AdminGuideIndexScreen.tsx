import Link from 'next/link';
import {
  ADMIN_GUIDE_TOPIC_SLUGS,
  ADMIN_GUIDE_TOPICS,
  ADMIN_GUIDE_UPDATED_AT,
  adminGuideTopicHref,
} from '@/lib/admin/guide/topics';

/*
 * 어드민 사용 가이드 — 목차 화면.
 *
 * 전체 주제를 순서대로 카드로 편다. 사이드바에는 이 목차 하나만 올라가므로
 * (lib/admin/navigation.ts), 주제 탐색은 여기와 주제 페이지의 이전/다음이 맡는다.
 */

/* 처음 온 운영자가 실무 순서대로 밟는 추천 경로. slug는 레지스트리와 테스트가 지킨다. */
const START_PATH = ['getting-started', 'goods-sales', 'orders-shipping'] as const;

export function AdminGuideIndexScreen() {
  return (
    <div className="admin-guide-index">
      <section className="card admin-guide-intro">
        <h2 className="admin-guide-intro__title">판매자 가이드</h2>
        <p className="admin-guide-paragraph">
          상품 등록부터 주문·출고·고객 응대·정산까지 현재 판매자센터의 처리 절차를 안내합니다.
          업무별 입력·저장·완료 조건과 파일 양식, 처리할 수 없는 경우를 확인하세요.
        </p>
        <p className="admin-guide-paragraph">전체 {ADMIN_GUIDE_TOPIC_SLUGS.length}개 주제 · 최종 확인 <time dateTime={ADMIN_GUIDE_UPDATED_AT}>{ADMIN_GUIDE_UPDATED_AT}</time> · 화면과 저장 권한은 매니저 역할에 따라 다릅니다.</p>
        <p className="admin-guide-paragraph">처음이라면 이 순서를 권합니다.</p>
        <ol className="admin-guide-start-path">
          {START_PATH.map((slug) => (
            <li key={slug}>
              <Link href={adminGuideTopicHref(slug)}>{ADMIN_GUIDE_TOPICS[slug].navLabel}</Link>
            </li>
          ))}
        </ol>
      </section>

      <nav aria-label="가이드 주제" className="admin-guide-grid">
        {ADMIN_GUIDE_TOPIC_SLUGS.map((slug, index) => {
          const topic = ADMIN_GUIDE_TOPICS[slug];
          return (
            <Link className="card admin-guide-card" href={adminGuideTopicHref(slug)} key={slug}>
              <span className="mono admin-guide-card__index">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="admin-guide-card__label">{topic.navLabel}</span>
              <span className="admin-guide-card__summary">{topic.summary}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
