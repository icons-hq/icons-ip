import { describe, expect, it } from "vitest";
import { FCFS, MD_DETAIL, PREORDER, RAFFLES } from "./source/components/aouad/aouad-data";
import { completePresentationDeal, normalizeDealRecords, presentationDeal, presentationDealProgress, presentationDealSummary } from "./source/components/aouad/presentation-deals";
import { EMPTY_PRESENTATION_STATE, normalizePresentationState } from "./source/components/aouad/presentation-state";

const selection = (operationId, changes = {}) => ({ operationId, option: null, qty: 1, now: 1788934534000, ...changes });
const empty = () => normalizePresentationState(EMPTY_PRESENTATION_STATE);

describe("local event receipts", () => {
  it("records a free raffle once without creating a paid order or changing spend", () => {
    const request = { kind: "raffle", referenceId: "rf-uniform-sign" };
    const first = completePresentationDeal(empty(), request, selection("raffle-one"));
    expect(first.error).toBeNull();
    expect(first.receipt).toMatchObject({ productId: "uniform_female", qty: 1, total: 0, option: null });
    expect(first.next.orders).toEqual([]);
    expect(first.next.spent).toBe(0);
    const sameOperation = completePresentationDeal(first.next, request, selection("raffle-one"));
    const secondAttempt = completePresentationDeal(first.next, request, selection("raffle-two"));
    expect(sameOperation.next).toBe(first.next);
    expect(secondAttempt.receipt).toEqual(first.receipt);
    expect(presentationDealProgress(first.next, request)).toMatchObject({ count: 1, remaining: 0 });
  });

  it("reserves the chosen preorder product and size, rather than the default zip-up", () => {
    const request = { kind: "preorder", productId: "uniform_female" };
    const missing = completePresentationDeal(empty(), request, selection("pre-missing"));
    expect(missing.error).toContain("사이즈");
    const option = MD_DETAIL.uniform_female.options.values[1];
    const result = completePresentationDeal(empty(), request, selection("pre-uniform", { option, qty: 2 }));
    expect(result.error).toBeNull();
    expect(normalizePresentationState(result.next).dealRecords[0]).toMatchObject({ productId: "uniform_female", option, qty: 2, kind: "preorder" });
    expect(result.next.orders).toEqual([]);
    expect(result.next.spent).toBe(0);
  });

  it("uses the FCFS booth's two-item cap independently of the one-item cart cap", () => {
    const request = { kind: "fcfs", productId: "ribbon_keyring" };
    expect(presentationDeal(request).limit).toBe(2);
    const result = completePresentationDeal(empty(), request, selection("fcfs-ribbon", { qty: 2 }));
    expect(result.error).toBeNull();
    const restored = normalizePresentationState(JSON.parse(JSON.stringify(result.next)));
    expect(restored.orders[0]).toMatchObject({ total: 24000, items: [{ id: "ribbon_keyring", qty: 2 }] });
    expect(restored.spent).toBe(24000);
    expect(restored.cart).toEqual([]);
    const replay = completePresentationDeal(restored, request, selection("fcfs-ribbon", { qty: 2 }));
    expect(replay.next).toBe(restored);
    const excess = completePresentationDeal(restored, request, selection("fcfs-extra"));
    expect(excess.error).toBeTruthy();
    expect(excess.next).toBe(restored);
  });

  it("honors required purchase rights and upcoming booths", () => {
    const request = { kind: "fcfs", productId: "radio" };
    expect(completePresentationDeal(empty(), request, selection("radio-locked")).error).toContain("방송실");
    expect(completePresentationDeal(empty(), request, selection("radio-open"), { radioPair: true }).error).toBeNull();
    expect(completePresentationDeal(empty(), { kind: "fcfs", productId: "candle" }, selection("candle")).error).toContain("열리지 않은");
  });

  it("rejects invalid product requests, quantity and timestamps without corrupting state", () => {
    const prior = empty();
    expect(completePresentationDeal(prior, { kind: "preorder", productId: "unknown" }, selection("bad")).next).toBe(prior);
    expect(completePresentationDeal(prior, { kind: "fcfs", productId: "ribbon_keyring" }, selection("bad-qty", { qty: 3 })).error).toBeTruthy();
    expect(completePresentationDeal(prior, { kind: "fcfs", productId: "ribbon_keyring" }, selection("bad-time", { now: Number.MAX_SAFE_INTEGER })).error).toBeTruthy();
  });

  it("normalizes only valid receipts and does not restore multiple entries for one raffle", () => {
    const valid = completePresentationDeal(empty(), { kind: "raffle", referenceId: "rf-uniform-sign" }, selection("one")).receipt;
    expect(normalizeDealRecords([
      null, { id: "bad", kind: {} }, { ...valid, qty: { x: 1 } }, valid,
      { ...valid, id: "second" }, { ...valid, id: "third", product: { name: "unsafe" } },
    ])).toEqual([valid]);
  });
});

describe("shared local deal display totals", () => {
  it("starts from each deal's demo baseline without requiring stored state", () => {
    expect(presentationDealSummary(undefined, { kind: "raffle", referenceId: RAFFLES[0].id })).toMatchObject({ count: 0, entrants: RAFFLES[0].entrants });
    expect(presentationDealSummary(undefined, { kind: "preorder", productId: PREORDER.mdId })).toMatchObject({ count: 0, reservations: PREORDER.count });
    expect(presentationDealSummary(undefined, { kind: "preorder", productId: "uniform_female" })).toMatchObject({ count: 0, reservations: 0 });
    expect(presentationDealSummary(undefined, { kind: "fcfs", productId: FCFS[0].mdId })).toMatchObject({ count: 0, stock: FCFS[0].stock });
    expect(presentationDealSummary(undefined, { kind: "raffle", referenceId: "missing" })).toEqual({ count: 0, remaining: 0, last: null });
  });

  it("adds one entrant only to the joined raffle after duplicate and malformed receipts are filtered", () => {
    const request = { kind: "raffle", referenceId: RAFFLES[0].id };
    const result = completePresentationDeal(empty(), request, selection("summary-raffle"));
    const state = { ...result.next, dealRecords: [...result.next.dealRecords, { ...result.receipt, id: "duplicate" }, { ...result.receipt, id: "malformed", qty: -1 }] };
    expect(presentationDealSummary(state, request)).toEqual({ ...presentationDealProgress(state, request), entrants: RAFFLES[0].entrants + 1 });
    expect(presentationDealSummary(state, { kind: "raffle", referenceId: RAFFLES[1].id }).entrants).toBe(RAFFLES[1].entrants);
  });

  it("counts a person once across multiple reservations and keeps preorder products separate", () => {
    const request = { kind: "preorder", productId: PREORDER.mdId };
    const option = MD_DETAIL[PREORDER.mdId].options.values[0];
    const first = completePresentationDeal(empty(), request, selection("summary-pre-one", { option }));
    const second = completePresentationDeal(first.next, request, selection("summary-pre-two", { option }));
    expect(second.error).toBeNull();
    expect(presentationDealSummary(second.next, request)).toMatchObject({ count: 2, reservations: PREORDER.count + 1 });
    const otherRequest = { kind: "preorder", productId: "uniform_female" };
    expect(presentationDealSummary(second.next, otherRequest).reservations).toBe(0);
    const other = completePresentationDeal(second.next, otherRequest, selection("summary-pre-uniform", { option: MD_DETAIL.uniform_female.options.values[0], qty: 2 }));
    expect(other.error).toBeNull();
    expect(presentationDealSummary(other.next, otherRequest)).toMatchObject({ count: 2, reservations: 1 });
    expect(presentationDealSummary(other.next, request).reservations).toBe(PREORDER.count + 1);
  });

  it("subtracts FCFS purchase quantities from the matching booth and preserves totals on restore", () => {
    const request = { kind: "fcfs", productId: "ribbon_keyring" };
    const first = completePresentationDeal(empty(), request, selection("summary-fcfs-one"));
    const second = completePresentationDeal(first.next, request, selection("summary-fcfs-two"));
    expect(second.error).toBeNull();
    const restored = normalizePresentationState(JSON.parse(JSON.stringify(second.next)));
    expect(presentationDealSummary(restored, request)).toMatchObject({ count: 2, remaining: 0, stock: 84 });
    expect(presentationDealSummary(restored, request)).toEqual(presentationDealSummary(second.next, request));
    expect(presentationDealSummary(restored, { kind: "fcfs", productId: "barricade_stand" }).stock).toBe(145);
    expect(presentationDealSummary(restored, { kind: "preorder", productId: PREORDER.mdId }).reservations).toBe(PREORDER.count);
  });
});

describe("claim and cart storage integration", () => {
  it("keeps an unselected-size prize claim as a pending variant, without inventing a size", () => {
    const restored = normalizePresentationState({
      wins: [{ mdId: "uniform_female", grade: "A", source: "locker", claimedAt: 1788934534000 }],
      orders: [{ id: "od-claim", at: "2026-09-09T00:00:00Z", total: 0, items: [{ id: "uniform_female", qty: 1, win: true }] }],
    });
    expect(restored.wins[0].claimedAt).toBe(1788934534000);
    expect(restored.orders[0].items[0]).toMatchObject({ id: "uniform_female", option: null, win: true });
    const ordinary = normalizePresentationState({ orders: [{ id: "od-purchase", at: "2026-09-09T00:00:00Z", total: 98000, items: [{ id: "uniform_female", qty: 1 }] }] });
    expect(ordinary.orders).toEqual([]);
  });
});
