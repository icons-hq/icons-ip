import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 시연 미디어는 public으로 복사하지 않고 권한을 검사하는 단일 함수에만 포함한다.
  outputFileTracingIncludes: {
    '/ip-popups/aouad/\\[...asset\\]': ['./private/ip-popups/aouad/**/*'],
    '/ip-popups/aouad/hyosan/\\[...asset\\]': ['./private/ip-popups/aouad-hyosan/**/*'],
  },
  // The automatic filesystem trace can include sibling media roots in both functions.
  outputFileTracingExcludes: {
    '/ip-popups/aouad/\\[...asset\\]': ['./private/ip-popups/aouad-hyosan/**/*'],
    '/ip-popups/aouad/hyosan/\\[...asset\\]': ['./private/ip-popups/aouad/**/*'],
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
