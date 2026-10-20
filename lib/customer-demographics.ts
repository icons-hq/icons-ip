import { isUuid } from './uuid';
import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from './goods-transaction-values';

export const DEMOGRAPHIC_API = '/api/customer-demographics';
export const DEMOGRAPHIC_NOTICE_VERSION = 'customer-demographics-v1';
export const DEMOGRAPHIC_GENDERS = ['female', 'male', 'other'] as const;
export type DemographicGender = typeof DEMOGRAPHIC_GENDERS[number];
export const DEMOGRAPHIC_GENDER_LABELS = { female: '여성', male: '남성', other: '기타', undisclosed: '미제공' } as const;
export const DEMOGRAPHIC_NOTICE = {
  title: '성별 정보 수집·이용 동의',
  purpose: '성별·연령별 고객 구성과 구매 통계를 분석하여 굿즈와 서비스를 개선합니다. 성별을 마케팅 대상 선정에 사용하지 않습니다.',
  collected: '직접 선택한 성별, 회원번호, 동의 여부·동의 시각·안내 버전을 저장합니다. 연령대는 기존 생년월일로 계산하며, 이름이나 연락처에서 성별을 추정하지 않습니다.',
  retention: '성별은 동의 철회 또는 탈퇴 신청까지 보관합니다. 철회 즉시 성별 값을 삭제하고 성별 분류에서 제외합니다. 기존 생년월일에 따른 연령대에는 미제공으로 집계될 수 있습니다. 거부 여부와 변경 버전은 계정 삭제 시까지 보관하여 이전 요청으로 동의가 복원되지 않게 합니다.',
  choice: '선택 동의이며 거부해도 가입·쇼핑·구매에 불이익이 없습니다. 설정에서 언제든 변경·철회할 수 있습니다. 마케팅 수신·회원 방문 분석 동의와는 별개입니다. 관리자에게는 개인별 성별이 아닌 10명 이상 집계만 제공합니다.',
} as const;
export interface DemographicIdentity { actorId: string; sessionId: string; revision: number }
export interface DemographicState extends DemographicIdentity {
  choice: 'unset' | 'accepted' | 'declined'; gender: DemographicGender | null;
  noticeVersion: typeof DEMOGRAPHIC_NOTICE_VERSION; acceptedAt: string | null;
}
export function parseDemographicIdentity(value: unknown): DemographicIdentity | null {
  return transactionRecord(value) && transactionExactKeys(value, ['actorId', 'sessionId', 'revision'])
    && isUuid(value.actorId) && isUuid(value.sessionId) && transactionInteger(value.revision)
    ? { actorId: value.actorId, sessionId: value.sessionId, revision: value.revision } : null;
}
export function isDemographicGender(value: unknown): value is DemographicGender {
  return DEMOGRAPHIC_GENDERS.includes(value as DemographicGender);
}
export function parseDemographicState(value: unknown): DemographicState | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['actorId', 'sessionId', 'revision', 'choice', 'gender', 'noticeVersion', 'acceptedAt'])
    || !parseDemographicIdentity({ actorId: value.actorId, sessionId: value.sessionId, revision: value.revision })
    || !['unset', 'accepted', 'declined'].includes(String(value.choice)) || value.noticeVersion !== DEMOGRAPHIC_NOTICE_VERSION
    || (value.choice === 'unset') !== (value.revision === 0)
    || (value.choice === 'accepted' ? !isDemographicGender(value.gender) || !transactionInstant(value.acceptedAt)
      : value.gender !== null || value.acceptedAt !== null)) return null;
  return value as unknown as DemographicState;
}
