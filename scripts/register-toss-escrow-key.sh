#!/usr/bin/env bash
# 토스 에스크로 부가서비스 API 키(TOSS_ESCROW_SECRET_KEY)를 Vercel Production에 sensitive로 등록한다(ADR-0049 결정 6 보강).
#
# 넣을 값: 토스페이먼츠 개발자센터 → API 키 → MID iconsi0xvd의 'API 개별 연동 키' 시크릿 키.
#   라이브 키로 결제하는 동안은 live_sk_…, 테스트 키(심사·리허설) 동안은 test_sk_…(테스트 MID ticonsi0xvd).
#   결제 키(TOSS_SECRET_KEY, live_gsk_…/test_gsk_…)와 같은 모드여야 한다 — 다르면 빌드 가드가 배포를 막는다.
# 값은 화면에 보이지 않게 입력받아 stdin으로만 넘긴다(채팅·파일·셸 기록·로그에 남기지 않는다).
# 실행: 저장소 루트(`vercel link`가 된 곳)에서 `bash scripts/register-toss-escrow-key.sh`. 이미 있으면 덮어쓴다(--force).
# 등록 뒤에는 production 재배포가 있어야 적용된다(Vercel env는 배포 시점에 스냅샷된다) — 배포 로그 readback의
# `Toss escrow key configured=true`를 확인한다.
set -euo pipefail

command -v vercel >/dev/null 2>&1 || { echo 'vercel CLI가 없습니다. npm i -g vercel 뒤 vercel login·vercel link를 먼저 하세요.' >&2; exit 1; }

read -r -s -p 'TOSS_ESCROW_SECRET_KEY (test_sk_… 또는 live_sk_…, 입력은 보이지 않습니다): ' key
echo
if [[ ! "$key" =~ ^(test|live)_sk_[A-Za-z0-9_]{8,128}$ ]]; then
  unset key
  echo '형식이 맞지 않습니다: API 개별 연동 시크릿 키(test_sk_… / live_sk_…)를 넣으세요. 결제 위젯 키(gsk)가 아닙니다.' >&2
  exit 1
fi

printf '%s' "$key" | vercel env add TOSS_ESCROW_SECRET_KEY production --sensitive --force --yes
unset key
echo 'TOSS_ESCROW_SECRET_KEY를 Production에 등록했습니다. production을 다시 배포한 뒤 readback "Toss escrow key configured=true"를 확인하세요.'
