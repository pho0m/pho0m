# @pho0m/api — admin API

Small Hono server behind the admin page. It saves the site content (`content/site.json`) and
uploaded media to a Google Cloud Storage bucket, and the public site reads those objects
straight from the bucket. Contract: [`packages/content/src/api.ts`](../packages/content/src/api.ts).

API ตัวเล็กสำหรับหน้าแอดมิน: บันทึกเนื้อหาเว็บและไฟล์ที่อัปโหลดลง GCS bucket
แล้วหน้าเว็บอ่านไฟล์จาก bucket โดยตรง

## Run locally / รันในเครื่อง

```sh
npm install                      # once, at the repo root
cp api/.env.example api/.env     # set ADMIN_PASSWORD at least
npm run dev:api                  # http://localhost:8787 (web dev server proxies /api here)
```

With no bucket configured the **local driver** stores everything in `api/.data/` and serves it
at `http://localhost:8787/files/…`, so no GCP account is needed for development.
ถ้าไม่ได้ตั้ง bucket ระบบจะเก็บไฟล์ไว้ใน `api/.data/` แทน ใช้พัฒนาได้เลยโดยไม่ต้องมี GCP

```sh
npm run test -w api              # vitest (memory, local-disk and fake-GCS drivers)
npm run typecheck -w api
npm run build -w api             # esbuild bundle → api/dist/server.js
ADMIN_PASSWORD=test npm run start -w api
```

## Environment / ตัวแปรแวดล้อม

| Variable | Default | Notes |
| --- | --- | --- |
| `ADMIN_PASSWORD` | — | Required to log in. Missing → login answers 503. |
| `SERVICE_ACCOUNT_BUCKET_NAME` | — | GCS bucket. Missing → local driver. |
| `SERVICE_ACCOUNT_KEY` | — | Service-account key: raw JSON or base64 of it. Missing with a bucket → Application Default Credentials (Cloud Run's service account). Never logged. |
| `SESSION_SECRET` | derived | HS256 secret. Default: HMAC-SHA256 of the key's `private_key`, else of `ADMIN_PASSWORD`. |
| `ALLOWED_ORIGINS` | site + firebaseapp + localhost:5173/4173 | Comma list; replaces the defaults. |
| `PORT` | `8787` | Cloud Run sets `8080`. |
| `PUBLIC_BASE_URL` | `http://localhost:PORT` | Base of local-driver file URLs. |
| `DATA_DIR` | `api/.data` | Local driver folder. |

## Endpoints

All responses are JSON; errors are `{ "error": "…", "issues"?: [{ path, message }] }`.
Everything except health and login needs `Authorization: Bearer <token>`.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/health` | driver, bucket, public content URL, whether login is configured |
| POST | `/api/auth/login` `{ password }` | `{ token, expiresAt }` (12 h). 401 wrong, 429 after 5 failures per IP in 10 min, 503 not configured |
| GET | `/api/auth/me` | `{ ok, expiresAt }` |
| GET | `/api/content` | `{ content, generation, url }` — the seed with `generation: null` until the first save |
| PUT | `/api/content` `{ content, generation }` | validates (400 + issues), copies the previous version to `content/history/`, writes only if `generation` still matches (409 otherwise) |
| GET | `/api/content/history` | newest 30 previous versions (50 are kept) |
| GET | `/api/content/history/item?path=content/history/….json` | `{ content }` of one old version |
| GET | `/api/media` | uploads, newest first |
| POST | `/api/media` multipart `file`, optional `folder` | 201 `MediaItem`. Max 15 MB (413). Type comes from the file's magic bytes: JPEG, PNG, GIF, WebP, AVIF, PDF — anything else is 415 |
| DELETE | `/api/media?path=media/…` | `{ ok: true }`; only paths under `media/` |
| GET | `/files/*` | local driver only: serves stored files |

Bucket layout: `content/site.json` (`Cache-Control: no-cache`), `content/history/<time>.json`,
`media/<yyyy>/<mm>/<folder?>/<name>-<random>.<ext>` (`public, max-age=31536000, immutable`).

## Bucket setup / ตั้งค่า bucket

```sh
SERVICE_ACCOUNT_BUCKET_NAME=my-bucket SERVICE_ACCOUNT_KEY="$(base64 -w0 key.json)" \
  npm run setup:bucket -w api            # add -- --dry-run to only report
```

It is safe to run again. It sets CORS (GET/HEAD from any origin), turns on uniform
bucket-level access and grants `allUsers` `roles/storage.objectViewer` so the site can read
the objects. When the credentials lack permission it prints the `gcloud` command to run instead.
The API's own service account needs `roles/storage.objectAdmin` on the bucket.

## Deploy (Cloud Run)

```sh
IMAGE=asia-southeast1-docker.pkg.dev/<project>/<repo>/pho0m-api
docker build -f api/Dockerfile -t "$IMAGE" .      # from the repo root
docker push "$IMAGE"
gcloud run deploy pho0m-api --image "$IMAGE" --region asia-southeast1 --allow-unauthenticated \
  --max-instances 1 --set-env-vars SERVICE_ACCOUNT_BUCKET_NAME=<bucket> \
  --set-secrets ADMIN_PASSWORD=<secret-name>:latest
```

The image contains only the bundled `dist/server.js` and runs as the `node` user on port 8080.
Set `ADMIN_PASSWORD` (preferably from Secret Manager) and `SERVICE_ACCOUNT_BUCKET_NAME`; on
Cloud Run you can skip `SERVICE_ACCOUNT_KEY` and give the service account access to the bucket.
Then build the site with `VITE_API_URL=<run url>` and `VITE_CONTENT_URL=https://storage.googleapis.com/<bucket>/content/site.json`.

Login throttling is kept in memory per instance; keep `--max-instances` low (1 is plenty).
