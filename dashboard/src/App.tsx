import React, { useState } from 'react';
import { useStats } from './hooks/useStats';
import { useBlockchain } from './hooks/useBlockchain';
import { useLeads } from './hooks/useLeads';

const STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: #0a0a0f;
    color: #e4e4e7;
    min-height: 100vh;
  }
  .app { max-width: 1200px; margin: 0 auto; padding: 2rem; }
  .header {
    text-align: center;
    margin-bottom: 3rem;
    padding: 2rem 0;
  }
  .logo { font-size: 2.5rem; font-weight: 700; color: #fff; }
  .logo span { color: #22c55e; }
  .tagline {
    margin-top: 1rem;
    padding: 0.75rem 1.5rem;
    background: linear-gradient(135deg, rgba(34,197,94,0.15), rgba(34,197,94,0.05));
    border: 1px solid rgba(34,197,94,0.3);
    border-radius: 12px;
    font-size: 1.1rem;
    font-weight: 500;
    color: #22c55e;
    display: inline-block;
  }
  .api-key-form {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    margin-top: 1.5rem;
  }
  .api-key-form input {
    padding: 0.5rem 1rem;
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 8px;
    color: #e4e4e7;
    font-size: 0.9rem;
    width: 280px;
    outline: none;
  }
  .api-key-form input:focus { border-color: #22c55e; }
  .btn {
    padding: 0.5rem 1.25rem;
    background: #22c55e;
    color: #0a0a0f;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.9rem;
    transition: opacity 0.2s;
  }
  .btn:hover { opacity: 0.9; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2rem;
  }
  .card {
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 16px;
    padding: 1.5rem;
    transition: border-color 0.2s;
  }
  .card:hover { border-color: #3f3f46; }
  .card-label {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #71717a;
    margin-bottom: 0.5rem;
  }
  .card-value {
    font-size: 2.5rem;
    font-weight: 700;
    color: #fff;
  }
  .card-value.green { color: #22c55e; }
  .privacy-banner {
    background: linear-gradient(135deg, rgba(34,197,94,0.1), rgba(16,185,129,0.05));
    border: 2px solid rgba(34,197,94,0.4);
    border-radius: 16px;
    padding: 2rem;
    text-align: center;
    margin-bottom: 2rem;
  }
  .privacy-icon { font-size: 3rem; margin-bottom: 1rem; }
  .privacy-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: #22c55e;
    margin-bottom: 0.5rem;
  }
  .privacy-sub { color: #a1a1aa; font-size: 0.95rem; }
  .provider-bar {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
  }
  .provider-segment {
    height: 8px;
    border-radius: 4px;
    min-width: 4px;
    transition: width 0.3s;
  }
  .provider-legend {
    display: flex;
    gap: 1.5rem;
    margin-top: 0.75rem;
    font-size: 0.85rem;
    color: #a1a1aa;
  }
  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    margin-right: 0.4rem;
    vertical-align: middle;
  }
  .uptime { color: #71717a; font-size: 0.85rem; text-align: center; margin-top: 2rem; }
  .error-msg { color: #ef4444; text-align: center; padding: 2rem; }
  .loading { text-align: center; padding: 4rem; color: #71717a; }
  .bc-panel {
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 16px;
    padding: 1.5rem;
    margin-top: 1.5rem;
    margin-bottom: 1.5rem;
  }
  .bc-title {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #71717a;
    margin-bottom: 1rem;
  }
  .bc-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }
  .bc-item-label { font-size: 0.75rem; color: #71717a; margin-bottom: 0.25rem; }
  .bc-item-value {
    font-size: 0.9rem;
    color: #e4e4e7;
    font-family: 'SF Mono', 'Fira Code', monospace;
    word-break: break-all;
  }
  .bc-item-value a {
    color: #3b82f6;
    text-decoration: none;
  }
  .bc-item-value a:hover { text-decoration: underline; }
  .bc-status {
    display: inline-block;
    padding: 0.2rem 0.6rem;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .bc-status.connected { background: rgba(34,197,94,0.15); color: #22c55e; }
  .bc-status.offline { background: rgba(239,68,68,0.15); color: #ef4444; }
  .leads-panel {
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 16px;
    padding: 1.5rem;
    margin-top: 1.5rem;
  }
  .leads-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }
  .leads-title {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #71717a;
  }
  .leads-counts {
    display: flex;
    gap: 1rem;
    font-size: 0.85rem;
    color: #a1a1aa;
  }
  .leads-counts strong { color: #e4e4e7; }
  .leads-filters {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .filter-btn {
    padding: 0.375rem 0.875rem;
    background: #27272a;
    color: #a1a1aa;
    border: 1px solid #3f3f46;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 500;
    transition: all 0.15s;
  }
  .filter-btn:hover { border-color: #52525b; color: #e4e4e7; }
  .filter-btn.active {
    background: #22c55e;
    color: #0a0a0f;
    border-color: #22c55e;
    font-weight: 600;
  }
  .leads-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  .leads-table th {
    text-align: left;
    padding: 0.625rem 0.75rem;
    color: #71717a;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid #27272a;
    font-weight: 600;
  }
  .leads-table td {
    padding: 0.625rem 0.75rem;
    border-bottom: 1px solid #1e1e23;
    color: #e4e4e7;
  }
  .leads-table tr:hover td { background: #1a1a1f; }
  .type-badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .type-badge.pilot { background: rgba(59,130,246,0.15); color: #3b82f6; }
  .type-badge.whitepaper { background: rgba(139,92,246,0.15); color: #8b5cf6; }
  .leads-empty {
    text-align: center;
    padding: 2rem;
    color: #52525b;
    font-size: 0.9rem;
  }
`;

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

function truncAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function BlockchainPanel({ apiKey }: { apiKey: string }) {
  const { info, loading } = useBlockchain(apiKey);

  if (loading || !info) return null;

  const isConnected = info.status === 'connected';
  const explorerBase = 'https://sepolia.basescan.org';

  return (
    <div className="bc-panel">
      <div className="bc-title">
        Base Sepolia L2 Blockchain{' '}
        <span className={`bc-status ${isConnected ? 'connected' : 'offline'}`}>
          {isConnected ? 'Connected' : 'Offline'}
        </span>
      </div>
      {isConnected && (
        <div className="bc-grid">
          <div>
            <div className="bc-item-label">Network</div>
            <div className="bc-item-value">{info.network} (Chain {info.chainId})</div>
          </div>
          <div>
            <div className="bc-item-label">Latest Block</div>
            <div className="bc-item-value">{info.latestBlock?.toLocaleString()}</div>
          </div>
          <div>
            <div className="bc-item-label">Identities On-Chain</div>
            <div className="bc-item-value">{info.identityCount}</div>
          </div>
          <div>
            <div className="bc-item-label">DIDRegistry</div>
            <div className="bc-item-value">
              {info.contracts?.DIDRegistry !== 'not deployed' ? (
                <a href={`${explorerBase}/address/${info.contracts.DIDRegistry}`} target="_blank" rel="noopener noreferrer">
                  {truncAddr(info.contracts.DIDRegistry)}
                </a>
              ) : 'Not deployed'}
            </div>
          </div>
          <div>
            <div className="bc-item-label">Verifier</div>
            <div className="bc-item-value">
              {info.contracts?.Verifier !== 'not deployed' ? (
                <a href={`${explorerBase}/address/${info.contracts.Verifier}`} target="_blank" rel="noopener noreferrer">
                  {truncAddr(info.contracts.Verifier)}
                </a>
              ) : 'Not deployed'}
            </div>
          </div>
          <div>
            <div className="bc-item-label">Deployer</div>
            <div className="bc-item-value">
              <a href={`${explorerBase}/address/${info.deployerAddress}`} target="_blank" rel="noopener noreferrer">
                {truncAddr(info.deployerAddress)}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LeadsPanel({ apiKey }: { apiKey: string }) {
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const { data, loading, error } = useLeads(apiKey, typeFilter);

  if (loading) return <div className="leads-panel"><div className="loading">Loading leads...</div></div>;
  if (error) return <div className="leads-panel"><div className="error-msg">Failed to load leads: {error}</div></div>;
  if (!data) return null;

  const filters: { label: string; value: string | undefined }[] = [
    { label: 'All', value: undefined },
    { label: 'Pilot', value: 'pilot' },
    { label: 'Whitepaper', value: 'whitepaper' },
  ];

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className="leads-panel">
      <div className="leads-header">
        <div className="leads-title">Form Submissions</div>
        <div className="leads-counts">
          <span>Total: <strong>{data.total}</strong></span>
          <span>Pilot: <strong>{data.pilot}</strong></span>
          <span>Whitepaper: <strong>{data.whitepaper}</strong></span>
        </div>
      </div>
      <div className="leads-filters">
        {filters.map(f => (
          <button
            key={f.label}
            className={`filter-btn ${typeFilter === f.value ? 'active' : ''}`}
            onClick={() => setTypeFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {data.leads.length === 0 ? (
        <div className="leads-empty">No submissions yet</div>
      ) : (
        <table className="leads-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Name</th>
              <th>Company</th>
              <th>Email</th>
              <th>Size</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {data.leads.map(lead => (
              <tr key={lead.id}>
                <td><span className={`type-badge ${lead.type}`}>{lead.type}</span></td>
                <td>{lead.name || '—'}</td>
                <td>{lead.company || '—'}</td>
                <td>{lead.email}</td>
                <td>{lead.size || '—'}</td>
                <td>{formatDate(lead.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Dashboard({ apiKey }: { apiKey: string }) {
  const { stats, error, loading } = useStats(apiKey);

  if (loading) return <div className="loading">Loading dashboard...</div>;
  if (error) return <div className="error-msg">Error: {error}. Check your API key.</div>;
  if (!stats) return null;

  const total = stats.providerBreakdown.saml + stats.providerBreakdown.oidc + stats.providerBreakdown.zkp;
  const samlPct = total ? (stats.providerBreakdown.saml / total) * 100 : 33;
  const oidcPct = total ? (stats.providerBreakdown.oidc / total) * 100 : 33;
  const zkpPct = total ? (stats.providerBreakdown.zkp / total) * 100 : 34;

  return (
    <>
      <div className="privacy-banner">
        <div className="privacy-icon">&#x1f6e1;</div>
        <div className="privacy-title">
          Zero biometric data stored. Ever. Breach-proof by architecture.
        </div>
        <div className="privacy-sub">
          All biometric verification uses Zero-Knowledge Proofs. No raw data ever touches our servers.
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="card-label">Total Verifications</div>
          <div className="card-value">{stats.totalVerifications.toLocaleString()}</div>
        </div>
        <div className="card">
          <div className="card-label">Active Sessions</div>
          <div className="card-value">{stats.activeSessionCount.toLocaleString()}</div>
        </div>
        <div className="card">
          <div className="card-label">Biometric Data Stored</div>
          <div className="card-value green">ZERO</div>
        </div>
        <div className="card">
          <div className="card-label">Breach Risk</div>
          <div className="card-value green">NONE</div>
        </div>
      </div>

      <div className="card">
        <div className="card-label">Authentication Provider Breakdown</div>
        <div className="provider-bar">
          <div className="provider-segment" style={{ width: `${samlPct}%`, background: '#3b82f6' }} />
          <div className="provider-segment" style={{ width: `${oidcPct}%`, background: '#8b5cf6' }} />
          <div className="provider-segment" style={{ width: `${zkpPct}%`, background: '#22c55e' }} />
        </div>
        <div className="provider-legend">
          <span><span className="legend-dot" style={{ background: '#3b82f6' }} />SAML: {stats.providerBreakdown.saml}</span>
          <span><span className="legend-dot" style={{ background: '#8b5cf6' }} />OIDC: {stats.providerBreakdown.oidc}</span>
          <span><span className="legend-dot" style={{ background: '#22c55e' }} />ZKP: {stats.providerBreakdown.zkp}</span>
        </div>
      </div>

      <BlockchainPanel apiKey={apiKey} />

      <LeadsPanel apiKey={apiKey} />

      <div className="uptime">Uptime: {formatUptime(stats.uptimeSeconds)}</div>
    </>
  );
}

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState('');

  return (
    <>
      <style>{STYLES}</style>
      <div className="app">
        <div className="header">
          <div className="logo">
            Zero<span>Auth</span>
          </div>
          <div className="tagline">
            Zero biometric data stored. Ever. Breach-proof by architecture.
          </div>
          {!connected && (
            <form
              className="api-key-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (input.trim()) {
                  setApiKey(input.trim());
                  setConnected(true);
                }
              }}
            >
              <input
                type="password"
                placeholder="Enter Admin API Key"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button className="btn" type="submit">Connect</button>
            </form>
          )}
        </div>
        {connected && <Dashboard apiKey={apiKey} />}
      </div>
    </>
  );
}
