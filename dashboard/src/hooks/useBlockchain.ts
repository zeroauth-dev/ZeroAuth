import { useState, useEffect, useCallback } from 'react';

interface BlockchainInfo {
  status: string;
  network: string;
  chainId: number;
  rpcUrl: string;
  contracts: {
    DIDRegistry: string;
    Verifier: string;
  };
  identityCount: number;
  latestBlock: number;
  deployerAddress: string;
}

export function useBlockchain(apiKey: string, refreshInterval = 10000) {
  const [info, setInfo] = useState<BlockchainInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/blockchain', {
        headers: { 'X-API-Key': apiKey },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setInfo(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    fetchInfo();
    const interval = setInterval(fetchInfo, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchInfo, refreshInterval]);

  return { info, error, loading, refetch: fetchInfo };
}
