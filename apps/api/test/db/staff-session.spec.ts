// Regras da tabela staff_session (docs/data-model/tables-core.md, rules.md e apps/api/docs/db.md).
import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { expectRejected, FOREIGN_KEY_VIOLATION, rows, UNIQUE_VIOLATION, unique } from './helpers.ts';

async function createHuman(): Promise<string> {
  const [row] = await rows<{ id: string }>(sql`
    INSERT INTO staff (kind, display_name, email, password_hash, active, created_at)
    VALUES ('human', 'teste', ${unique('s') + '@x.com'}, 'hash', true, now())
    RETURNING id`);
  if (!row) throw new Error('não conseguiu criar o staff de teste');
  return row.id;
}

function insertSession(staffId: string, tokenHash: string) {
  return sql`
    INSERT INTO staff_session (staff_id, token_hash, created_at, expires_at, last_seen_at)
    VALUES (${staffId}::uuid, ${tokenHash}, now(), now() + interval '1 day', now())`;
}

describe('staff_session', () => {
  test('o banco gera o id como UUIDv7', async () => {
    const staffId = await createHuman();
    const [row] = await rows<{ version: number }>(
      sql`${insertSession(staffId, unique('t'))} RETURNING uuid_extract_version(id) AS version`,
    );
    expect(row?.version).toBe(7);
  });

  test('sessão de um staff que não existe é recusada (FK)', async () => {
    await expectRejected(insertSession(crypto.randomUUID(), unique('t')), FOREIGN_KEY_VIOLATION);
  });

  test('token_hash repetido é recusado', async () => {
    const staffId = await createHuman();
    const tokenHash = unique('t');
    await rows(insertSession(staffId, tokenHash));
    await expectRejected(insertSession(staffId, tokenHash), UNIQUE_VIOLATION);
  });

  test('staff_id tem índice próprio (o Postgres não cria índice para FK sozinho)', async () => {
    const [row] = await rows<{ n: number }>(sql`
      SELECT count(*)::int AS n
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
      WHERE i.indrelid = 'staff_session'::regclass AND a.attname = 'staff_id'`);
    expect(row?.n).toBeGreaterThan(0);
  });

  test('apagar um staff que tem sessão é recusado: sem ON DELETE CASCADE', async () => {
    const staffId = await createHuman();
    await rows(insertSession(staffId, unique('t')));
    await expectRejected(sql`DELETE FROM staff WHERE id = ${staffId}::uuid`, FOREIGN_KEY_VIOLATION);
  });
});
