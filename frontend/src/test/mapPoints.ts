import type { MapPoints } from "../lib/route";

/** What GET /api/map-points gives for the places in the test package. */
export const mapPoints: MapPoints = {
  airports: {
    BLR: { lat: 13.1986, lng: 77.7066, name: "Kempegowda International Airport" },
    NRT: { lat: 35.772, lng: 140.3929, name: "Narita International Airport" },
    KIX: { lat: 34.432, lng: 135.2304, name: "Kansai International Airport" },
  },
  hotels: {
    "HTL-TYO-001": { lat: 35.6717, lng: 139.765, name: "Ginza Pearl Hotel" },
    "HTL-KYO-004": { lat: 35.0, lng: 135.76, name: "Sakura Garden Hotel" },
  },
  attractions: {
    "ATT-TYO-004": { lat: 35.7148, lng: 139.7967, name: "Senso-ji" },
    "ATT-KYO-002": { lat: 34.9671, lng: 135.7727, name: "Fushimi Inari Taisha" },
  },
  flights: {
    "FL-401": { from: "BLR", to: "NRT" },
    "FL-411": { from: "KIX", to: "BLR" },
  },
};
