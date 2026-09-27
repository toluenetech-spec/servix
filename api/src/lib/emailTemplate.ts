/** Shared transactional email design. All caller-supplied text is escaped. */
export interface EmailContent {
  category: string;
  preheader: string;
  title: string;
  paragraphs: string[];
  details?: Array<[string, string]>;
  action?: { label: string; url: string };
  code?: string;
  note?: { title: string; text: string };
  status?: string;
}
export const escapeEmailHtml = (value: string) => value.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]!));

function safeUrl(value: string, allowLocal = false): string | null {
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol === 'https:' || (allowLocal && process.env.NODE_ENV !== 'production' &&
        url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return url.href;
  } catch { /* Invalid URL: do not emit it in an email. */ }
  return null;
}
export function emailAppLink(path: string, parameters?: Record<string, string>): string {
  const base = safeUrl(process.env.APP_BASE_URL ?? 'http://localhost:5173', true);
  if (!base || !path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid email application URL');
  const url = new URL(path, base);
  if (url.origin !== new URL(base).origin) throw new Error('Invalid email application path');
  if (parameters) url.search = new URLSearchParams(parameters).toString();
  return url.href;
}

export function renderEmail(content: EmailContent): { html: string; text: string } {
  const e = escapeEmailHtml;
  if (content.code && !/^\d{6}$/.test(content.code)) throw new Error('Invalid email code format');
  const actionUrl = content.action ? safeUrl(content.action.url, true) : null;
  if (content.action && !actionUrl) throw new Error('Invalid email action URL');
  const support = emailAppLink('/contact');
  const home = emailAppLink('/');
  const logo = safeUrl(process.env.EMAIL_LOGO_URL ?? emailAppLink('/brand/servix-email-logo.png'));
  const text = [
    'SERVIX', content.category, '', content.title, '', ...content.paragraphs.flatMap(p => [p, '']),
    ...(content.code ? [`Your code: ${content.code}`, 'Expires in 10 minutes. Use only once.', ''] : []),
    ...(content.details?.map(([label, value]) => `${label}: ${value}`) ?? []),
    ...(content.action ? ['', `${content.action.label}: ${actionUrl}`] : []),
    ...(content.note ? ['', `${content.note.title}: ${content.note.text}`] : []),
    '', `Need help? Contact Servix: ${support}`, 'Sent by Servix about your account or services.',
  ].join('\n');
  const paragraphs = content.paragraphs.map(p => `<p style="margin:0 0 18px;color:#4e6057;font:16px/1.75 Arial,Helvetica,sans-serif">${e(p)}</p>`).join('');
  const details = content.details?.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 24px;border:1px solid #e0e5df;border-radius:10px;background:#f6f8f4">${content.details.map(([label, value], i) => `<tr><td width="35%" valign="top" style="padding:14px 16px;font:13px/1.6 Arial,Helvetica,sans-serif;color:#617067;${i ? 'border-top:1px solid #e0e5df;' : ''}">${e(label)}</td><td valign="top" style="padding:14px 16px;font:600 14px/1.6 Arial,Helvetica,sans-serif;color:#12372a;overflow-wrap:anywhere;word-break:break-word;${i ? 'border-top:1px solid #e0e5df;' : ''}">${e(value)}</td></tr>`).join('')}</table>` : '';
  const code = content.code ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 26px;border:1px solid #d6e2d8;border-radius:12px;background:#edf4ee"><tr><td align="center" style="padding:24px 12px"><p style="margin:0 0 12px;font:700 10px/1.5 Arial,Helvetica,sans-serif;letter-spacing:2px;color:#466652">YOUR ONE-TIME CODE</p><p aria-label="Verification code" style="margin:0;font:700 34px/1.3 'Courier New',monospace;letter-spacing:6px;color:#12372a;white-space:nowrap">${e(content.code)}</p><p style="margin:14px 0 0;font:13px/1.5 Arial,Helvetica,sans-serif;color:#466652">Expires in 10 minutes · Use only once</p></td></tr></table>` : '';
  const action = content.action && actionUrl ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:4px 0 24px"><tr><td bgcolor="#12372a" style="border-radius:7px;text-align:center;mso-padding-alt:16px 24px"><a href="${e(actionUrl)}" style="display:inline-block;padding:16px 24px;border:1px solid #12372a;border-radius:7px;background:#12372a;color:#ffffff;font:700 14px/1.4 Arial,Helvetica,sans-serif;text-decoration:none">${e(content.action.label)} &nbsp; &rarr;</a></td></tr></table><p style="margin:0 0 24px;font:12px/1.7 Arial,Helvetica,sans-serif;color:#617067">If the button doesn’t work, copy this link into your browser:<br><a href="${e(actionUrl)}" style="color:#1f5c45;text-decoration:underline;overflow-wrap:anywhere;word-break:break-all">${e(actionUrl)}</a></p>` : '';
  const note = content.note ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:4px 0 0;background:#fbf6ef;border-left:3px solid #c48158"><tr><td style="padding:16px 18px"><p style="margin:0 0 5px;color:#694e36;font:700 13px/1.5 Arial,Helvetica,sans-serif">${e(content.note.title)}</p><p style="margin:0;color:#6b6256;font:13px/1.7 Arial,Helvetica,sans-serif">${e(content.note.text)}</p></td></tr></table>` : '';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${e(content.title)} — Servix</title>
<style>@media only screen and (max-width:600px){.email-outer{padding:20px 12px!important}.email-pad{padding-left:24px!important;padding-right:24px!important}.email-title{font-size:29px!important}.email-category{font-size:9px!important;letter-spacing:1px!important}}</style></head>
<body style="margin:0;padding:0;width:100%;background:#f3f0e8;-webkit-text-size-adjust:100%;color:#12372a">
<div style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all">${e(content.preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f3f0e8"><tr><td class="email-outer" align="center" style="padding:40px 16px">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e0e2d9;border-radius:14px">
<tr><td style="height:5px;line-height:5px;background:#12372a;border-radius:14px 14px 0 0">&nbsp;</td></tr>
<tr><td class="email-pad" style="padding:30px 40px 26px;border-bottom:1px solid #edf0e9"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td><a href="${e(home)}" style="color:#12372a;text-decoration:none">${logo ? `<img src="${e(logo)}" width="140" alt="SERVIX" style="display:block;width:140px;max-width:100%;height:auto;border:0;color:#12372a;font:700 22px Arial,sans-serif">` : '<span style="font:700 24px Arial,sans-serif;letter-spacing:3px">SERVIX</span>'}</a></td><td align="right" class="email-category" style="padding-left:12px;color:#6a786e;font:700 10px/1.5 Arial,Helvetica,sans-serif;letter-spacing:1.5px">${e(content.category.toUpperCase())}</td></tr></table></td></tr>
<tr><td class="email-pad" style="padding:36px 40px 36px">
<p style="margin:0 0 14px;color:#1f5c45;font:700 11px/1.5 Arial,Helvetica,sans-serif;letter-spacing:1.5px">${e((content.status ?? 'A NOTE FROM SERVIX').toUpperCase())}</p>
<h1 class="email-title" style="margin:0 0 20px;color:#12372a;font:400 34px/1.2 Georgia,'Times New Roman',serif;letter-spacing:-0.6px">${e(content.title)}</h1>
${paragraphs}${code}${details}${action}${note}
<p style="margin:28px 0 0;color:#617067;font:14px/1.7 Arial,Helvetica,sans-serif">Here to help,<br><strong style="color:#12372a">The Servix team</strong></p>
</td></tr>
<tr><td class="email-pad" style="padding:22px 40px;background:#f8faf6;border-top:1px solid #e8ece4;border-radius:0 0 14px 14px"><p style="margin:0;color:#617067;font:13px/1.7 Arial,Helvetica,sans-serif">Questions? <a href="${e(support)}" style="color:#1f5c45;font-weight:bold;text-decoration:underline">Contact Servix support</a></p></td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
<p style="max-width:560px;margin:22px 12px 0;color:#727c71;font:12px/1.8 Arial,Helvetica,sans-serif;text-align:center">Professional services. One trusted place.<br>Sent by Servix about your account or services.<br>&copy; ${new Date().getUTCFullYear()} Servix</p>
</td></tr></table></body></html>`;
  return { html, text };
}
