import { UserSession, AdminStats } from '../types';

/**
 * In-memory session store.
 * In production, replace with Redis or a distributed cache.
 * CRITICAL: No biometric data is ever stored here or anywhere.
 */
class SessionStore {
  private sessions = new Map<string, UserSession>();
  private verificationCount = { saml: 0, oidc: 0, zkp: 0 };
  private startTime = Date.now();

  create(session: UserSession): void {
    this.sessions.set(session.sessionId, session);
    this.verificationCount[session.provider]++;
  }

  get(sessionId: string): UserSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session && new Date(session.expiresAt) < new Date()) {
      this.sessions.delete(sessionId);
      return undefined;
    }
    return session;
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  getStats(): AdminStats {
    // Prune expired sessions
    const now = new Date();
    for (const [id, session] of this.sessions) {
      if (new Date(session.expiresAt) < now) {
        this.sessions.delete(id);
      }
    }

    const total =
      this.verificationCount.saml +
      this.verificationCount.oidc +
      this.verificationCount.zkp;

    return {
      totalVerifications: total,
      activeSessionCount: this.sessions.size,
      providerBreakdown: { ...this.verificationCount },
      dataStorageConfirmation: {
        biometricDataStored: false as const,
        message: 'Zero biometric data stored. Ever. Breach-proof by architecture.',
      },
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }
}

export const sessionStore = new SessionStore();
