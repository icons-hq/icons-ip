import { describe, expect, it } from 'vitest';
import { collectGoodsDraftValues, goodsDraftIdentity, parseGoodsDraft, parseGoodsDraftPage, validateGoodsDraftValues } from './goods-drafts';
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
    expect(validateGoodsDraftValues({...values,description:'한'.repeat(180000)})).toBe(false);
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
});
