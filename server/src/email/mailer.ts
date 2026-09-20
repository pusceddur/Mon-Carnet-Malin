// §20 e-mails through the SMTP server of the host: password reset and confirmation of use every 180 days.
import nodemailer from 'nodemailer';
import type { MailConfig } from '../config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  /** False when SMTP is not configured: nothing is sent. */
  readonly enabled: boolean;
  /** Address of the app used in the links (no trailing slash). */
  readonly publicUrl: string | null;
  send(message: MailMessage): Promise<void>;
}

export const disabledMailer: Mailer = {
  enabled: false,
  publicUrl: null,
  send: () => Promise.reject(new Error('mail_not_configured')),
};

export function createMailer(config: MailConfig | null): Mailer {
  if (!config) return disabledMailer;
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user && config.password ? { user: config.user, pass: config.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return {
    enabled: true,
    publicUrl: config.publicUrl,
    send: async (message) => {
      await transport.sendMail({ from: config.from, to: message.to, subject: message.subject, text: message.text, html: message.html });
    },
  };
}

const mailers = new WeakMap<object, Mailer>();

/** The mailer of the app: the injected one (tests), else one built once from `config.mail`. */
export function mailerFor(deps: { mailer?: Mailer; config: { mail: MailConfig | null } }): Mailer {
  if (deps.mailer) return deps.mailer;
  let mailer = mailers.get(deps);
  if (!mailer) {
    mailer = createMailer(deps.config.mail);
    mailers.set(deps, mailer);
  }
  return mailer;
}

/** Test mailer: keeps the messages instead of sending them. */
export function createMemoryMailer(publicUrl = 'https://app.example.fr'): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    enabled: true,
    publicUrl,
    sent,
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
}
