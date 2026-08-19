import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { DeletionLedgerPageTokenError } from './errors';
import { isDeletionLedgerGeneration } from './contract';
import { encodeCanonicalField } from './internal';

export interface DeletionLedgerPageTokenState {
  readonly cursor: number;
  readonly after: number;
  readonly upperBound: number;
  readonly generation: string;
}

interface PageTokenCodec {
  encode(state: DeletionLedgerPageTokenState): string;
  decode(token: string): DeletionLedgerPageTokenState;
}

function encodePayload(state: DeletionLedgerPageTokenState): string {
  return [
    'ICONS-DELETION-PAGE-TOKEN\n',
    encodeCanonicalField('encodingVersion', '1'),
    encodeCanonicalField('cursor', String(state.cursor)),
    encodeCanonicalField('after', String(state.after)),
    encodeCanonicalField('upperBound', String(state.upperBound)),
    encodeCanonicalField('generation', state.generation),
  ].join('');
}

function invalidToken(): never {
  throw new DeletionLedgerPageTokenError('invalid_page_token');
}

function parseField(line: string, expectedName: string): string {
  const nameEnd = line.indexOf(':');
  const lengthEnd = line.indexOf(':', nameEnd + 1);
  if (nameEnd < 1 || lengthEnd <= nameEnd + 1 || line.slice(0, nameEnd) !== expectedName) {
    return invalidToken();
  }

  const declaredLength = Number(line.slice(nameEnd + 1, lengthEnd));
  const value = line.slice(lengthEnd + 1);
  if (
    !Number.isSafeInteger(declaredLength)
    || declaredLength < 0
    || Buffer.byteLength(value, 'utf8') !== declaredLength
  ) {
    return invalidToken();
  }
  return value;
}

function parseSequence(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return invalidToken();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return invalidToken();
  return parsed;
}

function decodePayload(payload: string): DeletionLedgerPageTokenState {
  const lines = payload.split('\n');
  if (
    lines.length !== 7
    || lines[0] !== 'ICONS-DELETION-PAGE-TOKEN'
    || lines[6] !== ''
    || parseField(lines[1], 'encodingVersion') !== '1'
  ) {
    return invalidToken();
  }

  const cursor = parseSequence(parseField(lines[2], 'cursor'));
  const after = parseSequence(parseField(lines[3], 'after'));
  const upperBound = parseSequence(parseField(lines[4], 'upperBound'));
  const generation = parseField(lines[5], 'generation');
  if (!isDeletionLedgerGeneration(generation) || after < cursor || after > upperBound) {
    return invalidToken();
  }

  return { cursor, after, upperBound, generation };
}

export function createDeletionLedgerPageTokenCodec(keyMaterial: Uint8Array): PageTokenCodec {
  if (!(keyMaterial instanceof Uint8Array) || keyMaterial.byteLength < 32) {
    throw new TypeError('Invalid deletion ledger page-token key');
  }
  const key = Uint8Array.from(keyMaterial);

  function sign(payload: string): Buffer {
    return createHmac('sha256', key)
      .update('ICONS-DELETION-PAGE-TOKEN-SIGNATURE\0', 'utf8')
      .update(payload, 'utf8')
      .digest();
  }

  return {
    encode(state) {
      const payload = encodePayload(state);
      return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sign(payload).toString('base64url')}`;
    },

    decode(token) {
      const parts = token.split('.');
      if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
        return invalidToken();
      }

      let payloadBytes: Buffer;
      let payload: string;
      let suppliedSignature: Buffer;
      try {
        payloadBytes = Buffer.from(parts[0], 'base64url');
        payload = payloadBytes.toString('utf8');
        suppliedSignature = Buffer.from(parts[1], 'base64url');
      } catch {
        return invalidToken();
      }

      if (
        payloadBytes.toString('base64url') !== parts[0]
        || suppliedSignature.toString('base64url') !== parts[1]
      ) {
        return invalidToken();
      }

      const expectedSignature = sign(payload);
      if (
        suppliedSignature.length !== expectedSignature.length
        || !timingSafeEqual(suppliedSignature, expectedSignature)
      ) {
        return invalidToken();
      }
      return decodePayload(payload);
    },
  };
}
