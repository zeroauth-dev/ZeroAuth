import { useEffect, useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, CardHeader, CardBody, Button, Input, Label, pushToast } from '../components/ui';

const MAC = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

export function CompanyPage() {
  const { company, refresh } = useAuth();
  const qc = useQueryClient();
  const [ssidLabel, setSsidLabel] = useState('');
  const [location, setLocation] = useState('');
  const [minSignal, setMinSignal] = useState(85);
  const [bssids, setBssids] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (company) {
      setSsidLabel(company.wifi.ssidLabel);
      setLocation(company.location);
      setMinSignal(company.wifi.minSignalPercent);
      setBssids(company.wifi.bssids);
    }
  }, [company]);

  function addBssid() {
    const v = draft.trim().toLowerCase();
    if (!MAC.test(v)) { pushToast('warn', 'Enter a MAC like a1:b2:c3:d4:e5:f6'); return; }
    if (!bssids.includes(v)) setBssids([...bssids, v]);
    setDraft('');
  }

  function onDraftKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); addBssid(); }
  }

  const save = useMutation({
    mutationFn: () => api.saveCompany({ ssidLabel, bssids, minSignalPercent: minSignal, location }),
    onSuccess: () => {
      pushToast('success', 'Office network saved.');
      refresh();
      void qc.invalidateQueries({ queryKey: ['account'] });
    },
    onError: (e) => pushToast('danger', e instanceof ApiError ? e.message : 'Could not save.'),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Office network</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Attendance is only marked when the employee's phone is on this network, strongly enough.
        </p>
      </div>

      <Card>
        <CardHeader
          title="WiFi presence anchor"
          description="The router's BSSID is the real gate. The SSID is just a label shown to the employee."
        />
        <CardBody className="space-y-6">
          <div>
            <Label>Network name (SSID)</Label>
            <Input value={ssidLabel} onChange={(e) => setSsidLabel(e.target.value)} placeholder="AnchorBank-Office" />
          </div>

          <div>
            <Label>Office router(s) — BSSID</Label>
            <div className="flex gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onDraftKey}
                placeholder="a1:b2:c3:d4:e5:f6"
                className="font-mono"
              />
              <Button variant="secondary" onClick={addBssid}>Add</Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {bssids.length === 0 ? (
                <span className="text-xs text-[var(--color-text-dim)]">No routers added yet.</span>
              ) : (
                bssids.map((b) => (
                  <span
                    key={b}
                    className="inline-flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 py-1 font-mono text-xs"
                  >
                    {b}
                    <button
                      type="button"
                      onClick={() => setBssids(bssids.filter((x) => x !== b))}
                      className="text-[var(--color-text-dim)] transition-colors hover:text-[var(--color-danger)]"
                      aria-label={`Remove ${b}`}
                    >
                      ✕
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          <div>
            <Label>Minimum signal strength — {minSignal}%</Label>
            <input
              type="range"
              min={0}
              max={100}
              value={minSignal}
              onChange={(e) => setMinSignal(Number(e.target.value))}
              className="w-full accent-[var(--color-accent)]"
            />
            <p className="mt-1 text-xs text-[var(--color-text-dim)]">
              Phones below this signal are treated as off-network. 85% ≈ inside the office, not the parking lot.
            </p>
          </div>

          <div>
            <Label>Office location <span className="normal-case text-[var(--color-text-dim)]">(optional)</span></Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Mumbai HQ, 3rd floor" />
          </div>

          <div className="flex items-center justify-between gap-4 pt-1">
            <p className="max-w-sm text-xs text-[var(--color-text-secondary)]">
              Only a yes/no “on the network” verdict reaches the server — never the employee's location.
            </p>
            <Button onClick={() => save.mutate()} loading={save.isPending}>Save network</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
