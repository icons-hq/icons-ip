import { describe, expect, it } from 'vitest';
import { goodsAttributeRows, parseGoodsAttributeDocument, parseGoodsAttributeFields, parseGoodsAttributeSchema, parseGoodsAttributeSubmission, validGoodsAttributeValue, type GoodsAttributeField } from './goods-attributes';
import { readGoodsAttributeSubmission } from './admin/goods-attributes';
import { collectGoodsDraftValues, validateGoodsDraftValues } from './admin/goods-drafts';
const id='71350000-0000-4000-8000-000000000001'; const choice='71350000-0000-4000-8000-000000000002';
const field: GoodsAttributeField={id,name:'높이',kind:'number',required:true,unit:'cm',options:[]};
describe('독립 상품속성 계약',()=>{
  it('정의 순서·고정 ID·종류와 사전만 허용한다',()=>{
    expect(parseGoodsAttributeFields([field])).toEqual([field]);
    for(const value of [[field,field],[{...field,name:'\t'}],[{...field,unit:' cm'}],[{...field,extra:true}],[{...field,kind:'text'}],[{...field,kind:'single',unit:''}], [{...field,kind:'multi',unit:'',options:[{id:choice,label:'빨강'},{id:choice,label:'파랑'}]}]]) expect(parseGoodsAttributeFields(value)).toBeNull();
    expect(parseGoodsAttributeSchema({categoryId:id,revision:0,fields:[]})).not.toBeNull();
  });
  it('숫자는 서버와 같은 소수6자리 및 유한 범위이며 공백 텍스트를 거절한다',()=>{
    for(const n of [0,-1.234567,0.1,1000000000]) expect(validGoodsAttributeValue(field,n)).toBe(true);
    for(const n of [0.0000000001,1.1234567,NaN,Infinity,1000000001,'123']) expect(validGoodsAttributeValue(field,n)).toBe(false);
    expect(validGoodsAttributeValue({...field,kind:'text',unit:''},'\u00a0')).toBe(false);
    expect(validGoodsAttributeValue({...field,kind:'text',unit:''},'정상 정보')).toBe(true);
  });
  it('선택은 정의된 ID만 허용하고 복수 값 중복을 거절한다',()=>{
    const select={...field,kind:'single' as const,unit:'',options:[{id:choice,label:'아크릴'}]};
    expect(validGoodsAttributeValue(select,choice)).toBe(true);expect(validGoodsAttributeValue(select,'아크릴')).toBe(false);
    expect(validGoodsAttributeValue({...select,kind:'multi'},[choice])).toBe(true);expect(validGoodsAttributeValue({...select,kind:'multi'},[choice,choice])).toBe(false);
  });
  it('과거 snapshot은 읽되 현재 정의와 맞지 않는 값은 공개표에서 제외한다',()=>{
    const document={revision:3,entries:[{field,value:2.5}]};expect(parseGoodsAttributeDocument(document)).toEqual(document);
    expect(goodsAttributeRows({categoryId:id,revision:8,fields:[{...field,name:'전체 높이'}]},document)).toEqual([{id,name:'전체 높이',value:'2.5 cm'}]);
    expect(goodsAttributeRows({categoryId:id,revision:8,fields:[{...field,unit:'mm'}]},document)).toEqual([]);
    expect(goodsAttributeRows(null,document)).toEqual([]);
  });
  it('생략과 명시삭제를 구분하고 미완성 입력을 서버draft에 보관한다',()=>{
    const form=new FormData();expect(readGoodsAttributeSubmission(form)).toEqual({ok:true,fields:{}});
    const payload={categoryId:id,schemaRevision:2,expectedRevision:0,values:{[id]:null},removeIds:[choice]};
    expect(parseGoodsAttributeSubmission(payload)).toEqual(payload);expect(parseGoodsAttributeSubmission({...payload,expectedRevision:-1})).toBeNull();
    form.set('productAttributes',JSON.stringify(payload));form.set('productAttributeDraft','[{"unfinished":"number"}]');form.set('name','새 상품');
    expect(readGoodsAttributeSubmission(form)).toEqual({ok:true,fields:{product_attributes:payload}});
    const draft=collectGoodsDraftValues(form);expect(draft.productAttributeDraft).toContain('unfinished');expect(validateGoodsDraftValues(draft)).toBe(true);
    form.set('productAttributes','');expect(readGoodsAttributeSubmission(form).ok).toBe(false);
  });
});
