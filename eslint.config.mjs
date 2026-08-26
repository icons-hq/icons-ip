import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "docs/claude-design/project/support.js",
    "docs/claude-design/project/assets/**",
    "design/handoff/**",
    "next-env.d.ts",
    // 로컬 전용 디렉터리 — git worktree 사본과 별도 vite 프로토타입이라 이 저장소의 lint 대상이 아니다.
    ".worktrees/**",
    "prototypes/**",
    // Last Bell ships the official Basis transcoder as generated runtime data.
    // It is minified vendor output rather than application source.
    "public/generated/last-bell/3d/basis/**",
    // Recoverable Blender delivery stages and prior generated packs live
    // outside the application source tree and may contain the same vendor JS.
    "outputs/last-bell-3d/**",
  ]),
]);

export default eslintConfig;
