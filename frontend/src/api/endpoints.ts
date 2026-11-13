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

export interface TripItem {
  item_id: string;
  type: "flight" | "hotel" | "transfer" | "attraction";
  name: string;
  city: string;
  start: string;
  end: string | null;
  quantity: number;
  price_inr: number;
  status: string;
}

export interface TripPackage {
  trip_id: string;
  start_date: string;
  end_date: string;
  budget_inr: number;
  total_inr: number;
  cities: string[];
  nights_per_city: number[];
  items: TripItem[];
}

export type BuildResult =
  | { status: "OK"; package_id: string; package: TripPackage }
  | { status: "NO_PACKAGE"; reasons: { code: string; message: string }[] }
  | {
      status: "OVER_BUDGET";
      cheapest_total: number;
      budget: number;
      short_by: number;
      suggestions: string[];
      cheapest_package: TripPackage;
    };

export async function build(request: TripRequest, idempotencyKey = newIdempotencyKey()) {
  return (await api.request<BuildResult>("/api/packages", { method: "POST", body: request, idempotencyKey })).data;
}

export async function confirmPackage(id: string, idempotencyKey: string) {
  return (
    await api.request<{ reservation_number: string; package: TripPackage }>(`/api/packages/${id}/confirm`, {
      method: "POST",
      idempotencyKey,
    })
  ).data;
}

export async function getReservation(number: string) {
  return (await api.request<{ reservation_number: string; package: TripPackage }>(`/api/reservations/${number}`)).data;
}
