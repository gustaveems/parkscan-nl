import { useEffect, useState } from 'react';
import './ProviderStatus.css';

const LABELS = {
  store: 'Storage',
  places: 'Places',
  maps: 'Maps',
  streetview: 'Street View',
  bag: 'BAG',
  llm: 'LLM',
  vision: 'Vision',
};

const PROVIDER_TEXT = {
  memory: 'In-memory',
  postgres: 'Postgres',
  google_places: 'Google',
  google_maps_static: 'Google',
  google_streetview: 'Google',
  pdok_locatieserver: 'PDOK',
  bag_bevragingen: 'BAG API',
  vertex_gemini: 'Vertex',
  gemini_api: 'Gemini',
  vision_sa: 'Vision (SA)',
  vision_api_key: 'Vision',
  mock: 'Mock',
};

function classify(provider) {
  if (!provider || provider === 'mock' || provider === 'memory') return 'mock';
  return 'live';
}

export default function ProviderStatus() {
  const [providers, setProviders] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let timer;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch('/api/providers');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) {
          setProviders(json);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
      timer = setTimeout(poll, 30000);
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  if (err) {
    return (
      <div className="provider-status error">
        <span className="ps-dot offline" />
        <span>Backend unreachable</span>
      </div>
    );
  }
  if (!providers) {
    return (
      <div className="provider-status">
        <span className="ps-dot pending" />
        <span>Checking providers…</span>
      </div>
    );
  }

  const liveCount = Object.values(providers).filter(
    (p) => classify(p) === 'live'
  ).length;
  const totalCount = Object.keys(providers).length;

  return (
    <div className="provider-status">
      <div className="ps-summary">
        <span className={`ps-dot ${liveCount === totalCount ? 'live' : 'partial'}`} />
        <span>{liveCount}/{totalCount} live</span>
      </div>
      <div className="ps-grid">
        {Object.entries(providers).map(([key, value]) => (
          <div key={key} className={`ps-row ${classify(value)}`}>
            <span className="ps-label">{LABELS[key] || key}</span>
            <span className="ps-value">{PROVIDER_TEXT[value] || value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
