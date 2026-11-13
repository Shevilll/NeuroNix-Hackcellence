import { api, newIdempotencyKey } from "./client";
import type { TripOptions, TripRequest } from "./types";

export async function getOptions(): Promise<TripOptions> {
  return (await api.request<TripOptions>("/api/options")).data;
}

/** One idempotency key per user action: retries of the same build reuse it. */
export async function buildPackage(request: TripRequest, idempotencyKey = newIdempotencyKey()) {
  return (
    await api.request<{ status?: string }>("/api/packages", {
      method: "POST",
      body: request,
      idempotencyKey,
    })
  ).data;
}
