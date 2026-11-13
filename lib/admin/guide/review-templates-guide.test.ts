import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REVIEW_EVENT_TEMPLATE_REPLACE_CONFIRM } from '@/lib/review-events';
import { ADMIN_GUIDE_TOPICS, type AdminGuideTopic } from './topics';

/*
 * 원장 재작업 T10(SHEET-017 리뷰이벤트 문구 템플릿·SHEET-027 고객 화면 노출 예시) 가이드 정합.
 * 가이드가 옮겨 적은 버튼·패널 이름이 지금 화면 코드와 같은지 고정한다. 화면 문구가 바뀌면 여기가 깨진다 — 가이드도 함께 고친다.
 */
function repoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}
function plainText(topic: AdminGuideTopic): string {
  return topic.sections.flatMap((section) => [
    section.heading,
    ...(section.paragraphs ?? []),
    ...(section.steps ?? []).flatMap((step) => [step.text, ...(step.detail ?? [])]),
    ...(section.callouts ?? []).flatMap((callout) => [callout.title, ...callout.body]),
  ]).join('\n');
}
const text = plainText(ADMIN_GUIDE_TOPICS['inquiries-reviews']);

describe('리뷰이벤트 문구 템플릿 안내(SHEET-017)', () => {
  it('목록·등록 화면의 버튼 이름과 바꾸기 확인 문구가 화면 코드와 같다', () => {
    expect(repoFile('components/admin/screens/ReviewEventListScreen.tsx')).toContain('>문구 템플릿</Link>');
    const editor = repoFile('components/admin/screens/ReviewEventEditorScreen.tsx');
    for (const label of ['템플릿 불러오기', '현재 문구를 템플릿으로 저장']) {
      expect(editor).toContain(`>${label}</button>`);
      expect(text).toContain(`"${label}"`);
    }
    expect(text).toContain('"문구 템플릿"');
    expect(text).toContain(REVIEW_EVENT_TEMPLATE_REPLACE_CONFIRM);
  });

  it('템플릿 저장은 적립금 정책과 무관하고 이벤트 저장은 그대로 막힌다고 안내한다', () => {
    expect(text).toContain('템플릿 저장은 적립금 정책이 꺼져 있어도 되지만 이벤트 저장은 정책을 켠 뒤에만 됩니다');
    expect(text).toContain('이미 저장한 이벤트는 바뀌지 않습니다');
  });
});

describe('고객 화면 노출 예시 안내(SHEET-027)', () => {
  it('패널 이름이 화면 코드와 같고, 예시 데이터는 저장되지 않는다고 안내한다', () => {
    expect(repoFile('components/admin/ReviewDisplayExamplePanel.tsx')).toContain('고객 화면 노출 예시 (PC·모바일)');
    expect(text).toContain('"고객 화면 노출 예시 (PC·모바일)"');
    expect(text).toContain('고객 화면·리뷰 집계·엑셀에 나오지 않습니다');
    expect(repoFile('components/admin/screens/ReviewConsoleScreen.tsx')).toContain('<ReviewDisplayExample />');
  });

  it('예시가 그리는 자리(BEST 리뷰 포함)와 BEST가 보이는 조건을 화면 예시와 같게 안내한다', () => {
    const example = repoFile('components/admin/ReviewDisplayExample.tsx');
    expect(example).toContain('<GalleryBestReviews');
    expect(example).toContain('BEST 리뷰를 켜고 이 상품에 선정한 리뷰가 3개 이상일 때만');
    expect(text).toContain('상품 상세 대표이미지의 BEST 리뷰');
    expect(text).toContain('BEST 리뷰를 켜고 그 상품에 선정한 리뷰가 3개 이상일 때만');
  });
});
