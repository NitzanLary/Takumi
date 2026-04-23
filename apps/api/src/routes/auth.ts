/**
 * Auth routes — signup, login, logout, email verification, password reset.
 *
 * All routes mounted under `/api/auth` and live BEFORE the `requireAuth`
 * middleware. The `me` endpoint uses `requireAuth` itself (it's the way the
 * frontend bootstraps the current user).
 */

import { Router } from 'express';
import { randomBytes, createHash } from 'crypto';
import { serialize as serializeCookie } from 'cookie';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { config } from '../lib/config.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/email.service.js';
import { requireAuth, SESSION_COOKIE, hashSessionToken } from '../middleware/require-auth.js';

const router = Router();

const BCRYPT_COST = 12;
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const EMAIL_VERIFY_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_DURATION_MS = 60 * 60 * 1000;    // 1 hour

function genToken(): string {
  return randomBytes(32).toString('hex');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function setSessionCookie(res: any, token: string) {
  const isProd = config.nodeEnv === 'production';
  res.setHeader(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_DURATION_MS / 1000,
    })
  );
}

function clearSessionCookie(res: any) {
  const isProd = config.nodeEnv === 'production';
  res.setHeader(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, '', {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
  );
}

function publicUser(u: { id: string; email: string; displayName: string | null; emailVerifiedAt: Date | null }) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    emailVerifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
  };
}

// ─── Signup ──────────────────────────────────────────────────────

const signupSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().max(80).optional(),
});

router.post('/signup', async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
  }

  const email = normalizeEmail(parsed.data.email);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_COST);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: parsed.data.displayName?.trim() || null,
    },
  });

  // Issue verification token
  const token = genToken();
  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(token),
      purpose: 'email_verify',
      expiresAt: new Date(Date.now() + EMAIL_VERIFY_DURATION_MS),
    },
  });

  try {
    await sendVerificationEmail(user.email, token);
  } catch (err) {
    console.error('[auth/signup] Failed to send verification email:', err);
  }

  res.json({ message: 'Verification email sent. Please check your inbox.' });
});

// ─── Login ───────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  const email = normalizeEmail(parsed.data.email);
  const user = await prisma.user.findUnique({ where: { email } });
  // Constant-time-ish: always do a hash check even if user doesn't exist
  const ok = user ? await bcrypt.compare(parsed.data.password, user.passwordHash) : false;
  if (!user || !ok) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!user.emailVerifiedAt) {
    return res.status(403).json({ error: 'Please verify your email address before logging in' });
  }

  const token = genToken();
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
      userAgent: (req.headers['user-agent'] as string | undefined)?.slice(0, 200) ?? null,
      ipAddress: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip ?? null,
    },
  });

  setSessionCookie(res, token);
  res.json({ user: publicUser(user) });
});

// ─── Logout ──────────────────────────────────────────────────────

router.post('/logout', async (req, res) => {
  // Best-effort delete of the matching session row.
  const cookies = req.headers.cookie ?? '';
  const match = cookies.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (match) {
    const raw = decodeURIComponent(match.split('=')[1] ?? '');
    if (raw) {
      await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(raw) } });
    }
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ─── Email verification ──────────────────────────────────────────

const verifySchema = z.object({ token: z.string().min(1) });

router.post('/verify-email', async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid token' });

  const tokenHash = hashSessionToken(parsed.data.token);
  const record = await prisma.verificationToken.findUnique({ where: { tokenHash } });
  if (!record || record.purpose !== 'email_verify' || record.consumedAt || record.expiresAt < new Date()) {
    return res.status(400).json({ error: 'Token invalid, expired, or already used' });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    }),
    prisma.verificationToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
  ]);

  res.json({ ok: true });
});

const resendSchema = z.object({ email: z.string().email() });

router.post('/resend-verification', async (req, res) => {
  const parsed = resendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const email = normalizeEmail(parsed.data.email);
  const user = await prisma.user.findUnique({ where: { email } });
  // Always respond OK to avoid user enumeration.
  if (user && !user.emailVerifiedAt) {
    const token = genToken();
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(token),
        purpose: 'email_verify',
        expiresAt: new Date(Date.now() + EMAIL_VERIFY_DURATION_MS),
      },
    });
    try {
      await sendVerificationEmail(user.email, token);
    } catch (err) {
      console.error('[auth/resend] Failed:', err);
    }
  }
  res.json({ ok: true });
});

// ─── Current user ────────────────────────────────────────────────

router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, email: true, displayName: true, emailVerifiedAt: true },
  });
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: publicUser(user) });
});

// ─── Password reset ──────────────────────────────────────────────

const forgotSchema = z.object({ email: z.string().email() });

router.post('/forgot-password', async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const email = normalizeEmail(parsed.data.email);
  const user = await prisma.user.findUnique({ where: { email } });
  // Always respond OK to avoid user enumeration.
  if (user) {
    const token = genToken();
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(token),
        purpose: 'password_reset',
        expiresAt: new Date(Date.now() + PASSWORD_RESET_DURATION_MS),
      },
    });
    try {
      await sendPasswordResetEmail(user.email, token);
    } catch (err) {
      console.error('[auth/forgot-password] Failed:', err);
    }
  }
  res.json({ ok: true });
});

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
});

router.post('/reset-password', async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
  }

  const tokenHash = hashSessionToken(parsed.data.token);
  const record = await prisma.verificationToken.findUnique({ where: { tokenHash } });
  if (!record || record.purpose !== 'password_reset' || record.consumedAt || record.expiresAt < new Date()) {
    return res.status(400).json({ error: 'Token invalid, expired, or already used' });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_COST);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.verificationToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
    // Invalidate all existing sessions for this user.
    prisma.session.deleteMany({ where: { userId: record.userId } }),
  ]);

  res.json({ ok: true });
});

export default router;
