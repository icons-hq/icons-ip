import { describe, expect, it } from 'vitest';
import { GOODS_DRAFT_INVALID_VALUES_MESSAGE, GOODS_DRAFT_MAX_BYTES, collectGoodsDraftValues, goodsDraftError, goodsDraftIdentity, parseGoodsDraft, parseGoodsDraftPage, validateGoodsDraftValues } from './goods-drafts';
import { GOOD_LOCAL_DRAFT_FIELDS, createGoodEditorDraft } from './good-editor';
const id='76000000-0000-4000-8000-000000000001';
const summary={id,name:'미완성 상품',imagePath:null,revision:2,updatedAt:'2026-10-13T01:00:00Z',archived:false,completedGoodId:null};
describe('server registration drafts',()=>{
  it('keeps incomplete inputs and excludes account/internal values',()=>{
    const values=collectGoodsDraftValues([['name','미완성 상품'],['price','아직 미정'],['description','<h2>원문</h2>'],['email','private@example.test'],['$ACTION_ID_x','private'],['serverDraftId',id]]);
    expect(values).toEqual({name:'미완성 상품',price:'아직 미정',description:'<h2>원문</h2>'});
    expect(validateGoodsDraftValues(values)).toBe(true);
    expect(validateGoodsDraftValues({...values,email:'private@example.test'})).toBe(false);
    expect(validateGoodsDraftValues({...values,price:500})).toBe(false);
    expect(validateGoodsDraftValues({...values,imagePath:'blob:temporary'})).toBe(false);
    expect(validateGoodsDraftValues({...values,variantBaseline:'["existing-option"]'})).toBe(false);
    /* R17: 상세 HTML 상한(200,000자, 한글 약 600KB)을 담은 작성 내용도 서버 임시저장된다. 상한은 2MB(DB와 같다). */
    expect(GOODS_DRAFT_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(validateGoodsDraftValues({...values,descriptionFormat:'html',description:'한'.repeat(200000)})).toBe(true);
    expect(validateGoodsDraftValues({...values,description:'한'.repeat(800000)})).toBe(false);
  });
  /* 리뷰 재현(T3B-RV-3): 상한을 2MB로 올린 뒤에도 거절 문구가 '입력 크기(512KB)'라 운영자에게 사실과 다른 상한을 안내했다. */
  it('거절 문구의 입력 크기 상한은 실제 상한(GOODS_DRAFT_MAX_BYTES)에서 만든다',()=>{
    expect(GOODS_DRAFT_INVALID_VALUES_MESSAGE).toBe('상품명을 1~100자로 입력하고 등록 중인 상품의 입력 크기(2MB)와 이미지 업로드 상태를 확인해주세요.');
    expect(GOODS_DRAFT_INVALID_VALUES_MESSAGE).not.toContain('512KB');
  });
  it('restores selected draft with its identity and option payload, without confusing it with a saved product',()=>{
    expect(GOOD_LOCAL_DRAFT_FIELDS).toEqual(expect.arrayContaining(['serverDraftId','serverDraftRevision']));
    const loaded=createGoodEditorDraft(null,{values:{previousId:'',name:'미완성 상품',serverDraftId:id,serverDraftRevision:'2',optionAxisName2:'포장',optionAxisValues2:'기본, 선물'}},[]);
    expect(loaded.initial).toMatchObject({name:'미완성 상품',id:'',serverDraftId:id,serverDraftRevision:'2',optionAxisName2:'포장'});
    const form=new FormData(); expect(goodsDraftIdentity(form)).toBeNull();
    form.set('serverDraftId',id);expect(goodsDraftIdentity(form)).toBe('invalid');
    form.set('serverDraftRevision','2');expect(goodsDraftIdentity(form)).toEqual({id,revision:2});
  });
  it('rejects malformed readbacks instead of rendering false empty/saved states',()=>{
    expect(parseGoodsDraft({...summary,values:{name:'미완성 상품'}})?.revision).toBe(2);
    expect(parseGoodsDraft({...summary,values:{name:'미완성 상품',password:'bad'}})).toBeNull();
    expect(parseGoodsDraftPage({rows:[summary],total:1,page:1,pageSize:20})?.rows).toEqual([summary]);
    expect(parseGoodsDraftPage({rows:[{...summary,revision:0}],total:1,page:1,pageSize:20})).toBeNull();
  });
  /* QA2: 웨이브 2의 반품/교환지 id가 서버 임시저장 값에 실리는데 DB 허용 키에 없어 [임시저장]이 매번 실패했다. 키는 DB 허용 키와 같아야 한다. */
  it('반품/교환지 id는 서버 임시저장 값에 실린다',()=>{
    const values=collectGoodsDraftValues([['name','상품'],['claimReturnAddressId',id],['unknown','x']]);
    expect(values).toEqual({name:'상품',claimReturnAddressId:id});
    expect(validateGoodsDraftValues(values)).toBe(true);
  });
  it('DB가 값을 거절하면 원인 코드를 보이고 입력 유지 안내를 남긴다',()=>{
    expect(goodsDraftError('invalid_goods_draft')).toContain('invalid_goods_draft');
    expect(goodsDraftError('some_new_error')).toContain('원인 코드 some_new_error');
    expect(goodsDraftError('goods_draft_limit')).toContain('최대 40건');
    expect(goodsDraftError(undefined)).not.toContain('원인 코드');
  });
});
