import { useState, useEffect, useCallback } from 'react';

interface AdminStats {
  totalVerifications: number;
  activeSessionCount: number;
  providerBreakdown: {
    saml: number;
    oidc: number;
    zkp: number;
  };
  dataStorageConfirmation: {
    biometricDataStored: false;
    message: string;
  };
  uptimeSeconds: number;
}

export function useStats(apiKey: string, refreshInterval = 5000) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/stats', {
        headers: { 'X-API-Key': apiKey },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStats(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchStats, refreshInterval]);

  return { stats, error, loading, refetch: fetchStats };
}
