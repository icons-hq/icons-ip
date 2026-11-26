'use client';

import { useState } from 'react';
import type { OnboardingActionState } from '@/app/onboarding/actions';
import { LEGAL_DOCUMENT_LABELS, legalDocumentHref, type LegalDocumentSlug } from '@/lib/legal/links';
import {
  MARKETING_CHANNEL_FIELDS,
  MARKETING_CHANNEL_LABELS,
  MARKETING_KAKAO_OFFERED_FIELD,
  marketingConsentNoticeFor,
  type MarketingChannel,
  type MarketingChannelChoices,
} from '@/lib/marketing-consent';

function TermRow({ checked, error, label, name, onChange, slug }: {
  checked: boolean;
  error?: string;
  label: string;
  name: string;
  onChange: (checked: boolean) => void;
  slug?: LegalDocumentSlug;
}) {
  const errorId = error ? `${name}-error` : undefined;
  return (
    <li>
      <div className="wc-auth__agree-row">
        <label>
          <input
            aria-describedby={errorId}
            aria-invalid={error ? true : undefined}
            aria-required={slug ? true : undefined}
            checked={checked}
            name={name}
            onChange={(event) => onChange(event.target.checked)}
            type="checkbox"
          />
          <span>
            {label} <em className={slug ? 'wc-auth__req' : 'wc-auth__opt'}>{slug ? '필수' : '선택'}</em>
          </span>
        </label>
        {slug && (
          <a aria-label={`${LEGAL_DOCUMENT_LABELS[slug]} 전문 보기`} href={legalDocumentHref(slug)} rel="noreferrer" target="_blank">
            전문 보기
          </a>
        )}
      </div>
      {error && <span className="wc-auth__error" id={errorId}>{error}</span>}
    </li>
  );
}

type ConsentKey = 'terms' | 'privacy' | MarketingChannel;

export function OnboardingConsents({ errors, initialMarketing, marketingChannels }: {
  errors: OnboardingActionState['errors'];
  initialMarketing: MarketingChannelChoices;
  marketingChannels: readonly MarketingChannel[];
}) {
  const [choices, setChoices] = useState(() => ({ terms: false, privacy: false, ...initialMarketing }));
  const offered: ConsentKey[] = ['terms', 'privacy', ...marketingChannels];
  const allChecked = offered.every((key) => choices[key]);
  const mixed = !allChecked && offered.some((key) => choices[key]);
  const { notice } = marketingConsentNoticeFor(marketingChannels);
  const kakaoOffered = marketingChannels.includes('kakao');

  function toggleAll(checked: boolean) {
    setChoices((current) => {
      const next = { ...current };
      for (const key of offered) next[key] = checked;
      return next;
    });
  }

  function toggle(key: ConsentKey, checked: boolean) {
    setChoices((current) => ({ ...current, [key]: checked }));
  }

  return (
    <>
      <ul className="wc-auth__agree">
        <li className="wc-auth__agree-row wc-auth__agree-all">
          <label>
            <input
              aria-checked={mixed ? 'mixed' : allChecked}
              aria-describedby="agree-all-hint"
              aria-labelledby="agree-all-label"
              checked={allChecked}
              onChange={(event) => toggleAll(event.target.checked)}
              ref={(input) => { if (input) input.indeterminate = mixed; }}
              type="checkbox"
            />
            <span>
              <strong id="agree-all-label">전체 동의</strong>
              <span className="wc-auth__agree-all-hint" id="agree-all-hint">
                {marketingChannels.map((channel) => MARKETING_CHANNEL_LABELS[channel]).join('·')} 마케팅 수신(선택)을 포함해요.
                필수 항목만 동의해도 가입할 수 있어요.
              </span>
            </span>
          </label>
        </li>
        <TermRow checked={choices.terms} error={errors?.terms} label="이용약관 동의" name="terms" onChange={(checked) => toggle('terms', checked)} slug="terms" />
        <TermRow checked={choices.privacy} error={errors?.privacy} label="개인정보 처리방침 동의" name="privacy" onChange={(checked) => toggle('privacy', checked)} slug="privacy" />
        {marketingChannels.map((channel) => (
          <TermRow
            checked={Boolean(choices[channel])}
            key={channel}
            label={`${notice.title} (${MARKETING_CHANNEL_LABELS[channel]})`}
            name={MARKETING_CHANNEL_FIELDS[channel]}
            onChange={(checked) => toggle(channel, checked)}
          />
        ))}
      </ul>
      {kakaoOffered && <input name={MARKETING_KAKAO_OFFERED_FIELD} type="hidden" value="1" />}
      <details className="wc-auth__consent-details">
        <summary>마케팅 수신 안내</summary>
        <p className="onboarding-consent-note">
          {notice.summary} {notice.inApp} {notice.sms}{kakaoOffered ? ` ${notice.kakao}` : ''} {notice.change}
        </p>
      </details>
    </>
  );
}
