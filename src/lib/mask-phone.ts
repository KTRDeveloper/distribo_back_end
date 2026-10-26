/** Masks a stored E.164 phone, exposing only six digits grouped for payment notices. */
export function maskPhone(e164: string): string {
  return `+${e164.slice(1, 4)} ${e164.slice(4, 5)} ${e164.slice(5, 7)}…`;
}
