const usdCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

export function formatCurrency(value: number): string {
  return usdCurrencyFormatter.format(value);
}

export function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString("en-US");
}

export function formatNullableDateTime(value: string | Date | null | undefined, fallback = "N/A"): string {
  return value ? formatDateTime(value) : fallback;
}

export function formatLabel(value: string): string {
  return value
    .split(/[_-]/g)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function formatEmployeeType(value: string): string {
  if (value === "part_time") return "Part-Time";
  if (value === "full_time") return "Full-Time";
  return formatLabel(value);
}
