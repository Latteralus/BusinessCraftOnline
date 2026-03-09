export type CityRegion = "Northeast" | "West" | "Midwest" | "South" | "Southwest" | "Mountain" | "Southeast";

export const CITIES = [
  { name: "New York City", state: "New York", region: "Northeast", slug: "new-york-city" },
  { name: "Los Angeles", state: "California", region: "West", slug: "los-angeles" },
  { name: "Chicago", state: "Illinois", region: "Midwest", slug: "chicago" },
  { name: "Houston", state: "Texas", region: "South", slug: "houston" },
  { name: "Dallas", state: "Texas", region: "South", slug: "dallas" },
  { name: "Philadelphia", state: "Pennsylvania", region: "Northeast", slug: "philadelphia" },
  { name: "Phoenix", state: "Arizona", region: "Southwest", slug: "phoenix" },
  { name: "San Diego", state: "California", region: "West", slug: "san-diego" },
  { name: "Denver", state: "Colorado", region: "Mountain", slug: "denver" },
  { name: "Atlanta", state: "Georgia", region: "Southeast", slug: "atlanta" },
] as const;
