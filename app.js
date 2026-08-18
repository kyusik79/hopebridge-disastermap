import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import * as adk from "https://cdn.jsdelivr.net/npm/admdongkor@0.6.0/+esm";

const DATA_VERSION = "20260701";
const MAP_LEVEL = "sgg";

const svg = d3.select("#map");
const mapWrap = document.getElementById("map-wrap");
const loadingEl = document.getElementById("map-loading");
const errorEl = document.getElementById("map-error");

let disaster = [];
let photos = [];
let support = [];
let boundaries = null;
let selectedCode = null;
let activeMetric = "remaining_people";
let width = 900;
let height = 760;

const metricNames = {
  remaining_people: "현재 미귀가",
  evacuated_people: "누적 일시대피",
};

const fmt = new Intl.NumberFormat("ko-KR");

const zoom = d3.zoom()
  .scaleExtent([1, 9])
  .on("zoom", (event) => {
    svg.select(".map-root").attr("transform", event.transform);
  });

svg.call(zoom);

function parseNumber(v) {
  if (v === null || v === undefined || v === "") return 0;
  return Number(String(v).replaceAll(",", "").trim()) || 0;
}

async function loadCsv(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} 파일을 불러오지 못했습니다.`);
  const text = await res.text();
  return d3.csvParse(text);
}

function resize() {
  const box = mapWrap.getBoundingClientRect();
  width = Math.max(500, box.width);
  height = Math.max(500, box.height);
  svg.attr("viewBox", `0 0 ${width} ${height}`);
  if (boundaries) drawMap();
}

async function init() {
  try {
    [disaster, support, photos] = await Promise.all([
      loadCsv("/data/disaster.csv"),
      loadCsv("/data/support.csv"),
      loadCsv("/data/photos.csv"),
    ]);

    disaster = disaster.map(d => ({
      ...d,
      sgg_code: String(d.sgg_code || "").trim(),
      evacuated_households: parseNumber(d.evacuated_households),
      evacuated_people: parseNumber(d.evacuated_people),
      returned_households: parseNumber(d.returned_households),
      returned_people: parseNumber(d.returned_people),
      remaining_households: parseNumber(d.remaining_households),
      remaining_people: parseNumber(d.remaining_people),
    }));

    support = support.map(d => ({ ...d, quantity: parseNumber(d.quantity) }));
    photos = photos.filter(d => String(d.file || "").trim());

    updateAsOf();
    updateSummary();
    updateRanking();
    renderSupport();

    boundaries = await adk.get(DATA_VERSION, MAP_LEVEL, { detail: false });

    loadingEl.classList.add("hidden");
    resize();
    window.addEventListener("resize", debounce(resize, 120));
  } catch (err) {
    console.error(err);
    loadingEl.classList.add("hidden");
    errorEl.classList.remove("hidden");
    errorEl.innerHTML = `
      <strong>지도를 불러오지 못했습니다.</strong>
      <p>${err.message}</p>
      <p style="max-width:420px;text-align:center;line-height:1.55">
        인터넷 연결 또는 GitHub Raw 데이터 접근 상태를 확인한 뒤 새로고침해 주세요.
      </p>`;
  }
}

function updateAsOf() {
  const first = disaster.find(d => d.as_of);
  document.getElementById("asof-text").textContent = first?.as_of || "-";
}

function updateSummary() {
  const sumEvacuated = d3.sum(disaster, d => d.evacuated_people);
  const sumRemaining = d3.sum(disaster, d => d.remaining_people);

  document.getElementById("sum-regions").textContent = fmt.format(disaster.length);
  document.getElementById("sum-evacuated").textContent = fmt.format(sumEvacuated);
  document.getElementById("sum-remaining").textContent = fmt.format(sumRemaining);
}

function updateRanking() {
  const rows = [...disaster]
    .sort((a,b) => b[activeMetric] - a[activeMetric])
    .slice(0, 5);

  document.getElementById("ranking-title").textContent = `${metricNames[activeMetric]} TOP 5`;
  const tbody = document.getElementById("ranking-body");
  tbody.innerHTML = "";

  rows.forEach((d, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i+1}</td>
      <td>${d.sido} ${d.sgg}</td>
      <td>${fmt.format(d.evacuated_people)}</td>
      <td>${fmt.format(d.returned_people)}</td>
      <td><strong>${fmt.format(d.remaining_people)}</strong></td>`;
    tr.addEventListener("click", () => selectRegion(d.sgg_code));
    tbody.appendChild(tr);
  });
}

function drawMap() {
  svg.selectAll("*").remove();

  const root = svg.append("g").attr("class", "map-root");

  const projection = d3.geoMercator();
  projection.fitExtent([[38, 55], [width - 38, height - 52]], boundaries);

  const path = d3.geoPath(projection);

  const disasterByCode = new Map(disaster.map(d => [d.sgg_code, d]));

  root.append("g")
    .selectAll("path")
    .data(boundaries.features)
    .join("path")
    .attr("class", d => `region ${String(d.properties.sggcd) === selectedCode ? "selected" : ""}`)
    .attr("d", path)
    .attr("data-code", d => d.properties.sggcd)
    .on("click", (_, d) => {
      const code = String(d.properties.sggcd || "");
      if (disasterByCode.has(code)) selectRegion(code);
    });

  const positive = disaster.filter(d => d[activeMetric] > 0);
  const maxValue = d3.max(positive, d => d[activeMetric]) || 1;
  const radius = d3.scaleSqrt().domain([1, maxValue]).range([7, 48]);

  const points = positive.map(d => {
    const feature = boundaries.features.find(f => String(f.properties.sggcd) === d.sgg_code);
    if (!feature) return null;
    const [x, y] = path.centroid(feature);
    return { ...d, x, y, r: radius(d[activeMetric]) };
  }).filter(Boolean);

  const bubbleG = root.append("g").attr("class", "bubble-layer");

  const group = bubbleG.selectAll("g")
    .data(points)
    .join("g")
    .attr("transform", d => `translate(${d.x},${d.y})`)
    .on("click", (event, d) => {
      event.stopPropagation();
      selectRegion(d.sgg_code);
    });

  group.append("circle")
    .attr("class", "bubble")
    .attr("r", d => d.r);

  group.each(function(d) {
    if (d.r < 13) return;
    const txt = d3.select(this)
      .append("text")
      .attr("class", "bubble-label");

    if (d.r >= 23) {
      txt.append("tspan")
        .attr("class", "name")
        .attr("x", 0)
        .attr("dy", "-0.25em")
        .text(d.sgg);
      txt.append("tspan")
        .attr("class", "value")
        .attr("x", 0)
        .attr("dy", "1.15em")
        .text(fmt.format(d[activeMetric]));
    } else {
      txt.append("tspan")
        .attr("class", "value")
        .attr("x", 0)
        .attr("dy", "0.35em")
        .style("font-size", "11px")
        .text(fmt.format(d[activeMetric]));
    }
  });

  root.on("click", () => {});
}

function selectRegion(code) {
  selectedCode = String(code);
  const d = disaster.find(r => r.sgg_code === selectedCode);
  if (!d) return;

  document.getElementById("detail-empty").classList.add("hidden");
  document.getElementById("detail-content").classList.remove("hidden");
  document.getElementById("clear-selection").classList.remove("hidden");
  document.getElementById("detail-title").textContent = `${d.sido} ${d.sgg}`;
  document.getElementById("detail-evacuated").textContent = `${fmt.format(d.evacuated_people)}명`;
  document.getElementById("detail-returned").textContent = `${fmt.format(d.returned_people)}명`;
  document.getElementById("detail-remaining").textContent = `${fmt.format(d.remaining_people)}명`;
  document.getElementById("detail-reason").textContent = d.evacuation_reason || "-";

  renderPhotos(d);
  drawMap();

  const feature = boundaries.features.find(f => String(f.properties.sggcd) === selectedCode);
  if (feature) {
    const projection = d3.geoMercator().fitExtent([[38, 55], [width - 38, height - 52]], boundaries);
    const path = d3.geoPath(projection);
    const [x, y] = path.centroid(feature);
    const scale = 3.2;
    svg.transition().duration(500).call(
      zoom.transform,
      d3.zoomIdentity.translate(width/2 - scale*x, height/2 - scale*y).scale(scale)
    );
  }
}

function clearSelection() {
  selectedCode = null;
  document.getElementById("detail-empty").classList.remove("hidden");
  document.getElementById("detail-content").classList.add("hidden");
  document.getElementById("clear-selection").classList.add("hidden");
  document.getElementById("detail-title").textContent = "지역을 선택해 주세요";
  drawMap();
  resetView();
}

function renderPhotos(region) {
  const arr = photos.filter(p => p.sgg_code === region.sgg_code);
  const grid = document.getElementById("photo-grid");
  const empty = document.getElementById("photo-empty");
  document.getElementById("photos-count").textContent = `${arr.length}장`;

  grid.innerHTML = "";
  empty.classList.toggle("hidden", arr.length > 0);

  arr.forEach(p => {
    const a = document.createElement("a");
    a.className = "photo-card";
    a.href = p.file;
    a.target = "_blank";
    a.rel = "noopener";
    a.dataset.caption = p.caption || "";
    a.innerHTML = `<img src="${p.file}" alt="${escapeHtml(p.caption || `${region.sgg} 현장사진`)}" loading="lazy">`;
    grid.appendChild(a);
  });
}

function renderSupport() {
  const grid = document.getElementById("support-grid");
  grid.innerHTML = "";
  support.forEach(d => {
    const card = document.createElement("div");
    card.className = "support-card";
    card.innerHTML = `
      <span>${escapeHtml(d.item)}</span>
      <strong>${fmt.format(d.quantity)}</strong>
      <small>${escapeHtml(d.unit)}</small>`;
    grid.appendChild(card);
  });
}

function resetView() {
  svg.transition().duration(450).call(zoom.transform, d3.zoomIdentity);
}

document.querySelectorAll(".metric-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".metric-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeMetric = btn.dataset.metric;
    updateRanking();
    drawMap();
  });
});

document.getElementById("reset-view").addEventListener("click", resetView);
document.getElementById("clear-selection").addEventListener("click", clearSelection);

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

init();
