import jwt, { SignOptions } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { AuthToken, JWTPayload } from '../types';

function parseExpiresIn(value: string): number {
  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) return 3600; // default 1h
  const num = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return num;
    case 'm': return num * 60;
    case 'h': return num * 3600;
    case 'd': return num * 86400;
    default: return 3600;
  }
}

export function issueTokens(payload: Omit<JWTPayload, 'iat' | 'exp'>): AuthToken {
  const accessExpiresIn = parseExpiresIn(config.jwt.expiresIn);
  const refreshExpiresIn = parseExpiresIn(config.jwt.refreshExpiresIn);

  const accessOpts: SignOptions = {
    expiresIn: accessExpiresIn,
    issuer: 'zeroauth',
    jwtid: uuidv4(),
  };

  const accessToken = jwt.sign(payload as object, config.jwt.secret, accessOpts);

  const refreshOpts: SignOptions = {
    expiresIn: refreshExpiresIn,
    issuer: 'zeroauth',
    jwtid: uuidv4(),
  };

  const refreshToken = jwt.sign(
    { sub: payload.sub, type: 'refresh', sessionId: payload.sessionId },
    config.jwt.secret,
    refreshOpts,
  );

  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: accessExpiresIn,
  };
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, config.jwt.secret, { issuer: 'zeroauth' }) as JWTPayload;
}

export function decodeToken(token: string): JWTPayload | null {
  return jwt.decode(token) as JWTPayload | null;
}
