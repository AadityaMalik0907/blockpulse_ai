import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchDashboardSnapshot, fetchMempoolJson, searchBlockchain } from './services/mempool.js';
import { AnomalyEngine } from './services/anomaly.js';
import { generateNetworkInsight, getAIConfig } from './services/ai.js';
import { createDatabase } from './db/database.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);
const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS || 20000);
const AI_REQUEST_LIMIT = Number(process.env.AI_REQUESTS_PER_MINUTE || 6);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../dist');

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use((_request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

let latestSnapshot = null;
let lastRefreshError = null;
let refreshInProgress = false;
let databaseReady = false;
let databaseError = null;
let latestAnomalyReport = null;
let shutdownTimer = null;
const clients = new Set();
const aiRequestWindows = new Map();
const memoryInsights = [];
const anomalyEngine = new AnomalyEngine();
const database = createDatabase();

function sendEvent(response, event, payload) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(event, payload) {
  for (const client of clients) {
    try {
      sendEvent(client, event, payload);
    } catch {
      clients.delete(client);
    }
  }
}

function rateLimitAi(request, response) {
  const now = Date.now();
  const key = request.ip || request.socket.remoteAddress || 'unknown';
  const current = aiRequestWindows.get(key) || { startedAt: now, count: 0 };
  if (now - current.startedAt >= 60_000) {
    current.startedAt = now;
    current.count = 0;
  }
  current.count += 1;
  aiRequestWindows.set(key, current);
  if (aiRequestWindows.size > 1000) {
    for (const [ip, window] of aiRequestWindows) {
      if (now - window.startedAt > 120_000) aiRequestWindows.delete(ip);
    }
  }
  if (current.count > AI_REQUEST_LIMIT) {
    response.setHeader('Retry-After', '60');
    response.status(429).json({ error: 'AI request limit reached. Wait one minute before asking again.' });
    return false;
  }
  return true;
}

async function refreshSnapshot() {
  if (refreshInProgress) return latestSnapshot;
  refreshInProgress = true;

  try {
    const snapshot = await fetchDashboardSnapshot();
    const unseenTransactions = (snapshot.recentTransactions || [])
      .filter((transaction) => transaction?.txid && !anomalyEngine.seenTxids.has(transaction.txid));
    const report = anomalyEngine.analyze(snapshot);

    if (databaseReady) {
      try {
        await database.persistRefresh(snapshot, unseenTransactions, report);
        report.persistence = { enabled: true, status: 'connected' };
        report.limitations = report.limitations.filter((item) => !item.startsWith('History is kept in server memory'));
      } catch (error) {
        databaseReady = false;
        databaseError = error.message;
        report.persistence = { enabled: true, status: 'degraded' };
        console.error(`[BlockPulse] Database persistence failed: ${error.message}`);
      }
    } else {
      report.persistence = { enabled: false, status: 'memory-only' };
    }

    snapshot.anomalyReport = report;
    latestAnomalyReport = report;
    latestSnapshot = snapshot;
    lastRefreshError = null;
    broadcast('snapshot', snapshot);
    broadcast('status', { status: 'connected', message: 'Live network data refreshed.', lastUpdated: snapshot.fetchedAt });
    return snapshot;
  } catch (error) {
    lastRefreshError = {
      message: error.message,
      at: new Date().toISOString(),
      details: error.details || [],
    };
    broadcast('status', {
      status: latestSnapshot ? 'stale' : 'disconnected',
      message: error.message,
      lastUpdated: latestSnapshot?.fetchedAt || null,
    });
    console.error(`[BlockPulse] Refresh failed: ${error.message}`);
    return latestSnapshot;
  } finally {
    refreshInProgress = false;
  }
}

app.get('/api/health', async (_request, response) => {
  let databaseStatus = 'not-configured';
  if (database) {
    databaseStatus = databaseReady ? 'connected' : 'disconnected';
    if (databaseReady) {
      try {
        await database.ping();
      } catch (error) {
        databaseStatus = 'degraded';
        databaseError = error.message;
      }
    }
  }
  const ai = getAIConfig();
  response.json({
    status: latestSnapshot ? 'ok' : 'degraded',
    service: 'blockpulse-api',
    version: '1.0.0',
    dataSource: 'mempool.space',
    lastUpdated: latestSnapshot?.fetchedAt || null,
    lastRefreshError,
    database: { configured: Boolean(database), status: databaseStatus, error: databaseError },
    ai,
    anomalyEngine: latestAnomalyReport ? {
      baselineSamples: latestAnomalyReport.baseline.transactionSamples,
      alerts: latestAnomalyReport.summary.totalAlerts,
    } : null,
  });
});

app.get('/api/dashboard', async (_request, response) => {
  if (!latestSnapshot) await refreshSnapshot();
  if (!latestSnapshot) {
    return response.status(503).json({
      error: 'Bitcoin network data is temporarily unavailable.',
      details: lastRefreshError?.details || [],
    });
  }
  response.json(latestSnapshot);
});

app.get('/api/anomalies', async (_request, response) => {
  if (!latestSnapshot) await refreshSnapshot();
  response.json(latestAnomalyReport || {
    engineVersion: '1.0.0',
    baseline: { transactionSamples: 0, requiredSamples: 20, isReady: false, arrivalWindows: 0 },
    summary: { totalAlerts: 0, newAlerts: 0, transactionAlerts: 0, networkAlerts: 0, critical: 0, high: 0, medium: 0, low: 0, averageScore: 0, newTransactionsLastInterval: 0 },
    alerts: [],
  });
});

app.get('/api/blocks', async (_request, response) => {
  if (!latestSnapshot) await refreshSnapshot();
  response.json({ blocks: latestSnapshot?.blocks || [], fetchedAt: latestSnapshot?.fetchedAt || null });
});

app.get('/api/history', async (request, response, next) => {
  try {
    const hours = Math.min(Math.max(Number(request.query.hours) || 24, 1), 168);
    if (!databaseReady) {
      return response.json({ persisted: false, hours, points: [], message: 'Start PostgreSQL to retain and query historical network snapshots.' });
    }
    const points = await database.getHistory(hours);
    response.json({ persisted: true, hours, points });
  } catch (error) {
    next(error);
  }
});

app.get('/api/transactions/:txid', async (request, response, next) => {
  try {
    const { txid } = request.params;
    if (!/^[a-fA-F0-9]{64}$/.test(txid)) {
      return response.status(400).json({ error: 'Transaction ID must be 64 hexadecimal characters.' });
    }
    const transaction = await fetchMempoolJson(`/tx/${txid}`);
    response.json(transaction);
  } catch (error) {
    next(error);
  }
});

app.get('/api/search/:query', async (request, response, next) => {
  try {
    const result = await searchBlockchain(request.params.query);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/ai/status', (_request, response) => {
  const config = getAIConfig();
  response.json({
    ...config,
    enabled: config.configured,
    message: config.configured
      ? config.providers.openai
        ? 'AI insight generation is configured. OpenAI is tried first; Gemini is used as fallback when configured.'
        : 'AI insight generation is configured with Gemini.'
      : 'Add OPENAI_API_KEY or GEMINI_API_KEY to the server .env file to enable AI-generated analysis.',
  });
});

app.get('/api/ai/insights/recent', async (_request, response, next) => {
  try {
    const insights = databaseReady ? await database.listInsights(10) : memoryInsights.slice(0, 10);
    response.json({ persisted: databaseReady, insights });
  } catch (error) {
    next(error);
  }
});

app.post('/api/ai/insights', async (request, response, next) => {
  if (!rateLimitAi(request, response)) return;
  try {
    if (!latestSnapshot) await refreshSnapshot();
    if (!latestSnapshot) {
      return response.status(503).json({ error: 'Bitcoin network data is not available yet. Try again after the next refresh.' });
    }
    const question = typeof request.body?.question === 'string' ? request.body.question.trim() : '';
    if (question.length > 500) {
      return response.status(400).json({ error: 'Keep your question under 500 characters.' });
    }
    const insight = await generateNetworkInsight({
      snapshot: latestSnapshot,
      anomalyReport: latestAnomalyReport,
      question,
    });
    const { inputSnapshot, ...publicInsight } = insight;

    if (databaseReady) {
      const saved = await database.saveInsight({
        question,
        model: insight.model,
        payload: publicInsight,
        inputSnapshot,
      });
      publicInsight.id = saved.id;
      publicInsight.generatedAt = saved.createdAt;
    } else {
      memoryInsights.unshift(publicInsight);
      if (memoryInsights.length > 10) memoryInsights.length = 10;
    }

    response.status(201).json({ ...publicInsight, persisted: databaseReady });
  } catch (error) {
    next(error);
  }
});

app.get('/api/events', async (_request, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders?.();
  clients.add(response);
  sendEvent(response, 'status', { status: 'connected', message: 'Live update stream connected.' });

  if (latestSnapshot) sendEvent(response, 'snapshot', latestSnapshot);
  else await refreshSnapshot();

  const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 25_000);
  response.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(response);
  });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(DIST_DIR, { index: false, maxAge: '1h' }));
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api/')) return next();
    response.sendFile(path.join(DIST_DIR, 'index.html'), (error) => {
      if (error) next(error);
    });
  });
}

app.use('/api', (_request, response) => response.status(404).json({ error: 'API endpoint not found.' }));
app.use((error, _request, response, _next) => {
  const status = Number(error.status) || 502;
  response.status(status).json({
    error: error.message || 'The request could not be completed.',
    code: error.code,
    details: process.env.NODE_ENV === 'development' ? error.providerMessage || error.message : undefined,
  });
});

async function startServer() {
  if (database) {
    try {
      await database.initialize();
      const state = await database.loadEngineState();
      anomalyEngine.hydrate(state);
      databaseReady = true;
      console.log(`[BlockPulse] PostgreSQL connected; restored ${state.transactions.length} transaction observations and ${state.alerts.length} alerts.`);
    } catch (error) {
      databaseError = error.message;
      console.error(`[BlockPulse] PostgreSQL initialization failed: ${error.message}`);
      if (process.env.REQUIRE_DATABASE === 'true') process.exit(1);
    }
  } else if (process.env.REQUIRE_DATABASE === 'true') {
    console.error('[BlockPulse] REQUIRE_DATABASE=true but DATABASE_URL is missing.');
    process.exit(1);
  }

  const server = app.listen(PORT, async () => {
    console.log(`[BlockPulse] API server listening on http://localhost:${PORT}`);
    console.log(`[BlockPulse] Refresh interval: ${REFRESH_INTERVAL_MS / 1000}s`);
    await refreshSnapshot();
    shutdownTimer = setInterval(refreshSnapshot, REFRESH_INTERVAL_MS);
  });

  const shutdown = async (signal) => {
    console.log(`[BlockPulse] ${signal} received; shutting down.`);
    clearInterval(shutdownTimer);
    for (const client of clients) client.end();
    server.close(async () => {
      if (database) await database.close().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();

export { app };
