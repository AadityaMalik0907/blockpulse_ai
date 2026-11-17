import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightContext, normalizeInsight } from './ai.js';

const snapshot = {
  fetchedAt: '2026-11-16T00:00:00.000Z',
  source: 'mempool.space',
  network: { mempoolCount: 1234, mempoolVsize: 987654, mempoolSizeMb: 0.98, tipHeight: 900000 },
  fees: { fastestFee: 25, halfHourFee: 18, hourFee: 12, economyFee: 8 },
  btcPriceUsd: 90000,
  recentTransactions: [{ txid: 'a'.repeat(64) }],
  blocks: [{ height: 900000 }],
};
const report = {
  summary: { totalAlerts: 2, critical: 0, high: 1, medium: 1, low: 0, newAlerts: 1, averageScore: 57 },
  baseline: { transactionSamples: 25, requiredSamples: 20, isReady: true },
  alerts: [{ kind: 'transaction', severity: 'high', score: 70, categories: ['value_outlier'], signals: ['Unusually high aggregate output value'], valueBtc: 30, feeRate: 20, feeSats: 1000, txid: 'a'.repeat(64) }],
};

test('buildInsightContext sends bounded, relevant monitoring evidence', () => {
  const context = buildInsightContext(snapshot, report);
  assert.equal(context.network.mempoolTransactions, 1234);
  assert.equal(context.anomalySummary.totalAlerts, 2);
  assert.equal(context.topAlerts.length, 1);
  assert.ok(context.importantDataLimitations.length >= 3);
});

test('normalizeInsight parses valid structured Gemini output', () => {
  const insight = normalizeInsight(JSON.stringify({
    title: 'Elevated mempool activity',
    summary: 'The current snapshot shows a larger backlog.',
    networkState: 'Elevated',
    notableSignals: [{ title: 'High value sample', severity: 'high', evidence: '30 BTC aggregate output', interpretation: 'Review transaction outputs.' }],
    recommendedChecks: ['Inspect transaction outputs'],
    limitations: ['The feed is limited to recent mempool transactions'],
  }));
  assert.equal(insight.networkState, 'Elevated');
  assert.equal(insight.notableSignals[0].severity, 'high');
  assert.deepEqual(insight.recommendedChecks, ['Inspect transaction outputs']);
});

test('normalizeInsight safely falls back when the model returns non-JSON text', () => {
  const insight = normalizeInsight('Plain text answer from a model.');
  assert.equal(insight.summary, 'Plain text answer from a model.');
  assert.equal(insight.networkState, 'Review');
  assert.equal(insight.notableSignals.length, 0);
});

test('returns a clear setup error when Gemini is not configured', async () => {
  const { generateNetworkInsight } = await import('./ai.js');
  const previous = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await assert.rejects(
      generateNetworkInsight({ snapshot, anomalyReport: report }),
      (error) => error.status === 503 && error.code === 'GEMINI_NOT_CONFIGURED',
    );
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }
});

test('sends the server-side Gemini key and returns a normalized response', async () => {
  const { generateNetworkInsight } = await import('./ai.js');
  const previousKey = process.env.GEMINI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'unit-test-key';
  process.env.GEMINI_MODEL = 'gemini-test-model';
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(options.headers['x-goog-api-key'], 'unit-test-key');
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'gemini-test-model');
    assert.equal(request.response_format.mime_type, 'application/json');
    assert.equal(request.store, false);
    return {
      ok: true,
      json: async () => ({
        steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({
          title: 'Unit test brief',
          summary: 'Synthetic test observation.',
          networkState: 'Calm',
          notableSignals: [],
          recommendedChecks: ['Verify the sample feed'],
          limitations: ['Synthetic test payload'],
        }) }] }],
      }),
    };
  };
  try {
    const result = await generateNetworkInsight({ snapshot, anomalyReport: report, question: 'Explain the current snapshot.' });
    assert.equal(result.title, 'Unit test brief');
    assert.equal(result.model, 'gemini-test-model');
    assert.equal(result.question, 'Explain the current snapshot.');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousModel;
  }
});
