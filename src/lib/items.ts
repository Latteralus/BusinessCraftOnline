export function formatItemKey(itemKey: string): string {
  return itemKey
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}
