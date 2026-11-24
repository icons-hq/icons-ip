import type { NextConfig } from "next";
// Next 기본 HTML 제한 봇 정규식이다. 공개 API가 아닌 내부 경로라, 업그레이드로 옮겨지면 목록이 조용히 어긋나는 대신
// 타입 검사와 설정 로드가 실패한다. `.js`까지 적어야 Node 네이티브 TS 로더(ESM)에서도 풀린다.
import { HTML_LIMITED_BOT_UA_RE } from "next/dist/shared/lib/router/utils/html-bots.js";

const nextConfig: NextConfig = {
  // Financial requests are capped at 2 MiB before dispatch; leave room for Action framing.
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
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
  // 옛 /gacha → /packs 영구 이동은 2026-11-24 카드팩 화면 삭제(ADR-0052)와 함께 지웠다 — 두 주소 모두 404 다.
  // 이 UA에는 메타데이터(OG 포함)를 본문으로 스트리밍하지 않고 첫 응답의 <head>에 넣는다. JS를 실행하지 않는
  // 수집기는 본문으로 늦게 오는 메타를 못 읽을 수 있다. 지정하면 Next 기본 목록을 대체하므로 기본 정규식 뒤에 덧붙인다.
  // kakaotalk-scrap: 카카오톡 링크 미리보기 스크랩 서버의 공식 식별자(https://devtalk.kakao.com/t/scrap/33984).
  // Daumoa·Daum/4.1: 다음 검색 수집기. Next는 source 문자열만 넘겨 대소문자 무시로 다시 만든다(플래그는 무의미).
  htmlLimitedBots: new RegExp(
    [HTML_LIMITED_BOT_UA_RE.source, 'kakaotalk-scrap', 'Daumoa', 'Daum[ /]\\d'].join('|'),
    'i',
  ),
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
