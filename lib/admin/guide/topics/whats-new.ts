import { ADMIN_WEEKLY_CHANGES } from '../changes';
import type { AdminGuideTopic } from '../types';

export const WHATS_NEW_TOPIC: AdminGuideTopic = {
  slug: 'whats-new',
  title: '업데이트 내역',
  navLabel: '업데이트 내역',
  summary: '날짜별 판매자센터 업데이트를 확인한 뒤 업무별 가이드에서 실제 처리 절차와 지원 범위를 확인합니다.',
  sections: ADMIN_WEEKLY_CHANGES.map((entry) => ({
    id: `week-${entry.week}`,
    heading: `${entry.week} · ${entry.title}`,
    list: [...entry.changes],
  })),
};
