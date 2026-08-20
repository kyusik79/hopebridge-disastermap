const express = require("express");
const cors = require("cors");
const multer = require("multer");
const crypto = require("crypto");

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 22,
    fileSize: 12 * 1024 * 1024
  }
});

const {
  UPLOAD_PIN,
  GITHUB_TOKEN,
  GITHUB_OWNER = "kyusik79",
  GITHUB_REPO = "hopebridge-disastermap",
  GITHUB_BRANCH = "main",
  ALLOWED_ORIGIN = "https://hopebridge-disastermap.onrender.com"
} = process.env;

if (!UPLOAD_PIN || !GITHUB_TOKEN) {
  console.warn("WARNING: UPLOAD_PIN 또는 GITHUB_TOKEN이 설정되지 않았습니다.");
}

app.use(express.json({ limit: "1mb" }));

app.use(cors({
  origin(origin, callback) {
    if (!origin || origin === ALLOWED_ORIGIN) {
      return callback(null, true);
    }

    return callback(new Error("허용되지 않은 Origin"));
  },
  methods: ["GET", "POST", "OPTIONS"]
}));

app.get("/health", (_, res) => {
  res.json({ ok: true });
});

app.post(
  "/upload",
  upload.fields([
    { name: "excel", maxCount: 1 },
    { name: "photos", maxCount: 20 }
  ]),
  async (req, res) => {
    try {
      if (!safePinCompare(req.body.pin || "", UPLOAD_PIN || "")) {
        return res.status(401).json({ error: "PIN이 올바르지 않습니다." });
      }

      const disaster = sanitizeSegment(req.body.disaster || "");
      const location = sanitizeSegment(req.body.location || "");
      const caption = String(req.body.caption || "").trim().slice(0, 200);

      const excel = req.files?.excel?.[0] || null;
      const photos = req.files?.photos || [];

      if (!excel && photos.length === 0) {
        return res.status(400).json({ error: "업로드할 파일이 없습니다." });
      }

      if (photos.length && (!disaster || !location)) {
        return res.status(400).json({
          error: "사진 업로드에는 재해구분과 지역명이 필요합니다."
        });
      }

      let updated = 0;

      if (excel) {
        if (!excel.originalname.toLowerCase().endsWith(".xlsx")) {
          return res.status(400).json({ error: "Excel은 .xlsx 파일만 허용됩니다." });
        }

        await putGitHubFile(
          "data/재난현장지도_표준화_데이터.xlsx",
          excel.buffer,
          "Update disaster map Excel data"
        );

        updated += 1;
      }

      if (photos.length) {
        const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
        const photoRows = [];

        for (let i = 0; i < photos.length; i++) {
          const photo = photos[i];

          if (!["image/jpeg", "image/png", "image/webp"].includes(photo.mimetype)) {
            return res.status(400).json({
              error: `${photo.originalname}: 허용되지 않은 이미지 형식입니다.`
            });
          }

          const id = crypto.randomBytes(4).toString("hex");
          const fileName =
            `${date}_${String(i + 1).padStart(2, "0")}_${id}.jpg`;

          const repoPath =
            `images/${disaster}/${location}/${fileName}`;

          await putGitHubFile(
            repoPath,
            photo.buffer,
            `Add field photo: ${disaster} ${location}`
          );

          photoRows.push({
            disaster,
            sido: "",
            sgg: location,
            file: `/${repoPath}`,
            date: new Date().toISOString().slice(0, 10),
            caption,
            photographer: "희망브리지"
          });

          updated += 1;
        }

        await appendPhotosCsv(photoRows);
        updated += 1;
      }

      return res.json({
        ok: true,
        updated_files: updated
      });

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: error.message || "업로드 처리 중 오류가 발생했습니다."
      });
    }
  }
);


app.get("/photos", async (req, res) => {
  try {
    const disaster =
      String(req.query.disaster || "").trim();

    const existing =
      await getExistingFile("data/photos.csv");

    if (!existing?.content) {
      return res.json({ photos: [] });
    }

    const current = Buffer
      .from(existing.content.replace(/\n/g, ""), "base64")
      .toString("utf8")
      .replace(/^\uFEFF/, "");

    const lines = current
      .trim()
      .split(/\r?\n/);

    if (lines.length <= 1) {
      return res.json({ photos: [] });
    }

    const header = parseCsvLine(lines[0])
      .map(h => String(h).trim());

    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);

      if (!cols.some(Boolean)) continue;

      const row = {};

      header.forEach((h, index) => {
        row[h] = cols[index] || "";
      });

      const rowDisaster =
        String(row.disaster || "").trim();

      if (
        disaster &&
        rowDisaster &&
        rowDisaster !== disaster
      ) {
        continue;
      }

      rows.push(row);
    }

    return res.json({
      photos: rows
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: error.message || "사진 목록 조회 중 오류가 발생했습니다."
    });
  }
});

app.post("/delete-photo", async (req, res) => {
  try {
    if (!safePinCompare(req.body.pin || "", UPLOAD_PIN || "")) {
      return res.status(401).json({
        error: "PIN이 올바르지 않습니다."
      });
    }

    const rawFile = String(req.body.file || "").trim();

    if (!rawFile) {
      return res.status(400).json({
        error: "삭제할 사진 경로가 없습니다."
      });
    }

    /*
      photos.csv에는 /images/... 형식으로 저장되므로
      GitHub API용 경로에서는 앞의 /를 제거합니다.
    */
    const repoPath = rawFile.replace(/^\/+/, "");

    if (!repoPath.startsWith("images/")) {
      return res.status(400).json({
        error: "images 폴더의 사진만 삭제할 수 있습니다."
      });
    }

    await deleteGitHubFile(
      repoPath,
      `Delete field photo: ${repoPath}`
    );

    await removePhotoFromCsv(rawFile);

    return res.json({
      ok: true
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: error.message || "사진 삭제 중 오류가 발생했습니다."
    });
  }
});


function safePinCompare(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));

  if (aa.length !== bb.length) return false;

  return crypto.timingSafeEqual(aa, bb);
}

function sanitizeSegment(value) {
  return String(value)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\.\./g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function githubHeaders() {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${GITHUB_TOKEN}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "hopebridge-disastermap-upload"
  };
}

function contentUrl(path) {
  const encodedPath = path
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  return `https://api.github.com/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(GITHUB_REPO)}/contents/${encodedPath}`;
}

async function getExistingFile(path) {
  const response = await fetch(
    `${contentUrl(path)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
    { headers: githubHeaders() }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub 파일 조회 실패: ${path} (${response.status})`);
  }

  return await response.json();
}

async function putGitHubFile(path, buffer, message) {
  const existing = await getExistingFile(path);

  const body = {
    message,
    content: buffer.toString("base64"),
    branch: GITHUB_BRANCH
  };

  if (existing?.sha) {
    body.sha = existing.sha;
  }

  const response = await fetch(contentUrl(path), {
    method: "PUT",
    headers: {
      ...githubHeaders(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `GitHub 저장 실패: ${path} (${response.status}) ${detail.slice(0, 300)}`
    );
  }

  return await response.json();
}

async function deleteGitHubFile(path, message) {
  const existing = await getExistingFile(path);

  if (!existing?.sha) {
    throw new Error(`GitHub에서 사진을 찾지 못했습니다: ${path}`);
  }

  const response = await fetch(contentUrl(path), {
    method: "DELETE",
    headers: {
      ...githubHeaders(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message,
      sha: existing.sha,
      branch: GITHUB_BRANCH
    })
  });

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `GitHub 사진 삭제 실패 (${response.status}) ${detail.slice(0, 300)}`
    );
  }
}

async function removePhotoFromCsv(filePath) {
  const path = "data/photos.csv";
  const existing = await getExistingFile(path);

  if (!existing?.content) {
    return;
  }

  const current = Buffer
    .from(existing.content.replace(/\n/g, ""), "base64")
    .toString("utf8")
    .replace(/^\uFEFF/, "");

  const lines = current
    .trim()
    .split(/\r?\n/);

  if (lines.length <= 1) {
    return;
  }

  const header = parseCsvLine(lines[0]);
  const fileIndex = header.findIndex(
    h => String(h).trim() === "file"
  );

  if (fileIndex < 0) {
    throw new Error("photos.csv에 file 열이 없습니다.");
  }

  const kept = [lines[0]];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);

    if (
      String(cols[fileIndex] || "").trim()
      === String(filePath || "").trim()
    ) {
      continue;
    }

    kept.push(lines[i]);
  }

  const output = Buffer.from(
    "\uFEFF" + kept.join("\n") + "\n",
    "utf8"
  );

  await putGitHubFile(
    path,
    output,
    "Remove deleted field photo from registry"
  );
}


async function appendPhotosCsv(rows) {
  const path = "data/photos.csv";
  const existing = await getExistingFile(path);

  let current = "";

  if (existing?.content) {
    current = Buffer
      .from(existing.content.replace(/\n/g, ""), "base64")
      .toString("utf8")
      .replace(/^\uFEFF/, "");
  }

  const requiredHeader =
    "disaster,sido,sgg,file,date,caption,photographer";

  let lines = current.trim()
    ? current.trim().split(/\r?\n/)
    : [];

  if (!lines.length) {
    lines = [requiredHeader];
  } else {
    const header = lines[0].split(",").map(x => x.trim());

    if (!header.includes("disaster")) {
      // 기존 7열 CSV 형식을 새 7열 형식으로 변환
      const converted = [requiredHeader];

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);

        if (!cols.some(Boolean)) continue;

        // 기존: sido,sgg,sgg_code,file,date,caption,photographer
        converted.push(
          [
            "",
            cols[0] || "",
            cols[1] || "",
            cols[3] || "",
            cols[4] || "",
            cols[5] || "",
            cols[6] || ""
          ].map(csvCell).join(",")
        );
      }

      lines = converted;
    }
  }

  rows.forEach(r => {
    lines.push(
      [
        r.disaster,
        r.sido,
        r.sgg,
        r.file,
        r.date,
        r.caption,
        r.photographer
      ].map(csvCell).join(",")
    );
  });

  const output = Buffer.from(
    "\uFEFF" + lines.join("\n") + "\n",
    "utf8"
  );

  await putGitHubFile(
    path,
    output,
    "Update field photo registry"
  );
}

function csvCell(value) {
  const s = String(value ?? "");

  if (/[",\n\r]/.test(s)) {
    return `"${s.replaceAll('"', '""')}"`;
  }

  return s;
}

function parseCsvLine(line) {
  const out = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      out.push(value);
      value = "";
    } else {
      value += ch;
    }
  }

  out.push(value);

  return out;
}

const port = process.env.PORT || 10000;

app.listen(port, () => {
  console.log(`Upload API listening on ${port}`);
});
