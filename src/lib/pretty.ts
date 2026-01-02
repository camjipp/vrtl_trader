export function fmtNum(n: number | null | undefined, digits = 3): string {
  if (n === null || n === undefined) return "n/a";
  if (!Number.isFinite(n)) return "n/a";
  return n.toFixed(digits);
}

export function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "n/a";
  if (!Number.isFinite(n)) return "n/a";
  return `$${n.toFixed(2)}`;
}

export function padRight(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

export function truncate(s: string, max = 60): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

export function renderTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const widths: number[] = [];
  for (const r of rows) {
    for (let i = 0; i < r.length; i++) {
      widths[i] = Math.max(widths[i] ?? 0, r[i]!.length);
    }
  }
  return rows
    .map((r) => r.map((c, i) => padRight(c, widths[i]!)).join("  "))
    .join("\n");
}


