import { useState, useEffect, useCallback } from 'react';

interface Lead {
  id: number;
  type: 'pilot' | 'whitepaper';
  name: string | null;
  company: string | null;
  email: string;
  size: string | null;
  created_at: string;
}

interface LeadsResponse {
  total: number;
  pilot: number;
  whitepaper: number;
  leads: Lead[];
}

export function useLeads(apiKey: string, typeFilter?: string, refreshInterval = 10000) {
  const [data, setData] = useState<LeadsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLeads = useCallback(async () => {
    try {
      const url = typeFilter
        ? `/api/leads?type=${typeFilter}`
        : '/api/leads';
      const res = await fetch(url, {
        headers: { 'X-API-Key': apiKey },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiKey, typeFilter]);

  useEffect(() => {
    fetchLeads();
    const interval = setInterval(fetchLeads, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchLeads, refreshInterval]);

  return { data, error, loading, refetch: fetchLeads };
}
