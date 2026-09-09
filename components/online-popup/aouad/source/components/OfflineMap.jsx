"use client";

/* 오프라인 안내 모듈의 지도 — 일러스트 약도 (인계서 §3.0-2 필드5)
 *
 * 지도 API 를 쓰지 않는다: 키·외부 호스트가 필요하고 CSP 표면이 열린다.
 * 실제 팝업 포스터가 쓰는 문법이 일러스트 약도이므로 같은 문법으로 그린다.
 * 좌표는 실제 축척이 아니라 **읽기 위한 배치**다 — 역·출구·큰길·목적지·도보 시간.
 *
 * props 로 팝업별 값을 받아 다른 IP 에서도 그대로 쓴다(계약 확장성).
 */
export default function OfflineMap({
  station = "성수역",
  line = "2",
  lineColor = "#00a84d",
  exit = "3번 출구",
  streets = ["연무장길", "아차산로"],
  venue = "효산고 세트",
  walk = "도보 6분",
  accent = "#ff8a3d",
}) {
  return (
    <svg viewBox="0 0 480 208" style={{ display: "block", width: "100%", height: "auto" }} role="img"
         aria-label={`${line}호선 ${station} ${exit}에서 ${venue}까지 ${walk}`}>
      <rect x="0" y="0" width="480" height="208" rx="10" fill="#0e1118" />

      {/* 큰길 2 — 가로·세로 */}
      <rect x="0" y="86" width="480" height="26" fill="#1a1f2b" />
      <rect x="300" y="0" width="22" height="208" fill="#1a1f2b" />
      <line x1="0" y1="99" x2="480" y2="99" stroke="#2a3040" strokeWidth="1.5" strokeDasharray="10 8" />
      <line x1="311" y1="0" x2="311" y2="208" stroke="#2a3040" strokeWidth="1.5" strokeDasharray="10 8" />
      <text x="14" y="80" fill="#5f6672" fontSize="10">{streets[1]}</text>
      <text x="328" y="24" fill="#5f6672" fontSize="10">{streets[0]}</text>

      {/* 골목 — 목적지로 들어가는 길 */}
      <path d="M311 150 L410 150" stroke="#1a1f2b" strokeWidth="14" strokeLinecap="round" />

      {/* 지하철 노선 */}
      <line x1="0" y1="46" x2="480" y2="46" stroke={lineColor} strokeWidth="6" strokeLinecap="round" opacity=".85" />

      {/* 역 */}
      <g>
        <circle cx="110" cy="46" r="12" fill="#0e1118" stroke={lineColor} strokeWidth="4" />
        <text x="110" y="28" fill="#e8e4da" fontSize="12" fontWeight="700" textAnchor="middle">{station}</text>
        <text x="110" y="70" fill={lineColor} fontSize="9.5" fontWeight="700" textAnchor="middle">{line}호선</text>
      </g>

      {/* 출구 */}
      <g>
        <rect x="146" y="72" width="66" height="21" rx="5" fill="#0e1118" stroke="#3a4152" />
        <text x="179" y="87" fill="#9a958a" fontSize="10.5" textAnchor="middle">{exit}</text>
      </g>

      {/* 도보 경로 — 출구 → 큰길 → 골목 → 목적지 */}
      <path d="M179 93 L179 99 L311 99 L311 150 L392 150"
            fill="none" stroke={accent} strokeWidth="2.5" strokeDasharray="7 6" strokeLinecap="round" />
      {/* 도보 시간 라벨 */}
      <g>
        <rect x="212" y="86" width="62" height="20" rx="10" fill="#0e1118" stroke={accent} strokeOpacity=".5" />
        <text x="243" y="100" fill={accent} fontSize="10.5" fontWeight="700" textAnchor="middle">{walk}</text>
      </g>

      {/* 목적지 핀 */}
      <g>
        <path d="M410 150 c0-11 -9-19 -18-19 s-18 8 -18 19 c0 13 18 28 18 28 s18-15 18-28z"
              fill={accent} />
        <circle cx="392" cy="149" r="6" fill="#0e1118" />
        <rect x="330" y="182" width="124" height="20" rx="6" fill="#0e1118" stroke={accent} strokeOpacity=".55" />
        <text x="392" y="196" fill={accent} fontSize="11" fontWeight="700" textAnchor="middle">{venue}</text>
      </g>

      {/* 방위 */}
      <g opacity=".55">
        <circle cx="452" cy="30" r="15" fill="none" stroke="#3a4152" />
        <path d="M452 19 L456 31 L452 28 L448 31 Z" fill="#9a958a" />
        <text x="452" y="44" fill="#5f6672" fontSize="8" textAnchor="middle">N</text>
      </g>
    </svg>
  );
}
