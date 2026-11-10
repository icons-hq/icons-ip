# 상품공지 중요기간·홈 팝업 계약

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-14 KST. 원본 조사와 코드 검토를 바탕으로 아래 계약을 확정하고, 독립 검토를 통과한 SQL을 격리 DB에 적용·검증했다. **새 SQL은 독립 검토 전 어떤 DB에도 적용하지 않는다.** UI·공개 컴포넌트·중앙 문서는 root, SQL과 기능·실제 경합 테스트는 이 검토 작업이 소유한다.

## 원본 근거와 구현 전 코드

[원본 상품공지 등록](https://sell.smartstore.naver.com/#/notice/register/)에서 중요 공지의 선택형 기간, 공지 게시기간, 홈 팝업의 별도 시작·종료 기간을 확인했다. 팝업은 마지막으로 설정한 공지 하나를 사용하고 PC/MO 예시가 있다. 모바일 예시에는 오늘 하루 보지 않기와 닫기가 있다. 저장은 실행하지 않았고 세 스위치 초기화와 소유 탭 종료를 확인했다. 원본 증거 목록 (`output/goods-announcement-period-reference-20261014/manifest.json`), 펼친 입력 (`output/goods-announcement-period-reference-20261014/source-expanded.txt`), 팝업 설명 (`output/goods-announcement-period-reference-20261014/source-popup-help.txt`)

종료일 포함 여부, 실제 공개 화면의 기간 우선순위·만료·닫기 저장 방식은 원본에서 확인하지 않았다. 아래 `[시작, 종료)`·KST·게시창 교집합·복귀 금지·dismissKey 정책은 ICONS 계약이다.

- 확장 전 `goods_announcements`에는 `important`와 게시 `starts_at/ends_at`, 공지별 revision이 있다. 홈 팝업과 중요기간은 없다. [기존 schema](../../../supabase/migrations/20261020085134_admin_goods_announcements.sql)
- 기존 3인자 저장은 `catalog.announcements`의 권한 fence, 공지 advisory/행 잠금과 revision CAS를 사용한다. 요청 UUID 영수증은 없다. 클라이언트 생성 공지 UUID는 응답 유실 때 새 행 중복만 막는다. [현 writer](../../../supabase/migrations/20261020085215_operator_capability_guards.sql)
- 공개 PDP RPC는 공개·미보관·비제한 상품과 공개 IP를 확인하고 활성 공지만 좁혀 반환한다. `important` 순으로 정렬하고 게시기간의 다음 경계를 반환한다. 기존 [공개 loader](../../../lib/good-announcements.server.ts)와 [PDP 표시](../../../components/shop/GoodAnnouncements.tsx)는 이 경계에 재조회한다.
- [현재 액션](../../../app/admin/goods-announcement-actions.ts)과 [편집기](../../../components/admin/screens/GoodsAnnouncementEditor.tsx)는 응답 유실의 고정 요청·개별 결과 확인을 아직 갖추지 않았다. 새 원자 저장과 함께 보완한다.

## 데이터·기간 계약

`goods_announcements`에 nullable `important_starts_at`, `important_ends_at`만 추가한다. 두 값은 모두 null이거나 모두 유한한 시각이고 시작 < 종료여야 한다. 중요기간 설정 해제는 둘 다 null이다. `important=false`에서도 저장된 기간을 보존할 수 있으며, 실제 중요 표시는 `important AND 현재 중요기간`으로 계산한다. 기존 공지는 두 값 null로 기존 표시를 유지하고 과거 데이터·감사·3인자 writer 원문을 바꾸지 않는다.

게시기간과 중요기간은 독립이다. 중요기간 밖에서는 활성 공지를 일반 공지로 표시하고 정렬도 실제 중요 여부를 사용한다. 게시기간 밖이면 공지 자체가 보이지 않는다. 기존 게시기간의 한쪽 경계 생략은 계속 허용하고, 새 중요기간·팝업기간은 기간을 사용할 때 양쪽을 필수로 한다. 시각 입력은 기존 KST datetime, DB는 timestamptz와 `[시작, 종료)`를 따른다.

홈 선택은 private singleton 한 행에 `announcement_id`, `revision`, 필수 팝업 `starts_at/ends_at`, 공개용 불투명 `dismiss_key`를 둔다. 선택 없음은 id/기간/key 모두 null인 실제 revision 0 기본행으로 시작한다. 조회 실패를 이 기본값으로 대체하지 않는다. singleton에는 앱의 직접 읽기·쓰기 권한을 부여하지 않는다.

현재 선택한 하나의 공지만 후보로 읽는다. 선택 B가 미래 예약·만료·게시중지 상태여도 이전 A로 돌아가지 않는다. 기존 A를 되살리려면 A를 다시 명시적으로 선택해야 한다. 상품 연결 범위는 PDP 대상이고, 명시적인 홈 팝업 선택은 그 범위와 독립이다. 공지 본문·기기 필터·안전한 HTML 렌더링은 기존 규칙을 유지한다. 범용 팝업 편집기·독립 마케팅 시스템·인앱 발송은 이 범위에 넣지 않는다.

## 편집·저장 JSON

`admin_get_goods_announcement_editor_context(p_id uuid)`는 다음 객체를 반환한다.

```ts
{
  announcement: ExistingAnnouncement & {
    importantStartsAt: string | null;
    importantEndsAt: string | null;
  } | null;
  popup: {
    selected: boolean;
    revision: number;
    startsAt: string | null;
    endsAt: string | null;
  };
}
```

없는 공지는 `announcement:null`이지만 popup의 실제 global revision은 반환한다. `selected`는 조회 대상 공지가 현재 선택인지 나타낸다. false이면 기간은 둘 다 null이고 다른 공지의 ID·본문은 돌려주지 않는다. 기존 리스트 RPC/row shape는 유지한다. detail 파서는 nullable 키도 필수로 요구하고, enum·boolean·안전한 정수·유한 시각·기간 조합이 틀린 응답을 거절한다.

새 저장은 `admin_save_goods_announcement_v2(p_operation_id uuid,p_id uuid,p_expected_revision integer,p_values jsonb,p_popup_intent text,p_expected_popup_revision bigint)`다. `p_values`는 기존 필드에 `importantStartsAt`, `importantEndsAt`, `popupStartsAt`, `popupEndsAt` 네 필드를 추가한다. 새 네 필드의 키는 항상 있고 값은 ISO 시각 문자열 또는 null이다.

| intent | popup 기간 | global 처리 |
| --- | --- | --- |
| `preserve` | 두 값 null | global revision을 검사·증가하지 않고 선택·기간·dismissKey를 그대로 둔다. 다른 B가 선택돼도 A의 일반 편집은 성공할 수 있다. |
| `set` | 둘 다 필수 | expected global revision 일치 뒤 현재 공지로 교체한다. 같은 공지를 다시 선택해도 revision과 dismissKey를 새로 만든다. |
| `clear` | 두 값 null | expected global revision과 현재 선택 id=현재 공지 id를 확인하고 선택·기간·key를 비운다. A의 해제가 B 선택을 지우지 못한다. |

저장 결과는 `{id,revision,reference,updatedAt,popupRevision}`다. `popupRevision`은 저장 시점의 값이며 현재 선택 상태를 보증하지 않는다. 정확한 영수증 재확인도 저장 당시 결과를 반환하고 새로 선택하거나 수정하지 않는다. 화면은 성공 후 editor-context를 다시 읽는다.

구 3인자 RPC는 확장 키를 받지 않으며 원래 UPSERT가 새 중요기간 컬럼을 갱신하지 않아 기존 값을 보존한다. singleton도 만지지 않는다. 새 기능을 사용한 공지를 옛 편집기에서 일반 저장해도 홈 선택을 지우거나 기간을 초기화하지 않는다.

## 권한·동시성·응답 유실

잠금은 현재 `catalog.announcements` 권한 fence → operation ID → 기존 공지 advisory/행 → set/clear인 경우 singleton 행 순서다. singleton을 잡은 요청이 이전 선택 B의 공지 행을 추가로 잠그지 않는다. `preserve`는 singleton을 단순 조회하므로 다른 공지의 홈 선택과 불필요하게 충돌하지 않는다.

공지 CAS나 global CAS가 실패하면 `PT409`로 전체를 롤백한다. 공지 내용만 저장되고 홈 선택만 실패하는 결과를 만들지 않는다. 새 감사 한 건의 ID를 operation UUID로 쓰며 actor, action, 공지 target, 정규화 request, before/after와 상품 연결, popup before/after, 저장 결과를 함께 기록한다. 같은 ID에 다른 actor/request/target은 operation conflict다. 권한 회수는 영수증 반환보다 먼저 검사한다.

`admin_get_goods_announcement_save_result(p_operation_id uuid)`는 현재 권한·actor/action을 확인하고 같은 operation lock을 얻은 뒤 저장 당시 결과 또는 null을 반환한다. 다른 운영자의 영수증을 노출하지 않는다. 새로운 권한·계정 상태는 조회에도 적용한다.

**null은 ‘현재 등록된 결과 없음’이며 첫 요청의 종결을 보장하지 않는다.** 첫 HTTP 요청이 큐나 권한 fence에서 아직 operation lock에 도달하지 않았다면 조회가 먼저 null을 반환할 수 있다. 클라이언트는 최초 UUID·공지 revision·global revision·FormData를 고정하고 같은 요청만 재저장한다. 응답 유실 뒤 권한 거절/충돌/알 수 없는 오류가 와도 이 고정을 풀지 않는다. 편집 재개를 안전하게 허용하려면 별도 종결·취소 영수증 계약이 필요하므로 이번에는 추가하지 않는다.

고정 요청은 서버 호출 전에 기존 세션 초안 저장소의 `goods-announcement-save` 범위에 계정·로그인 세션·공지 ID별로 보관한다. 저장소 쓰기나 용량 검사가 실패하면 RPC를 보내지 않는다. 일반 편집 초안의 24시간 만료와 달리 **미확정 저장 요청은 같은 로그인에서 결과를 확인할 때까지 유지**하며, 다른 초안의 시간 정리에서도 제거하지 않는다. 내부 링크 이동·새로고침 뒤에는 명시적으로 고정 요청을 복구한 다음 원문을 확인하고 결과 조회 또는 동일 요청 재시도만 할 수 있다. 복구 버리기는 제공하지 않는다. 최초 제출의 확정 거절 또는 확인된 저장 성공만 기록을 제거한다. 로그아웃·계정·로그인 세션 변경 시에는 기존 격리 정책에 따라 기록을 지우고 이전 화면을 잠근다.

서버 액션은 요청의 `accountId`와 현재 권한 검사에서 확인한 사용자를 비교한다. 클라이언트는 현재 계정·세션·공지 대상과 화면 생존 여부를 확인한 뒤에만 늦은 응답을 반영한다. 저장 성공이 확인됐으나 최신 본문 재조회가 실패했으면 일반 링크로 공지를 완전히 다시 열어 편집 상태와 잠금을 초기화한다.

## 공개 JSON·오늘 숨김

`get_home_announcement_popup()`은 anon/authenticated 모두 같은 `{item,nextChangeAt}`를 반환한다. item은 null 또는 `{id,title,body,format,device,important,dismissKey,startsAt,endsAt}`다. item의 시작·종료는 공지 게시창과 팝업창 교집합이며 두 값 모두 유한한 문자열이다. 현재 활성·기간 안인 선택 한 건만 본문을 내보낸다. 비활성·예약·종료 결과에 미래 공지 본문, 연결 상품 ID, 운영자, private revision을 넣지 않는다.

PDP의 다음 경계에는 중요 시작/끝도 포함한다. 홈은 현재 선택의 게시·팝업·중요 경계 중 다음 변화를 반환하며 현재 표시가 0건이어도 미래 시작 경계를 놓치지 않는다. 만료 시 클라이언트는 정확한 endsAt에 즉시 숨기고 재조회하며, 탭 재활성화에서도 확인한다. 조회 실패에 과거 A나 캐시된 만료 B를 대체 표시하지 않는다.

`dismissKey`는 `set`에서만 새 UUID다. 다른 공지 선택·같은 공지 재설정은 오늘 숨김을 새로 시작하고, 일반 제목·본문 편집이나 중요 설정 저장은 기존 숨김을 유지한다. 오늘 숨김은 이 키와 KST 날짜를 브라우저에 저장한다. X 닫기는 현재 방문의 상태다. 저장소 사용이 막혀도 현재 창은 닫을 수 있으며 로그인·추적 데이터나 서버 쓰기를 추가하지 않는다. 실제 예시의 내부 저장 방식으로 주장하지 않는다.

## 검증할 경계와 소유권

SQL 담당은 새 schema/RPC·공개 projection·권한 등록과 기능·실제 blocking 경합을 맡는다. 기능은 기간·중요 정렬·nextChangeAt, 공개 projection의 미노출, 구 writer 보존, preserve/set/clear, stale global CAS 원자 롤백, 동일/다른 요청 UUID, 권한 철회, own-only 결과 조회와 null 시점을 포함한다. 경합은 같은 공지 저장, 서로 다른 공지의 set, set↔preserve, set↔clear, 결과 조회↔진행 중 저장, 권한 회수↔저장을 확인한다. 기존 정의·데이터·공개 계약을 baseline fingerprint와 회귀로 비교한다.

Root는 `lib/admin/goods-announcements*`, server actions, editor, public loader/HomePopup, CSS와 중앙 문서를 소유한다. 새 DRAFT의 경로·SHA와 테스트를 제출하고 root 전체 SQL 검토 승인 후에만 OWN/FRESH/59922 검증을 진행했다. 운영·Preview 적용은 이번 격리 검증과 별개다.

## SQL 승인·적용·검증 결과

독립 검토에서 정확한 요청 영수증 확인을 현재 상품 존재 검사보다 먼저 실행하도록 보완했다. 따라서 저장 이후 연결 상품이 삭제되어도 같은 요청의 영수증을 그대로 확인할 수 있고, 새로운 저장에는 현재 상품 검증을 적용한다. 최종 승인한 [`20261020085327_goods_announcement_period_popup.sql`](../../../supabase/migrations/20261020085327_goods_announcement_period_popup.sql)의 SHA-256은 `b1817fcdcc2443ce3c29bc7090b4dcceb6b00a80c782ab1b69c7edc9831a2f3c`다. 적용 이후 이 migration 원문은 변경하지 않았다.

OWN·FRESH·59922 격리 DB에서 source와 migration ledger의 statement가 정확히 일치한다. OWN/FRESH의 관련 함수 정의·소유자·ACL 9개가 같고, 기존 3인자 writer와 list/detail/picker 4개 정의를 유지했다. 사전 데이터가 있는 폐기 복제본에서 기존 공지·상품 연결 보존, 실제 빈 singleton의 revision 0, 변경하지 않은 함수·권한을 확인했다. 복제본의 전체 함수·RLS fingerprint를 원본과 비교한 뒤 복제 과정에서 바뀌는 내부 OID 증명만 재결속했으며, 이름 있는 검증 DB의 증명 자료를 갱신하지 않았다. 적용·함수 검증 (`output/goods-announcement-period-popup-qa-20261014/applied-sql-verification.json`), 최종 SQL 증거 목록 (`output/goods-announcement-period-popup-qa-20261014/final-sql-manifest.json`)

[`goods_announcement_period_popup.sql`](../../../supabase/tests/goods_announcement_period_popup.sql)과 `operator_capability_coverage`는 폐기 복제본 및 OWN/FRESH/59922에서 통과했다. 기간 타입·쌍·교집합·종료 제외, 중요 정렬과 다음 경계, 공개 필드 최소화, 미래/중지/만료 선택의 이전 공지 복귀 금지, 일반 저장의 선택 보존, CAS 전체 롤백, 같은 요청/변조 요청, 단일 감사, 권한 회수 후 영수증 차단과 다른 운영자 결과 비노출을 포함한다. 기능 자료는 롤백했고 새로 만든 경합 복제본은 삭제했다.

[`goods_announcement_period_popup_concurrency.sh`](../../../supabase/tests/goods_announcement_period_popup_concurrency.sh)는 아래 15개 경계를 통과했다. 첫 12개는 `pg_blocking_pids`로 실제 잠금 대기를 확인했다. 서로 다른 공지의 비교는 서로 다른 운영자를 사용하여 공통 계정 권한 fence의 직렬화와 객체 잠금을 구분했다.

| 검증 종류 | 경계 |
| --- | --- |
| 실제 잠금 경합 12개 | 동일 operation, 동일 공지 CAS, 서로 다른 공지의 global set CAS, set→이전 clear, clear→이전 set, 구 writer→v2, v2→구 writer, commit 뒤 결과 조회, rollback 뒤 결과 조회, 같은 operation의 다른 payload, 권한 회수→저장, 저장→권한 회수 |
| 독립 처리 2개 | 서로 다른 운영자·공지의 preserve→set와 set→preserve에서 선행 트랜잭션이 잠금을 가진 동안 후행 요청이 완료됨 |
| 늦은 첫 요청 1개 | 결과 조회 null 이후 아직 도착하지 않았던 최초 요청이 정상 저장될 수 있음을 재현함 |

CI에는 기능 SQL과 복제본 기능·권한 coverage·15경계 실행을 연결했다. 59922 누적 검증은 이 SQL 적용 당시 301개 migration 원문이 일치했지만, 기존 size/banner의 실제 적용 순서가 파일 정렬과 달라 `fullySequential=false`로 기록했다. 전체 변경 동결 뒤 새로운 DB에서 전 migration을 순서대로 적용하는 최종 검증은 별도이며, 이 SQL 단위 검증으로 완료를 대신하지 않는다. TypeScript·UI·공개 팝업·브라우저 검증 결과는 담당 작업의 후속 근거로 구분한다.


## 실제 관리자·공개 화면 검증

2026-10-14 격리 앱의 정상 주매니저 로그인과 합성 공지 두 건으로 확인했다. 최종 증거 목록 (`output/announcement-popup-qa-20261014/manifest.json`), DB 저장 원문 (`output/announcement-popup-qa-20261014/18-final-readback.json`), 정리 후 읽기 (`output/announcement-popup-qa-20261014/19-cleanup-readback.json`)를 보관한다.

| 확인 | 결과 |
| --- | --- |
| PC·모바일 공개 | PC 400px 팝업, 390px에서는 화면 아래 390px 너비. 제목·중요 표시·본문·초점·스크롤 잠금/해제가 정상이며 가로 넘침 없음 |
| 닫기·오늘 숨김 | X 닫기는 재방문 시 다시 표시, 오늘 숨김은 새로고침 후 유지. 다른 팝업 선택은 새 키로 다시 표시 |
| HTML·종료 | 굵게·기울임·목록의 안전 HTML 표시. 실제40초 종료에서 팝업이 사라지고 이전 공지가 돌아오지 않음 |
| 중요기간·게시기간 | 미래 중요기간을 실제 저장한 공지가 홈/PDP에서 일반 공지로 표시됨. 팝업기간이 끝난 별도 공지는 PDP 게시 조건에 따라 계속 표시됨 |
| 관리자 저장·재열기 | PC·390px 저장 후 DB 기간/버전과 화면이 일치. 같은 공지의 완전 재열기 후 편집 가능 |
| 동시 선택 충돌 | 다른 공지의 팝업 설정이 먼저 저장되면 뒤 요청의 공지 본문과 선택을 함께 거절. 제목·체크·두 기간은 그대로 보존 |
| 통신 실패 복구 | 해당 탭의 임시 오프라인→응답 미확인·편집 잠금→온라인 복원→새로고침→명시 복구→조회 null·잠금 유지→같은 최초 입력 재저장→성공과 편집 재개 |
| 요청·감사 | 브라우저 저장5회와 초기 합성 RPC2회에 감사7건. 충돌·실패에는 추가 감사 없음 |
| 정리 | 합성 공지2건과 해당 감사7건만 제거. 기존 공지 원문과 팝업 기본행을 정확히 복원하고 목록1건 확인. 임시 화면크기·네트워크 설정 해제, 보조 탭 종료 |

실제 검증에서 발견한 두 화면 문제를 수정했다. React form action의 자동 reset이 충돌 뒤 체크 표시만 바꾸던 문제는 일반 submit 처리로 바꿔 막았고, 새 통신 실패에 이전 성공 문구가 함께 남던 문제는 요청 상태를 분리해 수정했다. 두 문제 모두 실제 Chrome에서 수정 후 다시 확인했다. 보관된 요청의 원문 확인에는 내부 코드 대신 화면의 분류·노출·기간 명칭을 표시한다.

최종 관련11파일69개 테스트와 변경 TS/TSX ESLint를 통과했다. 원래 기능 SQL·권한·15경합 검증은 앞 절과 별개로 유지한다. 전체 작업 트리 빌드와 전체 순차 DB 검증은 통합 기록을 따른다. 브라우저 로그의 초기 누락 모듈은 임시 runtime 사본의 의존 파일을 보충해 해결했고, 이후 hydration 차이는 번역 확장이 추가한 html 속성이었다. 원본 스마트스토어 저장 결과와 운영 배포는 검증 범위에 포함하지 않는다.
