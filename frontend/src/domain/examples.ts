import type { FormValues } from "./requestValidation";

export type ExampleGroup = "Main example" | "Edge cases" | "Error cases";

export interface Example {
  id: string;
  group: ExampleGroup;
  title: string;
  /** What the example shows, so a judge knows what to expect before picking it. */
  shows: string;
  values: FormValues;
}

export const EXAMPLE_GROUPS: ExampleGroup[] = ["Main example", "Edge cases", "Error cases"];

const v = (
  origin: string,
  country: string,
  startDate: string,
  nights: string,
  adults: string,
  childAges: string[],
  budget: string,
): FormValues => ({ origin, country, startDate, nights, adults, childAges, budget });

/**
 * Ready-made requests for the demo. The results named in `shows` were checked against the
 * organiser catalog on an empty database; holds from earlier bookings can change them a little.
 */
export const EXAMPLES: Example[] = [
  {
    id: "menon",
    group: "Main example",
    title: "Menon family: Bengaluru to Japan",
    shows: "2 adults and a 6-year-old, 10 April, 6 nights, ₹3,50,000. Tokyo, Kyoto and Osaka within budget.",
    values: v("BLR", "JP", "2027-04-10", "6", "2", ["6"], "3,50,000"),
  },
  {
    id: "short",
    group: "Edge cases",
    title: "Shortest trip: 3 nights",
    shows: "The minimum stay. Only one city fits, because every city needs at least 2 nights.",
    values: v("BLR", "JP", "2027-04-15", "3", "2", [], "2,50,000"),
  },
  {
    id: "long",
    group: "Edge cases",
    title: "Longest trip: 10 nights",
    shows: "The maximum stay, flying home on 20 April, the last day with flights.",
    values: v("BLR", "JP", "2027-04-10", "10", "2", [], "8,00,000"),
  },
  {
    id: "first-day",
    group: "Edge cases",
    title: "First day of the data: 1 April",
    shows: "The overnight flight leaves India on 31 March and lands on the first possible day.",
    values: v("BLR", "JP", "2027-04-01", "6", "2", [], "4,00,000"),
  },
  {
    id: "big-family",
    group: "Edge cases",
    title: "Six travellers: Delhi to UAE",
    shows: "3 adults and children aged 2, 7 and 11. The party needs several rooms in each hotel.",
    values: v("DEL", "AE", "2027-04-08", "5", "3", ["2", "7", "11"], "6,00,000"),
  },
  {
    id: "infant",
    group: "Edge cases",
    title: "Travelling with a baby",
    shows: "A child aged 0 still needs a seat on every flight and a place in the hotel room.",
    values: v("MAA", "AE", "2027-04-14", "4", "2", ["0"], "2,50,000"),
  },
  {
    id: "exact-budget",
    group: "Edge cases",
    title: "Budget exactly the total",
    shows: "Delhi to UAE for ₹89,997, the exact price of the package: it fits with ₹0 left.",
    values: v("DEL", "AE", "2027-04-05", "5", "2", [], "89,997"),
  },
  {
    id: "over-budget",
    group: "Error cases",
    title: "Over budget, with fixes",
    shows: "₹85,000 is too little. Shows the cheapest total, the gap, and solved fewer-nights and other-date options.",
    values: v("DEL", "AE", "2027-04-05", "5", "2", [], "85,000"),
  },
  {
    id: "raise-budget",
    group: "Error cases",
    title: "Over budget: only a raise helps",
    shows: "The Menon trip with ₹2,00,000. No date or length fits, so the app offers to raise the budget.",
    values: v("BLR", "JP", "2027-04-10", "6", "2", ["6"], "2,00,000"),
  },
  {
    id: "no-arrival",
    group: "Error cases",
    title: "No flight on the start date",
    shows: "Mumbai to Japan on 3 April has no arrival flight. Says why and offers nearby dates that work.",
    values: v("BOM", "JP", "2027-04-03", "8", "1", [], "2,00,000"),
  },
  {
    id: "no-return",
    group: "Error cases",
    title: "No flight home on the last day",
    shows: "Mumbai to Japan for 10 nights has no return flight on 20 April. Offers other dates or lengths.",
    values: v("BOM", "JP", "2027-04-10", "10", "2", [], "6,00,000"),
  },
  {
    id: "past-window",
    group: "Error cases",
    title: "Past the last return date",
    shows: "Starting 18 April for 6 nights would fly home after 20 April. The form stops it before building.",
    values: v("BLR", "JP", "2027-04-18", "6", "2", [], "3,00,000"),
  },
  {
    id: "bad-entries",
    group: "Error cases",
    title: "Wrong entries in the form",
    shows: "12 nights, no adults and a child aged 19. Every field explains what is wrong.",
    values: v("BLR", "JP", "2027-04-10", "12", "0", ["19"], "3,00,000"),
  },
];
