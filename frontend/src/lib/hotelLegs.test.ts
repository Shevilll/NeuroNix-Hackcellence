import { describe, expect, it } from "vitest";
import { legFromHotel, legToHotel } from "./travel";

const hotel = { lat: 35.6717, lng: 139.765 }; // Ginza Pearl Hotel
const sensoji = { lat: 35.7148, lng: 139.7967 };

describe("trips between the hotel and the day's visits", () => {
  it("leaves the hotel early enough to reach the first visit as it starts", () => {
    const leg = legFromHotel(hotel, sensoji, "2027-04-11T09:00");
    expect(leg).toMatchObject({ km: 5.6, minutes: 30, leave: "08:30", arrive: "09:00", tight: false });
  });

  it("is tight when that means leaving before the traveller reaches the hotel", () => {
    expect(legFromHotel(hotel, sensoji, "2027-04-10T13:30", "2027-04-10T13:10").tight).toBe(true);
    expect(legFromHotel(hotel, sensoji, "2027-04-10T13:30", "2027-04-10T12:30").tight).toBe(false);
  });

  it("goes back to the hotel when the last visit ends", () => {
    const leg = legToHotel(sensoji, hotel, "2027-04-11T10:00");
    expect(leg).toMatchObject({ km: 5.6, minutes: 30, leave: "10:00", arrive: "10:30", tight: false });
  });
});
