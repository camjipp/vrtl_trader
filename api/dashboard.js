const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "missing_supabase_env" }));
    return;
  }

  try {
    const [latestScan, recentScans, heartbeats, positions, trades, opportunities] = await Promise.all([
      getRows("bot_scans", "select=*&order=ts.desc&limit=1"),
      getRows("bot_scans", "select=ts,fetched,families,bucket_families,top_score,paper_arb&order=ts.desc&limit=48"),
      getRows("bot_heartbeats", "select=*&order=ts.desc&limit=10"),
      getRows("paper_arb_positions", "select=*&order=updated_at.desc&limit=25"),
      getRows("paper_arb_trades", "select=*&order=ts.desc&limit=25"),
      getRows("arb_opportunities", "select=*&order=ts.desc&limit=25")
    ]);

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        latestScan: latestScan[0] ?? null,
        recentScans,
        heartbeats,
        positions,
        trades,
        opportunities
      })
    );
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "dashboard_query_failed", message: error?.message ?? String(error) }));
  }
}

async function getRows(table, query) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      accept: "application/json"
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${table}: ${response.status} ${body.slice(0, 300)}`);
  }

  return await response.json();
}
