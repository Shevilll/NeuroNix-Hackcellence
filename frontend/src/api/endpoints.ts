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
  catalog_id?: string;
  role?: string | null;
  warnings?: string[];
}

export interface TripPackage {
  version?: number;
  travel_minutes?: number;
  avg_stars?: number;
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
  | {
      status: "OK";
      package_id: string;
      package: TripPackage;
      alternatives?: Record<"cheapest" | "fastest" | "best_rated", { package_id: string; package: TripPackage }>;
    }
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

export interface ChangeOption {
  hotel_id?: string;
  room_id?: string;
  flight_id?: string;
  attraction_id?: string;
  date?: string;
  name: string;
  price_diff: number;
}

export async function getOptions2(id: string, kind: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  return (await api.request<ChangeOption[]>(`/api/packages/${id}/options/${kind}${qs ? `?${qs}` : ""}`)).data;
}

export async function changePackage(id: string, change: Record<string, unknown>) {
  return (
    await api.request<{ package: TripPackage }>(`/api/packages/${id}/changes`, {
      method: "POST",
      body: change,
      idempotencyKey: newIdempotencyKey(),
    })
  ).data;
}

export interface QuickResult {
  fields: Partial<TripRequest>;
  missing: string[];
  unclear: string[];
}

export async function quickRequest(text: string) {
  return (await api.request<QuickResult>("/api/quick-request", { method: "POST", body: { text } })).data;
}

export interface CityPlan {
  cities: string[];
  nights_per_city: number[];
  total_inr: number;
  within_budget: boolean;
  current: boolean;
}

export async function getCityPlans(id: string) {
  return (await api.request<CityPlan[]>(`/api/packages/${id}/city-plans`)).data;
}

export interface CheckReport {
  valid: boolean;
  violations: { code: string; message: string; group: string }[];
  checklist: { group: string; ok: boolean }[];
}

export async function checkTrip(trip: unknown) {
  return (await api.request<CheckReport>("/api/check", { method: "POST", body: trip })).data;
}
