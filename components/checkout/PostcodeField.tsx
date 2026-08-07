'use client';

import { useEffect, useRef, useState } from 'react';
import { composePostcodeAddress, type ComposedPostcodeAddress } from '@/lib/postcode';
import { loadPostcodeSearch } from '@/lib/postcode.client';

/* 체크아웃 우편번호 칸(#175). 검색 레이어는 임베드 방식이라 팝업 차단에 걸리지
   않고 모바일에서도 그대로 뜬다. 선택 결과는 콜백으로만 들어오고 URL을 거치지
   않는다 — 배송지는 어떤 경우에도 쿼리스트링에 실리지 않는다.

   입력란은 언제나 편집 가능하다. 검색 스크립트가 죽어도 수기로 채워 결제까지
   갈 수 있어야 하기 때문이다. */

const FIELD_ID = 'checkout-postalCode';
/* Checkout의 첫 오류 필드 포커스 이동이 이 두 id를 찾는다. */
const ERROR_ID = `${FIELD_ID}-error`;

type LayerState = 'loading' | 'ready' | 'failed';

const LAYER_MESSAGE: Record<LayerState, string | null> = {
  loading: '주소 검색을 불러오는 중이에요.',
  ready: null,
  failed: '주소 검색을 열지 못했어요. 우편번호와 기본 주소를 직접 입력해도 주문할 수 있어요.',
};

interface PostcodeFieldProps {
  error?: string;
  onChange: (postalCode: string) => void;
  onSelect: (address: ComposedPostcodeAddress) => void;
  value: string;
}

export function PostcodeField({ error, onChange, onSelect, value }: PostcodeFieldProps) {
  const [open, setOpen] = useState(false);
  const [layerState, setLayerState] = useState<LayerState>('loading');
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const embedRef = useRef<HTMLDivElement>(null);
  /* 부모가 매 렌더 새 함수를 넘겨도 레이어를 다시 임베드하지 않게 한다. */
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  useEffect(() => {
    if (!open) return;

    let disposed = false;

    loadPostcodeSearch()
      .then((Postcode) => {
        const target = embedRef.current;
        if (disposed || !target) return;
        setLayerState('ready');
        new Postcode({
          oncomplete: (selection) => {
            const composed = composePostcodeAddress(selection);
            setOpen(false);
            if (composed) onSelectRef.current(composed);
            else setSelectionError('선택한 주소를 옮기지 못했어요. 직접 입력해주세요.');
          },
          onclose: () => setOpen(false),
          width: '100%',
          height: '100%',
          /* autoClose는 임베드 대상 노드를 스크립트가 직접 지운다. 그 노드는
             React 소유라 언마운트 때 removeChild가 두 번 일어난다. 닫는 일은
             우리가 상태로 한다. */
        }).embed(target, { autoClose: false });
      })
      .catch(() => {
        if (!disposed) setLayerState('failed');
      });

    return () => {
      disposed = true;
    };
  }, [open]);

  const describedBy = error ? ERROR_ID : undefined;
  const layerMessage = LAYER_MESSAGE[layerState];
  const toggleLayer = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setSelectionError(null);
    setLayerState('loading');
    setOpen(true);
  };

  return (
    <div className="checkout-field--wide postcode-field">
      <label className="postcode-field-label" htmlFor={FIELD_ID}>우편번호</label>
      <div className="postcode-field-row">
        <input
          id={FIELD_ID}
          required
          autoComplete="postal-code"
          inputMode="numeric"
          maxLength={5}
          placeholder="00000"
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="btn btn-ghost postcode-field-open"
          aria-expanded={open}
          aria-controls="postcode-search-layer"
          onClick={toggleLayer}
        >
          {open ? '주소 검색 닫기' : '주소 검색'}
        </button>
      </div>
      {error && <small id={ERROR_ID} className="checkout-field-error">{error}</small>}
      {selectionError && <small className="checkout-field-error" role="alert">{selectionError}</small>}
      {open && (
        <div className="postcode-layer" id="postcode-search-layer" role="dialog" aria-label="주소 검색">
          {/* 임베드가 이 노드를 직접 채운다. React 자식을 두면 조정이 충돌한다. */}
          <div className="postcode-layer-frame" ref={embedRef} />
          {layerMessage && (
            <p className="postcode-layer-state" role="status">{layerMessage}</p>
          )}
        </div>
      )}
      <small className="postcode-field-hint">
        검색이 열리지 않으면 우편번호와 기본 주소를 직접 입력해주세요.
      </small>
    </div>
  );
}
