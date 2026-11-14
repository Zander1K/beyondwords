# Deploy the API on Aiven Runtime

The FastAPI backend (`apps/api`) runs on Aiven Runtime next to the Aiven PostgreSQL database
(`words-db-locked`). Owner: Mick Ola. Written 2026-11-14 from the Aiven Runtime docs; labels in
the console may differ slightly.

```
Phone / web app --HTTPS--> Aiven Runtime (FastAPI, port 8000) --SSL--> Aiven PostgreSQL
                                    |--> Gemini API
                                    '--> Nemotron on Verda
```

## What the repo already does for Runtime

- `apps/api/Dockerfile` builds from the **repo root** (it copies `db/migrations`).
- On every start the container runs `alembic upgrade head`, then starts uvicorn on port **8000**.
  Runtime has no pre-deploy step, so this is how new migrations reach the database. Set
  `RUN_MIGRATIONS=0` to skip it.
- `app/config.py` accepts the URL Runtime injects (`postgresql://...?sslmode=require&uselibpqcompat=true`)
  and converts it for asyncpg. You do not need to rewrite it by hand.

## Before you start

1. Make sure `main` on GitHub has this guide's changes (Runtime only builds what is pushed).
2. You need these Aiven permissions: organization admin to connect GitHub, and project
   admin/manager to deploy.
3. Check the console shows **Runtime** in the project's left menu. Some Aiven pages still call it
   "Limited availability".

## Step 1: Connect GitHub

1. Aiven Console > open the project that holds `words-db-locked`.
2. Click **Runtime** > **Deploy application**.
3. Select or connect your **GitHub account**. Give the Aiven GitHub app access to
   `Zander1K/beyondwords`. If the repo is owned by an organization, an organization owner has to
   approve it, so ask Zander if it is not listed.

## Step 2: Pick the repo and the Dockerfile

1. **Account**: `Zander1K`. **Repository**: `beyondwords`. **Branch**: `main`. Click **Next**.
2. Choose the manifest: pick **`apps/api/Dockerfile`**.
   **Do not pick `docker-compose.yml`**: it also declares a `postgres` service, and Runtime would
   create a second, paid PostgreSQL service.
3. Click **Scan**. Then open the application's settings (the edit icon next to it) and check:
   - **Name**: `reading-companion-api` (lowercase letters, digits and `-`).
   - **Build path**: `.` (repo root). **Dockerfile path**: `apps/api/Dockerfile`.
   - **Port**: `8000`, protocol **HTTP**, name `http` (Scan should read it from `EXPOSE 8000`).
4. If the scan offers to create any data service, remove it: we connect the existing database in
   step 4.
5. Cloud: pick the **same cloud and region as `words-db-locked`** (see that service's Overview).
   Every request makes several database round trips, so distance adds up.
6. Plan: the smallest plan is enough for the demo. Check the price shown before deploying.
7. Click **Deploy**. Watch **Build logs**; the first build takes a few minutes.

The first start will fail its database calls until step 4 is done; that's expected.

## Step 3: Environment variables

App > **Overview** > **Environment variables** > **Edit** > **Add variable**. Tick **Secret** for
every key. You can also use **Import from file** with a file in this format (never commit it).

| Variable | Value | Secret |
|---|---|---|
| `APP_NAME` | `Reading Companion` | no |
| `LOG_LEVEL` | `INFO` | no |
| `LLM_PROVIDER` | `nemotron` | no |
| `NEMOTRON_BASE_URL` | the Verda URL from `.env.example` | no |
| `NEMOTRON_API_KEY` | Verda key (ask Matthew); `POST /ask` needs it | **yes** |
| `NEMOTRON_MODEL` | `nemotron-3.5-super-vl` (the default; only set it if Matthew changes it) | no |
| `NEMOTRON_TIMEOUT_S` | `60` (the default) | no |
| `NVIDIA_BUILD_API_KEY` | NVIDIA Build fallback key (optional) | **yes** |
| `GEMINI_API_KEY` | the **new** Gemini key | **yes** |
| `GEMINI_CHAT_MODEL` | `gemini-4-hydrogen` | no |
| `GEMINI_IMAGE_MODEL` | `gemini-3.1-flash-lite-image` | no |
| `GOOGLE_BOOKS_API_KEY` | optional | **yes** |
| `CORS_ORIGINS` | `http://localhost:5173` plus the deployed web app URL, comma-separated | no |

Do **not** add `DATABASE_URL` here (step 4 injects it) or the `POSTGRES_*` variables (those are
only for local docker compose). Saving redeploys the app.

## Step 4: Connect the database

1. App > **Connected services** > **Connect service** > pick `words-db-locked` > **Connect**.
2. Runtime injects `DATABASE_URL` (the full service URI). The app converts it for asyncpg.
3. This redeploys. In **Runtime logs** you should see `alembic` say the database is at `0002`
   (or upgrade it), then uvicorn start.

## Step 5: Check it works

1. App > **Connection information**: copy the **Application URL** (`https://...aiven.app`).
2. Open `https://<url>/health`. Expected:
   `{"status":"ok","app":"Reading Companion","database":"ok"}`.
   `"database":"unavailable"` means step 4 is missing or the URL is wrong; check **Runtime logs**.
3. Open `https://<url>/docs` and try `POST /illustrate` with `{"text": "portcullis"}`.
4. Give Alex the URL: the web app sets it as `VITE_API_BASE_URL`, and the URL of the web app
   itself goes into `CORS_ORIGINS` (step 3).

## Day to day

- **Pushes do not deploy by themselves.** After merging to `main`: app > **Overview** >
  **Actions** > **Deploy latest commit**.
- Logs: app > **Build logs** / **Runtime logs** (kept for 24 hours).
- New migration: merge it, then **Deploy latest commit**; it runs on start.
- Keep **one** instance: illustrations and conversations are cached in memory (`HACK:`), so a
  second instance or a restart loses them. Moving that cache to Aiven Valkey removes the limit.

## Known gaps

- The URL is public and has no login (username-only sign-in). Fine for the demo; Aiven has app
  authentication options to look at before real users.
- Brain tuning uses `BRAIN_*` variables (`apps/api/app/brain/settings.py`, `docs/BRAIN.md`); the
  defaults are fine, so none are needed to deploy.
- OPEN QUESTION: whether Runtime cuts off long requests. Nemotron may take up to
  `NEMOTRON_TIMEOUT_S` (60 s); if `/ask` fails at a fixed time in the logs, lower it.
- `sslmode=require` encrypts the connection but does not verify the server certificate.
- OPEN QUESTION: plan size, price and whether apps sleep when idle are not in the docs we read;
  check in the console.
