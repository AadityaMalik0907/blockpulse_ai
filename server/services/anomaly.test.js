import test from 'node:test';
import assert from 'node:assert/strict';
import { AnomalyEngine } from './anomaly.js';

function tx(overrides = {}) {
  const valueSats = overrides.valueSats ?? 120_000_000;
  const feeSats = overrides.feeSats ?? 800;
  const vsize = overrides.vsize ?? 200;
  return {
    txid: overrides.txid || 'a'.repeat(64),
    valueSats,
    valueBtc: valueSats / 100_000_000,
    feeSats,
    vsize,
    feeRate: overrides.feeRate ?? feeSats / vsize,
    usdValue: 0,
    status: 'Unconfirmed',
  };
}

function snapshot(transactions, fastestFee = 10) {
  return { recentTransactions: transactions, fees: { fastestFee } };
}

test('does not flag ordinary transactions during baseline warm-up', () => {
  const engine = new AnomalyEngine();
  const report = engine.analyze(snapshot([tx()]));
  assert.equal(report.summary.totalAlerts, 0);
  assert.equal(report.baseline.isReady, false);
});

test('flags an extremely high aggregate output value using an absolute threshold', () => {
  const engine = new AnomalyEngine();
  const report = engine.analyze(snapshot([tx({ txid: 'b'.repeat(64), valueSats: 12_000_000_000 })]));
  assert.equal(report.summary.transactionAlerts, 1);
  assert.equal(report.alerts[0].severity, 'medium');
  assert.ok(report.alerts[0].signals.some((signal) => signal.includes('aggregate output value')));
});

test('uses a rolling robust baseline to flag a statistical value outlier', () => {
  const engine = new AnomalyEngine();
  const baseline = Array.from({ length: 25 }, (_, index) => tx({ txid: index.toString(16).padStart(64, '0'), valueSats: 100_000_000 + index * 100_000 }));
  engine.analyze(snapshot(baseline));
  const report = engine.analyze(snapshot([...baseline.slice(1), tx({ txid: 'f'.repeat(64), valueSats: 4_000_000_000 })]));
  assert.equal(report.baseline.isReady, true);
  assert.ok(report.alerts.some((alert) => alert.txid === 'f'.repeat(64)));
});

test('flags a new-transaction arrival burst after enough observation windows', () => {
  const engine = new AnomalyEngine();
  for (let index = 0; index < 6; index += 1) {
    engine.analyze(snapshot([tx({ txid: (index + 1).toString(16).padStart(64, '0') })]));
  }
  const burst = Array.from({ length: 8 }, (_, index) => tx({ txid: (100 + index).toString(16).padStart(64, '0') }));
  const report = engine.analyze(snapshot(burst));
  assert.ok(report.alerts.some((alert) => alert.kind === 'network' && alert.categories.includes('arrival_burst')));
});

test('hydrates the rolling baseline and retained alerts after a server restart', () => {
  const original = new AnomalyEngine();
  const baseline = Array.from({ length: 24 }, (_, index) => tx({
    txid: (index + 200).toString(16).padStart(64, '0'),
    valueSats: 90_000_000 + index * 50_000,
  }));
  const firstReport = original.analyze(snapshot(baseline));
  const restored = new AnomalyEngine();
  restored.hydrate({
    transactions: original.transactionHistory,
    alerts: original.alerts,
    arrivalWindows: original.arrivalWindows,
  });
  const next = tx({ txid: 'e'.repeat(64), valueSats: 95_000_000 });
  const nextReport = restored.analyze(snapshot([...baseline.slice(1), next]));
  assert.equal(firstReport.baseline.isReady, true);
  assert.equal(nextReport.baseline.transactionSamples, 25);
  assert.equal(nextReport.baseline.isReady, true);
});
