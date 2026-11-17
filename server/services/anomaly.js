const DEFAULT_HISTORY_LIMIT = 2_000;
const DEFAULT_ALERT_LIMIT = 100;
const MIN_STATISTICAL_BASELINE = 20;

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function robustZScore(value, samples) {
  if (samples.length < MIN_STATISTICAL_BASELINE) return null;
  const center = median(samples);
  const deviations = samples.map((sample) => Math.abs(sample - center));
  const mad = median(deviations);

  // 1.4826 makes MAD comparable to standard deviation for a normal distribution.
  // If MAD is zero, fall back to the IQR; a constant baseline makes any material
  // movement away from the baseline noteworthy rather than dividing by zero.
  let scale = mad * 1.4826;
  if (scale === 0) {
    const sorted = [...samples].sort((a, b) => a - b);
    const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)];
    const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)];
    scale = (q3 - q1) / 1.349;
  }

  if (scale === 0) return value > center ? 99 : 0;
  return (value - center) / scale;
}

function severityFor(score) {
  if (score >= 85) return 'critical';
  if (score >= 65) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function scoreTransaction(transaction, history, fastestFee, detectedAt) {
  const valueBtc = toFiniteNumber(transaction.valueBtc);
  const feeSats = toFiniteNumber(transaction.feeSats);
  const feeRate = toFiniteNumber(transaction.feeRate);
  const vsize = toFiniteNumber(transaction.vsize);

  const valueSamples = history.map((item) => toFiniteNumber(item.valueBtc));
  const feeRateSamples = history.map((item) => toFiniteNumber(item.feeRate));
  const feeSamples = history.map((item) => toFiniteNumber(item.feeSats));
  const vsizeSamples = history.map((item) => toFiniteNumber(item.vsize));

  const valueZ = robustZScore(valueBtc, valueSamples);
  const feeRateZ = robustZScore(feeRate, feeRateSamples);
  const feeZ = robustZScore(feeSats, feeSamples);
  const vsizeZ = robustZScore(vsize, vsizeSamples);

  const signals = [];
  let score = 0;

  // Absolute guardrails allow the prototype to flag extreme observations while
  // the rolling statistical baseline is still warming up.
  if (valueBtc >= 100) {
    score += 45;
    signals.push('Very high aggregate output value (100 BTC or more)');
  } else if (valueBtc >= 25) {
    score += 30;
    signals.push('High aggregate output value (25 BTC or more)');
  }
  if (valueZ !== null && valueZ >= 4) {
    score += 25;
    signals.push(`Output value is a strong statistical outlier (robust z-score ${valueZ.toFixed(1)})`);
  }

  const feeRateThreshold = Math.max(80, toFiniteNumber(fastestFee) * 4);
  if (feeRate >= feeRateThreshold) {
    score += 25;
    signals.push(`Fee rate is unusually high (${feeRate.toFixed(1)} sat/vB)`);
  } else if (feeRateZ !== null && feeRate >= 20 && feeRateZ >= 4) {
    score += 20;
    signals.push(`Fee rate is a strong statistical outlier (robust z-score ${feeRateZ.toFixed(1)})`);
  }

  if (feeSats >= 1_000_000) {
    score += 25;
    signals.push('Very high absolute transaction fee (1,000,000 sats or more)');
  } else if (feeSats >= 250_000) {
    score += 18;
    signals.push('High absolute transaction fee (250,000 sats or more)');
  } else if (feeZ !== null && feeZ >= 4) {
    score += 15;
    signals.push(`Absolute fee is a strong statistical outlier (robust z-score ${feeZ.toFixed(1)})`);
  }

  if (vsize >= 100_000) {
    score += 15;
    signals.push('Unusually large transaction virtual size (100,000 vB or more)');
  } else if (vsizeZ !== null && vsizeZ >= 4) {
    score += 12;
    signals.push(`Virtual size is a strong statistical outlier (robust z-score ${vsizeZ.toFixed(1)})`);
  }

  const cappedScore = Math.min(100, score);
  if (cappedScore < 30) return null;

  const categories = [];
  if (signals.some((signal) => signal.toLowerCase().includes('output value'))) categories.push('value_outlier');
  if (signals.some((signal) => signal.toLowerCase().includes('fee rate'))) categories.push('fee_rate_outlier');
  if (signals.some((signal) => signal.toLowerCase().includes('absolute fee'))) categories.push('fee_outlier');
  if (signals.some((signal) => signal.toLowerCase().includes('virtual size'))) categories.push('size_outlier');

  return {
    id: `tx-${transaction.txid}`,
    kind: 'transaction',
    txid: transaction.txid,
    detectedAt,
    score: cappedScore,
    severity: severityFor(cappedScore),
    categories,
    signals,
    valueBtc,
    valueSats: toFiniteNumber(transaction.valueSats),
    feeSats,
    feeRate,
    vsize,
    baselineSampleCount: history.length,
    statisticalBaselineReady: history.length >= MIN_STATISTICAL_BASELINE,
    explanation: 'This transaction differs from the current rule thresholds or observed transaction baseline. It is a review signal, not a fraud determination.',
  };
}

export class AnomalyEngine {
  constructor({ historyLimit = DEFAULT_HISTORY_LIMIT, alertLimit = DEFAULT_ALERT_LIMIT } = {}) {
    this.historyLimit = historyLimit;
    this.alertLimit = alertLimit;
    this.transactionHistory = [];
    this.seenTxids = new Set();
    this.arrivalWindows = [];
    this.alerts = [];
    this.lastAnalyzedAt = null;
    this.newTransactionsLastInterval = 0;
  }

  hydrate({ transactions = [], alerts = [], arrivalWindows = [] } = {}) {
    this.transactionHistory = transactions.slice(-this.historyLimit).map((item) => ({
      txid: String(item.txid || ''),
      valueBtc: toFiniteNumber(item.valueBtc),
      valueSats: toFiniteNumber(item.valueSats),
      feeSats: toFiniteNumber(item.feeSats),
      feeRate: toFiniteNumber(item.feeRate),
      vsize: toFiniteNumber(item.vsize),
    }));
    this.seenTxids = new Set(this.transactionHistory.map((item) => item.txid).filter(Boolean));
    this.alerts = alerts.slice(-this.alertLimit);
    this.arrivalWindows = arrivalWindows.slice(-30).map((window) => ({
      at: window.at,
      count: toFiniteNumber(window.count),
    }));
    this.lastAnalyzedAt = this.arrivalWindows.at(-1)?.at || null;
  }

  analyze(snapshot) {
    const detectedAt = new Date().toISOString();
    const transactions = Array.isArray(snapshot?.recentTransactions) ? snapshot.recentTransactions : [];
    const unseenTransactions = transactions.filter((transaction) => transaction?.txid && !this.seenTxids.has(transaction.txid));
    const fastestFee = snapshot?.fees?.fastestFee || 0;
    const newAlerts = [];

    for (const transaction of unseenTransactions) {
      const alert = scoreTransaction(transaction, this.transactionHistory, fastestFee, detectedAt);
      if (alert) newAlerts.push(alert);

      this.seenTxids.add(transaction.txid);
      this.transactionHistory.push({
        txid: transaction.txid,
        valueBtc: toFiniteNumber(transaction.valueBtc),
        feeSats: toFiniteNumber(transaction.feeSats),
        feeRate: toFiniteNumber(transaction.feeRate),
        vsize: toFiniteNumber(transaction.vsize),
      });

      if (this.transactionHistory.length > this.historyLimit) {
        const removed = this.transactionHistory.shift();
        if (removed?.txid) this.seenTxids.delete(removed.txid);
      }
    }

    this.newTransactionsLastInterval = unseenTransactions.length;
    const priorArrivalCounts = this.arrivalWindows.map((window) => window.count);
    if (priorArrivalCounts.length >= 5) {
      const average = priorArrivalCounts.reduce((sum, count) => sum + count, 0) / priorArrivalCounts.length;
      const threshold = Math.max(6, average + 3 * Math.sqrt(average + 1));
      if (unseenTransactions.length >= threshold) {
        const score = Math.min(95, 45 + Math.round((unseenTransactions.length - threshold + 1) * 5));
        newAlerts.push({
          id: `network-${Date.now()}`,
          kind: 'network',
          txid: null,
          detectedAt,
          score,
          severity: severityFor(score),
          categories: ['arrival_burst'],
          signals: [`${unseenTransactions.length} new transactions appeared between monitoring snapshots; rolling threshold was ${threshold.toFixed(1)}`],
          valueBtc: null,
          valueSats: null,
          feeSats: null,
          feeRate: null,
          vsize: null,
          baselineSampleCount: priorArrivalCounts.length,
          statisticalBaselineReady: true,
          explanation: 'Observed transaction arrivals are elevated relative to recent polling windows. This is a network activity signal, not an attribution to a wallet or person.',
        });
      }
    }

    this.arrivalWindows.push({ at: detectedAt, count: unseenTransactions.length });
    if (this.arrivalWindows.length > 30) this.arrivalWindows.shift();

    this.alerts.push(...newAlerts);
    if (this.alerts.length > this.alertLimit) {
      this.alerts.splice(0, this.alerts.length - this.alertLimit);
    }
    this.lastAnalyzedAt = detectedAt;

    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const alert of this.alerts) severityCounts[alert.severity] += 1;
    const transactionAlerts = this.alerts.filter((alert) => alert.kind === 'transaction').length;
    const networkAlerts = this.alerts.filter((alert) => alert.kind === 'network').length;
    const averageScore = this.alerts.length
      ? Math.round(this.alerts.reduce((sum, alert) => sum + alert.score, 0) / this.alerts.length)
      : 0;

    return {
      engineVersion: '1.0.0',
      mode: 'hybrid-rules-and-rolling-statistics',
      lastAnalyzedAt: detectedAt,
      baseline: {
        transactionSamples: this.transactionHistory.length,
        requiredSamples: MIN_STATISTICAL_BASELINE,
        isReady: this.transactionHistory.length >= MIN_STATISTICAL_BASELINE,
        arrivalWindows: this.arrivalWindows.length,
      },
      summary: {
        totalAlerts: this.alerts.length,
        newAlerts: newAlerts.length,
        transactionAlerts,
        networkAlerts,
        critical: severityCounts.critical,
        high: severityCounts.high,
        medium: severityCounts.medium,
        low: severityCounts.low,
        averageScore,
        newTransactionsLastInterval: this.newTransactionsLastInterval,
      },
      alerts: [...this.alerts].reverse(),
      newAlerts: [...newAlerts],
      methodology: [
        'Absolute thresholds: aggregate output value ≥25 BTC (very high ≥100 BTC); fee rate ≥max(80 sat/vB, 4× fastest recommended fee); absolute fee ≥250,000 sats (very high ≥1,000,000 sats); or virtual size ≥100,000 vB.',
        'Statistical outliers use a robust z-score ≥4 from the rolling median and median absolute deviation after at least 20 prior unique transactions.',
        'Arrival bursts require at least 5 prior polling windows and a new-transaction count ≥max(6, rolling average + 3×sqrt(average + 1)).',
      ],
      limitations: [
        'The upstream recent-mempool endpoint exposes only the last 10 transactions and simplified fields.',
        'Aggregate output value is not necessarily the amount sent to a single recipient.',
        'Address behavior, wallet identity, and intent are not inferred by this engine.',
        'History is kept in server memory and resets when the backend restarts.',
      ],
    };
  }
}

export function createAnomalyEngine(options) {
  return new AnomalyEngine(options);
}
