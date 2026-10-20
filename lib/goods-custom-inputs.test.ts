import { describe, expect, it } from 'vitest';
import { aggregateCartVariantQuantities, cartItemKey, normalizeCartItems, parseStoredCart, serializeCart, setCartItemQuantity } from './cart';
import { parseCartAdditionRequest, prepareCartAddition } from './cart-additions';
import { goodsCustomInputIdentity, goodsCustomInputProblem, goodsCustomInputValues, parseGoodsCustomInputFields, parseGoodsCustomInputSelection, prepareGoodsCustomInputSelection } from './goods-custom-inputs';
import { readAdminGoodsCustomInputs } from './admin/goods-custom-inputs';

const ID='00000000-0000-4000-8000-000000063311';
const SECOND='00000000-0000-4000-8000-000000063312';
const VARIANT='00000000-0000-4000-8000-000000063310';
const config={enabled:true,revision:2,fields:[{id:ID,name:'각인 문구',active:true},{id:SECOND,name:'안 쓰는 항목',active:false}]};
const selection=(value:string)=>({revision:2,fields:[{id:ID,name:'각인 문구',value}]});
const a=selection('ALPHA');const b=selection('BETA');

describe('직접입력형 정의와 값',()=>{
  it('최대 5개·25자·중복 식별자/이름과 사용 항목을 검증한다',()=>{
    expect(parseGoodsCustomInputFields(config.fields)).toEqual(config.fields);
    expect(parseGoodsCustomInputFields([...config.fields,config.fields[0]])).toBeNull();
    expect(parseGoodsCustomInputFields([{...config.fields[0],name:'a'.repeat(26)}])).toBeNull();
    expect(parseGoodsCustomInputFields(Array.from({length:6},(_,i)=>({id:`00000000-0000-4000-8000-00000006332${i}`,name:`항목${i}`,active:true})))).toBeNull();
    const form=new FormData();form.set('customInputsExpectedRevision','2');form.set('customInputs',JSON.stringify({enabled:true,fields:config.fields}));
    expect(readAdminGoodsCustomInputs(form)).toMatchObject({ok:true,fields:{custom_inputs_expected_revision:2,custom_inputs:{fields:config.fields}}});
    form.set('customInputs',JSON.stringify({enabled:true,fields:config.fields.map(field=>({...field,active:false}))}));
    expect(readAdminGoodsCustomInputs(form).ok).toBe(false);
  });
  it('공백을 정리하고 필수 값·100글자·제어문자·정의 변경을 검사한다',()=>{
    expect(prepareGoodsCustomInputSelection(config,{[ID]:' ALPHA '})).toEqual({ok:true,selection:a});
    expect(prepareGoodsCustomInputSelection(config,{}).ok).toBe(false);
    expect(prepareGoodsCustomInputSelection(config,{[ID]:'😀'.repeat(100)}).ok).toBe(true);
    expect(prepareGoodsCustomInputSelection(config,{[ID]:'😀'.repeat(101)}).ok).toBe(false);
    expect(parseGoodsCustomInputSelection(selection('한줄\n두줄'))).toBeNull();
    expect(goodsCustomInputProblem(config,a)).toBeNull();
    expect(goodsCustomInputProblem({...config,revision:3},a)).toContain('다시 확인');
    expect(goodsCustomInputProblem({...config,enabled:false},a)).toContain('변경');
  });
  it('항목 순서·표시 이름은 cart identity에 영향을 주지 않고 입력값·revision은 구분한다',()=>{
    const both={revision:2,fields:[...a.fields,{id:SECOND,name:'받는 이',value:'친구'}]};
    expect(goodsCustomInputIdentity(both)).toBe(goodsCustomInputIdentity({...both,fields:[...both.fields].reverse()}));
    expect(goodsCustomInputIdentity(a)).toBe(goodsCustomInputIdentity({...a,fields:[{...a.fields[0],name:'다른 표시'}]}));
    expect(goodsCustomInputIdentity(a)).not.toBe(goodsCustomInputIdentity(b));
    expect(goodsCustomInputIdentity(a)).not.toBe(goodsCustomInputIdentity({...a,revision:3}));
    expect(goodsCustomInputValues(a)).toEqual({[ID]:'ALPHA'});
  });
});

describe('입력값별 장바구니 행',()=>{
  const items=[{goodId:'good',variantId:VARIANT,qty:1,customInputs:a},{goodId:'good',variantId:VARIANT,qty:2,customInputs:b}];
  it('다른 문구를 v3 저장/복구에서 보존하고 같은 행만 수정·삭제한다',()=>{
    expect(parseStoredCart(serializeCart(items))).toEqual(items);
    expect(normalizeCartItems([...items,{...items[0],qty:3}])).toEqual([{...items[0],qty:3},items[1]]);
    expect(setCartItemQuantity(items,'good',0,VARIANT)).toEqual(items);
    expect(setCartItemQuantity(items,'good',0,VARIANT,a)).toEqual([items[1]]);
    expect(setCartItemQuantity(items,'good',4,VARIANT,b)).toEqual([items[0],{...items[1],qty:4}]);
    expect(cartItemKey('good',VARIANT,a)).not.toBe(cartItemKey('good',VARIANT,b));
    expect(aggregateCartVariantQuantities(items)).toEqual([{goodId:'good',variantId:VARIANT,qty:3}]);
  });
  it('잘못된 문구를 입력 없는 일반 행으로 조용히 바꾸지 않는다',()=>{
    expect(normalizeCartItems([{...items[0],customInputs:{...a,fields:[]}}])).toEqual([]);
    expect(parseCartAdditionRequest([{...items[0],customInputs:{...a,fields:[]},expectedQty:0}])).toBeNull();
  });
  it('행별 기대 수량을 유지하면서 같은 variant의 모든 문구를 합쳐 재고를 확인한다',()=>{
    expect(prepareCartAddition(items,[{...items[0],qty:1,stockQty:3}])).toEqual({ok:false,reason:'stock'});
    const result=prepareCartAddition(items,[{...items[0],qty:1,stockQty:4}]);
    expect(result).toEqual({ok:true,items:[{...items[0],qty:2},items[1]],entries:[{...items[0],expectedQty:1}]});
    expect(parseCartAdditionRequest(items.map(item=>({...item,expectedQty:0})))).toHaveLength(2);
    expect(prepareCartAddition([],[{...items[0],stockQty:2},{...items[1],stockQty:2}])).toEqual({ok:false,reason:'stock'});
  });
});
