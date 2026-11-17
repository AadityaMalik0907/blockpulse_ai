import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ArrowLeftRight,
  Bell,
  Blocks,
  ChevronDown,
  CircleHelp,
  Clock3,
  Database,
  Download,
  Gauge,
  LayoutDashboard,
  Menu,
  Radio,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useBitcoinDashboard } from './hooks/useBitcoinDashboard.js';
import { generateAiInsight, getAiStatus, getRecentAiInsights, getSystemHealth, searchBlockchain } from './services/api.js';

const navItems = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Transactions', icon: ArrowLeftRight },
  { label: 'Blocks', icon: Blocks },
  { label: 'Anomaly center', icon: ShieldAlert },
  { label: 'AI insights', icon: Sparkles },
];

const numberFormat = new Intl.NumberFormat('en-US');
const usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function formatUsd(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? usdFormat.format(Number(value)) : '—';
}

function formatBtc(sats) {
  const btc = Number(sats || 0) / 100_000_000;
  return `${btc.toLocaleString('en-US', { maximumFractionDigits: 8 })} BTC`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} GB`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} MB`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${numberFormat.format(value)} B`;
}

function shortHash(value, start = 10, end = 8) {
  if (!value) return '—';
  return value.length > start + end + 3 ? `${value.slice(0, start)}...${value.slice(-end)}` : value;
}

function timeAgo(timestamp) {
  if (!timestamp) return '—';
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - Number(timestamp)));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function connectionText(connection) {
  if (connection === 'connected') return 'Live feed connected';
  if (connection === 'stale') return 'Showing last known data';
  if (connection === 'reconnecting') return 'Reconnecting to feed';
  if (connection === 'disconnected') return 'Live feed disconnected';
  return 'Connecting to Bitcoin network';
}

function Sidebar({ activeNav, onNavigate, mobileOpen, onClose, connection }) {
  const connected = connection === 'connected';
  return (
    <>
      {mobileOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={onClose} />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><Activity size={20} strokeWidth={2.5} /></div>
          <div className="brand-name">BlockPulse<span>AI</span></div>
          <button className="icon-button sidebar-close" aria-label="Close navigation" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="workspace-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map(({ label, icon: Icon, tag }) => (
            <button
              key={label}
              className={`nav-link ${activeNav === label ? 'nav-link-active' : ''}`}
              onClick={() => { onNavigate(label); onClose(); }}
            >
              <Icon size={18} />
              <span>{label}</span>
              {tag && <span className="nav-tag">{tag}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="network-card">
            <div className="network-card-top">
              <span className={`network-dot ${connected ? 'network-dot-live' : ''}`} />
              <span>DATA CONNECTION</span>
            </div>
            <div className="network-status-title">{connectionText(connection)}</div>
            <p>Bitcoin mainnet data supplied by mempool.space.</p>
            <div className="network-card-foot"><span>Public API</span><span>{connected ? 'LIVE' : 'STATUS'}</span></div>
          </div>
          <button className={`nav-link ${activeNav === 'Settings' ? 'nav-link-active' : ''}`} onClick={() => { onNavigate('Settings'); onClose(); }}>
            <Settings size={18} /><span>Settings</span>
          </button>
          <button className="nav-link" onClick={() => window.open('https://mempool.space/docs/api', '_blank', 'noopener,noreferrer')}>
            <CircleHelp size={18} /><span>API documentation</span>
          </button>
          <div className="sidebar-version">BLOCKPULSE AI <span>V1.0.0</span></div>
        </div>
      </aside>
    </>
  );
}

function Header({ activeNav, query, setQuery, onMenu, onSearch, searching }) {
  const title = activeNav === 'Overview' ? 'Network overview' : activeNav;
  const subtitles = {
    Overview: 'Monitor live Bitcoin network activity at a glance.',
    Transactions: 'Inspect the latest transactions entering the Bitcoin mempool.',
    Blocks: 'Explore recently mined Bitcoin blocks and confirmation activity.',
    'Anomaly center': 'Review unusual transaction values, fees, sizes, and observed arrival bursts.',
    'AI insights': 'Ask Gemini to explain live network conditions and anomaly signals.',
    Settings: 'Application and data-source settings.',
  };

  return (
    <header className="topbar">
      <div className="topbar-heading">
        <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={onMenu}><Menu size={20} /></button>
        <div>
          <div className="eyebrow">BITCOIN NETWORK / MONITOR</div>
          <h1>{title}</h1>
          <p>{subtitles[activeNav] || 'Explore Bitcoin network activity.'}</p>
        </div>
      </div>
      <div className="topbar-actions">
        <form className="search-box" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search txid, block, address..." aria-label="Search Bitcoin transaction, block, or address" />
          <button type="submit" aria-label="Search blockchain" disabled={searching}>{searching ? '...' : '↵'}</button>
        </form>
        <button className="icon-button notification-button" aria-label="Network status" title="Network status"><Radio size={18} /></button>
        <div className="profile-chip"><div className="profile-avatar">BP</div><span>Analyst</span><ChevronDown size={14} /></div>
      </div>
    </header>
  );
}

function StatCard({ item }) {
  const Icon = item.icon;
  return (
    <article className="stat-card panel">
      <div className="stat-card-top">
        <span className="stat-label">{item.label}</span>
        <span className={`stat-icon stat-icon-${item.tone}`}><Icon size={18} /></span>
      </div>
      <div className="stat-value-row">
        <div className="stat-value">{item.value}{item.unit && <small>{item.unit}</small>}</div>
      </div>
      <div className="stat-caption">{item.caption}</div>
    </article>
  );
}

function ActivityPanel({ blocks }) {
  const data = [...(blocks || [])].reverse().map((block) => ({
    label: `#${numberFormat.format(block.height)}`,
    transactions: block.transactionCount,
  }));

  return (
    <section className="panel activity-panel">
      <div className="panel-heading activity-heading">
        <div>
          <div className="section-kicker"><span className="live-pip" /> LIVE CHAIN ACTIVITY</div>
          <h2>Transactions per block</h2>
          <p className="panel-subtitle">Transaction count across the latest mined blocks</p>
        </div>
        <span className="live-data-pill"><span /> LIVE DATA</span>
      </div>
      <div className="chart-legend"><span><i className="legend-dot legend-orange" /> Transactions</span><span className="chart-note">Latest {data.length} blocks</span></div>
      <div className="activity-chart">
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 12, right: 5, left: -17, bottom: 0 }}>
              <defs>
                <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f7931a" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#f7931a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#202832" strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#737f8c', fontSize: 10 }} dy={10} minTickGap={16} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#737f8c', fontSize: 11 }} tickFormatter={(value) => numberFormat.format(value)} />
              <Tooltip
                contentStyle={{ background: '#151d26', border: '1px solid #2a3541', borderRadius: 10, color: '#f4f6f8', fontSize: 12 }}
                labelStyle={{ color: '#9aa6b2', marginBottom: 4 }}
                formatter={(value) => [numberFormat.format(value), 'Transactions']}
              />
              <Area type="monotone" dataKey="transactions" stroke="#f7931a" strokeWidth={2.5} fill="url(#activityGradient)" activeDot={{ r: 5, fill: '#f7931a', stroke: '#171e27', strokeWidth: 3 }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : <div className="chart-empty">Waiting for recent block data...</div>}
      </div>
      <div className="chart-footer"><span><Clock3 size={13} /> Refreshes approximately every 20 seconds</span><span>Source: mempool.space</span></div>
    </section>
  );
}

function FeePanel({ fees }) {
  const entries = [
    { label: 'Economy', value: Number(fees?.economyFee || fees?.hourFee || 0), tone: 'fee-low' },
    { label: 'Standard', value: Number(fees?.halfHourFee || fees?.hourFee || 0), tone: 'fee-medium' },
    { label: 'High priority', value: Number(fees?.fastestFee || 0), tone: 'fee-high' },
  ];
  const max = Math.max(...entries.map((entry) => entry.value), 1);

  return (
    <section className="panel fee-panel">
      <div className="panel-heading compact-heading">
        <div><div className="section-kicker">FEE ESTIMATES</div><h2>Recommended fees</h2></div>
        <span className="subtle-icon"><Zap size={17} /></span>
      </div>
      <p className="panel-subtitle">Current recommended fee rates</p>
      <div className="fee-list">
        {entries.map((fee) => (
          <div className="fee-row" key={fee.label}>
            <div className="fee-row-top"><span>{fee.label}</span><strong>{fee.value ? `${fee.value} sat/vB` : '—'}</strong></div>
            <div className="fee-track"><span className={fee.tone} style={{ width: `${Math.max(3, (fee.value / max) * 100)}%` }} /></div>
            <div className="fee-time">Recommended fee rate</div>
          </div>
        ))}
      </div>
      <div className="fee-disclaimer">Rates are estimates from mempool.space and may change with network demand.</div>
    </section>
  );
}

function InsightPanel({ snapshot, onOpenAI }) {
  const count = snapshot?.network?.mempoolCount || 0;
  const value = snapshot?.network?.mempoolSizeMb || 0;
  const report = snapshot?.anomalyReport;
  const summary = report?.summary || {};
  const baselineReady = Boolean(report?.baseline?.isReady);
  const alertCount = summary.totalAlerts || 0;
  return (
    <section className="panel insight-panel">
      <div className="insight-topline"><span className="ai-icon"><ShieldAlert size={16} /></span><span>BLOCKPULSE DETECTION</span><span className="preview-pill">PHASE 3</span></div>
      <div className="insight-title-row"><h2>{alertCount ? `${alertCount} review signal${alertCount === 1 ? '' : 's'}` : 'Monitoring network'}</h2><span className="insight-status"><span /> Active engine</span></div>
      <p className="insight-copy">{alertCount ? `${(summary.high || 0) + (summary.critical || 0)} high-priority signal(s) are in the current review queue. Review the indicators before drawing conclusions.` : `The mempool currently contains ${numberFormat.format(count)} unconfirmed transactions. No anomalies have been flagged in the retained sample.`}</p>
      <div className="insight-metric-row">
        <div><span className="insight-metric-label">Mempool backlog</span><strong>{formatBytes(value * 1_000_000)}</strong></div>
        <div><span className="insight-metric-label">Statistical baseline</span><strong className={baselineReady ? '' : 'review-reason'}>{baselineReady ? `${numberFormat.format(report.baseline.transactionSamples)} samples` : 'Warming up'}</strong></div>
      </div>
      <div className="insight-footer"><span><AlertTriangle size={14} /> Signals are not fraud findings</span><button type="button" className="insight-open-ai" onClick={onOpenAI}>Open Gemini analyst <ArrowUpRight size={12} /></button></div>
    </section>
  );
}

function BlocksPanel({ blocks }) {
  const availableBlocks = blocks || [];
  return (
    <section className="panel blocks-panel">
      <div className="panel-heading compact-heading">
        <div><div className="section-kicker">CHAIN ACTIVITY</div><h2>Recent blocks</h2></div>
        <span className="live-data-pill"><span /> MAINNET</span>
      </div>
      <div className="block-list">
        {availableBlocks.slice(0, 4).map((block) => (
          <div className="block-row" key={block.hash || block.height}>
            <div className="block-symbol"><Blocks size={17} /></div>
            <div className="block-main"><strong>#{numberFormat.format(block.height)}</strong><span>{shortHash(block.hash, 8, 6)}</span></div>
            <div className="block-meta"><strong>{numberFormat.format(block.transactionCount)} txs</strong><span>{timeAgo(block.timestamp)}</span></div>
          </div>
        ))}
        {availableBlocks.length === 0 && <div className="chart-empty">Waiting for block data...</div>}
      </div>
      <div className="blocks-note">Block height and transaction counts from the live Bitcoin chain.</div>
    </section>
  );
}

function TransactionsPanel({ transactions, query, btcPriceUsd }) {
  const filtered = useMemo(() => (transactions || []).filter((tx) => tx.txid.toLowerCase().includes(query.trim().toLowerCase())), [transactions, query]);

  const exportCsv = () => {
    const headers = ['Transaction ID', 'Value (BTC)', 'Value estimate (USD)', 'Fee (sats)', 'Virtual size (vB)', 'Fee rate (sat/vB)', 'Status'];
    const rows = filtered.map((tx) => [tx.txid, tx.valueBtc, tx.usdValue, tx.feeSats, tx.vsize, tx.feeRate, tx.status]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'blockpulse-live-transactions.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel transactions-panel">
      <div className="panel-heading transactions-heading">
        <div><div className="section-kicker">MEMPOOL FEED</div><h2>Recent transactions</h2><p className="panel-subtitle">Latest unconfirmed transactions reported by the mempool</p></div>
        <button className="outline-button" onClick={exportCsv} disabled={filtered.length === 0}><Download size={15} /> Export CSV</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>TRANSACTION ID</th><th>VALUE</th><th>USD ESTIMATE</th><th>FEE</th><th>FEE RATE</th><th>STATUS</th></tr></thead>
          <tbody>
            {filtered.map((tx) => (
              <tr key={tx.txid}>
                <td><span className="tx-id" title={tx.txid}>{shortHash(tx.txid, 12, 8)}</span></td>
                <td><strong className="amount-cell">{formatBtc(tx.valueSats)}</strong></td>
                <td className="muted-cell">{formatUsd(tx.usdValue || (tx.valueBtc * btcPriceUsd))}</td>
                <td className="fee-cell">{numberFormat.format(tx.feeSats)} sats</td>
                <td className="fee-cell">{tx.feeRate ? `${tx.feeRate.toFixed(2)} sat/vB` : '—'}</td>
                <td><span className="status-pill status-pending"><i />Unconfirmed</span></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan="6" className="empty-row">{transactions?.length ? `No recent transactions match “${query}”.` : 'Waiting for recent mempool transactions...'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="table-bottom"><span>Showing {filtered.length} of {(transactions || []).length} recent mempool transactions</span><span className="live-table-label">LIVE NETWORK DATA</span></div>
    </section>
  );
}

function SearchResultPanel({ result, error, onClose }) {
  if (!result && !error) return null;
  const { type, data } = result || {};
  let title = '';
  let details = [];

  if (type === 'transaction') {
    const confirmed = Boolean(data.status?.confirmed);
    title = 'Bitcoin transaction found';
    details = [
      ['Transaction ID', shortHash(data.txid, 16, 12)],
      ['Value', `${(Number(data.vout?.reduce((sum, output) => sum + Number(output.value || 0), 0) || 0) / 100_000_000).toFixed(8)} BTC`],
      ['Fee', `${numberFormat.format(data.fee || 0)} sats`],
      ['Status', confirmed ? `Confirmed · block ${numberFormat.format(data.status.block_height)}` : 'Unconfirmed / in mempool'],
    ];
  } else if (type === 'block') {
    title = 'Bitcoin block found';
    details = [
      ['Block height', `#${numberFormat.format(data.height)}`],
      ['Block hash', shortHash(data.id, 16, 12)],
      ['Transactions', numberFormat.format(data.tx_count || 0)],
      ['Mined', timeAgo(data.timestamp)],
    ];
  } else if (type === 'address') {
    title = 'Bitcoin address found';
    details = [
      ['Address', shortHash(data.address, 18, 12)],
      ['Confirmed transactions', numberFormat.format(data.chain_stats?.tx_count || 0)],
      ['Unconfirmed transactions', numberFormat.format(data.mempool_stats?.tx_count || 0)],
      ['Confirmed received', formatBtc(data.chain_stats?.funded_txo_sum || 0)],
    ];
  }

  return (
    <section className="panel search-result-panel">
      <div className="search-result-heading">
        <div><div className="section-kicker">BLOCKCHAIN SEARCH</div><h2>{error ? 'Search could not be completed' : title}</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Close search result"><X size={16} /></button>
      </div>
      {error ? <p className="search-error">{error}</p> : <div className="search-result-grid">{details.map(([label, value]) => <div key={label}><span>{label}</span><strong title={value}>{value}</strong></div>)}</div>}
    </section>
  );
}

function AnomalyCenter({ report }) {
  const [filter, setFilter] = useState('all');
  const summary = report?.summary || {};
  const baseline = report?.baseline || {};
  const alerts = report?.alerts || [];
  const visibleAlerts = filter === 'all' ? alerts : alerts.filter((alert) => alert.severity === filter);
  const baselineProgress = Math.min(100, ((baseline.transactionSamples || 0) / (baseline.requiredSamples || 20)) * 100);

  const severityLabel = (severity) => severity ? severity.toUpperCase() : 'REVIEW';
  const formatDetectedAt = (value) => value ? new Date(value).toLocaleString() : '—';
  const categoryLabel = (category) => ({
    value_outlier: 'Value outlier',
    fee_rate_outlier: 'Fee-rate outlier',
    fee_outlier: 'High absolute fee',
    size_outlier: 'Large transaction',
    arrival_burst: 'Arrival burst',
  }[category] || category.replaceAll('_', ' '));

  return (
    <div className="anomaly-workspace">
      <section className="anomaly-intro panel">
        <div className="anomaly-intro-copy">
          <div className="section-kicker"><span className="live-pip" /> PHASE 3 / DETECTION ENGINE</div>
          <h2>Unusual activity, surfaced.</h2>
          <p>BlockPulse combines explicit threshold guardrails with a rolling statistical baseline to identify transactions and network activity that deserve a closer look.</p>
        </div>
        <div className={`engine-state ${baseline.isReady ? 'engine-ready' : 'engine-warming'}`}>
          <span className="engine-state-dot" />
          <div><strong>{baseline.isReady ? 'Statistical baseline ready' : 'Building statistical baseline'}</strong><span>{numberFormat.format(baseline.transactionSamples || 0)} / {numberFormat.format(baseline.requiredSamples || 20)} unique transactions observed</span></div>
        </div>
      </section>

      <div className="anomaly-stats-grid">
        <article className="panel anomaly-stat"><span className="anomaly-stat-label">REVIEW SIGNALS</span><strong>{numberFormat.format(summary.totalAlerts || 0)}</strong><span>{report?.persistence?.status === 'connected' ? 'Persisted in PostgreSQL' : 'Retained in server memory'}</span></article>
        <article className="panel anomaly-stat"><span className="anomaly-stat-label">HIGH PRIORITY</span><strong className="anomaly-number-high">{numberFormat.format((summary.high || 0) + (summary.critical || 0))}</strong><span>High and critical severity</span></article>
        <article className="panel anomaly-stat"><span className="anomaly-stat-label">TRANSACTION FLAGS</span><strong>{numberFormat.format(summary.transactionAlerts || 0)}</strong><span>Value, fee, or size indicators</span></article>
        <article className="panel anomaly-stat"><span className="anomaly-stat-label">ARRIVAL BURSTS</span><strong>{numberFormat.format(summary.networkAlerts || 0)}</strong><span>Elevated new-transaction windows</span></article>
      </div>

      {!baseline.isReady && (
        <div className="baseline-notice">
          <div className="baseline-notice-icon"><Activity size={17} /></div>
          <div className="baseline-notice-copy"><strong>Statistical baseline is warming up</strong><span>Absolute thresholds are active now. Robust outlier comparisons begin after at least {numberFormat.format(baseline.requiredSamples || 20)} unique transactions have been observed {report?.persistence?.status === 'connected' ? 'and restored from PostgreSQL' : 'since the backend started'}.</span><div className="baseline-track"><span style={{ width: `${baselineProgress}%` }} /></div></div>
          <strong className="baseline-progress-label">{Math.round(baselineProgress)}%</strong>
        </div>
      )}

      <section className="panel anomaly-feed-panel">
        <div className="panel-heading anomaly-feed-heading">
          <div><div className="section-kicker">DETECTION LOG</div><h2>Flagged activity</h2><p className="panel-subtitle">Signals are ranked for review, not labelled as malicious activity.</p></div>
          <div className="anomaly-filter-group" role="group" aria-label="Filter alerts by severity">
            {['all', 'critical', 'high', 'medium', 'low'].map((level) => <button key={level} className={filter === level ? 'filter-active' : ''} onClick={() => setFilter(level)}>{level === 'all' ? 'All' : severityLabel(level)}</button>)}
          </div>
        </div>

        {visibleAlerts.length > 0 ? (
          <div className="anomaly-alert-list">
            {visibleAlerts.map((alert) => (
              <article className={`anomaly-alert-card severity-${alert.severity}`} key={alert.id}>
                <div className="anomaly-alert-top">
                  <span className={`severity-pill severity-pill-${alert.severity}`}><i />{severityLabel(alert.severity)}</span>
                  <span className="anomaly-score-label">ANOMALY SCORE <strong>{alert.score}/100</strong></span>
                  <time>{formatDetectedAt(alert.detectedAt)}</time>
                </div>
                <div className="anomaly-alert-title-row">
                  <div><h3>{alert.kind === 'network' ? 'Transaction arrival burst' : (alert.categories || []).map(categoryLabel).join(' · ') || 'Unusual transaction pattern'}</h3><span className="anomaly-target">{alert.txid ? shortHash(alert.txid, 14, 10) : 'NETWORK ACTIVITY EVENT'}</span></div>
                  {alert.txid && <button className="anomaly-inspect-button" onClick={() => window.open(`https://mempool.space/tx/${alert.txid}`, '_blank', 'noopener,noreferrer')}>Inspect <ArrowUpRight size={14} /></button>}
                </div>
                <div className="anomaly-score-track"><span style={{ width: `${alert.score}%` }} /></div>
                <div className="anomaly-signal-list">{(alert.signals || []).map((signal) => <div key={signal}><span className="signal-bullet" />{signal}</div>)}</div>
                {alert.kind === 'transaction' && (
                  <div className="anomaly-metrics-row">
                    <div><span>AGGREGATE OUTPUT VALUE</span><strong>{Number(alert.valueBtc || 0).toLocaleString('en-US', { maximumFractionDigits: 8 })} BTC</strong></div>
                    <div><span>FEE RATE</span><strong>{Number(alert.feeRate || 0).toFixed(2)} sat/vB</strong></div>
                    <div><span>ABSOLUTE FEE</span><strong>{numberFormat.format(alert.feeSats || 0)} sats</strong></div>
                    <div><span>BASELINE AT DETECTION</span><strong>{numberFormat.format(alert.baselineSampleCount || 0)} txs</strong></div>
                  </div>
                )}
                <p className="anomaly-explanation">{alert.explanation}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="anomaly-empty-state"><div className="anomaly-empty-icon"><ShieldAlert size={23} /></div><h3>{filter === 'all' ? 'No review signals yet' : `No ${filter} signals`}</h3><p>{filter === 'all' ? 'The detector is watching new mempool transactions. Signals will appear here when a configured threshold or statistical rule is crossed.' : 'No retained alerts match this severity filter.'}</p></div>
        )}
        <div className="anomaly-feed-footer"><span>{visibleAlerts.length} shown · {alerts.length} retained</span><span>Last analyzed: {formatDetectedAt(report?.lastAnalyzedAt)}</span></div>
      </section>

      <section className="panel methodology-panel">
        <div className="section-kicker">HOW DETECTION WORKS</div>
        <h2>Transparent, explainable signals</h2>
        <div className="methodology-grid">
          {(report?.methodology || [
            'Absolute thresholds catch extreme observations during baseline warm-up.',
            'Robust z-scores compare each feature with a rolling median and median absolute deviation.',
            'Arrival-burst checks compare newly observed transaction IDs with recent polling windows.',
          ]).map((item, index) => <div key={item}><span>0{index + 1}</span><p>{item}</p></div>)}
        </div>
        <div className="methodology-disclaimer"><AlertTriangle size={15} /><span>Detection scores are prototype heuristics, not probabilities of fraud. Aggregate output value may include multiple outputs and does not identify a single recipient.</span></div>
      </section>
    </div>
  );
}


function AIInsights({ snapshot, report }) {
  const [status, setStatus] = useState(null);
  const [insight, setInsight] = useState(null);
  const [history, setHistory] = useState([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);

  const refreshHistory = async () => {
    try {
      const result = await getRecentAiInsights();
      setHistory(result.insights || []);
      if (!insight && result.insights?.length) setInsight(result.insights[0]);
    } catch {
      // AI history is an enhancement; the live dashboard remains usable if it is unavailable.
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    getAiStatus().then((data) => { if (active) setStatus(data); }).catch((requestError) => {
      if (active) setError(requestError.message || 'Could not check Gemini configuration.');
    });
    getRecentAiInsights().then((result) => {
      if (!active) return;
      setHistory(result.insights || []);
      if (result.insights?.length) setInsight(result.insights[0]);
    }).catch(() => {}).finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, []);

  const handleGenerate = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await generateAiInsight(question);
      setInsight(result);
      setQuestion('');
      await refreshHistory();
    } catch (requestError) {
      setError(requestError.message || 'Gemini could not generate the insight.');
    } finally {
      setBusy(false);
    }
  };

  const alertSummary = report?.summary || {};
  const network = snapshot?.network || {};

  return (
    <div className="ai-workspace">
      <section className="ai-hero panel">
        <div className="ai-hero-copy">
          <div className="section-kicker"><span className="live-pip" /> PHASE 4 / AI ANALYST</div>
          <h2>Turn network signals into clear explanations.</h2>
          <p>Gemini reviews the latest network snapshot and anomaly evidence, then produces a concise analyst brief with supporting observations and suggested checks.</p>
          <div className="ai-model-line"><Sparkles size={15} /><span>{status?.provider || 'Google Gemini API'}</span><i /> <span>{status?.model || 'gemini-3.8-flash'}</span></div>
        </div>
        <div className={`ai-status-card ${status?.configured ? 'ai-status-ready' : 'ai-status-missing'}`}>
          <span className="ai-status-dot" />
          <div><strong>{status?.configured ? 'Gemini configured' : status ? 'API key required' : 'Checking AI configuration'}</strong><span>{status?.configured ? 'Ready for an on-demand analysis' : 'The API key stays on the backend'}</span></div>
        </div>
      </section>

      <div className="ai-context-grid">
        <article className="panel ai-context-card"><span>MEMPOOL BACKLOG</span><strong>{numberFormat.format(network.mempoolCount || 0)}</strong><small>Unconfirmed transactions</small></article>
        <article className="panel ai-context-card"><span>REVIEW SIGNALS</span><strong>{numberFormat.format(alertSummary.totalAlerts || 0)}</strong><small>{numberFormat.format((alertSummary.high || 0) + (alertSummary.critical || 0))} high / critical</small></article>
        <article className="panel ai-context-card"><span>STATISTICAL BASELINE</span><strong>{report?.baseline?.isReady ? 'Ready' : 'Warming up'}</strong><small>{numberFormat.format(report?.baseline?.transactionSamples || 0)} observed samples</small></article>
        <article className="panel ai-context-card"><span>BITCOIN PRICE</span><strong>{formatUsd(snapshot?.btcPriceUsd)}</strong><small>Reference metric, not a prediction</small></article>
      </div>

      {!status?.configured && status && (
        <section className="ai-config-notice">
          <div className="ai-config-icon"><Settings size={17} /></div>
          <div><strong>Connect Gemini to enable AI analysis</strong><p>Open your <code>.env</code> file in the project root and add your Google AI Studio key:</p><pre>GEMINI_API_KEY=your_gemini_api_key</pre><span>Then restart the backend. Never put this key in a React environment variable or commit it to Git.</span></div>
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Get API key <ArrowUpRight size={14} /></a>
        </section>
      )}

      <section className="panel ai-prompt-panel">
        <div className="panel-heading"><div><div className="section-kicker">ASK THE NETWORK ANALYST</div><h2>Generate an AI network brief</h2><p className="panel-subtitle">The model receives network metrics and up to 8 recent anomaly signals.</p></div><span className="ai-generation-tag"><Sparkles size={13} /> ON DEMAND</span></div>
        <form onSubmit={handleGenerate} className="ai-question-form">
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} placeholder="Ask a question, e.g. What should I investigate about the current high-priority signals? Leave this blank for a general network brief." />
          <div className="ai-form-footer"><span>{question.length}/500 characters · Data is sent to Google Gemini when you generate an insight.</span><button type="submit" className="ai-generate-button" disabled={busy || !status?.configured}>{busy ? <><span className="loading-spinner small-spinner" /> Analyzing...</> : <><Sparkles size={15} /> Generate insight</>}</button></div>
        </form>
        {error && <div className="ai-error-message"><AlertTriangle size={15} />{error}</div>}
      </section>

      <div className="ai-results-layout">
        <section className="panel ai-result-panel">
          <div className="panel-heading ai-result-heading"><div><div className="section-kicker">ANALYST OUTPUT</div><h2>{insight?.title || 'Your network analysis will appear here'}</h2></div>{insight && <span className={`ai-state-pill ai-state-${String(insight.networkState || 'Review').toLowerCase()}`}>{insight.networkState || 'Review'}</span>}</div>
          {insight ? (
            <>
              <p className="ai-result-summary">{insight.summary}</p>
              <div className="ai-result-meta"><span><Sparkles size={13} /> {insight.model || status?.model || 'Gemini'}</span><span>{insight.generatedAt ? new Date(insight.generatedAt).toLocaleString() : 'Recently generated'}</span><span>{insight.persisted ? 'Saved to PostgreSQL' : 'Session history only'}</span></div>
              <div className="ai-result-section"><div className="section-kicker">NOTABLE OBSERVATIONS</div>
                {insight.notableSignals?.length ? <div className="ai-signal-list">{insight.notableSignals.map((signal, index) => <article key={`${signal.title}-${index}`} className="ai-signal-card"><div className="ai-signal-heading"><strong>{signal.title}</strong><span className={`ai-severity ai-severity-${signal.severity}`}>{signal.severity}</span></div><p>{signal.evidence}</p><small>{signal.interpretation}</small></article>)}</div> : <div className="ai-no-signals">No notable anomaly signals were included in this analysis. This does not guarantee that all activity is normal.</div>}
              </div>
              <div className="ai-result-section"><div className="section-kicker">SUGGESTED NEXT CHECKS</div>
                {insight.recommendedChecks?.length ? <ol className="ai-check-list">{insight.recommendedChecks.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ol> : <p className="ai-muted-copy">No additional checks were suggested.</p>}
              </div>
              {insight.limitations?.length > 0 && <div className="ai-limitations"><strong><AlertTriangle size={14} /> Interpretation limits</strong><ul>{insight.limitations.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>}
            </>
          ) : (
            <div className="ai-empty-result"><div className="ai-empty-icon"><Sparkles size={22} /></div><strong>No AI report yet</strong><p>Once Gemini is configured, generate a network brief to get a plain-language explanation of the current Bitcoin snapshot and detected signals.</p></div>
          )}
        </section>

        <aside className="panel ai-history-panel"><div className="panel-heading"><div><div className="section-kicker">SAVED REPORTS</div><h2>Analysis history</h2></div><span className="ai-history-count">{history.length}</span></div>
          {historyLoading ? <p className="ai-muted-copy">Loading saved reports...</p> : history.length ? <div className="ai-history-list">{history.map((item, index) => <button key={item.id || `${item.generatedAt}-${index}`} className={`ai-history-item ${insight?.id === item.id ? 'ai-history-active' : ''}`} onClick={() => setInsight(item)}><strong>{item.title || 'Bitcoin network analysis'}</strong><span>{item.question || 'General network brief'}</span><small>{item.generatedAt ? new Date(item.generatedAt).toLocaleString() : 'Saved insight'}</small></button>)}</div> : <div className="ai-history-empty">No saved analyses yet. Generate a brief to start your history.</div>}
          <div className="ai-history-foot">PostgreSQL-backed history is retained when the database is connected.</div>
        </aside>
      </div>
      <div className="ai-disclaimer"><AlertTriangle size={15} /><span>AI output is an analyst aid, not an automated verdict. It may make mistakes. Verify every observation against the underlying blockchain data and do not interpret anomaly signals as proof of fraud.</span></div>
    </div>
  );
}


function SettingsPanel() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadHealth = async () => {
    setLoading(true);
    setError('');
    try {
      setHealth(await getSystemHealth());
    } catch (requestError) {
      setError(requestError.message || 'Could not load service status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadHealth(); }, []);

  const StatusItem = ({ label, status, detail }) => (
    <div className="settings-status-item">
      <div className="settings-status-heading"><span>{label}</span><strong className={`settings-status-value settings-status-${String(status || 'unknown').toLowerCase().replaceAll(' ', '-')}`}>{status || 'Unknown'}</strong></div>
      <p>{detail}</p>
    </div>
  );

  return (
    <div className="settings-workspace">
      <section className="panel settings-hero"><div><div className="section-kicker">PHASE 5 / OPERATIONS</div><h2>Application configuration</h2><p>Check the health of the API, PostgreSQL persistence, and Gemini integration. Secret values are never shown in this screen.</p></div><button className="outline-button" onClick={loadHealth} disabled={loading}>{loading ? 'Checking...' : 'Refresh status'}</button></section>
      {error && <div className="ai-error-message"><AlertTriangle size={15} />{error}</div>}
      <section className="settings-status-grid">
        <article className="panel settings-status-card"><div className="section-kicker">BACKEND API</div><StatusItem label="Express service" status={health?.status || (loading ? 'Checking' : 'Unknown')} detail={`Version ${health?.version || '—'} · Port configured by PORT`} /></article>
        <article className="panel settings-status-card"><div className="section-kicker">DATABASE</div><StatusItem label="PostgreSQL" status={health?.database?.status || (loading ? 'Checking' : 'Unknown')} detail={health?.database?.configured ? 'Network snapshots, anomaly history and AI reports are persisted.' : 'DATABASE_URL is not configured; history is session-only.'} /></article>
        <article className="panel settings-status-card"><div className="section-kicker">AI PROVIDER</div><StatusItem label={health?.ai?.provider || 'Google Gemini'} status={health?.ai?.configured ? 'Configured' : loading ? 'Checking' : 'Not configured'} detail={`Model: ${health?.ai?.model || 'gemini-3.8-flash'}`} /></article>
      </section>
      <section className="panel settings-details-panel"><div className="section-kicker">RUNTIME DETAILS</div><div className="settings-detail-grid"><div><span>Bitcoin data source</span><strong>{health?.dataSource || 'mempool.space'}</strong></div><div><span>Last network refresh</span><strong>{health?.lastUpdated ? new Date(health.lastUpdated).toLocaleString() : 'Waiting for first snapshot'}</strong></div><div><span>Anomaly baseline</span><strong>{health?.anomalyEngine ? `${numberFormat.format(health.anomalyEngine.baselineSamples)} observations` : 'Warming up'}</strong></div><div><span>Retained review signals</span><strong>{numberFormat.format(health?.anomalyEngine?.alerts || 0)}</strong></div></div></section>
      <section className="panel settings-details-panel"><div className="section-kicker">IMPORTANT CONFIGURATION</div><div className="settings-config-list"><div><strong>Gemini API key</strong><p>Set <code>GEMINI_API_KEY</code> in the server-side `.env` file. Do not use a `VITE_` prefix and do not commit the file.</p></div><div><strong>PostgreSQL</strong><p>Set `DATABASE_URL`. For local development, the included Docker Compose file starts PostgreSQL at port 5432.</p></div><div><strong>Deployment</strong><p>Use the included Dockerfile, configure a managed PostgreSQL service, expose port 4000, and use `/api/health` as the health-check route.</p></div></div></section>
    </div>
  );
}

function ModulePlaceholder({ activeNav }) {
  const descriptions = {
    'Anomaly center': 'Review unusual transaction values, fee rates, transaction sizes, and arrival bursts.',
    'AI insights': 'Read AI-generated explanations of network activity after the anomaly engine is in place.',
    Settings: 'Application preferences and data-source settings will be added as the prototype grows.',
  };
  return (
    <section className="panel module-placeholder">
      <div className="placeholder-icon"><Sparkles size={22} /></div>
      <div className="section-kicker">BLOCKPULSE ROADMAP</div>
      <h2>{activeNav} workspace</h2>
      <p>{descriptions[activeNav] || 'This workspace is planned for a later development phase.'}</p>
      <span className="coming-soon"><span /> Connected in a later phase</span>
    </section>
  );
}

export default function App() {
  const { snapshot, connection, error } = useBitcoinDashboard();
  const [activeNav, setActiveNav] = useState('Overview');
  const [query, setQuery] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [searchError, setSearchError] = useState('');

  const network = snapshot?.network || {};
  const fees = snapshot?.fees || {};
  const transactions = snapshot?.recentTransactions || [];
  const blocks = snapshot?.blocks || [];
  const stats = [
    { label: 'Mempool transactions', value: numberFormat.format(network.mempoolCount || 0), caption: 'Unconfirmed transactions waiting for blocks', icon: ArrowLeftRight, tone: 'orange' },
    { label: 'Mempool size', value: formatBytes(network.mempoolVsize || 0), caption: 'Virtual size of the current backlog', icon: Database, tone: 'blue' },
    { label: 'High priority fee', value: fees.fastestFee ? numberFormat.format(fees.fastestFee) : '—', unit: fees.fastestFee ? 'sat/vB' : '', caption: 'Current recommended fastest fee rate', icon: Zap, tone: 'purple' },
    { label: 'Bitcoin price', value: formatUsd(snapshot?.btcPriceUsd), caption: 'Latest USD quote from the data provider', icon: Gauge, tone: 'green' },
  ];

  const handleSearch = async () => {
    const searchTerm = query.trim();
    if (!searchTerm) return;
    setSearching(true);
    setSearchError('');
    setSearchResult(null);
    try {
      const result = await searchBlockchain(searchTerm);
      setSearchResult(result);
    } catch (searchRequestError) {
      setSearchError(searchRequestError.message || 'Search failed. Please try again.');
    } finally {
      setSearching(false);
    }
  };

  const updatedAt = snapshot?.fetchedAt ? new Date(snapshot.fetchedAt).toLocaleTimeString() : 'Waiting';

  return (
    <div className="app-shell">
      <Sidebar activeNav={activeNav} onNavigate={setActiveNav} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} connection={connection} />
      <main className="main-area">
        <Header activeNav={activeNav} query={query} setQuery={setQuery} onMenu={() => setMobileOpen(true)} onSearch={handleSearch} searching={searching} />
        <div className="page-content">
          <SearchResultPanel result={searchResult} error={searchError} onClose={() => { setSearchResult(null); setSearchError(''); }} />

          {activeNav === 'Overview' ? (
            <>
              <div className={`demo-notice ${connection === 'connected' ? 'notice-live' : 'notice-warning'}`}>
                <div><Radio size={15} /><strong>{connection === 'connected' ? 'Live network data' : connectionText(connection)}</strong><span>{error || 'Dashboard metrics are sourced from Bitcoin mainnet through mempool.space.'}</span></div>
                <span className="demo-source">UPDATED: {updatedAt}</span>
              </div>
              {snapshot?.partial && <div className="partial-warning"><AlertTriangle size={14} /> Some data endpoints are temporarily unavailable. Displaying the fields that loaded successfully.</div>}
              {!snapshot && <div className="loading-panel panel"><span className="loading-spinner" /> Connecting to Bitcoin mainnet data...</div>}
              <div className="stats-grid">{stats.map((item) => <StatCard key={item.label} item={item} />)}</div>
              <div className="dashboard-grid">
                <ActivityPanel blocks={blocks} />
                <div className="side-stack"><FeePanel fees={fees} /><InsightPanel snapshot={snapshot} onOpenAI={() => setActiveNav('AI insights')} /></div>
                <BlocksPanel blocks={blocks} />
              </div>
              <TransactionsPanel transactions={transactions} query={query} btcPriceUsd={snapshot?.btcPriceUsd || 0} />
              <footer className="page-footer"><span>© 2026 BlockPulse AI</span><span>Bitcoin network observability <span className="footer-separator">·</span> Live prototype v1.0.0</span></footer>
            </>
          ) : activeNav === 'Transactions' ? (
            <><TransactionsPanel transactions={transactions} query={query} btcPriceUsd={snapshot?.btcPriceUsd || 0} /><footer className="page-footer"><span>© 2026 BlockPulse AI</span><span>Latest mempool transactions <span className="footer-separator">·</span> Updated {updatedAt}</span></footer></>
          ) : activeNav === 'Blocks' ? (
            <><BlocksPanel blocks={blocks} /><footer className="page-footer"><span>© 2026 BlockPulse AI</span><span>Latest mined blocks <span className="footer-separator">·</span> Updated {updatedAt}</span></footer></>
          ) : activeNav === 'Anomaly center' ? (
            <><AnomalyCenter report={snapshot?.anomalyReport} /><footer className="page-footer"><span>© 2026 BlockPulse AI</span><span>Explainable anomaly monitoring <span className="footer-separator">·</span> Engine v1.0.0</span></footer></>
          ) : activeNav === 'AI insights' ? (
            <><AIInsights snapshot={snapshot} report={snapshot?.anomalyReport} /><footer className="page-footer"><span>© 2026 BlockPulse AI</span><span>Gemini analyst <span className="footer-separator">·</span> AI-assisted network analysis</span></footer></>
          ) : activeNav === 'Settings' ? (
            <><SettingsPanel /><footer className="page-footer"><span>© 2026 BlockPulse AI</span><span>Runtime configuration and service health</span></footer></>
          ) : <ModulePlaceholder activeNav={activeNav} />}
        </div>
      </main>
    </div>
  );
}
