/**
 * Email service — thin wrapper around Resend's REST API.
 *
 * Uses fetch directly instead of the Resend SDK to avoid an extra dependency.
 * Sends are no-ops (with a console log) if RESEND_API_KEY isn't set, so local
 * dev keeps working without configuring email.
 */

import { config } from '../lib/config.js';

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailParams): Promise<void> {
  if (!config.email.resendApiKey) {
    console.log(`[email] (no RESEND_API_KEY set) Would send to ${to}: ${subject}`);
    console.log(`[email] Body:\n${html}\n`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.email.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.email.from,
      to,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API ${res.status}: ${body}`);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const url = `${config.appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to,
    subject: 'Verify your Takumi email address',
    html: `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 24px auto; color: #111;">
  <h2>Welcome to Takumi</h2>
  <p>Click the link below to verify your email address. This link expires in 24 hours.</p>
  <p><a href="${escapeHtml(url)}" style="display: inline-block; background: #0d9488; color: white; padding: 10px 16px; text-decoration: none; border-radius: 6px;">Verify email</a></p>
  <p style="color: #666; font-size: 13px;">Or copy this link into your browser:<br>${escapeHtml(url)}</p>
  <p style="color: #999; font-size: 12px; margin-top: 32px;">If you didn't sign up for Takumi, you can safely ignore this email.</p>
</body>
</html>`,
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const url = `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to,
    subject: 'Reset your Takumi password',
    html: `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 24px auto; color: #111;">
  <h2>Reset your password</h2>
  <p>Click the link below to choose a new password. This link expires in 1 hour.</p>
  <p><a href="${escapeHtml(url)}" style="display: inline-block; background: #0d9488; color: white; padding: 10px 16px; text-decoration: none; border-radius: 6px;">Reset password</a></p>
  <p style="color: #666; font-size: 13px;">Or copy this link into your browser:<br>${escapeHtml(url)}</p>
  <p style="color: #999; font-size: 12px; margin-top: 32px;">If you didn't request this, you can safely ignore this email.</p>
</body>
</html>`,
  });
}
