import type {
  City,
  CityEconomicState,
  CityEvent,
  CityResourceModifier,
  CityRoute,
  TravelLog,
  TravelQuote,
  WorldEconomicState,
  WorldEvent,
} from "./types";

export type CitiesPayload = {
  cities: City[];
};

export type CitiesResponse = CitiesPayload & {
  error?: string;
};

export type CityResourceModifiersResponse = {
  resourceModifiers: CityResourceModifier[];
  error?: string;
};

export type CityRoutesResponse = {
  routes: CityRoute[];
  error?: string;
};

export type EconomicStateResponse = {
  world: WorldEconomicState;
  cities: CityEconomicState[];
  error?: string;
};

export type EconomicEventsResponse = {
  worldEvents: WorldEvent[];
  cityEvents: CityEvent[];
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
