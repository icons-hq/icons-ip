import { isUuid } from './uuid';
import { analyticsPage, PAGE_LABELS, type AnalyticsPage } from './store-analytics';
import { transactionExactKeys, transactionInteger, transactionRecord, transactionInstant } from './goods-transaction-values';

export const MEMBER_ACTIVITY_API = '/api/member-activity';
export const MEMBER_ACTIVITY_NOTICE_VERSION = 'member-activity-v1';
export const MEMBER_ACTIVITY_CHANGED = 'icons:member-activity-changed';
export interface MemberActivityIdentity { actorId: string; sessionId: string; revision: number }
export interface MemberActivityState extends MemberActivityIdentity { enabled: boolean; choice: 'unset' | 'accepted' | 'declined'; noticeVersion: typeof MEMBER_ACTIVITY_NOTICE_VERSION; acceptedAt: string | null }
export interface MemberActivityEvent { eventId: string; kind: 'visit' | 'video_started' | 'video_completed'; pageKind: AnalyticsPage['kind']; targetId: string; assetId: string | null }
export const MEMBER_ACTIVITY_NOTICE = {
  title: '회원 방문·영상 이용 분석 동의',
  summary: '회원별 관심 상품과 방문·영상 이용을 살펴 맞춤 혜택 대상과 서비스를 개선하기 위한 선택 동의입니다.',
  collected: '회원번호, 공개 화면 유형과 상품·IP·분류 등의 식별번호, 영상 식별번호와 재생 시작·완료 여부, 관측 시각을 저장합니다. 이메일·이름·IP 주소·전체 URL·검색어는 이 기록에 저장하지 않습니다.',
  retention: '원시 이용 기록은 한국 날짜 기준 최근 90일 동안 보관합니다. 동의를 철회하면 수집을 중단하고 회원에게 연결된 기존 원시 이용 기록을 삭제합니다.',
  choice: '동의하지 않아도 쇼핑과 구매를 이용할 수 있습니다. 익명 방문 통계와 마케팅 정보 수신 동의는 각각 별개입니다. 알림·마케팅 메시지는 해당 수신 동의가 있는 경우에만 보낼 수 있습니다. 설정에서 언제든 동의를 바꿀 수 있습니다.',
} as const;
export function parseMemberActivityIdentity(value: unknown): MemberActivityIdentity | null {
  return transactionRecord(value) && transactionExactKeys(value, ['actorId', 'sessionId', 'revision']) && isUuid(value.actorId) && isUuid(value.sessionId) && transactionInteger(value.revision)
    ? { actorId: value.actorId, sessionId: value.sessionId, revision: value.revision } : null;
}
export function parseMemberActivityState(value: unknown): MemberActivityState | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['actorId', 'sessionId', 'revision', 'enabled', 'choice', 'noticeVersion', 'acceptedAt'])
    || !parseMemberActivityIdentity({ actorId: value.actorId, sessionId: value.sessionId, revision: value.revision }) || typeof value.enabled !== 'boolean'
    || !['unset', 'accepted', 'declined'].includes(String(value.choice)) || value.noticeVersion !== MEMBER_ACTIVITY_NOTICE_VERSION
    || (value.choice === 'accepted' ? !transactionInstant(value.acceptedAt) : value.acceptedAt !== null)
    || (value.choice === 'unset') !== (value.revision === 0)) return null;
  return value as unknown as MemberActivityState;
}
export function parseMemberActivityEvent(value: unknown): MemberActivityEvent | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['eventId', 'kind', 'pageKind', 'targetId', 'assetId']) || !isUuid(value.eventId)
    || !['visit', 'video_started', 'video_completed'].includes(String(value.kind)) || typeof value.pageKind !== 'string' || !Object.hasOwn(PAGE_LABELS, value.pageKind)
    || typeof value.targetId !== 'string' || (value.kind === 'visit' ? value.assetId !== null : !isUuid(value.assetId) || value.pageKind !== 'good')) return null;
  const path = value.pageKind === 'home' ? '/' : value.pageKind === 'shop' ? '/shop' : value.pageKind === 'stories' ? '/stories' : value.pageKind === 'events' ? '/events'
    : `/${value.pageKind === 'good' ? 'shop' : value.pageKind === 'story' ? 'stories' : value.pageKind === 'event' ? 'events' : 'ip'}/${value.targetId}`;
  const page = analyticsPage(path, new URLSearchParams(value.pageKind === 'shop' ? { category: value.targetId } : {}));
  if (!page || page.kind !== value.pageKind || page.target !== value.targetId && !(value.pageKind === 'shop' && ['new', 'best'].includes(value.targetId))) return null;
  return value as unknown as MemberActivityEvent;
}
export const memberActivityIdentity = ({ actorId, sessionId, revision }: MemberActivityIdentity): MemberActivityIdentity => ({ actorId, sessionId, revision });
