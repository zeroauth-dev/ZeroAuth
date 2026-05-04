import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

describe('SAML Endpoints', () => {
  it('GET /api/auth/saml/login returns SSO info', async () => {
    const res = await request(app).get('/api/auth/saml/login');
    expect(res.status).toBe(200);
    expect(res.body.redirectUrl).toBeDefined();
    expect(res.body.issuer).toBeDefined();
  });

  it('POST /api/auth/saml/callback returns 400 without SAMLResponse', async () => {
    const res = await request(app)
      .post('/api/auth/saml/callback')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('SAMLResponse');
  });

  it('POST /api/auth/saml/callback returns tokens with SAMLResponse', async () => {
    const res = await request(app)
      .post('/api/auth/saml/callback')
      .send({ SAMLResponse: 'mock-saml-response', nameID: 'user@corp.com' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.provider).toBe('saml');
    expect(res.body.dataStorageConfirmation.biometricDataStored).toBe(false);
  });

  it('GET /api/auth/saml/metadata returns XML', async () => {
    const res = await request(app).get('/api/auth/saml/metadata');
    expect(res.status).toBe(200);
    expect(res.type).toContain('xml');
    expect(res.text).toContain('EntityDescriptor');
  });
});
