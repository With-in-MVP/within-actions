/**
 * Personal email domain classification
 */

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'icloud.com', 'proton.me', 'aol.com', 'live.com',
  'protonmail.com', 'mail.com', 'zoho.com', 'yandex.com',
  'gmx.com', 'fastmail.com', 'tutanota.com', 'hey.com',
]);

export function isPersonalDomain(domain: string): boolean {
  return PERSONAL_DOMAINS.has(domain.toLowerCase());
}
