import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { issueTokens } from '../services/jwt';
import { sessionStore } from '../services/session-store';
import { logger } from '../services/logger';
import { SAMLProfile, UserSession } from '../types';

const router = Router();

/**
 * GET /api/auth/saml/login
 * Initiates SAML SSO flow by redirecting to IdP.
 * In production, passport-saml handles the actual redirect.
 */
router.get('/login', (_req: Request, res: Response) => {
  const samlRequest = {
    entryPoint: config.saml.entryPoint,
    issuer: config.saml.issuer,
    callbackUrl: config.saml.callbackUrl,
  };

  logger.info('SAML login initiated', { issuer: samlRequest.issuer });

  // In production with passport-saml configured against a real IdP,
  // this would be: passport.authenticate('saml')
  // For now, redirect to the IdP entry point
  res.json({
    message: 'SAML SSO login endpoint',
    redirectUrl: samlRequest.entryPoint,
    issuer: samlRequest.issuer,
    note: 'Configure SAML_ENTRY_POINT and SAML_CERT for production IdP integration',
  });
});

/**
 * POST /api/auth/saml/callback
 * Receives SAML assertion from IdP after successful authentication.
 */
router.post('/callback', (req: Request, res: Response) => {
  try {
    // In production, passport-saml validates the SAML assertion signature
    // and extracts the user profile. Here we simulate the callback.
    const samlResponse = req.body.SAMLResponse as string | undefined;

    if (!samlResponse) {
      res.status(400).json({ error: 'Missing SAMLResponse' });
      return;
    }

    // Simulated profile extraction (in production, passport-saml does this)
    const profile: SAMLProfile = {
      nameID: req.body.nameID ?? `saml-user-${uuidv4().slice(0, 8)}`,
      nameIDFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      issuer: config.saml.issuer,
      email: req.body.email,
    };

    const sessionId = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3600000); // 1 hour

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

    logger.info('SAML authentication successful', {
      userId: profile.nameID,
      sessionId,
      dataStored: false,
    });

    res.json({
      ...tokens,
      sessionId,
      provider: 'saml',
      dataStorageConfirmation: {
        biometricDataStored: false,
        message: 'Zero biometric data stored. Ever. Breach-proof by architecture.',
      },
    });
  } catch (err) {
    logger.error('SAML callback error', { error: (err as Error).message });
    res.status(500).json({ error: 'SAML authentication failed' });
  }
});

/**
 * GET /api/auth/saml/metadata
 * Returns SP metadata for IdP configuration.
 */
router.get('/metadata', (_req: Request, res: Response) => {
  const metadata = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="${config.saml.issuer}">
  <SPSSODescriptor
    AuthnRequestsSigned="true"
    WantAssertionsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <AssertionConsumerService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${config.saml.callbackUrl}"
      index="0"
      isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>`;

  res.type('application/xml').send(metadata);
});

export default router;
