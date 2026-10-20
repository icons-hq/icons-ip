# ICONS 국가·지역명 입력 사전 원본

CLDR 48.2 / CLDR JSON 48.2.0 공식 파일을 그대로 보관한다. 원본 URL과 SHA-256은 [source.json](source.json), 사용 조건은 [LICENSE](LICENSE)에 있다. UI는 이 디렉터리 전체를 불러오지 않고 `lib/admin/country-names-data.json`의 249개 항목만 사용한다.

`region.xml`의 regular 두 글자 코드 중 `codeMappings.json`에 alpha-3 및 900 미만 numeric 매핑이 있는 항목을 추출했다. 제외한 regular 코드는 `AC CP CQ DG EA IC TA XK`다. 한국어 기본명을 적용값으로, 한국어·영어 기본/대체명과 코드를 검색에만 쓴다. 코드나 사전 갱신으로 기존 상품 문자열을 변경하지 않는다.

저장소 루트에서 `python3 scripts/generate-country-names.py`로 재생성한다. 네트워크를 사용하지 않으며 원본과 생성 결과의 SHA가 manifest와 다르면 중단한다. 고정 버전을 바꿀 때는 원본·라이선스·추출 목록·행 수·생성 해시를 검토한 뒤 manifest를 갱신한다. 실행 중 자동 갱신은 하지 않는다.

브라우저 배포 라이선스는 `public/licenses/unicode-cldr-48.2.0.txt`에 원문 그대로 복사한다. 설계와 실제 검증은 [조사 문서](../../../docs/research/smartstore-admin/origin-country-finder-proposal.md)에 기록한다.
