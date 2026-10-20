# 리뷰 도움수 회귀

`review_helpful_regression.py`는 명시한 로컬 Supabase의 `postgres` DB를 읽기 전용으로 복제하고, 새 UUID·DB OID·컨테이너 ID lease로 확인한 일회용 DB에서만 테스트한다. 원본 DB reset, migration 적용, 기존 함수 owner/ACL 보정은 하지 않는다. `20261015035229_review_helpful_admin_owner_boundary`까지 적용된 DB가 필요하다.

```bash
python3 -B supabase/tests/review_helpful_regression.py \
  --container supabase_db_icons-ip \
  --scope isolated-local \
  --output-dir output/review-helpful-regression
```

컨테이너 이름은 테스트할 로컬 환경으로 명시한다. CI는 기존 DB migration 적용 후 같은 진입점을 `--scope ci`로 실행한다. 혼합 owner 환경을 확인할 때도 그 환경을 그대로 복제해서 실행한다. canonical DB의 성공이 혼합 owner 환경의 성공을 대신하지 않는다.

- 공개/작성 SQL: 멱등 true/false, 그룹 PDP 공유, 공개 범위, 회원·세션·ban·fence 조건, 공개/관리자 정렬 parity, ACL/FK를 확인한다. 기존 표 기록이 있어도 합성 UUID 범위만 검증한다.
- 관리자 owner: 실제 `SET LOCAL ROLE authenticated`, 프로필·운영자 membership·persisted session과 JWT claims로 정상 BEST writer와 기존/새 관리자 RPC를 실행한다. 유효 BEST의 내부 helper 전체, 여섯 기존 정렬의 전체 행, 도움수 정렬·필터·권한 거절을 확인한다. 신뢰된 fixture 생성 연결로 관리자 호출을 우회하지 않는다.
- 실제 SQL DTO: 저장된 JSON을 production parser와 loader에 넣는 opt-in Vitest를 실행한다. 일반 단위 테스트는 `.live.ts`를 자동 실행하지 않는다.
- 동시성: 같은 계정 요청, fence, 리뷰 숨김, 상품/IP 비공개, 그룹 변경, provider ban, session 폐기를 실제 lock 상태를 관찰하며 확인한다.

SQL fixture는 rollback 후 schema/ACL/RLS/registry/전체 원장/업무·Auth·Storage 행 hash가 같은지 비교한다. 경합 fixture는 소유 clone 안에서만 commit한 뒤 DB 전체를 삭제한다. 원본 전후 전체 snapshot, 18개 application 파일과 5개 supporting 파일, migration 파일, 테스트 파일의 바이트 보존도 확인한다. 결과와 로그는 지정한 출력 디렉터리 아래 UUID 폴더에 남긴다. 소스 데이터가 들어 있는 임시 dump는 소유 임시 디렉터리와 함께 제거한다.

운영 DB·원격 Docker·다른 DB 이름을 받는 우회 인자는 제공하지 않는다. 이 진입점은 브라우저 및 실제 PostgREST 인증 검증을 대체하지 않는다.
