import Link from 'next/link';
import {
  ADMIN_GUIDE_TOPIC_SLUGS,
  ADMIN_GUIDE_TOPICS,
  adminGuideTopicHref,
} from '@/lib/admin/guide/topics';

/*
 * 어드민 사용 가이드 — 목차 화면.
 *
 * 13개 주제 전부를 순서대로 카드로 편다. 사이드바에는 이 목차 하나만 올라가므로
 * (lib/admin/navigation.ts), 주제 탐색은 여기와 주제 페이지의 이전/다음이 맡는다.
 */

/* 처음 온 운영자가 실무 순서대로 밟는 추천 경로. slug는 레지스트리와 테스트가 지킨다. */
const START_PATH = ['getting-started', 'goods-sales', 'orders-shipping'] as const;

export function AdminGuideIndexScreen() {
  return (
    <div className="admin-guide-index">
      <section className="card admin-guide-intro">
        <h2 className="admin-guide-intro__title">어드민 사용 가이드</h2>
        <p className="admin-guide-paragraph">
          영업·신사업·운영 담당자가 개발팀에 묻지 않고 어드민을 쓸 수 있도록 화면별 절차와
          주의점을 정리했습니다. 화면과 어긋난 내용을 발견하면 개발팀에 알려주세요 —
          가이드는 코드와 함께 관리되어 다음 배포에서 고쳐집니다.
        </p>
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
