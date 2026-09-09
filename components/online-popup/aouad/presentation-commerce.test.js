import { describe, expect, it } from "vitest";
import { MD, MD_DETAIL, PURCHASE_SPENT } from "./source/components/aouad/aouad-data";
import {
  addToCart, cartKey, cartLimit, cartRows, cartTotal, getProductPresentationStatus,
  normalizeCart, setCartQty, spentOf,
} from "./source/components/aouad/presentation-commerce";

const goods = (id) => MD.find((item) => item.id === id);
const state = () => ({ cart: [], spent: 0 });
function store(initial = state()) {
  let value = initial;
  return { read: () => value, update: (patch) => { value = patch(value); } };
}

describe("presentation cart variants and limits", () => {
  it("honors the written one-per-person ribbon limit", () => {
    const model = store();
    addToCart(model.update, "ribbon_keyring");
    const once = model.read();
    addToCart(model.update, "ribbon_keyring");
    expect(cartLimit("ribbon_keyring")).toBe(1);
    expect(model.read()).toBe(once);
    expect(cartRows(model.read())).toHaveLength(1);
    expect(cartTotal(model.read())).toBe(goods("ribbon_keyring").price);
  });

  it("requires an explicit valid size without choosing one silently", () => {
    const model = store();
    const before = model.read();
    addToCart(model.update, "hoodie_broadcast");
    addToCart(model.update, "hoodie_broadcast", "unavailable");
    expect(model.read()).toBe(before);
    expect(normalizeCart([{ id: "hoodie_broadcast", qty: 1 }])).toEqual([]);
  });

  it("keeps sizes on separate lines while sharing a per-product cap", () => {
    const [first, second] = MD_DETAIL.hoodie_broadcast.options.values;
    const model = store();
    addToCart(model.update, "hoodie_broadcast", first);
    addToCart(model.update, "hoodie_broadcast", second);
    addToCart(model.update, "hoodie_broadcast", first);
    const full = model.read();
    addToCart(model.update, "hoodie_broadcast", second);
    expect(model.read()).toBe(full);
    expect(model.read().cart).toEqual([
      { id: "hoodie_broadcast", option: first, qty: 2, key: cartKey("hoodie_broadcast", first) },
      { id: "hoodie_broadcast", option: second, qty: 1, key: cartKey("hoodie_broadcast", second) },
    ]);
    expect(cartTotal(model.read())).toBe(goods("hoodie_broadcast").price * cartLimit("hoodie_broadcast"));
  });

  it("clamps a changed size quantity against other sizes and removes only the chosen line", () => {
    const [first, second] = MD_DETAIL.hoodie_broadcast.options.values;
    const model = store();
    addToCart(model.update, "hoodie_broadcast", first);
    addToCart(model.update, "hoodie_broadcast", second);
    setCartQty(model.update, "hoodie_broadcast", 20, first);
    expect(model.read().cart.map((row) => row.qty)).toEqual([2, 1]);
    setCartQty(model.update, "hoodie_broadcast", 0, first);
    expect(model.read().cart).toEqual([{ id: "hoodie_broadcast", option: second, qty: 1, key: cartKey("hoodie_broadcast", second) }]);
  });

  it("ignores unknown products, invalid quantities and irrelevant variants", () => {
    const model = store();
    const before = model.read();
    addToCart(model.update, "unknown");
    addToCart(model.update, "ribbon_keyring", "M");
    setCartQty(model.update, { toString: null, valueOf: null }, 1);
    setCartQty(model.update, "ribbon_keyring", Number.NaN);
    expect(model.read()).toBe(before);
    expect(cartLimit("unknown")).toBe(0);
    expect(cartRows({ cart: [null, {}, { id: "unknown", qty: 1 }, { id: "ribbon_keyring", qty: "3" }] })).toEqual([]);
  });

  it("repairs duplicate stored lines without inflating the product total", () => {
    const option = MD_DETAIL.hoodie_broadcast.options.values[0];
    expect(normalizeCart([
      { id: "hoodie_broadcast", option, qty: 2, md: { price: 1 } },
      { id: "hoodie_broadcast", option, qty: 3 },
    ])).toEqual([{ id: "hoodie_broadcast", option, qty: 3, key: cartKey("hoodie_broadcast", option) }]);
    expect(spentOf({ spent: 12_000 })).toBe(PURCHASE_SPENT + 12_000);
    expect(spentOf({ spent: "12000" })).toBe(PURCHASE_SPENT);
    expect(spentOf({ spent: Infinity })).toBe(PURCHASE_SPENT);
  });
});

describe("presentation product routing", () => {
  it("routes a non-shop uniform to preorder rather than labeling it on sale", () => {
    const item = goods("uniform_female");
    expect(getProductPresentationStatus(item, MD_DETAIL[item.id], {}, [])).toMatchObject({
      label: "사전예약", action: "preorder", target: "preorder",
    });
    const model = store();
    const before = model.read();
    addToCart(model.update, item.id, MD_DETAIL[item.id].options.values[0]);
    expect(model.read()).toBe(before);
  });

  it("distinguishes locked rewards, unlocked rewards, full carts and sold-out stock", () => {
    const item = goods("glass_canteen"), detail = MD_DETAIL[item.id];
    expect(getProductPresentationStatus(item, detail, {}, [])).toMatchObject({ action: "challenge", target: "cafeteria" });
    expect(getProductPresentationStatus(item, detail, { cafeCanteen: true }, [])).toMatchObject({ action: "add", label: "구매권 보유" });
    expect(getProductPresentationStatus(item, { ...detail, stock: 0, supply: "없음" }, {}, [])).toMatchObject({ action: "stock", label: "품절" });
    expect(getProductPresentationStatus(item, { ...detail, stock: 0, supply: "재입고 가능" }, {}, [])).toMatchObject({ action: "notify", label: "품절" });
    const ribbon = goods("ribbon_keyring");
    expect(getProductPresentationStatus(ribbon, MD_DETAIL[ribbon.id], {}, [{ id: ribbon.id, qty: 1 }])).toMatchObject({ action: "full" });
  });

  it("routes limited merchandise and safely handles unknown product data", () => {
    const item = goods("virus_journal");
    expect(getProductPresentationStatus(item, MD_DETAIL[item.id], {}, [])).toMatchObject({ action: "fcfs", target: "fcfs" });
    expect(getProductPresentationStatus(null, null)).toMatchObject({ action: "notify", target: "store" });
  });
});
