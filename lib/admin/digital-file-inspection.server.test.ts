import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { inspectDigitalFile } from './digital-file-inspection.server';
it('rejects renamed invalid formats, binary text, and empty files', () => {
 expect(inspectDigitalFile(new TextEncoder().encode('<script>alert(1)</script>'), 'application/pdf')).toBeNull();
 expect(inspectDigitalFile(new Uint8Array([0xff, 0xfe]), 'text/plain')).toBeNull();
 expect(inspectDigitalFile(new Uint8Array([65, 0, 66]), 'text/plain')).toBeNull();
 expect(inspectDigitalFile(new Uint8Array(), 'text/plain')).toBeNull();
 expect(inspectDigitalFile(new Uint8Array([1]), 'text/html')).toBeNull();
});
it('binds the accepted original bytes to an exact digest', () => {
 const bytes = new TextEncoder().encode('%PDF-1.7\nTEST\n%%EOF');
 expect(inspectDigitalFile(bytes, 'application/pdf')).toBe(createHash('sha256').update(bytes).digest('hex'));
});
