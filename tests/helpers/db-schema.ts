import { prisma } from '../setup.js';

/**
 * Assert a PostgreSQL column's type, optionally including numeric precision and scale.
 *
 * The metadata query is parameterized through Prisma's tagged-template API. An
 * absent table or column is reported as a failed assertion rather than silently
 * passing.
 */
export async function expectColumnType(
  table: string,
  column: string,
  dataType: string,
  numericPrecision?: [number, number]
): Promise<void> {
  const rows = await prisma.$queryRaw<
    Array<{
      data_type: string;
      numeric_precision: number | null;
      numeric_scale: number | null;
    }>
  >`
    SELECT data_type, numeric_precision, numeric_scale
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${table}
      AND column_name = ${column}
  `;

  const actual = rows[0];
  if (!actual) {
    throw new Error(`Column ${table}.${column} does not exist`);
  }

  const normalizedExpectedType = dataType === 'timestamptz' ? 'timestamp with time zone' : dataType;
  if (actual.data_type !== normalizedExpectedType) {
    throw new Error(
      `Expected ${table}.${column} to have type ${dataType}, got ${actual.data_type}`
    );
  }

  if (numericPrecision) {
    const [precision, scale] = numericPrecision;
    if (actual.numeric_precision !== precision || actual.numeric_scale !== scale) {
      throw new Error(
        `Expected ${table}.${column} to have numeric(${precision},${scale}), got numeric(${actual.numeric_precision},${actual.numeric_scale})`
      );
    }
  }
}
