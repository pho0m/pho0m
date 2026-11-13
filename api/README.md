# @pho0m/api — admin API

Small Hono server behind the admin page. It saves the site content and uploaded media to a
Google Cloud Storage bucket, and the public site reads `content/site.json` and the media
straight from the bucket. Drafts, hidden items and old versions are stored only encrypted
(see [Private data](#private-data--ข้อมูลที่ไม่เผยแพร่)).
Contract: [`packages/content/src/api.ts`](../packages/content/src/api.ts).

API ตัวเล็กสำหรับหน้าแอดมิน: บันทึกเนื้อหาเว็บและไฟล์ที่อัปโหลดลง GCS bucket
แล้วหน้าเว็บอ่านไฟล์จาก bucket โดยตรง ฉบับร่าง ของที่ซ่อน และประวัติ เก็บแบบเข้ารหัสเท่านั้น

## Run locally / รันในเครื่อง

```sh
npm install                      # once, at the repo root
cp api/.env.example api/.env     # set ADMIN_PASSWORD at least
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> api/.env   # keeps you logged in and drafts readable across restarts
npm run dev:api                  # http://localhost:8787 (web dev server proxies /api here)
```

Without `SESSION_SECRET` the server makes up a random secret each time it starts, and
`dev:api` restarts on every code change: you are logged out and earlier drafts can no longer be
decrypted (see [Private data](#private-data--ข้อมูลที่ไม่เผยแพร่)).
ถ้าไม่ตั้ง `SESSION_SECRET` ทุกครั้งที่เซิร์ฟเวอร์รีสตาร์ตจะหลุดจากระบบ และอ่านฉบับร่างเดิมไม่ได้

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
| `SESSION_SECRET` | see notes | Server secret, at least 32 characters (`openssl rand -hex 32`); shorter → the server refuses to start. Signs session tokens (HS256) and, through HKDF, encrypts the private copy of the content. Missing → derived from the key's `private_key` when `SERVICE_ACCOUNT_KEY` is set, otherwise **random per process** (startup warning: sessions and encrypted drafts do not survive a restart). Never derived from `ADMIN_PASSWORD`. Set it in production; `deploy.yml` passes it to Cloud Run. Changing it logs everyone out and makes saved drafts unreadable (see below). |
| `ALLOWED_ORIGINS` | https://kiattiphoom-pho0m.pages.dev + localhost:5173/4173 | Comma list; replaces the defaults. deploy.yml sets it from `SITE_URL` and the Pages project. |
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
| POST | `/api/auth/login` `{ password }` | `{ token, expiresAt }` (12 h). Needs `Content-Type: application/json` (415 otherwise); an `Origin` header, when sent, must be in `ALLOWED_ORIGINS` (403 otherwise). 401 wrong, 429 after 5 failures per IP in 10 min (+ `Retry-After`) or while the global limit is hit (see [Login limits](#login-limits)), 503 not configured |
| GET | `/api/auth/me` | `{ ok, expiresAt }` |
| GET | `/api/content` | `{ content, generation, url, warning? }` — the full content (drafts included), decrypted from `private/content.enc`; `generation` is that object's. Before the first save: the seed with `generation: null`. `warning` see [Private data](#private-data--ข้อมูลที่ไม่เผยแพร่) |
| PUT | `/api/content` `{ content, generation }` | validates (400 + issues); writes the encrypted full content only if `generation` still matches (409 otherwise), then the public projection to `content/site.json`, then the previous version (encrypted) to history; then requests a site rebuild. Answers `{ generation, updatedAt, url, redeploy }`, `redeploy` = `sent` / `queued` / `failed` / `off` |
| GET | `/api/content/history` | newest 30 previous versions (50 are kept); `path` values are opaque |
| GET | `/api/content/history/item?path=…` | `{ content }` of one old version; `path` exactly as listed (today `private/history/<time>.enc`) |
| GET | `/api/media` | uploads, newest first |
| POST | `/api/media` multipart `file`, optional `folder` | 201 `MediaItem`. Max 15 MB (413). Type comes from the file's magic bytes: JPEG, PNG, GIF, WebP, AVIF, PDF — anything else is 415 |
| DELETE | `/api/media?path=media/…` | `{ ok: true }`; only paths under `media/` |
| GET | `/files/*` | local driver only: serves stored files |

Bucket layout (everything in the bucket is publicly readable):

| Object | Contents |
| --- | --- |
| `content/site.json` | public projection, plain JSON, `Cache-Control: no-cache`. What the site reads. |
| `private/content.enc` | full content (drafts, hidden items, hidden email/phone), encrypted, `private, no-store` |
| `private/history/<time>.enc` | previous full versions, encrypted, newest 50 kept |
| `media/<yyyy>/<mm>/<folder?>/<name>-<random>.<ext>` | uploads, `public, max-age=31536000, immutable` |

## Private data / ข้อมูลที่ไม่เผยแพร่

The bucket has to be public for the site, so the API never stores anything non-public in
readable form:

- `content/site.json` holds only `publicProjection(content)` from `@pho0m/content`: frames,
  projects and Utotech projects with `published: false` are removed, email/phone values not
  marked visible are blanked, documents without a URL are removed.
- The full document lives in `private/content.enc` and each replaced version in
  `private/history/`, as AES-256-GCM envelopes `{"v":1,"iv","tag","data"}` (base64, a new
  random 12-byte IV on every write). The key is HKDF-SHA256 of the server secret
  (`SESSION_SECRET`, info `pho0m-content-v1`). Anyone can download these objects, but without
  the secret they are noise. No IAM change is needed.
- Saving: (1) encrypted full content to `private/content.enc`, with the generation check
  (this is the 409 conflict check); (2) the projection to `content/site.json`; (3) the
  previous version to `private/history/`, then prune to 50. Saves run one at a time per
  instance. If (2) fails the answer is 500 with the new `generation`: save again. A failure in
  (3) is only logged.

**Upgrading from plaintext storage.** Older versions stored the full document in
`content/site.json` and history in `content/history/*.json`. While `private/content.enc` does
not exist, `GET /api/content` reads `content/site.json` (with `generation: null`). The first save
after the upgrade writes `private/content.enc`, replaces `content/site.json` with the
projection, keeps the old full copy as an encrypted history entry and moves every
`content/history/*.json` into `private/history/` (encrypted), deleting the plaintext. Until that
first save the old public files still contain everything, so open `/admin` and save once right
after deploying.
อัปเกรดจากเวอร์ชันเก่า: หลัง deploy ให้เข้า `/admin` แล้วกดบันทึกหนึ่งครั้ง
ระบบจะย้ายข้อมูลเดิมไปเก็บแบบเข้ารหัส และลบไฟล์ประวัติแบบอ่านได้ออก

**When the secret changes.** Changing `SESSION_SECRET` (or the service-account key it was
derived from, or running without either so a random one is used and the process restarts)
makes `private/content.enc` unreadable. `GET /api/content` then answers 200 with the
**published** version (`content/site.json`, or the seed if that is missing),
`"warning": "drafts could not be decrypted; showing the published version"`, and the
generation of `private/content.enc`, so the next save overwrites it with the new key.
Unpublished frames and projects and hidden email/phone values exist only in the encrypted copy,
so they are lost unless the old secret is put back. The unreadable copy is kept in history as it
was; history entries written with the old secret answer 500 "could not be decrypted".
เปลี่ยน `SESSION_SECRET` แล้วฉบับร่างและข้อมูลที่ซ่อนไว้จะอ่านไม่ได้ หน้าแอดมินจะแสดงเฉพาะฉบับที่เผยแพร่แล้ว
ถ้าต้องการเก็บไว้ ให้ใส่ secret เดิมกลับก่อนบันทึก

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
Cloudflare Pages; no API deploy, no release) and `.github/workflows/readme.yml`.

- **Part of the save request**: the API waits for GitHub (at most 4 s) before it answers, and
  reports the result as `redeploy` in the `PUT` response: `sent` (GitHub accepted it),
  `queued`, `failed` (refused or timed out) or `off` (no token). Cloud Run throttles the CPU of
  an instance once no request is in progress, so nothing is left to run after the response.
  The save itself never fails because of the dispatch. Errors are logged as
  `[redeploy] dispatch to … failed (the save itself succeeded): HTTP 401 …` without the token.
- **Rate-limited**: at most one call per 2 minutes. A save inside the window answers `queued`
  and the call goes out with the next save after the window (there are no background timers).
  A failed call is retried the same way. On `SIGTERM` (Cloud Run stopping the instance) a queued
  call is sent first. If no later save comes and the instance is stopped without `SIGTERM`, the
  daily scheduled deploy picks up the change.
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
`objectViewer` also lets anyone list and download `private/`; that is fine because those objects
are ciphertext (see [Private data](#private-data--ข้อมูลที่ไม่เผยแพร่)).

## Deploy (Cloud Run)

```sh
IMAGE=asia-southeast1-docker.pkg.dev/<project>/<repo>/pho0m-api
docker build -f api/Dockerfile -t "$IMAGE" .      # from the repo root
docker push "$IMAGE"
gcloud run deploy pho0m-api --image "$IMAGE" --region asia-southeast1 --allow-unauthenticated \
  --max-instances 1 --set-env-vars SERVICE_ACCOUNT_BUCKET_NAME=<bucket> \
  --set-secrets ADMIN_PASSWORD=<secret-name>:latest,SESSION_SECRET=<secret-name>:latest
```

The image contains only the bundled `dist/server.js` and runs as the `node` user on port 8080.
Set `ADMIN_PASSWORD` and `SESSION_SECRET` (preferably from Secret Manager) and `SERVICE_ACCOUNT_BUCKET_NAME`; on
Cloud Run you can skip `SERVICE_ACCOUNT_KEY` and give the service account access to the bucket.
Then build the site with `VITE_API_URL=<run url>` and `VITE_CONTENT_URL=https://storage.googleapis.com/<bucket>/content/site.json`.

Do not skip `SESSION_SECRET` (`openssl rand -hex 32`): without it and without
`SERVICE_ACCOUNT_KEY` every cold start uses a new random secret, which logs the owner out and
makes the encrypted drafts unreadable.

### Login limits

Throttling is kept in memory per instance; keep `--max-instances` low (1 is plenty).

- **Per address**: 5 failures in 10 minutes → 429 with `Retry-After`. The address is the
  **right-most** `X-Forwarded-For` entry, which Google's front end appends; entries to its left
  come from the client and are ignored. A successful login clears that address's failures.
- **Global**: after 30 failures in 10 minutes from all addresses together, only addresses with
  a failure in the last 10 minutes are refused (429, generic message, no `Retry-After`). An
  address without recent failures, normally the owner's, can still log in; each new address
  gets one guess before it is refused too.
- **Browsers on other sites**: login needs `Content-Type: application/json` and, when the
  browser sends an `Origin`, one from `ALLOWED_ORIGINS`. A page on another site therefore cannot
  make its visitors' browsers send login attempts that count (a JSON request from another origin
  needs a CORS preflight, which is refused). Refused requests (415/403) are not counted.
