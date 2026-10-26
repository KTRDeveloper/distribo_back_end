import type { PeriodRow } from './subscription.repository.js';
import type { AfterEnd } from './owner-view.service.js';
import type { PackMonths } from '../../shared/plans.js';

export type AdjustmentInput =
  | { kind: 'GIFT'; plan: PaidPlanCode; days: number }
  | { kind: 'PAYMENT_RECORDED'; plan: PaidPlanCode; months: PackMonths; amount: bigint }
  | { kind: 'REFUNDED'; plan: PaidPlanCode; amount: bigint };

type PaidPlanCode = PeriodRow['plan'];

/**
 * Builds an adjustment notice without exposing the administrator or their reason (BIL-036).
 * @param language Active owner's stored language.
 * @param input Applied gift, recorded payment or refund.
 * @returns Localized plain text with grouped integer amounts.
 */
export function adjustmentNotice(language: 'FR' | 'EN', input: AdjustmentInput): string {
  const plan = input.plan === 'ESSENTIAL'
    ? (language === 'FR' ? 'Essentiel' : 'Essential')
    : input.plan === 'ENTERPRISE' ? (language === 'FR' ? 'Entreprise' : 'Enterprise') : 'Pro';
  if (input.kind === 'GIFT') {
    return language === 'FR'
      ? `Cadeau : ${input.days} jours de forfait ${plan} offerts à votre commerce.`
      : `Gift: ${input.days} days of the ${plan} plan added to your business.`;
  }
  const amount = new Intl.NumberFormat(language === 'FR' ? 'fr-FR' : 'en-US')
    .format(input.amount).replace(/\u202f/g, ' ');
  if (input.kind === 'PAYMENT_RECORDED') {
    return language === 'FR'
      ? `Paiement de ${amount} enregistré par Distribo : forfait ${plan}, ${input.months} mois.`
      : `Payment of ${amount} recorded by Distribo: ${plan} plan, ${input.months} ${input.months === 1 ? 'month' : 'months'}.`;
  }
  return language === 'FR'
    ? `Remboursement de ${amount} : le forfait ${plan} acheté par ce paiement est arrêté.`
    : `Refund of ${amount}: the ${plan} plan bought with that payment has ended.`;
}

/**
 * Builds the payment notice from an already masked phone, never the payer's full number.
 * @param language Active owner's stored language.
 * @param input Confirmed amount, masked payer number and purchased period end.
 * @returns Localized plain text using the Douala calendar date (BIL-035).
 */
export function paidNotice(language: 'FR' | 'EN', input: {
  amount: bigint; maskedPhone: string; plan: PaidPlanCode; planEndsAt: Date;
}): string {
  const locale = language === 'FR' ? 'fr-FR' : 'en-US';
  const amount = new Intl.NumberFormat(locale).format(input.amount).replace(/\u202f/g, ' ');
  const date = new Intl.DateTimeFormat(locale, {
    timeZone: 'Africa/Douala', day: 'numeric', month: 'long', year: 'numeric',
  }).format(input.planEndsAt);
  const plan = input.plan === 'ESSENTIAL'
    ? (language === 'FR' ? 'Essentiel' : 'Essential')
    : input.plan === 'ENTERPRISE' ? (language === 'FR' ? 'Entreprise' : 'Enterprise') : 'Pro';
  if (language === 'EN') {
    return `Payment of ${amount} received from ${input.maskedPhone}: ${plan} active until ${date}.`;
  }
  return `Paiement de ${amount} reçu du ${input.maskedPhone} : ${plan} actif jusqu'au ${date}.`;
}

/**
 * Builds an owner reminder with aggregate pause counts only, never personal data.
 * @param language Active owner's stored language.
 * @param input Locked plan-chain end and optional seven-day impact preview.
 * @returns Plain text using the Douala calendar date.
 */
export function reminderNotice(language: 'FR' | 'EN', input: {
  daysBefore: 7 | 1 | 0; plan: PaidPlanCode; planEndsAt: Date; afterEnd: AfterEnd | null;
}): string {
  const plan = input.plan === 'ESSENTIAL'
    ? (language === 'FR' ? 'Essentiel' : 'Essential') : 'Pro';
  if (input.daysBefore !== 7) {
    if (language === 'EN') return `Your ${plan} plan ends ${input.daysBefore === 1 ? 'tomorrow' : 'today'}.`;
    return `Votre forfait ${plan} se termine ${input.daysBefore === 1 ? 'demain' : "aujourd'hui"}.`;
  }
  const date = new Intl.DateTimeFormat(language === 'FR' ? 'fr-FR' : 'en-US', {
    timeZone: 'Africa/Douala', day: 'numeric', month: 'long', year: 'numeric',
  }).format(input.planEndsAt);
  const counts: string[] = [];
  const collaborators = input.afterEnd?.collaborators_to_pause ?? 0;
  const products = input.afterEnd?.products_to_pause ?? 0;
  if (collaborators > 0) counts.push(`${collaborators} ${language === 'FR'
    ? (collaborators === 1 ? 'collaborateur' : 'collaborateurs')
    : (collaborators === 1 ? 'collaborator' : 'collaborators')}`);
  if (products > 0) counts.push(`${products} ${language === 'FR'
    ? (products === 1 ? 'produit' : 'produits')
    : (products === 1 ? 'product' : 'products')}`);
  if (language === 'EN') {
    const suffix = counts.length ? `: ${counts.join(' and ')} will be paused.` : '.';
    return `Your ${plan} plan ends on ${date}${suffix}`;
  }
  const suffix = counts.length ? ` : ${counts.join(' et ')} seront mis en pause.` : '.';
  return `Votre forfait ${plan} se termine le ${date}${suffix}`;
}

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
