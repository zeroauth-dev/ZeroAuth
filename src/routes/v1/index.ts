import { Router } from 'express';
import zkpRoutes from './zkp';
import identityRoutes from './identity';
import samlRoutes from './saml';
import oidcRoutes from './oidc';

const router = Router();

/**
 * /v1/auth/zkp/*   — ZKP biometric authentication
 * /v1/auth/saml/*   — SAML SSO integration
 * /v1/auth/oidc/*   — OIDC/OAuth2 integration
 * /v1/identity/*    — Identity & session management
 *
 * All routes require: Authorization: Bearer za_live_xxx
 */
router.use('/auth/zkp', zkpRoutes);
router.use('/auth/saml', samlRoutes);
router.use('/auth/oidc', oidcRoutes);
router.use('/identity', identityRoutes);

export default router;
