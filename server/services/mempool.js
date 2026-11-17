const API_BASE = process.env.MEMPOOL_API_BASE || 'https://mempool.space/api';
const REQUEST_TIMEOUT_MS = Number(process.env.MEMPOOL_TIMEOUT_MS || 10000);

export async function fetchMempoolJson(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = new Error(`mempool.space returned ${response.status} for ${path}`);
      error.status = response.status;
      throw error;
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchMempoolText(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { accept: 'text/plain' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`mempool.space returned ${response.status} for ${path}`);
      error.status = response.status;
      throw error;
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export async function fetchDashboardSnapshot() {
  const endpoints = [
    ['mempool', '/mempool'],
    ['recentTransactions', '/mempool/recent'],
    ['fees', '/v1/fees/recommended'],
    ['blocks', '/blocks'],
    ['prices', '/v1/prices'],
  ];

  const results = await Promise.allSettled(
    endpoints.map(async ([key, path]) => [key, await fetchMempoolJson(path)]),
  );

  const data = {};
  const failures = [];

  results.forEach((result, index) => {
    const key = endpoints[index][0];
    if (result.status === 'fulfilled') {
      data[result.value[0]] = result.value[1];
    } else {
      failures.push({ endpoint: key, message: result.reason?.message || 'Request failed' });
    }
  });

  // A useful dashboard needs at least some live data. Individual optional
  // endpoints may fail without taking the entire snapshot down.
  if (!data.mempool && !data.recentTransactions && !data.blocks) {
    const error = new Error('Unable to retrieve Bitcoin network data from mempool.space.');
    error.details = failures;
    throw error;
  }

  const btcPriceUsd = safeNumber(data.prices?.USD, 0);
  const transactions = Array.isArray(data.recentTransactions)
    ? data.recentTransactions.map((tx) => {
        const feeSats = safeNumber(tx.fee);
        const vsize = safeNumber(tx.vsize);
        const valueSats = safeNumber(tx.value);
        return {
          txid: String(tx.txid || ''),
          feeSats,
          vsize,
          valueSats,
          feeRate: vsize > 0 ? feeSats / vsize : 0,
          valueBtc: valueSats / 100_000_000,
          usdValue: (valueSats / 100_000_000) * btcPriceUsd,
          status: 'Unconfirmed',
        };
      })
    : [];

  const blocks = Array.isArray(data.blocks)
    ? data.blocks.slice(0, 10).map((block) => ({
        height: safeNumber(block.height),
        hash: String(block.id || ''),
        timestamp: safeNumber(block.timestamp),
        transactionCount: safeNumber(block.tx_count),
        size: safeNumber(block.size),
        weight: safeNumber(block.weight),
      }))
    : [];

  return {
    network: {
      mempoolCount: safeNumber(data.mempool?.count),
      mempoolVsize: safeNumber(data.mempool?.vsize),
      mempoolSizeMb: safeNumber(data.mempool?.vsize) / 1_000_000,
      totalFeeSats: safeNumber(data.mempool?.total_fee),
      tipHeight: safeNumber(blocks[0]?.height),
    },
    fees: data.fees || null,
    btcPriceUsd,
    recentTransactions: transactions,
    blocks,
    fetchedAt: new Date().toISOString(),
    source: 'mempool.space',
    partial: failures.length > 0,
    warnings: failures,
  };
}

export async function searchBlockchain(query) {
  const value = String(query || '').trim();
  if (!value) {
    const error = new Error('Enter a transaction ID, block height/hash, or Bitcoin address.');
    error.status = 400;
    throw error;
  }

  if (/^\d+$/.test(value)) {
    const hash = await fetchMempoolText(`/block-height/${encodeURIComponent(value)}`);
    const block = await fetchMempoolJson(`/block/${encodeURIComponent(hash)}`);
    return { type: 'block', data: block };
  }

  if (/^[a-fA-F0-9]{64}$/.test(value)) {
    try {
      const transaction = await fetchMempoolJson(`/tx/${value}`);
      return { type: 'transaction', data: transaction };
    } catch (transactionError) {
      try {
        const block = await fetchMempoolJson(`/block/${value}`);
        return { type: 'block', data: block };
      } catch {
        throw transactionError;
      }
    }
  }

  if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,}$/i.test(value)) {
    const address = await fetchMempoolJson(`/address/${encodeURIComponent(value)}`);
    return { type: 'address', data: address };
  }

  const error = new Error('That does not look like a Bitcoin transaction ID, block height/hash, or address.');
  error.status = 400;
  throw error;
}
