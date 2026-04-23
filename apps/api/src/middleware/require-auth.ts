/**
 * requireAuth middleware — validates the takumi_session cookie against the
 * sessions table. Sets `req.user = { id, email }` on success.
 *
 * Local-dev bypass: if `AUTH_DEV_BYPASS_USER_ID` is set, the middleware
 * resolves that user directly without a session lookup. Production must
 * never set this var.
 */

import { createHash } from 'crypto';
import { parse as parseCookies } from 'cookie';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/db.js';
import { config } from '../lib/config.js';

export const SESSION_COOKIE = 'takumi_session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; email: string };
    }
  }
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Dev bypass — resolve a fixed user without a session lookup.
  if (config.authDevBypassUserId) {
    const u = await prisma.user.findUnique({
      where: { id: config.authDevBypassUserId },
      select: { id: true, email: true },
    });
    if (u) {
      req.user = { id: u.id, email: u.email };
      return next();
    }
  }

  const cookies = parseCookies(req.headers.cookie ?? '');
  const raw = cookies[SESSION_COOKIE];
  if (!raw) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(raw) },
    include: { user: { select: { id: true, email: true, emailVerifiedAt: true } } },
  });

  if (!session || session.expiresAt < new Date()) {
    return res.status(401).json({ error: 'Session expired' });
  }
  if (!session.user.emailVerifiedAt) {
    return res.status(403).json({ error: 'Email not verified' });
  }

  // Rolling refresh — bump session expiry if it's been more than a day since
  // last touch, so active users stay logged in indefinitely.
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (Date.now() - session.updatedAt.getTime() > oneDayMs) {
    const newExpiry = new Date(Date.now() + 30 * oneDayMs);
    prisma.session
      .update({ where: { id: session.id }, data: { expiresAt: newExpiry } })
      .catch(() => {/* fire-and-forget */});
  }

  req.user = { id: session.user.id, email: session.user.email };
  next();
}
