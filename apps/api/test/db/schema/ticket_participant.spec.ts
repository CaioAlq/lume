// Regras da tabela ticket_participant (docs/data-model/tables-support.md e rules.md).
import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import {
  createCustomer,
  createTicket,
  expectRejected,
  FOREIGN_KEY_VIOLATION,
  rows,
  UNIQUE_VIOLATION,
} from '../helpers.ts';

function insertParticipant(ticketId: string, customerId: string) {
  return sql`
    INSERT INTO ticket_participant (ticket_id, customer_id, created_at)
    VALUES (${ticketId}::uuid, ${customerId}::uuid, now())`;
}

// Quem abriu o ticket não entra na ticket_participant (P28): o participante é sempre outro cliente.
async function setup() {
  const openerId = await createCustomer();
  const ticketId = await createTicket(openerId);
  const participantId = await createCustomer();
  return { ticketId, participantId };
}

describe('ticket_participant', () => {
  test('a mesma pessoa não entra duas vezes no mesmo ticket (PK no par)', async () => {
    const { ticketId, participantId } = await setup();
    await rows(insertParticipant(ticketId, participantId));
    await expectRejected(insertParticipant(ticketId, participantId), UNIQUE_VIOLATION);
  });

  // Os dois testes abaixo pegam um UNIQUE numa coluna só, que a modelagem proíbe.
  test('o mesmo ticket aceita mais de um participante', async () => {
    const { ticketId, participantId } = await setup();
    const otherId = await createCustomer();
    await rows(insertParticipant(ticketId, participantId));
    await rows(insertParticipant(ticketId, otherId));
  });

  test('a mesma pessoa participa de tickets diferentes', async () => {
    const { ticketId, participantId } = await setup();
    const otherTicketId = await createTicket(await createCustomer());
    await rows(insertParticipant(ticketId, participantId));
    await rows(insertParticipant(otherTicketId, participantId));
  });

  test('a tabela não tem id próprio: a chave é o par (ticket_id, customer_id)', async () => {
    const columns = await rows<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ticket_participant'
      ORDER BY column_name`);
    expect(columns.map((c) => c.column_name)).toEqual(['created_at', 'customer_id', 'ticket_id']);
  });

  test('ticket que não existe é recusado (FK)', async () => {
    const participantId = await createCustomer();
    await expectRejected(insertParticipant(crypto.randomUUID(), participantId), FOREIGN_KEY_VIOLATION);
  });

  test('customer que não existe é recusado (FK)', async () => {
    const { ticketId } = await setup();
    await expectRejected(insertParticipant(ticketId, crypto.randomUUID()), FOREIGN_KEY_VIOLATION);
  });

  test('customer_id tem índice próprio (o da PK começa por ticket_id)', async () => {
    const [row] = await rows<{ n: number }>(sql`
      SELECT count(*)::int AS n
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
      WHERE i.indrelid = 'ticket_participant'::regclass AND a.attname = 'customer_id'`);
    expect(row?.n).toBeGreaterThan(0);
  });

  test('o banco preenche o created_at quando ele não vem no INSERT', async () => {
    const { ticketId, participantId } = await setup();
    const [row] = await rows<{ filled: boolean }>(sql`
      INSERT INTO ticket_participant (ticket_id, customer_id)
      VALUES (${ticketId}::uuid, ${participantId}::uuid)
      RETURNING created_at IS NOT NULL AS filled`);
    expect(row?.filled).toBe(true);
  });

  test('apagar um ticket que tem participante é recusado: sem ON DELETE CASCADE', async () => {
    const { ticketId, participantId } = await setup();
    await rows(insertParticipant(ticketId, participantId));
    await expectRejected(sql`DELETE FROM ticket WHERE id = ${ticketId}::uuid`, FOREIGN_KEY_VIOLATION);
  });
});
