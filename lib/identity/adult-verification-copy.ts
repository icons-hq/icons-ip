import type { AdultVerificationResultStatus } from './adult-verification-routes';

/*
 * 성인 인증 결과 문구. 결과 화면(페이지 전환)과 인증 화면의 인라인 안내(팝업)가 같은
 * 문장을 쓴다. 미성년 판정 문구는 생년월일이나 나이를 되풀이하지 않는다 — 결과 화면은
 * 다른 사람이 볼 수도 있는 화면이다.
 */
export const ADULT_VERIFICATION_RESULT_COPY: Record<AdultVerificationResultStatus, { title: string; description: string }> = {
  verified: {
    title: '성인 인증이 완료됐어요',
    description: '이제 19금 굿즈를 보고 구매할 수 있어요. 인증은 1년 동안 유지돼요.',
  },
  underage: {
    title: '성인 인증을 완료할 수 없어요',
    description: '본인확인 결과 청소년 보호법상 청소년으로 확인됐어요. 19금 굿즈는 만 19세가 되는 해의 1월 1일부터 구매할 수 있어요.',
  },
  failed: {
    title: '본인확인을 완료하지 못했어요',
    description: '인증을 취소했거나 확인하는 중에 문제가 생겼어요. 처음부터 다시 시도해 주세요.',
  },
  expired: {
    title: '인증 시간이 지났어요',
    description: '인증 창을 연 지 30분이 지났거나 새 인증을 시작했어요. 처음부터 다시 진행해 주세요.',
  },
  pending: {
    title: '인증 결과를 확인하고 있어요',
    description: '잠시 뒤 성인 인증 화면에서 결과를 다시 확인해 주세요.',
  },
  invalid: {
    title: '유효하지 않은 인증 요청이에요',
    description: '인증을 시작한 화면에서 처음부터 다시 시도해 주세요.',
  },
  login_required: {
    title: '로그인이 필요해요',
    description: '인증을 시작한 계정으로 로그인한 같은 브라우저에서 다시 시도해 주세요.',
  },
  error: {
    title: '일시적인 문제로 인증을 마치지 못했어요',
    description: '잠시 뒤 처음부터 다시 시도해 주세요.',
  },
};
