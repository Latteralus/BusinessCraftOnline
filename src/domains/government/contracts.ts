import type { ProjectedCityStockpile } from "./types";

export type CityStockpilesResponse = {
  stockpiles: ProjectedCityStockpile[];
  error?: string;
};
