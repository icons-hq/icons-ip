import 'server-only';

import { createHash } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { unstable_cache } from 'next/cache';
import { HOME_CURATION_IMAGE_PATTERN, isSafeInternalLink } from './home-catalog';
import { IMAGE_SIZE_PROBE_BYTES, imageSizeFromBytes, type ImageSize } from './image-size';
import { normalizePublicMediaPath, PUBLIC_MEDIA_BUCKET } from './media';
import { getSupabaseConfig } from './supabase/config';
import { publicIpHref } from './ip-identity';
import { parsePublicIpLink, resolvePublicIpIdentity } from './ip-identity.server';
import {
  EMPTY_SHELL_NOTICES,
  parseShellNoticePageTypes,
  type ShellNoticeBar,
  type ShellNotices,
  type ShellNoticeStrip,
} from './shell-notices';

export type { ShellNotices } from './shell-notices';

interface ShellNoticeRow {
  id: string;
  kind: 'notice_bar' | 'notice_strip';
  title: string;
  image_path: string | null;
  link_path: string | null;
  active_to: string | null;
  payload: Record<string, unknown> | null;
}

export const NOTICE_STRIP_CACHE_TAG = 'home-curations';

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

/* 노출 종료 시각 → epoch ms. 셸 공지는 하드 로드 때만 내려오므로 열린 화면은 이 시각으로 직접 숨긴다(ShellNotices). */
function noticeEndsAt(row: ShellNoticeRow): number | null {
  if (!row.active_to) return null;
  const endsAt = Date.parse(row.active_to);
  return Number.isFinite(endsAt) ? endsAt : null;
}

type ServerClient = ReturnType<typeof createServerClient>;

/* 공개 IP 링크는 공지에 저장된 옛 주소 대신 현재 공개 주소로 보낸다. */
async function currentPublicHref(href: string, supabase: ServerClient): Promise<string> {
  const ipReference = parsePublicIpLink(href);
  if (!ipReference) return href;
  // Reuse this cookie-free client inside the cached global shell read.
  const identity = await resolvePublicIpIdentity(ipReference.slug, supabase);
  return identity ? publicIpHref(identity.publicSlug) + ipReference.suffix : href;
}

/* 닫힘 키는 행 ID + 고객이 보는 내용의 짧은 지문이다 — 순서·기간만 고쳤을 때는 닫힘을 유지하고,
   문구·버튼·대상을 바꾸면 새 공지로 다시 보인다. */
function noticeBarKey(id: string, message: string, cta: ShellNoticeBar['cta'], pageTypes: readonly string[]) {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([message, cta?.label ?? null, cta?.href ?? null, pageTypes]))
    .digest('hex')
    .slice(0, 12);
  return `${id}:${fingerprint}`;
}

async function toNoticeBar(row: ShellNoticeRow, supabase: ServerClient): Promise<ShellNoticeBar | null> {
  const message = row.title.trim();
  const length = Array.from(message).length;
  const pageTypes = parseShellNoticePageTypes(row.payload?.page_types);
  if (length < 1 || length > 60 || CONTROL_CHARACTER.test(message) || !pageTypes || row.image_path) return null;

  const label = typeof row.payload?.cta_label === 'string' ? row.payload.cta_label.trim() : null;
  const link = row.link_path?.trim() || null;
  let cta: ShellNoticeBar['cta'] = null;
  if (link || label) {
    // 버튼과 목적지는 함께여야 한다(DB home_curations_notice_check와 같은 규칙).
    if (!link || !label || Array.from(label).length > 12 || CONTROL_CHARACTER.test(label) || !isSafeInternalLink(link)) return null;
    cta = { label, href: await currentPublicHref(link, supabase) };
  }
  return { id: row.id, key: noticeBarKey(row.id, message, cta, pageTypes), message, cta, pageTypes, endsAt: noticeEndsAt(row) };
}

/* 띠배너 높이는 이미지 비율로만 정해진다 — 크기를 모른 채 그리면 이미지가 첫 페인트 뒤에 올 때 띠가 0 에서 펼쳐지며 본문을 민다
   (셸 QA 2026-10-27: 이미지가 600ms 늦으면 모바일 CLS 0.05). 캐시된 셸 읽기(5분) 안에서 머리 바이트만 받아 고유 크기를 읽는다.
   실패·시간 초과는 null 로 수렴한다 — 크기 속성 없이 그리던 그대로다. */
async function imageSizeAt(url: string): Promise<ImageSize | null> {
  try {
    const response = await fetch(url, { headers: { Range: `bytes=0-${IMAGE_SIZE_PROBE_BYTES - 1}` }, signal: AbortSignal.timeout(3000) });
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    const bytes = new Uint8Array(IMAGE_SIZE_PROBE_BYTES);
    let size = 0;
    while (size < bytes.length) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = value.subarray(0, bytes.length - size);
      bytes.set(part, size);
      size += part.byteLength;
    }
    // Range 를 무시하고 전체를 보내는 서버라도 머리만 읽고 끊는다.
    await reader.cancel().catch(() => {});
    return imageSizeFromBytes(bytes.subarray(0, size));
  } catch {
    return null;
  }
}

async function toNoticeStrip(
  row: ShellNoticeRow,
  supabase: ServerClient,
  publicUrlFor: (path: string) => string,
): Promise<ShellNoticeStrip | null> {
  const title = row.title.trim();
  const href = row.link_path?.trim() ?? '';
  const pageTypes = parseShellNoticePageTypes(row.payload?.page_types);
  if (!title || Array.from(title).length > 120 || !isSafeInternalLink(href) || pageTypes === null) return null;
  if (!row.image_path || !HOME_CURATION_IMAGE_PATTERN.test(row.image_path)) return null;
  const mobileImagePath = row.payload?.mobile_image_path;
  const imageUrl = publicUrlFor(row.image_path);
  const mobileImageUrl = typeof mobileImagePath === 'string' && HOME_CURATION_IMAGE_PATTERN.test(mobileImagePath)
    ? publicUrlFor(mobileImagePath)
    : null;
  const [imageSize, mobileImageSize, publicHref] = await Promise.all([
    imageSizeAt(imageUrl),
    mobileImageUrl ? imageSizeAt(mobileImageUrl) : null,
    currentPublicHref(href, supabase),
  ]);

  return {
    id: row.id,
    title,
    imageUrl,
    imageSize,
    mobileImageUrl,
    mobileImageSize,
    href: publicHref,
    pageTypes: pageTypes ?? null,
    endsAt: noticeEndsAt(row),
  };
}

/*
 * 전역 셸의 공지(텍스트 공지 바·이미지 스트립)는 루트 레이아웃에서 내려간다. 여기서 cookies() 기반
 * 서버 클라이언트를 쓰면 legal 라우트의 SSG 가 전부 dynamic 으로 무너지는 것이
 * 실측돼 있어(#325), 쿠키 없는 anon 클라이언트로 읽고 unstable_cache 로
 * 빌드·시간 재검증한다. 어드민 큐레이션 저장이 updateTag 로 즉시 갱신한다.
 * 그래서 화면 유형·같은 탭 닫힘·스트립 무작위 선택은 요청이 아니라 클라이언트가 정한다 —
 * 유효한 공지 전체(현재 노출 창 안)를 운영 순서대로, 열린 화면이 종료 시각에 숨길 수 있게 종료 시각과 함께 돌려준다.
 * 실패는 공지 없음으로 조용히 수렴한다 — 셸이 데이터 문제로 깨지면 안 된다.
 */
async function loadShellNotices(): Promise<ShellNotices> {
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured || !url || !key) return EMPTY_SHELL_NOTICES;

  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // 익명 읽기 전용 — 세션 쿠키를 다루지 않는다.
        },
      },
    });
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('home_curations')
      .select('id,kind,title,image_path,link_path,active_to,payload')
      .in('kind', ['notice_bar', 'notice_strip'])
      .eq('enabled', true)
      .lte('active_from', now)
      .or(`active_to.is.null,active_to.gt.${now}`)
      .order('display_order', { ascending: true })
      .order('active_from', { ascending: true })
      .order('id', { ascending: true });

    if (error || !Array.isArray(data)) return EMPTY_SHELL_NOTICES;

    const publicUrlFor = (path: string) => supabase.storage
      .from(PUBLIC_MEDIA_BUCKET)
      .getPublicUrl(normalizePublicMediaPath(path)).data.publicUrl;
    const rows = data as ShellNoticeRow[];
    const [bars, strips] = await Promise.all([
      Promise.all(rows.filter((row) => row.kind === 'notice_bar').map((row) => toNoticeBar(row, supabase))),
      Promise.all(rows.filter((row) => row.kind === 'notice_strip').map((row) => toNoticeStrip(row, supabase, publicUrlFor))),
    ]);
    return {
      bars: bars.filter((bar): bar is ShellNoticeBar => bar !== null),
      strips: strips.filter((strip): strip is ShellNoticeStrip => strip !== null),
    };
  } catch {
    return EMPTY_SHELL_NOTICES;
  }
}

/* 캐시 키를 이전 단일 스트립 로더('home-notice-strip')와 분리한다 — 응답 모양이 바뀌었다. */
export const getShellNotices = unstable_cache(
  loadShellNotices,
  ['shell-notices'],
  { revalidate: 300, tags: [NOTICE_STRIP_CACHE_TAG] },
);
