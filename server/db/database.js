import { readFile } from 'node:fs/promises';
import pg from 'pg';

const { Pool } = pg;

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) return null;

  const pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_SIZE || 8),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: process.env.DB_SSL === 'true'
      ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
      : undefined,
  });

  return {
    async initialize() {
      const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
      await pool.query(schema);
      await pool.query("DELETE FROM network_snapshots WHERE fetched_at < NOW() - INTERVAL '30 days'");
      await pool.query("DELETE FROM arrival_windows WHERE observed_at < NOW() - INTERVAL '14 days'");
      await pool.query("DELETE FROM anomaly_alerts WHERE detected_at < NOW() - INTERVAL '90 days'");
      await pool.query('DELETE FROM ai_insights WHERE id NOT IN (SELECT id FROM ai_insights ORDER BY created_at DESC LIMIT 250)');
    },

    async ping() {
      await pool.query('SELECT 1');
      return true;
    },

    async loadEngineState({ historyLimit = 2_000, alertLimit = 100, windowLimit = 30 } = {}) {
      const [transactionsResult, alertsResult, windowsResult] = await Promise.all([
        pool.query(
          `SELECT txid, first_seen, value_btc, value_sats, fee_sats, fee_rate, vsize
           FROM (
             SELECT txid, first_seen, value_btc, value_sats, fee_sats, fee_rate, vsize
             FROM transaction_observations
             ORDER BY first_seen DESC LIMIT $1
           ) recent ORDER BY first_seen ASC`,
          [historyLimit],
        ),
        pool.query(
          `SELECT payload FROM (
             SELECT payload, detected_at FROM anomaly_alerts
             ORDER BY detected_at DESC LIMIT $1
           ) recent ORDER BY detected_at ASC`,
          [alertLimit],
        ),
        pool.query(
          `SELECT observed_at, new_count FROM (
             SELECT observed_at, new_count FROM arrival_windows
             ORDER BY observed_at DESC LIMIT $1
           ) recent ORDER BY observed_at ASC`,
          [windowLimit],
        ),
      ]);

      return {
        transactions: transactionsResult.rows.map((row) => ({
          txid: row.txid,
          valueBtc: asNumber(row.value_btc),
          valueSats: asNumber(row.value_sats),
          feeSats: asNumber(row.fee_sats),
          feeRate: asNumber(row.fee_rate),
          vsize: asNumber(row.vsize),
        })),
        alerts: alertsResult.rows.map((row) => row.payload),
        arrivalWindows: windowsResult.rows.map((row) => ({
          at: new Date(row.observed_at).toISOString(),
          count: asNumber(row.new_count),
        })),
      };
    },

    async persistRefresh(snapshot, newTransactions, report) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO network_snapshots
            (fetched_at, mempool_count, mempool_vsize, btc_price_usd, tip_height, fastest_fee, snapshot)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            snapshot.fetchedAt,
            snapshot.network?.mempoolCount || 0,
            snapshot.network?.mempoolVsize || 0,
            snapshot.btcPriceUsd || 0,
            snapshot.network?.tipHeight || 0,
            snapshot.fees?.fastestFee || 0,
            JSON.stringify(snapshot),
          ],
        );

        for (const tx of newTransactions) {
          await client.query(
            `INSERT INTO transaction_observations
              (txid, first_seen, value_btc, value_sats, fee_sats, fee_rate, vsize)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (txid) DO NOTHING`,
            [tx.txid, snapshot.fetchedAt, tx.valueBtc || 0, tx.valueSats || 0, tx.feeSats || 0, tx.feeRate || 0, tx.vsize || 0],
          );
        }

        for (const alert of report.newAlerts || []) {
          await client.query(
            `INSERT INTO anomaly_alerts (id, kind, detected_at, score, severity, payload)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)
             ON CONFLICT (id) DO NOTHING`,
            [alert.id, alert.kind, alert.detectedAt, alert.score, alert.severity, JSON.stringify(alert)],
          );
        }

        await client.query(
          `INSERT INTO arrival_windows (observed_at, new_count) VALUES ($1, $2)
           ON CONFLICT (observed_at) DO NOTHING`,
          [report.lastAnalyzedAt, report.summary?.newTransactionsLastInterval || 0],
        );
        await client.query(
          `DELETE FROM transaction_observations WHERE txid IN (
             SELECT txid FROM transaction_observations ORDER BY first_seen DESC OFFSET 2000
           )`,
        );
        await client.query("DELETE FROM arrival_windows WHERE observed_at < NOW() - INTERVAL '1 day'");
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async saveInsight({ question, model, payload, inputSnapshot }) {
      const result = await pool.query(
        `INSERT INTO ai_insights (question, model, payload, input_snapshot)
         VALUES ($1, $2, $3::jsonb, $4::jsonb)
         RETURNING id, created_at`,
        [question || '', model, JSON.stringify(payload), JSON.stringify(inputSnapshot)],
      );
      return {
        id: result.rows[0].id,
        createdAt: new Date(result.rows[0].created_at).toISOString(),
      };
    },

    async listInsights(limit = 10) {
      const result = await pool.query(
        `SELECT id, created_at, question, model, payload
         FROM ai_insights ORDER BY created_at DESC LIMIT $1`,
        [Math.min(Math.max(Number(limit) || 10, 1), 50)],
      );
      return result.rows.map((row) => ({
        id: row.id,
        createdAt: new Date(row.created_at).toISOString(),
        question: row.question,
        model: row.model,
        persisted: true,
        ...row.payload,
      }));
    },

    async getHistory(hours = 24) {
      const safeHours = Math.min(Math.max(Number(hours) || 24, 1), 168);
      const result = await pool.query(
        `SELECT fetched_at, mempool_count, mempool_vsize, btc_price_usd, tip_height, fastest_fee
         FROM network_snapshots
         WHERE fetched_at >= NOW() - ($1::text || ' hours')::interval
         ORDER BY fetched_at ASC LIMIT 2000`,
        [safeHours],
      );
      return result.rows.map((row) => ({
        fetchedAt: new Date(row.fetched_at).toISOString(),
        mempoolCount: asNumber(row.mempool_count),
        mempoolVsize: asNumber(row.mempool_vsize),
        btcPriceUsd: asNumber(row.btc_price_usd),
        tipHeight: asNumber(row.tip_height),
        fastestFee: asNumber(row.fastest_fee),
      }));
    },

    async close() {
      await pool.end();
    },
  };
}
