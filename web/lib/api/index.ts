// Data-layer entry point. Selects the adapter via NEXT_PUBLIC_DATA_SOURCE.
// Everything in the UI imports `api` from here — never an adapter directly.

import type { HaydariAPI } from "../types";
import { mockApi } from "./mock";
import { httpApi } from "./http";

const source = (process.env.NEXT_PUBLIC_DATA_SOURCE || "mock").toLowerCase();

export const DATA_SOURCE: "mock" | "api" = source === "api" ? "api" : "mock";

export const api: HaydariAPI = DATA_SOURCE === "api" ? httpApi : mockApi;

export { ApiError } from "./http";
export * from "../types";
