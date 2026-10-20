import { STORE_ANALYTICS_NOTICE_VERSION } from './store-analytics';
/** A separately versioned, prepared notice. Never replace an older text in place. */
export const STORE_ANALYTICS_NOTICE = {
 version: STORE_ANALYTICS_NOTICE_VERSION,
 title:'방문 통계 이용 안내',
 summary:'공개 화면의 이용과 마케팅 링크 성과를 살펴 서비스를 개선하기 위한 선택사항입니다.',
 sections:[
  {title:'수집하는 항목',text:'공개 화면 유형과 굿즈·IP·분류 등의 식별번호, 알려진 유입 경로 구분, 마케팅 링크 번호, 관측 시각, 짧은 임의 방문 세션을 기록합니다. 같은 방문에서 만든 주문은 결제 전환 확인을 위해 주문번호로 연결합니다.'},
  {title:'수집하지 않는 항목',text:'이 방문 통계 원장에는 회원번호·이메일·이름·IP 주소·브라우저 정보·전체 주소(URL)·검색어를 저장하지 않습니다. 외부 분석서비스로 전송하지 않으며 마케팅 정보 수신 동의와 별개입니다.'},
  {title:'보관과 방문 구분',text:'원자료와 주문 연결은 한국 날짜 기준 최근 90일, 개인·세션·주문을 식별할 수 없는 일별 합계는 13개월 보관합니다. 30분간 활동이 없거나 한국 날짜가 바뀌면 새 방문이며, 한 세션은 최대 24시간입니다. 이 브라우저의 선택은 180일 동안 유지합니다.'},
  {title:'선택과 철회',text:'거부해도 공개 화면과 구매를 이용할 수 있습니다. 언제든 방문 통계 설정에서 철회할 수 있으며, 즉시 추가 수집·주문 연결을 중단하고 현재 세션의 원자료와 주문 연결을 삭제합니다. 이미 식별정보를 없앤 보존 합계는 개인별로 구분하거나 되돌리지 않습니다.'},
 ]
} as const;
