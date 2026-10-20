// Regras da tabela ticket (docs/data-model/tables-core.md e rules.md).
import { describe, expect, test } from 'bun:test';
import { sql, type SQL } from 'drizzle-orm';
import {
  CHECK_VIOLATION,
  createCustomer,
  createHuman,
  createTicket,
  expectRejected,
  FOREIGN_KEY_VIOLATION,
  rows,
} from '../helpers.ts';

function insertTicket(customerId: string, status: string, resolvedAt: SQL | null, urgency: string | null = null) {
  return sql`
    INSERT INTO ticket (customer_id, subject, status, urgency, archived, created_at, resolved_at)
    VALUES (${customerId}::uuid, 'assunto', ${status}, ${urgency}, false, now(), ${resolvedAt ?? sql`NULL`})`;
}

describe('ticket', () => {
  test('o banco gera o id como UUIDv7', async () => {
    const customerId = await createCustomer();
    const [row] = await rows<{ version: number }>(
      sql`${insertTicket(customerId, 'open', null)} RETURNING uuid_extract_version(id) AS version`,
    );
    expect(row?.version).toBe(7);
  });

  test('ticket de um cliente que não existe é recusado (FK)', async () => {
    await expectRejected(insertTicket(crypto.randomUUID(), 'open', null), FOREIGN_KEY_VIOLATION);
  });

  test('responsável (staff_id) é opcional, mas tem que existir', async () => {
    const customerId = await createCustomer();
    const ticketId = await createTicket(customerId);
    const staffId = await createHuman();
    await rows(sql`UPDATE ticket SET staff_id = ${staffId}::uuid WHERE id = ${ticketId}::uuid`);
    await expectRejected(
      sql`UPDATE ticket SET staff_id = ${crypto.randomUUID()}::uuid WHERE id = ${ticketId}::uuid`,
      FOREIGN_KEY_VIOLATION,
    );
  });

  test('status só aceita open, awaiting_staff, awaiting_customer e resolved', async () => {
    const customerId = await createCustomer();
    for (const status of ['open', 'awaiting_staff', 'awaiting_customer']) {
      await rows(insertTicket(customerId, status, null));
    }
    await rows(insertTicket(customerId, 'resolved', sql`now()`));
    await expectRejected(insertTicket(customerId, 'closed', null), CHECK_VIOLATION);
  });

  test('resolvido sem resolved_at é recusado', async () => {
    const customerId = await createCustomer();
    await expectRejected(insertTicket(customerId, 'resolved', null), CHECK_VIOLATION);
  });

  test('resolved_at preenchido num ticket não resolvido é recusado', async () => {
    const customerId = await createCustomer();
    await expectRejected(insertTicket(customerId, 'awaiting_staff', sql`now()`), CHECK_VIOLATION);
  });

  test('reabrir um ticket exige limpar o resolved_at', async () => {
    const customerId = await createCustomer();
    const [row] = await rows<{ id: string }>(sql`${insertTicket(customerId, 'resolved', sql`now()`)} RETURNING id`);
    await expectRejected(
      sql`UPDATE ticket SET status = 'awaiting_staff' WHERE id = ${row?.id}::uuid`,
      CHECK_VIOLATION,
    );
    await rows(sql`UPDATE ticket SET status = 'awaiting_staff', resolved_at = NULL WHERE id = ${row?.id}::uuid`);
  });

  test('urgency só aceita low, normal, high e urgent, ou nulo', async () => {
    const customerId = await createCustomer();
    for (const urgency of ['low', 'normal', 'high', 'urgent']) {
      await rows(insertTicket(customerId, 'open', null, urgency));
    }
    await expectRejected(insertTicket(customerId, 'open', null, 'critical'), CHECK_VIOLATION);
  });

  test('um ticket não é duplicado de si mesmo, mas pode ser de outro', async () => {
    const customerId = await createCustomer();
    const original = await createTicket(customerId);
    const duplicate = await createTicket(customerId);
    await expectRejected(
      sql`UPDATE ticket SET duplicate_of_ticket_id = id WHERE id = ${duplicate}::uuid`,
      CHECK_VIOLATION,
    );
    await rows(sql`UPDATE ticket SET duplicate_of_ticket_id = ${original}::uuid WHERE id = ${duplicate}::uuid`);
    await expectRejected(
      sql`UPDATE ticket SET duplicate_of_ticket_id = ${crypto.randomUUID()}::uuid WHERE id = ${duplicate}::uuid`,
      FOREIGN_KEY_VIOLATION,
    );
  });

  test('assunto pode ser texto vazio', async () => {
    const customerId = await createCustomer();
    await rows(sql`
      INSERT INTO ticket (customer_id, subject, status, archived, created_at)
      VALUES (${customerId}::uuid, '', 'open', false, now())`);
  });

  test('archived independe do status: dá para arquivar sem resolver', async () => {
    const customerId = await createCustomer();
    await rows(sql`
      INSERT INTO ticket (customer_id, subject, status, archived, created_at)
      VALUES (${customerId}::uuid, 'spam', 'open', true, now())`);
  });

  test('apagar um cliente que tem ticket é recusado: sem ON DELETE CASCADE', async () => {
    const customerId = await createCustomer();
    await createTicket(customerId);
    await expectRejected(sql`DELETE FROM customer WHERE id = ${customerId}::uuid`, FOREIGN_KEY_VIOLATION);
  });

  test('customer_id tem índice próprio (o Postgres não cria índice para FK sozinho)', async () => {
    const [row] = await rows<{ n: number }>(sql`
      SELECT count(*)::int AS n
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
      WHERE i.indrelid = 'ticket'::regclass AND a.attname = 'customer_id'`);
    expect(row?.n).toBeGreaterThan(0);
  });
});
