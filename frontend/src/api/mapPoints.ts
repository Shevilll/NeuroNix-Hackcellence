import type { MapPoints } from "../lib/route";
import { api } from "./client";

/** Where every airport, hotel and attraction is, for the route map. */
export async function getMapPoints(): Promise<MapPoints> {
  return (await api.request<MapPoints>("/api/map-points")).data;
}
