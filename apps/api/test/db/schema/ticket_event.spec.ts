// Regras da tabela ticket_event (docs/data-model/tables-support.md e rules.md).
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
} from '../helpers.ts';

const KINDS = [
  'status_changed',
  'assigned',
  'urgency_changed',
  'category_changed',
  'participant_added',
  'participant_removed',
  'marked_duplicate',
  'archived',
  'unarchived',
];

interface Event {
  ticketId: string | null;
  staffId?: string | null;
  kind?: string | null;
  detail?: object | null;
}

// Monta o INSERT com todas as colunas explícitas; o detail vai como texto e vira jsonb no banco.
function insertEvent(e: Event) {
  const kind = e.kind === undefined ? 'status_changed' : e.kind;
  const detail = e.detail ? sql`${JSON.stringify(e.detail)}::jsonb` : sql`NULL`;
  return sql`
    INSERT INTO ticket_event (ticket_id, staff_id, kind, detail, created_at)
    VALUES (${e.ticketId}::uuid, ${e.staffId ?? null}::uuid, ${kind}, ${detail}, now())`;
}

async function newTicket() {
  return createTicket(await createCustomer());
}

// O índice existe se alguma entrada de pg_index começa pela coluna.
async function hasIndexStartingWith(column: string) {
  const [row] = await rows<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indrelid = 'ticket_event'::regclass AND a.attname = ${column}`);
  return (row?.n ?? 0) > 0;
}

describe('ticket_event', () => {
  test('o banco gera o id como UUIDv7', async () => {
    const ticketId = await newTicket();
    const [row] = await rows<{ version: number }>(
      sql`${insertEvent({ ticketId })} RETURNING uuid_extract_version(id) AS version`,
    );
    expect(row?.version).toBe(7);
  });

  test('ticket_id é obrigatório', async () => {
    await expectRejected(insertEvent({ ticketId: null }), NOT_NULL_VIOLATION);
  });

  test('ticket que não existe é recusado (FK)', async () => {
    await expectRejected(insertEvent({ ticketId: crypto.randomUUID() }), FOREIGN_KEY_VIOLATION);
  });

  test('staff_id nulo é aceito: a mudança foi do próprio sistema (ex.: reabertura por e-mail)', async () => {
    const ticketId = await newTicket();
    await rows(insertEvent({ ticketId, staffId: null }));
  });

  test('staff_id preenchido é aceito quando o atendente existe', async () => {
    const ticketId = await newTicket();
    await rows(insertEvent({ ticketId, staffId: await createHuman(), kind: 'assigned' }));
  });

  test('staff que não existe é recusado (FK)', async () => {
    const ticketId = await newTicket();
    await expectRejected(insertEvent({ ticketId, staffId: crypto.randomUUID() }), FOREIGN_KEY_VIOLATION);
  });

  test('kind aceita cada um dos valores da modelagem', async () => {
    const ticketId = await newTicket();
    for (const kind of KINDS) {
      await rows(insertEvent({ ticketId, kind }));
    }
  });

  test('kind fora da lista é recusado', async () => {
    const ticketId = await newTicket();
    await expectRejected(insertEvent({ ticketId, kind: 'deleted' }), CHECK_VIOLATION);
  });

  test('kind é obrigatório', async () => {
    const ticketId = await newTicket();
    await expectRejected(insertEvent({ ticketId, kind: null }), NOT_NULL_VIOLATION);
  });

  test('detail guarda os dados da mudança como jsonb', async () => {
    const ticketId = await newTicket();
    const [row] = await rows<{ detail: unknown }>(
      sql`${insertEvent({ ticketId, detail: { from: 'open', to: 'resolved' } })} RETURNING detail`,
    );
    expect(row?.detail).toEqual({ from: 'open', to: 'resolved' });
  });

  test('detail pode ser nulo: nem toda mudança tem dados (ex.: archived)', async () => {
    const ticketId = await newTicket();
    await rows(insertEvent({ ticketId, kind: 'archived', detail: null }));
  });

  test('ticket_id e staff_id têm índice próprio (o Postgres não cria índice para FK sozinho)', async () => {
    expect(await hasIndexStartingWith('ticket_id')).toBe(true);
    expect(await hasIndexStartingWith('staff_id')).toBe(true);
  });

  test('o banco preenche o created_at quando ele não vem no INSERT', async () => {
    const ticketId = await newTicket();
    const [row] = await rows<{ filled: boolean }>(sql`
      INSERT INTO ticket_event (ticket_id, kind) VALUES (${ticketId}::uuid, 'archived')
      RETURNING created_at IS NOT NULL AS filled`);
    expect(row?.filled).toBe(true);
  });

  test('apagar um ticket que tem eventos é recusado: sem ON DELETE CASCADE', async () => {
    const ticketId = await newTicket();
    await rows(insertEvent({ ticketId }));
    await expectRejected(sql`DELETE FROM ticket WHERE id = ${ticketId}::uuid`, FOREIGN_KEY_VIOLATION);
  });
});
