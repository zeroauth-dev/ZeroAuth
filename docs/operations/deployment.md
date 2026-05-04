# Platform Status & Health

ZeroAuth is a fully hosted API platform. There is nothing to deploy — create an account and start making API calls.

## Service Health

Check the platform status at any time:

```bash
curl https://zeroauth.dev/api/health
```

The health endpoint returns:

- overall service status,
- blockchain connection status and latest block,
- configured contract addresses,
- ZKP verification engine readiness,
- Poseidon hash support status.

No authentication is required for the health endpoint.

## Monitoring Your Usage

### Current Usage

```bash
curl https://zeroauth.dev/api/console/usage \
  -H "Authorization: Bearer YOUR_CONSOLE_TOKEN"
```

Returns:

- current month's request count vs. quota,
- rate limit configuration,
- monthly usage history,
- recent API calls with timestamps and endpoints.

### Account Info

```bash
curl https://zeroauth.dev/api/console/account \
  -H "Authorization: Bearer YOUR_CONSOLE_TOKEN"
```

Returns your plan tier, rate limit, monthly quota, and account status.

## Rate Limit Headers

Every API response includes rate limit information:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 97
X-RateLimit-Reset: 1710412800
X-ZeroAuth-Tenant: a1b2c3d4-...
X-ZeroAuth-Plan: free
```

Use these headers to implement client-side rate limit awareness and backoff.

## Plan Limits

| Plan | Rate Limit (per 15 min) | Monthly Quota |
|---|---|---|
| Free | 100 | 1,000 |
| Starter | 500 | 25,000 |
| Growth | 2,000 | 250,000 |
| Enterprise | 10,000 | Unlimited |

## On-Chain Infrastructure

ZeroAuth maintains contracts on Base Sepolia L2:

| Contract | Address |
|---|---|
| `DIDRegistry` | `0xC68ceB726DDB898E899080021A0B9e7994f63A73` |
| `Groth16Verifier` | `0x58258bf549D8E8694b22B12410F24583D16e1aA4` |

Blockchain anchoring is available on Starter plans and above.

## Recommended Integration Practices

- **Monitor rate limit headers** in every response and implement exponential backoff.
- **Use separate API keys** for different services and environments.
- **Check usage regularly** via the console API to avoid quota surprises.
- **Keep API keys server-side** — never expose them in client-side code.
- **Handle errors gracefully** — see [Error Format](../reference/api-reference.md#error-format) for the standard error shape.
