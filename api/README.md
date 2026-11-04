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
| `GITHUB_DISPATCH_TOKEN` | — | Optional. Fine-grained GitHub token for this repo with **Contents: read and write** (what `repository_dispatch` requires). Set → each successful save asks GitHub to rebuild the site (see below). Never logged. `deploy.yml` fills it from the repository secret `DISPATCH_TOKEN` (GitHub secret names cannot start with `GITHUB_`). |
| `GITHUB_REPOSITORY` | `pho0m/pho0m` | `owner/repo` that receives the dispatch. Only used with the token; `deploy.yml` sets it to the repository it runs in. |

## Endpoints

All responses are JSON; errors are `{ "error": "…", "issues"?: [{ path, message }] }`.
Everything except health and login needs `Authorization: Bearer <token>`.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/health` | driver, bucket, public content URL, whether login is configured |
| POST | `/api/auth/login` `{ password }` | `{ token, expiresAt }` (12 h). 401 wrong, 429 (+ `Retry-After`) after 5 failures per IP or 30 failures from all IPs together in 10 min, 503 not configured |
| GET | `/api/auth/me` | `{ ok, expiresAt }` |
| GET | `/api/content` | `{ content, generation, url }` — the seed with `generation: null` until the first save |
| PUT | `/api/content` `{ content, generation }` | validates (400 + issues), copies the previous version to `content/history/`, writes only if `generation` still matches (409 otherwise), then requests a site rebuild when `GITHUB_DISPATCH_TOKEN` is set |
| GET | `/api/content/history` | newest 30 previous versions (50 are kept) |
| GET | `/api/content/history/item?path=content/history/….json` | `{ content }` of one old version |
| GET | `/api/media` | uploads, newest first |
| POST | `/api/media` multipart `file`, optional `folder` | 201 `MediaItem`. Max 15 MB (413). Type comes from the file's magic bytes: JPEG, PNG, GIF, WebP, AVIF, PDF — anything else is 415 |
| DELETE | `/api/media?path=media/…` | `{ ok: true }`; only paths under `media/` |
| GET | `/files/*` | local driver only: serves stored files |

Bucket layout: `content/site.json` (`Cache-Control: no-cache`), `content/history/<time>.json`,
`media/<yyyy>/<mm>/<folder?>/<name>-<random>.<ext>` (`public, max-age=31536000, immutable`).

## Rebuild the site after a save / สั่ง build เว็บใหม่หลังบันทึก

The site reads `content/site.json` live, but the files for search engines and AI crawlers
(the static snapshot and JSON-LD in `index.html`, `sitemap.xml`, `llms.txt`, `llms-full.txt`)
and the profile README are generated at build time. With `GITHUB_DISPATCH_TOKEN` set, a
successful `PUT /api/content` sends

```http
POST https://api.github.com/repos/<GITHUB_REPOSITORY>/dispatches
{"event_type": "content-updated"}
```

which runs `.github/workflows/deploy.yml` (site only: build with the live content, deploy to
Firebase Hosting; no API deploy, no release) and `.github/workflows/readme.yml`.

- **Throttled**: at most one call per 5 minutes. Saves made inside the window are folded into
  one trailing call when the window ends, so a burst of edits costs two workflow runs at most.
- **Fire-and-forget**: the save never waits for GitHub and never fails because of it. Errors are
  logged as `[redeploy] dispatch to … failed (the save itself succeeded): HTTP 401 …` without
  the token. On `SIGTERM` (Cloud Run stopping the instance) a waiting trailing call is sent first.
- Cloud Run only gives an instance CPU while it handles requests, so a call can be delayed
  until the next request reaches it, and an instance that is stopped without `SIGTERM` loses a
  waiting trailing call. The daily scheduled deploy catches anything missed.
- Token: GitHub → Settings → Developer settings → Fine-grained tokens → *Only select repositories*
  `pho0m/pho0m` → Repository permissions → **Contents: Read and write** (Metadata: read is added
  automatically). Give it an expiry date. Step-by-step (Thai): [docs/SETUP.md](../docs/SETUP.md).
- Test a token by sending the event yourself: `204` means it worked and a *Deploy* run (event
  `repository_dispatch`) appears under Actions; `401` = bad or expired token, `403`/`404` = no
  access to the repository or missing *Contents: write*.

  ```sh
  curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.github.com/repos/pho0m/pho0m/dispatches \
    -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
    -d '{"event_type":"content-updated"}'
  ```

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
The per-IP limit uses the **right-most** `X-Forwarded-For` entry, which Google's front end
appends; entries to its left come from the client and are ignored. A second, global limit
(30 failures in 10 minutes from all addresses together) stops brute force from many or forged
addresses. While it is hit, every login answers 429, including the owner's; it clears by itself
after at most 10 minutes (or when the instance restarts).
