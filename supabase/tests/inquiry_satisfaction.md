# 문의 만족도 회귀

`inquiry_satisfaction_regression.py`는 명시한 로컬 Supabase의 `postgres`를 읽기 전용으로 복제하고, 새 UUID·DB OID·컨테이너 lease로 확인한 폐기용 DB에서 SQL/DTO/경합을 실행한다. source DB reset·named 적용·기존 owner/ACL 보정은 하지 않는다. 공통 전체 schema/registry/원장/행 hash snapshot은 기존 `helpers/review_helpful_contract.py`를 재사용한다.

아래는 ROOT 승인하에 완료한 source348 DRAFT 검증 명령 형식이다. 현재 source350에서는 이 과거 DRAFT 모드를 다시 실행하지 않는다. 상설 CI는 아래 설명대로 DRAFT 인자를 빼고 실행한다.

```bash
python3 -B supabase/tests/inquiry_satisfaction_regression.py \
  --target own \
  --scope isolated-local \
  --output-dir output/inquiry-satisfaction-functional-clone-20261015 \
  --draft output/inquiry-satisfaction-implementation-20261015/inquiry-satisfaction.DRAFT.sql \
  --draft-sha256 <ROOT가-검토한-SHA256>
```

DRAFT 경로·SHA와 348개 migration **소스 파일** 지문을 확인한다. 실제 named ledger는 고정 이름·CID·port의 OWN 280개 또는 CANON 348개이며 최종 버전은 둘 다 `20261015052828`이다. CANON 검증은 `--target canonical`로 실행한다. 실제 legacy 문의/답변을 clone 안에 먼저 생성하고 DRAFT 적용 전후 기존 정의·owner·ACL·registry·업무 행 보존과 새 테이블 0행을 확인한다. DRAFT에는 transaction 경계가 없으며 runner가 외부 BEGIN/COMMIT으로 감싼다. 이후 SQL 회귀를 rollback하고 snapshot을 재확인한 다음, 같은 clone에서 통제된 경합을 실행한다. 정식화 후 CI에서는 `--target`, `--draft`, `--draft-sha256`을 빼고 `--container <CI의 로컬 Supabase 컨테이너> --scope ci`로 같은 진입점을 사용한다. CI 연결은 ROOT가 통합한다.

- SQL: 무백필, CAS/고정 영수증/no-op/철회, 원문과 기존 업무 보존, 고객·관리자 권한, 정확한 KST/필터/total/분모, 삭제 경계를 검사한다.
- DTO: 실제 SQL JSON 4종을 production parser와 관리자 loader에 넣는다. `.live.ts`는 일반 단위 테스트에 자동 포함하지 않는다.
- 경합: 중복 요청, 대기 중 영수증 조회, 답변/평가 양방향 경합, 두 탭 CAS, 실제 운영자 RPC의 transaction 시각 역전, ban/session/fence 잠금을 관찰한다.
- 모든 단계에서 명시한 clone만 변경하고 마지막에 clone·임시 dump를 제거하며 source와 파일 보존을 재확인한다.

OWN280·CANON348 폐기 clone에서 각각 SQL40·실제 DTO4·경합9·삭제 회귀·coverage/rollback을 통과했다. 원본/파일 보존과 clone/임시 파일 제거도 확인했다. 실제 브라우저·HTTP 인증 검수는 별도이며 이 결과가 대신하지 않는다.
