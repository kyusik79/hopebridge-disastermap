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
let photos = [];

const fmt = new Intl.NumberFormat("ko-KR");

const zoom = d3.zoom()
  .scaleExtent([1, 8])
  .on("zoom", event => {
    svg.select(".map-root").attr("transform", event.transform);
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

  root
    .append("g")
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
    .filter(r => r.__coord && r.__value !== null && r.__value > 0);

  const maxValue =
    d3.max(usable, r => r.__value) || 1;

  /*
    전국 단위 자료(폭염 등)는 지역 간 거리가 촘촘하므로 최대 원을 작게,
    일부 지역 집중형 자료(호우 등)는 최대 원을 조금 크게 표시합니다.
    값 자체는 여전히 원의 '면적'에 비례합니다.
  */
  const isNationwide = usable.length >= 12;
  const minRadius = isNationwide ? 5 : 7;
  const maxRadius = isNationwide ? 34 : 44;

  const radius = d3
    .scaleSqrt()
    .domain([Math.min(1, maxValue), maxValue])
    .range([minRadius, maxRadius]);

  const points = usable.map(r => {
    const [x, y] = projection(r.__coord);

    return {
      ...r,
      x,
      y,
      r: radius(r.__value)
    };
  });

  const groups = root
    .append("g")
    .selectAll("g")
    .data(points)
    .join("g")
    .attr(
      "transform",
      d => `translate(${d.x},${d.y})`
    )
    .on("click", (event, d) => {
      event.stopPropagation();
      selectRegion(d);
    });

  groups
    .append("circle")
    .attr("class", "bubble")
    .attr("r", d => d.r);

  groups
    .filter(d => d.r >= 12)
    .append("text")
    .attr("class", "bubble-value")
    .attr("y", 6)
    .style(
      "font-size",
      d => {
        const dense = usable.length >= 12;
        if (dense) return d.r >= 24 ? "14px" : "9px";
        return d.r >= 25 ? "17px" : "10px";
      }
    )
    .text(
      d => formatMetricCell(d.__value, activeMetric)
    );

  groups
    .append("text")
    .attr("class", "map-place-label")
    .attr("x", d => d.r + 8)
    .attr("y", 4)
    .text(d => shortLabel(d));
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

  if (showEmpty) {
    document.getElementById("detail-empty").classList.remove("hidden");
  } else {
    document.getElementById("detail-empty").classList.remove("hidden");
  }
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

function renderPhotos(record) {
  const keys = [
    String(record["지점명"] || "").trim(),
    String(record["시군구"] || "").trim(),
    String(record["시도"] || record["시도/권역"] || "").trim()
  ].filter(Boolean);

  const arr = photos.filter(p => {
    const pDisaster = String(p.disaster || "").trim();
    const pSido = String(p.sido || "").trim();
    const pSgg = String(p.sgg || "").trim();

    const disasterMatches =
      !pDisaster || pDisaster === currentConfig.disaster;

    return disasterMatches &&
      keys.some(k => k === pSgg || k === pSido);
  });

  const grid = document.getElementById("photo-grid");
  const empty = document.getElementById("photo-empty");

  document.getElementById("photos-count").textContent =
    `${arr.length}장`;

  grid.innerHTML = "";

  empty.classList.toggle("hidden", arr.length > 0);

  arr.forEach(p => {
    const a = document.createElement("a");

    a.className = "photo-card";
    a.href = p.file;
    a.target = "_blank";
    a.rel = "noopener";

    a.innerHTML = `
      <img
        src="${p.file}"
        alt="${p.caption || "현장사진"}"
      >
    `;

    grid.appendChild(a);
  });
}

function renderEmptyPhotos() {
  document.getElementById("photo-grid").innerHTML = "";
  document.getElementById("photos-count").textContent = "0장";
  document.getElementById("photo-empty").classList.remove("hidden");
}

document.getElementById("reset-view")
  .addEventListener("click", () => {
    svg
      .transition()
      .duration(350)
      .call(
        zoom.transform,
        d3.zoomIdentity
      );
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

      form.append(
        "photos",
        optimized,
        `${String(i + 1).padStart(2, "0")}_${safeClientFileName(photoFiles[i].name)}.jpg`
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


init();
