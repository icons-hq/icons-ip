/** Claim contact wire/DB contracts. Browser-safe: no environment, keys or crypto imports. */
// Snapshot of the reviewed machine contracts; runtime never imports output/ artifacts.
export const CLAIM_CONTACT_CONTRACT_HASHES = {
  "contract.json": "d0859ec508f0934e26f5dde4eb4b5ecfcd675ae739f2555e1d3cc0d341713285",
  "internal-contract.json": "b764b83c090d053181d1a06cb36c1c1752a5f47bb28f263133e6b2603caa8617"
} as const;

export type Uuid = string;

export type Instant = string;

export type Revision = number;

export type ClaimRevision = number;

export type KeyVersion = string;

export type Digest = string;

export type Target = "collection" | "reshipment";

export type ClaimType = "return" | "exchange";

export type Command = "change" | "reshipment";

export type ChangedField = "recipientName" | "phone" | "address2" | "postalCode" | "address1";

export type Address = {
  recipientName: string;
  phone: string;
  postalCode: string;
  address1: string;
  address2: string;
};

export type ContactEdit = {
  recipientName: string;
  phone: string;
  address2: string;
  /** Both fields are present for a full-address edit; absent on legacy replay. */
  postalCode?: string;
  address1?: string;
};

export type EncryptedField = {
  v: 1;
  kid: KeyVersion;
  iv: string;
  tag: string;
  ct: string;
};

export type EncryptedAddress = {
  recipientName: EncryptedField;
  phone: EncryptedField;
  postalCode: EncryptedField;
  address1: EncryptedField;
  address2: EncryptedField;
};

export type SourceBinding = {
  sourceKind: "seller_intake" | "order_delivery" | "contact_plan";
  sourceId: Uuid;
  sourceRevision: string | null;
  sourceFingerprint: Digest | null;
  planRevision: Revision;
  piiVersion: Uuid | null;
};

export type ContextClaims = {
  v: 1;
  purpose: "claim-contact/change-context" | "claim-contact/reshipment-context";
  environment: "local" | "preview" | "production";
  backendOrigin: string;
  actorId: Uuid;
  sessionId: Uuid;
  orderId: Uuid;
  claimId: Uuid;
  target: Target;
  expectedClaimType: ClaimType;
  expectedClaimRevision: ClaimRevision;
  source: SourceBinding;
  addressHmac: Digest;
  addressHmacKeyVersion: KeyVersion;
  issuedAt: Instant;
  expiresAt: Instant;
  signingKeyVersion: KeyVersion;
};

export type SignedContext = string;

export type RequestScope = {
  requestId: Uuid;
  orderId: Uuid;
  claimId: Uuid;
  target: Target;
};

export type ContextRequest = {
  requestId: Uuid;
  orderId: Uuid;
  claimId: Uuid;
  target: Target;
  command: Command;
};

export type ChangeRequest = {
  requestId: Uuid;
  orderId: Uuid;
  claimId: Uuid;
  target: Target;
  operationId: Uuid;
  signedContext: SignedContext;
  contact: ContactEdit;
  agreement: string;
  customerConfirmed: true;
  handoffNotStartedConfirmed: true;
};

export type ReshipmentItem = {
  orderItemId: Uuid;
  variantId: Uuid;
};

export type ReshipmentRequest = {
  requestId: Uuid;
  orderId: Uuid;
  claimId: Uuid;
  operationId: Uuid;
  signedContext: SignedContext;
  carrier: string;
  trackingNumber: string;
  items: Array<ReshipmentItem>;
  destinationConfirmed: true;
  dispatchConfirmed: true;
};

export type OperationRequest = {
  requestId: Uuid;
  orderId: Uuid;
  claimId: Uuid;
  operationId: Uuid;
  command: Command;
  target: Target;
  expectedClaimType: ClaimType;
  expectedClaimRevision: ClaimRevision;
  sealIfAbsent: boolean;
};

export type OperationReceipt = {
  operationId: Uuid;
  command: Command;
  orderId: Uuid;
  claimId: Uuid;
  target: Target;
  actorId: Uuid;
  sessionId: Uuid;
  expectedClaimType: ClaimType;
  expectedClaimRevision: ClaimRevision;
  resultClaimRevision: ClaimRevision | null;
  state: "saved" | "noop" | "sealed";
  changedFields: Array<ChangedField>;
  recordedAt: Instant;
  piiState: "retained" | "purged" | "not_stored";
};

export type ContextResponse = {
  requestId: Uuid;
  actorId: Uuid;
  sessionId: Uuid;
  orderId: Uuid;
  claimId: Uuid;
  target: Target;
  claimType: ClaimType;
  claimRevision: ClaimRevision;
  allowed: boolean;
  blocker: string | null;
  sourceKind: "seller_intake" | "order_delivery" | "contact_plan" | null;
  referenceOnly: boolean;
  piiState: "available" | "purged" | "restricted" | "unavailable" | "not_applicable";
  address: Address | null;
  signedContext: SignedContext | null;
  expiresAt: Instant | null;
  command: Command;
  unavailableReason: "retention_due" | "source_unavailable" | "crypto_unavailable" | null;
};

export type OperationResponse = {
  requestId: Uuid;
  actorId: Uuid;
  sessionId: Uuid;
  receipt: OperationReceipt | null;
};

export type SealedPlan = {
  planId: Uuid;
  piiVersion: Uuid;
  keyVersion: KeyVersion;
  addressHmac: Digest;
  addressHmacKeyVersion: KeyVersion;
  address: EncryptedAddress;
};

export type SealedHistory = {
  piiVersion: Uuid;
  keyVersion: KeyVersion;
  before: EncryptedAddress;
  after: EncryptedAddress;
  agreement: EncryptedField;
};

export type SealedChange = {
  effect: "change" | "noop";
  changedFields: Array<ChangedField>;
  beforeAddressHmac: Digest;
  afterAddressHmac: Digest;
  addressHmacKeyVersion: KeyVersion;
  plan: SealedPlan | null;
  history: SealedHistory | null;
  destinationCheck?: { before: { postalCode: string; address1: string }; after: { postalCode: string; address1: string } };
};

export type SealedDestination = {
  piiVersion: Uuid;
  keyVersion: KeyVersion;
  address: EncryptedAddress;
  addressHmac: Digest;
  addressHmacKeyVersion: KeyVersion;
  sourceKind: "seller_intake" | "order_delivery" | "contact_plan";
  sourceId: Uuid;
  sourceRevision: string | null;
  sourcePlanRevision: Revision;
  sourcePiiVersion: Uuid | null;
};

export type HistoryRequest = {
  requestId: Uuid;
  orderId: Uuid;
  claimId: Uuid;
  limit: number;
  cursor: {
    recordedAt: Instant;
    operationId: Uuid;
  } | null;
};

export type HistoryEntry = {
  operationId: Uuid;
  target: Target;
  changedFields: Array<ChangedField>;
  recordedAt: Instant;
  resultClaimRevision: ClaimRevision;
  piiState: "available" | "purged" | "restricted" | "unavailable";
  before: Address | null;
  after: Address | null;
  agreement: string | null;
  actorId: Uuid | null;
  unavailableReason: "retention_due" | "source_unavailable" | "crypto_unavailable" | null;
};

export type HistoryResponse = {
  requestId: Uuid;
  viewerId: Uuid;
  sessionId: Uuid;
  orderId: Uuid;
  claimId: Uuid;
  viewerKind: "operator" | "buyer" | "gift_recipient" | "gift_sender";
  piiAccess: boolean;
  current: {
    collection: TargetView;
    reshipment: TargetView;
  };
  entries: Array<HistoryEntry>;
  nextCursor: {
    recordedAt: Instant;
    operationId: Uuid;
  } | null;
  reshipmentDestination: {
    source: "v2_confirmed" | "legacy_unconfirmed" | "none";
    operationId: Uuid | null;
    recordedAt: Instant | null;
    piiState: "available" | "purged" | "restricted" | "unavailable" | "not_applicable";
    address: Address | null;
    unavailableReason: "retention_due" | "source_unavailable" | "crypto_unavailable" | null;
  };
};

export type ErrorResponse = {
  requestId: Uuid | null;
  code: string;
  message: string;
  conflict: boolean;
  uncertain: boolean;
  authChanged: boolean;
  recoveryOnly: boolean;
};

export type DbExpectedContext = {
  sourceKind: "seller_intake" | "order_delivery" | "contact_plan";
  sourceId: Uuid;
  sourceRevision: string | null;
  sourceFingerprint: Digest | null;
  planRevision: Revision;
  piiVersion: Uuid | null;
  addressHmac: Digest;
  addressHmacKeyVersion: KeyVersion;
};

export type TargetView = {
  target: Target;
  piiState: "available" | "purged" | "restricted" | "unavailable" | "not_applicable";
  sourceKind: "seller_intake" | "order_delivery" | "contact_plan" | null;
  referenceOnly: boolean;
  address: Address | null;
  unavailableReason: "retention_due" | "source_unavailable" | "crypto_unavailable" | null;
};

export type DbTargetView = {
  target: Target;
  piiState: "available" | "purged" | "restricted" | "unavailable" | "not_applicable";
  source: SourceBinding | null;
  referenceOnly: boolean;
  sourceAddress: Address | null;
  plan: SealedPlan | null;
  unavailableReason: "retention_due" | "source_unavailable" | "crypto_unavailable" | null;
};

export type DbContactContext = {
  orderId: Uuid;
  claimId: Uuid;
  target: Target;
  command: Command;
  claimType: ClaimType;
  claimRevision: ClaimRevision;
  allowed: boolean;
  blocker: string | null;
  current: DbTargetView;
};

export type DbOperationRecovery = {
  receipt: OperationReceipt | null;
  hmacKeyVersion: KeyVersion | null;
};

export type DbHistoryCiphertext = {
  recordId: Uuid;
  piiVersion: Uuid;
  keyVersion: KeyVersion;
  before: EncryptedAddress;
  after: EncryptedAddress;
  agreement: EncryptedField | null;
};

export type DbHistoryEntry = {
  operationId: Uuid;
  target: Target;
  changedFields: Array<ChangedField>;
  recordedAt: Instant;
  resultClaimRevision: ClaimRevision;
  piiState: "available" | "purged" | "restricted" | "unavailable";
  actorId: Uuid | null;
  ciphertext: DbHistoryCiphertext | null;
  unavailableReason: "retention_due" | "source_unavailable" | "crypto_unavailable" | null;
};

export type DbReshipmentDestinationView = {
  source: "v2_confirmed" | "legacy_unconfirmed" | "none";
  operationId: Uuid | null;
  recordedAt: Instant | null;
  piiState: "available" | "purged" | "restricted" | "unavailable" | "not_applicable";
  destination: SealedDestination | null;
  unavailableReason: "retention_due" | "source_unavailable" | "crypto_unavailable" | null;
};

export type DbContactHistory = {
  viewerId: Uuid;
  sessionId: Uuid;
  orderId: Uuid;
  claimId: Uuid;
  viewerKind: "operator" | "buyer" | "gift_recipient" | "gift_sender";
  piiAccess: boolean;
  current: {
    collection: DbTargetView;
    reshipment: DbTargetView;
  };
  entries: Array<DbHistoryEntry>;
  nextCursor: {
    recordedAt: Instant;
    operationId: Uuid;
  } | null;
  reshipmentDestination: DbReshipmentDestinationView;
};

export type RetentionCaseCommand = {
  action: "hold" | "extend" | "release" | "close";
  caseRef: OpaqueReference;
  approvalRef: OpaqueReference;
  legalBasis: LegalBasis;
  retainUntil: Instant | null;
  occurredAt: Instant;
};

export type NonnegativeCount = number;

export type OpaqueReference = string;

export type LegalBasis = "dispute_resolution" | "statutory_preservation" | "verified_rights_request";

export type RetentionCaseState = "held" | "released" | "closed";

export type RetentionCaseReceipt = {
  operationId: Uuid;
  orderId: Uuid;
  claimId: Uuid;
  actorId: Uuid;
  sessionId: Uuid;
  caseRef: OpaqueReference;
  action: "hold" | "extend" | "release" | "close";
  legalBasis: LegalBasis;
  expectedRevision: Revision;
  resultRevision: Revision;
  state: RetentionCaseState;
  retainUntil: Instant | null;
  caseClosedAt: Instant | null;
  releasedAt: Instant | null;
  occurredAt: Instant;
  recordedAt: Instant;
};

export type ContactDataCounts = {
  plans: NonnegativeCount;
  operations: NonnegativeCount;
  destinations: NonnegativeCount;
  addressEnvelopes: NonnegativeCount;
  agreementEnvelopes: NonnegativeCount;
  requestHmacs: NonnegativeCount;
  addressHmacs: NonnegativeCount;
  operatorReferences: NonnegativeCount;
};

export type RetentionScope = {
  orderId: Uuid;
  claimId: Uuid;
  subjectKind: "buyer" | "gift_recipient";
  state: "operational_pending" | "operational_unknown" | "not_due" | "held" | "due" | "purged";
  purposeEndedAt: Instant | null;
  basePurgeAt: Instant | null;
  effectivePurgeAt: Instant | null;
  activeHoldCount: NonnegativeCount;
  expiredHoldCount: NonnegativeCount;
  remaining: ContactDataCounts;
};

export type ContactDataInventory = {
  subjectId: Uuid;
  actorId: Uuid;
  sessionId: Uuid;
  recordedAt: Instant;
  scopes: Array<RetentionScope>;
  nextClaimId: Uuid | null;
  operatorReferenceCount: NonnegativeCount;
};

export type PurgeRemainingCounts = {
  eligibleScopes: NonnegativeCount;
  heldScopes: NonnegativeCount;
  notDueScopes: NonnegativeCount;
  operationallyBlockedScopes: NonnegativeCount;
  piiFields: NonnegativeCount;
  operatorReferences: NonnegativeCount;
};

export type ContactPurgeReceipt = {
  operationId: Uuid;
  subjectId: Uuid;
  actorId: Uuid;
  sessionId: Uuid;
  cutoff: Instant;
  limit: number;
  recordedAt: Instant;
  purgedClaimIds: Array<Uuid>;
  purgedTargetCount: NonnegativeCount;
  removed: (ContactDataCounts) & ({
    operatorReferences?: 0;
  });
  selectedResidualPiiFields: 0;
  remaining: PurgeRemainingCounts;
};

export interface ClaimContactContracts {
  Uuid: Uuid;
  Instant: Instant;
  Revision: Revision;
  ClaimRevision: ClaimRevision;
  KeyVersion: KeyVersion;
  Digest: Digest;
  Target: Target;
  ClaimType: ClaimType;
  Command: Command;
  ChangedField: ChangedField;
  Address: Address;
  ContactEdit: ContactEdit;
  EncryptedField: EncryptedField;
  EncryptedAddress: EncryptedAddress;
  SourceBinding: SourceBinding;
  ContextClaims: ContextClaims;
  SignedContext: SignedContext;
  RequestScope: RequestScope;
  ContextRequest: ContextRequest;
  ChangeRequest: ChangeRequest;
  ReshipmentItem: ReshipmentItem;
  ReshipmentRequest: ReshipmentRequest;
  OperationRequest: OperationRequest;
  OperationReceipt: OperationReceipt;
  ContextResponse: ContextResponse;
  OperationResponse: OperationResponse;
  SealedPlan: SealedPlan;
  SealedHistory: SealedHistory;
  SealedChange: SealedChange;
  SealedDestination: SealedDestination;
  HistoryRequest: HistoryRequest;
  HistoryEntry: HistoryEntry;
  HistoryResponse: HistoryResponse;
  ErrorResponse: ErrorResponse;
  DbExpectedContext: DbExpectedContext;
  TargetView: TargetView;
  DbTargetView: DbTargetView;
  DbContactContext: DbContactContext;
  DbOperationRecovery: DbOperationRecovery;
  DbHistoryCiphertext: DbHistoryCiphertext;
  DbHistoryEntry: DbHistoryEntry;
  DbReshipmentDestinationView: DbReshipmentDestinationView;
  DbContactHistory: DbContactHistory;
  RetentionCaseCommand: RetentionCaseCommand;
  NonnegativeCount: NonnegativeCount;
  OpaqueReference: OpaqueReference;
  LegalBasis: LegalBasis;
  RetentionCaseState: RetentionCaseState;
  RetentionCaseReceipt: RetentionCaseReceipt;
  ContactDataCounts: ContactDataCounts;
  RetentionScope: RetentionScope;
  ContactDataInventory: ContactDataInventory;
  PurgeRemainingCounts: PurgeRemainingCounts;
  ContactPurgeReceipt: ContactPurgeReceipt;
}
export type ClaimContactContractName = keyof ClaimContactContracts;

type Schema = {
  $ref?: string; type?: string; const?: unknown; enum?: readonly unknown[];
  properties?: Record<string, Schema>; required?: readonly string[]; additionalProperties?: boolean;
  items?: Schema; minItems?: number; maxItems?: number; uniqueItems?: boolean;
  minLength?: number; maxLength?: number; pattern?: string; format?: string; minimum?: number; maximum?: number;
  anyOf?: readonly Schema[]; oneOf?: readonly Schema[]; allOf?: readonly Schema[]; if?: Schema; then?: Schema; else?: Schema; not?: Schema;
};

const SCHEMAS: Record<keyof ClaimContactContracts, Schema> = {
  Uuid: {"type":"string","minLength":36,"maxLength":36,"pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},
  Instant: {"type":"string","format":"date-time"},
  Revision: {"type":"integer","minimum":0,"maximum":9007199254740991},
  ClaimRevision: {"type":"integer","minimum":0,"maximum":2147483647},
  KeyVersion: {"type":"string","minLength":1,"maxLength":64,"pattern":"^[A-Za-z0-9_-]+$"},
  Digest: {"type":"string","minLength":64,"maxLength":64,"pattern":"^[0-9a-f]{64}$"},
  Target: {"enum":["collection","reshipment"]},
  ClaimType: {"enum":["return","exchange"]},
  Command: {"enum":["change","reshipment"]},
  ChangedField: {"enum":["recipientName","phone","address2","postalCode","address1"]},
  Address: {"type":"object","additionalProperties":false,"properties":{"recipientName":{"type":"string","minLength":1,"maxLength":50},"phone":{"type":"string","minLength":8,"maxLength":15,"pattern":"^[0-9]+$"},"postalCode":{"type":"string","minLength":1,"maxLength":20},"address1":{"type":"string","minLength":1,"maxLength":200},"address2":{"type":"string","minLength":0,"maxLength":200}},"required":["recipientName","phone","postalCode","address1","address2"]},
  ContactEdit: {"type":"object","additionalProperties":false,"properties":{"recipientName":{"type":"string","minLength":1,"maxLength":50},"phone":{"type":"string","minLength":8,"maxLength":15,"pattern":"^[0-9]+$"},"address2":{"type":"string","minLength":0,"maxLength":200},"postalCode":{"type":"string","minLength":5,"maxLength":5,"pattern":"^[0-9]{5}$"},"address1":{"type":"string","minLength":1,"maxLength":200}},"required":["recipientName","phone","address2"],"allOf":[{"if":{"required":["postalCode"]},"then":{"required":["address1"]}},{"if":{"required":["address1"]},"then":{"required":["postalCode"]}}]},
  EncryptedField: {"type":"object","additionalProperties":false,"properties":{"v":{"const":1},"kid":{"$ref":"#/$defs/KeyVersion"},"iv":{"type":"string","minLength":16,"maxLength":16,"pattern":"^[A-Za-z0-9_-]+$"},"tag":{"type":"string","minLength":22,"maxLength":22,"pattern":"^[A-Za-z0-9_-]+$"},"ct":{"type":"string","minLength":0,"maxLength":8192,"pattern":"^[A-Za-z0-9_-]*$"}},"required":["v","kid","iv","tag","ct"]},
  EncryptedAddress: {"type":"object","additionalProperties":false,"properties":{"recipientName":{"$ref":"#/$defs/EncryptedField"},"phone":{"$ref":"#/$defs/EncryptedField"},"postalCode":{"$ref":"#/$defs/EncryptedField"},"address1":{"$ref":"#/$defs/EncryptedField"},"address2":{"$ref":"#/$defs/EncryptedField"}},"required":["recipientName","phone","postalCode","address1","address2"]},
  SourceBinding: {"type":"object","additionalProperties":false,"properties":{"sourceKind":{"enum":["seller_intake","order_delivery","contact_plan"]},"sourceId":{"$ref":"#/$defs/Uuid"},"sourceRevision":{"anyOf":[{"type":"string","minLength":1,"maxLength":200},{"type":"null"}]},"sourceFingerprint":{"anyOf":[{"$ref":"#/$defs/Digest"},{"type":"null"}]},"planRevision":{"$ref":"#/$defs/Revision"},"piiVersion":{"anyOf":[{"$ref":"#/$defs/Uuid"},{"type":"null"}]}},"required":["sourceKind","sourceId","sourceRevision","sourceFingerprint","planRevision","piiVersion"],"allOf":[{"if":{"properties":{"sourceKind":{"const":"seller_intake"}},"required":["sourceKind"]},"then":{"properties":{"sourceRevision":{"type":"null"},"sourceFingerprint":{"$ref":"#/$defs/Digest"},"planRevision":{"const":0},"piiVersion":{"type":"null"}}}},{"if":{"properties":{"sourceKind":{"const":"order_delivery"}},"required":["sourceKind"]},"then":{"properties":{"sourceRevision":{"type":"string","pattern":"^(0|[1-9][0-9]*)$"},"sourceFingerprint":{"$ref":"#/$defs/Digest"},"planRevision":{"const":0},"piiVersion":{"type":"null"}}}},{"if":{"properties":{"sourceKind":{"const":"contact_plan"}},"required":["sourceKind"]},"then":{"properties":{"sourceRevision":{"type":"null"},"sourceFingerprint":{"type":"null"},"planRevision":{"type":"integer","minimum":1,"maximum":9007199254740991},"piiVersion":{"$ref":"#/$defs/Uuid"}}}}]},
  ContextClaims: {"type":"object","additionalProperties":false,"properties":{"v":{"const":1},"purpose":{"enum":["claim-contact/change-context","claim-contact/reshipment-context"]},"environment":{"enum":["local","preview","production"]},"backendOrigin":{"type":"string","minLength":8,"maxLength":300},"actorId":{"$ref":"#/$defs/Uuid"},"sessionId":{"$ref":"#/$defs/Uuid"},"orderId":{"$ref":"#/$defs/Uuid"},"claimId":{"$ref":"#/$defs/Uuid"},"target":{"$ref":"#/$defs/Target"},"expectedClaimType":{"$ref":"#/$defs/ClaimType"},"expectedClaimRevision":{"$ref":"#/$defs/ClaimRevision"},"source":{"$ref":"#/$defs/SourceBinding"},"addressHmac":{"$ref":"#/$defs/Digest"},"addressHmacKeyVersion":{"$ref":"#/$defs/KeyVersion"},"issuedAt":{"$ref":"#/$defs/Instant"},"expiresAt":{"$ref":"#/$defs/Instant"},"signingKeyVersion":{"$ref":"#/$defs/KeyVersion"}},"required":["v","purpose","environment","backendOrigin","actorId","sessionId","orderId","claimId","target","expectedClaimType","expectedClaimRevision","source","addressHmac","addressHmacKeyVersion","issuedAt","expiresAt","signingKeyVersion"]},
  SignedContext: {"type":"string","minLength":1,"maxLength":12000,"pattern":"^cc1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$"},
  RequestScope: {"type":"object","additionalProperties":false,"properties":{"requestId":{"$ref":"#/$defs/Uuid"},"orderId":{"$ref":"#/$defs/Uuid"},"claimId":{"$ref":"#/$defs/Uuid"},"target":{"$ref":"#/$defs/Target"}},"required":["requestId","orderId","claimId","target"]},
  ContextRequest: {"type":"object","additionalProperties":false,"properties":{"requestId":{"$ref":"#/$defs/Uuid"},"orderId":{"$ref":"#/$defs/Uuid"},"claimId":{"$ref":"#/$defs/Uuid"},"target":{"$ref":"#/$defs/Target"},"command":{"$ref":"#/$defs/Command"}},"required":["requestId","orderId","claimId","target","command"],"allOf":[{"if":{"properties":{"command":{"const":"reshipment"}},"required":["command"]},"then":{"properties":{"target":{"const":"reshipment"}}}}]},
  ChangeRequest: {"type":"object","additionalProperties":false,"properties":{"requestId":{"$ref":"#/$defs/Uuid"},"orderId":{"$ref":"#/$defs/Uuid"},"claimId":{"$ref":"#/$defs/Uuid"},"target":{"$ref":"#/$defs/Target"},"operationId":{"$ref":"#/$defs/Uuid"},"signedContext":{"$ref":"#/$defs/SignedContext"},"contact":{"$ref":"#/$defs/ContactEdit"},"agreement":{"type":"string","minLength":2,"maxLength":500},"customerConfirmed":{"const":true},"handoffNotStartedConfirmed":{"const":true}},"required":["requestId","orderId","claimId","target","operationId","signedContext","contact","agreement","customerConfirmed","handoffNotStartedConfirmed"]},
  ReshipmentItem: {"type":"object","additionalProperties":false,"properties":{"orderItemId":{"$ref":"#/$defs/Uuid"},"variantId":{"$ref":"#/$defs/Uuid"}},"required":["orderItemId","variantId"]},
  ReshipmentRequest: {"type":"object","additionalProperties":false,"properties":{"requestId":{"$ref":"#/$defs/Uuid"},"orderId":{"$ref":"#/$defs/Uuid"},"claimId":{"$ref":"#/$defs/Uuid"},"operationId":{"$ref":"#/$defs/Uuid"},"signedContext":{"$ref":"#/$defs/SignedContext"},"carrier":{"type":"string","minLength":1,"maxLength":40},"trackingNumber":{"type":"string","minLength":8,"maxLength":30,"pattern":"^[A-Z0-9]+$"},"items":{"type":"array","items":{"$ref":"#/$defs/ReshipmentItem"},"maxItems":1000,"uniqueItems":true},"destinationConfirmed":{"const":true},"dispatchConfirmed":{"const":true}},"required":["requestId","orderId","claimId","operationId","signedContext","carrier","trackingNumber","items","destinationConfirmed","dispatchConfirmed"]},
  OperationRequest: {"type":"object","additionalProperties":false,"properties":{"requestId":{"$ref":"#/$defs/Uuid"},"orderId":{"$ref":"#/$defs/Uuid"},"claimId":{"$ref":"#/$defs/Uuid"},"operationId":{"$ref":"#/$defs/Uuid"},"command":{"$ref":"#/$defs/Command"},"target":{"$ref":"#/$defs/Target"},"expectedClaimType":{"$ref":"#/$defs/ClaimType"},"expectedClaimRevision":{"$ref":"#/$defs/ClaimRevision"},"sealIfAbsent":{"type":"boolean"}},"required":["requestId","orderId","claimId","operationId","command","target","expectedClaimType","expectedClaimRevision","sealIfAbsent"],"allOf":[{"if":{"properties":{"command":{"const":"reshipment"}},"required":["command"]},"then":{"properties":{"target":{"const":"reshipment"},"expectedClaimType":{"const":"exchange"}}}}]},
  OperationReceipt: {"type":"object","additionalProperties":false,"properties":{"operationId":{"$ref":"#/$defs/Uuid"},"command":{"$ref":"#/$defs/Command"},"orderId":{"$ref":"#/$defs/Uuid"},"claimId":{"$ref":"#/$defs/Uuid"},"target":{"$ref":"#/$defs/Target"},"actorId":{"$ref":"#/$defs/Uuid"},"sessionId":{"$ref":"#/$defs/Uuid"},"expectedClaimType":{"$ref":"#/$defs/ClaimType"},"expectedClaimRevision":{"$ref":"#/$defs/ClaimRevision"},"resultClaimRevision":{"anyOf":[{"$ref":"#/$defs/ClaimRevision"},{"type":"null"}]},"state":{"enum":["saved","noop","sealed"]},"changedFields":{"type":"array","items":{"$ref":"#/$defs/ChangedField"},"maxItems":5,"uniqueItems":true},"recordedAt":{"$ref":"#/$defs/Instant"},"piiState":{"enum":["retained","purged","not_stored"]}},"required":["operationId","command","orderId","claimId","target","actorId","sessionId","expectedClaimType","expectedClaimRevision","resultClaimRevision","state","changedFields","recordedAt","piiState"],"allOf":[{"if":{"properties":{"state":{"const":"sealed"}},"required":["state"]},"then":{"properties":{"resultClaimRevision":{"type":"null"},"changedFields":{"maxItems":0},"piiState":{"const":"not_stored"}}}},{"if":{"properties":{"state":{"const":"noop"}},"required":["state"]},"then":{"properties":{"resultClaimRevision":{"$ref":"#/$defs/ClaimRevision"},"changedFields":{"maxItems":0},"piiState":{"enum":["not_stored","purged"]}}}},{"if":{"properties":{"state":{"const":"saved"}},"required":["state"]},"then":{"properties":{"resultClaimRevision":{"$ref":"#/$defs/ClaimRevision"}}}},{"if":{"properties":{"command":{"const":"reshipment"}},"required":["command"]},"then":{"properties":{"target":{"const":"reshipment"},"expectedClaimType":{"const":"exchange"},"changedFields":{"maxItems":0}}}}]},
  ContextResponse: {"type":"object","additionalProperties":false,"properties":{"requestId":{"$ref":"#/$defs/Uuid"},"actorId":{"$ref":"#/$defs/Uuid"},"sessionId":{"$ref":"#/$defs/Uuid"},"orderId":{"$ref":"#/$defs/Uuid"},"claimId":{"$ref":"#/$defs/Uuid"},"target":{"$ref":"#/$defs/Target"},"claimType":{"$ref":"#/$defs/ClaimType"},"claimRevision":{"$ref":"#/$defs/ClaimRevision"},"allowed":{"type":"boolean"},"blocker":{"anyOf":[{"type":"string","minLength":1,"maxLength":100},{"type":"null"}]},"sourceKind":{"anyOf":[{"enum":["seller_intake","order_delivery","contact_plan"]},{"type":"null"}]},"referenceOnly":{"type":"boolean"},"piiState":{"enum":["available","purged","restricted","unavailable","not_applicable"]},"address":{"anyOf":[{"$ref":"#/$defs/Address"},{"type":"null"}]},"signedContext":{"anyOf":[{"$ref":"#/$defs/SignedContext"},{"type":"null"}]},"expiresAt":{"anyOf":[{"$ref":"#/$defs/Instant"},{"type":"null"}]},"command":{"$ref":"#/$defs/Command"},"unavailableReason":{"anyOf":[{"enum":["retention_due","source_unavailable","crypto_unavailable"]},{"type":"null"}]}},"required":["requestId","actorId","sessionId","orderId","claimId","target","claimType","claimRevision","allowed","blocker","sourceKind","referenceOnly","piiState","address","signedContext","expiresAt","command","unavailableReason"],"allOf":[{"if":{"properties":{"allowed":{"const":true}},"required":["allowed"]},"then":{"properties":{"blocker":{"type":"null"},"piiState":{"const":"available"},"address":{"$ref":"#/$defs/Address"},"signedContext":{"$ref":"#/$defs/SignedContext"},"expiresAt":{"$ref":"#/$defs/Instant"}}}},{"if":{"properties":{"allowed":{"const":false}},"required":["allowed"]},"then":{"properties":{"blocker":{"type":"string","minLength":1,"maxLength":100},"signedContext":{"type":"null"},"expiresAt":{"type":"null"}}}},{"if":{"properties":{"piiState":{"const":"unavailable"}},"required":["piiState"]},"then":{"properties":{"unavailableReason":{"enum":["retention_due","source_unavailable","crypto_unavailable"]}}},"else":{"properties":{"unavailableReason":{"type":"null"}}}}]},
  OperationResponse: {"type":"object","additionalProperties":false,"properties":{"requestId":{"$ref":"#/$defs/Uuid"},"actorId":{"$ref":"#/$defs/Uuid"},"sessionId":{"$ref":"#/$defs/Uuid"},"receipt":{"anyOf":[{"$ref":"#/$defs/OperationReceipt"},{"type":"null"}]}},"required":["requestId","actorId","sessionId","receipt"]},
  SealedPlan: {"type":"object","additionalProperties":false,"properties":{"planId":{"$ref":"#/$defs/Uuid"},"piiVersion":{"$ref":"#/$defs/Uuid"},"keyVersion":{"$ref":"#/$defs/KeyVersion"},"addressHmac":{"$ref":"#/$defs/Digest"},"addressHmacKeyVersion":{"$ref":"#/$defs/KeyVersion"},"address":{"$ref":"#/$defs/EncryptedAddress"}},"required":["planId","piiVersion","keyVersion","addressHmac","addressHmacKeyVersion","address"]},
  SealedHistory: {"type":"object","additionalProperties":false,"properties":{"piiVersion":{"$ref":"#/$defs/Uuid"},"keyVersion":{"$ref":"#/$defs/KeyVersion"},"before":{"$ref":"#/$defs/EncryptedAddress"},"after":{"$ref":"#/$defs/EncryptedAddress"},"agreement":{"$ref":"#/$defs/EncryptedField"}},"required":["piiVersion","keyVersion","before","after","agreement"]},
  SealedChange: {"type":"object","additionalProperties":false,"properties":{"effect":{"enum":["change","noop"]},"changedFields":{"type":"array","items":{"$ref":"#/$defs/ChangedField"},"maxItems":5,"uniqueItems":true},"beforeAddressHmac":{"$ref":"#/$defs/Digest"},"afterAddressHmac":{"$ref":"#/$defs/Digest"},"addressHmacKeyVersion":{"$ref":"#/$defs/KeyVersion"},"plan":{"anyOf":[{"$ref":"#/$defs/SealedPlan"},{"type":"null"}]},"history":{"anyOf":[{"$ref":"#/$defs/SealedHistory"},{"type":"null"}]},"destinationCheck":{"type":"object","additionalProperties":false,"properties":{"before":{"type":"object","additionalProperties":false,"properties":{"postalCode":{"type":"string","minLength":1,"maxLength":20},"address1":{"type":"string","minLength":1,"maxLength":200}},"required":["postalCode","address1"]},"after":{"type":"object","additionalProperties":false,"properties":{"postalCode":{"type":"string","minLength":1,"maxLength":20},"address1":{"type":"string","minLength":1,"maxLength":200}},"required":["postalCode","address1"]}},"required":["before","after"]}},"required":["effect","changedFields","beforeAddressHmac","afterAddressHmac","addressHmacKeyVersion","plan","history"],"allOf":[{"if":{"properties":{"effect":{"const":"noop"}}},"then":{"properties":{"changedFields":{"maxItems":0},"plan":{"type":"null"},"history":{"type":"null"}}},"else":{"properties":{"changedFields":{"minItems":1},"plan":{"$ref":"#/$defs/SealedPlan"},"history":{"$ref":"#/$defs/SealedHistory"}}}}]},
  SealedDestination: {"type":"object","additionalProperties":false,"properties":{"piiVersion":{"$ref":"#/$defs/Uuid"},"keyVersion":{"$ref":"#/$defs/KeyVersion"},"address":{"$ref":"#/$defs/EncryptedAddress"},"addressHmac":{"$ref":"#/$defs/Digest"},"addressHmacKeyVersion":{"$ref":"#/$defs/KeyVersion"},"sourceKind":{"enum":["seller_intake","order_delivery","contact_plan"]},"sourceId":{"$ref":"#/$defs/Uuid"},"sourceRevision":{"anyOf":[{"type":"string","minLength":1,"maxLength":200},{"type":"null"}]},"sourcePlanRevision":{"$ref":"#/$defs/Revision"},"sourcePiiVersion":{"anyOf":[{"$ref":"#/$defs/Uuid"},{"type":"null"}]}},"required":["piiVersion","keyVersion","address","addressHmac","addressHmacKeyVersion","sourceKind","sourceId","sourceRevision","sourcePlanRevision","sourcePiiVersion"]},
  HistoryRequest: {"type":"object","additionalProperties":false,"properties":{"requestId":{"$ref":"#/$defs/Uuid"},"orderId":{"$ref":"#/$defs/Uuid"},"claimId":{"$ref":"#/$defs/Uuid"},"limit":{"type":"integer","minimum":1,"maximum":20},"cursor":{"anyOf":[{"type":"object","additionalProperties":false,"properties":{"recordedAt":{"$ref":"#/$defs/Instant"},"operationId":{"$ref":"#/$defs/Uuid"}},"required":["recordedAt","operationId"]},{"type":"null"}]}},"required":["requestId","orderId","claimId","limit","cursor"]},
  HistoryEntry: {"type":"object","additionalProperties":false,"properties":{"operationId":{"$ref":"#/$defs/Uuid"},"target":{"$ref":"#/$defs/Target"},"changedFields":{"type":"array","items":{"$ref":"#/$defs/ChangedField"},"maxItems":5,"uniqueItems":true},"recordedAt":{"$ref":"#/$defs/Instant"},"resultClaimRevision":{"$ref":"#/$defs/ClaimRevision"},"piiState":{"enum":["available","purged","restricted","unavailable"]},"before":{"anyOf":[{"$ref":"#/$defs/Address"},{"type":"null"}]},"after":{"anyOf":[{"$ref":"#/$defs/Address"},{"type":"null"}]},"agreement":{"anyOf":[{"type":"string","minLength":2,"maxLength":500},{"type":"null"}]},"actorId":{"anyOf":[{"$ref":"#/$defs/Uuid"},{"type":"null"}]},"unavailableReason":{"anyOf":[{"enum":["retention_due","source_unavailable","crypto_unavailable"]},{"type":"null"}]}},"required":["operationId","target","changedFields","recordedAt","resultClaimRevision","piiState","before","after","agreement","actorId","unavailableReason"],"allOf":[{"if":{"properties":{"piiState":{"const":"unavailable"}},"required":["piiState"]},"then":{"properties":{"unavailableReason":{"enum":["retention_due","source_unavailable","crypto_unavailable"]}}},"else":{"properties":{"unavailableReason":{"type":"null"}}}}]},
  HistoryResponse: {"type":"object","additionalProperties":false,"properties":{"requestId":{"$ref":"#/$defs/Uuid"},"viewerId":{"$ref":"#/$defs/Uuid"},"sessionId":{"$ref":"#/$defs/Uuid"},"orderId":{"$ref":"#/$defs/Uuid"},"claimId":{"$ref":"#/$defs/Uuid"},"viewerKind":{"enum":["operator","buyer","gift_recipient","gift_sender"]},"piiAccess":{"type":"boolean"},"current":{"type":"object","additionalProperties":false,"properties":{"collection":{"$ref":"#/$defs/TargetView"},"reshipment":{"$ref":"#/$defs/TargetView"}},"required":["collection","reshipment"]},"entries":{"type":"array","items":{"$ref":"#/$defs/HistoryEntry"},"maxItems":20},"nextCursor":{"anyOf":[{"type":"object","additionalProperties":false,"properties":{"recordedAt":{"$ref":"#/$defs/Instant"},"operationId":{"$ref":"#/$defs/Uuid"}},"required":["recordedAt","operationId"]},{"type":"null"}]},"reshipmentDestination":{"type":"object","additionalProperties":false,"properties":{"source":{"enum":["v2_confirmed","legacy_unconfirmed","none"]},"operationId":{"anyOf":[{"$ref":"#/$defs/Uuid"},{"type":"null"}]},"recordedAt":{"anyOf":[{"$ref":"#/$defs/Instant"},{"type":"null"}]},"piiState":{"enum":["available","purged","restricted","unavailable","not_applicable"]},"address":{"anyOf":[{"$ref":"#/$defs/Address"},{"type":"null"}]},"unavailableReason":{"anyOf":[{"enum":["retention_due","source_unavailable","crypto_unavailable"]},{"type":"null"}]}},"required":["source","operationId","recordedAt","piiState","address","unavailableReason"],"allOf":[{"if":{"properties":{"piiState":{"const":"unavailable"}},"required":["piiState"]},"then":{"properties":{"unavailableReason":{"enum":["retention_due","source_unavailable","crypto_unavailable"]}}},"else":{"properties":{"unavailableReason":{"type":"null"}}}}]}},"required":["requestId","viewerId","sessionId","orderId","claimId","viewerKind","piiAccess","current","entries","nextCursor","reshipmentDestination"]},
  ErrorResponse: {"type":"object","additionalProperties":false,"properties":{"requestId":{"anyOf":[{"$ref":"#/$defs/Uuid"},{"type":"null"}]},"code":{"type":"string","minLength":1,"maxLength":100},"message":{"type":"string","minLength":1,"maxLength":300},"conflict":{"type":"boolean"},"uncertain":{"type":"boolean"},"authChanged":{"type":"boolean"},"recoveryOnly":{"type":"boolean"}},"required":["requestId","code","message","conflict","uncertain","authChanged","recoveryOnly"]},
  DbExpectedContext: {"type":"object","additionalProperties":false,"properties":{"sourceKind":{"enum":["seller_intake","order_delivery","contact_plan"]},"sourceId":{"$ref":"#/$defs/Uuid"},"sourceRevision":{"anyOf":[{"type":"string","minLength":1,"maxLength":200},{"type":"null"}]},"sourceFingerprint":{"anyOf":[{"$ref":"#/$defs/Digest"},{"type":"null"}]},"planRevision":{"$ref":"#/$defs/Revision"},"piiVersion":{"anyOf":[{"$ref":"#/$defs/Uuid"},{"type":"null"}]},"addressHmac":{"$ref":"#/$defs/Digest"},"addressHmacKeyVersion":{"$ref":"#/$defs/KeyVersion"}},"required":["sourceKind","sourceId","sourceRevision","sourceFingerprint","planRevision","piiVersion","addressHmac","addressHmacKeyVersion"],"allOf":[{"if":{"properties":{"sourceKind":{"const":"seller_intake"}},"required":["sourceKind"]},"then":{"properties":{"sourceRevision":{"type":"null"},"sourceFingerprint":{"$ref":"#/$defs/Digest"},"planRevision":{"const":0},"piiVersion":{"type":"null"}}}},{"if":{"properties":{"sourceKind":{"const":"order_delivery"}},"required":["sourceKind"]},"then":{"properties":{"sourceRevision":{"type":"string","pattern":"^(0|[1-9][0-9]*)$"},"sourceFingerprint":{"$ref":"#/$defs/Digest"},"planRevision":{"const":0},"piiVersion":{"type":"null"}}}},{"if":{"properties":{"sourceKind":{"const":"contact_plan"}},"required":["sourceKind"]},"then":{"properties":{"sourceRevision":{"type":"null"},"sourceFingerprint":{"type":"null"},"planRevision":{"type":"integer","minimum":1,"maximum":9007199254740991},"piiVersion":{"$ref":"#/$defs/Uuid"}}}}]},
  TargetView: {"type":"object","additionalProperties":false,"properties":{"target":{"$ref":"#/$defs/Target"},"piiState":{"enum":["available","purged","restricted","unavailable","not_applicable"]},"sourceKind":{"anyOf":[{"enum":["seller_intake","order_delivery","contact_plan"]},{"type":"null"}]},"referenceOnly":{"type":"boolean"},"address":{"anyOf":[{"$ref":"#/$defs/Address"},{"type":"null"}]},"unavailableReason":{"anyOf":[{"enum":["retention_due","source_unavailable","crypto_unavailable"]},{"type":"null"}]}},"required":["target","piiState","sourceKind","referenceOnly","address","unavailableReason"],"allOf":[{"if":{"properties":{"piiState":{"const":"available"}},"required":["piiState"]},"then":{"properties":{"address":{"$ref":"#/$defs/Address"}}},"else":{"properties":{"address":{"type":"null"}}}},{"if":{"properties":{"piiState":{"const":"unavailable"}},"required":["piiState"]},"then":{"properties":{"unavailableReason":{"enum":["retention_due","source_unavailable","crypto_unavailable"]}}},"else":{"properties":{"unavailableReason":{"type":"null"}}}},{"if":{"properties":{"piiState":{"not":{"const":"available"}}},"required":["piiState"]},"then":{"properties":{"referenceOnly":{"const":false},"sourceKind":{"type":"null"}}}}]},
  DbTargetView: {"type":"object","additionalProperties":false,"properties":{"target":{"$ref":"#/$defs/Target"},"piiState":{"enum":["available","purged","restricted","unavailable","not_applicable"]},"source":{"anyOf":[{"$ref":"#/$defs/SourceBinding"},{"type":"null"}]},"referenceOnly":{"type":"boolean"},"sourceAddress":{"anyOf":[{"$ref":"#/$defs/Address"},{"type":"null"}]},"plan":{"anyOf":[{"$ref":"#/$defs/SealedPlan"},{"type":"null"}]},"unavailableReason":{"anyOf":[{"enum":["retention_due","source_unavailable","crypto_unavailable"]},{"type":"null"}]}},"required":["target","piiState","source","referenceOnly","sourceAddress","plan","unavailableReason"],"allOf":[{"if":{"properties":{"piiState":{"const":"available"}},"required":["piiState"]},"then":{"properties":{"source":{"$ref":"#/$defs/SourceBinding"}},"oneOf":[{"properties":{"sourceAddress":{"$ref":"#/$defs/Address"},"plan":{"type":"null"},"source":{"allOf":[{"$ref":"#/$defs/SourceBinding"},{"properties":{"sourceKind":{"enum":["seller_intake","order_delivery"]}}}]}}},{"properties":{"sourceAddress":{"type":"null"},"plan":{"$ref":"#/$defs/SealedPlan"},"source":{"allOf":[{"$ref":"#/$defs/SourceBinding"},{"properties":{"sourceKind":{"const":"contact_plan"}}}]}}}]},"else":{"properties":{"source":{"type":"null"},"sourceAddress":{"type":"null"},"plan":{"type":"null"}}}},{"if":{"properties":{"piiState":{"const":"unavailable"}},"required":["piiState"]},"then":{"properties":{"unavailableReason":{"enum":["retention_due","source_unavailable","crypto_unavailable"]}}},"else":{"properties":{"unavailableReason":{"type":"null"}}}},{"if":{"properties":{"piiState":{"not":{"const":"available"}}},"required":["piiState"]},"then":{"properties":{"referenceOnly":{"const":false}}}}]},
  DbContactContext: {"type":"object","additionalProperties":false,"properties":{"orderId":{"$ref":"#/$defs/Uuid"},"claimId":{"$ref":"#/$defs/Uuid"},"target":{"$ref":"#/$defs/Target"},"command":{"$ref":"#/$defs/Command"},"claimType":{"$ref":"#/$defs/ClaimType"},"claimRevision":{"$ref":"#/$defs/ClaimRevision"},"allowed":{"type":"boolean"},"blocker":{"anyOf":[{"type":"string","minLength":1,"maxLength":100},{"type":"null"}]},"current":{"$ref":"#/$defs/DbTargetView"}},"required":["orderId","claimId","target","command","claimType","claimRevision","allowed","blocker","current"]},
  DbOperationRecovery: {"type":"object","additionalProperties":false,"properties":{"receipt":{"anyOf":[{"$ref":"#/$defs/OperationReceipt"},{"type":"null"}]},"hmacKeyVersion":{"anyOf":[{"$ref":"#/$defs/KeyVersion"},{"type":"null"}]}},"required":["receipt","hmacKeyVersion"]},
  DbHistoryCiphertext: {"type":"object","additionalProperties":false,"properties":{"recordId":{"$ref":"#/$defs/Uuid"},"piiVersion":{"$ref":"#/$defs/Uuid"},"keyVersion":{"$ref":"#/$defs/KeyVersion"},"before":{"$ref":"#/$defs/EncryptedAddress"},"after":{"$ref":"#/$defs/EncryptedAddress"},"agreement":{"anyOf":[{"$ref":"#/$defs/EncryptedField"},{"type":"null"}]}},"required":["recordId","piiVersion","keyVersion","before","after","agreement"]},
  DbHistoryEntry: {"type":"object","additionalProperties":false,"properties":{"operationId":{"$ref":"#/$defs/Uuid"},"target":{"$ref":"#/$defs/Target"},"changedFields":{"type":"array","items":{"$ref":"#/$defs/ChangedField"},"maxItems":5,"uniqueItems":true},"recordedAt":{"$ref":"#/$defs/Instant"},"resultClaimRevision":{"$ref":"#/$defs/ClaimRevision"},"piiState":{"enum":["available","purged","restricted","unavailable"]},"actorId":{"anyOf":[{"$ref":"#/$defs/Uuid"},{"type":"null"}]},"ciphertext":{"anyOf":[{"$ref":"#/$defs/DbHistoryCiphertext"},{"type":"null"}]},"unavailableReason":{"anyOf":[{"enum":["retention_due","source_unavailable","crypto_unavailable"]},{"type":"null"}]}},"required":["operationId","target","changedFields","recordedAt","resultClaimRevision","piiState","actorId","ciphertext","unavailableReason"],"allOf":[{"if":{"properties":{"piiState":{"const":"unavailable"}},"required":["piiState"]},"then":{"properties":{"unavailableReason":{"enum":["retention_due","source_unavailable","crypto_unavailable"]}}},"else":{"properties":{"unavailableReason":{"type":"null"}}}}]},
  DbReshipmentDestinationView: {"type":"object","additionalProperties":false,"properties":{"source":{"enum":["v2_confirmed","legacy_unconfirmed","none"]},"operationId":{"anyOf":[{"$ref":"#/$defs/Uuid"},{"type":"null"}]},"recordedAt":{"anyOf":[{"$ref":"#/$defs/Instant"},{"type":"null"}]},"piiState":{"enum":["available","purged","restricted","unavailable","not_applicable"]},"destination":{"anyOf":[{"$ref":"#/$defs/SealedDestination"},{"type":"null"}]},"unavailableReason":{"anyOf":[{"enum":["retention_due","source_unavailable","crypto_unavailable"]},{"type":"null"}]}},"required":["source","operationId","recordedAt","piiState","destination","unavailableReason"],"allOf":[{"if":{"properties":{"piiState":{"const":"unavailable"}},"required":["piiState"]},"then":{"properties":{"unavailableReason":{"enum":["retention_due","source_unavailable","crypto_unavailable"]}}},"else":{"properties":{"unavailableReason":{"type":"null"}}}}]},
  DbContactHistory: {"type":"object","additionalProperties":false,"properties":{"viewerId":{"$ref":"#/$defs/Uuid"},"sessionId":{"$ref":"#/$defs/Uuid"},"orderId":{"$ref":"#/$defs/Uuid"},"claimId":{"$ref":"#/$defs/Uuid"},"viewerKind":{"enum":["operator","buyer","gift_recipient","gift_sender"]},"piiAccess":{"type":"boolean"},"current":{"type":"object","additionalProperties":false,"properties":{"collection":{"$ref":"#/$defs/DbTargetView"},"reshipment":{"$ref":"#/$defs/DbTargetView"}},"required":["collection","reshipment"]},"entries":{"type":"array","items":{"$ref":"#/$defs/DbHistoryEntry"},"maxItems":20},"nextCursor":{"anyOf":[{"type":"object","additionalProperties":false,"properties":{"recordedAt":{"$ref":"#/$defs/Instant"},"operationId":{"$ref":"#/$defs/Uuid"}},"required":["recordedAt","operationId"]},{"type":"null"}]},"reshipmentDestination":{"$ref":"#/$defs/DbReshipmentDestinationView"}},"required":["viewerId","sessionId","orderId","claimId","viewerKind","piiAccess","current","entries","nextCursor","reshipmentDestination"]},
  RetentionCaseCommand: {"type":"object","additionalProperties":false,"properties":{"action":{"enum":["hold","extend","release","close"]},"caseRef":{"$ref":"#/$defs/OpaqueReference"},"approvalRef":{"$ref":"#/$defs/OpaqueReference"},"legalBasis":{"$ref":"#/$defs/LegalBasis"},"retainUntil":{"anyOf":[{"$ref":"#/$defs/Instant"},{"type":"null"}]},"occurredAt":{"$ref":"#/$defs/Instant"}},"required":["action","caseRef","approvalRef","legalBasis","retainUntil","occurredAt"],"allOf":[{"if":{"properties":{"action":{"enum":["hold","extend"]}},"required":["action"]},"then":{"properties":{"retainUntil":{"$ref":"#/$defs/Instant"}}},"else":{"properties":{"retainUntil":{"type":"null"}}}}]},
  NonnegativeCount: {"type":"integer","minimum":0,"maximum":2147483647},
  OpaqueReference: {"type":"string","minLength":1,"maxLength":120,"pattern":"^[A-Za-z0-9:_./-]+$"},
  LegalBasis: {"enum":["dispute_resolution","statutory_preservation","verified_rights_request"]},
  RetentionCaseState: {"enum":["held","released","closed"]},
  RetentionCaseReceipt: {"type":"object","additionalProperties":false,"properties":{"operationId":{"$ref":"#/$defs/Uuid"},"orderId":{"$ref":"#/$defs/Uuid"},"claimId":{"$ref":"#/$defs/Uuid"},"actorId":{"$ref":"#/$defs/Uuid"},"sessionId":{"$ref":"#/$defs/Uuid"},"caseRef":{"$ref":"#/$defs/OpaqueReference"},"action":{"enum":["hold","extend","release","close"]},"legalBasis":{"$ref":"#/$defs/LegalBasis"},"expectedRevision":{"$ref":"#/$defs/Revision"},"resultRevision":{"$ref":"#/$defs/Revision"},"state":{"$ref":"#/$defs/RetentionCaseState"},"retainUntil":{"anyOf":[{"$ref":"#/$defs/Instant"},{"type":"null"}]},"caseClosedAt":{"anyOf":[{"$ref":"#/$defs/Instant"},{"type":"null"}]},"releasedAt":{"anyOf":[{"$ref":"#/$defs/Instant"},{"type":"null"}]},"occurredAt":{"$ref":"#/$defs/Instant"},"recordedAt":{"$ref":"#/$defs/Instant"}},"required":["operationId","orderId","claimId","actorId","sessionId","caseRef","action","legalBasis","expectedRevision","resultRevision","state","retainUntil","caseClosedAt","releasedAt","occurredAt","recordedAt"],"allOf":[{"if":{"properties":{"state":{"const":"held"}},"required":["state"]},"then":{"properties":{"retainUntil":{"$ref":"#/$defs/Instant"},"caseClosedAt":{"type":"null"}}}},{"if":{"properties":{"state":{"const":"released"}},"required":["state"]},"then":{"properties":{"releasedAt":{"$ref":"#/$defs/Instant"},"caseClosedAt":{"type":"null"}}}},{"if":{"properties":{"state":{"const":"closed"}},"required":["state"]},"then":{"properties":{"caseClosedAt":{"$ref":"#/$defs/Instant"}}}}]},
  ContactDataCounts: {"type":"object","additionalProperties":false,"properties":{"plans":{"$ref":"#/$defs/NonnegativeCount"},"operations":{"$ref":"#/$defs/NonnegativeCount"},"destinations":{"$ref":"#/$defs/NonnegativeCount"},"addressEnvelopes":{"$ref":"#/$defs/NonnegativeCount"},"agreementEnvelopes":{"$ref":"#/$defs/NonnegativeCount"},"requestHmacs":{"$ref":"#/$defs/NonnegativeCount"},"addressHmacs":{"$ref":"#/$defs/NonnegativeCount"},"operatorReferences":{"$ref":"#/$defs/NonnegativeCount"}},"required":["plans","operations","destinations","addressEnvelopes","agreementEnvelopes","requestHmacs","addressHmacs","operatorReferences"]},
  RetentionScope: {"type":"object","additionalProperties":false,"properties":{"orderId":{"$ref":"#/$defs/Uuid"},"claimId":{"$ref":"#/$defs/Uuid"},"subjectKind":{"enum":["buyer","gift_recipient"]},"state":{"enum":["operational_pending","operational_unknown","not_due","held","due","purged"]},"purposeEndedAt":{"anyOf":[{"$ref":"#/$defs/Instant"},{"type":"null"}]},"basePurgeAt":{"anyOf":[{"$ref":"#/$defs/Instant"},{"type":"null"}]},"effectivePurgeAt":{"anyOf":[{"$ref":"#/$defs/Instant"},{"type":"null"}]},"activeHoldCount":{"$ref":"#/$defs/NonnegativeCount"},"expiredHoldCount":{"$ref":"#/$defs/NonnegativeCount"},"remaining":{"$ref":"#/$defs/ContactDataCounts"}},"required":["orderId","claimId","subjectKind","state","purposeEndedAt","basePurgeAt","effectivePurgeAt","activeHoldCount","expiredHoldCount","remaining"]},
  ContactDataInventory: {"type":"object","additionalProperties":false,"properties":{"subjectId":{"$ref":"#/$defs/Uuid"},"actorId":{"$ref":"#/$defs/Uuid"},"sessionId":{"$ref":"#/$defs/Uuid"},"recordedAt":{"$ref":"#/$defs/Instant"},"scopes":{"type":"array","items":{"$ref":"#/$defs/RetentionScope"},"maxItems":1000},"nextClaimId":{"anyOf":[{"$ref":"#/$defs/Uuid"},{"type":"null"}]},"operatorReferenceCount":{"$ref":"#/$defs/NonnegativeCount"}},"required":["subjectId","actorId","sessionId","recordedAt","scopes","nextClaimId","operatorReferenceCount"]},
  PurgeRemainingCounts: {"type":"object","additionalProperties":false,"properties":{"eligibleScopes":{"$ref":"#/$defs/NonnegativeCount"},"heldScopes":{"$ref":"#/$defs/NonnegativeCount"},"notDueScopes":{"$ref":"#/$defs/NonnegativeCount"},"operationallyBlockedScopes":{"$ref":"#/$defs/NonnegativeCount"},"piiFields":{"$ref":"#/$defs/NonnegativeCount"},"operatorReferences":{"$ref":"#/$defs/NonnegativeCount"}},"required":["eligibleScopes","heldScopes","notDueScopes","operationallyBlockedScopes","piiFields","operatorReferences"]},
  ContactPurgeReceipt: {"type":"object","additionalProperties":false,"properties":{"operationId":{"$ref":"#/$defs/Uuid"},"subjectId":{"$ref":"#/$defs/Uuid"},"actorId":{"$ref":"#/$defs/Uuid"},"sessionId":{"$ref":"#/$defs/Uuid"},"cutoff":{"$ref":"#/$defs/Instant"},"limit":{"type":"integer","minimum":1,"maximum":100},"recordedAt":{"$ref":"#/$defs/Instant"},"purgedClaimIds":{"type":"array","items":{"$ref":"#/$defs/Uuid"},"maxItems":100,"uniqueItems":true},"purgedTargetCount":{"$ref":"#/$defs/NonnegativeCount"},"removed":{"allOf":[{"$ref":"#/$defs/ContactDataCounts"},{"properties":{"operatorReferences":{"const":0}}}]},"selectedResidualPiiFields":{"const":0},"remaining":{"$ref":"#/$defs/PurgeRemainingCounts"}},"required":["operationId","subjectId","actorId","sessionId","cutoff","limit","recordedAt","purgedClaimIds","purgedTargetCount","removed","selectedResidualPiiFields","remaining"]},
};

// Runtime validation below is limited to the reviewed schemas above.

const ADDRESS_FIELDS = ['recipientName', 'phone', 'postalCode', 'address1', 'address2'] as const;
export const CLAIM_CONTACT_CHANGED_FIELDS = ['recipientName', 'phone', 'address2', 'postalCode', 'address1'] as const;
const LEGACY_EDIT_FIELDS = ['recipientName', 'phone', 'address2'] as const;

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Reflect.ownKeys(value).every(key => typeof key === 'string'
      && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true
      && 'value' in Object.getOwnPropertyDescriptor(value, key)!);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** Reject before trimming: a control character must never disappear during normalization. */
export function isClaimContactText(value: unknown): value is string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function instant(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/iu.exec(value);
  if (!match) return false;
  const [, y, m, d, h, min, sec, , offsetH = '0', offsetM = '0'] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && Number(h) < 24 && Number(min) < 60 && Number(sec) < 60
    && Number(offsetH) < 24 && Number(offsetM) < 60 && Number.isFinite(Date.parse(value));
}

function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((v, i) => equalJson(v, right[i]));
  if (record(left) && record(right)) return exactKeys(left, Object.keys(right)) && Object.keys(left).every(key => equalJson(left[key], right[key]));
  return false;
}

/** Only the small set of constraints used by this module's frozen DTOs is supported. */
function matches(schema: Schema, value: unknown): boolean {
  if (schema.$ref) {
    const name = schema.$ref.slice('#/$defs/'.length) as keyof ClaimContactContracts;
    if (!Object.hasOwn(SCHEMAS, name) || !matches(SCHEMAS[name], value) || !invariants(name, value)) return false;
  }
  if (Object.hasOwn(schema, 'const') && !equalJson(value, schema.const)) return false;
  if (schema.enum && !schema.enum.some(item => equalJson(item, value))) return false;
  if (schema.not && matches(schema.not, value)) return false;
  if (schema.anyOf && !schema.anyOf.some(item => matches(item, value))) return false;
  if (schema.oneOf && schema.oneOf.filter(item => matches(item, value)).length !== 1) return false;
  if (schema.allOf && !schema.allOf.every(item => matches(item, value))) return false;
  if (schema.if) {
    const branch = matches(schema.if, value) ? schema.then : schema.else;
    if (branch && !matches(branch, value)) return false;
  }
  if (schema.type === 'null' && value !== null) return false;
  if (schema.type === 'boolean' && typeof value !== 'boolean') return false;
  if (schema.type === 'object' && !record(value)) return false;
  if (schema.type === 'array' && !Array.isArray(value)) return false;
  if (schema.type === 'string' && !isClaimContactText(value)) return false;
  if (schema.type === 'integer' && !Number.isSafeInteger(value)) return false;
  if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return false;
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) return false;
  if (typeof value === 'string') {
    if (!isClaimContactText(value)) return false;
    const length = Array.from(value).length;
    if ((schema.minLength !== undefined && length < schema.minLength) || (schema.maxLength !== undefined && length > schema.maxLength)
      || (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value))
      || (schema.format === 'date-time' && !instant(value))) return false;
  }
  if (Array.isArray(value)) {
    if ((schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems)
      || Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1
      || Array.from({ length: value.length }, (_, i) => Object.getOwnPropertyDescriptor(value, String(i)))
        .some(descriptor => !descriptor || !descriptor.enumerable || !('value' in descriptor))
      || (schema.items && !value.every(item => matches(schema.items!, item)))
      || (schema.uniqueItems && value.some((item, i) => value.slice(0, i).some(other => equalJson(item, other))))) return false;
  }
  if (record(value)) {
    if (schema.required?.some(key => !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties ?? {}, key))) return false;
    if (schema.properties && Object.entries(schema.properties).some(([key, child]) => Object.hasOwn(value, key) && !matches(child, value[key]))) return false;
  }
  return true;
}

function canonicalFields(fields: ChangedField[]): boolean {
  return fields.every((field, i) => i === 0 || CLAIM_CONTACT_CHANGED_FIELDS.indexOf(fields[i - 1]) < CLAIM_CONTACT_CHANGED_FIELDS.indexOf(field));
}
function canonicalBase64url(value: string, bytes?: number): boolean {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) return false;
  if (bytes !== undefined && Math.floor(value.length * 6 / 8) !== bytes) return false;
  const last = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(value.at(-1) ?? 'A');
  return (value.length % 4 !== 2 || last % 16 === 0) && (value.length % 4 !== 3 || last % 4 === 0);
}
function envelopeKids(address: EncryptedAddress, keyVersion: string): boolean {
  return ADDRESS_FIELDS.every(field => address[field].kid === keyVersion);
}
function sourceDisplay(piiState: string, sourceKind: SourceBinding['sourceKind'] | null, referenceOnly: boolean): boolean {
  return piiState === 'available' ? sourceKind !== null && referenceOnly === (sourceKind === 'order_delivery') : sourceKind === null && !referenceOnly;
}
function destinationView(value: HistoryResponse['reshipmentDestination'] | DbReshipmentDestinationView): boolean {
  const payload = 'address' in value ? value.address : value.destination;
  if (value.source === 'none') return value.operationId === null && value.recordedAt === null && value.piiState === 'not_applicable' && payload === null;
  if (value.source === 'legacy_unconfirmed') return value.operationId === null && value.piiState !== 'available' && payload === null;
  return value.operationId !== null && value.recordedAt !== null && value.piiState !== 'not_applicable'
    && (value.piiState === 'available') === (payload !== null);
}

function invariants(name: keyof ClaimContactContracts, value: unknown): boolean {
  switch (name) {
    case 'Address': {
      const v = value as Address;
      return v.recipientName === v.recipientName.trim() && v.address2 === v.address2.trim()
        && v.postalCode.trim().length > 0 && v.address1.trim().length > 0;
    }
    case 'ContactEdit': {
      const v = value as ContactEdit;
      return v.recipientName === v.recipientName.trim() && v.address2 === v.address2.trim()
        && (v.address1 === undefined || v.address1 === v.address1.trim());
    }
    case 'ChangeRequest': return (value as ChangeRequest).agreement === (value as ChangeRequest).agreement.trim();
    case 'ReshipmentRequest': {
      const v = value as ReshipmentRequest;
      return v.carrier === v.carrier.trim() && new Set(v.items.map(item => item.orderItemId)).size === v.items.length;
    }
    case 'EncryptedField': {
      const v = value as EncryptedField;
      return canonicalBase64url(v.iv, 12) && canonicalBase64url(v.tag, 16) && canonicalBase64url(v.ct) && Math.floor(v.ct.length * 6 / 8) <= 6144;
    }
    case 'EncryptedAddress': return ADDRESS_FIELDS.every(field => field === 'address2' || (value as EncryptedAddress)[field].ct.length > 0);
    case 'ContextClaims': {
      const v = value as ContextClaims;
      let origin: URL;
      try { origin = new URL(v.backendOrigin); } catch { return false; }
      return (origin.protocol === 'http:' || origin.protocol === 'https:') && origin.origin === v.backendOrigin
        && Date.parse(v.expiresAt) - Date.parse(v.issuedAt) === 600_000
        && (v.source.sourceKind !== 'order_delivery' || v.source.sourceId === v.orderId)
        && (v.source.sourceKind !== 'seller_intake' || v.source.sourceId === v.claimId)
        && (v.purpose !== 'claim-contact/reshipment-context' || (v.target === 'reshipment' && v.expectedClaimType === 'exchange'));
    }
    case 'OperationReceipt': {
      const v = value as OperationReceipt;
      if (!canonicalFields(v.changedFields)) return false;
      if (v.state === 'saved') return v.resultClaimRevision === v.expectedClaimRevision + 1
        && (v.command === 'reshipment' ? v.changedFields.length === 0 : v.changedFields.length > 0)
        && (v.piiState === 'retained' || v.piiState === 'purged');
      if (v.state === 'noop') return v.command === 'change' && v.resultClaimRevision === v.expectedClaimRevision;
      return true;
    }
    case 'ContextResponse': {
      const v = value as ContextResponse;
      return (v.piiState === 'available') === (v.address !== null)
        && sourceDisplay(v.piiState, v.sourceKind, v.referenceOnly)
        && (v.command !== 'reshipment' || (v.target === 'reshipment' && (!v.allowed || v.claimType === 'exchange')));
    }
    case 'OperationResponse': {
      const v = value as OperationResponse;
      return v.receipt === null || (v.receipt.actorId === v.actorId && v.receipt.sessionId === v.sessionId);
    }
    case 'SealedPlan': {
      const v = value as SealedPlan;
      return envelopeKids(v.address, v.keyVersion);
    }
    case 'SealedHistory': {
      const v = value as SealedHistory;
      return envelopeKids(v.before, v.keyVersion) && envelopeKids(v.after, v.keyVersion) && v.agreement.kid === v.keyVersion && v.agreement.ct.length > 0;
    }
    case 'SealedChange': {
      const v = value as SealedChange;
      if (!canonicalFields(v.changedFields) || (v.changedFields.some(field => field === 'postalCode' || field === 'address1') !== (v.destinationCheck !== undefined))) return false;
      if (v.effect === 'noop') return v.beforeAddressHmac === v.afterAddressHmac;
      return v.beforeAddressHmac !== v.afterAddressHmac && v.plan !== null && v.history !== null
        && v.plan.addressHmac === v.afterAddressHmac && v.plan.addressHmacKeyVersion === v.addressHmacKeyVersion
        && v.plan.keyVersion === v.history.keyVersion;
    }
    case 'SealedDestination': {
      const v = value as SealedDestination;
      return envelopeKids(v.address, v.keyVersion)
        && (v.sourceKind === 'contact_plan'
          ? v.sourceRevision === null && v.sourcePlanRevision >= 1 && v.sourcePiiVersion !== null
          : v.sourcePlanRevision === 0 && v.sourcePiiVersion === null
            && (v.sourceKind === 'seller_intake' ? v.sourceRevision === null : v.sourceRevision !== null && /^(0|[1-9][0-9]*)$/u.test(v.sourceRevision)));
    }
    case 'TargetView': {
      const v = value as TargetView;
      return sourceDisplay(v.piiState, v.sourceKind, v.referenceOnly);
    }
    case 'DbTargetView': {
      const v = value as DbTargetView;
      return sourceDisplay(v.piiState, v.source?.sourceKind ?? null, v.referenceOnly)
        && (v.plan === null || (v.source?.sourceId === v.plan.planId && v.source.piiVersion === v.plan.piiVersion));
    }
    case 'DbContactContext': {
      const v = value as DbContactContext;
      return v.current.target === v.target && v.allowed === (v.blocker === null)
        && (!v.allowed || v.current.piiState === 'available')
        && (v.current.source?.sourceKind !== 'order_delivery' || v.current.source.sourceId === v.orderId)
        && (v.current.source?.sourceKind !== 'seller_intake' || v.current.source.sourceId === v.claimId)
        && (v.command !== 'reshipment' || (v.target === 'reshipment' && (!v.allowed || v.claimType === 'exchange')));
    }
    case 'DbOperationRecovery': {
      const v = value as DbOperationRecovery;
      return v.receipt === null || v.receipt.state === 'sealed' || v.receipt.piiState === 'purged'
        ? v.hmacKeyVersion === null : v.hmacKeyVersion !== null;
    }
    case 'DbHistoryCiphertext': {
      const v = value as DbHistoryCiphertext;
      return envelopeKids(v.before, v.keyVersion) && envelopeKids(v.after, v.keyVersion)
        && (v.agreement === null || (v.agreement.kid === v.keyVersion && v.agreement.ct.length > 0));
    }
    case 'HistoryEntry': {
      const v = value as HistoryEntry;
      return v.changedFields.length > 0 && canonicalFields(v.changedFields)
        && (v.piiState === 'available' ? v.before !== null && v.after !== null && (v.agreement === null || v.agreement === v.agreement.trim())
          : v.before === null && v.after === null && v.agreement === null);
    }
    case 'DbHistoryEntry': {
      const v = value as DbHistoryEntry;
      return v.changedFields.length > 0 && canonicalFields(v.changedFields)
        && (v.piiState === 'available' ? v.ciphertext !== null && v.ciphertext.recordId === v.operationId : v.ciphertext === null);
    }
    case 'DbReshipmentDestinationView': return destinationView(value as DbReshipmentDestinationView);
    case 'HistoryResponse': {
      const v = value as HistoryResponse;
      if (!destinationView(v.reshipmentDestination) || !historyScope(v)) return false;
      return v.entries.every(entry => v.viewerKind === 'operator' || (entry.agreement === null && entry.actorId === null));
    }
    case 'DbContactHistory': {
      const v = value as DbContactHistory;
      return historyScope(v)
        && [v.current.collection, v.current.reshipment].every(current => current.source?.sourceKind !== 'order_delivery' || current.source.sourceId === v.orderId)
        && [v.current.collection, v.current.reshipment].every(current => current.source?.sourceKind !== 'seller_intake' || current.source.sourceId === v.claimId)
        && (v.reshipmentDestination.destination?.sourceKind !== 'order_delivery' || v.reshipmentDestination.destination.sourceId === v.orderId)
        && (v.reshipmentDestination.destination?.sourceKind !== 'seller_intake' || v.reshipmentDestination.destination.sourceId === v.claimId)
        && v.entries.every(entry => v.viewerKind === 'operator' || (entry.actorId === null && entry.ciphertext?.agreement == null));
    }
    case 'ErrorResponse': {
      const v = value as ErrorResponse;
      return Object.hasOwn(CLAIM_CONTACT_ERRORS, v.code) && equalJson(v, claimContactError(v.code, v.requestId));
    }
    case 'RetentionCaseCommand': {
      const v = value as RetentionCaseCommand;
      return v.retainUntil === null || Date.parse(v.retainUntil) > Date.parse(v.occurredAt);
    }
    case 'RetentionCaseReceipt': {
      const v = value as RetentionCaseReceipt;
      if (v.resultRevision !== v.expectedRevision + 1 || Date.parse(v.occurredAt) > Date.parse(v.recordedAt)) return false;
      if (v.action === 'hold' || v.action === 'extend') return v.state === 'held' && v.retainUntil !== null
        && Date.parse(v.retainUntil) > Date.parse(v.occurredAt) && v.caseClosedAt === null;
      if (v.action === 'release') return v.state === 'released' && v.retainUntil === null && v.releasedAt !== null
        && Date.parse(v.releasedAt) === Date.parse(v.occurredAt) && v.caseClosedAt === null;
      return v.state === 'closed' && v.retainUntil === null && v.caseClosedAt !== null && Date.parse(v.caseClosedAt) === Date.parse(v.occurredAt);
    }
    case 'ContactPurgeReceipt': {
      const v = value as ContactPurgeReceipt;
      return v.purgedClaimIds.length <= v.limit && Date.parse(v.cutoff) <= Date.parse(v.recordedAt);
    }
    case 'ContactDataInventory': {
      const v = value as ContactDataInventory;
      return new Set(v.scopes.map(scope => scope.claimId)).size === v.scopes.length;
    }
    default: return true;
  }
}

function historyScope(v: HistoryResponse | DbContactHistory): boolean {
  if (v.current.collection.target !== 'collection' || v.current.reshipment.target !== 'reshipment'
    || new Set(v.entries.map(entry => entry.operationId)).size !== v.entries.length) return false;
  if (v.viewerKind === 'gift_sender' && v.piiAccess) return false;
  return v.piiAccess || (v.current.collection.piiState !== 'available' && v.current.reshipment.piiState !== 'available'
    && v.reshipmentDestination.piiState !== 'available' && v.entries.every(entry => entry.piiState !== 'available'));
}

export function parseClaimContactContract<TName extends keyof ClaimContactContracts>(name: TName, input: unknown): ClaimContactContracts[TName] | null {
  if (!Object.hasOwn(SCHEMAS, name) || !matches(SCHEMAS[name], input) || !invariants(name, input)) return null;
  return input as ClaimContactContracts[TName];
}

function normalizeEdit(input: unknown): ContactEdit | null {
  if (!record(input)) return null;
  const fields = Object.hasOwn(input, 'postalCode') || Object.hasOwn(input, 'address1') ? CLAIM_CONTACT_CHANGED_FIELDS : LEGACY_EDIT_FIELDS;
  if (!exactKeys(input, fields) || !fields.every(key => isClaimContactText(input[key]))) return null;
  const value = input as ContactEdit;
  if (!/^[0-9 ()+\-]*$/u.test(value.phone)) return null;
  return parseClaimContactContract('ContactEdit', {
    recipientName: value.recipientName.trim(), phone: value.phone.replace(/[ ()+\-]/gu, ''), address2: value.address2.trim(),
    ...(value.postalCode === undefined ? {} : { postalCode: value.postalCode.trim(), address1: value.address1!.trim() }),
  });
}

export function normalizeClaimContactAddress(input: unknown): Address | null {
  if (!record(input) || !exactKeys(input, ADDRESS_FIELDS)) return null;
  const contact = normalizeEdit({ recipientName: input.recipientName, phone: input.phone, address2: input.address2 });
  return contact ? parseClaimContactContract('Address', { ...contact, postalCode: input.postalCode, address1: input.address1 }) : null;
}

export function normalizeClaimContactChangeRequest(input: unknown): ChangeRequest | null {
  if (!record(input) || !exactKeys(input, SCHEMAS.ChangeRequest.required!) || !isClaimContactText(input.agreement)) return null;
  const contact = normalizeEdit(input.contact);
  return contact ? parseClaimContactContract('ChangeRequest', { ...input, contact, agreement: input.agreement.trim() }) : null;
}

export function normalizeClaimContactReshipmentRequest(input: unknown): ReshipmentRequest | null {
  if (!record(input) || !exactKeys(input, SCHEMAS.ReshipmentRequest.required!) || !isClaimContactText(input.carrier)
    || !isClaimContactText(input.trackingNumber) || !/^[A-Za-z0-9]*$/u.test(input.trackingNumber.trim())) return null;
  return parseClaimContactContract('ReshipmentRequest', { ...input, carrier: input.carrier.trim(), trackingNumber: input.trackingNumber.trim().toUpperCase() });
}

/** The only persisted recovery payload. No raw input, signing token, digest or envelopes. */
export type ClaimContactJournal = Omit<OperationRequest, 'requestId' | 'sealIfAbsent'> & {
  actorId: Uuid; sessionId: Uuid; startedAt: Instant;
};
export function parseClaimContactJournal(input: unknown): ClaimContactJournal | null {
  const keys = ['operationId', 'orderId', 'claimId', 'command', 'target', 'expectedClaimType', 'expectedClaimRevision', 'actorId', 'sessionId', 'startedAt'];
  if (!record(input) || !exactKeys(input, keys)) return null;
  const { actorId, sessionId, startedAt, ...scope } = input;
  return parseClaimContactContract('Uuid', actorId) && parseClaimContactContract('Uuid', sessionId) && parseClaimContactContract('Instant', startedAt)
    && parseClaimContactContract('OperationRequest', { ...scope, requestId: input.operationId, sealIfAbsent: false })
    ? input as ClaimContactJournal : null;
}

const errorDefinition = (http: number, message: string, sqlState: string | null, flags: Partial<Pick<ErrorResponse, 'conflict' | 'uncertain' | 'authChanged' | 'recoveryOnly'>> = {}) => ({
  http, message, sqlState, conflict: false, uncertain: false, authChanged: false, recoveryOnly: false, ...flags,
});
export const CLAIM_CONTACT_ERRORS = {
  feature_disabled: errorDefinition(503, '연락처 정정 기능을 사용할 수 없습니다. 진행 중인 요청의 저장 결과를 확인해주세요.', '55000', { recoveryOnly: true }),
  auth_changed: errorDefinition(403, '로그인 상태 또는 처리 권한이 바뀌었습니다. 현재 계정으로 다시 확인해주세요.', '42501', { authChanged: true }),
  claim_not_found: errorDefinition(404, '요청한 반품·교환 정보를 확인할 수 없습니다.', 'P0002'),
  invalid_claim_contact_request: errorDefinition(400, '변경할 연락처와 확인 항목을 다시 확인해주세요.', '22023'),
  claim_contact_address_price_changed: errorDefinition(409, '주소 변경으로 배송비가 달라집니다. 추가 비용 처리 기준이 정해지기 전에는 저장할 수 없습니다.', 'PT409'),
  claim_contact_address_price_unknown: errorDefinition(409, '이 주문의 배송비 근거로 새 주소의 요금을 확인할 수 없습니다. 주소·지역 요금 정책을 확인해주세요.', 'PT409'),
  claim_contact_blocked: errorDefinition(409, '현재 반품·교환 진행 상태에서는 이 작업을 처리할 수 없습니다.', 'PT409'),
  claim_contact_changed: errorDefinition(409, '반품·교환 정보가 변경됐습니다. 최신 정보를 다시 확인해주세요.', 'PT409', { conflict: true }),
  claim_contact_operation_conflict: errorDefinition(409, '같은 요청번호에 다른 내용이 연결되어 있습니다. 원래 요청의 저장 결과를 확인해주세요.', '23505', { conflict: true, recoveryOnly: true }),
  claim_contact_operation_sealed: errorDefinition(409, '이 요청은 종료되어 다시 전송할 수 없습니다. 저장 결과를 확인해주세요.', 'PT409', { recoveryOnly: true }),
  claim_contact_purged: errorDefinition(410, '연락처 정보가 삭제되어 처리 내역만 확인할 수 있습니다.', 'PT410', { recoveryOnly: true }),
  claim_contact_context_expired: errorDefinition(409, '확인 시간이 지났습니다. 진행 중인 요청의 저장 결과를 먼저 확인해주세요.', null, { recoveryOnly: true }),
  claim_contact_crypto_unavailable: errorDefinition(503, '연락처 정보를 안전하게 처리할 수 없습니다. 저장 결과를 확인해주세요.', null, { recoveryOnly: true }),
  claim_contact_outcome_unknown: errorDefinition(503, '처리 결과를 확인하지 못했습니다. 같은 요청번호로 저장 결과를 확인해주세요.', null, { uncertain: true, recoveryOnly: true }),
  claim_contact_retention_due: errorDefinition(410, '연락처 보관기간이 지나 내용을 열거나 변경할 수 없습니다. 처리 내역만 확인할 수 있습니다.', 'PT410', { recoveryOnly: true }),
} as const;
export type ClaimContactErrorCode = keyof typeof CLAIM_CONTACT_ERRORS;
function errorCode(code: unknown): ClaimContactErrorCode {
  return typeof code === 'string' && Object.hasOwn(CLAIM_CONTACT_ERRORS, code) ? code as ClaimContactErrorCode : 'claim_contact_outcome_unknown';
}
export function claimContactError(code: unknown, requestId: unknown = null): ErrorResponse {
  const safeCode = errorCode(code), definition = CLAIM_CONTACT_ERRORS[safeCode];
  return { requestId: parseClaimContactContract('Uuid', requestId), code: safeCode, message: definition.message,
    conflict: definition.conflict, uncertain: definition.uncertain, authChanged: definition.authChanged, recoveryOnly: definition.recoveryOnly };
}
export function claimContactErrorStatus(code: unknown): number { return CLAIM_CONTACT_ERRORS[errorCode(code)].http; }
/** Match complete stable SQL messages only. DETAIL/CONTEXT and unknown provider text never escape. */
export function claimContactDatabaseError(sqlState: unknown, message: unknown, requestId: unknown = null): ErrorResponse {
  const code = errorCode(message);
  return claimContactError(CLAIM_CONTACT_ERRORS[code].sqlState !== null && CLAIM_CONTACT_ERRORS[code].sqlState === sqlState ? code : 'claim_contact_outcome_unknown', requestId);
}
