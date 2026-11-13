import { api, ApiError, newIdempotencyKey } from "./client";
import type { TripOptions, TripPrefill, TripRequest } from "./types";

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

export interface Traveler {
  name?: string;
  home_airport?: string;
  adults?: number;
  children?: number;
  child_ages?: number[];
}

export interface TripPackage {
  version?: number;
  country?: string;
  traveler?: Traveler;
  objective?: string;
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

/** Another start date or length that really produces a package (sent with NO_PACKAGE). */
export interface NearbyOption {
  kind: "other_dates" | "other_nights";
  start_date: string;
  end_date: string;
  nights: number;
  total_inr: number;
  within_budget: boolean;
  message: string;
}

/** A change that was solved and fits the budget, or the amount to raise the budget by (OVER_BUDGET). */
export type SuggestionDetail =
  | { kind: "fewer_nights" | "other_dates"; start_date: string; end_date: string; nights: number; total_inr: number; message: string }
  | { kind: "raise_budget"; amount_inr: number; message: string };

export type BuildResult =
  | {
      status: "OK";
      package_id: string;
      package: TripPackage;
      alternatives?: Record<"cheapest" | "fastest" | "best_rated", { package_id: string; package: TripPackage }>;
    }
  | { status: "NO_PACKAGE"; reasons: { code: string; message: string }[]; nearby?: NearbyOption[] }
  | {
      status: "OVER_BUDGET";
      cheapest_total: number;
      budget: number;
      short_by: number;
      suggestions: string[];
      suggestion_details?: SuggestionDetail[];
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

/** One row of the bookings list (GET /api/reservations). */
export interface BookingSummary {
  reservation_number: string;
  created_at: string;
  country: string | null;
  cities: string[];
  nights_per_city: number[];
  start_date: string | null;
  end_date: string | null;
  adults: number | null;
  children: number;
  total_inr: number;
}

export async function listReservations() {
  return (await api.request<BookingSummary[]>("/api/reservations")).data;
}

/** Delete one booking. A 404 means it is already gone (for example a retried delete), which is fine. */
export async function deleteReservation(number: string) {
  try {
    await api.request(`/api/reservations/${number}`, { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
}

export async function deleteAllReservations() {
  return (await api.request<{ deleted: number }>("/api/reservations", { method: "DELETE" })).data.deleted;
}

export interface ChangeOption {
  hotel_id?: string;
  room_id?: string;
  hotel_name?: string;
  stars?: number;
  rating?: number;
  area?: string | null;
  rooms?: number;
  flight_id?: string;
  depart?: string;
  arrive?: string;
  attraction_id?: string;
  city?: string;
  date?: string;
  name: string;
  price_diff: number;
}

/** Something the traveler should know after a change (G1), e.g. OVER_BUDGET or EMPTY_DAY. */
export interface ChangeWarning {
  code: string;
  message: string;
}

export interface ChangeResult {
  package_id: string;
  package: TripPackage;
  price_diff_inr?: number;
  warnings?: ChangeWarning[];
}

export async function getOptions2(id: string, kind: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  return (await api.request<ChangeOption[]>(`/api/packages/${id}/options/${kind}${qs ? `?${qs}` : ""}`)).data;
}

/** One key per traveler action: a retry of the same change is replayed by the backend, never applied twice. */
export async function changePackage(id: string, change: Record<string, unknown>, idempotencyKey = newIdempotencyKey()) {
  return (
    await api.request<ChangeResult>(`/api/packages/${id}/changes`, {
      method: "POST",
      body: change,
      idempotencyKey,
    })
  ).data;
}

export async function getPackage(id: string) {
  return (await api.request<TripPackage>(`/api/packages/${id}`)).data;
}

export interface QuickResult {
  fields: TripPrefill;
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

export async function getImages() {
  return (await api.request<Record<string, string>>("/api/images")).data;
}

/** One row of images/ATTRIBUTIONS.md: who made a photo and under which licence. */
export interface PhotoCredit {
  file: string;
  used_for: string;
  source_title: string;
  source_url: string;
  author: string;
  license: string;
  license_url: string;
}

export async function getCredits() {
  return (await api.request<PhotoCredit[]>("/api/credits")).data;
}
