import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();
// Use the actual key from .env (falls back to dev-admin-key if not set)
import { config } from '../src/config';
const ADMIN_KEY = config.admin.apiKey || 'dev-admin-key';

describe('Admin Endpoints', () => {
  it('GET /api/admin/stats returns 403 without API key', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(403);
  });

  it('GET /api/admin/stats returns stats with valid API key', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('X-API-Key', ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.totalVerifications).toBeDefined();
    expect(res.body.activeSessionCount).toBeDefined();
    expect(res.body.providerBreakdown).toBeDefined();
    expect(res.body.dataStorageConfirmation.biometricDataStored).toBe(false);
    expect(res.body.dataStorageConfirmation.message).toContain('Zero biometric data stored');
  });

  it('GET /api/admin/privacy-audit returns audit report', async () => {
    const res = await request(app)
      .get('/api/admin/privacy-audit')
      .set('X-API-Key', ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.biometricDataStored).toBe(false);
    expect(res.body.personalDataStored).toBe(false);
    expect(res.body.complianceNotes).toContain(
      'Zero biometric data stored. Ever. Breach-proof by architecture.',
    );
  });

  it('GET /api/admin/blockchain returns blockchain status', async () => {
    const res = await request(app)
      .get('/api/admin/blockchain')
      .set('X-API-Key', ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
  });

  it('GET /api/admin/blockchain returns 403 without API key', async () => {
    const res = await request(app).get('/api/admin/blockchain');
    expect(res.status).toBe(403);
  });
});
