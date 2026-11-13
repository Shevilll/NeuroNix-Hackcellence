import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import ChangeOptions, { CityPlanOptions } from "./components/ChangeOptions";
import ConfirmDelete from "./components/ConfirmDelete";
import PackageView from "./components/PackageView";
import { bookings, makePackage, okBuild, reply, stubApi } from "./test/fixtures";

/** A response the test lets through when it is ready, so the loading state can be looked at first. */
function held() {
  let release!: (r: Response) => void;
  const promise = new Promise<Response>((resolve) => (release = resolve));
  return { promise, release };
}

beforeEach(() => {
  sessionStorage.clear();
  window.history.pushState({}, "", "/");
});
afterEach(() => vi.unstubAllGlobals());

const spinnerIn = (el: HTMLElement) => el.querySelector("svg.spinner");

describe("loading: the bookings page", () => {
  it("shows a loading indicator while the bookings load, then the list", async () => {
    const list = held();
    vi.stubGlobal("fetch", vi.fn(stubApi((url, init) => (url === "/api/reservations" && init?.method === "GET" ? list.promise : undefined))));
    window.history.pushState({}, "", "/r");
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading your bookings/i);
    expect(screen.queryByRole("region", { name: /where to find your number/i })).toBeNull();
    list.release(reply(200, bookings));
    expect(await screen.findByRole("heading", { name: /all bookings \(2\)/i })).toBeInTheDocument();
    expect(screen.queryByText(/loading your bookings/i)).toBeNull();
  });

  it("says so when the bookings cannot be loaded, and loads them again on retry", async () => {
    let down = true;
    vi.stubGlobal("fetch", vi.fn(stubApi((url, init) => {
      if (url !== "/api/reservations" || init?.method !== "GET") return undefined;
      return down ? reply(400, { detail: "boom" }) : reply(200, bookings);
    })));
    window.history.pushState({}, "", "/r");
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load your bookings/i);
    down = false;
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { name: /all bookings \(2\)/i })).toBeInTheDocument();
  });
});

describe("loading: the planner", () => {
  it("shows a loading indicator in the results while the holiday is being built", async () => {
    const build = held();
    vi.stubGlobal("fetch", vi.fn(stubApi((url, init) => (url === "/api/packages" && init?.method === "POST" ? build.promise : undefined))));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /load an example/i }));
    await user.click(screen.getByRole("menuitem", { name: /menon family/i }));
    expect(await screen.findByText(/building your holiday and checking every rule/i)).toBeInTheDocument();
    build.release(reply(200, okBuild()));
    expect(await screen.findAllByRole("tab")).toHaveLength(4);
    expect(screen.queryByText(/building your holiday and checking every rule/i)).toBeNull();
  });

  it("shows a spinner on Fill the form while the quick request is read", async () => {
    const quick = held();
    vi.stubGlobal("fetch", vi.fn(stubApi((url) => (url === "/api/quick-request" ? quick.promise : undefined))));
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByRole("textbox", { name: /describe your trip/i }), "2 adults to Japan");
    await user.click(screen.getByRole("button", { name: /fill the form/i }));
    const button = screen.getByRole("button", { name: /reading/i });
    expect(button).toBeDisabled();
    expect(spinnerIn(button)).not.toBeNull();
    quick.release(reply(200, { fields: { adults: 2, country: "Japan" }, missing: [], unclear: [] }));
    await waitFor(() => expect(screen.getByRole("button", { name: /fill the form/i })).toBeEnabled());
  });
});

describe("loading: the trip checker", () => {
  it("shows a loading indicator while the file is checked", async () => {
    const check = held();
    vi.stubGlobal("fetch", vi.fn(stubApi((url) => (url === "/api/check" ? check.promise : undefined))));
    window.history.pushState({}, "", "/check");
    render(<App />);
    const json = JSON.stringify(makePackage());
    const file = new File([json], "trip.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => json }); // jsdom cannot read File text
    await userEvent.upload(screen.getByLabelText(/trip json file/i), file);
    expect(await screen.findByText(/checking the file against every rule/i)).toBeInTheDocument();
    check.release(reply(200, { valid: true, violations: [], checklist: ["Flights"] }));
    expect(await screen.findByText(/all rules pass/i)).toBeInTheDocument();
    expect(screen.queryByText(/checking the file against every rule/i)).toBeNull();
  });
});

describe("loading: changing a package", () => {
  it("shows a loading indicator while other options are found", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<ChangeOptions id="pkg_test1" pkg={makePackage()} kind="hotels" params={{ city: "Kyoto" }} title="Other hotels" onChanged={() => {}} onClose={() => {}} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/finding options/i);
    expect(spinnerIn(status)).not.toBeNull();
  });

  it("shows a loading indicator while city plans are built", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<CityPlanOptions id="pkg_test1" pkg={makePackage()} onChanged={() => {}} onClose={() => {}} />);
    expect(spinnerIn(screen.getByRole("status"))).not.toBeNull();
  });

  it("shows a spinner on the remove button of the attraction being removed", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<PackageView pkg={makePackage()} budget={350000} edit={{ id: "pkg_test1", onChanged: () => {} }} />);
    const [first, second] = screen.getAllByRole("button", { name: /^remove/i });
    await userEvent.click(first);
    expect(spinnerIn(first)).not.toBeNull();
    expect(first).toBeDisabled();
    expect(spinnerIn(second)).toBeNull();
  });
});

describe("loading: deleting", () => {
  it("shows a spinner on the confirm button while deleting", async () => {
    const { rerender } = render(<ConfirmDelete label="Delete booking" text="Delete" question="Sure?" confirmText="Yes, delete" onConfirm={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /delete booking/i }));
    rerender(<ConfirmDelete label="Delete booking" text="Delete" question="Sure?" confirmText="Yes, delete" busy onConfirm={() => {}} />);
    const button = within(screen.getByRole("group")).getByRole("button", { name: /deleting/i });
    expect(spinnerIn(button)).not.toBeNull();
  });
});
