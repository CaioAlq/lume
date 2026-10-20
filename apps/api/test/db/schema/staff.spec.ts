// Regras da tabela staff (docs/data-model/tables-core.md e rules.md).
import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { CHECK_VIOLATION, expectRejected, rows, UNIQUE_VIOLATION, unique } from '../helpers.ts';

function insertStaff(kind: string, email: string | null, passwordHash: string | null) {
  return sql`
    INSERT INTO staff (kind, display_name, email, password_hash, active, created_at)
    VALUES (${kind}, 'teste', ${email}, ${passwordHash}, true, now())`;
}

describe('staff', () => {
  test('a migração inicial cria exatamente uma linha da IA, sem login', async () => {
    const ai = await rows<{ email: string | null; password_hash: string | null }>(
      sql`SELECT email, password_hash FROM staff WHERE kind = 'ai'`,
    );
    expect(ai).toHaveLength(1);
    expect(ai[0]?.email).toBeNull();
    expect(ai[0]?.password_hash).toBeNull();
  });

  test('o banco gera o id como UUIDv7', async () => {
    const [row] = await rows<{ version: number }>(
      sql`${insertStaff('human', unique('id') + '@x.com', 'hash')} RETURNING uuid_extract_version(id) AS version`,
    );
    expect(row?.version).toBe(7);
  });

  test('humano com e-mail e senha é aceito', async () => {
    await rows(insertStaff('human', unique('ana') + '@x.com', 'hash'));
  });

  test('humano sem senha é recusado', async () => {
    await expectRejected(insertStaff('human', unique('bia') + '@x.com', null), CHECK_VIOLATION);
  });

  test('humano sem e-mail é recusado', async () => {
    await expectRejected(insertStaff('human', null, 'hash'), CHECK_VIOLATION);
  });

  test('IA com e-mail ou senha é recusada (a IA não faz login)', async () => {
    await expectRejected(insertStaff('ai', unique('ia') + '@x.com', null), CHECK_VIOLATION);
    await expectRejected(insertStaff('ai', null, 'hash'), CHECK_VIOLATION);
  });

  test('kind fora de human/ai é recusado', async () => {
    await expectRejected(insertStaff('robot', null, null), CHECK_VIOLATION);
  });

  test('e-mail de login repetido é recusado', async () => {
    const email = unique('caio') + '@x.com';
    await rows(insertStaff('human', email, 'hash'));
    await expectRejected(insertStaff('human', email, 'hash'), UNIQUE_VIOLATION);
  });
});
