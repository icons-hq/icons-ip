# Secondary deletion ledger local contract

> 상태: local contract 구현 · Production remote adapter 미구현 · runtime 기본 disabled
>
> 추적: [#240](https://github.com/icons-hq/icons-ip/issues/240) local contract · [#215](https://github.com/icons-hq/icons-ip/issues/215) remote project/credentials/restore drill

이 문서는 [`account-deletion-retention-policy.md` §6](./account-deletion-retention-policy.md#6-secondary-supabase-compliance-ledger)의 secondary deletion ledger를 remote 인프라 없이 검증하는 계약이다. 현재 구현은 네트워크, 환경변수, DB, migration, remote secret을 사용하지 않으며 Production 탈퇴 경로에 연결되지 않는다.

## 1. 공개 adapter seam

`lib/privacy/deletion-ledger`의 `DeletionLedger`는 두 동작만 갖는다.

```ts
interface DeletionLedger {
  append(event: DeletionLedgerEvent): Promise<DeletionLedgerAcknowledgement>;
  scanAfter(sequence: number, pageToken: string | null): Promise<DeletionLedgerPage>;
}
```

- `append` 성공 ack는 `eventKey`, `canonicalDigest`, `sequence`, `generation`, `ackedAt`을 반환한다. generation은 PII를 평문으로 넣을 수 없는 `g1`, `g2`, … 형식이다.
- `scanAfter`의 sequence는 exclusive cursor다. 후속 page는 최초 page의 upper bound를 유지해 scan 중 새 append가 현재 pagination에 섞이지 않는다.
- page token은 opaque하며 최초 cursor, 현재 위치, snapshot upper bound, generation에 결속된다. local fake는 versioned payload를 HMAC 서명하고 변조, 비정규 base64url, 다른 cursor/generation 재사용을 거절한다.

Production selector `runtime.server.ts`는 환경변수를 읽지 않고 항상 disabled adapter를 반환한다. disabled adapter의 두 동작은 `DeletionLedgerUnavailableError`로 fail closed한다. in-memory fake는 테스트/CI에서 명시적으로 생성할 때만 활성화된다.

## 2. PII-free event와 subject tombstone

event에는 다음 고정 필드만 canonicalize한다.

1. encoding version `1`
2. opaque `eventKey` (`evt_v1_k<positive-integer>_<64 lowercase hex>`)
3. event type `subject_deleted`
4. subject encoding version `1`
5. subject algorithm `hmac-sha256`
6. subject key version
7. 64자리 lowercase HMAC digest
8. millisecond precision UTC `occurredAt`

원문 user UUID, email, DOB, 거래 payload는 event key나 event payload에 넣지 않는다. event key는 원문 operation reference를 직접 받지 않고 `DeletionEventKeyFactory`의 domain-separated HMAC 출력만 받으며 TypeScript brand와 runtime format 검증을 함께 적용한다. subject 원문은 주입된 `SubjectHmacFactory` 호출 중에만 사용하고 반환 tombstone에는 남기지 않는다. 두 factory는 ill-formed Unicode reference를 UTF-8 변환 전에 거절해 서로 다른 UTF-16 입력이 replacement character로 합쳐지지 않게 한다. subject tombstone도 factory만 붙일 수 있는 비공개 TypeScript/runtime symbol brand를 요구해 plain structural object의 HMAC 사칭을 거절하며 symbol은 직렬화 결과에 나오지 않는다. 두 factory의 key version은 PII를 끼워 넣을 수 없는 `k1`, `k2`, … 형식으로 제한한다. options는 namespace, key version, key material을 각각 정확히 한 번 snapshot한 뒤 그 동일 값만 검증·사용한다.

event-key factory 입력은 다음 순서로 고정한다.

```text
ICONS-DELETION-EVENT-KEY-HMAC
encodingVersion:<bytes>:1
namespace:<bytes>:<namespace>
keyVersion:<bytes>:<k-version>
eventReference:<bytes>:<transient-operation-reference>
```

subject factory 입력도 별도 domain에서 versioned, UTF-8 byte-length fixed-field 순서로 고정한다.

```text
ICONS-DELETION-SUBJECT-HMAC
encodingVersion:<bytes>:1
namespace:<bytes>:<namespace>
keyVersion:<bytes>:<key-version>
subject:<bytes>:<transient-subject-reference>
```

canonical event도 `ICONS-DELETION-LEDGER-EVENT` domain 아래 위 8개 필드를 같은 fixed-field 문법으로 순서대로 인코딩한다. SHA-256 digest는 이 UTF-8 byte sequence에만 의존하고 객체 key 순서, locale, JSON serializer에 의존하지 않는다. synthetic fixture의 event-key HMAC, subject HMAC와 public `append` ack의 event digest literal은 `deletion-ledger.test.ts`에서 고정한다. fixture key material은 테스트 벡터일 뿐 credential이 아니다. factory와 fake는 전달받은 key bytes와 option scalars를 생성 시점에 복사해 caller mutation이 동일 instance의 계약을 바꾸지 못하게 한다.

아래 synthetic canonical literal의 SHA-256은 `74ec6bfef847e342dd1863ae8135e23a74853023d50fd60556b838490bfacf02`다. 테스트는 hidden encoder를 직접 호출하지 않고 공개 `append` ack에서 이 digest를 검증한다.

```text
ICONS-DELETION-LEDGER-EVENT
encodingVersion:1:1
eventKey:74:evt_v1_k1_c97251790c7bd894bfc3a758b5931819f5ed93f5cc1e8189962cf1e8f64022d4
eventType:15:subject_deleted
subjectEncodingVersion:1:1
subjectAlgorithm:11:hmac-sha256
subjectKeyVersion:2:k1
subjectDigest:64:f3caadbcf896064e1e84a1b46a5835a46869428709b02d1f338d82b9f5219559
occurredAt:24:2030-01-02T03:04:05.000Z
```

## 3. Append와 scan 규칙

- 새 event key는 append 성공 순서의 단조 sequence를 받고 불변 snapshot으로 저장된다.
- 같은 event key와 같은 canonical digest replay는 최초 ack를 그대로 반환하고 새 sequence를 만들지 않는다.
- 같은 event key와 다른 digest는 `DeletionLedgerConflictError`로 중단하며 최초 record를 덮어쓰지 않는다.
- caller가 append 뒤 입력 객체를 변경해도 저장된 record와 digest는 바뀌지 않는다.
- token 오류는 `invalid_page_token`, `cursor_mismatch`, `generation_mismatch`로 구분하되 어느 경우도 데이터를 반환하지 않는다.

fake는 process-local이고 restart persistence나 Production 내구성을 약속하지 않는다. local generation과 token key도 synthetic test input이며 운영 credential로 승격하지 않는다.

## 4. Local verification

저장소 root에서 다음을 실행한다.

```bash
npm test -- --run lib/privacy/deletion-ledger/deletion-ledger.test.ts lib/privacy/deletion-ledger/adapter-contract.test.ts
npm run lint
npm run typecheck
npm run build
```

contract suite는 fake의 성공 동작과 disabled의 적용 가능한 fail-closed 동작을 같은 seam에서 검사한다. disabled adapter에 append 성공을 요구하지 않는다.

## 5. #215에 남는 remote 범위

#240은 #215를 닫거나 Production readiness를 주장하지 않는다. #215는 별도 승인과 외부 evidence 아래 다음을 구현·검증해야 한다.

- 운영 Supabase와 backup lineage가 분리된 compliance 프로젝트와 append-only schema
- Production append-only credential, restore operator scan-only credential, 최소 권한 readback
- canonical digest·same-key replay/conflict·monotonic sequence가 이 local contract와 일치하는 remote adapter
- 독립 backup, key rotation, credential rotation, scan audit, generation 수명주기. rotation 중에는 기존 `kN` derivation key를 replay horizon까지 보존하고 event key에 기록된 version으로 같은 operation의 동일 key를 재생해야 한다.
- provider egress/writer 차단부터 replay checkpoint와 DB/Auth/Storage 잔여 0건까지의 Production restore drill
- Production runtime adapter 선택과 secret provisioning의 별도 승인

위 evidence 전에는 disabled runtime을 유지하고 hard delete, restore mutation, Production 연결을 실행하지 않는다.
