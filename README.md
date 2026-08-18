# 희망브리지 재난현장지도

GitHub + Render.com 정적 웹사이트용 기본 파일 세트입니다.

## 1. 핵심 운영 원칙

코드는 거의 수정하지 않고 데이터 CSV만 교체합니다.

- `data/disaster.csv` : 행정안전부 구호상황 보고의 시군구별 대피·귀가·미귀가 현황
- `data/support.csv` : 희망브리지 현장 반입·지원 총량
- `data/photos.csv` : 지역별 현장사진 연결정보
- `images/` : 실제 현장사진 파일

엑셀 원본은 `재난현장지도_데이터관리.xlsx`로 관리한 뒤 각 시트를 CSV UTF-8로 저장하여 위 파일을 교체하면 됩니다.

## 2. 지도 경계

웹 실행 시 `admdongkor`의 2026-07-01 시군구 light 경계를 불러옵니다.
- 지도 레벨: 시군구(sgg)
- 좌표계: WGS84 / EPSG:4326
- `app.js`의 `DATA_VERSION = "20260701"`에서 버전을 지정합니다.

주의: 해당 공개 프로젝트는 통계청 SGIS 자료를 기반으로 행정구역 변경 이력을 보정한 공개 데이터셋입니다. 협회 공식 운영 단계에서는 최신 행정구역 경계의 적합성을 정기 확인하십시오.

## 3. GitHub 업로드

현재 저장소 루트에 다음 파일과 폴더를 그대로 업로드합니다.

- index.html
- style.css
- app.js
- data/
- images/
- README.md

## 4. Render 설정

Render > New > Static Site > GitHub 저장소 연결

- Branch: `main`
- Build Command: 공란
- Publish Directory: `.`

코드가 순수 정적 파일이므로 빌드 과정이 필요 없습니다.

## 5. disaster.csv 작성 규칙

컬럼명은 변경하지 않는 것을 권장합니다.

- `sido`
- `sgg`
- `sgg_code` : 5자리 시군구 코드
- `evacuated_households`
- `evacuated_people`
- `returned_households`
- `returned_people`
- `remaining_households`
- `remaining_people`
- `evacuation_reason`
- `as_of`
- `report_no`

지도 버블은 기본적으로 `remaining_people`을 사용하며, 화면에서 `evacuated_people`으로 전환할 수 있습니다.

## 6. photos.csv 작성 예시

```csv
sido,sgg,sgg_code,file,date,caption,photographer
경상남도,거제시,48310,/images/geoje/01.jpg,2026-08-18,거제시 침수지역 현장,희망브리지
경상남도,거제시,48310,/images/geoje/02.jpg,2026-08-18,주민 대피 현장,희망브리지
```

그 뒤 실제 파일을 다음과 같이 저장합니다.

```text
images/
  geoje/
    01.jpg
    02.jpg
```

## 7. 통계 갱신 실무

1. 새 행안부 상황보고 수신
2. `재난현장지도_데이터관리.xlsx`의 피해현황 시트 수정
3. 피해현황 시트를 `CSV UTF-8`로 저장
4. 파일명을 `disaster.csv`로 변경
5. GitHub의 `data/disaster.csv` 교체
6. Render 자동 재배포 후 웹페이지 확인

## 8. 현재 포함 데이터

사용자가 제공한 「8.15.~18. 호우 구호 상황 보고(8보)」의 2026.8.18. 09:30 기준 시군구별 일시대피 현황을 반영한 프로토타입 데이터입니다.

구호지원 수치는 같은 보고서에 기재된 희망브리지 지원 총량 가운데:
- 일시구호세트 336개
- 쉘터 및 바닥매트 100동
- 생수 13,440병

을 예시 화면에 반영했습니다.
