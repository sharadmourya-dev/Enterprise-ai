import nodemailer from 'nodemailer';
import type { Transporter, SentMessageInfo } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ServiceUnavailableError } from '../utils/errors.js';

export interface ISendPasswordResetParams {
  to: string;
  resetUrl: string;
  expiresInMinutes?: number;
}

export class MailService {
  private static transporterOverride: Transporter | null = null;
  private static activeTransporter: Transporter | null = null;

  /**
   * Sets or clears a transporter override for testing purposes.
   * Passing null restores the default singleton SMTP transporter.
   */
  public static setTransporter(transporter: Transporter | null): void {
    this.transporterOverride = transporter;
  }

  /**
   * Checks whether the necessary SMTP configuration parameters are present.
   */
  public static isConfigured(): boolean {
    return Boolean(env.SMTP_HOST && env.SMTP_HOST.trim().length > 0);
  }

  /**
   * Validates SMTP configuration parameters without leaking credential values.
   */
  public static validateConfig(config?: {
    SMTP_HOST?: string;
    SMTP_PORT?: number;
    SMTP_FROM?: string;
  }): void {
    const host = config?.SMTP_HOST ?? env.SMTP_HOST;
    const port = config?.SMTP_PORT ?? env.SMTP_PORT;
    const from = config?.SMTP_FROM ?? env.SMTP_FROM;

    if (!host || typeof host !== 'string' || host.trim().length === 0) {
      throw new Error('SMTP_HOST must be a non-empty string');
    }

    if (typeof port !== 'number' || isNaN(port) || port < 1 || port > 65535) {
      throw new Error('SMTP_PORT must be a valid port number between 1 and 65535');
    }

    if (!from || typeof from !== 'string' || from.trim().length === 0 || !from.includes('@')) {
      throw new Error('SMTP_FROM must be a valid email address');
    }
  }

  /**
   * Constructs the absolute password reset link using the frontend reset-password route and token query parameter.
   */
  public static buildResetUrl(rawToken: string, frontendUrl = env.FRONTEND_URL): string {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.trim().length === 0) {
      throw new Error('Reset token is required to construct password reset URL');
    }

    const normalizedBase = frontendUrl.trim().replace(/\/+$/, '');
    return `${normalizedBase}/reset-password?token=${encodeURIComponent(rawToken.trim())}`;
  }

  /**
   * Retrieves or creates the nodemailer SMTP transporter.
   */
  public static getTransporter(): Transporter {
    if (this.transporterOverride) {
      return this.transporterOverride;
    }

    if (!this.activeTransporter) {
      this.validateConfig();

      const authConfig =
        env.SMTP_USER && env.SMTP_PASS
          ? {
              user: env.SMTP_USER,
              pass: env.SMTP_PASS,
            }
          : undefined;

      this.activeTransporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: authConfig,
        connectionTimeout: 10000,
        greetingTimeout: 5000,
        socketTimeout: 15000,
      });
    }

    return this.activeTransporter;
  }

  /**
   * Sends a password reset email via SMTP with both HTML and plain-text versions.
   * Handles errors safely and logs only sanitized operational details (never credentials, tokens, or URLs).
   */
  public static async sendPasswordResetEmail(
    params: ISendPasswordResetParams
  ): Promise<SentMessageInfo> {
    const { to, resetUrl, expiresInMinutes = 15 } = params;

    if (!to || typeof to !== 'string' || !to.includes('@')) {
      throw new Error('Valid recipient email address is required');
    }

    if (!resetUrl || typeof resetUrl !== 'string') {
      throw new Error('Valid reset URL is required');
    }

    if (!this.isConfigured() && !this.transporterOverride) {
      logger.error('SMTP email delivery aborted: SMTP_HOST is not configured');
      throw new ServiceUnavailableError('Email delivery service is currently unavailable');
    }

    const plainText = [
      'Hello,',
      '',
      'We received a request to reset your password for your Enterprise AI Knowledge & Support Copilot account.',
      '',
      `Reset your password: ${resetUrl}`,
      '',
      `This link is single-use and will expire in ${expiresInMinutes} minutes.`,
      'If you did not request a password reset, you can safely ignore this email; your account remains secure.',
      '',
      '— Enterprise AI Support Team',
    ].join('\n');

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 40px auto; background-color: #1e293b; border-radius: 8px; border: 1px solid #334155; overflow: hidden; }
    .header { background: linear-gradient(135deg, #2563eb, #0284c7); padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 600; letter-spacing: -0.025em; }
    .content { padding: 32px 24px; line-height: 1.6; color: #cbd5e1; }
    .btn-container { text-align: center; margin: 32px 0; }
    .btn { display: inline-block; background-color: #2563eb; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 15px; }
    .warning { background-color: #334155; border-left: 4px solid #f59e0b; padding: 12px 16px; margin: 24px 0; border-radius: 4px; font-size: 13px; color: #e2e8f0; }
    .footer { padding: 20px 24px; font-size: 12px; color: #64748b; border-top: 1px solid #334155; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Enterprise AI Copilot</h1>
    </div>
    <div class="content">
      <p>Hello,</p>
      <p>We received a request to reset the password for your Enterprise AI Knowledge & Support Copilot account.</p>
      <div class="btn-container">
        <a href="${resetUrl}" class="btn" target="_blank" rel="noopener noreferrer">Reset Password</a>
      </div>
      <div class="warning">
        <strong>Security Notice:</strong> This link is single-use and expires in <strong>${expiresInMinutes} minutes</strong>. If you did not make this request, please disregard this email.
      </div>
      <p style="font-size: 12px; color: #94a3b8; word-break: break-all;">
        If the button above does not work, copy and paste this link into your browser:<br>
        <a href="${resetUrl}" style="color: #38bdf8;">${resetUrl}</a>
      </p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} Enterprise AI Copilot. Confidential & Proprietary.
    </div>
  </div>
</body>
</html>
    `.trim();

    const recipientDomain = to.includes('@') ? to.split('@')[1] : 'unknown';

    try {
      const transporter = this.getTransporter();
      const info = await transporter.sendMail({
        from: env.SMTP_FROM,
        to,
        subject: 'Reset Your Password — Enterprise AI Knowledge & Support Copilot',
        text: plainText,
        html,
      });

      logger.info('Password reset email dispatched successfully', {
        recipientDomain,
        messageId: info?.messageId,
      });

      return info;
    } catch (err: any) {
      logger.error('SMTP email dispatch error', {
        recipientDomain,
        errorCode: err?.code,
        command: err?.command,
        responseCode: err?.responseCode,
        message: err?.message,
      });
      throw err;
    }
  }
}

