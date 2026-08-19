import 'server-only';

import { createHash, createHmac } from 'node:crypto';

import {
  encodeCanonicalField,
  isCanonicalUtcMillisecondTimestamp,
  isWellFormedUnicode,
} from './internal';

const subjectTombstoneBrand: unique symbol = Symbol('deletion-ledger-subject-tombstone');

export interface SubjectTombstone {
  readonly [subjectTombstoneBrand]: true;
  readonly encodingVersion: 1;
  readonly algorithm: 'hmac-sha256';
  readonly keyVersion: string;
  readonly digest: string;
}

export type SubjectHmacFactory = (subjectReference: string) => SubjectTombstone;

declare const deletionEventKeyBrand: unique symbol;

export type DeletionEventKey = `evt_v1_${string}_${string}` & {
  readonly [deletionEventKeyBrand]: true;
};

export type DeletionEventKeyFactory = (eventReference: string) => DeletionEventKey;

export interface DeletionLedgerEvent {
  readonly eventKey: DeletionEventKey;
  readonly subject: SubjectTombstone;
  readonly occurredAt: string;
}

export interface DeletionLedgerAcknowledgement {
  readonly eventKey: DeletionEventKey;
  readonly canonicalDigest: string;
  readonly sequence: number;
  readonly generation: string;
  readonly ackedAt: string;
}

export interface DeletionLedgerRecord extends DeletionLedgerAcknowledgement {
  readonly event: DeletionLedgerEvent;
}

export interface DeletionLedgerPage {
  readonly events: readonly DeletionLedgerRecord[];
  readonly nextPageToken: string | null;
}

export interface DeletionLedger {
  append(event: DeletionLedgerEvent): Promise<DeletionLedgerAcknowledgement>;
  scanAfter(sequence: number, pageToken: string | null): Promise<DeletionLedgerPage>;
}

interface VersionedHmacFactoryOptions {
  readonly namespace: string;
  readonly keyVersion: string;
  readonly keyMaterial: Uint8Array;
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]{1,64}$/;
const KEY_VERSION = /^k[1-9][0-9]{0,9}$/;
const OPAQUE_EVENT_KEY = /^evt_v1_k[1-9][0-9]{0,9}_[0-9a-f]{64}$/;
const GENERATION = /^g[1-9][0-9]{0,9}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function isDeletionLedgerGeneration(value: unknown): value is string {
  return typeof value === 'string' && GENERATION.test(value);
}

function invalidContractInput(): never {
  throw new TypeError('Invalid deletion ledger contract input');
}

export function snapshotDeletionLedgerEvent(
  event: DeletionLedgerEvent,
): DeletionLedgerEvent {
  if (
    !event
    || typeof event !== 'object'
    || !event.subject
    || typeof event.subject !== 'object'
    || event.subject[subjectTombstoneBrand] !== true
  ) {
    return invalidContractInput();
  }

  const eventKey = event.eventKey;
  const occurredAt = event.occurredAt;
  const encodingVersion = event.subject.encodingVersion;
  const algorithm = event.subject.algorithm;
  const keyVersion = event.subject.keyVersion;
  const digest = event.subject.digest;
  if (
    typeof eventKey !== 'string'
    || !OPAQUE_EVENT_KEY.test(eventKey)
    || typeof occurredAt !== 'string'
    || !isCanonicalUtcMillisecondTimestamp(occurredAt)
    || encodingVersion !== 1
    || algorithm !== 'hmac-sha256'
    || typeof keyVersion !== 'string'
    || !KEY_VERSION.test(keyVersion)
    || typeof digest !== 'string'
    || !SHA256_HEX.test(digest)
  ) {
    return invalidContractInput();
  }

  const subject = createSubjectTombstone(keyVersion, digest);
  return Object.freeze({ eventKey, subject, occurredAt });
}

function createSubjectTombstone(keyVersion: string, digest: string): SubjectTombstone {
  const tombstone = { encodingVersion: 1, algorithm: 'hmac-sha256', keyVersion, digest } as Omit<
    SubjectTombstone,
    typeof subjectTombstoneBrand
  > & Partial<Pick<SubjectTombstone, typeof subjectTombstoneBrand>>;
  Object.defineProperty(tombstone, subjectTombstoneBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(tombstone) as SubjectTombstone;
}

function encodeSubjectHmacInput(
  namespace: string,
  keyVersion: string,
  subjectReference: string,
): string {
  return [
    'ICONS-DELETION-SUBJECT-HMAC\n',
    encodeCanonicalField('encodingVersion', '1'),
    encodeCanonicalField('namespace', namespace),
    encodeCanonicalField('keyVersion', keyVersion),
    encodeCanonicalField('subject', subjectReference),
  ].join('');
}

function encodeEventKeyHmacInput(
  namespace: string,
  keyVersion: string,
  eventReference: string,
): string {
  return [
    'ICONS-DELETION-EVENT-KEY-HMAC\n',
    encodeCanonicalField('encodingVersion', '1'),
    encodeCanonicalField('namespace', namespace),
    encodeCanonicalField('keyVersion', keyVersion),
    encodeCanonicalField('eventReference', eventReference),
  ].join('');
}

interface HmacFactorySnapshot {
  readonly namespace: string;
  readonly keyVersion: string;
  readonly key: Uint8Array;
}

function snapshotHmacFactoryOptions(
  options: VersionedHmacFactoryOptions,
): HmacFactorySnapshot {
  if (!options || typeof options !== 'object') return invalidContractInput();
  const namespace = options.namespace;
  const keyVersion = options.keyVersion;
  const keyMaterial = options.keyMaterial;
  if (
    typeof namespace !== 'string'
    || !SAFE_IDENTIFIER.test(namespace)
    || typeof keyVersion !== 'string'
    || !KEY_VERSION.test(keyVersion)
    || !(keyMaterial instanceof Uint8Array)
    || keyMaterial.byteLength < 32
  ) {
    return invalidContractInput();
  }
  return Object.freeze({
    namespace,
    keyVersion,
    key: Uint8Array.from(keyMaterial),
  });
}

function validateTransientReference(reference: string): void {
  if (
    typeof reference !== 'string'
    || reference.length === 0
    || !isWellFormedUnicode(reference)
    || Buffer.byteLength(reference, 'utf8') > 512
  ) {
    return invalidContractInput();
  }
}

export function createVersionedEventKeyFactory(
  options: VersionedHmacFactoryOptions,
): DeletionEventKeyFactory {
  const { namespace, keyVersion, key } = snapshotHmacFactoryOptions(options);

  return (eventReference) => {
    validateTransientReference(eventReference);
    const digest = createHmac('sha256', key)
      .update(encodeEventKeyHmacInput(namespace, keyVersion, eventReference), 'utf8')
      .digest('hex');
    return `evt_v1_${keyVersion}_${digest}` as DeletionEventKey;
  };
}

export function encodeDeletionLedgerEvent(event: DeletionLedgerEvent): string {
  const snapshot = snapshotDeletionLedgerEvent(event);
  return [
    'ICONS-DELETION-LEDGER-EVENT\n',
    encodeCanonicalField('encodingVersion', '1'),
    encodeCanonicalField('eventKey', snapshot.eventKey),
    encodeCanonicalField('eventType', 'subject_deleted'),
    encodeCanonicalField('subjectEncodingVersion', String(snapshot.subject.encodingVersion)),
    encodeCanonicalField('subjectAlgorithm', snapshot.subject.algorithm),
    encodeCanonicalField('subjectKeyVersion', snapshot.subject.keyVersion),
    encodeCanonicalField('subjectDigest', snapshot.subject.digest),
    encodeCanonicalField('occurredAt', snapshot.occurredAt),
  ].join('');
}

export function digestDeletionLedgerEvent(event: DeletionLedgerEvent): string {
  return createHash('sha256')
    .update(encodeDeletionLedgerEvent(event), 'utf8')
    .digest('hex');
}

export function createVersionedSubjectHmacFactory(
  options: VersionedHmacFactoryOptions,
): SubjectHmacFactory {
  const { namespace, keyVersion, key } = snapshotHmacFactoryOptions(options);

  return (subjectReference) => {
    validateTransientReference(subjectReference);

    const digest = createHmac('sha256', key)
      .update(encodeSubjectHmacInput(namespace, keyVersion, subjectReference), 'utf8')
      .digest('hex');
    return createSubjectTombstone(keyVersion, digest);
  };
}
