import { describe, expect, it } from 'vitest';

import {
  createDisabledDeletionLedger,
  createInMemoryDeletionLedger,
  createVersionedEventKeyFactory,
  createVersionedSubjectHmacFactory,
  DeletionLedgerUnavailableError,
  type DeletionLedger,
} from './index';
import { getDeletionLedger } from './runtime.server';

const FIXTURE_HMAC_KEY = new TextEncoder().encode('fixture-only-key-material-000001');
const FIXTURE_PAGE_TOKEN_KEY = new TextEncoder().encode('page-token-fixture-key-material-01');

function syntheticEvent() {
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
    eventKey: createEventKey('synthetic-contract-event-reference'),
    subject: createSubjectHmac('synthetic-contract-subject'),
    occurredAt: '2030-01-02T03:04:05.000Z',
  } as const;
}

interface AdapterScenario {
  readonly name: string;
  readonly mode: 'available' | 'disabled';
  readonly create: () => DeletionLedger;
}

function deletionLedgerAdapterContract(scenario: AdapterScenario) {
  describe(scenario.name, () => {
    it('implements the two-method public adapter seam', () => {
      const ledger = scenario.create();

      expect(ledger).toEqual({
        append: expect.any(Function),
        scanAfter: expect.any(Function),
      });
    });

    if (scenario.mode === 'available') {
      it('acknowledges and scans the synthetic event', async () => {
        const ledger = scenario.create();
        const acknowledgement = await ledger.append(syntheticEvent());

        await expect(ledger.scanAfter(0, null)).resolves.toMatchObject({
          events: [{ sequence: acknowledgement.sequence, event: syntheticEvent() }],
          nextPageToken: null,
        });
      });
    } else {
      it('fails closed for append and scan without requiring append success', async () => {
        const ledger = scenario.create();

        await expect(ledger.append(syntheticEvent())).rejects.toMatchObject({
          name: DeletionLedgerUnavailableError.name,
          code: 'deletion_ledger_unavailable',
        });
        await expect(ledger.scanAfter(0, null)).rejects.toMatchObject({
          name: DeletionLedgerUnavailableError.name,
          code: 'deletion_ledger_unavailable',
        });
      });
    }
  });
}

deletionLedgerAdapterContract({
  name: 'in-memory fake',
  mode: 'available',
  create: () => createInMemoryDeletionLedger({
    generation: 'g3',
    pageSize: 10,
    pageTokenKey: FIXTURE_PAGE_TOKEN_KEY,
    now: () => '2030-01-02T03:05:06.000Z',
  }),
});

deletionLedgerAdapterContract({
  name: 'disabled adapter',
  mode: 'disabled',
  create: createDisabledDeletionLedger,
});

describe('runtime selection', () => {
  it('selects the disabled adapter by default', async () => {
    await expect(getDeletionLedger().scanAfter(0, null)).rejects.toMatchObject({
      name: DeletionLedgerUnavailableError.name,
      code: 'deletion_ledger_unavailable',
    });
  });
});
