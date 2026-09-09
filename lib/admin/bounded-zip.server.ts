import 'server-only';
import yauzl from 'yauzl';

/** Inspect advertised sizes before allocation and enforce actual stream sizes too. */
export function readBoundedZip(
  bytes: Buffer,
  limits: {
    entries: number;
    totalBytes: number;
    entryBytes: number;
    imagesOnly?: boolean;
  },
): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) {
          reject(new Error('ZIP 형식을 읽을 수 없습니다.'));
          return;
        }
        const files = new Map<string, Buffer>();
        let advertised = 0;
        let actual = 0;
        let count = 0;
        let failed = false;
        const fail = (message: string) => {
          if (failed) return;
          failed = true;
          zip.close();
          reject(new Error(message));
        };
        if (zip.entryCount > limits.entries) {
          fail('압축 파일의 항목 수가 상한을 초과합니다.');
          return;
        }
        zip.on('error', () => fail('압축 파일이 손상됐습니다.'));
        zip.on('end', () => {
          if (!failed) resolve(files);
        });
        zip.on('entry', (entry) => {
          count++;
          advertised += entry.uncompressedSize;
          if (
            count > limits.entries ||
            advertised > limits.totalBytes ||
            entry.uncompressedSize > limits.entryBytes
          ) {
            fail('압축을 푼 파일 용량이 상한을 초과합니다.');
            return;
          }
          if (
            entry.fileName.startsWith('/') ||
            entry.fileName.split('/').some((part: string) => part === '..') ||
            entry.fileName.includes('\\') ||
            entry.isEncrypted()
          ) {
            fail('암호화 또는 안전하지 않은 ZIP 경로는 사용할 수 없습니다.');
            return;
          }
          if (/vbaproject|(^|\/)embeddings\//i.test(entry.fileName)) {
            fail('매크로·삽입 개체가 있는 양식은 사용할 수 없습니다.');
            return;
          }
          if (
            entry.fileName.endsWith('/') ||
            (limits.imagesOnly && !/\.(png|jpe?g|webp)$/i.test(entry.fileName))
          ) {
            zip.readEntry();
            return;
          }
          const key = limits.imagesOnly
            ? entry.fileName.split('/').at(-1)!
            : entry.fileName;
          if (files.has(key)) {
            fail(
              'ZIP에 같은 파일명이 여러 번 있습니다. 파일명을 구분해주세요.',
            );
            return;
          }
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              fail('압축 파일을 읽을 수 없습니다.');
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on('data', (chunk: Buffer) => {
              size += chunk.length;
              actual += chunk.length;
              if (size > limits.entryBytes || actual > limits.totalBytes) {
                stream.destroy();
                fail('압축을 푼 파일 용량이 상한을 초과합니다.');
                return;
              }
              chunks.push(chunk);
            });
            stream.on('error', () =>
              fail('압축 파일의 크기 또는 내용이 올바르지 않습니다.'),
            );
            stream.on('end', () => {
              if (!failed) {
                files.set(key, Buffer.concat(chunks));
                zip.readEntry();
              }
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}
