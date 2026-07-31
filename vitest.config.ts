import { fileURLToPath } from 'node:url';

import { configDefaults, defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');

export default defineConfig({
  resolve: {
    /* 배열 형태여야 한다. 문자열 키 '@'는 접두 치환이라 '@supabase/ssr' 같은 스코프 패키지까지 망가뜨린다. */
    alias: [
      { find: /^@\//, replacement: `${root}/` },
      /* server-only는 node에서 import되면 throw한다. 테스트에서는 빈 모듈로 대체한다. */
      { find: /^server-only$/, replacement: `${root}/test/stubs/server-only.ts` },
    ],
  },
  test: {
    /* prototypes는 자체 vite/playwright 프로젝트라 vitest가 주워 담으면 실패하고,
       .worktrees와 .claude/worktrees는 저장소 사본이라 같은 테스트를 워크트리 수만큼
       중복 실행한다. 전부 .gitignore 대상이지만 vitest는 .gitignore를 보지 않는다. */
    exclude: [...configDefaults.exclude, 'prototypes/**', '.worktrees/**', '.claude/**'],
  },
});
