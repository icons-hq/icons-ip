'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { beginOverseasRequest, cancelOverseasRequest } from '@/app/my/adult-verification/overseas/actions';
import type { OverseasIntakeStatus, OverseasRequest } from '@/lib/identity/overseas-adult';
import { OverseasPhotoForm } from './OverseasPhotoForm';

const outcomes = {
  approved: '심사 완료 / Approved',
  rejected: '자료를 확인하기 어려워요 / ID could not be verified',
  underage: '성인 연령 기준에 도달하지 않았어요 / Age requirement not met',
  expired: '신청 시간이 지났어요 / Request expired',
  cancelled: '신청을 취소했어요 / Request cancelled',
};
export function OverseasAdultRequest({
  intakeStatus,
  request,
  next,
  approved,
}: {
  approved: boolean;
  intakeStatus: OverseasIntakeStatus;
  request: OverseasRequest | null;
  next: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState('');
  const open = intakeStatus === 'open';
  const active = request && request.state !== 'closed';
  const act = (perform: () => Promise<boolean>) =>
    start(async () => {
      try {
        setNotice(
          (await perform())
            ? ''
            : '신청 상태를 확인해 주세요. 하루 세 번까지 신청할 수 있어요. / Check the status. Up to three requests per day.',
        );
      } catch {
        setNotice('새로고침해서 신청 상태를 확인해 주세요. / Refresh to check the status.');
      }
      router.refresh();
    });
  return (
    <div className="grid max-w-2xl gap-5">
      {!open && !approved && (!active || request?.state === 'draft') && (
        <p role="status">
          {intakeStatus === 'policy_pending'
            ? '개인정보처리방침 시행 후 사진을 제출할 수 있어요. / Photo submissions begin when the privacy policy takes effect.'
            : intakeStatus === 'store_closed'
              ? '19금 상품 판매가 중단되어 신분증 신청 접수도 일시 중단됐어요. / Applications are paused while age-restricted products are unavailable.'
              : '현재 신분증 심사가 일시 중단됐어요. 나중에 다시 신청해 주세요. / ID reviews are temporarily paused. Please check back later.'}
        </p>
      )}
      <p>
        국내 휴대폰 본인확인이 어려운 회원이 신청할 수 있어요. 승인되면 이 계정으로 1년 동안 모든 19금 상품을 보고 구매할 수 있어요.
        <br />
        <span lang="en">
          If you cannot verify with a Korean mobile phone, you can apply with your ID. Once approved,
          this account can view and buy all age-restricted products for one year.
        </span>
      </p>
      <p>
        사진은 암호화해 보관하고 관리자 한 명이 한 번 확인해요. 신청은 24시간 뒤 만료돼요. 결정·취소·만료 시
        열람을 닫고 파기해요. 승인 기록은 1년, 그 밖의 결과는 30일 보관해요. 동의는 선택이며 일반 상품은 계속
        이용할 수 있어요.{' '}
        <Link className="underline" href="/legal/privacy">
          개인정보처리방침
        </Link>
      </p>
      <p lang="en">
        Your photo is encrypted for a single review. The request expires after 24 hours. Access closes at
        decision, cancellation or expiry and the photo is deleted. Approval is kept for one year, other results
        for 30 days. You may decline and continue shopping for general products.
      </p>
      {request && (
        <div className="wc-adult-status" role="status">
          <p>접수번호 / Request no. {request.number}</p>
          {request.state === 'closed' && request.outcome
            ? request.outcome === 'approved' && !approved
              ? '수동 인증 유효기간 종료 / Manual approval has ended'
              : outcomes[request.outcome]
            : request.state === 'draft'
              ? '사진 제출 전 / Awaiting your photo'
              : request.state === 'purging'
                ? '사진 파기 처리 중 / Deleting photo'
                : request.state === 'uploading'
                  ? '사진 접수 확인 중 / Confirming upload'
                  : '심사 대기·진행 중 / Awaiting review'}
        </div>
      )}
      {request?.state === 'draft' && request.challenge && open && (
        <OverseasPhotoForm
          key={request.id}
          id={request.id}
          challenge={request.challenge}
          onSubmitted={() => router.refresh()}
        />
      )}
      {!active && !approved && open && (
        <button
          type="button"
          className="wc-btn primary"
          disabled={pending}
          onClick={() => act(beginOverseasRequest)}
        >
          신청 코드 받기 / Get a request code
        </button>
      )}
      {active && (
        <div className="flex flex-wrap gap-3">
          <button className="wc-btn" type="button" onClick={() => router.refresh()}>
            상태 확인 / Refresh
          </button>
          {request.state !== 'purging' && (
            <button
              className="wc-btn"
              disabled={pending}
              type="button"
              onClick={() => act(() => cancelOverseasRequest(request.id))}
            >
              신청 취소 / Cancel request
            </button>
          )}
        </div>
      )}
      {approved && (
        <Link className="wc-btn primary" href={next}>
          돌아가기 / Continue shopping
        </Link>
      )}
      {notice && <p role="alert">{notice}</p>}
    </div>
  );
}
