/**
 * Shared money and quantity arithmetic with integer-only precision.
 * Implements rounding to nearest franc (half up) for order line calculations.
 */

/**
 * Parses a decimal quantity string to bigint in thousandths.
 * Accepts plain decimal notation (e.g., "2.5", "0.001") with at most 3 decimal places.
 * Rejects scientific notation, negative values, and more than 3 decimal places.
 *
 * @param text - Decimal string to parse
 * @returns Quantity in thousandths as bigint
 * @throws RangeError if input is invalid (negative, scientific notation, or > 3 decimals)
 */
export function parseQuantity(text: string): bigint {
  // Reject scientific notation and other invalid formats
  if (text.includes('e') || text.includes('E') || text.includes('+')) {
    throw new RangeError('Scientific notation not allowed');
  }

  // Check for negative sign
  if (text.startsWith('-')) {
    throw new RangeError('Quantity must be non-negative');
  }

  // Simple decimal validation: split by dot
  const parts = text.split('.');

  if (parts.length > 2) {
    throw new RangeError('Invalid decimal format');
  }

  const integerPart = parts[0] || '0';
  const decimalPart = parts[1] || '';

  // Check that we have at most 3 decimal places
  if (decimalPart.length > 3) {
    throw new RangeError('At most 3 decimal places allowed');
  }

  // Verify all characters are digits
  if (!/^\d+$/.test(integerPart) || !/^\d*$/.test(decimalPart)) {
    throw new RangeError('Invalid quantity format');
  }

  // Pad decimal part to 3 digits with zeros
  const paddedDecimal = decimalPart.padEnd(3, '0');

  // Combine: integer part (multiply by 1000) + decimal part
  const result = BigInt(integerPart) * BigInt(1000) + BigInt(paddedDecimal);

  return result;
}

/**
 * Calculates line amount from quantity and unit price with proper rounding.
 * Formula: (quantity_in_thousandths × unit_price) / 1000, rounded to nearest franc (half up).
 * Both inputs must be non-negative.
 *
 * @param quantityMilli - Quantity in thousandths as bigint
 * @param unitPrice - Unit price in francs as bigint
 * @returns Line amount in francs as bigint, rounded to nearest franc (half up)
 * @throws RangeError if either input is negative
 */
export function lineAmount(quantityMilli: bigint, unitPrice: bigint): bigint {
  // Validate inputs
  if (quantityMilli < 0n) {
    throw new RangeError('Quantity must be non-negative');
  }
  if (unitPrice < 0n) {
    throw new RangeError('Unit price must be non-negative');
  }

  // Calculate: (quantityMilli × unitPrice) / 1000
  const product = quantityMilli * unitPrice;
  const quotient = product / BigInt(1000);
  const remainder = product % BigInt(1000);

  // Round half up: if remainder >= 500, round up
  if (remainder >= BigInt(500)) {
    return quotient + BigInt(1);
  }

  return quotient;
}
