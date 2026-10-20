// Regras que valem para todas as tabelas do schema (o src/db/schema/index.ts reúne todas).
// Todas as datas são timestamptz (docs/data-model/overview.md).
import { expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { rows } from '../helpers.ts';

test('nenhuma coluna de data sem fuso horário', async () => {
  const withoutZone = await rows<{ table_name: string; column_name: string }>(sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'`);
  expect(withoutZone).toEqual([]);
});
