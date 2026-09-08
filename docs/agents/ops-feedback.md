# 운영 피드백과 주간 리뷰

어드민 운영 의견은 `icons-hq/icons-ip`의 `ops-feedback` 이슈와 [Project #8](https://github.com/users/sangwopark19/projects/8)에서 관리한다. 카톡·회의 메모는 접수 경로이며 완료 근거는 이슈에 남긴다. 템플릿은 `.github/ISSUE_TEMPLATE/ops-feedback.md`다.

1. 제품 담당자가 원문의 업무 의도를 보존해 상황·재현 순서·기대/실제 결과·영향을 옮긴다. 고객 개인정보·계정 비밀값은 기록하지 않는다. 이미 같은 문제가 있으면 기존 이슈에 합친다.
2. `ops-feedback`, `needs-triage`로 접수하고 Project #8의 Track=`Admin Ops`, Phase=`First Sale`, Status=`Todo`를 지정한다. Dependency는 실제 선행 조건을 확인해 선택한다.
3. 매주 운영 리뷰에서는 `track:"Admin Ops" label:ops-feedback -status:Done` 필터를 기본 안건으로 삼고, S1~S5를 막는 문제부터 재현한다. 담당자·우선순위·다음 확인일·완료 조건을 확정한다.
4. 구현 근거·자동 검증·스테이징 주소를 연결하고 운영팀이 같은 순서로 재확인한다. 재현이 사라졌다는 증거가 있어야 이슈와 Project를 Done으로 바꾼다. 코드가 존재하는 것만으로 사람 리허설을 통과 처리하지 않는다.
5. 배포된 변경을 `lib/admin/guide/changes.ts`에 최신 주차부터 기록한다. 안내는 사용자가 바뀐 화면에서 할 수 있는 행동을 설명한다. 가이드 `/admin/guide/whats-new`가 이 데이터를 표시하며 미래 구현을 미리 완료형으로 쓰지 않는다.

주간 기록은 해당 이슈 코멘트에 `확인일 / 참여 역할 / 재현 결과 / 다음 행동 / 다음 확인일` 순서로 남긴다. 에픽 #408 본문은 고치지 않고 변경 요약을 코멘트로 연결한다.
