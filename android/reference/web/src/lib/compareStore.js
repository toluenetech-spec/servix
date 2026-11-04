/** Compare tray: up to 4 professional slugs kept in localStorage; shared across pages via a tiny event bus. */
import { useEffect, useState } from 'react';
export const COMPARE_MAX = 4;
const KEY = 'servix.compare';
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((s) => typeof s === 'string').slice(0, COMPARE_MAX) : []; } catch { return []; } };
const write = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode */ } window.dispatchEvent(new Event('servix:compare')); };
export const compareList = read;
export function toggleCompare(slug) { const list = read(); if (list.includes(slug)) { write(list.filter((s) => s !== slug)); return { added: false }; } if (list.length >= COMPARE_MAX) return { added: false, full: true }; write([...list, slug]); return { added: true }; }
export function removeCompare(slug) { write(read().filter((s) => s !== slug)); }
export function clearCompare() { write([]); }
export function useCompare() {
  const [list, setList] = useState(read);
  useEffect(() => { const sync = () => setList(read()); window.addEventListener('servix:compare', sync); window.addEventListener('storage', sync); return () => { window.removeEventListener('servix:compare', sync); window.removeEventListener('storage', sync); }; }, []);
  return list;
}
