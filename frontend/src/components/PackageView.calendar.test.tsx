import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePackage, stubApi } from "../test/fixtures";
import PackageView from "./PackageView";

afterEach(() => vi.unstubAllGlobals());

describe("PackageView: add the plan to a calendar", () => {
  it("offers the whole plan as a calendar file to download", () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<PackageView pkg={makePackage()} budget={350000} />);
    const link = screen.getByRole("link", { name: /add to calendar/i });
    expect(link).toHaveAttribute("download", "holiday-pkg_test1.ics");
    const href = link.getAttribute("href")!;
    expect(href.startsWith("data:text/calendar;charset=utf-8,")).toBe(true);
    const ics = decodeURIComponent(href.slice(href.indexOf(",") + 1));
    expect(ics).toMatch(/^BEGIN:VCALENDAR/);
    expect(ics).toContain("SUMMARY:Senso-ji");
  });

  it("has no calendar button when the plan has no items", () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<PackageView pkg={makePackage({ items: [] })} budget={350000} />);
    expect(screen.queryByRole("link", { name: /add to calendar/i })).toBeNull();
  });
});
