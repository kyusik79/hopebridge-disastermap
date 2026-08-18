import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

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

/*
  현재 시범 데이터에 포함된 피해지역 대표좌표
  향후 정식 시군구 GeoJSON으로 교체하면 이 좌표표는 제거 가능합니다.
*/
const regionPoints = {
  "26170": [129.0474, 35.1293], // 부산 동구
  "26200": [129.0679, 35.0912], // 부산 영도구
  "26380": [128.9747, 35.1046], // 부산 사하구
  "26440": [128.9805, 35.2122], // 부산 강서구

  "48220": [128.4330, 34.8544], // 통영시
  "48240": [128.0642, 35.0038], // 사천시
  "48310": [128.6211, 34.8806], // 거제시
  "48840": [127.8925, 34.8375], // 남해군

  "50130": [126.5601, 33.2541], // 서귀포시
};

const zoom = d3
  .zoom()
  .scaleExtent([1, 8])
  .on("zoom", (event) => {
    svg.select(".map-root").attr("transform", event.transform);
  });

svg.call(zoom);

function parseNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  return (
    Number(
      String(value)
        .replaceAll(",", "")
        .trim()
    ) || 0
  );
}

async function loadCsv(path) {
  const response = await fetch(path, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`${path} 파일을 불러오지 못했습니다.`);
  }

  const text = await response.text();

  return d3.csvParse(text);
}

async function loadGeoJson(path) {
  const response = await fetch(path, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`${path} 파일을 불러오지 못했습니다.`);
  }

  return await response.json();
}

function resize() {
  const box = mapWrap.getBoundingClientRect();

  width = Math.max(520, box.width);
  height = Math.max(520, box.height);

  svg.attr(
    "viewBox",
    `0 0 ${width} ${height}`
  );

  if (boundaries) {
    drawMap();
  }
}

async function init() {
  try {
    [
      disaster,
      support,
      photos,
      boundaries,
    ] = await Promise.all([
      loadCsv("/data/disaster.csv"),
      loadCsv("/data/support.csv"),
      loadCsv("/data/photos.csv"),
      loadGeoJson("/data/korea_sgg.geojson"),
    ]);

    disaster = disaster.map((d) => ({
      ...d,

      sgg_code: String(
        d.sgg_code || ""
      ).trim(),

      evacuated_households:
        parseNumber(d.evacuated_households),

      evacuated_people:
        parseNumber(d.evacuated_people),

      returned_households:
        parseNumber(d.returned_households),

      returned_people:
        parseNumber(d.returned_people),

      remaining_households:
        parseNumber(d.remaining_households),

      remaining_people:
        parseNumber(d.remaining_people),
    }));

    support = support.map((d) => ({
      ...d,
      quantity: parseNumber(d.quantity),
    }));

    photos = photos.filter((d) =>
      String(d.file || "").trim()
    );

    updateAsOf();

    updateSummary();

    updateRanking();

    renderSupport();

    loadingEl.classList.add("hidden");

    resize();

    window.addEventListener(
      "resize",
      debounce(resize, 120)
    );
  } catch (error) {
    console.error(error);

    loadingEl.classList.add("hidden");

    errorEl.classList.remove("hidden");

    errorEl.innerHTML = `
      <strong>데이터를 불러오지 못했습니다.</strong>

      <p>
        ${error.message}
      </p>

      <p
        style="
          max-width:440px;
          text-align:center;
          line-height:1.55;
        "
      >
        data 폴더 안에
        disaster.csv,
        support.csv,
        photos.csv,
        korea_sgg.geojson
        파일이 모두 있는지 확인해 주세요.
      </p>
    `;
  }
}

function updateAsOf() {
  const first =
    disaster.find(
      (d) => d.as_of
    );

  const element =
    document.getElementById(
      "asof-text"
    );

  if (element) {
    element.textContent =
      first?.as_of || "-";
  }
}

function updateSummary() {
  const totalEvacuated =
    d3.sum(
      disaster,
      (d) => d.evacuated_people
    );

  const totalRemaining =
    d3.sum(
      disaster,
      (d) => d.remaining_people
    );

  document.getElementById(
    "sum-regions"
  ).textContent =
    fmt.format(disaster.length);

  document.getElementById(
    "sum-evacuated"
  ).textContent =
    fmt.format(totalEvacuated);

  document.getElementById(
    "sum-remaining"
  ).textContent =
    fmt.format(totalRemaining);
}

function updateRanking() {
  const rows = [
    ...disaster,
  ]
    .sort(
      (a, b) =>
        b[activeMetric] -
        a[activeMetric]
    )
    .slice(0, 5);

  document.getElementById(
    "ranking-title"
  ).textContent =
    `${metricNames[activeMetric]} TOP 5`;

  const tbody =
    document.getElementById(
      "ranking-body"
    );

  tbody.innerHTML = "";

  rows.forEach((d, index) => {
    const tr =
      document.createElement("tr");

    tr.innerHTML = `
      <td>
        ${index + 1}
      </td>

      <td>
        ${d.sido} ${d.sgg}
      </td>

      <td>
        ${fmt.format(
          d.evacuated_people
        )}
      </td>

      <td>
        ${fmt.format(
          d.returned_people
        )}
      </td>

      <td>
        <strong>
          ${fmt.format(
            d.remaining_people
          )}
        </strong>
      </td>
    `;

    tr.addEventListener(
      "click",
      () =>
        selectRegion(
          d.sgg_code
        )
    );

    tbody.appendChild(tr);
  });
}

function drawMap() {
  svg.selectAll("*").remove();

  const root =
    svg
      .append("g")
      .attr(
        "class",
        "map-root"
      );

  const projection =
    d3.geoMercator();

  projection.fitExtent(
    [
      [65, 68],
      [
        width - 65,
        height - 58,
      ],
    ],
    boundaries
  );

  const path =
    d3.geoPath(projection);

  /*
    대한민국 외곽선
  */

  root
    .append("g")
    .selectAll("path")
    .data(
      boundaries.features
    )
    .join("path")
    .attr(
      "class",
      "region"
    )
    .attr(
      "d",
      path
    );

  /*
    선택한 지표값이 1 이상인 지역만
    지도에 원으로 표시
  */

  const positive =
    disaster.filter(
      (d) =>
        d[activeMetric] > 0 &&
        regionPoints[
          d.sgg_code
        ]
    );

  const maxValue =
    d3.max(
      positive,
      (d) =>
        d[activeMetric]
    ) || 1;

  /*
    원의 면적이 값에 비례하도록
    제곱근 스케일 사용
  */

  const radius =
    d3
      .scaleSqrt()
      .domain([
        1,
        maxValue,
      ])
      .range([
        7,
        Math.min(
          48,
          Math.max(
            34,
            width * 0.055
          )
        ),
      ]);

  const points =
    positive.map((d) => {
      const xy =
        projection(
          regionPoints[
            d.sgg_code
          ]
        );

      return {
        ...d,

        x: xy[0],

        y: xy[1],

        r: radius(
          d[activeMetric]
        ),
      };
    });

  const group =
    root
      .append("g")
      .attr(
        "class",
        "bubble-layer"
      )
      .selectAll("g")
      .data(points)
      .join("g")
      .attr(
        "transform",
        (d) =>
          `translate(${d.x},${d.y})`
      )
      .style(
        "cursor",
        "pointer"
      )
      .on(
        "click",
        (
          event,
          d
        ) => {
          event.stopPropagation();

          selectRegion(
            d.sgg_code
          );
        }
      );

  group
    .append("circle")
    .attr(
      "class",
      "bubble"
    )
    .attr(
      "r",
      (d) => d.r
    );

  /*
    큰 원에는 숫자 표시
  */

  group.each(function (d) {
    const g =
      d3.select(this);

    if (d.r >= 22) {
      const text =
        g
          .append("text")
          .attr(
            "class",
            "bubble-label"
          );

      text
        .append("tspan")
        .attr(
          "class",
          "value"
        )
        .attr(
          "x",
          0
        )
        .attr(
          "dy",
          "0.35em"
        )
        .text(
          fmt.format(
            d[activeMetric]
          )
        );

      /*
        원 오른쪽에 지역명 표시
      */

      g
        .append("text")
        .attr(
          "x",
          d.r + 9
        )
        .attr(
          "y",
          4
        )
        .attr(
          "class",
          "map-place-label"
        )
        .text(
          d.sgg
        );
    } else if (
      d.r >= 11
    ) {
      g
        .append("text")
        .attr(
          "class",
          "bubble-label"
        )
        .attr(
          "y",
          4
        )
        .style(
          "font-size",
          "11px"
        )
        .text(
          fmt.format(
            d[activeMetric]
          )
        );

      g
        .append("text")
        .attr(
          "x",
          d.r + 7
        )
        .attr(
          "y",
          4
        )
        .attr(
          "class",
          "map-place-label small"
        )
        .text(
          d.sgg
        );
    }
  });
}

function selectRegion(
  code
) {
  selectedCode =
    String(code);

  const d =
    disaster.find(
      (row) =>
        row.sgg_code ===
        selectedCode
    );

  if (!d) {
    return;
  }

  document
    .getElementById(
      "detail-empty"
    )
    .classList.add(
      "hidden"
    );

  document
    .getElementById(
      "detail-content"
    )
    .classList.remove(
      "hidden"
    );

  document
    .getElementById(
      "clear-selection"
    )
    .classList.remove(
      "hidden"
    );

  document.getElementById(
    "detail-title"
  ).textContent =
    `${d.sido} ${d.sgg}`;

  document.getElementById(
    "detail-evacuated"
  ).textContent =
    `${fmt.format(
      d.evacuated_people
    )}명`;

  document.getElementById(
    "detail-returned"
  ).textContent =
    `${fmt.format(
      d.returned_people
    )}명`;

  document.getElementById(
    "detail-remaining"
  ).textContent =
    `${fmt.format(
      d.remaining_people
    )}명`;

  document.getElementById(
    "detail-reason"
  ).textContent =
    d.evacuation_reason ||
    "-";

  renderPhotos(d);

  /*
    선택지역 확대
  */

  const position =
    regionPoints[
      selectedCode
    ];

  if (position) {
    const projection =
      d3
        .geoMercator()
        .fitExtent(
          [
            [65, 68],
            [
              width - 65,
              height - 58,
            ],
          ],
          boundaries
        );

    const [
      x,
      y,
    ] =
      projection(
        position
      );

    const scale =
      2.8;

    svg
      .transition()
      .duration(450)
      .call(
        zoom.transform,

        d3.zoomIdentity
          .translate(
            width / 2 -
              scale * x,

            height / 2 -
              scale * y
          )
          .scale(scale)
      );
  }
}

function clearSelection() {
  selectedCode = null;

  document
    .getElementById(
      "detail-empty"
    )
    .classList.remove(
      "hidden"
    );

  document
    .getElementById(
      "detail-content"
    )
    .classList.add(
      "hidden"
    );

  document
    .getElementById(
      "clear-selection"
    )
    .classList.add(
      "hidden"
    );

  document.getElementById(
    "detail-title"
  ).textContent =
    "지역을 선택해 주세요";

  resetView();
}

function renderPhotos(
  region
) {
  const arr =
    photos.filter(
      (photo) =>
        photo.sgg_code ===
        region.sgg_code
    );

  const grid =
    document.getElementById(
      "photo-grid"
    );

  const empty =
    document.getElementById(
      "photo-empty"
    );

  document.getElementById(
    "photos-count"
  ).textContent =
    `${arr.length}장`;

  grid.innerHTML = "";

  empty.classList.toggle(
    "hidden",
    arr.length > 0
  );

  arr.forEach(
    (photo) => {
      const anchor =
        document.createElement(
          "a"
        );

      anchor.className =
        "photo-card";

      anchor.href =
        photo.file;

      anchor.target =
        "_blank";

      anchor.rel =
        "noopener";

      anchor.dataset.caption =
        photo.caption || "";

      anchor.innerHTML = `
        <img
          src="${photo.file}"
          alt="${escapeHtml(
            photo.caption ||
              `${region.sgg} 현장사진`
          )}"
          loading="lazy"
        >
      `;

      grid.appendChild(
        anchor
      );
    }
  );
}

function renderSupport() {
  const grid =
    document.getElementById(
      "support-grid"
    );

  grid.innerHTML = "";

  support.forEach(
    (d) => {
      const card =
        document.createElement(
          "div"
        );

      card.className =
        "support-card";

      card.innerHTML = `
        <span>
          ${escapeHtml(
            d.item
          )}
        </span>

        <strong>
          ${fmt.format(
            d.quantity
          )}
        </strong>

        <small>
          ${escapeHtml(
            d.unit
          )}
        </small>
      `;

      grid.appendChild(
        card
      );
    }
  );
}

function resetView() {
  svg
    .transition()
    .duration(450)
    .call(
      zoom.transform,
      d3.zoomIdentity
    );
}

/*
  상단 지표 선택 버튼
*/

document
  .querySelectorAll(
    ".metric-btn"
  )
  .forEach((button) => {
    button.addEventListener(
      "click",
      () => {
        document
          .querySelectorAll(
            ".metric-btn"
          )
          .forEach(
            (b) =>
              b.classList.remove(
                "active"
              )
          );

        button.classList.add(
          "active"
        );

        activeMetric =
          button.dataset.metric;

        updateRanking();

        drawMap();
      }
    );
  });

document
  .getElementById(
    "reset-view"
  )
  ?.addEventListener(
    "click",
    resetView
  );

document
  .getElementById(
    "clear-selection"
  )
  ?.addEventListener(
    "click",
    clearSelection
  );

function escapeHtml(
  str
) {
  return String(str)
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}

function debounce(
  fn,
  delay
) {
  let timer;

  return (...args) => {
    clearTimeout(
      timer
    );

    timer =
      setTimeout(
        () =>
          fn(...args),
        delay
      );
  };
}

init();
