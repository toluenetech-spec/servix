// Produce complete SPA HTML per fixed route; crawlers need not execute React.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { PUBLIC_ROUTES, SITE_ORIGIN, DEFAULT_DESCRIPTION } from '../src/content/social.js';
import { LEGAL_CONTENT } from '../src/content/legal.js';
const base = await readFile('dist/index.html', 'utf8');
const escape = s => s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
await mkdir('dist/meta', { recursive: true });
for (const [path, label] of Object.entries(PUBLIC_ROUTES)) {
  if (path === '/') continue;
  const title = escape(`${label} — Servix`);
  const description = escape(LEGAL_CONTENT[path.slice(1)]?.description || DEFAULT_DESCRIPTION);
  let html = base.replace(/<title>.*?<\/title>/s, `<title>${title}</title>`);
  for (const tag of ['og:title', 'twitter:title']) html = html.replace(new RegExp(`(<meta (?:property|name)="${tag}" content=")[^"]*("[^>]*>)`), `$1${title}$2`);
  for (const tag of ['description', 'og:description', 'twitter:description']) html = html.replace(new RegExp(`(<meta\\s+(?:property|name)="${tag}"\\s+content=")[^"]*("[^>]*>)`), `$1${description}$2`);
  html = html.replace('rel="canonical" href="https://www.servix.name.ng/"', `rel="canonical" href="${SITE_ORIGIN}${path}"`).replace('property="og:url" content="https://www.servix.name.ng/"', `property="og:url" content="${SITE_ORIGIN}${path}"`);
  await writeFile(`dist/meta/${path.slice(1).replaceAll('/', '-')}.html`, html);
}
console.log('Crawler-readable social metadata built for all fixed public routes; all other routes retain branded fallback metadata.');
