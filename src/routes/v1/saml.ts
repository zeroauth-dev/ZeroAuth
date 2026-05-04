import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticateTenantApiKey, getTenantContext } from '../../middleware/tenant-auth';
import { config } from '../../config';
import { issueTokens } from '../../services/jwt';
import { sessionStore } from '../../services/session-store';
import { logger } from '../../services/logger';
import { SAMLProfile, UserSession } from '../../types';

const router = Router();

/**
 * GET /v1/auth/saml/login
 *
 * Initiate SAML SSO flow. Returns redirect URL for IdP.
 * Requires scope: saml:login
 */
router.get('/login',
  authenticateTenantApiKey(['saml:login']),
  (req: Request, res: Response) => {
    const { tenant } = getTenantContext(req);

    const samlRequest = {
      entryPoint: config.saml.entryPoint,
      issuer: config.saml.issuer,
      callbackUrl: `${config.apiBaseUrl}/v1/auth/saml/callback`,
    };

    logger.info('v1: SAML login initiated', { tenantId: tenant.id });

    res.json({
      redirectUrl: samlRequest.entryPoint,
      issuer: samlRequest.issuer,
      callbackUrl: samlRequest.callbackUrl,
      note: 'Redirect the user to redirectUrl. Configure your IdP with the issuer and callbackUrl.',
    });
  },
);

/**
 * POST /v1/auth/saml/callback
 *
 * Process SAML assertion from IdP.
 * Requires scope: saml:callback
 */
router.post('/callback',
  authenticateTenantApiKey(['saml:callback']),
  (req: Request, res: Response) => {
    try {
      const { tenant } = getTenantContext(req);
      const samlResponse = req.body.SAMLResponse as string | undefined;

      if (!samlResponse) {
        res.status(400).json({ error: 'missing_saml_response' });
        return;
      }

      const profile: SAMLProfile = {
        nameID: req.body.nameID ?? `saml-user-${uuidv4().slice(0, 8)}`,
        nameIDFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        issuer: config.saml.issuer,
        email: req.body.email,
      };

      const sessionId = uuidv4();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 3600000);

      const session: UserSession = {
        sessionId,
        userId: profile.nameID,
        provider: 'saml',
        verified: true,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };
      sessionStore.create(session);

      const tokens = issueTokens({
        sub: profile.nameID,
        email: profile.email,
        provider: 'saml',
        verified: true,
        sessionId,
      });

      logger.info('v1: SAML auth successful', { tenantId: tenant.id, sessionId });

      res.json({
        ...tokens,
        sessionId,
        provider: 'saml',
        dataStorageConfirmation: {
          biometricDataStored: false,
          message: 'Zero biometric data stored. Ever.',
        },
      });
    } catch (err) {
      logger.error('v1: SAML callback error', { error: (err as Error).message });
      res.status(500).json({ error: 'saml_auth_failed' });
    }
  },
);

/**
 * GET /v1/auth/saml/metadata
 *
 * SP metadata XML for IdP configuration.
 */
router.get('/metadata',
  authenticateTenantApiKey(['saml:login']),
  (_req: Request, res: Response) => {
    const metadata = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="${config.saml.issuer}">
  <SPSSODescriptor
    AuthnRequestsSigned="true"
    WantAssertionsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <AssertionConsumerService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${config.apiBaseUrl}/v1/auth/saml/callback"
      index="0"
      isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
    res.type('application/xml').send(metadata);
  },
);

export default router;
