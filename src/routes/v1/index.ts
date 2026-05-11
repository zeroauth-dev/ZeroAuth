import { Router } from 'express';
import zkpRoutes from './zkp';
import identityRoutes from './identity';
import samlRoutes from './saml';
import oidcRoutes from './oidc';
import deviceRoutes from './devices';
import userRoutes from './users';
import verificationRoutes from './verifications';
import attendanceRoutes from './attendance';
import auditRoutes from './audit';

const router = Router();

/**
 * /v1/auth/zkp/*   — ZKP biometric authentication
 * /v1/auth/saml/*   — SAML SSO integration
 * /v1/auth/oidc/*   — OIDC/OAuth2 integration
 * /v1/identity/*    — Identity & session management
 * /v1/devices/*     — Device registration and lifecycle
 * /v1/users/*       — User enrollment and directory
 * /v1/verifications/* — Product verification audit trail
 * /v1/attendance/*  — Check-in / check-out events
 * /v1/audit/*       — Business audit log
 *
 * All routes require: Authorization: Bearer za_live_xxx
 */
router.use('/auth/zkp', zkpRoutes);
router.use('/auth/saml', samlRoutes);
router.use('/auth/oidc', oidcRoutes);
router.use('/identity', identityRoutes);
router.use('/devices', deviceRoutes);
router.use('/users', userRoutes);
router.use('/verifications', verificationRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/audit', auditRoutes);

export default router;
