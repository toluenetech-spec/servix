/* Voice notes with MediaRecorder. Picks the first container the browser can record (Chrome/Firefox: webm/opus,
 * Safari: mp4/aac). Returns a File + duration; nothing is uploaded here. */
import { useCallback, useEffect, useRef, useState } from 'react';

const CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mpeg'];
const EXT = { 'audio/webm': 'weba', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3' };
export const MAX_VOICE_MS = 5 * 60 * 1000;

export const voiceSupported = () => typeof window !== 'undefined' && typeof window.MediaRecorder === 'function' && Boolean(navigator.mediaDevices?.getUserMedia);

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const rec = useRef(null); const chunks = useRef([]); const started = useRef(0); const timer = useRef(null); const stream = useRef(null);
  const analyser = useRef(null); const raf = useRef(null); const resolver = useRef(null);

  const cleanup = useCallback(() => {
    clearInterval(timer.current); cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    analyser.current?.ctx?.close?.().catch(() => {}); analyser.current = null;
    rec.current = null; setRecording(false); setLevel(0);
  }, []);
  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    setError('');
    if (!voiceSupported()) { setError('Voice notes are not supported in this browser.'); return false; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = s;
      const mime = CANDIDATES.find((c) => window.MediaRecorder.isTypeSupported?.(c)) || '';
      const r = new window.MediaRecorder(s, mime ? { mimeType: mime, audioBitsPerSecond: 48_000 } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.current.push(e.data); };
      r.onstop = () => {
        const type = (r.mimeType || mime || 'audio/webm').split(';')[0];
        const blob = new Blob(chunks.current, { type });
        const durationMs = Math.min(Date.now() - started.current, MAX_VOICE_MS);
        const file = new File([blob], `voice-note.${EXT[type] || 'weba'}`, { type });
        const done = resolver.current; resolver.current = null;
        cleanup();
        done?.({ file, durationMs });
      };
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx(); const src = ctx.createMediaStreamSource(s); const an = ctx.createAnalyser(); an.fftSize = 256; src.connect(an);
          analyser.current = { ctx, an, data: new Uint8Array(an.frequencyBinCount) };
          const tick = () => { const a = analyser.current; if (!a) return; a.an.getByteTimeDomainData(a.data); let sum = 0; for (let i = 0; i < a.data.length; i++) { const v = (a.data[i] - 128) / 128; sum += v * v; } setLevel(Math.min(1, Math.sqrt(sum / a.data.length) * 3)); raf.current = requestAnimationFrame(tick); };
          raf.current = requestAnimationFrame(tick);
        }
      } catch { /* level meter is optional */ }
      rec.current = r; started.current = Date.now(); setElapsed(0); setRecording(true);
      r.start(250);
      timer.current = setInterval(() => { const ms = Date.now() - started.current; setElapsed(ms); if (ms >= MAX_VOICE_MS && rec.current?.state === 'recording') rec.current.stop(); }, 200);
      return true;
    } catch (e) {
      cleanup();
      setError(e?.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow the microphone in your browser settings and try again.' : 'Could not start recording.');
      return false;
    }
  }, [cleanup]);

  /** Stops and resolves { file, durationMs } (or null when too short). */
  const stop = useCallback(() => new Promise((resolve) => {
    const r = rec.current;
    if (!r || r.state === 'inactive') { cleanup(); resolve(null); return; }
    if (Date.now() - started.current < 700) { resolver.current = () => resolve(null); r.stop(); return; }
    resolver.current = resolve; r.stop();
  }), [cleanup]);

  const cancel = useCallback(() => { const r = rec.current; resolver.current = () => {}; if (r && r.state !== 'inactive') r.stop(); else cleanup(); }, [cleanup]);

  return { recording, elapsed, level, error, start, stop, cancel, supported: voiceSupported() };
}
