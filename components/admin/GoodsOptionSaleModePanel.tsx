'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  readGoodsOptionSaleModeAction,
  setGoodsOptionSaleModeAction,
} from '@/app/admin/goods-option-sale-mode-actions';
import {
  goodsOptionSaleModeErrorMessage,
  type GoodsOptionSaleMode,
  type GoodsOptionSaleModeState,
} from '@/lib/goods-option-sale-mode';

/**
 * 상품 판매 방식 — 옵션 선택 / 랜덤 판매(D5②).
 *
 * 상품 편집기 운영 섹션(예약판매 앞)에 둔다. 저장된 상품에만 쓴다(goodId 필수). 기본 정보에 저장하지 않은 변경이 있으면
 * 부모가 disabled로 막는다 — 옵션·가격을 바꾸는 저장과 판매 방식 전환이 서로의 낙관 잠금(goods.updated_at)을 깨기 때문이다.
 * 랜덤 조건은 DB가 판정한다(admin_goods_option_sale_mode.randomProblem). 여기서는 그 결과로 선택만 막는다.
 */
export function GoodsOptionSaleModePanel({ goodId, disabled = false }: { goodId: string; disabled?: boolean }) {
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
      } else {
        setLoadError(loaded.error ?? '판매 방식을 불러오지 못했습니다.');
      }
    }, () => { if (alive) setLoadError('판매 방식을 불러오지 못했습니다.'); });
    return () => { alive = false; };
  }, [goodId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || !selected || selected === current.optionSaleMode || pending || disabled) return;
    setPending(true);
    const form = new FormData();
    form.set('id', goodId);
    form.set('mode', selected);
    form.set('expectedUpdatedAt', current.updatedAt);
    try {
      const saved = await setGoodsOptionSaleModeAction({}, form);
      setResult({ error: saved.error, message: saved.message });
      if (saved.state) {
        setCurrent(saved.state);
        setSelected(saved.state.optionSaleMode);
      }
    } catch {
      setResult({ error: '판매 방식을 바꾸지 못했습니다. 잠시 후 다시 시도하세요.' });
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
