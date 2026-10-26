// Regras da tabela draft (docs/data-model/tables-support.md e rules.md).
import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import {
  CHECK_VIOLATION,
  createAiRun,
  createCustomer,
  createHuman,
  createInboundMessage,
  createOutboundMessage,
  createTicket,
  expectRejected,
  FOREIGN_KEY_VIOLATION,
  NOT_NULL_VIOLATION,
  rows,
  UNIQUE_VIOLATION,
} from '../helpers.ts';

// Um ticket com a mensagem do cliente, a execução da IA que redigiu e uma resposta da equipe
// pronta para ser o message_id de um rascunho enviado.
async function scenario() {
  const customerId = await createCustomer();
  const ticketId = await createTicket(customerId);
  const staffId = await createHuman();
  const aiRunId = await createAiRun(ticketId, await createInboundMessage(ticketId, customerId));
  const messageId = await createOutboundMessage(ticketId, staffId);
  return { ticketId, aiRunId, staffId, messageId };
}

interface Draft {
  ticketId: string | null;
  aiRunId: string | null;
  body?: string | null;
  status?: string | null;
  messageId?: string | null;
  edited?: boolean | null;
  decidedByStaffId?: string | null;
  decided?: boolean;
}

// Monta o INSERT com todas as colunas explícitas; `decided: true` grava now() em decided_at.
function insertDraft(d: Draft) {
  const body = d.body === undefined ? 'texto proposto' : d.body;
  const status = d.status === undefined ? 'pending' : d.status;
  return sql`
    INSERT INTO draft (ticket_id, ai_run_id, body, status, message_id, edited, decided_by_staff_id,
                       decided_at, created_at)
    VALUES (${d.ticketId}::uuid, ${d.aiRunId}::uuid, ${body}, ${status}, ${d.messageId ?? null}::uuid,
            ${d.edited ?? null}::boolean, ${d.decidedByStaffId ?? null}::uuid,
            ${d.decided ? sql`now()` : sql`NULL`}, now())`;
}

type Scenario = Awaited<ReturnType<typeof scenario>>;

// Os três formatos válidos, um por status.
function sent(s: Scenario): Draft {
  return {
    ticketId: s.ticketId,
    aiRunId: s.aiRunId,
    status: 'sent',
    messageId: s.messageId,
    edited: false,
    decidedByStaffId: s.staffId,
    decided: true,
  };
}

function discarded(s: Scenario): Draft {
  return { ticketId: s.ticketId, aiRunId: s.aiRunId, status: 'discarded', decided: true };
}

function pending(s: Scenario): Draft {
  return { ticketId: s.ticketId, aiRunId: s.aiRunId };
}

// Índice comum (não parcial) que começa pela coluna. O índice único parcial dos pendentes não conta.
async function hasFullIndexStartingWith(column: string) {
  const [row] = await rows<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indrelid = 'draft'::regclass AND a.attname = ${column} AND i.indpred IS NULL`);
  return (row?.n ?? 0) > 0;
}

describe('draft', () => {
  test('o banco gera o id como UUIDv7', async () => {
    const s = await scenario();
    const [row] = await rows<{ version: number }>(
      sql`${insertDraft(pending(s))} RETURNING uuid_extract_version(id) AS version`,
    );
    expect(row?.version).toBe(7);
  });

  test('os três formatos válidos são aceitos: pending, sent e discarded', async () => {
    const s = await scenario();
    await rows(insertDraft(sent(s)));
    await rows(insertDraft(discarded(s)));
    await rows(insertDraft(pending(s)));
  });

  test('ticket_id é obrigatório', async () => {
    const s = await scenario();
    await expectRejected(insertDraft({ ...pending(s), ticketId: null }), NOT_NULL_VIOLATION);
  });

  test('ticket que não existe é recusado (FK)', async () => {
    const s = await scenario();
    await expectRejected(insertDraft({ ...pending(s), ticketId: crypto.randomUUID() }), FOREIGN_KEY_VIOLATION);
  });

  test('ai_run_id é obrigatório: todo rascunho vem de uma execução da IA', async () => {
    const s = await scenario();
    await expectRejected(insertDraft({ ...pending(s), aiRunId: null }), NOT_NULL_VIOLATION);
  });

  test('ai_run que não existe é recusada (FK)', async () => {
    const s = await scenario();
    await expectRejected(insertDraft({ ...pending(s), aiRunId: crypto.randomUUID() }), FOREIGN_KEY_VIOLATION);
  });

  test('body é obrigatório', async () => {
    const s = await scenario();
    await expectRejected(insertDraft({ ...pending(s), body: null }), NOT_NULL_VIOLATION);
  });

  test('status é obrigatório', async () => {
    const s = await scenario();
    await expectRejected(insertDraft({ ...pending(s), status: null }), NOT_NULL_VIOLATION);
  });

  test('status fora da lista é recusado', async () => {
    const s = await scenario();
    await expectRejected(insertDraft({ ...discarded(s), status: 'approved' }), CHECK_VIOLATION);
  });

  test('sent sem message_id ou sem edited é recusado', async () => {
    const s = await scenario();
    await expectRejected(insertDraft({ ...sent(s), messageId: null }), CHECK_VIOLATION);
    await expectRejected(insertDraft({ ...sent(s), edited: null }), CHECK_VIOLATION);
  });

  test('message_id ou edited fora de sent é recusado', async () => {
    const s = await scenario();
    await expectRejected(insertDraft({ ...pending(s), messageId: s.messageId }), CHECK_VIOLATION);
    await expectRejected(insertDraft({ ...pending(s), edited: false }), CHECK_VIOLATION);
    await expectRejected(insertDraft({ ...discarded(s), messageId: s.messageId }), CHECK_VIOLATION);
    await expectRejected(insertDraft({ ...discarded(s), edited: true }), CHECK_VIOLATION);
  });

  test('decided_at preenchido se, e somente se, o rascunho saiu de pending', async () => {
    const s = await scenario();
    await expectRejected(insertDraft({ ...pending(s), decided: true }), CHECK_VIOLATION);
    await expectRejected(insertDraft({ ...sent(s), decided: false }), CHECK_VIOLATION);
    await expectRejected(insertDraft({ ...discarded(s), decided: false }), CHECK_VIOLATION);
  });

  test('sent exige quem enviou; pending não tem quem decidiu', async () => {
    const s = await scenario();
    await expectRejected(insertDraft({ ...sent(s), decidedByStaffId: null }), CHECK_VIOLATION);
    await expectRejected(insertDraft({ ...pending(s), decidedByStaffId: s.staffId }), CHECK_VIOLATION);
  });

  test('discarded aceita atendente ou nulo (descartado pelo próprio sistema)', async () => {
    const s = await scenario();
    await rows(insertDraft({ ...discarded(s), decidedByStaffId: s.staffId }));
    await rows(insertDraft({ ...discarded(s), decidedByStaffId: null }));
  });

  test('mensagem ou atendente que não existe é recusado (FK)', async () => {
    const s = await scenario();
    await expectRejected(insertDraft({ ...sent(s), messageId: crypto.randomUUID() }), FOREIGN_KEY_VIOLATION);
    await expectRejected(
      insertDraft({ ...sent(s), decidedByStaffId: crypto.randomUUID() }),
      FOREIGN_KEY_VIOLATION,
    );
  });

  test('no máximo um rascunho pendente por ticket', async () => {
    const s = await scenario();
    await rows(insertDraft(pending(s)));
    await expectRejected(insertDraft(pending(s)), UNIQUE_VIOLATION);
  });

  test('o limite é só para pendentes: vários decididos convivem com um pendente', async () => {
    const s = await scenario();
    await rows(insertDraft(discarded(s)));
    await rows(insertDraft(discarded(s)));
    await rows(insertDraft(sent(s)));
    await rows(insertDraft(pending(s)));
  });

  test('o limite é por ticket: tickets diferentes têm cada um o seu pendente', async () => {
    const a = await scenario();
    const b = await scenario();
    await rows(insertDraft(pending(a)));
    await rows(insertDraft(pending(b)));
  });

  test('uma mensagem sai de um rascunho só: message_id repetido é recusado', async () => {
    const s = await scenario();
    await rows(insertDraft(sent(s)));
    await expectRejected(insertDraft(sent(s)), UNIQUE_VIOLATION);
  });

  test('ticket_id tem índice comum, além do índice parcial dos pendentes', async () => {
    expect(await hasFullIndexStartingWith('ticket_id')).toBe(true);
  });

  test('o banco preenche o created_at quando ele não vem no INSERT', async () => {
    const s = await scenario();
    const [row] = await rows<{ filled: boolean }>(sql`
      INSERT INTO draft (ticket_id, ai_run_id, body, status)
      VALUES (${s.ticketId}::uuid, ${s.aiRunId}::uuid, 'texto', 'pending')
      RETURNING created_at IS NOT NULL AS filled`);
    expect(row?.filled).toBe(true);
  });

  // Cada exclusão abaixo apaga uma linha que só o rascunho referencia; assim o que recusa é a FK do draft.
  test('apagar a ai_run ou a mensagem de um rascunho é recusado: sem ON DELETE CASCADE', async () => {
    const s = await scenario();
    await rows(insertDraft(sent(s)));
    await expectRejected(sql`DELETE FROM ai_run WHERE id = ${s.aiRunId}::uuid`, FOREIGN_KEY_VIOLATION);
    await expectRejected(sql`DELETE FROM message WHERE id = ${s.messageId}::uuid`, FOREIGN_KEY_VIOLATION);
  });

  test('apagar um ticket que tem rascunho é recusado: sem ON DELETE CASCADE', async () => {
    const s = await scenario();
    // Ticket só com o rascunho: a ai_run e as mensagens ficam no ticket do cenário.
    const lonelyTicketId = await createTicket(await createCustomer());
    await rows(insertDraft({ ...pending(s), ticketId: lonelyTicketId }));
    await expectRejected(sql`DELETE FROM ticket WHERE id = ${lonelyTicketId}::uuid`, FOREIGN_KEY_VIOLATION);
  });
});
