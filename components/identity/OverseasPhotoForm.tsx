'use client';
import { useRef, useState, type PointerEvent } from 'react';
import { OVERSEAS_METHOD, OVERSEAS_UPLOAD_LIMIT } from '@/lib/identity/overseas-adult';

export function OverseasPhotoForm({
  id,
  challenge,
  onSubmitted,
}: {
  id: string;
  challenge: string;
  onSubmitted: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const generation = useRef(0);
  const [ready, setReady] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  async function select(file?: File) {
    const current = ++generation.current;
    setReady(false);
    setConsent(false);
    setNotice('');
    const element = canvas.current;
    if (!element) return;
    element.width = 1;
    try {
      if (!file || file.size > 16_000_000 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
        throw new Error();
      const bitmap = await createImageBitmap(file);
      try {
        if (current !== generation.current) return;
        if (Math.min(bitmap.width, bitmap.height) < 320) throw new Error();
        const factor = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
        element.width = Math.round(bitmap.width * factor);
        element.height = Math.round(bitmap.height * factor);
        const context = element.getContext('2d');
        if (!context) throw new Error();
        context.fillStyle = '#fff';
        context.fillRect(0, 0, element.width, element.height);
        context.drawImage(bitmap, 0, 0, element.width, element.height);
        setReady(true);
      } finally {
        bitmap.close();
      }
    } catch {
      setNotice('가로·세로 320px 이상, 16MB 이하의 JPG·PNG·WebP를 선택해 주세요. / Choose a supported image.');
    }
  }
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const el = event.currentTarget,
      box = el.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) * el.width) / box.width,
      y: ((event.clientY - box.top) * el.height) / box.height,
    };
  }
  function cover(event: PointerEvent<HTMLCanvasElement>) {
    const first = start.current;
    start.current = null;
    const context = event.currentTarget.getContext('2d');
    if (!first || !context) return;
    const last = point(event);
    context.fillStyle = '#000';
    context.fillRect(first.x, first.y, last.x - first.x, last.y - first.y);
    setConsent(false);
  }
  async function send() {
    if (!canvas.current || !ready || !consent || busy) return;
    setBusy(true);
    setNotice('');
    try {
      const element = canvas.current;
      const photo = await new Promise<Blob | null>((resolve) => element.toBlob(resolve, 'image/jpeg', 0.86));
      if (!photo || photo.size > OVERSEAS_UPLOAD_LIMIT) throw new Error();
      const result = await fetch('/api/identity/overseas/' + id + '/upload', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'X-Photo-Consent': OVERSEAS_METHOD },
        body: photo,
      });
      if (!result.ok) throw new Error();
      element.width = 1;
      setReady(false);
      setConsent(false);
      onSubmitted();
    } catch {
      setNotice(
        '접수 여부를 확인하려면 새로고침해 주세요. / Refresh to check whether your photo was received.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="grid max-w-2xl gap-4">
      <p>
        종이에 신청 코드 <strong className="select-all">{challenge}</strong>를 적어 주세요. 본인 얼굴, 코드,
        가린 신분증이 한 사진에 보여야 해요.
      </p>
      <p lang="en">
        Take one photo with your face, this handwritten code and your unexpired ID. Show only the issuing
        authority, ID photo, date of birth and expiry if present. Cover your name, ID number, machine-readable
        lines, address, signature and barcodes on the document before taking the photo.
      </p>
      <p>
        신분증은 발급처·얼굴·생년월일·유효기간(있는 경우)만 보이게 해 주세요.
        이름·문서번호·기계판독영역·주소·서명·바코드는 촬영 전에 가려 주세요.
      </p>
      <label>
        사진 선택 / Choose photo{' '}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(event) => {
            void select(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>
      <p hidden={!ready}>
        추가로 가릴 부분을 드래그해 주세요. 다시 선택하면 처음부터 편집할 수 있어요. / Drag across any remaining
        details to black them out, or select a new photo.
      </p>
      <canvas
        ref={canvas}
        hidden={!ready}
        aria-label="제출할 사진 미리보기 / Redacted photo preview"
        className="max-h-[65vh] max-w-full touch-none object-contain"
        style={{ width: 'auto', height: 'auto' }}
        onPointerDown={(event) => {
          if (!busy) {
            start.current = point(event);
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        }}
        onPointerUp={cover}
        onPointerCancel={() => {
          start.current = null;
        }}
      />
      <label>
        <input
          type="checkbox"
          disabled={!ready || busy}
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />{' '}
        불필요한 정보를 가렸으며, 위 사진과 신청 기록의 선택적 수집·이용에 동의해요. / I have covered the extra
        details and agree to the optional collection and use described above.
      </label>
      {notice && <p role="alert">{notice}</p>}
      <button
        type="button"
        className="wc-btn primary"
        disabled={!ready || !consent || busy}
        onClick={() => void send()}
      >
        {busy ? '제출 중 / Sending…' : '가린 사진 제출 / Submit redacted photo'}
      </button>
    </section>
  );
}
