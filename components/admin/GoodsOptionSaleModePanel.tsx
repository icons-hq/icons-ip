'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  readGoodsOptionSaleModeAction,
  setGoodsOptionSaleModeAction,
  type GoodsOptionSaleModeActionState,
} from '@/app/admin/goods-option-sale-mode-actions';
import {
  goodsOptionSaleModeErrorMessage,
  type GoodsOptionSaleMode,
  type GoodsOptionSaleModeState,
} from '@/lib/goods-option-sale-mode';

const SAVE_FAILED = '판매 방식을 바꾸지 못했습니다. 잠시 후 다시 시도하세요.';
const GOODS_CHANGED = goodsOptionSaleModeErrorMessage('goods_changed');
const GOODS_CHANGED_RELOADED = '다른 곳에서 상품이 바뀌어 최신 상태를 다시 불러왔습니다. 확인한 뒤 다시 저장하세요.';

/**
 * 상품 판매 방식 — 옵션 선택 / 랜덤 판매(D5②).
 *
 * 상품 편집기 운영 섹션(예약판매 앞)에 둔다. 저장된 상품에만 쓴다(goodId 필수). 기본 정보에 저장하지 않은 변경이 있으면
 * 부모가 disabled로 막는다 — 옵션·가격을 바꾸는 저장과 판매 방식 전환이 서로의 낙관 잠금(goods.updated_at)을 깨기 때문이다.
 * 같은 이유로 부모는 상품을 저장한 뒤 바뀐 리비전(예: goods.updated_at)을 `revision`으로 넘긴다. 바뀌면 다시 읽는다.
 * 저장이 거절돼도 다시 읽는다 — 옛 낙관 잠금 값으로 다시 보내면 계속 거절되기 때문이다.
 * 랜덤 조건은 DB가 판정한다(admin_goods_option_sale_mode.randomProblem). 여기서는 그 결과로 선택만 막는다.
 */
export function GoodsOptionSaleModePanel({ goodId, revision, disabled = false }: {
  goodId: string;
  /** 부모가 아는 상품 리비전(goods.updated_at 등). 바뀌면 판매 방식과 낙관 잠금 값을 다시 읽는다. */
  revision?: string | number;
  disabled?: boolean;
}) {
  const [current, setCurrent] = useState<GoodsOptionSaleModeState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GoodsOptionSaleMode | null>(null);
  const [result, setResult] = useState<{ error?: string; message?: string }>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let alive = true;
    readGoodsOptionSaleModeAction(goodId).then((loaded) => {
      if (!alive) return;
      if (loaded.state) {
        setCurrent(loaded.state);
        setSelected(loaded.state.optionSaleMode);
        setLoadError(null);
        setResult({});
      } else {
        setLoadError(loaded.error ?? '판매 방식을 불러오지 못했습니다.');
      }
    }, () => { if (alive) setLoadError('판매 방식을 불러오지 못했습니다.'); });
    return () => { alive = false; };
  }, [goodId, revision]);

  /* 거절 뒤 최신 상태(낙관 잠금 값·랜덤 조건)를 다시 읽는다. 고른 값은 두되, 이제 랜덤을 쓸 수 없으면 현재 방식으로 되돌린다. */
  async function reloadAfterError(error: string) {
    let loaded: GoodsOptionSaleModeActionState;
    try {
      loaded = await readGoodsOptionSaleModeAction(goodId);
    } catch {
      loaded = {};
    }
    const state = loaded.state;
    if (!state) {
      setResult({ error });
      return;
    }
    setCurrent(state);
    setSelected((previous) => previous === 'random' && state.optionSaleMode !== 'random' && state.randomProblem
      ? state.optionSaleMode : previous);
    setResult({ error: error === GOODS_CHANGED ? GOODS_CHANGED_RELOADED : error });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || !selected || selected === current.optionSaleMode || pending || disabled) return;
    setPending(true);
    const form = new FormData();
    form.set('id', goodId);
    form.set('mode', selected);
    form.set('expectedUpdatedAt', current.updatedAt);
    try {
      let saved: GoodsOptionSaleModeActionState;
      try {
        saved = await setGoodsOptionSaleModeAction({}, form);
      } catch {
        saved = { error: SAVE_FAILED };
      }
      if (saved.error) {
        await reloadAfterError(saved.error);
        return;
      }
      setResult({ message: saved.message });
      if (saved.state) {
        setCurrent(saved.state);
        setSelected(saved.state.optionSaleMode);
      }
    } finally {
      setPending(false);
    }
  }

  const randomBlocked = Boolean(current && current.optionSaleMode !== 'random' && current.randomProblem);

  return (
    <section className="admin-panel col" style={{ gap: 10 }} aria-label="판매 방식">
      <div>
        <strong>판매 방식</strong>
        <p className="admin-note">
          랜덤 판매는 고객이 옵션을 고르지 않고 &apos;랜덤&apos;으로 주문합니다. 주문할 때 남은 재고에 비례해 옵션이 무작위로 정해지고,
          주문 상세와 출고 파일에는 정해진 옵션이 보입니다. 고객 화면에는 끝까지 &apos;랜덤&apos;으로만 보입니다.
        </p>
      </div>
      {loadError && <p className="admin-error" role="alert">{loadError}</p>}
      {!current && !loadError && <p className="admin-note" role="status">판매 방식을 불러오는 중입니다.</p>}
      {current && (
        <form onSubmit={submit}>
          <fieldset disabled={disabled || pending} className="col" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
            <legend className="sr-only">판매 방식</legend>
            <label>
              <input
                type="radio"
                name="optionSaleMode"
                value="select"
                checked={selected === 'select'}
                onChange={() => setSelected('select')}
              />{' '}
              옵션 선택 판매
            </label>
            <label>
              <input
                type="radio"
                name="optionSaleMode"
                value="random"
                checked={selected === 'random'}
                disabled={randomBlocked}
                onChange={() => setSelected('random')}
              />{' '}
              랜덤 판매 (판매 중인 옵션 {current.activeOptionCount}개)
            </label>
            {randomBlocked && current.randomProblem && (
              <p className="admin-note">{goodsOptionSaleModeErrorMessage(current.randomProblem)}</p>
            )}
            <button type="submit" className="btn btn-ghost" disabled={!selected || selected === current.optionSaleMode}>
              {pending ? '바꾸는 중' : '판매 방식 저장'}
            </button>
          </fieldset>
        </form>
      )}
      {result.error && <p className="admin-error" role="alert">{result.error}</p>}
      {result.message && <p className="admin-note" role="status">{result.message}</p>}
    </section>
  );
}
