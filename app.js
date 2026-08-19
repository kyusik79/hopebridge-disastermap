const svg = d3.select("#map");

const mapWrap = document.getElementById("map-wrap");
const loadingEl = document.getElementById("map-loading");
const errorEl = document.getElementById("map-error");

const DATA_FILE = "data/disaster_map_data.xlsx";
const MAP_URL =
  "https://cdn.jsdelivr.net/gh/southkorea/southkorea-maps@master/gadm/json/skorea-municipalities-geo.json";

let workbook = null;
let boundaries = null;
let disasterConfigs = [];
let currentConfig = null;
let currentData = null;
let activeMetric = null;
let width = 900;
let height = 760;
let autoZoomEnabled = true;
let autoZoomOutliers = [];
let autoZoomMainCluster = [];
let photos = [];
let currentPhotoGallery = [];
let currentPhotoIndex = 0;

const fmt = new Intl.NumberFormat("ko-KR");

const zoom = d3.zoom()
  .scaleExtent([1, 8])
  .on("zoom", event => {
    /*
      지도만 확대하고 버블·숫자·지역명은 화면상 크기를 유지합니다.
      버블은 실제 위치에서 조금 이동될 수 있으므로 displayX/displayY를 사용합니다.
    */
    svg.select(".map-root")
      .attr("transform", event.transform);

    const k = event.transform.k || 1;

    svg.selectAll(".bubble-point")
      .attr(
        "transform",
        d => `translate(${d.displayX ?? d.x},${d.displayY ?? d.y}) scale(${1 / k})`
      );

    svg.selectAll(".bubble-label-point")
      .attr(
        "transform",
        d => `translate(${d.displayX ?? d.x},${d.displayY ?? d.y}) scale(${1 / k})`
      );
  });

svg.call(zoom);

/* -------------------------------------------------
   지도 좌표 사전
   - 폭염: 시도 대표좌표
   - 호우/가상데이터: 시군구·지점 대표좌표
------------------------------------------------- */

const LOCATION_POINTS = {
  "서울": [126.9780, 37.5665],
  "부산": [129.0756, 35.1796],
  "대구": [128.6014, 35.8714],
  "인천": [126.7052, 37.4563],
  "광주": [126.8526, 35.1595],
  "대전": [127.3845, 36.3504],
  "울산": [129.3114, 35.5384],
  "세종": [127.2890, 36.4800],
  "경기": [127.0095, 37.4138],
  "강원": [128.3115, 37.8228],
  "충북": [127.7298, 36.6357],
  "충남": [126.8000, 36.5184],
  "전북": [127.1530, 35.7175],
  "전남": [126.9910, 34.8679],
  "경북": [128.8889, 36.4919],
  "경남": [128.2132, 35.4606],
  "제주": [126.5312, 33.4996],
  "전남광주": [126.9250, 35.0800],

  "경남 거제": [128.6211, 34.8806],
  "경남 거제시": [128.6211, 34.8806],
  "경남 통영": [128.4330, 34.8544],
  "경남 통영시": [128.4330, 34.8544],
  "경남 사천": [128.0642, 35.0038],
  "경남 사천시": [128.0642, 35.0038],
  "경남 고성": [128.3225, 34.9731],
  "경남 산청군": [127.8732, 35.4154],
  "경남 양산시": [129.0372, 35.3350],

  "부산 가덕도": [128.8299, 35.0502],
  "부산 기장군": [129.2223, 35.2446],
  "부산 금정구": [129.0921, 35.2430],

  "제주 성산": [126.9100, 33.4500],
  "제주 서귀포시": [126.5601, 33.2541],

  "울산 울주군": [129.2420, 35.5223],
  "울산 북구": [129.3612, 35.5827],

  "전남 여수시": [127.6622, 34.7604],
  "전남 순천시": [127.4872, 34.9506],

  "경북 의성군": [128.6970, 36.3527],
  "경북 봉화군": [128.7327, 36.8930],
  "경북 경주시": [129.2247, 35.8562],

  "강원 삼척시": [129.1651, 37.4499],
  "강원 평창군": [128.3900, 37.3707],

  "충북 영동군": [127.7834, 36.1750],
  "충북 제천시": [128.1909, 37.1326],

  "전북 무주군": [127.6608, 36.0070],

  "경기 포천시": [127.2003, 37.8949],

  "대구 동구": [128.6356, 35.8868]
};

function numberValue(v) {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = Number(String(v).replaceAll(",", "").trim());
  return Number.isFinite(n) ? n : null;
}

function excelDateToText(v) {
  if (v === null || v === undefined || v === "" || v === "-") return "-";

  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }

  if (typeof v === "number") {
    const p = XLSX.SSF.parse_date_code(v);
    if (p) {
      return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
    }
  }

  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  return s;
}

function cleanKey(s) {
  return String(s ?? "")
    .replace(/\s+/g, "")
    .replace(/\(.*?\)/g, "")
    .trim();
}

function findMatchingHeader(headers, metricName) {
  const target = cleanKey(metricName);

  return headers.find(h => {
    const key = cleanKey(h);
    return key === target || key.startsWith(target) || target.startsWith(key);
  }) || null;
}

async function fetchArrayBuffer(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path} 로드 실패 (${r.status})`);
  return await r.arrayBuffer();
}

async function fetchJson(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`지도 데이터 로드 실패 (${r.status})`);
  return await r.json();
}

async function tryLoadPhotos() {
  try {
    const r = await fetch("data/photos.csv", { cache: "no-store" });
    if (!r.ok) return [];
    return d3.csvParse(await r.text()).filter(d => String(d.file || "").trim());
  } catch {
    return [];
  }
}

async function init() {
  try {
    const [xlsxBuffer, mapJson, photoRows] = await Promise.all([
      fetchArrayBuffer(DATA_FILE),
      fetchJson(MAP_URL),
      tryLoadPhotos()
    ]);

    workbook = XLSX.read(xlsxBuffer, {
      type: "array",
      cellDates: true
    });

    boundaries = mapJson;
    photos = photoRows;

    disasterConfigs = parseConfigSheet();
    buildDisasterSelect();

    if (!disasterConfigs.length) {
      throw new Error("01_재해설정 시트에서 재해 설정을 찾지 못했습니다.");
    }

    loadingEl.classList.add("hidden");

    const defaultDisaster =
      disasterConfigs.find(c => c.disaster === "호우")?.disaster
      || disasterConfigs[0].disaster;

    selectDisaster(defaultDisaster);

    window.addEventListener(
      "resize",
      debounce(() => {
        if (currentData) {
          resize();
        }
      }, 120)
    );

  } catch (error) {
    console.error(error);
    loadingEl.classList.add("hidden");
    errorEl.classList.remove("hidden");
    errorEl.innerHTML = `
      <strong>데이터를 불러오지 못했습니다.</strong>
      <div style="margin-top:10px">${error.message}</div>
      <div style="margin-top:8px;font-size:12px">
        data/disaster_map_data.xlsx 파일과 인터넷 연결을 확인해 주세요.
      </div>
    `;
  }
}

function parseConfigSheet() {
  const ws = workbook.Sheets["01_재해설정"];
  if (!ws) return [];

  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null
  });

  const headerIndex = rows.findIndex(
    r => String(r?.[0] || "").trim() === "재해구분"
  );

  if (headerIndex < 0) return [];

  const headers = rows[headerIndex].map(x => String(x ?? "").trim());

  return rows
    .slice(headerIndex + 1)
    .filter(r => r?.[0])
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = r[i]);

      return {
        disaster: String(obj["재해구분"] || "").trim(),
        sheet: String(obj["시트명"] || obj["재해구분"] || "").trim(),
        dataType: String(obj["자료구분"] || "").trim(),
        mapUnit: String(obj["지도단위"] || "").trim(),
        primaryMetric: String(obj["기본 원형지표"] || "").trim(),
        unit: String(obj["단위"] || "").trim(),
        secondary1: String(obj["보조지표1"] || "").trim(),
        secondary2: String(obj["보조지표2"] || "").trim(),
        note: String(obj["비고"] || "").trim()
      };
    });
}

function buildDisasterSelect() {
  const select = document.getElementById("disaster-select");
  select.innerHTML = "";

  disasterConfigs.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.disaster;
    opt.textContent = c.disaster;
    select.appendChild(opt);
  });

  select.addEventListener("change", () => {
    selectDisaster(select.value);
  });
}

function selectDisaster(disasterName) {
  currentConfig = disasterConfigs.find(c => c.disaster === disasterName);
  if (!currentConfig) return;

  currentData = parseDisasterSheet(currentConfig);

  activeMetric = currentData.primaryHeader;

  document.getElementById("disaster-select").value = disasterName;

  updateHeader();
  buildMetricButtons();
  updateSummary();
  updateRanking();
  renderSupport();
  clearSelection(false);
  renderEmptyPhotos();

  // 재해 변경 시 해당 재해 분포 기준 자동확대를 다시 활성화
  autoZoomEnabled = true;

  resize();
}

function parseDisasterSheet(config) {
  const ws = workbook.Sheets[config.sheet];

  if (!ws) {
    throw new Error(`${config.sheet} 시트를 찾지 못했습니다.`);
  }

  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    raw: true
  });

  const metadata = {};

  for (let i = 2; i <= 9; i++) {
    const key = String(rows[i]?.[0] ?? "").trim();
    if (key) metadata[key] = rows[i]?.[1];
  }

  const reliefHeaderRow = 12;
  const reliefValueRow = 13;
  const reliefUnitRow = 14;

  const reliefHeaders = (rows[reliefHeaderRow] || []).map(x => String(x ?? "").trim());
  const reliefValues = rows[reliefValueRow] || [];
  const reliefUnits = rows[reliefUnitRow] || [];

  const relief = [];

  for (let i = 1; i < reliefHeaders.length; i++) {
    const item = reliefHeaders[i];

    if (!item || item === "합계") continue;

    const quantity = numberValue(reliefValues[i]);

    if (quantity === null || quantity === 0) continue;

    relief.push({
      item,
      quantity,
      unit: String(reliefUnits[i] ?? "").trim()
    });
  }

  const damageHeaderIndex = rows.findIndex(
    r => String(r?.[0] || "").trim() === "시도" ||
         String(r?.[0] || "").trim() === "시도/권역"
  );

  if (damageHeaderIndex < 0) {
    throw new Error(`${config.sheet} 시트에서 피해현황 헤더를 찾지 못했습니다.`);
  }

  const headers = rows[damageHeaderIndex].map(x => String(x ?? "").trim());

  const records = [];

  for (let i = damageHeaderIndex + 1; i < rows.length; i++) {
    const row = rows[i] || [];

    if (!row.some(v => v !== null && v !== "")) continue;

    const first = String(row[0] ?? "").trim();

    if (
      first === "합계" ||
      first.startsWith("※")
    ) {
      continue;
    }

    const obj = {};

    headers.forEach((h, idx) => {
      if (h) obj[h] = row[idx];
    });

    const label = recordLabel(obj);

    if (!label) continue;

    records.push({
      ...obj,
      __label: label,
      __coord: resolveCoordinate(obj)
    });
  }

  const primaryHeader =
    findMatchingHeader(headers, config.primaryMetric);

  const secondaryHeaders = [
    findMatchingHeader(headers, config.secondary1),
    findMatchingHeader(headers, config.secondary2)
  ].filter(Boolean);

  const metricHeaders = [
    primaryHeader,
    ...secondaryHeaders
  ].filter((v, i, arr) => v && arr.indexOf(v) === i);

  return {
    config,
    metadata,
    relief,
    headers,
    records,
    primaryHeader,
    metricHeaders
  };
}

function recordLabel(obj) {
  const sido = String(
    obj["시도"] ??
    obj["시도/권역"] ??
    ""
  ).trim();

  const sgg = String(obj["시군구"] ?? "").trim();
  const point = String(obj["지점명"] ?? "").trim();

  if (point) {
    return sido ? `${sido} ${point}` : point;
  }

  if (sgg) {
    return sido ? `${sido} ${sgg}` : sgg;
  }

  return sido;
}

function resolveCoordinate(obj) {
  const lat = numberValue(obj["위도"]);
  const lon = numberValue(obj["경도"]);

  if (lat !== null && lon !== null) {
    return [lon, lat];
  }

  const sido = String(
    obj["시도"] ??
    obj["시도/권역"] ??
    ""
  ).trim();

  const sgg = String(obj["시군구"] ?? "").trim();
  const point = String(obj["지점명"] ?? "").trim();

  const candidates = [
    point && sido ? `${sido} ${point}` : null,
    sgg && sido ? `${sido} ${sgg}` : null,
    point || null,
    sgg || null,
    sido || null
  ].filter(Boolean);

  for (const key of candidates) {
    if (LOCATION_POINTS[key]) return LOCATION_POINTS[key];
  }

  return null;
}

function updateHeader() {
  const md = currentData.metadata;

  document.getElementById("asof-text").textContent =
    excelDateToText(md["기준일"]);

  document.getElementById("data-type-text").textContent =
    `자료구분 ${currentConfig.dataType || "-"}`;

  document.getElementById("summary-title").textContent =
    `${currentConfig.disaster} 현황`;

  const start = excelDateToText(md["시작일"]);
  const end = excelDateToText(md["종료일"]);

  document.getElementById("period-text").textContent =
    `재해기간 ${start}${end && end !== "-" ? ` ~ ${end}` : " ~ 진행중"}`;

  document.getElementById("virtual-badge")
    .classList.toggle(
      "hidden",
      currentConfig.dataType !== "가상데이터"
    );
}

function buildMetricButtons() {
  const wrap = document.getElementById("metric-buttons");
  wrap.innerHTML = "";

  currentData.metricHeaders.forEach((header, index) => {
    const b = document.createElement("button");

    b.className = `metric-btn${index === 0 ? " active" : ""}`;
    b.textContent = displayMetricName(header);
    b.dataset.metric = header;

    b.addEventListener("click", () => {
      document.querySelectorAll(".metric-btn")
        .forEach(x => x.classList.remove("active"));

      b.classList.add("active");
      activeMetric = header;

      updateLegend();
      updateRanking();

      // 지표 변경 시 새 지표 분포 기준 자동확대를 다시 활성화
      autoZoomEnabled = true;

      drawMap();
    });

    wrap.appendChild(b);
  });

  updateLegend();
}

function displayMetricName(header) {
  return String(header || "")
    .replace(/\(.*?\)/g, "")
    .trim();
}

function metricUnit(header) {
  const h = String(header || "");

  const m = h.match(/\((.*?)\)/);
  if (m) return m[1];

  if (header === currentData.primaryHeader) {
    return currentConfig.unit || "";
  }

  if (h.includes("사망") || h.includes("부상") || h.includes("대피") || h.includes("고립")) return "명";
  if (h.includes("가축") || h.includes("양식")) return "마리";
  if (h.includes("피해") && h.includes("주택")) return "동";
  if (h.includes("시설")) return "건";
  if (h.includes("정전")) return "가구";
  if (h.includes("주의보")) return "회";
  if (h.includes("여진")) return "회";

  return "";
}

function updateLegend() {
  document.getElementById("legend-metric").textContent =
    `(${displayMetricName(activeMetric)} ${metricUnit(activeMetric)})`;
}

function updateSummary() {
  const grid = document.getElementById("summary-grid");
  grid.innerHTML = "";

  const cards = buildSummaryCards();

  cards.forEach((card, index) => {
    const div = document.createElement("div");
    div.className = `summary-cell${index === 1 ? " highlight" : ""}`;

    div.innerHTML = `
      <span title="${card.label}">${card.label}</span>
      <div>
        <strong>${formatValue(card.value, card.decimals)}</strong>
        <em>${card.unit || ""}</em>
      </div>
    `;

    grid.appendChild(div);
  });
}

function buildSummaryCards() {
  const r = currentData.records;
  const d = currentConfig.disaster;

  const count = r.length;

  const sum = header =>
    d3.sum(
      r,
      x => numberValue(x[header]) ?? 0
    );

  const max = header =>
    d3.max(
      r.map(x => numberValue(x[header])).filter(v => v !== null)
    ) ?? 0;

  const h = name => findMatchingHeader(currentData.headers, name);

  if (d === "폭염") {
    return [
      { label: "피해지역", value: count, unit: "개 지역" },
      { label: "온열질환자", value: sum(h("온열질환자")), unit: "명" },
      { label: "사망자", value: sum(h("사망자")), unit: "명" },
      { label: "가축피해", value: sum(h("가축피해")), unit: "마리" }
    ];
  }

  if (d === "호우") {
    return [
      { label: "피해·관측지역", value: count, unit: "개 지역" },
      { label: "최대 강수량", value: max(h("강수량")), unit: "mm", decimals: 1 },
      { label: "사망자", value: sum(h("사망자")), unit: "명" },
      { label: "부상자", value: sum(h("부상자")), unit: "명" }
    ];
  }

  if (d === "태풍") {
    return [
      { label: "피해지역", value: count, unit: "개 지역" },
      { label: "최대 순간풍속", value: max(h("최대순간풍속")), unit: "m/s", decimals: 1 },
      { label: "누적 강수량", value: sum(h("강수량")), unit: "mm", decimals: 1 },
      { label: "대피인원", value: sum(h("대피인원")), unit: "명" }
    ];
  }

  if (d === "산불") {
    return [
      { label: "피해지역", value: count, unit: "개 지역" },
      { label: "산불 피해면적", value: sum(h("산불피해면적")), unit: "ha" },
      { label: "대피인원", value: sum(h("대피인원")), unit: "명" },
      { label: "주택피해", value: sum(h("주택피해")), unit: "동" }
    ];
  }

  if (d === "대설") {
    return [
      { label: "피해지역", value: count, unit: "개 지역" },
      { label: "최심적설", value: max(h("최심적설")), unit: "cm", decimals: 1 },
      { label: "시설피해", value: sum(h("시설피해")), unit: "건" },
      { label: "고립인원", value: sum(h("고립인원")), unit: "명" }
    ];
  }

  if (d === "지진") {
    return [
      { label: "피해지역", value: count, unit: "개 지역" },
      { label: "최대 진도", value: max(h("진도")), unit: "MMI" },
      { label: "부상자", value: sum(h("부상자")), unit: "명" },
      { label: "시설피해", value: sum(h("시설피해")), unit: "건" }
    ];
  }

  return [
    { label: "피해지역", value: count, unit: "개 지역" },
    { label: displayMetricName(currentData.primaryHeader), value: sum(currentData.primaryHeader), unit: metricUnit(currentData.primaryHeader) }
  ];
}

function updateRanking() {
  const metric = activeMetric;

  const rows = currentData.records
    .filter(r => numberValue(r[metric]) !== null)
    .sort((a, b) => (numberValue(b[metric]) ?? 0) - (numberValue(a[metric]) ?? 0))
    .slice(0, 5);

  document.getElementById("ranking-title").textContent =
    `${displayMetricName(metric)} TOP 5`;

  const head = document.getElementById("ranking-head");

  const aux = currentData.metricHeaders.filter(h => h !== metric).slice(0, 2);

  head.innerHTML = `
    <th>순위</th>
    <th>지역</th>
    <th>${displayMetricName(metric)}</th>
    ${aux.map(h => `<th>${displayMetricName(h)}</th>`).join("")}
  `;

  const body = document.getElementById("ranking-body");
  body.innerHTML = "";

  rows.forEach((r, i) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td title="${r.__label}">${shortLabel(r)}</td>
      <td>${formatMetricCell(r[metric], metric)}</td>
      ${aux.map(h => `<td>${formatMetricCell(r[h], h)}</td>`).join("")}
    `;

    tr.addEventListener("click", () => selectRegion(r));

    body.appendChild(tr);
  });
}

function shortLabel(record) {
  return String(
    record["지점명"] ||
    record["시군구"] ||
    record["시도"] ||
    record["시도/권역"] ||
    record.__label
  );
}

function formatValue(v, decimals = 0) {
  const n = numberValue(v);

  if (n === null) return "-";

  return n.toLocaleString(
    "ko-KR",
    {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }
  );
}

function formatMetricCell(v, header) {
  const n = numberValue(v);
  if (n === null) return "-";

  const decimals =
    String(header).includes("강수량") ||
    String(header).includes("풍속") ||
    String(header).includes("적설")
      ? 1
      : 0;

  return formatValue(n, decimals);
}

function resize() {
  const rect = mapWrap.getBoundingClientRect();

  width = Math.max(560, rect.width);
  height = Math.max(560, rect.height);

  svg.attr("viewBox", `0 0 ${width} ${height}`);

  drawMap();
}


function getAutoZoomTransform(points) {
  /*
    v28: '모든 피해지역' 기준 자동 범위 맞춤

    핵심 원칙
    - 현재 선택 재해에서 값이 있는 모든 지점을 본지도 안에 포함
    - 피해지역이 좁게 모이면 해당 권역을 크게 확대
    - 피해지역이 여러 시도에 퍼지면 필요한 만큼 자동 축소
    - 전국에 넓게 퍼지면 사실상 전국보기 수준으로 표시
    - 특정 지역을 예외 처리하지 않고 데이터 자체가 지도 범위를 결정
  */
  autoZoomOutliers = [];
  autoZoomMainCluster = points ? [...points] : [];

  if (!points || points.length === 0) {
    return d3.zoomIdentity;
  }

  /*
    한 지점만 있어도 너무 과도하게 확대되지 않도록 별도 처리
  */
  if (points.length === 1) {
    const p = points[0];
    const scale = 2.2;

    return d3.zoomIdentity
      .translate(
        width / 2 - scale * p.x,
        height / 2 - scale * p.y
      )
      .scale(scale);
  }

  const xs = points.map(d => d.x);
  const ys = points.map(d => d.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  /*
    원과 지역명까지 잘리지 않도록 화면 여백 확보.
    원 크기와 지역명 이동을 감안해 고정 여백 + 범위 비례 여백을 사용합니다.
  */
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);

  const padX = Math.max(95, spanX * 0.18);
  const padY = Math.max(105, spanY * 0.18);

  const boxWidth =
    Math.max(150, spanX + padX * 2);

  const boxHeight =
    Math.max(170, spanY + padY * 2);

  const centerX =
    (minX + maxX) / 2;

  const centerY =
    (minY + maxY) / 2;

  /*
    화면의 약 84% 영역 안에 모든 피해지점이 들어오도록 계산합니다.
  */
  let scale = Math.min(
    width * 0.84 / boxWidth,
    height * 0.84 / boxHeight
  );

  /*
    지나친 확대/축소 방지
    - 최소 1배: 전국보다 더 축소하지 않음
    - 최대 3.2배: 한 권역 집중 시에도 지나친 확대 방지
  */
  scale = Math.max(
    1,
    Math.min(scale, 3.2)
  );

  /*
    계산 결과가 1.08배 미만이면 체감상 전국보기와 거의 같으므로
    완전한 전국보기(identity)로 정리합니다.
  */
  if (scale < 1.08) {
    return d3.zoomIdentity;
  }

  return d3.zoomIdentity
    .translate(
      width / 2 - scale * centerX,
      height / 2 - scale * centerY
    )
    .scale(scale);
}


function layoutDisplacedSymbols(points, viewTransform) {
  /*
    겹치는 비례원 자동 분산(Displaced Proportional Symbols)

    - 실제 지도 위치(anchor)는 유지
    - 화면상으로 원들이 겹치면 주변으로 조금 밀어냄
    - 행정구역 경계를 벗어나도 허용
    - 원이 실제 위치에서 이동한 경우 얇은 연결선으로 원위치를 표시
    - 확대 배율을 먼저 적용한 '화면 좌표'에서 충돌을 계산하므로
      자동확대 상태에서도 원 크기와 간격이 안정적임
  */
  if (!points.length) return points;

  const k = viewTransform?.k || 1;
  const tx = viewTransform?.x || 0;
  const ty = viewTransform?.y || 0;

  const nodes = points.map((p, index) => {
    const anchorScreenX = k * p.x + tx;
    const anchorScreenY = k * p.y + ty;

    return {
      ...p,
      __index: index,
      anchorScreenX,
      anchorScreenY,
      sx: anchorScreenX,
      sy: anchorScreenY,
      x: anchorScreenX,
      y: anchorScreenY
    };
  });

  /*
    원 반지름 + 여백으로 충돌 회피.
    anchor 복원력이 너무 강하면 다시 겹치므로 약하게 설정합니다.
  */
  const simulation = d3.forceSimulation(nodes)
    .alpha(1)
    .alphaDecay(0.055)
    .velocityDecay(0.42)
    .force(
      "x",
      d3.forceX(d => d.anchorScreenX).strength(0.10)
    )
    .force(
      "y",
      d3.forceY(d => d.anchorScreenY).strength(0.10)
    )
    .force(
      "collide",
      d3.forceCollide(d => d.r + 9)
        .strength(1)
        .iterations(3)
    )
    .stop();

  for (let i = 0; i < 120; i++) {
    simulation.tick();
  }

  return nodes.map(n => {
    /*
      과도한 이동은 제한합니다.
      화면 기준 최대 약 105px까지만 원위치에서 벗어납니다.
    */
    let dxScreen = n.x - n.anchorScreenX;
    let dyScreen = n.y - n.anchorScreenY;

    const distance = Math.hypot(dxScreen, dyScreen);
    const maxDistance = 105;

    if (distance > maxDistance) {
      const ratio = maxDistance / distance;
      dxScreen *= ratio;
      dyScreen *= ratio;
    }

    const finalScreenX = n.anchorScreenX + dxScreen;
    const finalScreenY = n.anchorScreenY + dyScreen;

    return {
      ...n,
      anchorX: n.x !== undefined ? n.x : n.anchorX,
      anchorY: n.y !== undefined ? n.y : n.anchorY,
      displayX: (finalScreenX - tx) / k,
      displayY: (finalScreenY - ty) / k,
      displacementPx: Math.hypot(dxScreen, dyScreen),
      labelSide: dxScreen < -4 ? "left" : "right"
    };
  }).map((n, i) => ({
    ...n,
    // 원래 투영 좌표는 points 배열의 값을 다시 확실히 보존
    anchorX: points[i].x,
    anchorY: points[i].y,
    x: points[i].x,
    y: points[i].y
  }));
}

function renderOverviewInset(points) {
  /*
    자동확대로 인해 제주 등 원거리 피해지점이 본지도 밖으로 나갈 경우,
    우측 하단에 전국 미니지도를 표시해 누락처럼 보이지 않게 합니다.
  */
  const existing = document.getElementById("map-overview-inset");

  if (!autoZoomEnabled || !autoZoomOutliers.length) {
    if (existing) existing.remove();
    return;
  }

  const wrap = document.getElementById("map-wrap");

  let inset = existing;

  if (!inset) {
    inset = document.createElement("div");
    inset.id = "map-overview-inset";
    inset.className = "map-overview-inset";
    inset.innerHTML = `
      <div class="inset-title">
        <span>전체 피해지역</span>
        <button type="button" id="inset-national-view">전국보기</button>
      </div>
      <svg id="overview-map" aria-label="전체 피해지역 미니지도"></svg>
      <div id="overview-note" class="overview-note"></div>
    `;
    wrap.appendChild(inset);

    inset
      .querySelector("#inset-national-view")
      .addEventListener("click", () => {
        autoZoomEnabled = false;

        svg
          .transition()
          .duration(350)
          .call(
            zoom.transform,
            d3.zoomIdentity
          );

        /*
          미니지도의 전국보기 역시 지역 선택을 해제하고
          현재 재해의 전체 사진을 표시합니다.
        */
        clearSelection(true);

        renderOverviewInset(points);
      });
  }

  const miniSvg = d3.select("#overview-map");
  miniSvg.selectAll("*").remove();

  const miniWidth = 170;
  const miniHeight = 210;

  miniSvg.attr("viewBox", `0 0 ${miniWidth} ${miniHeight}`);

  const projection = d3
    .geoMercator()
    .fitExtent(
      [[8, 8], [miniWidth - 8, miniHeight - 8]],
      boundaries
    );

  const path = d3.geoPath(projection);

  miniSvg
    .append("g")
    .selectAll("path")
    .data(boundaries.features)
    .join("path")
    .attr("class", "overview-region")
    .attr("d", path);

  const pointData = points
    .filter(p => p.__coord)
    .map(p => {
      const [x, y] = projection(p.__coord);

      return {
        ...p,
        x,
        y,
        isOutlier: autoZoomOutliers.includes(p)
      };
    });

  miniSvg
    .append("g")
    .selectAll("circle")
    .data(pointData)
    .join("circle")
    .attr("class", d => d.isOutlier ? "overview-point outlier" : "overview-point")
    .attr("cx", d => d.x)
    .attr("cy", d => d.y)
    .attr("r", d => d.isOutlier ? 4.8 : 3.2);

  const names = autoZoomOutliers
    .map(d => shortLabel(d))
    .filter(Boolean);

  const note = inset.querySelector("#overview-note");

  note.textContent =
    names.length
      ? `확대범위 밖 피해지역: ${names.join(", ")}`
      : "";
}


function layoutPlaceLabels(points, viewTransform) {
  /*
    지역명 충돌 회피
    - 큰 원부터 우선 배치
    - 오른쪽/왼쪽/위/아래/대각선 순으로 후보 위치 탐색
    - 이미 배치된 지역명과 겹치지 않는 위치를 선택
    - 확대 상태에서도 화면상 글자 간격이 일정하도록 screen 좌표에서 계산
  */
  if (!points?.length) return points;

  const k = viewTransform?.k || 1;
  const tx = viewTransform?.x || 0;
  const ty = viewTransform?.y || 0;

  const placedBoxes = [];
  const result = new Map();

  const sorted = [...points].sort(
    (a, b) => (b.__value || 0) - (a.__value || 0)
  );

  function overlaps(a, b, pad = 5) {
    return !(
      a.right + pad < b.left ||
      a.left - pad > b.right ||
      a.bottom + pad < b.top ||
      a.top - pad > b.bottom
    );
  }

  sorted.forEach(d => {
    const label = String(shortLabel(d) || "");
    const fontSize = 13;
    const textWidth = Math.max(
      28,
      label.length * fontSize * 0.72
    );
    const textHeight = 18;

    const sx =
      k * (d.displayX ?? d.x) + tx;
    const sy =
      k * (d.displayY ?? d.y) + ty;

    const gap = d.r + 9;

    const candidates = [
      { dx: gap,       dy: 4,             anchor: "start" },
      { dx: -gap,      dy: 4,             anchor: "end"   },
      { dx: 0,         dy: -(d.r + 11),   anchor: "middle"},
      { dx: 0,         dy: d.r + 18,      anchor: "middle"},
      { dx: gap,       dy: -(d.r * .55),  anchor: "start" },
      { dx: gap,       dy: d.r * .75,     anchor: "start" },
      { dx: -gap,      dy: -(d.r * .55),  anchor: "end"   },
      { dx: -gap,      dy: d.r * .75,     anchor: "end"   }
    ];

    let chosen = null;

    for (const c of candidates) {
      let left;

      if (c.anchor === "start") {
        left = sx + c.dx;
      } else if (c.anchor === "end") {
        left = sx + c.dx - textWidth;
      } else {
        left = sx + c.dx - textWidth / 2;
      }

      const top =
        sy + c.dy - textHeight * 0.72;

      const box = {
        left,
        top,
        right: left + textWidth,
        bottom: top + textHeight
      };

      const inside =
        box.left >= 5 &&
        box.right <= width - 5 &&
        box.top >= 5 &&
        box.bottom <= height - 5;

      const collision =
        placedBoxes.some(p => overlaps(box, p));

      if (inside && !collision) {
        chosen = { ...c, box };
        break;
      }
    }

    /*
      모든 후보가 겹치면 충돌이 가장 적은 기본 오른쪽 위치를 사용.
      일반적으로 5~10개 지점 규모에서는 위 후보들 안에서 해결됩니다.
    */
    if (!chosen) {
      const c = candidates[0];

      chosen = {
        ...c,
        box: {
          left: sx + c.dx,
          top: sy + c.dy - textHeight * .72,
          right: sx + c.dx + textWidth,
          bottom: sy + c.dy - textHeight * .72 + textHeight
        }
      };
    }

    placedBoxes.push(chosen.box);

    result.set(d, {
      labelDx: chosen.dx,
      labelDy: chosen.dy,
      labelAnchor: chosen.anchor
    });
  });

  return points.map(d => ({
    ...d,
    ...(result.get(d) || {
      labelDx: d.r + 9,
      labelDy: 4,
      labelAnchor: "start"
    })
  }));
}

function drawMap() {
  svg.selectAll("*").remove();

  const root = svg
    .append("g")
    .attr("class", "map-root");

  const projection = d3
    .geoMercator()
    .fitExtent(
      [[18, 34], [width - 18, height - 26]],
      boundaries
    );

  const path = d3.geoPath(projection);

  /* 행정구역 경계 */
  root
    .append("g")
    .attr("class", "region-layer")
    .selectAll("path")
    .data(boundaries.features)
    .join("path")
    .attr("class", "region")
    .attr("d", path);

  const usable = currentData.records
    .map(r => {
      const v = numberValue(r[activeMetric]);

      return {
        ...r,
        __value: v
      };
    })
    .filter(
      r =>
        r.__coord &&
        r.__value !== null &&
        r.__value > 0
    );

  const maxValue =
    d3.max(usable, r => r.__value) || 1;

  const isNationwide = usable.length >= 12;

  /*
    확대 여부와 관계없이 화면상 버블 최대크기는 작게 유지합니다.
  */
  const minRadius = isNationwide ? 8 : 10;
  const maxRadius = isNationwide ? 40 : 48;

  /*
    v25: 원래 비례감에서 '아주 살짝'만 편차 강화
    - 기존 sqrt(0.50)에 가까운 0.56 지수 사용
    - 최소값을 minRadius에 강제로 붙이지 않고 1부터 maxValue까지 계산
      → 중간값들이 지나치게 작아지는 현상 방지
  */
  const positiveValues = usable
    .map(r => r.__value)
    .filter(v => v !== null && v > 0);

  const minPositive =
    d3.min(positiveValues) || 1;

  const radius = d3
    .scalePow()
    .exponent(0.56)
    .domain([1, maxValue])
    .range([minRadius, maxRadius])
    .clamp(true);

  /*
    색상도 차이를 강하게 벌리지 않고
    연한 빨강 → 기본 빨강 → 조금 진한 빨강 정도로만 변화
  */
  const bubbleColor = d3
    .scaleLinear()
    .domain([
      minPositive,
      minPositive + (maxValue - minPositive) * 0.5,
      maxValue
    ])
    .range([
      "#f87171",
      "#ef4444",
      "#dc2626"
    ])
    .clamp(true);

  const rawPoints = usable.map(r => {
    const [x, y] = projection(r.__coord);

    return {
      ...r,
      x,
      y,
      r: radius(r.__value)
    };
  });

  /*
    먼저 자동확대 범위를 계산한 후 그 화면 좌표에서 원 겹침을 해소합니다.
  */
  let viewTransform = d3.zoomIdentity;

  if (autoZoomEnabled) {
    viewTransform = getAutoZoomTransform(rawPoints);
  } else {
    autoZoomOutliers = [];
    autoZoomMainCluster = [];
  }

  const displacedPoints =
    layoutDisplacedSymbols(rawPoints, viewTransform);

  /*
    원 위치를 정리한 뒤 지역명까지 별도로 충돌 회피 배치합니다.
  */
  const points =
    layoutPlaceLabels(displacedPoints, viewTransform);

  /*
    실제 위치와 이동된 원 사이의 연결선.
    8px 이상 이동했을 때만 표시하여 화면을 복잡하게 만들지 않습니다.
  */
  root
    .append("g")
    .attr("class", "leader-layer")
    .selectAll("line")
    .data(points.filter(d => d.displacementPx >= 8))
    .join("line")
    .attr("class", "bubble-leader")
    .attr("x1", d => d.anchorX)
    .attr("y1", d => d.anchorY)
    .attr("x2", d => d.displayX)
    .attr("y2", d => d.displayY);

  /*
    원 레이어.
    지역명 레이어보다 먼저 그려서 어떤 원도 지역명을 덮지 못하게 합니다.
  */
  const groups = root
    .append("g")
    .attr("class", "bubble-layer")
    .selectAll("g")
    .data(points)
    .join("g")
    .attr("class", "bubble-point")
    .attr(
      "transform",
      d => `translate(${d.displayX},${d.displayY})`
    )
    .on("click", (event, d) => {
      event.stopPropagation();
      selectRegion(d);
    });

  groups
    .append("circle")
    .attr("class", "bubble")
    .attr("r", d => d.r)
    .style("fill", d => bubbleColor(d.__value));

  groups
    .filter(d => d.r >= 12)
    .append("text")
    .attr("class", "bubble-value")
    .attr("y", 4)
    .style(
      "font-size",
      d => {
        const dense = usable.length >= 12;
        if (dense) return d.r >= 18 ? "11px" : "8px";
        return d.r >= 20 ? "12px" : "8px";
      }
    )
    .text(
      d => formatMetricCell(d.__value, activeMetric)
    );

  /*
    지역명 전용 최상단 레이어.
    모든 원을 먼저 그린 뒤 지역명을 마지막에 그리므로
    다른 원이 지역명 위를 덮는 현상이 사라집니다.
  */
  const labels = root
    .append("g")
    .attr("class", "bubble-label-layer")
    .selectAll("g")
    .data(points)
    .join("g")
    .attr("class", "bubble-label-point")
    .attr(
      "transform",
      d => `translate(${d.displayX},${d.displayY})`
    )
    .style("pointer-events", "none");

  labels
    .append("text")
    .attr("class", "map-place-label")
    .attr("x", d => d.labelDx)
    .attr("y", d => d.labelDy)
    .attr("text-anchor", d => d.labelAnchor)
    .text(d => shortLabel(d));

  /*
    확대/전국보기 적용.
  */
  svg.call(
    zoom.transform,
    autoZoomEnabled
      ? viewTransform
      : d3.zoomIdentity
  );

  renderOverviewInset(rawPoints);
}

function selectRegion(record) {
  document.getElementById("detail-empty").classList.add("hidden");
  document.getElementById("detail-content").classList.remove("hidden");
  document.getElementById("clear-selection").classList.remove("hidden");

  document.getElementById("detail-title").textContent =
    record.__label;

  const detail = document.getElementById("detail-content");
  detail.innerHTML = "";

  const visibleHeaders = currentData.headers.filter(h => {
    if (!h) return false;
    if (["시도", "시도/권역", "시군구", "지점명", "위도", "경도", "비고"].includes(h)) return false;

    return record[h] !== null &&
           record[h] !== undefined &&
           record[h] !== "";
  });

  visibleHeaders.forEach(h => {
    const row = document.createElement("div");
    row.className =
      `detail-row${h === activeMetric ? " primary" : ""}`;

    row.innerHTML = `
      <span>${displayMetricName(h)}</span>
      <strong>${formatMetricCell(record[h], h)} ${metricUnit(h)}</strong>
    `;

    detail.appendChild(row);
  });

  renderPhotos(record);

  /*
    세로형 화면(노트북/태블릿/모바일)에서는 지도/표 클릭 후
    상세영역이 화면 아래에 있으므로 자연스럽게 상세영역으로 이동합니다.
    넓은 PC 화면에서는 스크롤하지 않습니다.
  */
  if (window.innerWidth <= 1250) {
    document.querySelector(".detail-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
}

function clearSelection(showEmpty = true) {
  document.getElementById("detail-title").textContent =
    "지역을 선택해 주세요";

  document.getElementById("detail-content").classList.add("hidden");
  document.getElementById("detail-content").innerHTML = "";
  document.getElementById("clear-selection").classList.add("hidden");

  document.getElementById("detail-empty").classList.remove("hidden");

  /*
    지역 선택이 해제된 상태에서는 현재 재해에 등록된
    모든 현장사진을 보여줍니다.
  */
  renderAllPhotos();
}

function renderSupport() {
  const grid = document.getElementById("support-grid");
  grid.innerHTML = "";

  if (!currentData.relief.length) {
    grid.innerHTML = `
      <div class="support-card" style="grid-column:1/-1">
        <span>등록된 구호지원 수량이 없습니다.</span>
      </div>
    `;
    return;
  }

  currentData.relief.forEach(d => {
    const div = document.createElement("div");

    div.className = "support-card";

    div.innerHTML = `
      <span>${d.item}</span>
      <strong>${formatValue(d.quantity)}</strong>
      <small>${d.unit}</small>
    `;

    grid.appendChild(div);
  });
}


/* =========================================================
   지역명 / 지점명 자동 정규화
   예:
   거제 = 거제시 = 경남 거제 = 경상남도 거제시
   가덕도 = 부산 가덕도 = 부산광역시 가덕도
   성산 = 제주 성산 = 서귀포 성산 = 제주특별자치도 서귀포시 성산
========================================================= */

const REGION_ALIASES = {
  "서울특별시": "서울",
  "서울시": "서울",
  "부산광역시": "부산",
  "부산시": "부산",
  "대구광역시": "대구",
  "대구시": "대구",
  "인천광역시": "인천",
  "인천시": "인천",
  "광주광역시": "광주",
  "광주시": "광주",
  "대전광역시": "대전",
  "대전시": "대전",
  "울산광역시": "울산",
  "울산시": "울산",
  "세종특별자치시": "세종",
  "세종시": "세종",
  "경기도": "경기",
  "강원특별자치도": "강원",
  "강원도": "강원",
  "충청북도": "충북",
  "충청남도": "충남",
  "전북특별자치도": "전북",
  "전라북도": "전북",
  "전라남도": "전남",
  "경상북도": "경북",
  "경상남도": "경남",
  "제주특별자치도": "제주",
  "제주도": "제주"
};

function normalizePlaceText(value) {
  let s = String(value || "")
    .trim()
    .replace(/[(){}\[\],._\-\/\\]+/g, " ")
    .replace(/\s+/g, " ");

  Object.entries(REGION_ALIASES)
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([from, to]) => {
      s = s.replaceAll(from, to);
    });

  /*
    시/군/구/읍/면/동/리 접미사는 입력 편의를 위해 제거합니다.
    예: 거제시 → 거제, 사하구 → 사하
    단, '가덕도', '성산' 같은 일반 지점명은 그대로 유지됩니다.
  */
  s = s
    .split(" ")
    .filter(Boolean)
    .map(token => token.replace(/(특별자치시|특별자치도|광역시)$/g, ""))
    .map(token => token.replace(/(시|군|구|읍|면|동|리)$/g, ""))
    .filter(Boolean)
    .join(" ");

  return s
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function compactPlaceText(value) {
  return normalizePlaceText(value).replace(/\s+/g, "");
}

function placeVariants(...values) {
  const raw = values
    .flat()
    .map(v => String(v || "").trim())
    .filter(Boolean);

  const set = new Set();

  raw.forEach(v => {
    const normalized = normalizePlaceText(v);
    const compact = compactPlaceText(v);

    if (normalized) set.add(normalized);
    if (compact) set.add(compact);

    /*
      복합 입력은 마지막 토큰도 별도 후보로 둡니다.
      예: "경남 거제" → "거제"
          "제주 서귀포 성산" → "성산"
    */
    const tokens = normalized.split(" ").filter(Boolean);

    if (tokens.length) {
      set.add(tokens[tokens.length - 1]);
    }

    if (tokens.length >= 2) {
      set.add(tokens.slice(-2).join(" "));
      set.add(tokens.slice(-2).join(""));
    }
  });

  return [...set].filter(Boolean);
}

function samePlace(aValues, bValues) {
  const a = placeVariants(aValues);
  const b = placeVariants(bValues);

  if (!a.length || !b.length) return false;

  const bSet = new Set(b);

  // 1순위: 정규화 후 정확히 일치
  if (a.some(v => bSet.has(v))) {
    return true;
  }

  /*
    2순위: 복합 지역명과 단일 지점명 비교
    예: "부산 가덕도" ↔ "가덕도"
        "제주 서귀포 성산" ↔ "성산"
    너무 짧은 1글자 명칭은 오인식을 막기 위해 제외합니다.
  */
  return a.some(x =>
    b.some(y => {
      const xx = x.replace(/\s+/g, "");
      const yy = y.replace(/\s+/g, "");

      if (xx.length < 2 || yy.length < 2) return false;

      return xx.endsWith(yy) || yy.endsWith(xx);
    })
  );
}


/* =========================================================
   v23: 현장사진 라이트박스
   - 사진 클릭 시 크게 보기
   - 좌/우 버튼 및 키보드 방향키로 이동
   - X 버튼 / 배경 클릭 / ESC로 닫기
========================================================= */

function ensurePhotoLightbox() {
  let lightbox = document.getElementById("photo-lightbox");

  if (lightbox) return lightbox;

  lightbox = document.createElement("div");
  lightbox.id = "photo-lightbox";
  lightbox.className = "photo-lightbox hidden";
  lightbox.setAttribute("aria-hidden", "true");

  lightbox.innerHTML = `
    <div class="photo-lightbox-toolbar">
      <div id="photo-lightbox-counter" class="photo-lightbox-counter"></div>
      <button
        id="photo-lightbox-close"
        class="photo-lightbox-close"
        type="button"
        aria-label="사진 닫기"
      >×</button>
    </div>

    <button
      id="photo-lightbox-prev"
      class="photo-lightbox-nav prev"
      type="button"
      aria-label="이전 사진"
    >‹</button>

    <figure class="photo-lightbox-figure">
      <img id="photo-lightbox-image" alt="현장사진 크게 보기">
      <figcaption id="photo-lightbox-caption"></figcaption>
    </figure>

    <button
      id="photo-lightbox-next"
      class="photo-lightbox-nav next"
      type="button"
      aria-label="다음 사진"
    >›</button>
  `;

  document.body.appendChild(lightbox);

  lightbox
    .querySelector("#photo-lightbox-close")
    .addEventListener("click", closePhotoLightbox);

  lightbox
    .querySelector("#photo-lightbox-prev")
    .addEventListener("click", event => {
      event.stopPropagation();
      showPrevPhoto();
    });

  lightbox
    .querySelector("#photo-lightbox-next")
    .addEventListener("click", event => {
      event.stopPropagation();
      showNextPhoto();
    });

  lightbox.addEventListener("click", event => {
    if (event.target === lightbox) {
      closePhotoLightbox();
    }
  });

  document.addEventListener("keydown", handlePhotoLightboxKey);

  return lightbox;
}

function openPhotoLightbox(photoArray, index) {
  if (!photoArray?.length) return;

  currentPhotoGallery = [...photoArray];
  currentPhotoIndex = Math.max(
    0,
    Math.min(index, currentPhotoGallery.length - 1)
  );

  const lightbox = ensurePhotoLightbox();

  lightbox.classList.remove("hidden");
  lightbox.setAttribute("aria-hidden", "false");

  document.body.classList.add("photo-lightbox-open");

  renderPhotoLightbox();
}

function closePhotoLightbox() {
  const lightbox =
    document.getElementById("photo-lightbox");

  if (!lightbox) return;

  lightbox.classList.add("hidden");
  lightbox.setAttribute("aria-hidden", "true");

  document.body.classList.remove("photo-lightbox-open");
}

function showPrevPhoto() {
  if (!currentPhotoGallery.length) return;

  currentPhotoIndex =
    (
      currentPhotoIndex - 1 +
      currentPhotoGallery.length
    ) % currentPhotoGallery.length;

  renderPhotoLightbox();
}

function showNextPhoto() {
  if (!currentPhotoGallery.length) return;

  currentPhotoIndex =
    (
      currentPhotoIndex + 1
    ) % currentPhotoGallery.length;

  renderPhotoLightbox();
}

function renderPhotoLightbox() {
  const lightbox =
    document.getElementById("photo-lightbox");

  if (!lightbox || !currentPhotoGallery.length) return;

  const photo =
    currentPhotoGallery[currentPhotoIndex];

  const image =
    lightbox.querySelector("#photo-lightbox-image");

  const caption =
    lightbox.querySelector("#photo-lightbox-caption");

  const counter =
    lightbox.querySelector("#photo-lightbox-counter");

  const prev =
    lightbox.querySelector("#photo-lightbox-prev");

  const next =
    lightbox.querySelector("#photo-lightbox-next");

  const location =
    String(photo.sgg || photo.sido || "").trim();

  image.src = photo.file;
  image.alt =
    photo.caption ||
    (location ? `${location} 현장사진` : "현장사진");

  const captionParts = [];

  if (location) {
    captionParts.push(`<strong>${location}</strong>`);
  }

  if (photo.caption) {
    captionParts.push(`<span>${photo.caption}</span>`);
  }

  if (photo.date) {
    captionParts.push(`<small>${photo.date}</small>`);
  }

  caption.innerHTML = captionParts.join("");

  counter.textContent =
    `${currentPhotoIndex + 1} / ${currentPhotoGallery.length}`;

  const single =
    currentPhotoGallery.length <= 1;

  prev.classList.toggle("hidden", single);
  next.classList.toggle("hidden", single);
}

function handlePhotoLightboxKey(event) {
  const lightbox =
    document.getElementById("photo-lightbox");

  if (!lightbox || lightbox.classList.contains("hidden")) {
    return;
  }

  if (event.key === "Escape") {
    closePhotoLightbox();
  } else if (event.key === "ArrowLeft") {
    showPrevPhoto();
  } else if (event.key === "ArrowRight") {
    showNextPhoto();
  }
}

function attachPhotoLightboxClick(anchor, photoArray, index) {
  anchor.removeAttribute("target");
  anchor.removeAttribute("rel");
  anchor.href = "#";

  anchor.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();

    openPhotoLightbox(
      photoArray,
      index
    );
  });
}

function renderPhotos(record) {
  const recordSido =
    String(record["시도"] || record["시도/권역"] || "").trim();

  const recordSgg =
    String(record["시군구"] || "").trim();

  const recordPoint =
    String(record["지점명"] || "").trim();

  const recordCandidates = [
    recordPoint,
    recordSgg,
    recordSido,
    recordSido && recordSgg ? `${recordSido} ${recordSgg}` : "",
    recordSido && recordPoint ? `${recordSido} ${recordPoint}` : "",
    recordSgg && recordPoint ? `${recordSgg} ${recordPoint}` : "",
    recordSido && recordSgg && recordPoint
      ? `${recordSido} ${recordSgg} ${recordPoint}`
      : ""
  ].filter(Boolean);

  const arr = photos.filter(p => {
    const pDisaster = String(p.disaster || "").trim();

    const disasterMatches =
      !pDisaster || pDisaster === currentConfig.disaster;

    if (!disasterMatches) return false;

    /*
      사진 업로드 시 입력한 '사진 지역명'은 photos.csv의 sgg에 저장됩니다.
      아래 비교는 행정구역뿐 아니라 지점명까지 자동 인식합니다.
    */
    const photoCandidates = [
      p.sgg,
      p.sido,
      p.location,
      p.point,
      p.site,
      p.place
    ].filter(Boolean);

    return samePlace(
      recordCandidates,
      photoCandidates
    );
  });

  const grid = document.getElementById("photo-grid");
  const empty = document.getElementById("photo-empty");

  document.getElementById("photos-count").textContent =
    `${arr.length}장`;

  grid.innerHTML = "";

  empty.classList.toggle("hidden", arr.length > 0);

  arr.forEach((p, index) => {
    const a = document.createElement("a");

    a.className = "photo-card";

    const location =
      String(p.sgg || p.sido || "").trim();

    a.innerHTML = `
      <img
        src="${p.file}"
        alt="${p.caption || (location ? `${location} 현장사진` : "현장사진")}"
      >
      <span class="photo-meta">
        ${location ? `<b>${location}</b>` : ""}
        ${p.caption ? `<em>${p.caption}</em>` : ""}
      </span>
    `;

    attachPhotoLightboxClick(
      a,
      arr,
      index
    );

    grid.appendChild(a);
  });
}

function renderAllPhotos() {
  const grid = document.getElementById("photo-grid");
  const empty = document.getElementById("photo-empty");

  const arr = photos.filter(p => {
    const pDisaster = String(p.disaster || "").trim();

    /*
      새 업로드 사진은 disaster 값으로 현재 재해를 정확히 구분합니다.
      기존 사진처럼 disaster 값이 비어 있는 자료는 호환을 위해 함께 표시합니다.
    */
    return !pDisaster || pDisaster === currentConfig.disaster;
  });

  document.getElementById("photos-count").textContent =
    `${arr.length}장`;

  grid.innerHTML = "";

  empty.classList.toggle("hidden", arr.length > 0);

  if (!arr.length) {
    empty.textContent =
      "현재 재해에 등록된 현장사진이 없습니다.";
    return;
  }

  arr.forEach((p, index) => {
    const a = document.createElement("a");
    a.className = "photo-card";

    const location =
      String(p.sgg || p.sido || "").trim();

    a.innerHTML = `
      <img
        src="${p.file}"
        alt="${p.caption || (location ? `${location} 현장사진` : "현장사진")}"
      >
      <span class="photo-meta">
        ${location ? `<b>${location}</b>` : ""}
        ${p.caption ? `<em>${p.caption}</em>` : ""}
      </span>
    `;

    attachPhotoLightboxClick(
      a,
      arr,
      index
    );

    grid.appendChild(a);
  });
}

/*
  기존 호출부 호환:
  재해 변경 직후에도 '빈 화면'이 아니라 현재 재해 전체사진을 표시합니다.
*/
function renderEmptyPhotos() {
  renderAllPhotos();
}

document.getElementById("reset-view")
  .addEventListener("click", () => {
    // 전국보기는 명시적으로 자동확대를 끄고 전체지도 유지
    autoZoomEnabled = false;
    autoZoomOutliers = [];
    autoZoomMainCluster = [];

    svg
      .transition()
      .duration(350)
      .call(
        zoom.transform,
        d3.zoomIdentity
      );

    document.getElementById("map-overview-inset")?.remove();

    /*
      전국보기 = 지역 선택 해제
      따라서 현재 재해에 등록된 모든 현장사진을 다시 표시합니다.
    */
    clearSelection(true);
  });

document.getElementById("clear-selection")
  .addEventListener("click", () => clearSelection(true));

function debounce(fn, delay) {
  let timer;

  return (...args) => {
    clearTimeout(timer);

    timer = setTimeout(
      () => fn(...args),
      delay
    );
  };
}


/* =========================================================
   숨김 업로드 패널
   - 우측 하단 작은 점을 1.2초 이내 3회 클릭하면 열림
   - 실제 저장은 Render Web Service 업로드 API가 처리
========================================================= */

const uploadTrigger = document.getElementById("upload-secret-trigger");
const uploadModal = document.getElementById("upload-modal");
const uploadClose = document.getElementById("upload-close");
const uploadSubmit = document.getElementById("upload-submit");
const uploadStatus = document.getElementById("upload-status");
const uploadDisaster = document.getElementById("upload-disaster");

let secretClickTimes = [];

uploadTrigger.addEventListener("click", () => {
  const now = Date.now();

  secretClickTimes = secretClickTimes
    .filter(t => now - t <= 1200);

  secretClickTimes.push(now);

  if (secretClickTimes.length >= 3) {
    secretClickTimes = [];
    openUploadModal();
  }
});

uploadClose.addEventListener("click", closeUploadModal);

uploadModal.addEventListener("click", event => {
  if (event.target === uploadModal) {
    closeUploadModal();
  }
});

function openUploadModal() {
  uploadModal.classList.remove("hidden");
  uploadModal.setAttribute("aria-hidden", "false");

  uploadDisaster.innerHTML = "";

  disasterConfigs.forEach(c => {
    const option = document.createElement("option");
    option.value = c.disaster;
    option.textContent = c.disaster;

    if (currentConfig && c.disaster === currentConfig.disaster) {
      option.selected = true;
    }

    uploadDisaster.appendChild(option);
  });

  uploadStatus.className = "upload-status";
  uploadStatus.textContent = "";
  document.getElementById("upload-pin").focus();
}

function closeUploadModal() {
  uploadModal.classList.add("hidden");
  uploadModal.setAttribute("aria-hidden", "true");
}

uploadSubmit.addEventListener("click", async () => {
  const apiBase = String(window.UPLOAD_API_URL || "").replace(/\/$/, "");
  const pin = document.getElementById("upload-pin").value.trim();
  const disaster = uploadDisaster.value;
  const location = document.getElementById("upload-location").value.trim();
  const caption = document.getElementById("upload-caption").value.trim();
  const excelFile = document.getElementById("upload-excel").files[0] || null;
  const photoFiles = [...document.getElementById("upload-photos").files];

  uploadStatus.className = "upload-status";

  if (!apiBase) {
    return setUploadError("업로드 API 주소가 설정되지 않았습니다.");
  }

  if (!pin) {
    return setUploadError("PIN을 입력해 주세요.");
  }

  if (!excelFile && photoFiles.length === 0) {
    return setUploadError("Excel 또는 사진을 하나 이상 선택해 주세요.");
  }

  if (photoFiles.length && !location) {
    return setUploadError("사진 업로드 시 지역명을 입력해 주세요.");
  }

  if (photoFiles.length > 20) {
    return setUploadError("사진은 한 번에 최대 20장까지 업로드할 수 있습니다.");
  }

  try {
    uploadSubmit.disabled = true;
    uploadStatus.textContent = "업로드 파일을 준비하고 있습니다...";

    const form = new FormData();
    form.append("pin", pin);
    form.append("disaster", disaster);
    form.append("location", location);
    form.append("caption", caption);

    if (excelFile) {
      form.append("excel", excelFile, "disaster_map_data.xlsx");
    }

    for (let i = 0; i < photoFiles.length; i++) {
      uploadStatus.textContent =
        `사진을 최적화하고 있습니다. ${i + 1}/${photoFiles.length}`;

      const optimized = await optimizePhoto(photoFiles[i]);

      /*
        일부 브라우저(특히 구버전 Edge/Chromium)는 multipart 업로드의
        filename 파라미터에 한글이 들어가면 ByteString 변환 오류를 낼 수 있습니다.
        서버는 업로드 후 자체 파일명을 새로 생성하므로, 전송용 파일명은
        안전하게 영문/숫자만 사용합니다.
      */
      form.append(
        "photos",
        optimized,
        `photo_${String(i + 1).padStart(2, "0")}.jpg`
      );
    }

    uploadStatus.textContent = "GitHub에 자료를 반영하고 있습니다...";

    const response = await fetch(`${apiBase}/upload`, {
      method: "POST",
      body: form
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || `업로드 실패 (${response.status})`);
    }

    uploadStatus.className = "upload-status ok";
    uploadStatus.textContent =
      `업로드 완료. ${result.updated_files || 0}개 파일이 반영되었습니다. Render 자동 재배포 후 화면이 갱신됩니다.`;

    document.getElementById("upload-excel").value = "";
    document.getElementById("upload-photos").value = "";
    document.getElementById("upload-caption").value = "";

  } catch (error) {
    setUploadError(error.message || "업로드 중 오류가 발생했습니다.");
  } finally {
    uploadSubmit.disabled = false;
  }
});

function setUploadError(message) {
  uploadStatus.className = "upload-status error";
  uploadStatus.textContent = message;
}

function safeClientFileName(name) {
  return String(name || "photo")
    .replace(/\.[^.]+$/, "")
    .replace(/[^0-9A-Za-z가-힣_-]+/g, "_")
    .slice(0, 60);
}

async function optimizePhoto(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name}: 이미지 파일이 아닙니다.`);
  }

  const bitmap = await createImageBitmap(file);

  const maxSide = 1920;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));

  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error("사진 변환 실패")),
      "image/jpeg",
      0.82
    );
  });

  return blob;
}



/* =========================================================
   v19: 업로드 패널 사진 목록/삭제
========================================================= */

const photoManageRefresh =
  document.getElementById("photo-manage-refresh");

const photoManageList =
  document.getElementById("photo-manage-list");

photoManageRefresh?.addEventListener("click", () => {
  loadPhotoManageList();
});

uploadDisaster?.addEventListener("change", () => {
  loadPhotoManageList();
});

/*
  관리 목록은 브라우저가 처음 읽은 photos.csv가 아니라
  업로드 API가 GitHub의 최신 photos.csv를 직접 읽어 반환합니다.
  따라서 Render 정적사이트 재배포 전에도 정확한 최신 파일경로를 사용합니다.
*/
async function loadPhotoManageList() {
  if (!photoManageList) return;

  const apiBase =
    String(window.UPLOAD_API_URL || "").replace(/\/$/, "");

  const disaster =
    String(uploadDisaster?.value || currentConfig?.disaster || "").trim();

  if (!apiBase) {
    photoManageList.innerHTML =
      `<div class="photo-manage-empty">업로드 API 주소가 설정되지 않았습니다.</div>`;
    return;
  }

  photoManageList.innerHTML =
    `<div class="photo-manage-empty">GitHub의 최신 사진 목록을 불러오는 중...</div>`;

  try {
    const response = await fetch(
      `${apiBase}/photos?disaster=${encodeURIComponent(disaster)}`,
      { cache: "no-store" }
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        result.error || `사진 목록 조회 실패 (${response.status})`
      );
    }

    renderPhotoManageList(result.photos || []);

  } catch (error) {
    photoManageList.innerHTML =
      `<div class="photo-manage-empty">${error.message || "사진 목록을 불러오지 못했습니다."}</div>`;
  }
}

function renderPhotoManageList(arr) {
  if (!photoManageList) return;

  photoManageList.innerHTML = "";

  if (!arr.length) {
    photoManageList.innerHTML =
      `<div class="photo-manage-empty">등록된 사진이 없습니다.</div>`;
    return;
  }

  arr
    .sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || ""))
    )
    .forEach(p => {
      const item = document.createElement("div");
      item.className = "photo-manage-item";

      const location =
        String(p.sgg || p.sido || "").trim();

      const filePath =
        String(p.file || "").trim();

      item.innerHTML = `
        <img src="${filePath}" alt="현장사진 미리보기">
        <div class="photo-manage-meta">
          <b>${location || "지역 미입력"}</b>
          <span>${p.caption || filePath}</span>
        </div>
        <button
          type="button"
          class="photo-delete-btn"
          data-file="${filePath}"
        >
          삭제
        </button>
      `;

      const button =
        item.querySelector(".photo-delete-btn");

      button.addEventListener("click", async () => {
        await deleteManagedPhoto(p, button);
      });

      photoManageList.appendChild(item);
    });
}

async function deleteManagedPhoto(photo, button) {
  const apiBase =
    String(window.UPLOAD_API_URL || "").replace(/\/$/, "");

  const pin =
    document.getElementById("upload-pin").value.trim();

  if (!apiBase) {
    return setUploadError("업로드 API 주소가 설정되지 않았습니다.");
  }

  if (!pin) {
    return setUploadError("사진 삭제 전 PIN을 입력해 주세요.");
  }

  const location =
    String(photo.sgg || photo.sido || "").trim();

  const ok = window.confirm(
    `${location || "선택 사진"}을 삭제할까요?\n삭제 후 복구하려면 GitHub 이력이 필요합니다.`
  );

  if (!ok) return;

  try {
    button.disabled = true;

    uploadStatus.className = "upload-status";
    uploadStatus.textContent = "사진을 삭제하고 있습니다...";

    const response = await fetch(`${apiBase}/delete-photo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        pin,
        file: photo.file
      })
    });

    const result =
      await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        result.error || `삭제 실패 (${response.status})`
      );
    }

    /*
      브라우저 메모리에서도 즉시 제거하여
      Render 재배포 전이라도 관리창/사진목록에 반영합니다.
    */
    photos = photos.filter(
      p => String(p.file || "") !== String(photo.file || "")
    );

    uploadStatus.className = "upload-status ok";
    uploadStatus.textContent =
      "사진 삭제가 완료되었습니다. Render 자동 재배포 후 공개화면에도 반영됩니다.";

    await loadPhotoManageList();
    renderAllPhotos();

  } catch (error) {
    setUploadError(error.message || "사진 삭제 중 오류가 발생했습니다.");
    button.disabled = false;
  }
}

init();
