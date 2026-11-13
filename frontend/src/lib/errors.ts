import { ApiError } from "../api/client";

/** The clearest message an API error carries, or a fallback. `t` (from useI18n) words the fallbacks in the traveler's language. */
export function messageFrom(error: unknown, fallback?: string, t?: (key: string) => string): string {
  fallback ??= t ? t("err.generic") : "Something went wrong. Please try again.";
  if (error instanceof ApiError) {
    const detail = (error.body as { detail?: unknown } | null)?.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string") {
      return (detail as { message: string }).message;
    }
    if (Array.isArray(detail)) {
      const text = detail.map((d) => (d as { msg?: string }).msg).filter(Boolean).join(" ");
      if (text) return text;
    }
    return fallback;
  }
  if (error instanceof TypeError) return t ? t("err.network") : "We could not reach the server. Check that the backend is running.";
  return fallback;
}
