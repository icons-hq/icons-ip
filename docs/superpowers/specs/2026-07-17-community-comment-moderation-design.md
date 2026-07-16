# 커뮤니티 댓글 모더레이션 설계

## 범위

- 운영자는 댓글 신고에서 개별 댓글을 숨기거나 기존처럼 부모 포스트 전체를 숨길 수 있다.
- 숨김 댓글은 공개 피드, IP 상세·홈 preview, 댓글 수에서 tombstone 없이 제외한다.
- 댓글·부모 포스트 작성자와 staff는 분쟁·운영 검토를 위해 hidden 원문을 DB에서 읽을 수 있다.

## 신뢰 경계

- `comments.status`는 `visible|hidden`이며 직접 UPDATE 권한은 제거한다.
- `admin_hide_community_comment(comment_id, report_id?)`만 staff를 재검사하고 댓글 및 정확히 연결된 신고를 잠근다.
- visible→hidden 전환과 matching report 해결은 한 transaction이다.
- 동일 resolved 요청 replay는 무변경이다. 이미 hidden인 댓글에 다른 open report를 전달하면 원자적으로 거부하고, 운영자는 기존 신고 상태 form으로 별도 처리한다.
- audit은 `from`, `to`, `reportId`만 남기며 댓글 원문·사용자 식별정보를 포함하지 않는다.

## 공개·운영 UI

- 공개 loader는 `status=visible`을 order/limit/count 전에 명시한다. staff로 공개 화면을 보더라도 hidden 댓글은 노출하지 않는다.
- `/admin` 신고 카드는 `댓글 숨김`과 `포스트 숨김`을 분리한다. 댓글 숨김은 연결 신고 해결과 현재 UI에서 되돌릴 수 없음을 확인한 뒤 제출한다. hidden 댓글 원문과 상태는 행이 존재하는 동안 유지하고 댓글 action은 `숨김 처리됨`으로 비활성화한다.
- 변경한 select/button은 최소 44px이며 select에 명시적 접근성 이름을 제공한다.
