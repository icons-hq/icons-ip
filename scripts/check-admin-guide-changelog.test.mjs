import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';

import { checkAdminGuideChangelog } from './check-admin-guide-changelog.mjs';

describe('admin guide changelog guard', () => {
  it('rejects an admin screen change without an operator changelog entry', () => {
    expect(checkAdminGuideChangelog({
      files: ['components/admin/screens/GoodsListScreen.tsx'],
      body: '',
    })).toMatchObject({ ok: false, message: expect.stringContaining('lib/admin/guide/changes.ts') });
  });

  it.each([
    'app/admin/(shell)/catalog/goods/page.tsx',
    'app/admin/(shell)/layout.tsx',
    'app/admin/page.tsx',
    'components/admin/AdminSidebar.tsx',
    'components/admin/sections/CatalogSection.tsx',
    'lib/admin/navigation.ts',
    'lib/admin/sections.ts',
  ])('requires an entry for the admin surface %s', (file) => {
    expect(checkAdminGuideChangelog({ files: [file] }).ok).toBe(false);
  });

  it('accepts a matching changelog update', () => {
    expect(checkAdminGuideChangelog({ files: [
      'components/admin/screens/GoodsListScreen.tsx', 'lib/admin/guide/changes.ts',
    ] }).ok).toBe(true);
  });

  it('accepts an explicit skip reason from a separate PR body line', () => {
    expect(checkAdminGuideChangelog({
      files: ['components/admin/AdminSidebar.tsx'],
      body: '## 검증\n통과\n\nguide-changelog: skip — 기존 링크 오타만 복구합니다.\n',
    })).toEqual({ ok: true, message: '변경 로그 생략 사유: 기존 링크 오타만 복구합니다.' });
  });

  it.each(['guide-changelog: skip', 'guide-changelog: skip — ',
    'guide-changelog: skip —\n다른 줄의 설명', '본문에서 guide-changelog: skip — 예시'])
  ('rejects a missing or incidental skip reason: %s', (body) => {
    expect(checkAdminGuideChangelog({ files: ['components/admin/AdminSidebar.tsx'], body }).ok).toBe(false);
  });

  it('ignores guide, documentation, test and non-admin changes', () => {
    expect(checkAdminGuideChangelog({ files: [
      'README.md', 'lib/admin/guide/topics/goods-sales.ts',
      'components/admin/screens/AdminGuideTopicScreen.tsx',
      'app/admin/(shell)/guide/[topic]/page.tsx',
      'components/admin/screens/GoodsListScreen.test.tsx',
      'components/screens/GoodsShop.tsx',
      'app/styles/wc-admin-surfaces.css',
    ] }).ok).toBe(true);
  });

  it('checks every PR edit without redeploying and skips the guard on main pushes', async () => {
    const workflow = yaml.load(await readFile(new URL('../.github/workflows/pipeline.yml', import.meta.url), 'utf8'));
    const validation = workflow.jobs.validate;
    const guard = validation.steps.find((step) => step.run === 'node scripts/check-admin-guide-changelog.mjs');
    expect(guard?.if).toBe("github.event_name == 'pull_request'");
    expect(validation.if).toBeUndefined();
    expect(validation.steps.find((step) => step.uses?.startsWith('actions/checkout@')).with['fetch-depth']).toBe(0);
    expect(workflow.jobs['deploy-supabase-preview'].if).toContain("github.event.action != 'edited'");
    expect(workflow.jobs['deploy-supabase-preview'].if).toContain('github.event.changes.base != null');
  });
});
