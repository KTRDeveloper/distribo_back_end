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
