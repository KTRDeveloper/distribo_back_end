/**
 * Variant label and comparison text, shared by the app and the server (CAT-016).
 * No import on purpose: the phone bundles this file as is.
 */

/**
 * Composes the label of a variant: "Product — unit", or "Product — name (unit)"
 * when the variant has a name. A null or empty name counts as no name; nothing
 * else is changed (no trimming, no case change), so frozen order lines read as typed.
 */
export function variantLabel(
  productName: string,
  variantName: string | null,
  unit: string,
): string {
  if (variantName === null || variantName === '') {
    return `${productName} — ${unit}`;
  }
  return `${productName} — ${variantName} (${unit})`;
}

/**
 * Comparison form of a text, the TypeScript twin of the SQL expression behind the
 * unique index of CAT-018 (C-47, v5.0.0-2.2.1): null becomes empty, each run of
 * space, tab, CR and LF becomes one space, spaces at both ends go, then lower case.
 *
 * Never uses `trim()`: it also removes characters such as the non-breaking space
 * that PostgreSQL keeps. The ends are trimmed with an index loop, not a regex, so a
 * huge input stays linear (CWE-1333). Lower case of non-ASCII letters depends on
 * the database collation and is not guaranteed to match.
 */
export function simplifyText(text: string | null): string {
  const collapsed = (text ?? '').replace(/[ \t\r\n]+/g, ' ');
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed.charCodeAt(start) === 0x20) start++;
  while (end > start && collapsed.charCodeAt(end - 1) === 0x20) end--;
  return collapsed.slice(start, end).toLowerCase();
}
