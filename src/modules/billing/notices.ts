/**
 * Builds a localized seat notice containing the business name, never another person's data.
 * @param kind Seat transition that actually occurred.
 * @param language Recipient's stored language.
 * @param businessName Name from the tenant's organization summary.
 * @returns Plain text for the notification service.
 */
export function seatNotice(
  kind: 'PAUSED' | 'RESUMED',
  language: 'FR' | 'EN',
  businessName: string
): string {
  if (language === 'EN') {
    return kind === 'PAUSED'
      ? `Your access is paused for ${businessName} under the business's subscription plan.`
      : `Your access to ${businessName} has resumed under the business's subscription plan.`;
  }
  return kind === 'PAUSED'
    ? `Votre acces est mis en pause pour ${businessName} selon son abonnement.`
    : `Votre acces a repris pour ${businessName} selon son abonnement.`;
}

/**
 * Builds a localized aggregate product notice with no product names or identifiers.
 * @param kind Product transition that actually occurred.
 * @param language Owner's stored language.
 * @param count Number of changed products.
 * @returns Plain text containing only the count and the subscription explanation.
 */
export function productsNotice(
  kind: 'PAUSED' | 'RESUMED',
  language: 'FR' | 'EN',
  count: number
): string {
  if (language === 'EN') {
    return kind === 'PAUSED'
      ? `${count} products paused under your subscription plan.`
      : `${count} products resumed under your subscription plan.`;
  }
  return kind === 'PAUSED'
    ? `${count} produits mis en pause selon votre abonnement.`
    : `${count} produits remis en vente selon votre abonnement.`;
}
