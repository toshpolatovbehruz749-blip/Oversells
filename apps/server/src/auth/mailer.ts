import nodemailer, { type Transporter } from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Development mailer: writes e-mails to the server log instead of sending them. */
export class LogMailer implements Mailer {
  constructor(private readonly log: Pick<FastifyBaseLogger, 'info'>) {}

  async send(message: MailMessage): Promise<void> {
    this.log.info({ mail: message }, `E-mail (not sent, SMTP_HOST is not set) to ${message.to}: ${message.subject}\n${message.text}`);
  }
}

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(private readonly opts: SmtpOptions) {
    this.transport = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      auth: opts.user ? { user: opts.user, pass: opts.pass ?? '' } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.opts.from, ...message });
  }
}
