/**
 * Dependency-free SVG charts for workspace analytics. Every chart renders
 * only the series it is given — there are no placeholder or sample values.
 * Each chart includes a visually hidden table so screen readers get the data.
 */
import './charts.css';
const fmt = (n, money) => money ? new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(n) : new Intl.NumberFormat('en-NG').format(n);
const shortDate = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function LineChart({ data, x = 'date', y, label, money = false, color = '#2f6b4f', height = 180 }) {
  const values = data.map(d => Number(d[y]) || 0); const max = Math.max(1, ...values); const w = 600, h = height, pad = 10;
  const step = data.length > 1 ? (w - pad * 2) / (data.length - 1) : 0;
  const pts = values.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)]);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = pts.length ? `${path} L${pts[pts.length - 1][0].toFixed(1)},${h - pad} L${pad},${h - pad} Z` : '';
  const total = values.reduce((s, v) => s + v, 0);
  return <figure className="chart">
    <figcaption><strong>{label}</strong><span>{fmt(total, money)} in period · peak {fmt(max === 1 && !values.some(v => v >= 1) ? 0 : max, money)}</span></figcaption>
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label} over time`} preserveAspectRatio="none">
      {[0.25, 0.5, 0.75].map(f => <line key={f} x1={pad} x2={w - pad} y1={h - pad - f * (h - pad * 2)} y2={h - pad - f * (h - pad * 2)} className="chart-grid" />)}
      {area && <path d={area} fill={color} opacity=".12" />}
      {path && <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
      {pts.map((p, i) => values[i] > 0 && <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={color} />)}
    </svg>
    <div className="chart-axis"><span>{data.length ? shortDate(data[0][x]) : ''}</span><span>{data.length ? shortDate(data[data.length - 1][x]) : ''}</span></div>
    <DataTable data={data} x={x} y={y} label={label} money={money} />
  </figure>;
}

export function BarChart({ data, x = 'date', y, label, money = false, color = '#a06f42', height = 180 }) {
  const values = data.map(d => Number(d[y]) || 0); const max = Math.max(1, ...values); const w = 600, h = height, pad = 10;
  const bw = data.length ? (w - pad * 2) / data.length : 0;
  return <figure className="chart">
    <figcaption><strong>{label}</strong><span>{fmt(values.reduce((s, v) => s + v, 0), money)} in period</span></figcaption>
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label} by period`} preserveAspectRatio="none">
      {[0.5].map(f => <line key={f} x1={pad} x2={w - pad} y1={h - pad - f * (h - pad * 2)} y2={h - pad - f * (h - pad * 2)} className="chart-grid" />)}
      {values.map((v, i) => { const bh = (v / max) * (h - pad * 2); return <rect key={i} x={pad + i * bw + bw * 0.15} y={h - pad - bh} width={Math.max(1, bw * 0.7)} height={bh} rx="2" fill={color} opacity={v ? 1 : 0.15}><title>{`${data[i][x]}: ${fmt(v, money)}`}</title></rect>; })}
    </svg>
    <div className="chart-axis"><span>{data.length ? shortDate(data[0][x]) : ''}</span><span>{data.length ? shortDate(data[data.length - 1][x]) : ''}</span></div>
    <DataTable data={data} x={x} y={y} label={label} money={money} />
  </figure>;
}

export function Donut({ segments, label, size = 150 }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0); const r = 40, c = 2 * Math.PI * r; let offset = 0;
  const palette = ['#2f6b4f', '#a06f42', '#6f8f5f', '#c9a227', '#4f6d7a', '#9a5b4a', '#7d8976', '#b7c4ad'];
  return <figure className="chart chart-donut">
    <figcaption><strong>{label}</strong><span>{total ? `${fmt(total)} total` : 'No records yet'}</span></figcaption>
    <div className="chart-donut-body">
      <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={label}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="#edf0e8" strokeWidth="14" />
        {total > 0 && segments.map((seg, i) => { const len = (seg.value / total) * c; const el = <circle key={seg.label} cx="50" cy="50" r={r} fill="none" stroke={palette[i % palette.length]} strokeWidth="14" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 50 50)"><title>{`${seg.label}: ${seg.value}`}</title></circle>; offset += len; return el; })}
        <text x="50" y="54" textAnchor="middle" className="chart-donut-total">{total}</text>
      </svg>
      <ul className="chart-legend">{segments.map((seg, i) => <li key={seg.label}><i style={{ background: palette[i % palette.length] }} />{seg.label}<b>{seg.value}</b></li>)}</ul>
    </div>
  </figure>;
}

export function HBars({ items, label, money = false, valueKey = 'value', nameKey = 'label' }) {
  const max = Math.max(1, ...items.map(i => Number(i[valueKey]) || 0));
  return <figure className="chart">
    <figcaption><strong>{label}</strong>{!items.length && <span>No records yet</span>}</figcaption>
    <ol className="chart-hbars">{items.map(item => <li key={item[nameKey]}><span>{item[nameKey]}</span><div><i style={{ width: `${(Number(item[valueKey]) / max) * 100}%` }} /></div><b>{fmt(Number(item[valueKey]) || 0, money)}</b></li>)}</ol>
  </figure>;
}

function DataTable({ data, x, y, label, money }) {
  return <table className="sr-only"><caption>{label}</caption><thead><tr><th>Period</th><th>Value</th></tr></thead><tbody>{data.map(d => <tr key={d[x]}><td>{d[x]}</td><td>{fmt(Number(d[y]) || 0, money)}</td></tr>)}</tbody></table>;
}
