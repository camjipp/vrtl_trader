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
  coreCanvas: byId("coreCanvas"),
  scanChart: byId("scanChart"),
  positionCount: byId("positionCount"),
  positionsBody: byId("positionsBody"),
  tradeCount: byId("tradeCount"),
  tradesBody: byId("tradesBody"),
  opportunityCount: byId("opportunityCount"),
  opportunitiesBody: byId("opportunitiesBody")
};

let lastData = null;

els.refreshBtn.addEventListener("click", () => {
  void load();
});

window.addEventListener("resize", () => {
  if (lastData) render(lastData);
});

void load();
setInterval(() => void load(), 60_000);
setInterval(() => {
  const scan = lastData?.latestScan;
  if (scan) drawCore(Number(scan.top_score ?? 0), scan.paper_arb ?? {});
}, 140);

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
  lastData = data;
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
  els.stopReason.textContent = formatStopReason(scan?.stop_reason);

  drawCore(Number(scan?.top_score ?? 0), arb);
  drawScanChart(data.recentScans ?? []);
  renderPositions(data.positions ?? []);
  renderTrades(data.trades ?? []);
  renderSignalCards(data.opportunities ?? []);
}

function drawCore(score, arb) {
  const canvas = els.coreCanvas;
  const setup = setupCanvas(canvas);
  if (!setup) return;
  const { ctx, w, h } = setup;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.42;
  const clampedScore = clamp(score, 0, 1);
  const exposure = clamp(Number(arb.exposureUsd ?? 0) / 500, 0, 1);

  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = "round";

  for (let i = 1; i <= 4; i += 1) {
    ctx.beginPath();
    ctx.arc(cx, cy, (radius / 4) * i, 0, Math.PI * 2);
    ctx.strokeStyle = i === 4 ? "rgba(85,221,255,0.48)" : "rgba(85,221,255,0.16)";
    ctx.lineWidth = i === 4 ? 1.5 : 1;
    ctx.stroke();
  }

  for (let i = 0; i < 12; i += 1) {
    const angle = (Math.PI * 2 * i) / 12;
    const inner = radius * 0.18;
    const outer = radius;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.strokeStyle = i % 3 === 0 ? "rgba(85,221,255,0.2)" : "rgba(85,221,255,0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawArc(ctx, cx, cy, radius * 0.88, clampedScore, "#55ddff", 10);
  drawArc(ctx, cx, cy, radius * 0.66, exposure, "#ffbf4d", 5);

  const sweep = ((Date.now() / 4000) % 1) * Math.PI * 2 - Math.PI / 2;
  const gradient = ctx.createLinearGradient(cx, cy, cx + Math.cos(sweep) * radius, cy + Math.sin(sweep) * radius);
  gradient.addColorStop(0, "rgba(85,221,255,0.8)");
  gradient.addColorStop(1, "rgba(85,221,255,0)");
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(sweep) * radius, cy + Math.sin(sweep) * radius);
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawArc(ctx, cx, cy, radius, amount, color, width) {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI / 2, Math.PI * 2 * amount - Math.PI / 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawScanChart(scans) {
  const canvas = els.scanChart;
  const setup = setupCanvas(canvas);
  if (!setup) return;
  const { ctx, w, h } = setup;
  const rows = scans.slice().reverse();
  const pad = { top: 22, right: 22, bottom: 30, left: 42 };
  const plotW = Math.max(1, w - pad.left - pad.right);
  const plotH = Math.max(1, h - pad.top - pad.bottom);

  ctx.clearRect(0, 0, w, h);
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  ctx.lineWidth = 1;

  if (!rows.length) {
    ctx.fillStyle = "rgba(131,166,178,0.9)";
    ctx.textAlign = "center";
    ctx.fillText("No scan history yet", w / 2, h / 2);
    return;
  }

  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.strokeStyle = "rgba(255,255,255,0.075)";
    ctx.stroke();
  }

  const maxScore = Math.max(0.1, ...rows.map((s) => Number(s.top_score ?? 0)));
  const maxBuckets = Math.max(1, ...rows.map((s) => Number(s.bucket_families ?? 0)));
  const step = rows.length > 1 ? plotW / (rows.length - 1) : plotW;
  const barW = Math.max(3, Math.min(14, plotW / rows.length / 2));

  rows.forEach((scan, index) => {
    const buckets = Number(scan.bucket_families ?? 0);
    const x = pad.left + index * step;
    const barH = (buckets / maxBuckets) * plotH;
    ctx.fillStyle = "rgba(255,191,77,0.78)";
    ctx.shadowColor = "rgba(255,191,77,0.25)";
    ctx.shadowBlur = 8;
    ctx.fillRect(x - barW / 2, pad.top + plotH - barH, barW, barH);
  });

  ctx.shadowBlur = 0;
  ctx.beginPath();
  rows.forEach((scan, index) => {
    const score = Number(scan.top_score ?? 0);
    const x = pad.left + index * step;
    const y = pad.top + plotH - (score / maxScore) * plotH;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#55ddff";
  ctx.lineWidth = 2.5;
  ctx.shadowColor = "rgba(85,221,255,0.32)";
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.shadowBlur = 0;

  const latest = rows.at(-1);
  ctx.fillStyle = "rgba(131,166,178,0.92)";
  ctx.textAlign = "left";
  ctx.fillText(`latest ${num(latest?.top_score, 3)}`, pad.left, h - 10);
  ctx.textAlign = "right";
  ctx.fillText(`${int(latest?.bucket_families)} buckets`, w - pad.right, h - 10);
}

function setupCanvas(canvas) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
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

function renderSignalCards(rows) {
  els.opportunityCount.textContent = `${rows.length} rows`;
  if (!rows.length) {
    els.opportunitiesBody.innerHTML = `<div class="empty signal-empty">No sports signals detected</div>`;
    return;
  }

  els.opportunitiesBody.innerHTML = rows
    .slice(0, 8)
    .map((o) => {
      const payload = o.payload ?? {};
      const detail = payload.reason ?? signalDetail(o);
      const label = signalLabel(o.strategy ?? payload.kind ?? "signal");
      const hot = signalClass(o.strategy) === "hot";
      return `
        <article class="signal-card ${hot ? "hot-card" : ""}">
          <div>
            <header>
              <span class="pill ${signalClass(o.strategy)}">${escapeHtml(label)}</span>
              <strong class="signal-edge">${o.edge == null ? "watch" : `${num(Number(o.edge) * 100, 2)}%`}</strong>
            </header>
            <strong class="signal-title">${escapeHtml(o.title ?? payload.title ?? o.market_id ?? "")}</strong>
          </div>
          <p class="signal-detail">${escapeHtml(detail)}</p>
          <div class="signal-meta">
            <span>${escapeHtml(formatTime(o.ts))}</span>
            <span>${escapeHtml(payload.sport ?? o.venue ?? "polymarket")}</span>
            <span>${o.cost_usd == null ? "cost n/a" : usd(o.cost_usd)}</span>
          </div>
        </article>
      `;
    })
    .join("");
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

function formatStopReason(value) {
  const text = String(value ?? "");
  const pageLimit = text.match(/^pageLimitReached\((\d+)\)$/);
  if (pageLimit) return `Page limit ${pageLimit[1]}`;
  if (!text) return "--";
  return text.replace(/([a-z])([A-Z])/g, "$1 $2");
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

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
