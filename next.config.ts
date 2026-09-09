import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/prototypes/tusin-survival/assets/*': [
      './private-assets/tusin-survival/**/*',
    ],
  },
  async redirects() {
    // 유료 뽑기 화면(/gacha)을 카드팩 개봉 화면으로 재목적화(#71) — 구 링크 보존
    return [{ source: '/gacha', destination: '/packs', permanent: true }];
  },
  // Pin the workspace root to this project (a stray lockfile lives in the home dir).
  turbopack: {
    root: import.meta.dirname,
    resolveAlias: {
      // box2d-wasm emscripten 글루의 node 분기(require("fs"/"path"))를 브라우저 번들에서 빈 셤으로 대체.
      // 런타임은 브라우저에서 그 분기에 진입하지 않는다(wasm은 /box2d/ 정적 자산에서 fetch).
      fs: { browser: './lib/shims/empty.js' },
      path: { browser: './lib/shims/empty.js' },
    },
  },
};

export default nextConfig;
