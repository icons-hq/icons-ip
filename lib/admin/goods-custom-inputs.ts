import { GOODS_CUSTOM_INPUT_LIMIT, GOODS_CUSTOM_INPUT_NAME_LIMIT, parseGoodsCustomInputConfig } from '@/lib/goods-custom-inputs';

export function readAdminGoodsCustomInputs(form: FormData):
  { ok:true; fields:Record<string,unknown> } | { ok:false; error:string } {
  if (!form.has('customInputs')) return { ok:true,fields:{} };
  try {
    const draft = JSON.parse(String(form.get('customInputs')));
    const revisionText = String(form.get('customInputsExpectedRevision') ?? '');
    if (!/^(0|[1-9][0-9]*)$/.test(revisionText)) throw new Error();
    const config = parseGoodsCustomInputConfig({ ...draft, revision:Number(revisionText),
      fields:Array.isArray(draft.fields) ? draft.fields.map((field: Record<string,unknown>) => ({...field,name:typeof field.name==='string'?field.name.trim():field.name}))
        .filter((field: Record<string,unknown>) => draft.enabled || field.name) : draft.fields });
    if (!config) throw new Error();
    return { ok:true,fields:{ custom_inputs:{ enabled:config.enabled,fields:config.fields },custom_inputs_expected_revision:config.revision } };
  } catch {
    return { ok:false,error:`직접입력형 옵션명은 서로 다른 ${GOODS_CUSTOM_INPUT_NAME_LIMIT}자 이하 이름으로 최대 ${GOODS_CUSTOM_INPUT_LIMIT}개까지 입력해주세요. 설정함에는 사용 중인 항목이 하나 이상 필요합니다.` };
  }
}
