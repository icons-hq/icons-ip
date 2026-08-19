import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  isInquiryCategory,
  isInquiryStatus,
  type InquiryCategory,
  type InquiryStatus,
} from '@/lib/inquiries';
import {
  ADMIN_INQUIRY_PAGE_SIZE,
  adminInquiryBuyerLabel,
  type AdminInquiryConsoleData,
  type AdminInquiryFilters,
  type AdminInquiryRow,
} from './inquiries';

/* 어드민 문의 큐·상세 로더(#253).
 *
 * 목록과 집계는 staff 게이트가 붙은 RPC로만 읽는다. 컨텍스트 패널(연결 주문·구매자
 * 이력)도 RPC 하나로 받는다 — CS가 화면을 옮기지 않고 맥락을 보는 것이 상세 화면의
 * 존재 이유라, 다섯 번의 왕복이 아니라 한 번의 왕복으로 만든다. */

const USER_UPLOADS_BUCKET = 'user-uploads';
const SIGNED_IMAGE_EXPIRES_IN_SECONDS = 60 * 60;

interface QueueRow {
  id: string;
  reference: number;
  category: string;
  title: string;
  status: string;
  user_id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  order_id: string | null;
  good_id: string | null;
  good_name: string | null;
  handled_by: string | null;
  handler_name: string | null;
  created_at: string;
  last_message_at: string;
  answered_at: string | null;
  closed_at: string | null;
  message_count: number | string;
  total_count: number | string;
}

/** admin_inquiry_status_counts의 행. OUT 파라미터 이름이 `count`면 plpgsql이
 *  본문의 `count(*)`와 충돌해 모호성 오류를 낸다 — 그래서 `total`이다. */
interface StatusCountRow {
  status: string;
  total: number | string;
}

function toNumber(value: number | string | null | undefined) {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function toRow(row: QueueRow): AdminInquiryRow {
  return {
    id: row.id,
    reference: row.reference,
    category: (isInquiryCategory(row.category) ? row.category : 'etc') as InquiryCategory,
    title: row.title,
    status: (isInquiryStatus(row.status) ? row.status : 'open') as InquiryStatus,
    buyerName: adminInquiryBuyerLabel(row.buyer_name, row.user_id),
    buyerEmail: row.buyer_email,
    orderId: row.order_id,
    goodId: row.good_id,
    goodName: row.good_name,
    handlerName: row.handler_name?.trim() || null,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    answeredAt: row.answered_at,
    messageCount: toNumber(row.message_count),
  };
}

export async function getAdminInquiryConsoleData(
  filters: AdminInquiryFilters,
): Promise<AdminInquiryConsoleData> {
  const supabase = await createClient();

  const [listResult, countResult] = await Promise.all([
    supabase.rpc('admin_search_inquiries', {
      p_category: filters.category === 'all' ? null : filters.category,
      p_field: filters.field,
      p_from: filters.from,
      p_limit: ADMIN_INQUIRY_PAGE_SIZE,
      p_offset: (filters.page - 1) * ADMIN_INQUIRY_PAGE_SIZE,
      p_query: filters.query || null,
      p_status: filters.status === 'all' ? null : filters.status,
      p_to: filters.to,
    }),
    supabase.rpc('admin_inquiry_status_counts'),
  ]);

  if (listResult.error) {
    throw new Error(`Failed to load inquiries: ${listResult.error.message}`);
  }
  if (countResult.error) {
    throw new Error(`Failed to count inquiries: ${countResult.error.message}`);
  }

  const counts: Record<InquiryStatus, number> = { open: 0, answered: 0, closed: 0 };
  for (const entry of (countResult.data ?? []) as StatusCountRow[]) {
    if (isInquiryStatus(entry.status)) counts[entry.status] = toNumber(entry.total);
  }

  const rows = (listResult.data ?? []) as QueueRow[];

  return {
    counts,
    filters,
    pageSize: ADMIN_INQUIRY_PAGE_SIZE,
    rows: rows.map(toRow),
    total: rows.length ? toNumber(rows[0].total_count) : 0,
  };
}

/** 사이드바 미답변 배지. 셸 layout이 화면마다 부르므로 집계 한 번으로 끝낸다. */
export async function getAdminOpenInquiryCount(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_inquiry_status_counts');
  if (error) return 0;

  const entry = ((data ?? []) as StatusCountRow[]).find((row) => row.status === 'open');
  return toNumber(entry?.total);
}

export interface AdminInquiryMessage {
  id: string;
  author: 'user' | 'staff';
  authorName: string | null;
  body: string;
  imageUrls: string[];
  createdAt: string;
}

export interface AdminInquiryOrderContext {
  id: string;
  status: string;
  total: number;
  createdAt: string;
  shippingCarrier: string | null;
  trackingNumber: string | null;
  itemCount: number;
  leadItemName: string | null;
  payment: { provider: string | null; status: string; amount: number } | null;
  claims: {
    status: string;
    requestedAt: string;
    decidedAt: string | null;
    reasonType: string | null;
  }[];
}

export interface AdminInquiryBuyerContext {
  id: string;
  nickname: string | null;
  email: string | null;
  suspendedAt: string | null;
  orderCount: number;
  inquiryCount: number;
  openInquiryCount: number;
}

export interface AdminInquiryDetail {
  inquiry: AdminInquiryRow & { closedAt: string | null; userId: string };
  messages: AdminInquiryMessage[];
  order: AdminInquiryOrderContext | null;
  buyer: AdminInquiryBuyerContext;
  templates: AdminInquiryReplyTemplate[];
}

export interface AdminInquiryReplyTemplate {
  id: string;
  title: string;
  body: string;
}

interface ThreadRow {
  id: string;
  reference: number;
  category: string;
  title: string;
  status: string;
  user_id: string;
  order_id: string | null;
  good_id: string | null;
  handled_by: string | null;
  created_at: string;
  last_message_at: string;
  answered_at: string | null;
  closed_at: string | null;
}

interface MessageRow {
  id: string;
  author: string;
  author_id: string;
  body: string;
  image_paths: string[] | null;
  created_at: string;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function signedImageUrls(supabase: SupabaseServerClient, paths: string[]) {
  const entries = await Promise.all(paths.map(async (path) => {
    const { data, error } = await supabase.storage
      .from(USER_UPLOADS_BUCKET)
      .createSignedUrl(path, SIGNED_IMAGE_EXPIRES_IN_SECONDS);
    return error || !data?.signedUrl ? null : ([path, data.signedUrl] as const);
  }));
  return new Map(entries.filter((entry): entry is [string, string] => entry !== null));
}

export async function loadAdminInquiryReplyTemplates(): Promise<AdminInquiryReplyTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('inquiry_reply_templates')
    .select('id,title,body')
    .order('title', { ascending: true })
    .limit(50);

  if (error) return [];
  return (data ?? []) as AdminInquiryReplyTemplate[];
}

export async function loadAdminInquiryDetail(
  inquiryId: string,
): Promise<AdminInquiryDetail | null> {
  const supabase = await createClient();

  /* 상세는 목록 RPC를 재사용하지 않는다. 큐 RPC는 페이지 단위라 100건 밖의 문의를
     열면 조용히 404가 된다 — 오래된 문의일수록 깊이 묻히는 화면에서 최악의 실패다. */
  const { data: threadData, error: threadError } = await supabase
    .from('inquiries')
    .select(
      'id,reference,category,title,status,user_id,order_id,good_id,handled_by,'
      + 'created_at,last_message_at,answered_at,closed_at',
    )
    .eq('id', inquiryId)
    .maybeSingle<ThreadRow>();

  if (threadError) throw new Error(`Failed to load inquiry: ${threadError.message}`);
  if (!threadData) return null;

  const [messageResult, contextResult, handlerResult, goodResult, templates] = await Promise.all([
    supabase
      .from('inquiry_messages')
      .select('id,author,author_id,body,image_paths,created_at')
      .eq('inquiry_id', inquiryId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
    supabase.rpc('admin_inquiry_context', { target_inquiry_id: inquiryId }),
    threadData.handled_by
      ? supabase.from('profiles').select('nickname').eq('id', threadData.handled_by).maybeSingle<{ nickname: string | null }>()
      : Promise.resolve({ data: null, error: null }),
    threadData.good_id
      ? supabase.from('goods').select('name').eq('id', threadData.good_id).maybeSingle<{ name: string }>()
      : Promise.resolve({ data: null, error: null }),
    loadAdminInquiryReplyTemplates(),
  ]);

  if (messageResult.error) {
    throw new Error(`Failed to load inquiry messages: ${messageResult.error.message}`);
  }
  if (contextResult.error) return null;

  const messageRows = (messageResult.data ?? []) as MessageRow[];
  const urls = await signedImageUrls(
    supabase,
    [...new Set(messageRows.flatMap((message) => message.image_paths ?? []))],
  );

  const context = (contextResult.data ?? {}) as {
    order?: AdminInquiryOrderContext | null;
    buyer?: AdminInquiryBuyerContext;
  };
  const buyer = context.buyer ?? {
    id: threadData.user_id,
    nickname: null,
    email: null,
    suspendedAt: null,
    orderCount: 0,
    inquiryCount: 0,
    openInquiryCount: 0,
  };

  return {
    inquiry: {
      id: threadData.id,
      reference: threadData.reference,
      category: (isInquiryCategory(threadData.category) ? threadData.category : 'etc') as InquiryCategory,
      title: threadData.title,
      status: (isInquiryStatus(threadData.status) ? threadData.status : 'open') as InquiryStatus,
      buyerName: adminInquiryBuyerLabel(buyer.nickname, threadData.user_id),
      buyerEmail: buyer.email,
      orderId: threadData.order_id,
      goodId: threadData.good_id,
      goodName: goodResult.data?.name ?? null,
      handlerName: handlerResult.data?.nickname?.trim() || null,
      createdAt: threadData.created_at,
      lastMessageAt: threadData.last_message_at,
      answeredAt: threadData.answered_at,
      messageCount: messageRows.length,
      closedAt: threadData.closed_at,
      userId: threadData.user_id,
    },
    messages: messageRows.map((message) => ({
      id: message.id,
      author: message.author === 'staff' ? 'staff' : 'user',
      authorName: message.author === 'staff' ? 'ICONS 운영자' : null,
      body: message.body,
      imageUrls: (message.image_paths ?? [])
        .map((path) => urls.get(path))
        .filter((url): url is string => typeof url === 'string'),
      createdAt: message.created_at,
    })),
    order: context.order ?? null,
    buyer,
    templates,
  };
}
