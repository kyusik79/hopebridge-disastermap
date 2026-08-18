const svg =
  d3.select("#map");

const mapWrap =
  document.getElementById(
    "map-wrap"
  );

const loadingEl =
  document.getElementById(
    "map-loading"
  );

const errorEl =
  document.getElementById(
    "map-error"
  );


let disaster = [];

let support = [];

let photos = [];

let boundaries = null;

let activeMetric =
  "remaining_people";

let width = 900;

let height = 760;


const fmt =
  new Intl.NumberFormat(
    "ko-KR"
  );


const metricNames = {

  remaining_people:
    "현재 미귀가",

  evacuated_people:
    "누적 일시대피"

};


/*
  시군구 지도 데이터

  southkorea-maps 공개 저장소의
  municipalities GeoJSON 사용
*/
const MAP_URL =
  "https://cdn.jsdelivr.net/gh/southkorea/southkorea-maps@master/gadm/json/skorea-municipalities-geo.json";


/*
  현재 행안부 8보 피해지역 대표 좌표
*/

const regionPoints = {

  "26170": [
    129.0474,
    35.1293
  ],

  "26200": [
    129.0679,
    35.0912
  ],

  "26380": [
    128.9747,
    35.1046
  ],

  "26440": [
    128.9805,
    35.2122
  ],

  "48220": [
    128.4330,
    34.8544
  ],

  "48240": [
    128.0642,
    35.0038
  ],

  "48310": [
    128.6211,
    34.8806
  ],

  "48840": [
    127.8925,
    34.8375
  ],

  "50130": [
    126.5601,
    33.2541
  ]

};


/*
  지도 확대·축소
*/

const zoom =
  d3.zoom()
    .scaleExtent([
      1,
      8
    ])
    .on(
      "zoom",
      event => {

        svg
          .select(
            ".map-root"
          )
          .attr(
            "transform",
            event.transform
          );

      }
    );


svg.call(zoom);


/*
  숫자 변환
*/

function numberValue(
  value
) {

  return (
    Number(
      String(
        value ?? ""
      )
        .replaceAll(
          ",",
          ""
        )
        .trim()
    ) || 0
  );

}


/*
  CSV 불러오기
*/

async function loadCsv(
  path
) {

  const response =
    await fetch(
      path,
      {
        cache:
          "no-store"
      }
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `${path} 로드 실패 (${response.status})`
    );

  }


  return d3.csvParse(
    await response.text()
  );

}


/*
  GeoJSON 불러오기
*/

async function loadJson(
  path
) {

  const response =
    await fetch(
      path,
      {
        cache:
          "no-store"
      }
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `지도 데이터 로드 실패 (${response.status})`
    );

  }


  return await response.json();

}


/*
  초기 실행
*/

async function init() {

  try {

    [
      disaster,
      support,
      photos,
      boundaries

    ] =
      await Promise.all([

        loadCsv(
          "data/disaster.csv"
        ),

        loadCsv(
          "data/support.csv"
        ),

        loadCsv(
          "data/photos.csv"
        ),

        loadJson(
          MAP_URL
        )

      ]);


    /*
      숫자 필드 정리
    */

    disaster =
      disaster.map(
        d => ({

          ...d,

          sgg_code:
            String(
              d.sgg_code ||
              ""
            )
              .trim(),

          evacuated_people:
            numberValue(
              d.evacuated_people
            ),

          returned_people:
            numberValue(
              d.returned_people
            ),

          remaining_people:
            numberValue(
              d.remaining_people
            ),

          evacuated_households:
            numberValue(
              d.evacuated_households
            ),

          returned_households:
            numberValue(
              d.returned_households
            ),

          remaining_households:
            numberValue(
              d.remaining_households
            )

        })
      );


    support =
      support.map(
        d => ({

          ...d,

          quantity:
            numberValue(
              d.quantity
            )

        })
      );


    photos =
      photos.filter(
        d =>
          String(
            d.file ||
            ""
          )
            .trim()
      );


    updateHeader();

    updateSummary();

    updateRanking();

    renderSupport();

    renderEmptyPhotos();


    loadingEl
      .classList
      .add(
        "hidden"
      );


    resize();


    window
      .addEventListener(
        "resize",
        debounce(
          resize,
          120
        )
      );

  }

  catch (
    error
  ) {

    console.error(
      error
    );


    loadingEl
      .classList
      .add(
        "hidden"
      );


    errorEl
      .classList
      .remove(
        "hidden"
      );


    errorEl.innerHTML = `

      <strong>
        데이터를 불러오지 못했습니다.
      </strong>

      <div
        style="
          margin-top:10px;
        "
      >
        ${error.message}
      </div>

    `;

  }

}


/*
  지도 크기
*/

function resize() {

  const rect =
    mapWrap
      .getBoundingClientRect();


  width =
    Math.max(
      560,
      rect.width
    );


  height =
    Math.max(
      560,
      rect.height
    );


  svg.attr(
    "viewBox",
    `0 0 ${width} ${height}`
  );


  if (
    boundaries
  ) {

    drawMap();

  }

}


/*
  기준시각
*/

function updateHeader() {

  const first =
    disaster.find(
      d =>
        d.as_of
    );


  document
    .getElementById(
      "asof-text"
    )
    .textContent =
      first?.as_of ||
      "-";

}


/*
  전국 합계
*/

function updateSummary() {

  document
    .getElementById(
      "sum-regions"
    )
    .textContent =
      fmt.format(
        disaster.length
      );


  document
    .getElementById(
      "sum-evacuated"
    )
    .textContent =
      fmt.format(
        d3.sum(
          disaster,
          d =>
            d.evacuated_people
        )
      );


  document
    .getElementById(
      "sum-remaining"
    )
    .textContent =
      fmt.format(
        d3.sum(
          disaster,
          d =>
            d.remaining_people
        )
      );

}


/*
  TOP5
*/

function updateRanking() {

  const rows =
    [
      ...disaster
    ]
      .sort(
        (
          a,
          b
        ) =>
          b[
            activeMetric
          ]
          -
          a[
            activeMetric
          ]
      )
      .slice(
        0,
        5
      );


  document
    .getElementById(
      "ranking-title"
    )
    .textContent =
      `${metricNames[activeMetric]} TOP 5`;


  const tbody =
    document
      .getElementById(
        "ranking-body"
      );


  tbody.innerHTML =
    "";


  rows.forEach(
    (
      d,
      index
    ) => {

      const tr =
        document
          .createElement(
            "tr"
          );


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
          ${fmt.format(
            d.remaining_people
          )}
        </td>

      `;


      tr
        .addEventListener(
          "click",
          () =>
            selectRegion(
              d
            )
        );


      tbody
        .appendChild(
          tr
        );

    }
  );

}


/*
  지도 그리기
*/

function drawMap() {

  svg
    .selectAll(
      "*"
    )
    .remove();


  const root =
    svg
      .append(
        "g"
      )
      .attr(
        "class",
        "map-root"
      );


  const projection =
    d3
      .geoMercator()
      .fitExtent(
        [

          [
            55,
            60
          ],

          [
            width - 55,
            height - 55
          ]

        ],

        boundaries
      );


  const path =
    d3
      .geoPath(
        projection
      );


  /*
    시군구 경계
  */

  root
    .append(
      "g"
    )
    .selectAll(
      "path"
    )
    .data(
      boundaries.features
    )
    .join(
      "path"
    )
    .attr(
      "class",
      "region"
    )
    .attr(
      "d",
      path
    );


  /*
    피해지역 중 값이 있는 지역만
  */

  const positive =
    disaster.filter(
      d =>
        d[
          activeMetric
        ] > 0
        &&
        regionPoints[
          d.sgg_code
        ]
    );


  const maxValue =
    d3.max(
      positive,
      d =>
        d[
          activeMetric
        ]
    ) || 1;


  /*
    원 면적 비례
  */

  const radius =
    d3
      .scaleSqrt()
      .domain(
        [
          1,
          maxValue
        ]
      )
      .range(
        [
          7,
          48
        ]
      );


  const points =
    positive.map(
      d => {

        const [
          x,
          y
        ] =
          projection(
            regionPoints[
              d.sgg_code
            ]
          );


        return {

          ...d,

          x,

          y,

          r:
            radius(
              d[
                activeMetric
              ]
            )

        };

      }
    );


  /*
    원 표시
  */

  const groups =
    root
      .append(
        "g"
      )
      .selectAll(
        "g"
      )
      .data(
        points
      )
      .join(
        "g"
      )
      .attr(
        "transform",
        d =>
          `translate(${d.x},${d.y})`
      )
      .on(
        "click",
        (
          event,
          d
        ) => {

          event
            .stopPropagation();


          selectRegion(
            d
          );

        }
      );


  groups
    .append(
      "circle"
    )
    .attr(
      "class",
      "bubble"
    )
    .attr(
      "r",
      d =>
        d.r
    );


  /*
    원 안 숫자
  */

  groups
    .filter(
      d =>
        d.r >= 11
    )
    .append(
      "text"
    )
    .attr(
      "class",
      "bubble-value"
    )
    .attr(
      "y",
      5
    )
    .style(
      "font-size",
      d =>
        d.r >= 22
          ? "17px"
          : "10px"
    )
    .text(
      d =>
        fmt.format(
          d[
            activeMetric
          ]
        )
    );


  /*
    지역명
  */

  groups
    .append(
      "text"
    )
    .attr(
      "class",
      "map-place-label"
    )
    .attr(
      "x",
      d =>
        d.r + 9
    )
    .attr(
      "y",
      4
    )
    .text(
      d =>
        d.sgg
    );

}


/*
  지역 선택
*/

function selectRegion(
  d
) {

  document
    .getElementById(
      "detail-empty"
    )
    .classList
    .add(
      "hidden"
    );


  document
    .getElementById(
      "detail-content"
    )
    .classList
    .remove(
      "hidden"
    );


  document
    .getElementById(
      "clear-selection"
    )
    .classList
    .remove(
      "hidden"
    );


  document
    .getElementById(
      "detail-title"
    )
    .textContent =
      `${d.sido} ${d.sgg}`;


  document
    .getElementById(
      "detail-evacuated"
    )
    .textContent =
      `${fmt.format(
        d.evacuated_people
      )}명`;


  document
    .getElementById(
      "detail-returned"
    )
    .textContent =
      `${fmt.format(
        d.returned_people
      )}명`;


  document
    .getElementById(
      "detail-remaining"
    )
    .textContent =
      `${fmt.format(
        d.remaining_people
      )}명`;


  document
    .getElementById(
      "detail-reason"
    )
    .textContent =
      d.evacuation_reason
      ||
      "-";


  renderPhotos(
    d.sgg_code
  );

}


/*
  선택 해제
*/

function clearSelection() {

  document
    .getElementById(
      "detail-empty"
    )
    .classList
    .remove(
      "hidden"
    );


  document
    .getElementById(
      "detail-content"
    )
    .classList
    .add(
      "hidden"
    );


  document
    .getElementById(
      "clear-selection"
    )
    .classList
    .add(
      "hidden"
    );


  document
    .getElementById(
      "detail-title"
    )
    .textContent =
      "지역을 선택해 주세요";


  renderEmptyPhotos();

}


/*
  현장사진
*/

function renderPhotos(
  code
) {

  const arr =
    photos.filter(
      p =>
        String(
          p.sgg_code
        )
        ===
        String(
          code
        )
    );


  const grid =
    document
      .getElementById(
        "photo-grid"
      );


  const empty =
    document
      .getElementById(
        "photo-empty"
      );


  document
    .getElementById(
      "photos-count"
    )
    .textContent =
      `${arr.length}장`;


  grid.innerHTML =
    "";


  empty
    .classList
    .toggle(
      "hidden",
      arr.length > 0
    );


  arr.forEach(
    p => {

      const anchor =
        document
          .createElement(
            "a"
          );


      anchor.className =
        "photo-card";


      anchor.href =
        p.file;


      anchor.target =
        "_blank";


      anchor.rel =
        "noopener";


      anchor.innerHTML = `

        <img

          src="${p.file}"

          alt="${
            p.caption ||
            "현장사진"
          }"

        >

      `;


      grid
        .appendChild(
          anchor
        );

    }
  );

}


/*
  사진 없음
*/

function renderEmptyPhotos() {

  document
    .getElementById(
      "photo-grid"
    )
    .innerHTML =
      "";


  document
    .getElementById(
      "photos-count"
    )
    .textContent =
      "0장";


  document
    .getElementById(
      "photo-empty"
    )
    .classList
    .remove(
      "hidden"
    );

}


/*
  희망브리지 지원현황
*/

function renderSupport() {

  const grid =
    document
      .getElementById(
        "support-grid"
      );


  grid.innerHTML =
    "";


  support.forEach(
    d => {

      const div =
        document
          .createElement(
            "div"
          );


      div.className =
        "support-card";


      div.innerHTML = `

        <span>
          ${d.item}
        </span>

        <strong>
          ${fmt.format(
            d.quantity
          )}
        </strong>

        <small>
          ${d.unit}
        </small>

      `;


      grid
        .appendChild(
          div
        );

    }
  );

}


/*
  지표 변경
*/

document
  .querySelectorAll(
    ".metric-btn"
  )
  .forEach(
    button => {

      button
        .addEventListener(
          "click",
          () => {

            document
              .querySelectorAll(
                ".metric-btn"
              )
              .forEach(
                b =>
                  b
                    .classList
                    .remove(
                      "active"
                    )
              );


            button
              .classList
              .add(
                "active"
              );


            activeMetric =
              button.dataset.metric;


            document
              .getElementById(
                "legend-metric"
              )
              .textContent =
                activeMetric
                ===
                "remaining_people"
                ?
                "(미귀가 인원)"
                :
                "(일시대피 인원)";


            updateRanking();

            drawMap();

          }
        );

    }
  );


/*
  전국보기
*/

document
  .getElementById(
    "reset-view"
  )
  .addEventListener(
    "click",
    () => {

      svg
        .transition()
        .duration(
          350
        )
        .call(
          zoom.transform,
          d3.zoomIdentity
        );

    }
  );


/*
  선택 해제
*/

document
  .getElementById(
    "clear-selection"
  )
  .addEventListener(
    "click",
    clearSelection
  );


function debounce(
  fn,
  delay
) {

  let timer;


  return (
    ...args
  ) => {

    clearTimeout(
      timer
    );


    timer =
      setTimeout(
        () =>
          fn(
            ...args
          ),
        delay
      );

  };

}


/*
  시작
*/

init();
