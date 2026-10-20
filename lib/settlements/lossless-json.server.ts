import 'server-only';

/** Retains wire type as well as value; identifiers must never accept number tokens. */
export class SettlementJsonNumber {
  constructor(readonly raw: string) {}
}

/** Bounded JSON decoder retaining exact number tokens; rejects ambiguous duplicate keys. */
export function parseSettlementJson(source: string): unknown {
  let position = 0;
  const fail = (): never => { throw new Error('invalid_settlement_response'); };
  const whitespace = () => { while (/[\t\n\r ]/.test(source[position] ?? '\0')) position++; };
  const string = (): string => {
    const start = position++;
    while (position < source.length) {
      if (source[position] === '\\') { position += 2; continue; }
      if (source[position++] === '"') {
        try { return JSON.parse(source.slice(start, position)) as string; } catch { return fail(); }
      }
    }
    return fail();
  };
  const value = (depth: number): unknown => {
    if (depth > 32) return fail();
    whitespace();
    const current = source[position];
    if (current === '"') return string();
    if (current === '{') {
      position++; whitespace();
      const output: Record<string, unknown> = Object.create(null);
      if (source[position] === '}') { position++; return output; }
      for (;;) {
        if (source[position] !== '"') return fail();
        const key = string(); whitespace();
        if (Object.hasOwn(output, key) || source[position++] !== ':') return fail();
        output[key] = value(depth + 1); whitespace();
        const separator = source[position++];
        if (separator === '}') return output;
        if (separator !== ',') return fail();
        whitespace();
      }
    }
    if (current === '[') {
      position++; whitespace();
      const output: unknown[] = [];
      if (source[position] === ']') { position++; return output; }
      for (;;) {
        output.push(value(depth + 1)); whitespace();
        const separator = source[position++];
        if (separator === ']') return output;
        if (separator !== ',') return fail();
      }
    }
    for (const [literal, decoded] of [['true', true], ['false', false], ['null', null]] as const) {
      if (source.startsWith(literal, position)) { position += literal.length; return decoded; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(position));
    if (!number) return fail();
    position += number[0].length;
    return new SettlementJsonNumber(number[0]);
  };
  const result = value(0); whitespace();
  if (position !== source.length) return fail();
  return result;
}
