# คู่มือติดตั้งและ deploy เว็บ pho0m

คู่มือนี้พาตั้งค่าตั้งแต่ศูนย์จนเว็บขึ้นจริง: Google Cloud (bucket + Cloud Run), GitHub secrets,
deploy ครั้งแรก, ใช้หน้าหลังบ้าน `/admin`, README อัตโนมัติ, SEO และ AI crawler, รันในเครื่อง
และวิธีแก้ปัญหาที่เจอบ่อย

คำสั่งทุกบล็อกคัดลอกไปวางใน terminal ได้เลย (ต้องมี [`gcloud`](https://cloud.google.com/sdk/docs/install)
และ [`gh`](https://cli.github.com/) สำหรับขั้นที่ใช้ GitHub CLI)

## สารบัญ

1. [ภาพรวมระบบ](#1-ภาพรวมระบบ)
2. [ค่าใช้จ่ายและ free tier](#2-ค่าใช้จ่ายและ-free-tier)
3. [ตั้งค่า Google Cloud](#3-ตั้งค่า-google-cloud)
4. [ตั้งค่า bucket ให้เว็บอ่านได้](#4-ตั้งค่า-bucket-ให้เว็บอ่านได้)
5. [GitHub secrets และ variables](#5-github-secrets-และ-variables)
6. [Deploy ครั้งแรก](#6-deploy-ครั้งแรก)
7. [ใช้งานหน้าหลังบ้าน /admin](#7-ใช้งานหน้าหลังบ้าน-admin)
8. [README อัปเดตอย่างไร](#8-readme-อัปเดตอย่างไร)
9. [SEO และการเปิดให้ AI อ่านเว็บ](#9-seo-และการเปิดให้-ai-อ่านเว็บ)
10. [พัฒนาในเครื่อง](#10-พัฒนาในเครื่อง)
11. [แก้ปัญหา](#11-แก้ปัญหา)
12. [ความปลอดภัย](#12-ความปลอดภัย)

---

## 1. ภาพรวมระบบ

```text
ผู้เข้าชม ─────────► Firebase Hosting  (kiattiphoom-pho0m.web.app)
                     ├─ /        หน้าเว็บหลัก ภาษาไทยก่อน (ฟิล์ม 35mm) ← web/dist/index.html
                     ├─ /en/     หน้าเดียวกัน ภาษาอังกฤษก่อน          ← web/dist/en/index.html
                     └─ /admin   หน้าหลังบ้าน                         ← web/dist/admin.html
                          │
หน้าเว็บ ──── อ่าน ────► GCS bucket (public read)
                     ├─ content/site.json        เนื้อหาที่เผยแพร่แล้ว (JSON ธรรมดา)
                     ├─ private/content.enc      เนื้อหาทั้งหมด รวมฉบับร่างและรายการที่ซ่อน (เข้ารหัส)
                     ├─ private/history/*.enc    เวอร์ชันก่อนหน้า (เข้ารหัส)
                     └─ media/yyyy/mm/…          รูปและ PDF ที่อัปโหลด
                          ▲
/admin ─── เรียก API ──► Cloud Run: pho0m-api (asia-southeast1) ── เขียน ──┘

GitHub Actions
├─ deploy.yml                         push เข้า main → ตรวจ → deploy API → deploy เว็บ → tag + release → Discord
│                                     บันทึกใน /admin และทุกวัน → build เว็บใหม่ด้วยเนื้อหาล่าสุด (ไม่ deploy API)
├─ firebase-hosting-pull-request.yml  เปิด PR → ตรวจ (ทุก PR รวมจาก fork) → deploy preview (เฉพาะ branch ในรีโปนี้)
├─ readme.yml                         ทุกวัน และหลังบันทึกใน /admin → สร้าง README.md + assets/readme/*.svg จากเนื้อหาล่าสุด
└─ waka.yml                           ทุกวัน → อัปเดตบล็อก WakaTime ใน README
```

- **หน้าเว็บ** ไม่ต้อง build ใหม่เมื่อแก้เนื้อหา: ตอนเปิดหน้า มันโหลด `content/site.json` จาก bucket
  ถ้าโหลดไม่ได้หรือข้อมูลไม่ผ่านการตรวจ จะใช้เนื้อหาในตัว (`content/seed.json`) แทน
- **API** มีไว้ให้หน้าหลังบ้านเท่านั้น: login, บันทึกเนื้อหา, อัปโหลดไฟล์, ดูประวัติ
- **bucket** เก็บทั้งเนื้อหาและไฟล์ ทุกไฟล์ใน bucket เปิดให้ทุกคนอ่านได้ ฉบับร่าง รายการที่ซ่อน
  และประวัติจึงเก็บใน `private/` แบบเข้ารหัส (AES-256-GCM ใช้กุญแจจาก `SESSION_SECRET` หัวข้อ 5.1)
  ส่วน `content/site.json` มีเฉพาะเนื้อหาที่เผยแพร่แล้ว
- **ไฟล์สำหรับ search engine และ AI** (`sitemap.xml`, `llms.txt`, ข้อความและ JSON-LD ใน `index.html` และ `en/index.html`)
  สร้างตอน build จึงอัปเดตเมื่อ deploy ซึ่งเกิดเองหลังบันทึกใน `/admin` และทุกวัน (หัวข้อ 9)

โฟลเดอร์ในรีโป

| โฟลเดอร์ | หน้าที่ |
| --- | --- |
| `web/` | หน้าเว็บ + หน้าหลังบ้าน (Vite + React) build ออกที่ `web/dist` |
| `api/` | API หลังบ้าน (Hono) รันบน Cloud Run, build ด้วย `api/Dockerfile` |
| `packages/content/` | schema ของเนื้อหาและสัญญา API ที่ทุกส่วนใช้ร่วมกัน |
| `content/seed.json` | เนื้อหาตั้งต้นที่ฝังมากับเว็บ |
| `tools/readme/` | ตัวสร้าง README ของโปรไฟล์ GitHub |
| `firebase.json`, `.firebaserc` | ตั้งค่า Firebase Hosting (โปรเจกต์ `kiattiphoom-pho0m`) |

---

## 2. ค่าใช้จ่ายและ free tier

ตัวเลขด้านล่างเป็นตัวเลขโดยประมาณ ราคาจริงให้ดูที่หน้า pricing ของ Google ก่อนตัดสินใจ

- **Cloud Storage Always Free** ใช้ได้เฉพาะ bucket แบบ regional ใน `us-west1`, `us-central1`
  หรือ `us-east1` เท่านั้น ได้พื้นที่ประมาณ 5 GB ต่อเดือน พร้อมโควตาจำนวน request และ traffic ขาออกจำนวนหนึ่ง
- **bucket ใน `asia-southeast1` (สิงคโปร์)** ไม่อยู่ใน free tier แต่เว็บนี้ใช้พื้นที่ไม่กี่ร้อย MB
  ค่าใช้จ่ายจึงอยู่ราว ๆ ไม่กี่บาทต่อเดือน และโหลดรูปจากไทยได้เร็วกว่า
- **Cloud Run** มีโควตาฟรีรายเดือน (ราว 2 ล้าน request และเวลา CPU/หน่วยความจำจำนวนหนึ่ง)
  API นี้ใช้เฉพาะตอนแก้เนื้อหา และ scale ลงเหลือ 0 เมื่อไม่มีคนใช้ จึงมักไม่เสียเงิน
- **Artifact Registry** เก็บ image ของ API ฟรีประมาณ 0.5 GB ทุกครั้งที่ deploy จะเพิ่ม image ใหม่
  ถ้าใกล้เต็มให้ลบ image เก่าในหน้า Artifact Registry หรือตั้ง cleanup policy
- **Firebase Hosting** ใช้โควตาฟรีของ Firebase ได้เหมือนเดิม

Cloud Run และ Artifact Registry ต้องผูกบัญชีเรียกเก็บเงิน (billing account) กับโปรเจกต์ก่อน แม้จะใช้ไม่เกินโควตาฟรี
ถ้าใช้โปรเจกต์เดียวกับ Firebase (`kiattiphoom-pho0m`) โปรเจกต์ Firebase จะเปลี่ยนเป็นแผน Blaze
ซึ่งยังได้โควตาฟรีของ Hosting เท่าเดิม แนะนำให้ตั้ง **Budget alert** (เช่น 50 บาท) ที่หน้า
Billing → Budgets & alerts ไว้ด้วย

**เลือก region ของ bucket**

| ตัวเลือก | ค่าใช้จ่าย | ความเร็วจากไทย |
| --- | --- | --- |
| `us-central1` (หรือ `us-west1`, `us-east1`) | ฟรีถ้าไม่เกินโควตา | ช้ากว่าเล็กน้อยตอนโหลดครั้งแรก |
| `asia-southeast1` | ไม่กี่บาทต่อเดือน | เร็วกว่า |

เลือกได้ตามสะดวก ระบบทำงานเหมือนกันทั้งสองแบบ ส่วน Cloud Run ตั้งไว้ที่ `asia-southeast1` ใน `deploy.yml`

---

## 3. ตั้งค่า Google Cloud

### 3.1 ตั้งตัวแปรที่ใช้ซ้ำ

แก้ค่าให้ตรงกับของจริงก่อนวาง ชื่อ bucket ต้องไม่ซ้ำกับใครในโลก ใช้ได้แค่ตัวพิมพ์เล็ก ตัวเลข `-` และ `_`
และ**อย่าตั้งชื่อ bucket ที่เป็นส่วนหนึ่งของ URL ของ API** เช่น `pho0m` หรือ `pho0m-api`
(GitHub จะซ่อนค่าที่เป็น secret ใน log และจะทิ้ง output ที่มีค่านั้นอยู่ ทำให้ job ถัดไปไม่ได้ URL ของ API)

```bash
export PROJECT_ID=kiattiphoom-pho0m          # โปรเจกต์ GCP (ใช้โปรเจกต์อื่นก็ได้)
export BUCKET=kiattiphoom-pho0m-content      # ชื่อ bucket ไม่ต้องมี gs://
export BUCKET_LOCATION=asia-southeast1       # หรือ us-central1 ถ้าต้องการ free tier
export SA_NAME=pho0m-deployer
export SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
```

### 3.2 เลือกโปรเจกต์และผูก billing

```bash
gcloud auth login
gcloud config set project "$PROJECT_ID"
```

ดูรหัสบัญชีเรียกเก็บเงิน แล้วผูกกับโปรเจกต์ (ข้ามได้ถ้าผูกไว้แล้ว):

```bash
gcloud billing accounts list
```

```bash
gcloud billing projects link "$PROJECT_ID" --billing-account=XXXXXX-XXXXXX-XXXXXX
```

### 3.3 เปิด API ที่ต้องใช้

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com iam.googleapis.com storage.googleapis.com
```

### 3.4 สร้าง bucket

```bash
gcloud storage buckets create "gs://${BUCKET}" --location="$BUCKET_LOCATION" --uniform-bucket-level-access
```

### 3.5 สร้าง service account

service account ตัวนี้ใช้สองงาน: GitHub Actions ใช้ deploy และ Cloud Run ใช้เป็นตัวตนของ API ตอนเขียน bucket

```bash
gcloud iam service-accounts create "$SA_NAME" --display-name="pho0m deploy and admin API"
```

### 3.6 ให้สิทธิ์

สิทธิ์จัดการ bucket (ใช้ทั้งตอนตั้ง CORS/IAM ด้วย `setup:bucket` และตอน API เขียนไฟล์):

```bash
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" --role=roles/storage.admin
```

สิทธิ์ deploy Cloud Run และ push image:

```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" --role=roles/run.admin --condition=None
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" --role=roles/artifactregistry.admin --condition=None
```

สิทธิ์ให้ service account ใช้ตัวเองเป็นตัวตนของ Cloud Run:

```bash
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --member="serviceAccount:${SA_EMAIL}" --role=roles/iam.serviceAccountUser
```

### 3.7 สร้าง key (JSON)

เก็บไฟล์ไว้**นอกโฟลเดอร์รีโป** เพื่อไม่ให้เผลอ commit:

```bash
gcloud iam service-accounts keys create ~/pho0m-key.json --iam-account="$SA_EMAIL"
```

---

## 4. ตั้งค่า bucket ให้เว็บอ่านได้

หน้าเว็บอ่าน `content/site.json` และรูปจาก bucket โดยตรง และวาดรูปลง canvas เพื่อทำเอฟเฟกต์ dither
bucket จึงต้อง (1) เปิดให้ทุกคนอ่าน และ (2) ตั้ง CORS ให้อ่านจากโดเมนอื่นได้

### วิธีที่ 1: ใช้สคริปต์ในรีโป (แนะนำ)

รันที่ root ของรีโป (ต้อง `npm install` ก่อน) สคริปต์รันซ้ำได้ มันแก้เฉพาะส่วนที่ยังไม่ตรง:

```bash
SERVICE_ACCOUNT_BUCKET_NAME="$BUCKET" SERVICE_ACCOUNT_KEY="$(cat ~/pho0m-key.json)" \
  npm run setup:bucket -w api
```

อยากดูก่อนว่าจะเปลี่ยนอะไรบ้าง ให้เติม `-- --dry-run` ต่อท้าย ถ้าขั้นไหนไม่ผ่าน สคริปต์จะพิมพ์คำสั่ง `gcloud` ให้รันเอง

### วิธีที่ 2: ใช้ gcloud เอง

```bash
echo '[{"origin":["*"],"method":["GET","HEAD"],"responseHeader":["Content-Type"],"maxAgeSeconds":3600}]' > cors.json
gcloud storage buckets update "gs://${BUCKET}" --cors-file=cors.json
gcloud storage buckets update "gs://${BUCKET}" --uniform-bucket-level-access
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" --member=allUsers --role=roles/storage.objectViewer
rm cors.json
```

ไฟล์ `content/site.json` จะเกิดขึ้นตอนกด “บันทึก” ในหน้าหลังบ้านครั้งแรก ก่อนหน้านั้นเว็บใช้เนื้อหาในตัว

---

## 5. GitHub secrets และ variables

ตั้งที่ GitHub → รีโป `pho0m/pho0m` → Settings → Secrets and variables → Actions

| Secret | ค่า | จำเป็น |
| --- | --- | --- |
| `SERVICE_ACCOUNT_KEY` | เนื้อหาทั้งไฟล์ key JSON (ตั้งแต่ `{` ถึง `}`) | ต้องมี ถึงจะ deploy API |
| `SERVICE_ACCOUNT_BUCKET_NAME` | ชื่อ bucket เช่น `kiattiphoom-pho0m-content` (ไม่มี `gs://`) | ต้องมี ถึงจะ deploy API และให้เว็บอ่านเนื้อหาจาก bucket |
| `ADMIN_PASSWORD` | รหัสผ่านเข้าหน้า `/admin` | ต้องมี (ไม่ตั้ง = login ไม่ได้) |
| `SESSION_SECRET` | สตริงสุ่มอย่างน้อย 32 ตัวอักษร ใช้เซ็น token การ login และเป็นกุญแจเข้ารหัสฉบับร่างกับประวัติ | ไม่บังคับ (ไม่ตั้ง = สร้างจาก `SERVICE_ACCOUNT_KEY` ให้ ดู 5.1) |
| `FIREBASE_SERVICE_ACCOUNT_KIATTIPHOOM_PHO0M` | มีอยู่แล้ว ใช้ deploy Firebase Hosting | ต้องมี |
| `DISCORD_WEBHOOK` | URL ของ Discord webhook | ไม่บังคับ (ไม่ตั้ง = ไม่แจ้งเตือน) |
| `DISPATCH_TOKEN` | fine-grained token ของ GitHub ที่ให้ API สั่ง build เว็บใหม่หลังบันทึก (วิธีสร้างในหัวข้อ 9) | ไม่บังคับ (ไม่ตั้ง = ไฟล์ SEO อัปเดตรอบ deploy หรือรอบรายวัน) |
| `WAKATIME_API_KEY` | มีอยู่แล้ว ใช้กับ `waka.yml` (หัวข้อ 8) | ใช้กับ WakaTime เท่านั้น |

| Variable | ค่า | ใช้เมื่อ |
| --- | --- | --- |
| `API_URL` | URL ของ Cloud Run เช่น `https://pho0m-api-xxxxxxxxxx-as.a.run.app` | ไม่บังคับ: เป็นค่าสำรองตอนที่ job API ไม่ได้ deploy และใช้กับ preview ของ PR |

ตั้งด้วย GitHub CLI ได้เลย (รันในโฟลเดอร์รีโป):

```bash
gh secret set SERVICE_ACCOUNT_KEY --repo pho0m/pho0m < ~/pho0m-key.json
gh secret set SERVICE_ACCOUNT_BUCKET_NAME --repo pho0m/pho0m --body "$BUCKET"
gh secret set SESSION_SECRET --repo pho0m/pho0m --body "$(openssl rand -hex 32)"   # ไม่บังคับ อ่าน 5.1 ก่อน
```

รหัสผ่านให้พิมพ์เองตอน `gh` ถาม จะได้ไม่ค้างใน history ของ shell:

```bash
gh secret set ADMIN_PASSWORD --repo pho0m/pho0m
```

ตั้ง secret ครบแล้ว ลบ key ในเครื่องได้ (หรือย้ายไปเก็บใน password manager):

```bash
rm ~/pho0m-key.json
```

### 5.1 `SESSION_SECRET` ทำงานอย่างไร

API ใช้ค่านี้สองงาน: เซ็น token ตอน login และเป็นกุญแจเข้ารหัส `private/` ใน bucket
(ฉบับร่าง รายการที่ซ่อน และประวัติ) `deploy.yml` จึงส่ง `SESSION_SECRET` ให้ Cloud Run ทุกครั้งที่ deploy API

- **ตั้ง secret `SESSION_SECRET` ไว้** ใช้ค่านั้น ต้องยาวอย่างน้อย 32 ตัวอักษร ไม่อย่างนั้น deploy จะล้มพร้อมบอกเหตุผล
- **ไม่ได้ตั้ง** `deploy.yml` คำนวณให้จาก private key ใน `SERVICE_ACCOUNT_KEY` (HMAC-SHA256)
  ได้ค่าเดิมทุกครั้งจนกว่าจะเปลี่ยน key และไม่พิมพ์ค่าลง log
  ค่านี้ตรงกับที่ API คำนวณเองเมื่อรันในเครื่องด้วย `SERVICE_ACCOUNT_KEY` ชุดเดียวกัน

ค่านี้ต้อง**คงที่** ถ้าเปลี่ยน (ตั้ง secret ใหม่, ลบ secret, หรือเปลี่ยน key ตอนที่ไม่ได้ตั้ง secret)

- ทุกคนต้อง login ใหม่
- ฉบับร่างและประวัติที่เข้ารหัสด้วยค่าเดิมจะเปิดไม่ได้ หลังบ้านจะเปิดเวอร์ชันที่เผยแพร่อยู่แทนพร้อมคำเตือน
  กดบันทึกหนึ่งครั้งเพื่อเริ่มเก็บด้วยค่าใหม่ เนื้อหาที่เผยแพร่แล้วไม่หาย เพราะ `content/site.json` ไม่ได้เข้ารหัส

จะตั้ง `SESSION_SECRET` เอง ควรตั้งตั้งแต่แรก ถ้าต้องเปลี่ยนภายหลัง ให้เผยแพร่ฉบับร่างที่อยากเก็บก่อน

---

## 6. Deploy ครั้งแรก

push เข้า `main` หรือสั่งรัน workflow เอง:

```bash
gh workflow run deploy.yml --repo pho0m/pho0m --ref main
gh run watch --repo pho0m/pho0m
```

ลำดับงานใน `deploy.yml`

1. **Check** — `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run build:api`
2. **Deploy API** — ถ้ามี `SERVICE_ACCOUNT_KEY` และ `SERVICE_ACCOUNT_BUCKET_NAME`:
   build image จาก `api/Dockerfile` → สร้าง Artifact Registry `pho0m` ใน `asia-southeast1` (ถ้ายังไม่มี)
   → push → `gcloud run deploy pho0m-api` (ส่ง `SESSION_SECRET` ให้ทุกครั้ง หัวข้อ 5.1) → ตรวจ `/api/health`
   ถ้าไม่มี secret สองตัวนี้ job จะข้ามพร้อมข้อความแจ้ง
3. **Deploy site** — build เว็บโดยใส่ `VITE_API_URL` (URL ของ API ที่เพิ่ง deploy หรือ variable `API_URL`)
   และ `VITE_CONTENT_URL=https://storage.googleapis.com/<bucket>/content/site.json` แล้ว deploy ขึ้น Firebase Hosting (live)
   ได้ทั้ง `/` และ `/en/`
4. **Release** — เพิ่มเลขเวอร์ชัน สร้าง tag และ GitHub release
5. **Notify** — ส่งสถานะไป Discord (ถ้ามี `DISCORD_WEBHOOK`)

ตอนที่ workflow ถูกเรียกจากการบันทึกใน `/admin` (`repository_dispatch`) หรือรอบรายวัน (`schedule`)
จะเป็นรอบ **content refresh**: Check แค่ `npm ci` + build, ไม่ deploy API (แค่อ่าน URL ของ API ที่รันอยู่),
deploy เว็บ, ไม่สร้าง release และแจ้ง Discord เฉพาะตอนล้มเหลว (รายละเอียดหัวข้อ 9)

URL ของ API (เช่น `https://pho0m-api-xxxxxxxxxx-as.a.run.app`) อยู่ในหน้า Summary ของ run นั้น
แทน `<API_URL>` ด้านล่างด้วย URL นี้ แล้วตรวจได้ด้วย:

```bash
curl -s "<API_URL>/api/health"
```

ควรเห็น `"driver":"gcs"` และ `"authConfigured":true`

ถ้าอยากให้ preview ของ PR และ run ที่ข้าม API ใช้ URL เดียวกัน ให้ตั้ง variable:

```bash
gh variable set API_URL --repo pho0m/pho0m --body "<API_URL>"
```

จากนั้นเข้า `https://kiattiphoom-pho0m.web.app/admin` แล้วกด “บันทึก” หนึ่งครั้ง เพื่อสร้าง `content/site.json` ใน bucket

### Pull request

`firebase-hosting-pull-request.yml` (workflow ชื่อ **Pull request**) มีสอง job

- **Check** — `npm ci`, typecheck, test, build เว็บ (เนื้อหาในตัว) และ build API รันกับ**ทุก PR รวม PR จาก fork**
  ไม่ใช้ secret และได้ token แบบอ่านอย่างเดียว
- **Deploy preview** — รันหลัง Check ผ่าน เฉพาะ PR จาก branch ในรีโปนี้ (fork ไม่มีสิทธิ์อ่าน secret)
  build ด้วยเนื้อหาสดจาก bucket แล้ว deploy ขึ้น preview channel อายุ 7 วัน ลิงก์อยู่ในคอมเมนต์ของ PR

ถ้าตั้ง branch protection ให้เลือก check ชื่อ `Check` เป็น required จะได้ไม่ merge PR ที่ build ไม่ผ่าน

---

## 7. ใช้งานหน้าหลังบ้าน /admin

- **เข้าสู่ระบบ** — เปิด `https://kiattiphoom-pho0m.web.app/admin` ใส่ `ADMIN_PASSWORD`
  กล่องสถานะด้านบนบอกว่า API ออนไลน์ไหม และใช้ storage แบบไหน เซสชันอยู่ได้ 12 ชั่วโมง
  ใส่รหัสผิด 5 ครั้งใน 10 นาทีจากเครื่องเดียวกัน ต้องรอสักพักก่อนลองใหม่
  และถ้ามีคนใส่ผิดรวมกันเกิน 30 ครั้งใน 10 นาที (เช่นโดนสุ่มรหัส) ระบบจะไม่รับ login ชั่วคราว
  เฉพาะจากเครื่องที่เพิ่งใส่ผิด เครื่องที่ไม่เคยใส่ผิด (เช่นของคุณ) ยัง login ได้ตามปกติ
- **แก้เนื้อหา** — เลือกส่วนจากเมนู (โปรไฟล์, ไทม์ไลน์, บริษัท, โปรเจกต์, ทักษะ, บันทึกสหกิจ, เอกสาร ฯลฯ)
  การแก้ไขเก็บเป็นฉบับร่างในเบราว์เซอร์ก่อน กด **บันทึก** (หรือ `Ctrl+S`) เพื่อขึ้นเว็บจริง
  ถ้ามีช่องที่ต้องแก้ ระบบจะบอกจำนวนจุดและไม่ยอมบันทึกจนกว่าจะแก้ครบ
  บันทึกแล้วเว็บแสดงเนื้อหาใหม่ทันทีที่มีคนเปิดหน้า ไม่ต้อง deploy ใหม่
  ส่วนไฟล์สำหรับ search engine และ AI (`sitemap.xml`, `llms.txt`, ข้อความใน `index.html`) และ README
  จะตามมาเองภายในไม่กี่นาทีถ้าตั้ง `DISPATCH_TOKEN` ไว้ ไม่อย่างนั้นจะอัปเดตรอบรายวัน (หัวข้อ 9)
- **อัปโหลด** — รูป JPEG, PNG, WebP, GIF, AVIF และ PDF ขนาดไม่เกิน 15 MB (รูปใหญ่กว่า 2000px จะถูกย่อ และ WebP/AVIF จะถูกแปลงเป็น JPEG หรือ PNG ให้อัตโนมัติ เพื่อให้ README และพรีวิวลิงก์อ่านได้)
  ไฟล์ไปอยู่ที่ `media/<ปี>/<เดือน>/…` ใน bucket ทุกไฟล์ที่อัปโหลด**ทุกคนเปิดดูได้** อย่าอัปโหลดเอกสารส่วนตัว
- **ฉบับร่างและรายการที่ซ่อน** — เฟรม โปรเจกต์ และผลงานบริษัทที่ไม่ได้ตั้งให้เผยแพร่ อีเมลหรือเบอร์ที่ไม่ได้ตั้งให้แสดง
  และเอกสารที่ยังไม่มีไฟล์ เก็บเฉพาะใน `private/content.enc` แบบเข้ารหัส
  ไม่อยู่ใน `content/site.json`, หน้าเว็บ, `llms.txt` หรือ README
- **ประวัติ** — ทุกครั้งที่บันทึก เวอร์ชันก่อนหน้าจะถูกเก็บไว้แบบเข้ารหัสใน `private/history/` (เก็บ 50 เวอร์ชัน แสดง 30 เวอร์ชันล่าสุด)
  กด “โหลดเข้าฉบับร่าง” แล้วกด **บันทึก** เพื่อนำเวอร์ชันนั้นกลับมาใช้
- **บันทึกชนกัน** — ถ้ามีการบันทึกจากแท็บหรืออุปกรณ์อื่นก่อน จะมีหน้าต่างให้เลือก
  “โหลดเวอร์ชันล่าสุด” (ทิ้งการแก้ไขในเครื่องนี้) หรือ “บันทึกทับ” (ของเดิมยังอยู่ในประวัติ)
- **สถานะ redeploy หลังบันทึก** — บอกว่าสั่ง build เว็บใหม่ (ไฟล์ SEO, `llms.txt`, README) ได้หรือยัง
  ตัวเนื้อหาบันทึกสำเร็จแล้วในทุกกรณี

  | สถานะ | ความหมาย |
  | --- | --- |
  | `sent` | GitHub รับคำสั่งแล้ว เว็บและ README จะอัปเดตภายในไม่กี่นาที |
  | `queued` | เพิ่งสั่งไปไม่ถึง 2 นาที จึงพักไว้ จะส่งไปพร้อมการบันทึกครั้งถัดไปหลังครบ 2 นาที ถ้าไม่มีการบันทึกอีก รอบรายวันจะตามให้ |
  | `failed` | GitHub ปฏิเสธหรือไม่ตอบใน 4 วินาที จะลองใหม่ตอนบันทึกครั้งถัดไป หรือรอรอบรายวัน ดูสาเหตุใน log ของ API (หัวข้อ 9) |
  | `off` | ยังไม่ได้ตั้ง `DISPATCH_TOKEN` ไฟล์ SEO และ README จะอัปเดตรอบรายวัน |

---

## 8. README อัปเดตอย่างไร

`readme.yml` สร้าง `README.md` และการ์ด SVG ใน `assets/readme/` ใหม่จากเนื้อหาล่าสุด แล้ว commit ในชื่อ `github-actions[bot]`
เฉพาะเมื่อมีอะไรเปลี่ยน

- รันทุกวันเวลา 01:17 UTC (08:17 เวลาไทย) หลัง `waka.yml` (00:00 UTC)
- รันเมื่อ push เข้า `main` ที่แก้ `content/**`, `tools/readme/**` หรือ `packages/content/**`
- สั่งรันเองได้:

```bash
gh workflow run readme.yml --repo pho0m/pho0m
```

- อ่านเนื้อหาจาก bucket (`SERVICE_ACCOUNT_BUCKET_NAME`) ถ้าไม่ได้ตั้ง bucket หรือได้ 404 (ยังไม่เคยบันทึก) จะใช้ `content/seed.json`
  ถ้าตั้ง bucket ไว้แต่อ่านไม่ได้ (403, 5xx, หมดเวลา, ข้อมูลไม่ผ่าน schema) run จะล้มเหลวและไม่ commit
  ไม่เอา README จาก seed ไปทับของจริง (`README_REQUIRE_LIVE_CONTENT=1` ใน `readme.yml`)
  ตัวเลข GitHub (ดาว, รีโป, ผู้ติดตาม) มาจาก `GITHUB_TOKEN` ที่ Actions ให้มา
- บล็อก WakaTime (`<!--START_SECTION:waka-->` … `<!--END_SECTION:waka-->`) ถูกคัดลอกไปตามเดิม `waka.yml` ยังอัปเดตส่วนนี้เหมือนเดิม
  `waka.yml` ปัก `athul/waka-readme` ไว้ที่ commit เดียว (master วันที่ 2026-10-23) และให้ token แค่ `contents: write`
  จะอัปเดต action ให้ดูการเปลี่ยนแปลงก่อน แล้วเปลี่ยน SHA ในไฟล์ (คำสั่งอยู่ในคอมเมนต์)
  README ของ action ที่ commit นั้นบอกว่า WakaTime ต้องใช้ OAuth token แทน API key
  ถ้าบล็อก WakaTime ไม่อัปเดต ให้ตรวจค่าใน `WAKATIME_API_KEY`
- รันหลังบันทึกใน `/admin` (event `repository_dispatch` ชื่อ `content-updated`) ถ้าตั้ง `DISPATCH_TOKEN` ไว้ (หัวข้อ 9)
  ไม่ได้ตั้ง README จะตามทันในรอบรายวันถัดไป หรือสั่งรันเองตามด้านบน
- ถ้าตั้ง branch protection บน `main` ต้องอนุญาตให้ `github-actions[bot]` push ได้

ลองสร้างในเครื่อง:

```bash
npm run readme
```

```bash
npm run readme -- --check
```

---

## 9. SEO และการเปิดให้ AI อ่านเว็บ

หน้าเว็บเป็น React แต่ crawler ส่วนใหญ่ โดยเฉพาะของ AI (GPTBot, ClaudeBot, PerplexityBot …) ไม่รัน JavaScript
ตอน build จึงมีขั้น `web/src/seo/postbuild.ts` อบเนื้อหาลงไฟล์ธรรมดาให้อ่านได้ทันที

| ไฟล์ | มีอะไร |
| --- | --- |
| `/` (`index.html`) | หน้าไทย: `<title>`, meta, Open Graph, JSON-LD, เนื้อหาทั้งเว็บเป็น HTML ใน `#root` (React แทนที่เมื่อโหลดเสร็จ) และเนื้อหาเป็น JSON ใน `<script id="pho0m-content">` |
| `/en/` (`en/index.html`) | หน้าเดียวกันแบบภาษาอังกฤษก่อน: `<html lang="en">`, title และ description ภาษาอังกฤษ, `og:locale` เป็น `en_US` |
| `/robots.txt` | อนุญาตทุก bot รวมถึง AI crawler (GPTBot, ClaudeBot, PerplexityBot, Google-Extended …) ยกเว้น `/admin` |
| `/sitemap.xml` | `/`, `/en/` (พร้อม hreflang) และ `llms-full.txt` พร้อมวันที่แก้ล่าสุด |
| `/llms.txt` | สรุปสั้นสำหรับ AI ตามรูปแบบ [llms.txt](https://llmstxt.org/) มีลิงก์ไปหน้า `/en/` |
| `/llms-full.txt` | เนื้อหาทั้งเว็บเป็นข้อความล้วน ไทยและอังกฤษ |

- เนื้อหาที่ใช้คือ `content/site.json` ใน bucket ตอน build ถ้ายังไม่เคยบันทึกจากหลังบ้านจะใช้ `content/seed.json`
  และอบเฉพาะส่วนที่เผยแพร่ ฉบับร่าง รายการที่ซ่อน และอีเมลหรือเบอร์ที่ไม่ได้ตั้งให้แสดง ไม่หลุดลงไฟล์เหล่านี้
- **สองภาษา สอง URL** — `/` เป็น canonical ของหน้าไทย `/en/` เป็น canonical ของหน้าอังกฤษ
  ทั้งสองหน้ามี hreflang ชุดเดียวกัน: `th` → `/`, `en` → `/en/`, `x-default` → `/`
- **ลิงก์** — ใช้เฉพาะ `https://`, `http://`, `mailto:`, `tel:`, path ในเว็บ (`/…`) และ `#…`
  ลิงก์แบบอื่น (เช่น `javascript:` หรือ `data:`) ถูกตัดทิ้ง เหลือแค่ข้อความ (หลังบ้านก็ไม่ยอมให้บันทึกอยู่แล้ว)
- **ระหว่างแอปโหลด** — สคริปต์สั้น ๆ ใน `<head>` ซ่อนข้อความ HTML ไว้ไม่ให้กะพริบ ถ้าแอปไม่ขึ้นภายใน 4 วินาที
  ข้อความจะกลับมาแสดง ถ้าปิด JavaScript จะเห็นข้อความตั้งแต่แรก
- JSON-LD ใช้เฉพาะข้อมูลที่มีในเนื้อหา: ตำแหน่งงาน (`hasOccupation`), สถาบันและหลักสูตร (`alumniOf`, `hasCredential`)
  และรางวัล (`award`) ซึ่งมาจากคำว่า Honors ในช่องหลักสูตร กับเฟรมไทม์ไลน์ที่ติดแท็ก `Award`, `Prize`,
  `Competition`, `Contest`, `Hackathon`, `CTF` หรือ `Scholarship` อยากให้เฟรมไหนขึ้นเป็นรางวัล ให้เพิ่มแท็กเหล่านี้
- โปรเจกต์แบ่งกลุ่มเหมือนบนเว็บ งานลูกค้า (`client`) เป็นข้อความอย่างเดียว ไม่มีรูป
- `firebase.json` ส่ง `llms.txt` และ `llms-full.txt` เป็น `text/plain; charset=utf-8` และให้ cache ไฟล์ทั้งสี่ได้ 1 ชั่วโมง
  `X-Robots-Tag: noindex` มีเฉพาะ `/admin` ส่ง `/en` และ `/en/…` ไปที่ `en/index.html`
- รูปใน `web/public/media` (`/media/…`) cache 1 วัน เพราะชื่อไฟล์ไม่เปลี่ยนเมื่อแทนรูป
  (ไฟล์ใน `/assets/` มี hash ในชื่อ จึง cache ได้ 1 ปี)

### ไฟล์เหล่านี้อัปเดตเมื่อไหร่

หน้าเว็บโหลดเนื้อหาสดทุกครั้งที่เปิด แต่ไฟล์ข้างบนสร้างตอน deploy จึงอัปเดตเมื่อ

1. **push เข้า `main`** — deploy เต็มรูปแบบ
2. **ทุกวัน 02:41 UTC (09:41 เวลาไทย)** — `deploy.yml` รอบ content refresh เป็นตัวกันพลาด
   รอบนี้จะหยุดหลังขั้นแรกของ Check ไม่ build และไม่ deploy ถ้า
   - ไม่ได้ตั้ง `SERVICE_ACCOUNT_BUCKET_NAME` (เว็บมีแต่เนื้อหาในตัว ซึ่ง deploy ไปแล้วตอน push)
   - `content/site.json` ได้ 404 (ยังไม่เคยบันทึกจากหลังบ้าน)
   - `Last updated` ใน `llms-full.txt` บนเว็บตรงกับ `updatedAt` ใน bucket อยู่แล้ว

   ถ้า bucket ตอบอย่างอื่น (เช่น 403 หรือ 5xx) จะ build ต่อ และ build จะล้มถ้ายังอ่านไม่ได้ (ดูด้านล่าง)
3. **หลังกดบันทึกใน `/admin`** — ถ้าตั้ง `DISPATCH_TOKEN` API จะส่ง event `content-updated` ไปที่ GitHub
   ส่งไม่เกิน 1 ครั้งต่อ 2 นาที ถ้าบันทึกเพิ่มระหว่างนั้น สถานะจะเป็น `queued` และส่งไปพร้อมการบันทึกครั้งถัดไป (หัวข้อ 7)
   เว็บใหม่ขึ้นภายในไม่กี่นาที และ `readme.yml` ก็อัปเดต README ด้วย การบันทึกรอ GitHub ไม่เกิน 4 วินาที และไม่ล้มเพราะ GitHub

รอบ content refresh (ข้อ 2 และ 3) ทำเท่าที่จำเป็น: `npm ci` + build, อ่าน URL ของ API ที่รันอยู่ (ไม่ deploy API ใหม่),
build เว็บด้วยเนื้อหาสดแล้ว deploy ไม่สร้าง tag/release และแจ้ง Discord เฉพาะตอนล้มเหลว
ถ้าอ่าน `content/site.json` จาก bucket ไม่ได้ (เช่น 403, 500, ข้อมูลไม่ผ่าน schema) รอบนั้นจะล้มเหลว
แทนที่จะเอาเนื้อหาในตัวไปทับ (ถ้าเป็น 404 เพราะยังไม่เคยบันทึก ถือว่าปกติ)

สั่งเองได้:

```bash
gh api repos/pho0m/pho0m/dispatches -f event_type=content-updated   # refresh เว็บ + README
gh workflow run deploy.yml --repo pho0m/pho0m --ref main            # deploy เต็มรูปแบบ
```

### สร้าง `DISPATCH_TOKEN` (ให้เว็บอัปเดตทันทีหลังบันทึก)

1. เปิด GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token
   (หรือ https://github.com/settings/personal-access-tokens/new)
2. **Token name** เช่น `pho0m-admin-dispatch` และตั้ง **Expiration** (เช่น 1 ปี) แล้วจดวันหมดอายุไว้
3. **Repository access** → *Only select repositories* → เลือก `pho0m/pho0m` รีโปเดียว
4. **Permissions** → Repository permissions → **Contents: Read and write**
   (สิทธิ์ที่ `repository_dispatch` ต้องใช้ ส่วน Metadata: Read-only จะติดมาเอง) ไม่ต้องเปิดสิทธิ์อื่น
5. กด Generate token แล้วคัดลอก (ขึ้นต้นด้วย `github_pat_`)

ใส่เป็น secret ชื่อ `DISPATCH_TOKEN` (GitHub ไม่ให้ตั้งชื่อ secret ที่ขึ้นต้นด้วย `GITHUB_`) วาง token ตอนที่ `gh` ถาม:

```bash
gh secret set DISPATCH_TOKEN --repo pho0m/pho0m
```

แล้ว deploy เต็มรอบหนึ่งครั้ง เพื่อส่งค่าไปที่ Cloud Run:

```bash
gh workflow run deploy.yml --repo pho0m/pho0m --ref main
```

ลองยิง event ด้วย token เอง ถ้าได้ `204` แปลว่าใช้ได้ และจะเห็น run ใหม่ของ Deploy (event `repository_dispatch`) ในแท็บ Actions
ได้ `401` = token ผิดหรือหมดอายุ, `403`/`404` = token ไม่ได้เลือกรีโปนี้ หรือไม่มีสิทธิ์ Contents: write

```bash
read -rs TOKEN   # วาง token แล้วกด Enter (ไม่แสดงบนจอ)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.github.com/repos/pho0m/pho0m/dispatches \
  -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  -d '{"event_type":"content-updated"}'
unset TOKEN
```

ดูว่า API เปิดใช้แล้ว (บรรทัดตอนเริ่มต้องเป็น `redeploy on save: on (pho0m/pho0m)`) และดูผลการส่งแต่ละครั้ง:

```bash
gcloud run services logs read pho0m-api --region asia-southeast1 --limit 100 | grep -i redeploy
```

token หมดอายุเมื่อไหร่ การบันทึกยังใช้ได้ปกติ แค่ log จะขึ้น `dispatch … failed … HTTP 401`
ให้สร้าง token ใหม่ ตั้ง secret ใหม่ แล้ว deploy เต็มรอบ

### ตัวแปรที่เกี่ยวข้อง (ไม่บังคับทั้งหมด)

| ตั้งที่ | ชื่อ | ค่า |
| --- | --- | --- |
| GitHub secret | `DISPATCH_TOKEN` | fine-grained token จากขั้นตอนด้านบน |
| Cloud Run (`deploy.yml` ตั้งให้) | `GITHUB_DISPATCH_TOKEN` | ค่าเดียวกับ `DISPATCH_TOKEN` ไม่ตั้ง = ปิดการสั่ง build หลังบันทึก |
| Cloud Run (`deploy.yml` ตั้งให้) | `GITHUB_REPOSITORY` | รีโปที่ workflow รันอยู่ (`pho0m/pho0m`) ค่าเริ่มต้นก็เป็น `pho0m/pho0m` |

รัน API ในเครื่องก็ใส่สองตัวนี้ใน `api/.env` ได้ (ดู `api/.env.example`) แต่ระวัง: บันทึกในเครื่องจะสั่ง deploy เว็บจริง

### ตรวจด้วย curl

```bash
SITE=https://kiattiphoom-pho0m.web.app
curl -sI "$SITE/llms.txt" | grep -i -E "^HTTP|^content-type|^cache-control"
curl -sI "$SITE/robots.txt" | grep -i -E "^HTTP|^cache-control"
curl -s "$SITE/robots.txt" | grep -E "GPTBot|ClaudeBot|PerplexityBot|Google-Extended|Sitemap"
curl -s "$SITE/sitemap.xml" | grep -E "<loc>|<lastmod>"
curl -s "$SITE/llms-full.txt" | grep -m1 "Last updated"
curl -s -A "GPTBot" "$SITE/" | grep -o "<title>[^<]*</title>"
curl -s "$SITE/" | grep -c "application/ld+json"
curl -s "$SITE/en/" | grep -o -E '<html lang="[a-z]+"|<link rel="canonical"[^>]*>'
curl -s "$SITE/" | grep -c 'id="pho0m-content"' 
curl -sI "$SITE/" | grep -i x-robots-tag
curl -sI "$SITE/admin" | grep -i x-robots-tag
```

ควรเห็น

- `llms.txt`: `content-type: text/plain; charset=utf-8` และ `cache-control: public, max-age=3600`
- `robots.txt`: `cache-control: public, max-age=3600` และมีชื่อ bot ของ AI ครบ
- `Last updated` ใน `llms-full.txt` ตรงกับเวลาที่บันทึกล่าสุด (ถ้ายังไม่ตรง ดูว่า run ของ Deploy เสร็จหรือยัง)
- `<title>` ขึ้นแม้ไม่รัน JavaScript และมี JSON-LD 1 บล็อก
- `/en/` ได้ `<html lang="en"` และ canonical เป็น `…/en/` และหน้าแรกมี `pho0m-content` 1 บล็อก
- หน้าแรก **ไม่มี** `x-robots-tag` ส่วน `/admin` ต้องเห็น `noindex, nofollow`

ตรวจ JSON-LD ละเอียดได้ที่ [validator.schema.org](https://validator.schema.org/) หรือ
[Rich Results Test](https://search.google.com/test/rich-results) โดยใส่ URL ของเว็บ

---

## 10. พัฒนาในเครื่อง

ต้องมี Node 22 ขึ้นไป ไม่ต้องมีบัญชี GCP: ถ้าไม่ตั้ง bucket, API จะใช้ **local driver**
เก็บไฟล์ไว้ใน `api/.data/` และเสิร์ฟที่ `http://localhost:8787/files/…`

```bash
npm install
cp api/.env.example api/.env
```

เปิด `api/.env` แล้วใส่ `ADMIN_PASSWORD` จากนั้นเปิด terminal สองหน้าต่าง:

```bash
npm run dev:api
```

```bash
npm run dev
```

- หน้าเว็บ: http://localhost:5173
- หน้าหลังบ้าน: http://localhost:5173/admin.html (dev server ส่ง `/api` ต่อไปที่ `http://localhost:8787`)

อยากให้หน้าเว็บในเครื่องอ่านเนื้อหาที่บันทึกจากหลังบ้านในเครื่อง:

```bash
cp web/.env.example web/.env.local
```

แล้วตั้ง `VITE_CONTENT_URL=http://localhost:8787/files/content/site.json` ใน `web/.env.local` และรัน `npm run dev` ใหม่

ตรวจทุกอย่างก่อน push (ชุดเดียวกับใน CI):

```bash
npm run check
```

ลอง build และรัน image ของ API แบบเดียวกับบน Cloud Run:

```bash
docker build -f api/Dockerfile -t pho0m-api .
docker run --rm -p 8080:8080 -e ADMIN_PASSWORD=change-me pho0m-api
```

---

## 11. แก้ปัญหา

**`/admin` ขึ้น CORS error ใน console (`blocked by CORS policy`)**
- API รับเฉพาะ origin ใน `ALLOWED_ORIGINS` ซึ่ง `deploy.yml` ตั้งเป็น
  `https://kiattiphoom-pho0m.web.app,https://kiattiphoom-pho0m.firebaseapp.com`
- ใช้โดเมนอื่น (เช่นโดเมนของตัวเอง) ให้เพิ่มในบรรทัด `SITE_ORIGINS` ของ `.github/workflows/deploy.yml` แล้ว deploy ใหม่
- หน้า `/admin` บน preview ของ PR เรียก API ไม่ได้ เพราะ URL ของ preview ไม่อยู่ในรายการ (ตั้งใจไว้แบบนี้)
- ถ้าเห็น error ว่า JSON ผิดรูปแบบ (`Unexpected token <`) แปลว่าเว็บถูก build โดยไม่มี `VITE_API_URL`
  ดู warning “No API URL” ใน run ของ Deploy แล้ว deploy API หรือตั้ง variable `API_URL`

**401 Unauthorized**
- รหัสผ่านผิด หรือเซสชันหมดอายุ (12 ชั่วโมง) ให้เข้าสู่ระบบใหม่ การแก้ไขที่ยังไม่บันทึกยังอยู่
- เปลี่ยน `SESSION_SECRET` แล้ว ทุกคนต้อง login ใหม่ (และฉบับร่างเดิมจะเปิดไม่ได้ หัวข้อ 5.1)
- **503** ตอน login = บน Cloud Run ยังไม่มี `ADMIN_PASSWORD` ตั้ง secret แล้วรัน Deploy ใหม่
- **429** = ใส่รหัสผิดบ่อยเกินไปจากเครื่องนี้ รอตามเวลาที่บอก (ไม่เกิน 10 นาที) ถ้าขึ้นว่า `login is paused`
  แปลว่ามีการใส่ผิดรวมกันเกิน 30 ครั้งจากหลายที่ (อาจโดนสุ่มรหัส) และเครื่องนี้ก็เพิ่งใส่ผิด ลอง login จากเครื่อง
  หรือเครือข่ายอื่นที่ไม่เคยใส่ผิด หรือรอให้ครบ 10 นาที แล้วพิจารณาเปลี่ยนรหัส

**PR จาก fork ไม่มีลิงก์ preview**
- ตั้งใจไว้แบบนี้: fork อ่าน secret ไม่ได้ จึงรันแค่ job Check ถ้า Check ผ่าน แปลว่า typecheck, test และ build ผ่าน

**409 Conflict ตอนบันทึก**
- มีคนบันทึกจากที่อื่นหลังจากคุณเปิดหน้า (อีกแท็บหรืออีกเครื่อง) เลือก “โหลดเวอร์ชันล่าสุด” หรือ “บันทึกทับ”
  ในหน้าต่างที่ขึ้นมา ถ้าบันทึกทับ ของเดิมยังกู้ได้จาก “ประวัติ”

**รูปบนฟิล์มไม่ขึ้น หรือเป็นกรอบว่าง**
- เว็บวาดรูปลง canvas จึงต้องโหลดรูปแบบ CORS ถ้า bucket ไม่มี CORS เบราว์เซอร์จะไม่ยอมให้อ่าน pixel
  รัน `npm run setup:bucket -w api` อีกครั้ง (หัวข้อ 4) แล้วตรวจ:

```bash
curl -sI -H "Origin: https://kiattiphoom-pho0m.web.app" "https://storage.googleapis.com/${BUCKET}/content/site.json" | grep -i -E "^HTTP|access-control"
```

- ต้องเห็น `access-control-allow-origin` ถ้าได้ **403** แปลว่ายังไม่เปิด public read
  หรือ bucket เปิด *public access prevention* อยู่ (`setup:bucket` จะบอกคำสั่งที่ต้องรัน)
- ได้ **404** ที่ `content/site.json` = ยังไม่เคยกดบันทึกในหลังบ้าน เว็บจะใช้เนื้อหาในตัวไปก่อน

**เนื้อหาที่บันทึกแล้วไม่ขึ้นบนเว็บ**
- เว็บต้องถูก build พร้อม `VITE_CONTENT_URL` ซึ่งต้องมี secret `SERVICE_ACCOUNT_BUCKET_NAME` ตอน Deploy
- เปิด console ของเบราว์เซอร์ ถ้าเห็น `Live content failed validation` แปลว่าข้อมูลใน bucket ไม่ผ่าน schema
  ให้กู้เวอร์ชันก่อนหน้าจาก “ประวัติ”

**บันทึกแล้วแต่ `llms.txt` / `sitemap.xml` / README ยังเป็นของเก่า**
- ไม่มี run ใหม่ของ Deploy ในแท็บ Actions หลังบันทึก = ยังไม่ได้ตั้ง `DISPATCH_TOKEN` หรือยังไม่ได้ deploy เต็มรอบหลังตั้ง
  ดู log ของ API (หัวข้อ 9) ถ้าเห็น `HTTP 401` ให้สร้าง token ใหม่ ถ้าเห็น `HTTP 403`/`404` ให้ตรวจว่าเลือกรีโปและสิทธิ์ Contents ถูก
- ดูสถานะ redeploy หลังบันทึกในหลังบ้าน (หัวข้อ 7): `off` = ยังไม่ได้ตั้ง `DISPATCH_TOKEN`
  `queued` = บันทึกติดกันภายใน 2 นาที จะส่งไปกับการบันทึกครั้งถัดไป หรือรอรอบรายวัน
  `failed` = ดู log ของ API
- สั่งเองได้ทันที: `gh api repos/pho0m/pho0m/dispatches -f event_type=content-updated`
- run ของ content refresh ล้มเหลวที่ขั้น Build site พร้อม `SEO_REQUIRE_LIVE_CONTENT` = อ่านเนื้อหาจาก bucket ไม่ได้
  หรือเนื้อหาไม่ผ่าน schema ดูข้อความ `[seo]` ใน log
- `No API URL` ในรอบ content refresh = หา URL ของ API บน Cloud Run ไม่เจอ ให้ deploy เต็มรอบ หรือตั้ง variable `API_URL`
- run ของ README ล้มเหลวที่ขั้น Generate = ตั้ง bucket ไว้แต่อ่าน `content/site.json` ไม่ได้ ดูข้อความ `[readme]` ใน log
  README เดิมยังอยู่ ไม่ถูกทับด้วยเนื้อหาจาก seed

**หลังบ้านเตือนว่าเปิดฉบับร่างไม่ได้ (`drafts could not be decrypted`)**
- `SESSION_SECRET` เปลี่ยน หรือเปลี่ยน service-account key ตอนที่ไม่ได้ตั้ง `SESSION_SECRET` (หัวข้อ 5.1)
- ถ้ายังมีค่าเดิมและยังไม่ได้กดบันทึกหลังจากนั้น ให้ตั้งค่าเดิมกลับแล้ว deploy เต็มรอบ ฉบับร่างจะกลับมา
- ถ้าไม่มีแล้ว หลังบ้านเปิดเวอร์ชันที่เผยแพร่อยู่ให้ แก้ต่อแล้วกดบันทึก ระบบจะเก็บด้วยค่าใหม่

**Deploy API ไม่ผ่าน (Cloud Run / สิทธิ์)**
- `API deploy skipped` = ยังไม่ได้ตั้ง `SERVICE_ACCOUNT_KEY` หรือ `SERVICE_ACCOUNT_BUCKET_NAME`
- `SESSION_SECRET is too short` = secret สั้นกว่า 32 ตัวอักษร ตั้งใหม่ด้วย `openssl rand -hex 32`
  หรือลบ secret ทิ้งเพื่อใช้ค่าที่สร้างจาก key (อ่านหัวข้อ 5.1 ก่อน เพราะการเปลี่ยนค่ามีผลกับฉบับร่าง)
- `iam.serviceaccounts.actAs` denied = ขาด `roles/iam.serviceAccountUser` (หัวข้อ 3.6 บล็อกสุดท้าย)
- `run.services.setIamPolicy` หรือ `run.services.create` denied = ขาด `roles/run.admin`
- push image ไม่ได้ (`denied: Permission "artifactregistry.repositories.uploadArtifacts"`) = ขาด `roles/artifactregistry.admin`
- `SERVICE_DISABLED` หรือ `has not been used in project` = ยังไม่เปิด API (หัวข้อ 3.3) ส่วน warning
  “Could not enable APIs” ใน log ไม่เป็นไร ถ้าเปิด API ไว้เองแล้ว
- `billing account ... is disabled` = ยังไม่ผูก billing (หัวข้อ 3.2)
- สร้าง key ไม่ได้เพราะ `iam.disableServiceAccountKeyCreation` = มี organization policy ห้ามสร้าง key
  ต้องให้ผู้ดูแล organization ปลดให้ หรือเปลี่ยนไปใช้ Workload Identity Federation
- warning `API URL was dropped` = ค่า secret บางตัวบังเอิญอยู่ใน URL ของ API ให้ตั้ง variable `API_URL` (หัวข้อ 6)
- ดู log ของ API:

```bash
gcloud run services logs read pho0m-api --region asia-southeast1 --limit 50
```

---

## 12. ความปลอดภัย

- **ห้าม commit key** — เก็บ key นอกรีโป ใส่ไว้ใน GitHub secret อย่างเดียว ถ้าเผลอหลุด ให้ลบ key ทันที:

```bash
gcloud iam service-accounts keys list --iam-account="$SA_EMAIL"
```

```bash
gcloud iam service-accounts keys delete KEY_ID --iam-account="$SA_EMAIL"
```

  แล้วสร้าง key ใหม่ (หัวข้อ 3.7) และอัปเดต secret `SERVICE_ACCOUNT_KEY`
  ถ้าไม่ได้ตั้ง `SESSION_SECRET` ค่าที่สร้างจาก key จะเปลี่ยนตาม (หัวข้อ 5.1) เผยแพร่ฉบับร่างที่อยากเก็บก่อนเปลี่ยน key
- **เปลี่ยน `ADMIN_PASSWORD` เป็นระยะ** — ตั้ง secret ใหม่แล้วรัน Deploy อีกครั้ง
  token ที่ออกไปแล้วยังใช้ได้จนหมดอายุ (12 ชั่วโมง) อยากเตะทุกคนออกทันทีต้องเปลี่ยน `SESSION_SECRET` ด้วย
  ซึ่งทำให้ฉบับร่างและประวัติเดิมเปิดไม่ได้ (หัวข้อ 5.1) จึงควรเผยแพร่ฉบับร่างที่อยากเก็บก่อน:

```bash
gh secret set ADMIN_PASSWORD --repo pho0m/pho0m
gh secret set SESSION_SECRET --repo pho0m/pho0m --body "$(openssl rand -hex 32)"   # เฉพาะเมื่อต้องเตะทุกคนออก
gh workflow run deploy.yml --repo pho0m/pho0m --ref main
```

- **`DISPATCH_TOKEN`** มีสิทธิ์ Contents: write ซึ่งแก้โค้ดในรีโปได้ จำกัดไว้ที่ `pho0m/pho0m` รีโปเดียว ตั้งวันหมดอายุ
  และลบทิ้งที่หน้า Fine-grained tokens ทันทีถ้าสงสัยว่าหลุด (การบันทึกยังใช้ได้ แค่ไม่สั่ง build ทันที)
- **รหัสผ่าน, `SESSION_SECRET` และ token บน Cloud Run** ตอนนี้เป็น environment variable ใครมีสิทธิ์ดูโปรเจกต์ใน Cloud Console ก็เห็นได้
  ถ้าจะแชร์โปรเจกต์กับคนอื่น ให้ย้ายไปเก็บใน **Secret Manager** แล้วแก้ขั้น “Deploy to Cloud Run” ใน `deploy.yml`
  ให้ใช้ `--set-secrets ADMIN_PASSWORD=pho0m-admin-password:latest` แทนการใส่ในไฟล์ env
  (ต้องเปิด `secretmanager.googleapis.com` และให้ service account มี `roles/secretmanager.secretAccessor`)
- **ทุกไฟล์ใน bucket เป็นสาธารณะ** — `private/` ใครก็ดาวน์โหลดได้ แต่เป็นข้อมูลเข้ารหัส อ่านไม่ออกถ้าไม่มี `SESSION_SECRET`
  ส่วนรูปและ PDF ที่อัปโหลด**ไม่ได้เข้ารหัส** อย่าอัปโหลดอะไรที่ไม่อยากให้คนอื่นเห็น
- **GitHub Actions** — ทุก workflow ประกาศ `permissions` เท่าที่ใช้ และ action ของบุคคลที่สามใน `waka.yml` ปักไว้ที่ commit SHA
- **ลดสิทธิ์ถ้าต้องการ** — service account ตัวเดียวทำทั้ง deploy และรัน API เพื่อให้ตั้งค่าง่าย
  ถ้าอยากเข้มขึ้น แยก service account สำหรับรัน API ที่มีแค่ `roles/storage.objectAdmin` บน bucket
  และพิจารณาใช้ Workload Identity Federation แทน JSON key
- API จำกัดการเดารหัสผ่านไว้ในหน่วยความจำของแต่ละ instance จึงตั้ง `--max-instances 1` ไว้ใน `deploy.yml`
  นับ IP จากค่าขวาสุดของ `X-Forwarded-For` (ค่าที่ Google ต่อท้ายให้ ปลอมไม่ได้) และมีเพดานรวมทุก IP
  30 ครั้งต่อ 10 นาที กันการสุ่มรหัสจากหลาย IP (ระหว่างนั้นปิดเฉพาะเครื่องที่เพิ่งใส่ผิด เจ้าของยัง login ได้)
