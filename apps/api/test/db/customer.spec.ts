// Regras da tabela customer (docs/data-model/tables-core.md e rules.md).
import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { CHECK_VIOLATION, expectRejected, rows, UNIQUE_VIOLATION, unique } from './helpers.ts';

describe('customer', () => {
  test('o banco gera o id como UUIDv7', async () => {
    const [row] = await rows<{ version: number }>(sql`
      INSERT INTO customer (email, created_at) VALUES (${unique('a') + '@x.com'}, now())
      RETURNING uuid_extract_version(id) AS version`);
    expect(row?.version).toBe(7);
  });

  test('display_name pode ser nulo', async () => {
    const [row] = await rows<{ display_name: string | null }>(sql`
      INSERT INTO customer (email, created_at) VALUES (${unique('b') + '@x.com'}, now())
      RETURNING display_name`);
    expect(row?.display_name).toBeNull();
  });

  test('um cliente por endereço: e-mail repetido é recusado', async () => {
    const email = unique('c') + '@x.com';
    await rows(sql`INSERT INTO customer (email, created_at) VALUES (${email}, now())`);
    await expectRejected(sql`INSERT INTO customer (email, created_at) VALUES (${email}, now())`, UNIQUE_VIOLATION);
  });

  test('e-mail sempre em minúsculas: maiúscula é recusada', async () => {
    await expectRejected(
      sql`INSERT INTO customer (email, created_at) VALUES (${unique('Joao') + '@x.com'}, now())`,
      CHECK_VIOLATION,
    );
  });
});
