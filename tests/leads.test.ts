/**
 * Integration tests for src/routes/leads.ts — the marketing form
 * endpoints used by the public landing page. Mocks getPoolOrNull so we
 * don't need Postgres.
 *
 * Behaviour under test:
 *   - POST /api/leads/pilot validates required fields + email format
 *   - POST /api/leads/whitepaper validates email + returns the download URL
 *   - GET /api/leads requires admin x-api-key
 *   - GET /api/leads supports ?type filter
 *   - Postgres-unavailable doesn't fail the POST (degraded mode)
 */

const mockQuery = jest.fn();
let poolAvailable = true;

jest.mock('../src/services/db', () => ({
  getPool: () => ({ query: mockQuery }),
  getPoolOrNull: () => (poolAvailable ? { query: mockQuery } : null),
}));

import request from 'supertest';
import { createApp } from '../src/app';
import { config } from '../src/config';

const app = createApp();

describe('routes/leads — POST /api/leads/pilot', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    poolAvailable = true;
  });

  it('201s on a valid submission and persists the lead', async () => {
    const res = await request(app)
      .post('/api/leads/pilot')
      .send({ name: 'Jane Smith', company: 'Acme Corp', email: 'jane@acme.com', size: '51-200' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO leads/),
      ['pilot', 'Jane Smith', 'Acme Corp', 'jane@acme.com', '51-200'],
    );
  });

  it('400s on missing name', async () => {
    const res = await request(app)
      .post('/api/leads/pilot')
      .send({ company: 'A', email: 'a@a.com', size: '1-50' });
    expect(res.status).toBe(400);
  });

  it('400s on missing company', async () => {
    const res = await request(app)
      .post('/api/leads/pilot')
      .send({ name: 'A', email: 'a@a.com', size: '1-50' });
    expect(res.status).toBe(400);
  });

  it('400s on missing size', async () => {
    const res = await request(app)
      .post('/api/leads/pilot')
      .send({ name: 'A', company: 'C', email: 'a@a.com' });
    expect(res.status).toBe(400);
  });

  it('400s on invalid email format', async () => {
    const res = await request(app)
      .post('/api/leads/pilot')
      .send({ name: 'A', company: 'C', email: 'not-an-email', size: '1-50' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it('lower-cases the email + trims name/company/size on persist', async () => {
    // Email validation happens on the raw string (whitespace not allowed),
    // so the test must use a valid email shape. Name/company/size whitespace
    // is trimmed at persist time.
    const res = await request(app)
      .post('/api/leads/pilot')
      .send({ name: '  Jane  ', company: '  Acme  ', email: 'JANE@ACME.COM', size: '  51-200  ' });

    expect(res.status).toBe(201);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      ['pilot', 'Jane', 'Acme', 'jane@acme.com', '51-200'],
    );
  });

  it('400s when the email itself contains whitespace (regex rejects \\s)', async () => {
    const res = await request(app)
      .post('/api/leads/pilot')
      .send({ name: 'A', company: 'C', email: ' bad@spaces.com ', size: '1-50' });
    expect(res.status).toBe(400);
  });

  it('still 201s when Postgres is unavailable (degraded — logs warning)', async () => {
    poolAvailable = false;
    const res = await request(app)
      .post('/api/leads/pilot')
      .send({ name: 'X', company: 'Y', email: 'x@y.com', size: '1-50' });
    expect(res.status).toBe(201);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('still 201s when the INSERT fails (degraded — logs error, doesn\'t leak DB error to client)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('table leads doesn\'t exist'));
    const res = await request(app)
      .post('/api/leads/pilot')
      .send({ name: 'X', company: 'Y', email: 'x@y.com', size: '1-50' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    // No leak of the DB error to the client
    expect(JSON.stringify(res.body)).not.toMatch(/table leads/);
  });
});

describe('routes/leads — POST /api/leads/whitepaper', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    poolAvailable = true;
  });

  it('201s with downloadUrl + filename on a valid email', async () => {
    const res = await request(app)
      .post('/api/leads/whitepaper')
      .send({ email: 'reader@example.com' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      downloadUrl: '/docs/whitepaper.pdf',
      filename: 'Pramaan_Whitepaper.pdf',
    });
  });

  it('400s on missing email', async () => {
    const res = await request(app).post('/api/leads/whitepaper').send({});
    expect(res.status).toBe(400);
  });

  it('400s on invalid email format', async () => {
    const res = await request(app)
      .post('/api/leads/whitepaper')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('persists with type=whitepaper', async () => {
    await request(app).post('/api/leads/whitepaper').send({ email: 'a@b.com' });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO leads/),
      ['whitepaper', 'a@b.com'],
    );
  });
});

describe('routes/leads — GET /api/leads (admin)', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    poolAvailable = true;
  });

  it('403s without x-api-key', async () => {
    const res = await request(app).get('/api/leads');
    expect(res.status).toBe(403);
  });

  it('403s with a wrong x-api-key', async () => {
    const res = await request(app)
      .get('/api/leads')
      .set('x-api-key', 'wrong');
    expect(res.status).toBe(403);
  });

  it('200s with rollup counts when authorized', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: '1', type: 'pilot', name: 'A', email: 'a@a.com' },
        { id: '2', type: 'pilot', name: 'B', email: 'b@b.com' },
        { id: '3', type: 'whitepaper', email: 'c@c.com' },
      ],
    });
    const res = await request(app)
      .get('/api/leads')
      .set('x-api-key', config.admin.apiKey);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total: 3,
      pilot: 2,
      whitepaper: 1,
      leads: expect.any(Array),
    });
  });

  it('filters by ?type=pilot', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1', type: 'pilot' }] });
    await request(app)
      .get('/api/leads?type=pilot')
      .set('x-api-key', config.admin.apiKey);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/WHERE type = \$1/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['pilot']);
  });

  it('ignores invalid ?type values', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app)
      .get('/api/leads?type=injection-attempt')
      .set('x-api-key', config.admin.apiKey);
    const sql = mockQuery.mock.calls[0][0] as string;
    // No WHERE clause added → just SELECT * + ORDER BY
    expect(sql).not.toMatch(/WHERE/);
  });

  it('503s when Postgres is unavailable', async () => {
    poolAvailable = false;
    const res = await request(app)
      .get('/api/leads')
      .set('x-api-key', config.admin.apiKey);
    expect(res.status).toBe(503);
  });

  it('500s on query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app)
      .get('/api/leads')
      .set('x-api-key', config.admin.apiKey);
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
    expect(JSON.stringify(res.body)).not.toMatch(/boom/);
  });
});
