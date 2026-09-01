import 'server-only';

import { orderReferenceLabel } from '@/lib/orders';
import { createClient } from '@/lib/supabase/server';
import {
  inquiryCategoryLabel,
  isInquiryCategory,
  isInquiryStatus,
  type InquiryCategory,
  type InquiryStatus,
} from '@/lib/inquiries';

/* 사용자 표면의 문의 로더(#253).
 *
 * 읽기는 RLS select로 한다 — 본인 행만 보이는 정책이 이미 걸려 있어 RPC를 하나 더
 * 두면 같은 규칙이 두 곳에 생긴다. 쓰기만 RPC다. */

const USER_UPLOADS_BUCKET = 'user-uploads';
const SIGNED_IMAGE_EXPIRES_IN_SECONDS = 60 * 60;

export interface InquiryMessageView {
  id: string;
  author: 'user' | 'staff';
  body: string;
  imageUrls: string[];
  createdAt: string;
}

export interface InquiryListItem {
  id: string;
  reference: number;
  category: InquiryCategory;
  categoryLabel: string;
  title: string;
  status: InquiryStatus;
  orderId: string | null;
  goodId: string | null;
  createdAt: string;
  lastMessageAt: string;
  answeredAt: string | null;
  closedAt: string | null;
}

export interface InquiryThreadView extends InquiryListItem {
  messages: InquiryMessageView[];
}

interface InquiryRow {
  id: string;
  reference: number;
  category: string;
  title: string;
  status: string;
  order_id: string | null;
  good_id: string | null;
  created_at: string;
  last_message_at: string;
  answered_at: string | null;
  closed_at: string | null;
}

interface MessageRow {
  id: string;
  author: string;
  body: string;
  image_paths: string[] | null;
  created_at: string;
}

const INQUIRY_COLUMNS =
  'id,reference,category,title,status,order_id,good_id,created_at,last_message_at,answered_at,closed_at';

/* 앱이 모르는 카테고리·상태는 목록에서 빼지 않고 안전한 값으로 접는다.
   행을 감추면 사용자가 자기가 보낸 문의를 잃어버린다. */
function toListItem(row: InquiryRow): InquiryListItem {
  const category = isInquiryCategory(row.category) ? row.category : 'etc';
  return {
    id: row.id,
    reference: row.reference,
    category,
    categoryLabel: inquiryCategoryLabel(category),
    title: row.title,
    status: isInquiryStatus(row.status) ? row.status : 'open',
    orderId: row.order_id,
    goodId: row.good_id,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    answeredAt: row.answered_at,
    closedAt: row.closed_at,
  };
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * 첨부 서명 URL.
 *
 * 버킷은 비공개다. 서명에 실패한 첨부는 조용히 빼지 않고 그대로 빠지지만, 본문은
 * 남는다 — 이미지 하나 때문에 대화 전체가 사라지는 편이 훨씬 나쁘다.
 */
async function signedImageUrls(supabase: SupabaseServerClient, paths: string[]) {
  const entries = await Promise.all(paths.map(async (path) => {
    const { data, error } = await supabase.storage
      .from(USER_UPLOADS_BUCKET)
      .createSignedUrl(path, SIGNED_IMAGE_EXPIRES_IN_SECONDS);
    return error || !data?.signedUrl ? null : ([path, data.signedUrl] as const);
  }));

  return new Map(entries.filter((entry): entry is [string, string] => entry !== null));
}

export async function loadMyInquiries(userId: string): Promise<InquiryListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('inquiries')
    .select(INQUIRY_COLUMNS)
    .eq('user_id', userId)
    .order('last_message_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(100);

  if (error) throw new Error(`Failed to load inquiries: ${error.message}`);
  return ((data ?? []) as InquiryRow[]).map(toListItem);
}

export async function loadMyInquiryThread(
  userId: string,
  inquiryId: string,
): Promise<InquiryThreadView | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('inquiries')
    .select(INQUIRY_COLUMNS)
    .eq('id', inquiryId)
    .eq('user_id', userId)
    .maybeSingle<InquiryRow>();

  if (error) throw new Error(`Failed to load inquiry: ${error.message}`);
  if (!data) return null;

  const { data: messageData, error: messageError } = await supabase
    .from('inquiry_messages')
    .select('id,author,body,image_paths,created_at')
    .eq('inquiry_id', inquiryId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (messageError) throw new Error(`Failed to load inquiry messages: ${messageError.message}`);

  const rows = (messageData ?? []) as MessageRow[];
  const urls = await signedImageUrls(
    supabase,
    [...new Set(rows.flatMap((row) => row.image_paths ?? []))],
  );

  return {
    ...toListItem(data),
    messages: rows.map((row) => ({
      id: row.id,
      author: row.author === 'staff' ? 'staff' : 'user',
      body: row.body,
      imageUrls: (row.image_paths ?? [])
        .map((path) => urls.get(path))
        .filter((url): url is string => typeof url === 'string'),
      createdAt: row.created_at,
    })),
  };
}

/** 마이페이지 카드의 경량 집계. 목록 전체를 읽지 않고 건수만 센다. */
export async function countOpenInquiries(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('inquiries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('status', 'closed');

  if (error) return 0;
  return count ?? 0;
}

export interface InquiryLinkTargets {
  orderId: string | null;
  orderLabel: string | null;
  goodId: string | null;
  goodName: string | null;
}

/**
 * 접수 폼이 미리 채울 연결 대상.
 *
 * 주문은 본인 것만 통과시킨다. DB의 create_inquiry도 같은 검사를 하지만, 여기서
 * 걸러야 남의 주문번호를 URL에 실은 사람이 "주문 …에 연결됨"이라는 확인 문구를
 * 보지 못한다 — 존재 여부를 알려주는 것 자체가 정보다.
 *
 * 굿즈는 공개 카탈로그라 존재 확인만 한다.
 */
export async function resolveInquiryLinkTargets(
  userId: string,
  input: { orderId?: string | null; goodId?: string | null },
): Promise<InquiryLinkTargets> {
  const supabase = await createClient();
  const targets: InquiryLinkTargets = {
    orderId: null,
    orderLabel: null,
    goodId: null,
    goodName: null,
  };

  if (input.orderId) {
    const { data } = await supabase
      .from('orders')
      .select('id')
      .eq('id', input.orderId)
      .eq('user_id', userId)
      .maybeSingle<{ id: string }>();
    if (data) {
      targets.orderId = data.id;
      /* 표기는 주문 화면과 같은 규칙을 쓴다 — 두 화면이 같은 주문을 다르게 부르면
         구매자가 옮겨 적은 번호가 운영자 검색에 걸리지 않는다. */
      targets.orderLabel = orderReferenceLabel(data.id);
    }
  }

  if (input.goodId) {
    const { data } = await supabase
      .from('goods')
      .select('id,name')
      .eq('id', input.goodId)
      // 판매 제한(19금) 상품은 비노출 표면과 같은 취급 — 문의 컨텍스트가
      // 상품명을 되돌려주는 우회 노출을 막는다(#392).
      .eq('sale_restriction', 'none')
      .maybeSingle<{ id: string; name: string }>();
    if (data) {
      targets.goodId = data.id;
      targets.goodName = data.name;
    }
  }

  return targets;
}
