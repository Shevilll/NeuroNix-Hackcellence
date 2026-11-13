import { describe, expect, it } from "vitest";
import type { TripOptions } from "../api/types";
import { toRequest, validateForm, type FormValues } from "./requestValidation";

const options: TripOptions = {
  departure_cities: [
    { airport: "BLR", city: "Bengaluru" },
    { airport: "DEL", city: "Delhi" },
  ],
  countries: [
    { code: "JP", name: "Japan" },
    { code: "AE", name: "United Arab Emirates" },
  ],
  rules: {
    min_nights: 3,
    max_nights: 10,
    min_nights_per_city: 2,
    max_travelers: 9,
    data_window: { first_night: "2027-04-01", last_departure: "2027-04-20" },
  },
};

const menon: FormValues = {
  origin: "BLR",
  country: "JP",
  startDate: "2027-04-10",
  nights: "6",
  adults: "2",
  childAges: ["6"],
  budget: "350000",
};

const errorsFor = (patch: Partial<FormValues>) => validateForm({ ...menon, ...patch }, options);

describe("validateForm", () => {
  it("accepts the Menon request", () => {
    expect(validateForm(menon, options)).toEqual({});
  });

  it("requires every field", () => {
    const errors = validateForm(
      { origin: "", country: "", startDate: "", nights: "", adults: "", childAges: [], budget: "" },
      options,
    );
    expect(Object.keys(errors).sort()).toEqual(
      ["adults", "budget", "country", "nights", "origin", "startDate"].sort(),
    );
  });

  it("rejects an unknown departure city or country", () => {
    expect(errorsFor({ origin: "XXX" }).origin).toMatch(/departure city/i);
    expect(errorsFor({ country: "FR" }).country).toMatch(/country/i);
  });

  it.each(["not-a-date", "2027-02-30", "10/04/2027"])("rejects invalid date %s", (d) => {
    expect(errorsFor({ startDate: d }).startDate).toMatch(/valid date/i);
  });

  it("rejects a start date before 1 April 2027", () => {
    expect(errorsFor({ startDate: "2027-03-31" }).startDate).toMatch(/1 April 2027/);
  });

  it("rejects a return date after 20 April 2027", () => {
    // 15 Apr + 6 nights = 21 Apr
    expect(errorsFor({ startDate: "2027-04-15" }).startDate).toMatch(/20 April 2027/);
    // 14 Apr + 6 nights = 20 Apr is fine
    expect(errorsFor({ startDate: "2027-04-14" }).startDate).toBeUndefined();
  });

  it.each(["2", "11", "0", "-1", "3.5", "abc"])("rejects nights %s", (n) => {
    expect(errorsFor({ nights: n }).nights).toMatch(/3 and 10/);
  });

  it.each(["3", "10"])("accepts boundary nights %s", (n) => {
    expect(errorsFor({ nights: n, startDate: "2027-04-05" }).nights).toBeUndefined();
  });

  it.each(["0", "-1", "1.5", "x"])("rejects adults %s", (a) => {
    expect(errorsFor({ adults: a }).adults).toMatch(/at least 1 adult/i);
  });

  it("rejects an age outside 0-17 or not a whole number", () => {
    expect(errorsFor({ childAges: ["18"] }).childAges).toMatch(/0 and 17/);
    expect(errorsFor({ childAges: ["-1"] }).childAges).toMatch(/0 and 17/);
    expect(errorsFor({ childAges: [""] }).childAges).toMatch(/age/i);
    expect(errorsFor({ childAges: ["2.5"] }).childAges).toMatch(/0 and 17/);
  });

  it("accepts age 0 and 17", () => {
    expect(errorsFor({ childAges: ["0", "17"] }).childAges).toBeUndefined();
  });

  it("rejects more than 9 travelers", () => {
    expect(errorsFor({ adults: "8", childAges: ["1", "2"] }).adults).toMatch(/9 travelers/);
  });

  it.each(["0", "-5", "abc", "Infinity"])("rejects budget %s", (b) => {
    expect(errorsFor({ budget: b }).budget).toMatch(/budget/i);
  });

  it("accepts a budget typed with lakh commas", () => {
    expect(errorsFor({ budget: "3,50,000" }).budget).toBeUndefined();
  });
});

describe("toRequest", () => {
  it("converts valid form values to the API request", () => {
    expect(toRequest({ ...menon, budget: "3,50,000" })).toEqual({
      origin: "BLR",
      country: "JP",
      start_date: "2027-04-10",
      nights: 6,
      adults: 2,
      children_ages: [6],
      budget: 350000,
    });
  });
});
