import { Router } from 'express';
import zkpRoutes from './zkp';
import identityRoutes from './identity';
import deviceRoutes from './devices';
import userRoutes from './users';
import verificationRoutes from './verifications';
import attendanceRoutes from './attendance';
import auditRoutes from './audit';
import proofPairingRoutes from './proof-pairing';
import registrationRoutes from './registrations';

const router = Router();

/**
 * /v1/auth/zkp/*       — ZKP biometric authentication (deprecated, Sunset 2026-12-31)
 * /v1/identity/*       — Identity & session management
 * /v1/devices/*        — Device registration and lifecycle
 * /v1/users/*          — User enrollment and directory
 * /v1/verifications/*  — Product verification audit trail
 * /v1/attendance/*     — Check-in / check-out events
 * /v1/audit/*          — Business audit log
 * /v1/proof-pairing/*  — QR-mediated cross-device proof pairing (W3, ADR-0009)
 * /v1/registrations/*  — Three-QR end-user signup ceremony (ADR-0023)
 *
 * Most routes require: Authorization: Bearer za_live_xxx — except
 * the phone-side handshake endpoints (registrations/pair-device,
 * /submit-commitment, /complete) where the QR-supplied code is the
 * bearer credential. Those routes are listed in
 * tests/tenant-isolation.test.ts PUBLIC_ROUTE_EXCEPTIONS.
 */
router.use('/auth/zkp', zkpRoutes);
router.use('/identity', identityRoutes);
router.use('/devices', deviceRoutes);
router.use('/users', userRoutes);
router.use('/verifications', verificationRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/audit', auditRoutes);
router.use('/proof-pairing', proofPairingRoutes);
router.use('/registrations', registrationRoutes);

export default router;
