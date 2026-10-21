// Regras da tabela message (docs/data-model/tables-core.md e rules.md).
import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import {
  CHECK_VIOLATION,
  createCustomer,
  createHuman,
  createTicket,
  expectRejected,
  FOREIGN_KEY_VIOLATION,
  NOT_NULL_VIOLATION,
  rows,
  UNIQUE_VIOLATION,
  unique,
} from '../helpers.ts';

interface Message {
  ticketId: string;
  customerId?: string | null;
  staffId?: string | null;
  messageIdHeader?: string | null;
  deliveryStatus?: string | null;
  sentAt?: boolean;
  recipients?: string[] | null;
}

// Array do JavaScript dentro de sql`...` vira uma lista de parâmetros, não um array do Postgres:
// o text[] precisa ser montado com ARRAY[...].
function textArray(values: string[] | null | undefined) {
  if (!values) return sql`NULL`;
  return sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
}

// Monta o INSERT com todas as colunas explícitas; `sentAt: true` grava now().
function insertMessage(m: Message) {
  const header = m.messageIdHeader === undefined ? `<${unique('m')}@x.com>` : m.messageIdHeader;
  return sql`
    INSERT INTO message (ticket_id, customer_id, staff_id, body, message_id_header, recorded_at,
                         delivery_status, sent_at, recipients)
    VALUES (${m.ticketId}::uuid, ${m.customerId ?? null}::uuid, ${m.staffId ?? null}::uuid, 'corpo',
            ${header}, now(), ${m.deliveryStatus ?? null}, ${m.sentAt ? sql`now()` : sql`NULL`},
            ${textArray(m.recipients)})`;
}

async function setup() {
  const customerId = await createCustomer();
  const ticketId = await createTicket(customerId);
  const staffId = await createHuman();
  return { customerId, ticketId, staffId };
}

describe('message', () => {
  test('o banco gera o id como UUIDv7', async () => {
    const { customerId, ticketId } = await setup();
    const [row] = await rows<{ version: number }>(
      sql`${insertMessage({ ticketId, customerId })} RETURNING uuid_extract_version(id) AS version`,
    );
    expect(row?.version).toBe(7);
  });

  test('mensagem de um ticket que não existe é recusada (FK)', async () => {
    const { customerId } = await setup();
    await expectRejected(insertMessage({ ticketId: crypto.randomUUID(), customerId }), FOREIGN_KEY_VIOLATION);
  });

  test('mensagem recebida: autor é o cliente, sem dados de envio', async () => {
    const { customerId, ticketId } = await setup();
    await rows(insertMessage({ ticketId, customerId }));
  });

  test('mensagem enviada: autor é a equipe, com delivery_status e recipients', async () => {
    const { ticketId, staffId } = await setup();
    await rows(insertMessage({ ticketId, staffId, deliveryStatus: 'pending', recipients: ['a@x.com'] }));
  });

  test('o autor-cliente pode ser diferente do cliente que abriu o ticket', async () => {
    const { ticketId } = await setup();
    const colleague = await createCustomer();
    await rows(insertMessage({ ticketId, customerId: colleague }));
  });

  test('exatamente um autor: sem autor é recusado', async () => {
    const { ticketId } = await setup();
    await expectRejected(insertMessage({ ticketId }), CHECK_VIOLATION);
  });

  test('exatamente um autor: cliente e equipe ao mesmo tempo é recusado', async () => {
    const { customerId, ticketId, staffId } = await setup();
    await expectRejected(
      insertMessage({ ticketId, customerId, staffId, deliveryStatus: 'pending', recipients: ['a@x.com'] }),
      CHECK_VIOLATION,
    );
  });

  test('message_id_header é obrigatório', async () => {
    const { customerId, ticketId } = await setup();
    await expectRejected(insertMessage({ ticketId, customerId, messageIdHeader: null }), NOT_NULL_VIOLATION);
  });

  test('um e-mail é processado uma vez só: message_id_header repetido é recusado', async () => {
    const { customerId, ticketId } = await setup();
    const header = `<${unique('dup')}@x.com>`;
    await rows(insertMessage({ ticketId, customerId, messageIdHeader: header }));
    await expectRejected(insertMessage({ ticketId, customerId, messageIdHeader: header }), UNIQUE_VIOLATION);
  });

  test('mensagem recebida com dados de envio é recusada', async () => {
    const { customerId, ticketId } = await setup();
    await expectRejected(insertMessage({ ticketId, customerId, deliveryStatus: 'pending' }), CHECK_VIOLATION);
    await expectRejected(insertMessage({ ticketId, customerId, recipients: ['a@x.com'] }), CHECK_VIOLATION);
    await expectRejected(insertMessage({ ticketId, customerId, sentAt: true }), CHECK_VIOLATION);
  });

  test('mensagem da equipe sem delivery_status ou sem recipients é recusada', async () => {
    const { ticketId, staffId } = await setup();
    await expectRejected(insertMessage({ ticketId, staffId, recipients: ['a@x.com'] }), CHECK_VIOLATION);
    await expectRejected(insertMessage({ ticketId, staffId, deliveryStatus: 'pending' }), CHECK_VIOLATION);
  });

  test('delivery_status só aceita pending, sent e failed', async () => {
    const { ticketId, staffId } = await setup();
    await rows(insertMessage({ ticketId, staffId, deliveryStatus: 'pending', recipients: ['a@x.com'] }));
    await rows(insertMessage({ ticketId, staffId, deliveryStatus: 'sent', sentAt: true, recipients: ['a@x.com'] }));
    await rows(insertMessage({ ticketId, staffId, deliveryStatus: 'failed', recipients: ['a@x.com'] }));
    await expectRejected(
      insertMessage({ ticketId, staffId, deliveryStatus: 'queued', recipients: ['a@x.com'] }),
      CHECK_VIOLATION,
    );
  });

  test('sent_at preenchido se, e somente se, delivery_status = sent', async () => {
    const { ticketId, staffId } = await setup();
    await expectRejected(
      insertMessage({ ticketId, staffId, deliveryStatus: 'sent', recipients: ['a@x.com'] }),
      CHECK_VIOLATION,
    );
    await expectRejected(
      insertMessage({ ticketId, staffId, deliveryStatus: 'pending', sentAt: true, recipients: ['a@x.com'] }),
      CHECK_VIOLATION,
    );
  });

  test('ticket_id tem índice próprio (o Postgres não cria índice para FK sozinho)', async () => {
    const [row] = await rows<{ n: number }>(sql`
      SELECT count(*)::int AS n
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
      WHERE i.indrelid = 'message'::regclass AND a.attname = 'ticket_id'`);
    expect(row?.n).toBeGreaterThan(0);
  });
});
