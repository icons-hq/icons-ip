import { describe, expect, it } from 'vitest';
import { parseFulfillmentOriginInput } from './fulfillment-origins';

describe('origin settings input', () => {
  it('accepts explicit zero fees and absent free thresholds, and bounds invalid values', () => {
    const input={code:'gimpo',name:' 김포 ',defaultCarrier:'hanjin',baseFee:'0',freeThreshold:'',returnAddress:' 창고 주소 ',cutoff:'17:30',exportTemplate:'wms_csv',active:'true'};
    expect(parseFulfillmentOriginInput(input)).toMatchObject({ok:true,value:{name:'김포',base_fee:0,free_threshold:null,return_address:'창고 주소',is_active:true}});
    expect(parseFulfillmentOriginInput({...input,baseFee:'-1'})).toMatchObject({ok:false,errors:{baseFee:expect.any(String)}});
    expect(parseFulfillmentOriginInput({...input,cutoff:'25:80',defaultCarrier:''})).toMatchObject({ok:false,errors:{cutoff:expect.any(String),defaultCarrier:expect.any(String)}});
  });
});
