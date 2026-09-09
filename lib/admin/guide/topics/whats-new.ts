import { ADMIN_WEEKLY_CHANGES } from '../changes';
import type { AdminGuideTopic } from '../types';

export const WHATS_NEW_TOPIC: AdminGuideTopic = {
  slug: 'whats-new',
  title: '이번 주 바뀐 것',
  navLabel: '이번 주 바뀐 것',
  summary: '주차별 화면 변경과 운영 피드백 전달 방법을 확인합니다.',
  sections: ADMIN_WEEKLY_CHANGES.map((entry) => ({
    id: `week-${entry.week}`,
    heading: `${entry.week} · ${entry.title}`,
    list: [...entry.changes],
  })),
};
