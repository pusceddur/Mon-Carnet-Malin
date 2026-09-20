// §20 French e-mails (plain text + simple HTML). Links are single-use and expire.
import type { MailMessage } from './mailer';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function html(paragraphs: readonly string[], link: string, button: string): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join('');
  return `<!doctype html><html lang="fr"><body style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#1f2937">`
    + `${body}<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:#1d4ed8;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none">${escapeHtml(button)}</a></p>`
    + `<p style="margin:0;color:#6b7280;font-size:13px">${escapeHtml(link)}</p></body></html>`;
}

export function passwordResetEmail(to: string, displayName: string, link: string): MailMessage {
  const paragraphs = [
    `Bonjour ${displayName},`,
    'Quelqu’un a demandé un nouveau mot de passe pour votre compte Mon Carnet Malin.',
    'Ouvrez le lien ci-dessous (valable 30 minutes). Il vous demandera le code des réglages de votre compte, puis le nouveau mot de passe.',
    'Si vous n’avez rien demandé, ignorez ce message : votre mot de passe ne change pas.',
  ];
  return {
    to,
    subject: 'Mon Carnet Malin : nouveau mot de passe',
    text: `${paragraphs.join('\n\n')}\n\n${link}\n`,
    html: html(paragraphs, link, 'Choisir un nouveau mot de passe'),
  };
}

export function continuityEmail(to: string, displayName: string, link: string, deadline: string): MailMessage {
  const paragraphs = [
    `Bonjour ${displayName},`,
    'Pour la sécurité de votre compte Mon Carnet Malin, nous vous demandons tous les 180 jours de confirmer que vous l’utilisez toujours.',
    `Ouvrez le lien ci-dessous avant le ${deadline}. Sans confirmation, tous les appareils seront déconnectés : il faudra se reconnecter avec l’e-mail et le mot de passe.`,
  ];
  return {
    to,
    subject: 'Mon Carnet Malin : confirmez que vous utilisez toujours l’app',
    text: `${paragraphs.join('\n\n')}\n\n${link}\n`,
    html: html(paragraphs, link, 'Je confirme'),
  };
}
