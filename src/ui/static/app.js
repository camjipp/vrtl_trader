const els = {
  dataStatus: byId("dataStatus"),
  refreshBtn: byId("refreshBtn"),
  cash: byId("cash"),
  cashHint: byId("cashHint"),
  exposure: byId("exposure"),
  positionsHint: byId("positionsHint"),
  locked: byId("locked"),
  markPnl: byId("markPnl"),
  opps: byId("opps"),
  enteredHint: byId("enteredHint"),
  scanTimestamp: byId("scanTimestamp"),
  fetched: byId("fetched"),
  normalized: byId("normalized"),
  families: byId("families"),
  books: byId("books"),
  bookBar: byId("bookBar"),
  scanNote: byId("scanNote"),
  reportTimestamp: byId("reportTimestamp"),
  totalEntries: byId("totalEntries"),
  totalExits: byId("totalExits"),
  avgEdge: byId("avgEdge"),
  realized: byId("realized"),
  positionCount: byId("positionCount"),
  positionsBody: byId("positionsBody"),
  entryCount: byId("entryCount"),
  entriesBody: byId("entriesBody"),
  familyCount: byId("familyCount"),
  familiesBody: byId("familiesBody")
};

els.refreshBtn.addEventListener("click", () => {
  void load();
});

void load();

async function load() {
  setStatus("Refreshing");
  try {
    const [dashboard, report] = await Promise.all([getJson("/api/dashboard"), getJson("/api/arb-report")]);
    renderDashboard(dashboard);
    renderReport(report);
    setStatus(`Updated ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    console.error(err);
    setStatus("Data unavailable");
  }
}

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return await res.json();
}

function renderDashboard(dashboard) {
  const arb = dashboard?.paperArb ?? {};
  els.cash.textContent = usd(arb.bankrollCashUsd);
  els.exposure.textContent = usd(arb.exposureUsd);
  els.locked.textContent = usd(arb.lockedProfitUsd);
  els.markPnl.textContent = usd(arb.markToBidPnlUsd);
  colorPnL(els.locked, arb.lockedProfitUsd);
  colorPnL(els.markPnl, arb.markToBidPnlUsd);
  els.opps.textContent = int(arb.opportunities);
  els.enteredHint.textContent = `${int(arb.entered)} entered this scan`;
  els.positionsHint.textContent = `${int(arb.openPositionsCount)} open positions`;

  const scan = dashboard?.scan ?? {};
  els.scanTimestamp.textContent = dashboard?.timestamp ? formatTime(dashboard.timestamp) : "No scan yet";
  els.fetched.textContent = int(scan.fetched);
  els.normalized.textContent = int(scan.normalized);
  els.families.textContent = int(scan.families);
  els.books.textContent = `${int(arb.completeBooks)} / ${int(arb.scannedMarkets)}`;
  const bookPct = pct(arb.completeBooks, arb.scannedMarkets);
  els.bookBar.style.width = `${bookPct}%`;
  els.scanNote.textContent = scan.stopReason
    ? `Stop reason: ${scan.stopReason}. Limits: ${limitsText(scan.limits)}.`
    : "Run a scan to populate the dashboard.";

  const positions = Array.isArray(arb.openPositionsSummary) ? arb.openPositionsSummary : [];
  els.positionCount.textContent = `${positions.length} rows`;
  renderRows(
    els.positionsBody,
    positions,
    (p) => `
      <td>${escapeHtml(p.title ?? p.marketId ?? "")}</td>
      <td>${num(p.shares, 2)}</td>
      <td>${usd(p.costUsd)}</td>
      <td class="${classForNumber(p.lockedProfitUsd)}">${usd(p.lockedProfitUsd)}</td>
      <td class="${classForNumber(p.lastMarkPnlUsd)}">${usd(p.lastMarkPnlUsd)}</td>
    `,
    5
  );

  const families = Array.isArray(dashboard?.topFamilies) ? dashboard.topFamilies.slice(0, 10) : [];
  els.familyCount.textContent = `${families.length} rows`;
  renderRows(
    els.familiesBody,
    families,
    (f) => `
      <td><span class="type-pill">${escapeHtml(f.family_type ?? "")}</span></td>
      <td>${num(f.opportunity_score, 3)}</td>
      <td>${escapeHtml(f.title ?? "")}</td>
    `,
    3
  );
}

function renderReport(report) {
  const totals = report?.totals ?? {};
  els.reportTimestamp.textContent = report?.generatedAt ? formatTime(report.generatedAt) : "No report";
  els.totalEntries.textContent = int(totals.entries);
  els.totalExits.textContent = int(totals.exits);
  els.avgEdge.textContent = totals.avgEdge == null ? "n/a" : `${num(totals.avgEdge * 100, 2)}%`;
  els.realized.textContent = usd(totals.realizedPnlUsd);
  colorPnL(els.realized, totals.realizedPnlUsd);

  const entries = Array.isArray(report?.recentEntries) ? report.recentEntries : [];
  els.entryCount.textContent = `${entries.length} rows`;
  renderRows(
    els.entriesBody,
    entries,
    (e) => `
      <td>${escapeHtml(formatTime(e.ts))}</td>
      <td>${escapeHtml(e.marketId ?? "")}</td>
      <td>${usd(e.costUsd)}</td>
      <td class="${classForNumber(e.lockedProfitUsd)}">${usd(e.lockedProfitUsd)}</td>
      <td>${e.edge == null ? "n/a" : `${num(e.edge * 100, 2)}%`}</td>
    `,
    5
  );
}

function renderRows(tbody, rows, render, colspan) {
  if (!rows.length) {
    tbody.innerHTML = `<tr><td class="empty" colspan="${colspan}">No rows yet</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((row) => `<tr>${render(row)}</tr>`).join("");
}

function setStatus(text) {
  els.dataStatus.textContent = text;
}

function byId(id) {
  return document.getElementById(id);
}

function limitsText(limits) {
  if (!limits) return "n/a";
  return `GAMMA_LIMIT=${limits.GAMMA_LIMIT ?? "n/a"}, MAX_MARKETS=${limits.MAX_MARKETS ?? "unset"}`;
}

function pct(n, d) {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return 0;
  return Math.max(0, Math.min(100, (n / d) * 100));
}

function int(value) {
  return Number.isFinite(value) ? Math.trunc(value).toLocaleString() : "0";
}

function num(value, digits) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "n/a";
}

function usd(value) {
  if (!Number.isFinite(value)) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatTime(value) {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return "n/a";
  return new Date(t).toLocaleString();
}

function classForNumber(value) {
  if (!Number.isFinite(value) || value === 0) return "";
  return value > 0 ? "positive" : "negative";
}

function colorPnL(el, value) {
  el.classList.remove("positive", "negative");
  const cls = classForNumber(value);
  if (cls) el.classList.add(cls);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
