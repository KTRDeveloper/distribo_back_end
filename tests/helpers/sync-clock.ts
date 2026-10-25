/**
 * The `last_pulled_at` of a push sent right after seeding rows.
 *
 * The database stamps `server_updated_at` to the microsecond while the phone's `last_pulled_at` is
 * in whole milliseconds. A push sent in the same millisecond as the seeding would see the seeded
 * row as changed after the last pull and answer 409 SYNC_CONFLICT. Waiting 2 ms puts the pull time
 * strictly after every row seeded before the call.
 */
export async function pulledAtAfterSeeding(): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, 2));
  return Date.now();
}
