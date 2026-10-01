import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parsePreference, PREFERENCE_VERSION, MAX_AGE_MS, sanitizeMeasurement } from '../src/lib/cookiePreferences.js';
import { safeCanonical, PUBLIC_ROUTES, SOCIAL_IMAGE } from '../src/content/social.js';
import { LEGAL_CONTENT } from '../src/content/legal.js';
test('consent fails closed for missing, malformed, expired, future and old-version records', () => {
  const now = Date.now();
  for (const raw of [null, '{}', 'invalid', JSON.stringify({version:'old', optional:true, savedAt:now}), JSON.stringify({version:PREFERENCE_VERSION, optional:true, savedAt:now-MAX_AGE_MS}), JSON.stringify({version:PREFERENCE_VERSION, optional:true, savedAt:now+1})]) assert.equal(parsePreference(raw,now),null);
  assert.equal(parsePreference(JSON.stringify({version:PREFERENCE_VERSION,optional:false,savedAt:now}),now).optional,false);
});
test('measurement drops private and unknown routes and strips all query/fragment data', () => {
  for (const p of ['/dashboard', '/reset-password?token=secret','/bookings/private','/admin','/security-check','/login','/services/private']) assert.equal(sanitizeMeasurement({url:'https://www.servix.name.ng'+p}),null);
  assert.equal(sanitizeMeasurement({url:'https://www.servix.name.ng/services?email=private#secret'}).url,'https://www.servix.name.ng/services');
});
test('canonical links never contain private IDs or tokens', () => {
  assert.equal(safeCanonical('/register?token=secret'),'https://www.servix.name.ng/register');
  assert.equal(safeCanonical('/bookings/private'),'https://www.servix.name.ng/');
});
test('all policies identify the operator without placeholder claims', () => {
  for (const content of Object.values(LEGAL_CONTENT)) {
    const text=JSON.stringify(content); assert.match(text,/Toluwalase O. Samuel/); assert.match(text,/toluenetech@gmail.com/);
    assert.doesNotMatch(text,/placeholder|does not create accounts/i);
  }
});
test('built HTML has image and card metadata even without JavaScript', async () => {
  for (const path of Object.keys(PUBLIC_ROUTES)) {
    const html=await readFile(path==='/'?'dist/index.html':`dist/meta/${path.slice(1).replaceAll('/','-')}.html`,'utf8');
    assert.ok(html.includes(`property="og:image" content="${SOCIAL_IMAGE}"`));
    assert.match(html,/name="twitter:card" content="summary_large_image"/);
    assert.ok(html.includes(`rel="canonical" href="${safeCanonical(path)}"`));
  }
  const png=await readFile('public/brand/servix-social.png');assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),630);
});
