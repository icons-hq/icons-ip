import { GOODS_CUSTOM_INPUT_VALUE_LIMIT, type GoodsCustomInputConfig, type GoodsCustomInputSelection } from '@/lib/goods-custom-inputs';

export function GoodsCustomInputsFields({ goodId, config, values = {}, disabled, onChange }: {
  goodId:string;config?:GoodsCustomInputConfig;values?:Record<string,string>;disabled?:boolean;onChange?:(id:string,value:string)=>void;
}) {
  if (!config?.enabled) return null;
  return <fieldset className="wc-custom-inputs" disabled={disabled}>
    <legend>직접 입력 옵션</legend>
    {config.fields.filter(field=>field.active).map(field=><label key={field.id} htmlFor={`good-custom-${goodId}-${field.id}`}>
      <span>{field.name} <small>(필수)</small></span>
      <input id={`good-custom-${goodId}-${field.id}`} maxLength={GOODS_CUSTOM_INPUT_VALUE_LIMIT*2} value={values[field.id] ?? ''}
        onChange={event=>onChange?.(field.id,[...event.target.value].slice(0,GOODS_CUSTOM_INPUT_VALUE_LIMIT).join(''))} autoComplete="off" required />
      <small>{[...(values[field.id] ?? '')].length}/{GOODS_CUSTOM_INPUT_VALUE_LIMIT}자</small>
    </label>)}
    <p>입력한 내용이 주문에 그대로 기록됩니다. 연락처나 이메일은 입력하지 마세요.</p>
  </fieldset>;
}

export function GoodsCustomInputsSummary({ selection }: {selection?:GoodsCustomInputSelection|null}) {
  if (!selection) return null;
  return <dl className="wc-custom-inputs-summary">{selection.fields.map(field=><div key={field.id}><dt>{field.name}</dt><dd>{field.value}</dd></div>)}</dl>;
}
