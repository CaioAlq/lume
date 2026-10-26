// Regras da tabela ai_run (docs/data-model/tables-support.md e rules.md).
import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import {
  CHECK_VIOLATION,
  createCustomer,
  createInboundMessage,
  createTicket,
  expectRejected,
  FOREIGN_KEY_VIOLATION,
  NOT_NULL_VIOLATION,
  rows,
} from '../helpers.ts';

// Um ticket com a mensagem do cliente que dispara a IA.
async function scenario() {
  const customerId = await createCustomer();
  const ticketId = await createTicket(customerId);
  const messageId = await createInboundMessage(ticketId, customerId);
  return { ticketId, messageId };
}

interface AiRun {
  ticketId: string | null;
  messageId: string | null;
  task?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  status?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  output?: object | null;
  errorMessage?: string | null;
}

// Monta o INSERT com todas as colunas explícitas. O padrão é uma classificação com sucesso;
// o output vai como texto e vira jsonb no banco.
function insertAiRun(r: AiRun) {
  const task = r.task === undefined ? 'classify' : r.task;
  const model = r.model === undefined ? 'modelo.gguf' : r.model;
  const promptVersion = r.promptVersion === undefined ? 'v1' : r.promptVersion;
  const status = r.status === undefined ? 'succeeded' : r.status;
  const latencyMs = r.latencyMs === undefined ? 1200 : r.latencyMs;
  const output = r.output ? sql`${JSON.stringify(r.output)}::jsonb` : sql`NULL`;
  return sql`
    INSERT INTO ai_run (ticket_id, message_id, task, model, prompt_version, status, latency_ms,
                        input_tokens, output_tokens, output, error_message, created_at)
    VALUES (${r.ticketId}::uuid, ${r.messageId}::uuid, ${task}, ${model}, ${promptVersion}, ${status},
            ${latencyMs}::int, ${r.inputTokens ?? null}::int, ${r.outputTokens ?? null}::int, ${output},
            ${r.errorMessage ?? null}, now())`;
}

type Scenario = Awaited<ReturnType<typeof scenario>>;

function failed(s: Scenario): AiRun {
  return { ...s, status: 'failed', errorMessage: 'timeout' };
}

function embed(s: Scenario): AiRun {
  return { ...s, task: 'embed', promptVersion: null };
}

// O índice existe se alguma entrada de pg_index começa pela coluna.
async function hasIndexStartingWith(column: string) {
  const [row] = await rows<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indrelid = 'ai_run'::regclass AND a.attname = ${column}`);
  return (row?.n ?? 0) > 0;
}

describe('ai_run', () => {
  test('o banco gera o id como UUIDv7', async () => {
    const s = await scenario();
    const [row] = await rows<{ version: number }>(
      sql`${insertAiRun(s)} RETURNING uuid_extract_version(id) AS version`,
    );
    expect(row?.version).toBe(7);
  });

  test('output guarda o resultado como jsonb', async () => {
    const s = await scenario();
    const output = { urgency: 'high', category: 'login', confidence: 0.82 };
    const [row] = await rows<{ output: unknown }>(sql`${insertAiRun({ ...s, output })} RETURNING output`);
    expect(row?.output).toEqual(output);
  });

  test('ticket_id e message_id são obrigatórios', async () => {
    const s = await scenario();
    await expectRejected(insertAiRun({ ...s, ticketId: null }), NOT_NULL_VIOLATION);
    await expectRejected(insertAiRun({ ...s, messageId: null }), NOT_NULL_VIOLATION);
  });

  test('ticket ou mensagem que não existe é recusado (FK)', async () => {
    const s = await scenario();
    await expectRejected(insertAiRun({ ...s, ticketId: crypto.randomUUID() }), FOREIGN_KEY_VIOLATION);
    await expectRejected(insertAiRun({ ...s, messageId: crypto.randomUUID() }), FOREIGN_KEY_VIOLATION);
  });

  test('task aceita classify, embed e draft', async () => {
    const s = await scenario();
    await rows(insertAiRun({ ...s, task: 'classify' }));
    await rows(insertAiRun(embed(s)));
    await rows(insertAiRun({ ...s, task: 'draft' }));
  });

  test('task fora da lista é recusada', async () => {
    const s = await scenario();
    await expectRejected(insertAiRun({ ...s, task: 'summarize' }), CHECK_VIOLATION);
  });

  test('task, model, status e latency_ms são obrigatórios', async () => {
    const s = await scenario();
    await expectRejected(insertAiRun({ ...s, task: null }), NOT_NULL_VIOLATION);
    await expectRejected(insertAiRun({ ...s, model: null }), NOT_NULL_VIOLATION);
    await expectRejected(insertAiRun({ ...s, status: null }), NOT_NULL_VIOLATION);
    await expectRejected(insertAiRun({ ...s, latencyMs: null }), NOT_NULL_VIOLATION);
  });

  test('prompt_version é nulo no embed', async () => {
    const s = await scenario();
    await expectRejected(insertAiRun({ ...embed(s), promptVersion: 'v1' }), CHECK_VIOLATION);
  });

  test('classify e draft sempre registram a versão do prompt', async () => {
    const s = await scenario();
    await expectRejected(insertAiRun({ ...s, task: 'classify', promptVersion: null }), CHECK_VIOLATION);
    await expectRejected(insertAiRun({ ...s, task: 'draft', promptVersion: null }), CHECK_VIOLATION);
  });

  test('status fora da lista é recusado', async () => {
    const s = await scenario();
    await expectRejected(insertAiRun({ ...s, status: 'running' }), CHECK_VIOLATION);
  });

  test('falha com mensagem de erro é aceita', async () => {
    const s = await scenario();
    await rows(insertAiRun(failed(s)));
  });

  test('error_message preenchido se, e somente se, status = failed', async () => {
    const s = await scenario();
    await expectRejected(insertAiRun({ ...failed(s), errorMessage: null }), CHECK_VIOLATION);
    await expectRejected(insertAiRun({ ...s, errorMessage: 'erro' }), CHECK_VIOLATION);
  });

  test('falha não tem resultado: failed com output é recusado', async () => {
    const s = await scenario();
    await expectRejected(insertAiRun({ ...failed(s), output: { urgency: 'high' } }), CHECK_VIOLATION);
  });

  test('sucesso pode não ter output (o embed guarda o vetor na ticket_embedding)', async () => {
    const s = await scenario();
    await rows(insertAiRun({ ...embed(s), output: null }));
  });

  test('tokens podem ser nulos: nem todo servidor informa', async () => {
    const s = await scenario();
    await rows(insertAiRun({ ...s, inputTokens: null, outputTokens: null }));
  });

  test('zero é aceito em latency_ms e nos tokens', async () => {
    const s = await scenario();
    await rows(insertAiRun({ ...s, latencyMs: 0, inputTokens: 0, outputTokens: 0 }));
  });

  test('latency_ms e tokens negativos são recusados', async () => {
    const s = await scenario();
    await expectRejected(insertAiRun({ ...s, latencyMs: -1 }), CHECK_VIOLATION);
    await expectRejected(insertAiRun({ ...s, inputTokens: -1 }), CHECK_VIOLATION);
    await expectRejected(insertAiRun({ ...s, outputTokens: -1 }), CHECK_VIOLATION);
  });

  test('ticket_id e message_id têm índice próprio (o Postgres não cria índice para FK sozinho)', async () => {
    expect(await hasIndexStartingWith('ticket_id')).toBe(true);
    expect(await hasIndexStartingWith('message_id')).toBe(true);
  });

  test('o banco preenche o created_at quando ele não vem no INSERT', async () => {
    const s = await scenario();
    const [row] = await rows<{ filled: boolean }>(sql`
      INSERT INTO ai_run (ticket_id, message_id, task, model, status, latency_ms)
      VALUES (${s.ticketId}::uuid, ${s.messageId}::uuid, 'embed', 'modelo.gguf', 'succeeded', 10)
      RETURNING created_at IS NOT NULL AS filled`);
    expect(row?.filled).toBe(true);
  });

  test('apagar a mensagem que disparou a IA é recusado: sem ON DELETE CASCADE', async () => {
    const s = await scenario();
    await rows(insertAiRun(s));
    await expectRejected(sql`DELETE FROM message WHERE id = ${s.messageId}::uuid`, FOREIGN_KEY_VIOLATION);
  });

  test('apagar um ticket que tem ai_run é recusado: sem ON DELETE CASCADE', async () => {
    const s = await scenario();
    // Ticket só com a ai_run: a mensagem fica no ticket do cenário.
    const lonelyTicketId = await createTicket(await createCustomer());
    await rows(insertAiRun({ ...s, ticketId: lonelyTicketId }));
    await expectRejected(sql`DELETE FROM ticket WHERE id = ${lonelyTicketId}::uuid`, FOREIGN_KEY_VIOLATION);
  });
});
