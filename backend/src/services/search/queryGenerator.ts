import { ProductIdentity } from "../../types";

/** Generates 5-10 focused search-query variations from a resolved product identity. */
export function generateSearchQueries(identity: ProductIdentity): string[] {
  const name = identity.productName !== "unknown" ? identity.productName : "";
  const brand = identity.brand !== "unknown" ? identity.brand : "";
  const sku = identity.sku !== "unknown" ? identity.sku : "";
  const color = identity.color !== "unknown" ? identity.color : "";

  const base = [name, brand].filter(Boolean).join(" ").trim();
  const queries = new Set<string>();

  if (name) queries.add(name);
  if (base) queries.add(base);
  if (brand && name) queries.add(`${brand} ${name} review`);
  if (name) queries.add(`${name} unboxing`);
  if (sku) queries.add(`${brand} ${sku}`.trim());
  if (brand && color) queries.add(`${brand} ${name} ${color}`.trim());
  if (name) queries.add(`#${name.replace(/\s+/g, "")}`);
  if (brand) queries.add(`#${brand.replace(/\s+/g, "")}`);
  if (name) queries.add(`${name} ad`);
  if (name && identity.visualFeatures.length) {
    queries.add(`${name} ${identity.visualFeatures.slice(0, 2).join(" ")}`.trim());
  }

  return Array.from(queries)
    .filter((q) => q && q.length > 1)
    .slice(0, 10);
}
