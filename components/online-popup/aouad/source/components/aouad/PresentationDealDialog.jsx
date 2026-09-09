"use client";

import { useState } from "react";
import { ASSET, MD_DETAIL } from "./aouad-data";
import { presentationDeal, presentationDealBlock, presentationDealProgress } from "./presentation-deals";
import { won } from "./deal-format";
import PresentationDialog from "./PresentationDialog";
import styles from "./PresentationDealDialog.module.css";

const DONE = { raffle: "응모 체험을 마쳤습니다", preorder: "예약 체험을 마쳤습니다", fcfs: "주문 체험을 마쳤습니다" };
const VERB = { raffle: "무료 응모 체험하기", preorder: "예약 체험 완료하기", fcfs: "주문 체험 완료하기" };

export default function PresentationDealDialog({ request, state, rights, onConfirm, onClose, onProduct }) {
  const deal = presentationDeal(request);
  const progress = presentationDealProgress(state, request);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [option, setOption] = useState(request.option || null);
  const [qty, setQty] = useState(1);
  const [completed, setCompleted] = useState(null);
  const [showHistory, setShowHistory] = useState(Boolean(request.viewRecord));
  const [error, setError] = useState(null);
  if (!deal) return null;
  const receipt = completed || ((showHistory || progress.remaining === 0) ? progress.last : null);
  const options = deal.kind !== "raffle" ? MD_DETAIL[deal.product.id]?.options : null;
  const blocked = presentationDealBlock(deal, rights);
  const needsOption = options && !options.values.includes(option);
  const canConfirm = !blocked && !needsOption && progress.remaining >= qty;
  const submit = () => {
    if (receipt) { onClose(); return; }
    if (!canConfirm) return;
    const result = onConfirm({ operationId, option, qty, now: Date.now() });
    if (result.error) setError(result.error);
    else { setError(null); setCompleted(result.receipt); }
  };
  const again = () => {
    setCompleted(null); setShowHistory(false); setError(null); setQty(1); setOption(null);
    setOperationId(crypto.randomUUID());
  };

  return (
    <PresentationDialog label={`${deal.title} 시연`} className={styles.overlay} onClose={onClose}>
      <section className={styles.sheet}>
        <header className={styles.header}>
          <button type="button" className={styles.close} onClick={onClose} aria-label="시연 창 닫기">닫기</button>
          <span>HYOSAN · {deal.kind.toUpperCase()}</span>
          <h2>{receipt ? DONE[deal.kind] : deal.title}</h2>
          <p>{receipt ? "이 기기에 시연 기록을 남겼습니다." : "선택한 굿즈와 내용을 확인해 주세요."}</p>
        </header>
        <div className={styles.image} style={{ backgroundImage: `url(${ASSET(deal.product.src)})` }} role="img" aria-label={`${deal.product.name} 컨셉 이미지`} />
        <h3 className={styles.name}>{deal.product.name}</h3>
        <p className={styles.edition}>{deal.edition}</p>
        {receipt ? (
          <div className={styles.receipt} role="status">
            <div><span>시연 번호</span><b>HS-{receipt.id.slice(0, 8).toUpperCase()}</b></div>
            <div><span>내용</span><b>{deal.kind === "raffle" ? "무료 응모 1회" : `${receipt.qty}개${receipt.option ? ` · ${receipt.option}` : ""}`}</b></div>
            {deal.kind !== "raffle" && <div><span>{deal.kind === "preorder" ? "예약 예정 금액" : "주문 체험 금액"}</span><b>{won(receipt.total)}</b></div>}
          </div>
        ) : (
          <div className={styles.form}>
            {deal.kind === "raffle" ? <p className={styles.free}>무료 · 회차당 한 번 응모</p> : (
              <>
                {options && <fieldset className={styles.options}><legend>{options.name}</legend>
                  {options.values.map((value) => <button key={value} type="button" aria-pressed={option === value} onClick={() => setOption(value)}>{value}</button>)}
                </fieldset>}
                <label className={styles.quantity}>수량
                  <select value={qty} onChange={(event) => setQty(Number(event.target.value))} disabled={progress.remaining === 0}>
                    {Array.from({ length: Math.max(1, progress.remaining) }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}개</option>)}
                  </select>
                  <span>이 {deal.kind === "fcfs" ? "매대" : "예약"} 1인 {deal.limit}개</span>
                </label>
                <div className={styles.total}><span>{deal.kind === "preorder" ? "예약 예정 금액" : "주문 체험 금액"}</span><b>{won(deal.product.price * qty)}</b></div>
              </>
            )}
            {blocked && <p className={styles.message}>{blocked}</p>}
            {error && <p className={styles.message} role="alert">{error}</p>}
          </div>
        )}
        <p className={styles.note}>프레젠테이션용 체험입니다. 실제 응모·예약·결제는 전송되지 않습니다.</p>
        <footer className={styles.actions}>
          {receipt && deal.kind !== "raffle" && progress.remaining > 0
            ? <button key="secondary" type="button" onClick={again}>추가로 선택하기</button>
            : <button key="secondary" type="button" onClick={() => { onClose(); onProduct?.(deal.product.id, "hub"); }}>굿즈 상세 보기</button>}
          <button key="primary" type="button" className={styles.primary} disabled={!receipt && !canConfirm} onClick={submit}>
            {receipt ? "닫기" : needsOption ? "사이즈를 선택해 주세요" : VERB[deal.kind]}
          </button>
        </footer>
      </section>
    </PresentationDialog>
  );
}
