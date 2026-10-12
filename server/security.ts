import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { prisma } from './db.js';
import { env } from './config.js';

const COOKIE = env.NODE_ENV === 'production' ? '__Host-temp_ai_session' : 'temp_ai_session';
export const hashSecret = (value: string) => crypto.createHmac('sha256', env.SESSION_SECRET).update(value).digest('hex');
export const randomSecret = () => crypto.randomBytes(32).toString('base64url');
export const clientIp = (req: Request) => req.ip || req.socket.remoteAddress || undefined;
export type Principal = { role: 'ADMIN'; administratorId: string; csrfToken: string } | { role: 'TEMPORARY_USER'; temporaryUserId: string; csrfToken: string; expiresAt: Date };

export async function getPrincipal(req: Request): Promise<Principal | null> {
  const raw = req.cookies?.[COOKIE]; if (!raw) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashSecret(raw) }, include: { temporaryUser: true } });
  if (!session || session.expiresAt <= new Date()) return null;
  if (session.role === 'ADMIN' && session.administratorId) return { role: 'ADMIN', administratorId: session.administratorId, csrfToken: session.csrfToken };
  const user = session.temporaryUser;
  if (!user || user.status !== 'ACTIVE' || user.expiresAt <= new Date()) {
    if (user?.status === 'ACTIVE' && user.expiresAt <= new Date()) await prisma.temporaryUser.update({ where: { id: user.id }, data: { status: 'EXPIRED' } });
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined); return null;
  }
  return { role: 'TEMPORARY_USER', temporaryUserId: user.id, csrfToken: session.csrfToken, expiresAt: user.expiresAt };
}
export async function requirePrincipal(req: Request, res: Response) { const principal = await getPrincipal(req); if (!principal) { res.status(401).json({ error: 'Authentication required or access has expired.' }); return null; } return principal; }
export function requireCsrf(req: Request, res: Response, principal: Principal) { if (req.get('x-csrf-token') !== principal.csrfToken) { res.status(403).json({ error: 'Invalid CSRF token.' }); return false; } return true; }
export async function createSession(res: Response, owner: { role: 'ADMIN'; id: string } | { role: 'TEMPORARY_USER'; id: string; expiresAt: Date }) {
  const token = randomSecret(), csrfToken = randomSecret();
  if (owner.role === 'ADMIN') await prisma.session.deleteMany({ where: { administratorId: owner.id } }); else await prisma.session.deleteMany({ where: { temporaryUserId: owner.id } });
  const expiresAt = owner.role === 'ADMIN' ? new Date(Date.now() + 8 * 60 * 60_000) : owner.expiresAt;
  await prisma.session.create({ data: { tokenHash: hashSecret(token), csrfToken, role: owner.role, expiresAt, ...(owner.role === 'ADMIN' ? { administratorId: owner.id } : { temporaryUserId: owner.id }) } });
  res.cookie(COOKIE, token, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict', path: '/', expires: expiresAt }); return csrfToken;
}
export function clearSession(res: Response) { res.clearCookie(COOKIE, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict', path: '/' }); }
