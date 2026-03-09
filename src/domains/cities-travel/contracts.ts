import type { City, TravelLog, TravelQuote } from "./types";

export type CitiesPayload = {
  cities: City[];
};

export type CitiesResponse = CitiesPayload & {
  error?: string;
};

export type TravelState = {
  currentCity: City | null;
  activeTravel: TravelLog | null;
  canPurchaseBusiness: boolean;
};

export type TravelStateResponse = TravelState & {
  error?: string;
};

export type StartTravelResponse = {
  travel: TravelLog;
  quote: TravelQuote;
  error?: string;
};

export type CancelTravelResponse = {
  travel: TravelLog;
  error?: string;
};
