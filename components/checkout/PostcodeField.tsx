'use client';

import { useEffect, useRef, useState } from 'react';
import { composePostcodeAddress, type ComposedPostcodeAddress } from '@/lib/postcode';
import { loadPostcodeSearch } from '@/lib/postcode.client';

/* 배송지 주소 칸(#175) — 우편번호와 기본 주소를 함께 소유한다. 주문서 두 벌·주소록 폼·선물 받기·정기구독이 같은 부품을 쓴다.

   주소는 검색으로 확정한다(검색 → 선택 → 상세 주소, 국내 커머스 관행). 검색 결과로 채운 우편번호·기본 주소는 읽기 전용이고
   [다시 검색]으로만 바꾼다 — 손으로 고친 주소가 실제 주소와 어긋나는 일을 막는다. 손 입력은 검색 스크립트를 열지 못했거나
   (네트워크·차단·무응답) 고른 결과를 옮기지 못했을 때만 연다. 그래야 검색이 죽는 날에도 결제까지 갈 수 있다.

   검색 레이어는 임베드 방식이라 팝업 차단에 걸리지 않고 모바일에서도 그대로 뜬다. 선택 결과는 콜백으로만 들어오고 URL을
   거치지 않는다 — 배송지는 어떤 경우에도 쿼리스트링에 실리지 않는다.

   읽기 전용 칸은 브라우저 필수 검사(required)에서 빠진다 — 쓰는 화면은 제출할 때 checkoutAddressErrors 로 직접 검사한다. */

export type PostcodeAddressField = 'postalCode' | 'address1';

/* Checkout의 첫 오류 필드 포커스 이동이 `checkout-postalCode`·`checkout-address1` 을 찾는다(기본 접두). 주소록 폼처럼 다른 화면이
   이 칸을 쓰면 자기 접두를 넘겨 같은 문서 안에서 id가 겹치지 않게 한다. */
const DEFAULT_PREFIX = 'checkout';
const errorId = (fieldId: string) => `${fieldId}-error`;

export type LayerState = 'loading' | 'ready' | 'failed';

/** 검색 스크립트를 불러오지 못했을 때의 기본 문구(주문서 문맥). 다른 화면은 failedMessage 로 자기 문맥의 문구를 넘긴다. */
export const POSTCODE_FAILED_MESSAGE = '주소 검색을 열지 못했어요. 우편번호와 기본 주소를 직접 입력해도 주문할 수 있어요.';
/** 고른 결과를 칸에 옮기지 못했을 때(우편번호 형식·길이 한도). 손 입력이 열린다. */
export const POSTCODE_SELECTION_FAILED_MESSAGE = '선택한 주소를 옮기지 못했어요. 우편번호와 기본 주소를 직접 입력해주세요.';
/** 검색으로 채우는 동안의 안내. */
export const POSTCODE_SEARCH_HINT = '주소 검색으로 채워요. 동·호수는 아래 상세 주소에 적어주세요.';

/** 검색 레이어 안 상태 문구. 준비되면 문구가 없다. 실패는 레이어를 닫고 칸 아래에 알린다. */
export function postcodeLayerMessage(state: LayerState, failedMessage: string = POSTCODE_FAILED_MESSAGE): string | null {
  if (state === 'loading') return '주소 검색을 불러오는 중이에요.';
  return state === 'failed' ? failedMessage : null;
}

/** 검색 버튼 글자 — 열려 있으면 닫기, 이미 주소가 있으면 다시 검색. */
export function postcodeSearchButtonLabel(open: boolean, hasAddress: boolean): string {
  if (open) return '주소 검색 닫기';
  return hasAddress ? '다시 검색' : '주소 검색';
}

interface PostcodeFieldProps {
  /** 칸 id 접두 — `${idPrefix}-postalCode`·`${idPrefix}-address1`. 기본은 주문서의 `checkout`. */
  idPrefix?: string;
  postalCode: string;
  address1: string;
  errors?: Partial<Record<PostcodeAddressField, string>>;
  /** 검색을 열지 못했을 때 문구. 기본은 주문서 문맥(POSTCODE_FAILED_MESSAGE). */
  failedMessage?: string;
  /** 손 입력 — 검색을 열지 못했을 때만 칸이 열린다. */
  onChange: (field: PostcodeAddressField, value: string) => void;
  onSelect: (address: ComposedPostcodeAddress) => void;
}

export function PostcodeField({ address1, errors = {}, failedMessage = POSTCODE_FAILED_MESSAGE, idPrefix = DEFAULT_PREFIX, onChange, onSelect, postalCode }: PostcodeFieldProps) {
  const [open, setOpen] = useState(false);
  const [layerState, setLayerState] = useState<LayerState>('loading');
  /* 손 입력이 열린 까닭(검색 실패·결과 변환 실패). 열리면 이 칸이 있는 동안 계속 열려 있다. */
  const [manualReason, setManualReason] = useState<string | null>(null);
  const embedRef = useRef<HTMLDivElement>(null);
  /* 부모가 매 렌더 새 함수를 넘겨도 레이어를 다시 임베드하지 않게 한다. */
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  const postalId = `${idPrefix}-postalCode`;
  const address1Id = `${idPrefix}-address1`;
  const hintId = `${idPrefix}-address-hint`;
  /* 주문서의 기본 칸은 기존 마크업(id)을 그대로 둔다. */
  const layerId = idPrefix === DEFAULT_PREFIX ? 'postcode-search-layer' : `${postalId}-search-layer`;
  const manual = manualReason !== null;

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
            else {
              setManualReason(POSTCODE_SELECTION_FAILED_MESSAGE);
              window.requestAnimationFrame(() => document.getElementById(postalId)?.focus());
            }
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
        if (disposed) return;
        /* 검색을 열지 못했다 — 빈 레이어를 걷고 손 입력을 연다. 포커스는 이제 쓸 수 있는 우편번호 칸으로. */
        setLayerState('failed');
        setOpen(false);
        setManualReason(failedMessage);
        window.requestAnimationFrame(() => document.getElementById(postalId)?.focus());
      });

    return () => {
      disposed = true;
    };
  }, [failedMessage, open, postalId]);

  const layerMessage = postcodeLayerMessage(layerState, failedMessage);
  const openLayer = () => {
    setLayerState('loading');
    setOpen(true);
  };
  const toggleLayer = () => {
    if (open) {
      setOpen(false);
      return;
    }
    openLayer();
  };
  /* 잠긴 빈 칸을 누르면 검색을 연다(검색이 유일한 입력 수단일 때). */
  const openFromLockedField = () => {
    if (!manual && !open) openLayer();
  };

  const describedBy = (field: PostcodeAddressField, fieldId: string) => [errors[field] ? errorId(fieldId) : null, hintId].filter(Boolean).join(' ');

  return (
    <div className="checkout-field--wide postcode-field" data-manual={manual ? '' : undefined}>
      <label className="postcode-field-label" htmlFor={postalId}>우편번호</label>
      <div className="postcode-field-row">
        <input
          id={postalId}
          required
          autoComplete="postal-code"
          inputMode="numeric"
          maxLength={5}
          placeholder={manual ? '00000' : undefined}
          readOnly={!manual}
          aria-invalid={Boolean(errors.postalCode)}
          aria-describedby={describedBy('postalCode', postalId)}
          value={postalCode}
          onChange={(event) => onChange('postalCode', event.target.value)}
          onClick={openFromLockedField}
        />
        <button
          type="button"
          className="btn btn-ghost postcode-field-open"
          aria-expanded={open}
          aria-controls={layerId}
          onClick={toggleLayer}
        >
          {postcodeSearchButtonLabel(open, Boolean(postalCode.trim() || address1.trim()))}
        </button>
      </div>
      {errors.postalCode && <small id={errorId(postalId)} className="checkout-field-error">{errors.postalCode}</small>}
      {open && (
        <div className="postcode-layer" id={layerId} role="dialog" aria-label="주소 검색">
          {/* 임베드가 이 노드를 직접 채운다. React 자식을 두면 조정이 충돌한다. */}
          <div className="postcode-layer-frame" ref={embedRef} />
          {layerMessage && (
            <p className="postcode-layer-state" role="status">{layerMessage}</p>
          )}
        </div>
      )}
      <label className="postcode-field-label postcode-field-label--address" htmlFor={address1Id}>기본 주소</label>
      <input
        id={address1Id}
        required
        autoComplete="address-line1"
        maxLength={200}
        readOnly={!manual}
        aria-invalid={Boolean(errors.address1)}
        aria-describedby={describedBy('address1', address1Id)}
        value={address1}
        onChange={(event) => onChange('address1', event.target.value)}
        onClick={openFromLockedField}
      />
      {errors.address1 && <small id={errorId(address1Id)} className="checkout-field-error">{errors.address1}</small>}
      {manual ? (
        <small className="postcode-field-hint is-manual" id={hintId} role="alert">{manualReason}</small>
      ) : (
        <small className="postcode-field-hint" id={hintId}>{POSTCODE_SEARCH_HINT}</small>
      )}
    </div>
  );
}
