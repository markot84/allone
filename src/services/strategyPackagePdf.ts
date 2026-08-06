import type { SharedPackageData } from './strategyPackageShare';
import { escapeHtml } from '../utils/escapeHtml';

function weightBar(label: string, value: number): string {
  const barWidth = Math.round(value * 2.5);
  return `
    <div style="display:flex;align-items:center;gap:10px;margin:4px 0">
      <span style="width:90px;font-size:12px;color:var(--text-secondary)">${escapeHtml(label)}</span>
      <div style="flex:1;height:6px;background:var(--surface-2);border-radius:3px;overflow:hidden">
        <div style="width:${barWidth}%;height:100%;background:#F97316;border-radius:3px"></div>
      </div>
      <span style="font-size:12px;font-weight:600;color:var(--text-primary);width:36px;text-align:right">${value}%</span>
    </div>`;
}

export function generatePackageHtml(data: SharedPackageData): string {
  const date = new Date().toLocaleDateString('el-GR', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  const weightsHtml = Object.entries(data.weights)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => weightBar(k.charAt(0).toUpperCase() + k.slice(1), v))
    .join('');

  const primaryHtml = data.primaryChannels.map((ch, i) => {
    const pct = Object.entries(data.budgetAllocation)
      .find(([k]) => ch.toLowerCase().includes(k) || k.includes(ch.toLowerCase().split(' ')[0]));
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--surface-1);border-radius:8px;margin:4px 0">
      <span style="font-size:13px;color:var(--text-primary)"><strong>${i + 1}.</strong> ${escapeHtml(ch)}</span>
      ${pct ? `<span style="font-size:11px;font-weight:600;color:#F97316">${pct[1]}%</span>` : ''}
    </div>`;
  }).join('');

  const secondaryHtml = data.secondaryChannels.map((ch, i) => {
    const pct = Object.entries(data.budgetAllocation)
      .find(([k]) => ch.toLowerCase().includes(k) || k.includes(ch.toLowerCase().split(' ')[0]));
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px;margin:3px 0">
      <span style="font-size:12px;color:var(--text-secondary)">${data.primaryChannels.length + i + 1}. ${escapeHtml(ch)}</span>
      ${pct ? `<span style="font-size:11px;color:var(--text-muted)">${pct[1]}%</span>` : ''}
    </div>`;
  }).join('');

  // Escape FIRST, then apply the structural `||`→paragraph transform: escaping after would
  // neutralize our injected <p> tags; markers (`||`, `—`, `•`) contain no escaped characters.
  const rationaleHtml = data.rationale
    ? escapeHtml(data.rationale)
        .replace(/\|\|/g, '</p><p style="margin:8px 0;font-size:13px;color:var(--text-secondary);line-height:1.6">')
        .replace(/—/g, ',')
        .replace(/•\s*/g, '<br>· ')
    : '';

  return `<!DOCTYPE html>
<html lang="el">
<head>
<meta charset="UTF-8">
<title>Strategy Package${data.brandName ? ` — ${escapeHtml(data.brandName)}` : ''}</title>
<style>
  @media print {
    body { margin: 0; }
    .no-print { display: none !important; }
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: var(--text-primary);
    max-width: 700px;
    margin: 0 auto;
    padding: 40px 32px;
    background: #fff;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #F97316;
    padding-bottom: 16px;
    margin-bottom: 28px;
  }
  .brand-name { font-size: 22px; font-weight: 700; color: var(--text-primary); }
  .date { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
  .logo { font-size: 28px; font-weight: 800; color: #F97316; }
  .section { margin-bottom: 24px; }
  .section-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--text-muted);
    margin-bottom: 10px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--surface-2);
  }
  .meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 24px;
  }
  .meta-card {
    padding: 14px;
    background: var(--surface-1);
    border-radius: 10px;
  }
  .meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); font-weight: 600; }
  .meta-value { font-size: 15px; font-weight: 600; color: var(--text-primary); margin-top: 4px; }
  .segment-pill {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 12px;
    margin: 2px 4px 2px 0;
  }
  .ideal { background: #F0FDF4; color: #15803D; border: 1px solid #BBF7D0; }
  .good { background: var(--surface-2); color: var(--text-secondary); border: 1px dashed var(--border-strong); }
  .footer {
    margin-top: 32px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .footer-text { font-size: 11px; color: var(--text-muted); }
  .footer-brand { font-size: 14px; font-weight: 700; color: #F97316; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand-name">${data.brandName ? escapeHtml(data.brandName) : 'Strategy Package'}</div>
      <div class="date">${date}</div>
    </div>
    <div class="logo">≠</div>
  </div>

  <div class="meta-grid">
    <div class="meta-card">
      <div class="meta-label">Στρατηγική</div>
      <div class="meta-value">${escapeHtml(data.strategyName)}</div>
    </div>
    <div class="meta-card">
      <div class="meta-label">Διάρκεια</div>
      <div class="meta-value">${escapeHtml(data.duration)}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Segments</div>
    <div>
      ${data.idealSegments.map(s => `<span class="segment-pill ideal">${escapeHtml(s)}</span>`).join('')}
      ${data.goodSegments.map(s => `<span class="segment-pill good">${escapeHtml(s)}</span>`).join('')}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Βάρη προτεραιοτήτων</div>
    ${weightsHtml}
  </div>

  <div class="section">
    <div class="section-title">Primary channels</div>
    ${primaryHtml}
  </div>

  ${data.secondaryChannels.length > 0 ? `
  <div class="section">
    <div class="section-title">Secondary channels</div>
    ${secondaryHtml}
  </div>` : ''}

  ${rationaleHtml ? `
  <div class="section">
    <div class="section-title">AI Analysis</div>
    <p style="margin:8px 0;font-size:13px;color:var(--text-secondary);line-height:1.6">${rationaleHtml}</p>
  </div>` : ''}

  <div class="footer">
    <div class="footer-text">Δημιουργήθηκε από allone | notthesame.ai</div>
    <div class="footer-brand">≠</div>
  </div>
</body>
</html>`;
}

export function openPackagePdf(data: SharedPackageData) {
  const html = generatePackageHtml(data);
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
    // Print from the opener (not an inline <script>) so it survives CSP script-src 'unsafe-inline'.
    // onload is flaky on about:blank, so fall back to a timer; a guard prevents a double dialog.
    let printed = false;
    const doPrint = () => {
      if (printed) return;
      printed = true;
      try { win.focus(); win.print(); } catch { /* window closed by user */ }
    };
    win.onload = doPrint;
    setTimeout(doPrint, 300);
  }
}
