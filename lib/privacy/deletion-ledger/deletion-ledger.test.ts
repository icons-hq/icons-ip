import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createVersionedEventKeyFactory,
  createVersionedSubjectHmacFactory,
  createInMemoryDeletionLedger,
  DeletionLedgerConflictError,
  DeletionLedgerPageTokenError,
  type DeletionEventKey,
  type DeletionLedgerEvent,
  type SubjectTombstone,
} from './index';

const FIXTURE_HMAC_KEY = new TextEncoder().encode('fixture-only-key-material-000001');
const FIXTURE_PAGE_TOKEN_KEY = new TextEncoder().encode('page-token-fixture-key-material-01');

function deletionEvent(eventReference = 'synthetic-event-reference') {
  const createEventKey = createVersionedEventKeyFactory({
    namespace: 'local-test',
    keyVersion: 'k1',
    keyMaterial: FIXTURE_HMAC_KEY,
  });
  const createSubjectHmac = createVersionedSubjectHmacFactory({
    namespace: 'local-test',
    keyVersion: 'k1',
    keyMaterial: FIXTURE_HMAC_KEY,
  });

  return {
    eventKey: createEventKey(eventReference),
    subject: createSubjectHmac('synthetic-subject'),
    occurredAt: '2030-01-02T03:04:05.000Z',
  } as const;
}

function inMemoryLedger(pageSize = 2, generation = 'g1') {
  return createInMemoryDeletionLedger({
    generation,
    pageSize,
    pageTokenKey: FIXTURE_PAGE_TOKEN_KEY,
    now: () => '2030-01-02T03:05:06.000Z',
  });
}

describe('secondary deletion ledger contract', () => {
  it('rejects ill-formed Unicode references before HMAC encoding', () => {
    const createEventKey = createVersionedEventKeyFactory({
      namespace: 'local-test',
      keyVersion: 'k1',
      keyMaterial: FIXTURE_HMAC_KEY,
    });
    const createSubjectHmac = createVersionedSubjectHmacFactory({
      namespace: 'local-test',
      keyVersion: 'k1',
      keyMaterial: FIXTURE_HMAC_KEY,
    });

    for (const illFormedReference of ['\uD800', '\uD801', '\uDC00']) {
      expect(() => createEventKey(illFormedReference)).toThrow(TypeError);
      expect(() => createSubjectHmac(illFormedReference)).toThrow(TypeError);
    }
    expect(() => createEventKey('synthetic-😀-reference')).not.toThrow();
  });

  it('snapshots every accessor-backed HMAC option exactly once', () => {
    function accessorOptions() {
      const reads = { namespace: 0, keyVersion: 0, keyMaterial: 0 };
      const options = {
        get namespace() {
          reads.namespace += 1;
          return reads.namespace === 1 ? 'local-test' : 'unexpected-namespace';
        },
        get keyVersion() {
          reads.keyVersion += 1;
          return reads.keyVersion === 1 ? 'k1' : '1990-01-01';
        },
        get keyMaterial() {
          reads.keyMaterial += 1;
          return reads.keyMaterial === 1 ? FIXTURE_HMAC_KEY : new Uint8Array(31);
        },
      };
      return { options, reads };
    }

    const eventKeyCase = accessorOptions();
    const createEventKey = createVersionedEventKeyFactory(eventKeyCase.options);
    expect(eventKeyCase.reads).toEqual({ namespace: 1, keyVersion: 1, keyMaterial: 1 });
    expect(createEventKey('synthetic-event-reference')).toMatch(/^evt_v1_k1_/);

    const subjectCase = accessorOptions();
    const createSubjectHmac = createVersionedSubjectHmacFactory(subjectCase.options);
    expect(subjectCase.reads).toEqual({ namespace: 1, keyVersion: 1, keyMaterial: 1 });
    expect(createSubjectHmac('synthetic-subject')).toMatchObject({ keyVersion: 'k1' });
  });

  it('requires factory-branded subject tombstones at the public type boundary', () => {
    type PlainStructuralTombstone = {
      readonly encodingVersion: 1;
      readonly algorithm: 'hmac-sha256';
      readonly keyVersion: 'k1';
      readonly digest: string;
    };

    expectTypeOf<PlainStructuralTombstone>().not.toMatchTypeOf<SubjectTombstone>();
    expectTypeOf<ReturnType<ReturnType<typeof createVersionedSubjectHmacFactory>>>()
      .toMatchTypeOf<SubjectTombstone>();
  });

  it('rejects identifier-shaped generation labels before they reach ack or tokens', () => {
    for (const generation of [
      '550e8400-e29b-41d4-a716-446655440000',
      '1990-01-01',
      'transaction-reference-0001',
    ]) {
      expect(() => createInMemoryDeletionLedger({
        generation,
        pageSize: 1,
        pageTokenKey: FIXTURE_PAGE_TOKEN_KEY,
        now: () => '2030-01-02T03:05:06.000Z',
      })).toThrow(TypeError);
    }
  });

  it('rejects identifier-shaped key versions before they reach event output', async () => {
    const ledger = inMemoryLedger();
    for (const keyVersion of [
      '550e8400-e29b-41d4-a716-446655440000',
      '1990-01-01',
      'transaction-reference-0001',
    ]) {
      expect(() => createVersionedEventKeyFactory({
        namespace: 'local-test',
        keyVersion,
        keyMaterial: FIXTURE_HMAC_KEY,
      })).toThrow(TypeError);
      expect(() => createVersionedSubjectHmacFactory({
        namespace: 'local-test',
        keyVersion,
        keyMaterial: FIXTURE_HMAC_KEY,
      })).toThrow(TypeError);
      await expect(ledger.append({
        ...deletionEvent(),
        subject: {
          ...deletionEvent().subject,
          keyVersion,
        },
      })).rejects.toThrow(TypeError);
    }
  });

  it('produces the versioned, domain-separated event key literal vector', () => {
    const createEventKey = createVersionedEventKeyFactory({
      namespace: 'local-test',
      keyVersion: 'k1',
      keyMaterial: FIXTURE_HMAC_KEY,
    });

    expect(createEventKey('synthetic-event-reference')).toBe(
      'evt_v1_k1_c97251790c7bd894bfc3a758b5931819f5ed93f5cc1e8189962cf1e8f64022d4',
    );
  });

  it('produces the versioned, domain-separated subject HMAC literal vector', () => {
    const createSubjectHmac = createVersionedSubjectHmacFactory({
      namespace: 'local-test',
      keyVersion: 'k1',
      keyMaterial: FIXTURE_HMAC_KEY,
    });

    expect(createSubjectHmac('synthetic-subject')).toEqual({
      encodingVersion: 1,
      algorithm: 'hmac-sha256',
      keyVersion: 'k1',
      digest: 'f3caadbcf896064e1e84a1b46a5835a46869428709b02d1f338d82b9f5219559',
    });
  });

  it('preserves a rotated key version through factories, append, and scan', async () => {
    const createEventKeyV1 = createVersionedEventKeyFactory({
      namespace: 'local-test',
      keyVersion: 'k1',
      keyMaterial: FIXTURE_HMAC_KEY,
    });
    const createEventKeyV2 = createVersionedEventKeyFactory({
      namespace: 'local-test',
      keyVersion: 'k2',
      keyMaterial: FIXTURE_HMAC_KEY,
    });
    const createSubjectHmacV2 = createVersionedSubjectHmacFactory({
      namespace: 'local-test',
      keyVersion: 'k2',
      keyMaterial: FIXTURE_HMAC_KEY,
    });
    const event = {
      eventKey: createEventKeyV2('synthetic-rotated-event-reference'),
      subject: createSubjectHmacV2('synthetic-subject'),
      occurredAt: '2030-01-02T03:04:05.000Z',
    } as const;
    const ledger = inMemoryLedger();

    expect(event.eventKey).toMatch(/^evt_v1_k2_[0-9a-f]{64}$/);
    expect(event.eventKey).not.toBe(createEventKeyV1('synthetic-rotated-event-reference'));
    expect(event.subject.keyVersion).toBe('k2');
    await expect(ledger.append(event)).resolves.toMatchObject({ eventKey: event.eventKey });
    await expect(ledger.scanAfter(0, null)).resolves.toMatchObject({
      events: [{ event: { eventKey: event.eventKey, subject: { keyVersion: 'k2' } } }],
      nextPageToken: null,
    });
  });

  it('rejects subject HMAC keys below the local integrity floor', () => {
    expect(() => createVersionedSubjectHmacFactory({
      namespace: 'local-test',
      keyVersion: 'k1',
      keyMaterial: new Uint8Array(31),
    })).toThrow(TypeError);
  });

  it('hard-copies Buffer key material at factory construction', () => {
    const keyMaterial = Buffer.from('fixture-only-key-material-000001');
    const createEventKey = createVersionedEventKeyFactory({
      namespace: 'local-test',
      keyVersion: 'k1',
      keyMaterial,
    });
    const createSubjectHmac = createVersionedSubjectHmacFactory({
      namespace: 'local-test',
      keyVersion: 'k1',
      keyMaterial,
    });
    const eventKeyBeforeMutation = createEventKey('synthetic-event-reference');
    const beforeMutation = createSubjectHmac('synthetic-subject');

    keyMaterial.fill(0);

    expect(createEventKey('synthetic-event-reference')).toBe(eventKeyBeforeMutation);
    expect(createSubjectHmac('synthetic-subject')).toEqual(beforeMutation);
  });

  it('locks the canonical digest vector and omits transient references from public output', async () => {
    const ledger = inMemoryLedger();
    const event = deletionEvent();

    const first = await ledger.append(event);
    const replay = await ledger.append({ ...event });

    expect(replay).toEqual(first);
    expect(first).toEqual({
      eventKey: 'evt_v1_k1_c97251790c7bd894bfc3a758b5931819f5ed93f5cc1e8189962cf1e8f64022d4',
      canonicalDigest: '74ec6bfef847e342dd1863ae8135e23a74853023d50fd60556b838490bfacf02',
      sequence: 1,
      generation: 'g1',
      ackedAt: '2030-01-02T03:05:06.000Z',
    });
    await expect(ledger.scanAfter(0, null)).resolves.toMatchObject({
      events: [{ event, ...first }],
      nextPageToken: null,
    });
    const page = await ledger.scanAfter(0, null);
    const serializedPage = JSON.stringify(page);
    expect(serializedPage).not.toContain('synthetic-event-reference');
    expect(serializedPage).not.toContain('synthetic-subject');
  });

  it('rejects raw UUID, DOB, and transaction references as direct event keys', async () => {
    const ledger = inMemoryLedger();

    for (const eventKey of [
      'evt_550e8400-e29b-41d4-a716-446655440000',
      'evt_1990-01-01',
      'evt_order-reference-0001',
    ]) {
      await expect(ledger.append({
        ...deletionEvent(),
        eventKey,
      } as unknown as DeletionLedgerEvent)).rejects.toThrow(TypeError);
    }
  });

  it('rejects a structural tombstone that bypasses the injected HMAC factory', async () => {
    const ledger = inMemoryLedger();

    await expect(ledger.append({
      ...deletionEvent(),
      subject: {
        encodingVersion: 1,
        algorithm: 'hmac-sha256',
        keyVersion: 'k1',
        digest: 'f'.repeat(64),
      },
    } as unknown as DeletionLedgerEvent)).rejects.toThrow(TypeError);
  });

  it('rejects the same event key with a different digest without overwriting the first event', async () => {
    const ledger = inMemoryLedger();
    const firstEvent = deletionEvent();
    await ledger.append(firstEvent);

    await expect(ledger.append({
      ...firstEvent,
      occurredAt: '2030-01-02T03:04:06.000Z',
    })).rejects.toMatchObject({
      name: DeletionLedgerConflictError.name,
      code: 'event_digest_conflict',
      eventKey: firstEvent.eventKey,
    });
    await expect(ledger.scanAfter(0, null)).resolves.toMatchObject({
      events: [{ event: firstEvent, sequence: 1 }],
      nextPageToken: null,
    });
  });

  it('snapshots an appended event so caller mutation cannot rewrite the ledger', async () => {
    const ledger = inMemoryLedger();
    const event = { ...deletionEvent() } as {
      eventKey: DeletionEventKey;
      subject: SubjectTombstone;
      occurredAt: string;
    };

    await ledger.append(event);
    event.occurredAt = '2031-01-02T03:04:05.000Z';
    event.subject = deletionEvent('replacement-event-reference').subject;

    const page = await ledger.scanAfter(0, null);
    expect(page.events[0]?.event).toEqual(deletionEvent());
  });

  it('assigns monotonic sequences and scans strictly after the exclusive cursor', async () => {
    const ledger = inMemoryLedger(5);

    const acknowledgements = await Promise.all([
      ledger.append(deletionEvent('synthetic-event-reference-0001')),
      ledger.append(deletionEvent('synthetic-event-reference-0002')),
      ledger.append(deletionEvent('synthetic-event-reference-0003')),
    ]);

    expect(acknowledgements.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
    await expect(ledger.scanAfter(1, null)).resolves.toMatchObject({
      events: [
        { event: { eventKey: deletionEvent('synthetic-event-reference-0002').eventKey }, sequence: 2 },
        { event: { eventKey: deletionEvent('synthetic-event-reference-0003').eventKey }, sequence: 3 },
      ],
      nextPageToken: null,
    });
  });

  it('keeps opaque pagination stable at the first page snapshot', async () => {
    const ledger = inMemoryLedger(2);
    await Promise.all([
      ledger.append(deletionEvent('synthetic-event-reference-0001')),
      ledger.append(deletionEvent('synthetic-event-reference-0002')),
      ledger.append(deletionEvent('synthetic-event-reference-0003')),
      ledger.append(deletionEvent('synthetic-event-reference-0004')),
      ledger.append(deletionEvent('synthetic-event-reference-0005')),
    ]);

    const first = await ledger.scanAfter(0, null);
    expect(first.events.map(({ sequence }) => sequence)).toEqual([1, 2]);
    expect(first.nextPageToken).toEqual(expect.any(String));
    expect(first.nextPageToken).not.toContain('g1');
    if (!first.nextPageToken) throw new Error('expected first page token');

    await ledger.append(deletionEvent('synthetic-event-reference-0006'));
    const second = await ledger.scanAfter(0, first.nextPageToken);
    expect(second.events.map(({ sequence }) => sequence)).toEqual([3, 4]);
    if (!second.nextPageToken) throw new Error('expected second page token');

    const third = await ledger.scanAfter(0, second.nextPageToken);
    expect(third.events.map(({ sequence }) => sequence)).toEqual([5]);
    expect(third.nextPageToken).toBeNull();
  });

  it('rejects tampered tokens, cursor substitution, and generation substitution', async () => {
    const ledger = inMemoryLedger(1);
    await ledger.append(deletionEvent('synthetic-event-reference-0001'));
    await ledger.append(deletionEvent('synthetic-event-reference-0002'));
    const first = await ledger.scanAfter(0, null);
    if (!first.nextPageToken) throw new Error('expected first page token');

    const [payload, signature] = first.nextPageToken.split('.');
    if (!payload || !signature) throw new Error('expected signed page token');
    const replacement = signature[0] === 'A' ? 'B' : 'A';
    const tampered = `${payload}.${replacement}${signature.slice(1)}`;

    await expect(ledger.scanAfter(0, tampered)).rejects.toMatchObject({
      name: DeletionLedgerPageTokenError.name,
      code: 'invalid_page_token',
    });
    await expect(ledger.scanAfter(1, first.nextPageToken)).rejects.toMatchObject({
      name: DeletionLedgerPageTokenError.name,
      code: 'cursor_mismatch',
    });
    await expect(
      inMemoryLedger(1, 'g2').scanAfter(0, first.nextPageToken),
    ).rejects.toMatchObject({
      name: DeletionLedgerPageTokenError.name,
      code: 'generation_mismatch',
    });
  });

  it('rejects a non-canonical base64url spelling even when it decodes to the same signature', async () => {
    const ledger = inMemoryLedger(1);
    await ledger.append(deletionEvent('synthetic-event-reference-0001'));
    await ledger.append(deletionEvent('synthetic-event-reference-0002'));
    const first = await ledger.scanAfter(0, null);
    if (!first.nextPageToken) throw new Error('expected first page token');

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const [payload, signature] = first.nextPageToken.split('.');
    if (!payload || !signature) throw new Error('expected signed page token');
    const lastIndex = alphabet.indexOf(signature.at(-1) ?? '');
    if (lastIndex < 0 || lastIndex % 4 !== 0) {
      throw new Error('expected canonical 32-byte base64url signature');
    }
    const equivalentSignature = `${signature.slice(0, -1)}${alphabet[lastIndex + 1]}`;

    await expect(
      ledger.scanAfter(0, `${payload}.${equivalentSignature}`),
    ).rejects.toMatchObject({
      name: DeletionLedgerPageTokenError.name,
      code: 'invalid_page_token',
    });
  });

  it('hard-copies a Buffer page-token key before caller mutation', async () => {
    const pageTokenKey = Buffer.from('page-token-fixture-key-material-01');
    const ledger = createInMemoryDeletionLedger({
      generation: 'g1',
      pageSize: 1,
      pageTokenKey,
      now: () => '2030-01-02T03:05:06.000Z',
    });
    await ledger.append(deletionEvent('synthetic-event-reference-0001'));
    await ledger.append(deletionEvent('synthetic-event-reference-0002'));
    const first = await ledger.scanAfter(0, null);
    if (!first.nextPageToken) throw new Error('expected first page token');

    pageTokenKey.fill(0);

    await expect(ledger.scanAfter(0, first.nextPageToken)).resolves.toMatchObject({
      events: [{ sequence: 2 }],
      nextPageToken: null,
    });
  });

  it('snapshots mutable fake options while retaining the injected clock behavior', async () => {
    let clockTick = 0;
    const options = {
      generation: 'g7',
      pageSize: 1,
      pageTokenKey: FIXTURE_PAGE_TOKEN_KEY,
      now: () => `2030-01-02T03:05:0${clockTick++}.000Z`,
    };
    const ledger = createInMemoryDeletionLedger(options);

    options.generation = 'g999';
    options.pageSize = 10;
    options.now = () => '2031-01-02T03:05:06.000Z';

    const firstAck = await ledger.append(deletionEvent('synthetic-event-reference-0001'));
    const secondAck = await ledger.append(deletionEvent('synthetic-event-reference-0002'));
    expect(firstAck).toMatchObject({
      generation: 'g7',
      ackedAt: '2030-01-02T03:05:00.000Z',
    });
    expect(secondAck.ackedAt).toBe('2030-01-02T03:05:01.000Z');

    const firstPage = await ledger.scanAfter(0, null);
    expect(firstPage.events.map(({ sequence }) => sequence)).toEqual([1]);
    expect(firstPage.nextPageToken).toEqual(expect.any(String));
  });
});
