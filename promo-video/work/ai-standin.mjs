/**
 * Local stand-in for the AI provider, used ONLY to film the Servix AI chat in the sandbox
 * (the sandbox has no route to the real inference provider). It speaks the OpenAI chat
 * completions protocol the Servix router already uses, calls the REAL Servix tool
 * (`search_professionals`) through the router, and composes its reply strictly from the
 * tool's real result — names, titles, cities, ratings and prices come from the catalogue.
 * Never deployed; not part of the application.
 */
import http from 'node:http';

const PORT = 8099;
const naira = (n) => `₦${Number(n).toLocaleString('en-NG')}`;

function compose(messages) {
  const toolMsg = [...messages].reverse().find((m) => m.role === 'tool');
  if (!toolMsg) return null;
  const raw = String(toolMsg.content ?? ''); const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  let data; try { data = JSON.parse(raw.slice(start, end + 1)); } catch { data = null; }
  const items = (data?.items ?? []).filter((p) => /brand|graphic|ui/i.test(p.title)).slice(0, 2);
  if (!items.length) return 'I could not find a matching professional right now. Try widening the location or category.';
  const lines = items.map((p) => `- **${p.name}** — ${p.title}, ${p.city ?? 'Nigeria'}. ${p.verified ? 'Verified. ' : ''}${p.rating ? `${p.rating}★ (${p.reviews} reviews). ` : ''}From ${naira(p.fromPrice)}.`);
  const allVerified = items.every((p) => p.verified);
  return `Two designers on Servix fit a bakery logo:\n\n${lines.join('\n')}\n\n${allVerified ? 'Both are identity-verified and take remote briefs. ' : ''}Open a profile to see their gigs, or tell me your budget and I will narrow it down.`;
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ id: 'standin' }] }));
  }
  if (req.method !== 'POST') { res.writeHead(404); return res.end(); }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const payload = JSON.parse(body || '{}');
    const messages = payload.messages ?? [];
    const answer = compose(messages);
    const wantsStream = payload.stream === true;
    const id = 'chatcmpl-standin';
    if (!answer) {
      const toolCall = { id: 'call_1', type: 'function', function: { name: 'search_professionals', arguments: JSON.stringify({ q: 'designer', sort: 'rating' }) } };
      if (wantsStream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, ...toolCall }] }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 120, completion_tokens: 20 } })}\n\n`);
        res.write('data: [DONE]\n\n'); return res.end();
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id, choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [toolCall] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 120, completion_tokens: 20 } }));
    }
    if (wantsStream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const words = answer.split(/(?<=\s)/);
      let i = 0;
      const tick = () => {
        if (i >= words.length) {
          res.write(`data: ${JSON.stringify({ id, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 400, completion_tokens: 90 } })}\n\n`);
          res.write('data: [DONE]\n\n'); return res.end();
        }
        res.write(`data: ${JSON.stringify({ id, choices: [{ index: 0, delta: { content: words[i++] }, finish_reason: null }] })}\n\n`);
        setTimeout(tick, 45);
      };
      tick();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id, choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }], usage: { prompt_tokens: 400, completion_tokens: 90 } }));
  });
});
server.listen(PORT, '127.0.0.1', () => console.log('AI stand-in listening on', PORT));
