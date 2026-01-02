export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export class HttpError extends Error {
  public readonly status: number;
  public readonly url: string;
  public readonly bodyText: string | undefined;

  constructor(args: { status: number; url: string; bodyText: string | undefined }) {
    super(`HTTP ${args.status} for ${args.url}`);
    this.status = args.status;
    this.url = args.url;
    this.bodyText = args.bodyText;
  }
}

export async function getJson<T = unknown>(
  url: string,
  opts?: { timeoutMs?: number; headers?: Record<string, string> }
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = opts?.timeoutMs ?? 20_000;
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        ...(opts?.headers ?? {})
      },
      signal: controller.signal
    });

    if (!res.ok) {
      const bodyText = await safeReadText(res);
      throw new HttpError({ status: res.status, url, bodyText });
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

async function safeReadText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}


