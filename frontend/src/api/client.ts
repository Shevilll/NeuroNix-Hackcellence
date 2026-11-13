/**
 * Fetch wrapper used for every backend call.
 *
 * Retries only transient failures (network errors, 429, 502, 503, 504) with exponential
 * backoff and jitter, at most 3 attempts. The same Idempotency-Key is sent on every attempt
 * so a retried write can never create a second package or reservation. 4xx answers are
 * never retried: they are real answers the UI must show.
 */

export const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 2000;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `Request failed with status ${status}`);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  /** True when the server answered from its idempotency store (`Idempotent-Replay: true`). */
  replayed: boolean;
}

export interface ClientDeps {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function backoffDelay(retryNumber: number, random: () => number): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** (retryNumber - 1), MAX_DELAY_MS);
  const jitter = 0.5 + random(); // 0.5x .. 1.5x
  return Math.min(Math.round(exponential * jitter), MAX_DELAY_MS);
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createClient(deps: ClientDeps = {}) {
  const fetchFn = deps.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;

  async function request<T = unknown>(
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const headers = new Headers({ Accept: "application/json" });
    const init: RequestInit = { method: options.method ?? "GET", headers, signal: options.signal };
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      init.body = JSON.stringify(options.body);
    }
    if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetchFn(path, init);
        const body = await readBody(res);
        if (res.ok) {
          return {
            data: body as T,
            status: res.status,
            replayed: res.headers.get("Idempotent-Replay") === "true",
          };
        }
        lastError = new ApiError(res.status, body);
        if (!RETRY_STATUSES.has(res.status)) throw lastError;
      } catch (err) {
        if (err instanceof ApiError && !RETRY_STATUSES.has(err.status)) throw err;
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        lastError = err;
      }
      if (attempt < MAX_ATTEMPTS) await sleep(backoffDelay(attempt, random));
    }
    throw lastError;
  }

  return { request };
}

export const api = createClient();
