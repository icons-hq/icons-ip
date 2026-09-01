import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_GUIDE_TOPIC_SLUGS,
  ADMIN_GUIDE_TOPICS,
  adminGuideTopicHref,
} from '@/lib/admin/guide/topics';
import { AdminGuideIndexScreen } from './AdminGuideIndexScreen';
import { AdminGuideTopicScreen } from './AdminGuideTopicScreen';

describe('AdminGuideIndexScreen', () => {
  const html = renderToStaticMarkup(<AdminGuideIndexScreen />);

  it('13개 주제 카드가 전부 자기 주소로 연결된다', () => {
    for (const slug of ADMIN_GUIDE_TOPIC_SLUGS) {
      expect(html).toContain(`href="${adminGuideTopicHref(slug)}"`);
      expect(html).toContain(ADMIN_GUIDE_TOPICS[slug].navLabel);
    }
  });
});

describe('AdminGuideTopicScreen', () => {
  it('섹션 앵커·목차·단계 목록을 렌더한다', () => {
    const topic = ADMIN_GUIDE_TOPICS['goods-sales'];
    const html = renderToStaticMarkup(<AdminGuideTopicScreen topic={topic} />);

    for (const section of topic.sections) {
      expect(html).toContain(`id="${section.id}"`);
      expect(html).toContain(`href="#${section.id}"`);
    }
    expect(html).toContain('admin-guide-steps');
    expect(html).toContain('admin-guide-table');
  });

  it('화면 바로가기 라벨은 내비 정본에서 조회한다 — 데이터에 라벨이 없다', () => {
    const html = renderToStaticMarkup(
      <AdminGuideTopicScreen topic={ADMIN_GUIDE_TOPICS['members-roles']} />,
    );

    /* "그룹 › 화면" 형태. 화면 이름이 바뀌면 가이드 chip도 따라 바뀌어야 한다. */
    expect(html).toContain('커뮤니티·회원 › 역할');
    expect(html).toContain('admin 전용');
  });

  it('콜아웃 톤 클래스와 이전/다음 내비를 렌더한다', () => {
    const claims = renderToStaticMarkup(<AdminGuideTopicScreen topic={ADMIN_GUIDE_TOPICS.claims} />);
    expect(claims).toContain('admin-guide-callout--danger');

    const first = renderToStaticMarkup(
      <AdminGuideTopicScreen topic={ADMIN_GUIDE_TOPICS[ADMIN_GUIDE_TOPIC_SLUGS[0]]} />,
    );
    expect(first).not.toContain('← 이전');
    expect(first).toContain('다음 →');
    expect(first).toContain(`href="${adminGuideTopicHref(ADMIN_GUIDE_TOPIC_SLUGS[1])}"`);

    const last = renderToStaticMarkup(
      <AdminGuideTopicScreen
        topic={ADMIN_GUIDE_TOPICS[ADMIN_GUIDE_TOPIC_SLUGS[ADMIN_GUIDE_TOPIC_SLUGS.length - 1]]}
      />,
    );
    expect(last).toContain('← 이전');
    expect(last).not.toContain('다음 →');
  });
});
