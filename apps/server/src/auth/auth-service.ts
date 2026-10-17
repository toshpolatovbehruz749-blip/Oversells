import { Prisma, type PrismaClient, type User } from '@prisma/client';
import { AppError, badRequest, conflict } from '../errors.js';
import type { Mailer } from './mailer.js';
import {
  NO_PASSWORD,
  hashPassword,
  normalizeEmail,
  randomToken,
  sha256,
  validatePassword,
  verifyPassword,
} from './crypto.js';

export interface AuthOptions {
  appUrl: string;
  sessionTtlDays: number;
  passwordResetTtlMinutes: number;
  /** Lower-cased e-mails that get the admin role. */
  adminEmails?: string[];
}

export const accountBlocked = () => new AppError(403, 'account_blocked', 'This account has been blocked');

export type MailLanguage = 'uz' | 'ru' | 'en';

const RESET_MAIL: Record<MailLanguage, (link: string, minutes: number) => { subject: string; text: string }> = {
  uz: (link, minutes) => ({
    subject: 'Oversells: parolni tiklash',
    text:
      `Assalomu alaykum!\n\nOversells hisobingiz parolini tiklash uchun quyidagi havolani oching ` +
      `(havola ${minutes} daqiqa amal qiladi):\n\n${link}\n\n` +
      `Agar bu soʻrovni siz yubormagan boʻlsangiz, xatni eʼtiborsiz qoldiring.`,
  }),
  ru: (link, minutes) => ({
    subject: 'Oversells: восстановление пароля',
    text:
      `Здравствуйте!\n\nЧтобы задать новый пароль для Oversells, откройте ссылку ` +
      `(она действует ${minutes} мин.):\n\n${link}\n\nЕсли вы не запрашивали сброс, просто проигнорируйте это письмо.`,
  }),
  en: (link, minutes) => ({
    subject: 'Oversells: reset your password',
    text:
      `Hello!\n\nOpen this link to set a new Oversells password (valid for ${minutes} minutes):\n\n${link}\n\n` +
      `If you did not ask for this, you can ignore this e-mail.`,
  }),
};

export const unauthorized = () => new AppError(401, 'unauthorized', 'Please log in');

function normalizeName(name: unknown, email: string): string {
  const raw = typeof name === 'string' ? name.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  return (raw || email.split('@')[0]!).slice(0, 100);
}

/** Accounts, sessions and password resets. */
export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly mailer: Mailer,
    private readonly opts: AuthOptions,
  ) {}

  async register(input: { email: unknown; password: unknown; name?: unknown }): Promise<User> {
    const email = normalizeEmail(input.email);
    const password = validatePassword(input.password);
    const passwordHash = await hashPassword(password);
    try {
      return await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          name: normalizeName(input.name, email),
          role: this.opts.adminEmails?.includes(email) ? 'admin' : 'user',
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw conflict('email_taken', 'An account with this e-mail already exists');
      }
      throw err;
    }
  }

  /** Returns the user for valid credentials; the same error for unknown e-mail and wrong password. */
  async verifyCredentials(emailInput: unknown, password: unknown): Promise<User> {
    let email: string;
    try {
      email = normalizeEmail(emailInput);
    } catch {
      throw new AppError(401, 'invalid_credentials', 'Wrong e-mail or password');
    }
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = await verifyPassword(user?.passwordHash ?? null, typeof password === 'string' ? password : '');
    if (!user || !ok) throw new AppError(401, 'invalid_credentials', 'Wrong e-mail or password');
    // Only after the password matched, so blocking does not reveal accounts.
    if (user.blockedAt) throw accountBlocked();
    return user;
  }

  /** Creates a session and returns the cookie token (only its hash is stored). */
  async createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + this.opts.sessionTtlDays * 24 * 3600 * 1000);
    await this.prisma.session.create({ data: { id: sha256(token), userId, expiresAt } });
    return { token, expiresAt };
  }

  async userForSession(token: string | undefined): Promise<User | null> {
    if (!token || token.length > 200) return null;
    const session = await this.prisma.session.findUnique({ where: { id: sha256(token) }, include: { user: true } });
    if (!session) return null;
    if (session.expiresAt <= new Date()) {
      await this.prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return null;
    }
    // Blocking deletes sessions; this also covers a session created concurrently.
    if (session.user.blockedAt) return null;
    return session.user;
  }

  /** Gives the admin role to the configured e-mails (never takes it away). */
  async syncAdmins(): Promise<number> {
    const emails = this.opts.adminEmails ?? [];
    if (emails.length === 0) return 0;
    const res = await this.prisma.user.updateMany({ where: { email: { in: emails }, role: 'user' }, data: { role: 'admin' } });
    return res.count;
  }

  async destroySession(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.prisma.session.deleteMany({ where: { id: sha256(token) } });
  }

  /**
   * Sends a reset link if the account exists. Never reveals whether it does.
   * Returns the token only for tests/diagnostics.
   */
  async requestPasswordReset(emailInput: unknown, lang: MailLanguage = 'uz'): Promise<string | null> {
    let email: string;
    try {
      email = normalizeEmail(emailInput);
    } catch {
      return null;
    }
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return null;
    const token = randomToken();
    const minutes = this.opts.passwordResetTtlMinutes;
    await this.prisma.passwordResetToken.create({
      data: { id: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + minutes * 60_000) },
    });
    const link = `${this.opts.appUrl.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
    const mail = (RESET_MAIL[lang] ?? RESET_MAIL.uz)(link, minutes);
    await this.mailer.send({ to: user.email, ...mail });
    return token;
  }

  /** Sets a new password with a reset token; logs the user out everywhere. */
  async resetPassword(token: unknown, password: unknown): Promise<void> {
    const newPassword = validatePassword(password);
    const invalid = badRequest('invalid_reset_token', 'This reset link is invalid or has expired');
    if (typeof token !== 'string' || token.length > 200) throw invalid;
    const record = await this.prisma.passwordResetToken.findUnique({ where: { id: sha256(token) } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) throw invalid;
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.session.deleteMany({ where: { userId: record.userId } }),
    ]);
  }

  /**
   * Gives the account that owns pre-Phase-2 projects ("default-owner", created
   * by the migration without a password) an e-mail and password.
   * Does nothing when that account was already claimed or does not exist.
   */
  async claimDefaultOwner(emailInput: string, password: string): Promise<boolean> {
    const owner = await this.prisma.user.findUnique({ where: { id: 'default-owner' } });
    if (!owner || owner.passwordHash !== NO_PASSWORD) return false;
    const email = normalizeEmail(emailInput);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing && existing.id !== owner.id) {
      // The e-mail already has an account: move the projects there instead.
      await this.prisma.project.updateMany({ where: { ownerId: owner.id }, data: { ownerId: existing.id } });
      return true;
    }
    await this.prisma.user.update({
      where: { id: owner.id },
      data: { email, passwordHash: await hashPassword(validatePassword(password)) },
    });
    return true;
  }
}
