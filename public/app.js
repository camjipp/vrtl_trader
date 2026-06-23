const els = {
  workerState: byId("workerState"),
  workerSub: byId("workerSub"),
  workerId: byId("workerId"),
  refreshBtn: byId("refreshBtn"),
  updatedAt: byId("updatedAt"),
  cash: byId("cash"),
  exposure: byId("exposure"),
  locked: byId("locked"),
  markPnl: byId("markPnl"),
  openPositions: byId("openPositions"),
  opps: byId("opps"),
  entered: byId("entered"),
  scanAge: byId("scanAge"),
  topScore: byId("topScore"),
  fetched: byId("fetched"),
  families: byId("families"),
  buckets: byId("buckets"),
  stopReason: byId("stopReason"),
  spark: byId("spark"),
  positionCount: byId("positionCount"),
  positionsBody: byId("positionsBody"),
  tradeCount: byId("tradeCount"),
  tradesBody: byId("tradesBody"),
  opportunityCount: byId("opportunityCount"),
  opportunitiesBody: byId("opportunitiesBody")
};

els.refreshBtn.addEventListener("click", () => {
  void load();
});

void load();
setInterval(() => void load(), 60_000);

async function load() {
  els.workerState.textContent = "SYNCING";
  els.workerSub.textContent = "querying command data";
  try {
    const data = await getJson("/api/dashboard");
    render(data);
  } catch (error) {
    console.error(error);
    els.workerState.textContent = "OFFLINE";
    els.workerState.className = "negative";
    els.workerSub.textContent = "dashboard API unavailable";
  }
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return await response.json();
}

function render(data) {
  const scan = data.latestScan;
  const arb = scan?.paper_arb ?? {};
  const heartbeat = data.heartbeats?.[0] ?? null;

  const staleMinutes = scan?.ts ? (Date.now() - Date.parse(scan.ts)) / 60000 : Infinity;
  const online = staleMinutes <= 15;
  els.workerState.textContent = online ? "ONLINE" : "STALE";
  els.workerState.className = online ? "positive" : "negative";
  els.workerSub.textContent = heartbeat?.message ?? (online ? "worker heartbeat nominal" : "no recent heartbeat");
  els.workerId.textContent = heartbeat?.worker_id ?? "lightsail-vrtl-1";
  els.updatedAt.textContent = `console sync ${formatTime(data.generatedAt)}`;

  els.cash.textContent = usd(arb.bankrollCashUsd);
  els.exposure.textContent = usd(arb.exposureUsd);
  els.locked.textContent = usd(arb.lockedProfitUsd);
  els.markPnl.textContent = usd(arb.markToBidPnlUsd);
  color(els.locked, arb.lockedProfitUsd);
  color(els.markPnl, arb.markToBidPnlUsd);

  els.openPositions.textContent = `${int(arb.openPositionsCount)} open positions`;
  els.opps.textContent = int(arb.opportunities);
  els.entered.textContent = `${int(arb.entered)} entries this scan`;

  els.scanAge.textContent = scan?.ts ? `${Math.max(0, Math.round(staleMinutes))} min ago` : "--";
  els.topScore.textContent = num(scan?.top_score, 3);
  els.fetched.textContent = int(scan?.fetched);
  els.families.textContent = int(scan?.families);
  els.buckets.textContent = int(scan?.bucket_families);
  els.stopReason.textContent = scan?.stop_reason ?? "--";

  renderSpark(data.recentScans ?? []);
  renderPositions(data.positions ?? []);
  renderTrades(data.trades ?? []);
  renderOpportunities(data.opportunities ?? []);
}

function renderSpark(scans) {
  const rows = scans.slice().reverse();
  if (rows.length === 0) {
    els.spark.innerHTML = `<div class="empty">No scan history yet</div>`;
    return;
  }

  const maxScore = Math.max(0.001, ...rows.map((s) => Number(s.top_score ?? 0)));
  els.spark.innerHTML = rows
    .map((scan) => {
      const score = Number(scan.top_score ?? 0);
      const buckets = Number(scan.bucket_families ?? 0);
      const height = Math.max(4, Math.round((score / maxScore) * 100));
      const tint = buckets > 0 ? "var(--amber)" : "var(--cyan)";
      return `<div class="bar" title="${escapeHtml(formatTime(scan.ts))} score ${num(score, 3)}" style="height:${height}%;background:${tint}"></div>`;
    })
    .join("");
}

function renderPositions(rows) {
  els.positionCount.textContent = `${rows.length} rows`;
  renderRows(
    els.positionsBody,
    rows,
    (p) => `
      <td>${escapeHtml(p.title ?? p.market_id ?? "")}</td>
      <td><span class="pill">${escapeHtml(p.status ?? "open")}</span></td>
      <td>${num(p.shares, 2)}</td>
      <td>${usd(p.cost_usd)}</td>
      <td class="${classFor(p.locked_profit_usd)}">${usd(p.locked_profit_usd)}</td>
      <td class="${classFor(p.last_mark_pnl_usd)}">${usd(p.last_mark_pnl_usd)}</td>
    `,
    6
  );
}

function renderTrades(rows) {
  els.tradeCount.textContent = `${rows.length} rows`;
  renderRows(
    els.tradesBody,
    rows,
    (t) => `
      <td>${escapeHtml(formatTime(t.ts))}</td>
      <td><span class="pill">${escapeHtml(t.event_type ?? "")}</span></td>
      <td>${escapeHtml(t.title ?? t.market_id ?? "")}</td>
      <td>${usd(t.cost_usd)}</td>
      <td class="${classFor(t.realized_pnl_usd ?? t.mark_pnl_usd)}">${usd(t.realized_pnl_usd ?? t.mark_pnl_usd)}</td>
    `,
    5
  );
}

function renderOpportunities(rows) {
  els.opportunityCount.textContent = `${rows.length} rows`;
  renderRows(
    els.opportunitiesBody,
    rows,
    (o) => {
      const payload = o.payload ?? {};
      const detail = payload.reason ?? signalDetail(o);
      const label = signalLabel(o.strategy ?? payload.kind ?? "signal");
      return `
        <td>${escapeHtml(formatTime(o.ts))}</td>
        <td><span class="pill ${signalClass(o.strategy)}">${escapeHtml(label)}</span></td>
        <td>
          <strong>${escapeHtml(o.title ?? payload.title ?? o.market_id ?? "")}</strong>
          <small>${escapeHtml(payload.sport ?? o.venue ?? "polymarket")}</small>
        </td>
        <td>${o.edge == null ? "n/a" : `${num(Number(o.edge) * 100, 2)}%`}</td>
        <td>${escapeHtml(detail)}</td>
      `;
    },
    5
  );
}

function signalLabel(strategy) {
  return String(strategy)
    .replace(/^sports_/, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function signalClass(strategy) {
  const s = String(strategy ?? "");
  if (s.includes("violation") || s.includes("underround")) return "hot";
  if (s.includes("near")) return "watch";
  return "";
}

function signalDetail(o) {
  if (o.locked_profit_usd != null) return `Potential locked value ${usd(o.locked_profit_usd)}`;
  if (o.cost_usd != null) return `Basket cost ${usd(o.cost_usd)}`;
  return "Structural watch signal";
}

function renderRows(tbody, rows, render, colspan) {
  if (!rows.length) {
    tbody.innerHTML = `<tr><td class="empty" colspan="${colspan}">No rows detected</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((row) => `<tr>${render(row)}</tr>`).join("");
}

function byId(id) {
  return document.getElementById(id);
}

function int(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n).toLocaleString() : "0";
}

function num(value, digits) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "0.000";
}

function usd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatTime(value) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "--";
  return new Date(ms).toLocaleString();
}

function classFor(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  return n > 0 ? "positive" : "negative";
}

function color(el, value) {
  el.classList.remove("positive", "negative");
  const cls = classFor(value);
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
