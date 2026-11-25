# BlockPulse AI — Final Prototype

A full-stack Bitcoin mainnet monitoring prototype with a React dashboard, Express API, live mempool.space data, a transparent anomaly detector, AI-assisted network analysis, and PostgreSQL persistence.

## Capabilities

- Live Bitcoin mempool metrics, recommended fees, BTC/USD quote, recent transactions, and recent blocks.
- Server-Sent Events (SSE) to push refreshed dashboard snapshots to the browser.
- Blockchain lookup for transaction IDs, block height/hash, and Bitcoin addresses.
- Hybrid anomaly detection using explicit thresholds, rolling Median Absolute Deviation (MAD) statistics, and approximate transaction-arrival bursts.
- OpenAI-first network briefs with Gemini fallback, using the latest network snapshot and anomaly evidence.
- PostgreSQL storage for network snapshots, unique transaction observations, anomaly alerts, arrival windows, and AI reports.
- Dockerfile and Docker Compose stack for a single-origin container deployment with PostgreSQL.

## Requirements

- Node.js 22.12+ (22 LTS recommended) and npm.
- Docker Desktop with Docker Compose for PostgreSQL and/or the full container stack.
- Internet access for Bitcoin network data.
- Optional: OpenAI and/or Gemini API keys to enable AI insights. OpenAI is tried first when configured; Gemini is used if OpenAI fails.

## Option A — Run locally in VS Code (recommended for development)

1. Extract the project and open the `blockpulse-ai` folder in VS Code.
2. Open the integrated terminal and create your local environment file:

   **PowerShell (Windows):**

   ```powershell
   Copy-Item .env.example .env
   ```

   **macOS/Linux:**

   ```bash
   cp .env.example .env
   ```

3. Start the PostgreSQL database container:

   ```bash
   docker compose up -d db
   ```

4. Install the Node dependencies:

   ```bash
   npm install
   ```

5. (Optional but recommended) Set `OPENAI_API_KEY` in `.env` for the primary provider. Set `GEMINI_API_KEY` too to enable automatic fallback. Either key can be used by itself.
6. Start the frontend and backend together:

   ```bash
   npm run dev
   ```

7. Open `http://localhost:5173`.

The Vite development server proxies `/api` requests to the Express API at `http://localhost:4000`. The database is available at `localhost:5432`.

## Option B — Run the complete stack with Docker

1. Create `.env` from `.env.example` as shown above.
2. Add `OPENAI_API_KEY` and optionally `GEMINI_API_KEY` to `.env` if AI insights are required.
3. Build and start the full application plus PostgreSQL:

   ```bash
   docker compose up --build
   ```

4. Open `http://localhost:4000`.

The production container serves the compiled React application and Express API from the same origin. PostgreSQL data is kept in the named Docker volume `blockpulse_pgdata`.

Stop the stack with:

```bash
docker compose down
```

To delete the database volume as well (this permanently deletes locally persisted project data):

```bash
docker compose down -v
```

## AI provider setup

1. Add the OpenAI key to the root `.env` file for the primary provider. Optionally add a Gemini key as backup:

   ```env
   OPENAI_API_KEY=your_openai_api_key
   OPENAI_MODEL=gpt-5.4-mini
   GEMINI_API_KEY=your_real_key_here
   GEMINI_MODEL=gemini-3.8-flash
   ```

   Create an OpenAI key at https://platform.openai.com/api-keys and a Gemini key at https://aistudio.google.com/app/apikey.
2. Restart the backend (`npm run dev`) or rebuild/restart Docker (`docker compose up --build`).
3. Open **AI insights** in the sidebar and generate a network brief or ask a question.

Keys are read only by the Express server and never included in the Vite bundle or sent to the browser. OpenAI is called first with structured output and storage disabled; when it fails, the server tries Gemini if configured. The AI endpoint has a simple per-IP request limit configured by `AI_REQUESTS_PER_MINUTE` (default 6/minute).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | Express server port |
| `DATABASE_URL` | local PostgreSQL URL in `.env.example` | PostgreSQL connection string |
| `REQUIRE_DATABASE` | `true` in example / Compose | Fail startup if PostgreSQL cannot initialize |
| `DB_SSL` | `false` | Enable TLS for managed PostgreSQL |
| `DB_SSL_REJECT_UNAUTHORIZED` | `true` | Validate database TLS certificates |
| `PG_POOL_SIZE` | `8` | PostgreSQL connection pool size |
| `OPENAI_API_KEY` | empty | Server-side OpenAI API key; primary AI provider |
| `OPENAI_MODEL` | `gpt-5.4-mini` | OpenAI model identifier |
| `OPENAI_TIMEOUT_MS` | `30000` | OpenAI request timeout |
| `GEMINI_API_KEY` | empty | Server-side Google Gemini API key |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Gemini model identifier |
| `GEMINI_TIMEOUT_MS` | `30000` | AI request timeout |
| `AI_REQUESTS_PER_MINUTE` | `6` | Per-IP AI request limit |
| `MEMPOOL_API_BASE` | `https://mempool.space/api` | Bitcoin data API base URL |
| `MEMPOOL_TIMEOUT_MS` | `10000` | Upstream request timeout |
| `REFRESH_INTERVAL_MS` | `20000` | Dashboard snapshot refresh interval |

If you do not have Docker available, set `REQUIRE_DATABASE=false` and remove/comment `DATABASE_URL` to run in memory-only mode. The database-backed history and persistent anomaly baseline will then be unavailable.

## Commands

```bash
npm run dev       # Vite + Express development servers
npm run build     # production React build
npm run preview   # preview Vite build locally
npm test          # anomaly and AI prompt/normalization unit tests
npm run check     # server-side JavaScript syntax checks
npm start         # Express API / production server
```

## API endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | API, data source, database, and AI provider health/configuration |
| GET | `/api/dashboard` | Current normalized Bitcoin snapshot plus anomaly report |
| GET | `/api/anomalies` | Current detector summary, baseline and alerts |
| GET | `/api/blocks` | Cached recent blocks |
| GET | `/api/history?hours=24` | Persisted network history (1–168 hours) |
| GET | `/api/search/:query` | Search transaction, block height/hash, or address |
| GET | `/api/transactions/:txid` | Full transaction detail |
| GET | `/api/events` | SSE snapshot updates |
| GET | `/api/ai/status` | AI provider configuration status (never exposes keys) |
| GET | `/api/ai/insights/recent` | Recent persisted or in-memory AI briefs |
| POST | `/api/ai/insights` | Generate an AI network brief or answer a monitoring question |

Example AI request:

```bash
curl -X POST http://localhost:4000/api/ai/insights \
  -H "Content-Type: application/json" \
  -d '{"question":"Explain the high-priority anomaly signals and suggest what to inspect next."}'
```

## Anomaly detection methodology

The detector combines absolute guardrails with robust rolling statistics:

- Aggregate output value: flag at 25 BTC; stronger guardrail at 100 BTC.
- Fee rate: flag at or above the greater of 80 sat/vB or four times the current recommended fastest fee.
- Absolute fee: flag at 250,000 sats; stronger guardrail at 1,000,000 sats.
- Virtual size: flag at 100,000 vB.
- Statistical outliers: robust z-score of at least 4 after at least 20 prior observations, using a rolling median and median absolute deviation (MAD), with an IQR fallback when MAD is zero.
- Arrival bursts: compare the number of new transaction IDs in each polling window with the recent rolling average after at least five prior windows.

The 0–100 anomaly score is a review-priority heuristic, not a probability of fraud. AI explanations are generated from these signals and the current network snapshot; the model is instructed not to infer wallet ownership, real-world identity, criminal intent, or missing transaction facts.

## Data-source constraints

The public mempool.space `/mempool/recent` endpoint supplies only the latest 10 transactions with simplified `txid`, `fee`, `vsize`, and aggregate output `value` fields. Aggregate output value is not necessarily the amount sent to one recipient. The prototype does not make claims about wallet ownership or intent and does not fetch full details for every mempool item on every refresh. Respect the upstream provider's rate limits.

## PostgreSQL persistence

The application initializes its schema at startup using `server/db/schema.sql`. It stores:

- Network snapshots (30-day cleanup window).
- Unique transaction feature observations (used to restore the rolling anomaly baseline).
- Anomaly alerts (90-day cleanup window).
- Transaction arrival windows (14-day cleanup window).
- AI-generated insight reports and their input context.

On startup, the server restores the latest 2,000 transaction observations, 100 alerts, and 30 arrival windows into the anomaly engine. This means the statistical baseline can survive normal server restarts while PostgreSQL data remains available.

## Deployment

The included Dockerfile is a multi-stage production build. Deploy it to a container host and configure these environment variables on the host (not in the source code):

- `NODE_ENV=production`
- `PORT=4000`
- `DATABASE_URL` pointing to a managed PostgreSQL database
- `REQUIRE_DATABASE=true`
- `DB_SSL=true` if the managed database requires TLS
- `OPENAI_API_KEY` and optionally `OPENAI_MODEL`
- Optional Gemini fallback: `GEMINI_API_KEY` and `GEMINI_MODEL`
- Optional upstream timeout and refresh interval settings

Expose port `4000` and use `/api/health` as the health-check path. Attach a persistent managed PostgreSQL instance; do not rely on the container filesystem for database data. Use a strong database password and keep `.env` out of version control. For a public production service, add authentication, durable distributed rate limiting, secrets management, backups, and monitoring before inviting external users.

## Tests and verification

```bash
npm run check
npm test
npm run build
```

The tests use Node's built-in test runner and do not need AI provider keys or PostgreSQL. Live AI requests, mempool connectivity, and database integration require local credentials and running services.

## Project layout

```text
blockpulse-ai/
├── server/
│   ├── db/
│   │   ├── database.js
│   │   └── schema.sql
│   ├── services/
│   │   ├── ai.js
│   │   ├── ai.test.js
│   │   ├── anomaly.js
│   │   ├── anomaly.test.js
│   │   └── mempool.js
│   └── index.js
├── src/
│   ├── hooks/
│   ├── services/
│   ├── App.jsx
│   ├── index.css
│   └── main.jsx
├── .env.example
├── .dockerignore
├── .gitignore
├── docker-compose.yml
├── Dockerfile
├── package.json
└── README.md
```
