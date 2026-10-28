// Regras da tabela ticket_embedding (docs/data-model/tables-support.md e rules.md).
import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import {
  createCustomer,
  createInboundMessage,
  createTicket,
  DATA_EXCEPTION,
  expectRejected,
  FOREIGN_KEY_VIOLATION,
  NOT_NULL_VIOLATION,
  rows,
  UNIQUE_VIOLATION,
} from '../helpers.ts';

const DIMENSIONS = 1024;

// Um ticket com a primeira mensagem do cliente, a que gera o vetor.
async function scenario() {
  const customerId = await createCustomer();
  const ticketId = await createTicket(customerId);
  const sourceMessageId = await createInboundMessage(ticketId, customerId);
  return { ticketId, sourceMessageId };
}

// Vetor no formato de texto do pgvector ('[a,b,...]'), com `hot` em 1 e o resto em 0.
function vectorText(hot = 0, dimensions = DIMENSIONS): string {
  return `[${Array.from({ length: dimensions }, (_, i) => (i === hot ? 1 : 0)).join(',')}]`;
}

interface TicketEmbedding {
  ticketId: string | null;
  sourceMessageId: string | null;
  model?: string | null;
  embedding?: string | null;
}

// Monta o INSERT com todas as colunas explícitas; o vetor vai como texto e vira vector no banco.
function insertEmbedding(e: TicketEmbedding) {
  const model = e.model === undefined ? 'Qwen/Qwen3-Embedding-0.6B' : e.model;
  const embedding = e.embedding === undefined ? vectorText() : e.embedding;
  return sql`
    INSERT INTO ticket_embedding (ticket_id, source_message_id, model, embedding, created_at)
    VALUES (${e.ticketId}::uuid, ${e.sourceMessageId}::uuid, ${model}, ${embedding}::vector, now())`;
}

// O índice existe se alguma entrada de pg_index começa pela coluna.
async function hasIndexStartingWith(column: string) {
  const [row] = await rows<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indrelid = 'ticket_embedding'::regclass AND a.attname = ${column}`);
  return (row?.n ?? 0) > 0;
}

describe('ticket_embedding', () => {
  test('um vetor válido é aceito', async () => {
    await rows(insertEmbedding(await scenario()));
  });

  test('a coluna embedding é vector(1024)', async () => {
    const [row] = await rows<{ type: string }>(sql`
      SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
      WHERE attrelid = 'ticket_embedding'::regclass AND attname = 'embedding'`);
    expect(row?.type).toBe('vector(1024)');
  });

  test('vetor com outro número de dimensões é recusado', async () => {
    const s = await scenario();
    await expectRejected(insertEmbedding({ ...s, embedding: vectorText(0, 768) }), DATA_EXCEPTION);
    await expectRejected(insertEmbedding({ ...s, embedding: vectorText(0, 1025) }), DATA_EXCEPTION);
  });

  test('um vetor por ticket: o segundo do mesmo ticket é recusado', async () => {
    const s = await scenario();
    await rows(insertEmbedding(s));
    await expectRejected(insertEmbedding(s), UNIQUE_VIOLATION);
  });

  test('tickets diferentes têm cada um o seu vetor', async () => {
    await rows(insertEmbedding(await scenario()));
    await rows(insertEmbedding(await scenario()));
  });

  test('ticket_id, source_message_id, model e embedding são obrigatórios', async () => {
    const s = await scenario();
    await expectRejected(insertEmbedding({ ...s, ticketId: null }), NOT_NULL_VIOLATION);
    await expectRejected(insertEmbedding({ ...s, sourceMessageId: null }), NOT_NULL_VIOLATION);
    await expectRejected(insertEmbedding({ ...s, model: null }), NOT_NULL_VIOLATION);
    await expectRejected(insertEmbedding({ ...s, embedding: null }), NOT_NULL_VIOLATION);
  });

  test('ticket ou mensagem que não existe é recusado (FK)', async () => {
    const s = await scenario();
    await expectRejected(insertEmbedding({ ...s, ticketId: crypto.randomUUID() }), FOREIGN_KEY_VIOLATION);
    await expectRejected(
      insertEmbedding({ ...s, sourceMessageId: crypto.randomUUID() }),
      FOREIGN_KEY_VIOLATION,
    );
  });

  test('source_message_id tem índice', async () => {
    expect(await hasIndexStartingWith('source_message_id')).toBe(true);
  });

  test('embedding tem índice HNSW com vector_cosine_ops', async () => {
    const indexes = await rows<{ method: string; opclass: string }>(sql`
      SELECT am.amname AS method, opc.opcname AS opclass
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_am am ON am.oid = c.relam
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
      JOIN pg_opclass opc ON opc.oid = i.indclass[0]
      WHERE i.indrelid = 'ticket_embedding'::regclass AND a.attname = 'embedding'`);
    expect(indexes).toContainEqual({ method: 'hnsw', opclass: 'vector_cosine_ops' });
  });

  test('a busca por cosseno devolve primeiro o vetor mais parecido', async () => {
    const near = await scenario();
    const far = await scenario();
    await rows(insertEmbedding({ ...near, embedding: vectorText(0) }));
    await rows(insertEmbedding({ ...far, embedding: vectorText(1) }));
    const found = await rows<{ ticket_id: string }>(sql`
      SELECT ticket_id FROM ticket_embedding
      WHERE ticket_id IN (${near.ticketId}::uuid, ${far.ticketId}::uuid)
      ORDER BY embedding <=> ${vectorText(0)}::vector
      LIMIT 1`);
    expect(found).toEqual([{ ticket_id: near.ticketId }]);
  });

  test('o banco preenche o created_at quando ele não vem no INSERT', async () => {
    const s = await scenario();
    const [row] = await rows<{ filled: boolean }>(sql`
      INSERT INTO ticket_embedding (ticket_id, source_message_id, model, embedding)
      VALUES (${s.ticketId}::uuid, ${s.sourceMessageId}::uuid, 'modelo', ${vectorText()}::vector)
      RETURNING created_at IS NOT NULL AS filled`);
    expect(row?.filled).toBe(true);
  });

  test('apagar o ticket ou a mensagem de um vetor é recusado: sem ON DELETE CASCADE', async () => {
    // Ticket e mensagem que só o vetor referencia; assim o que recusa é a FK da ticket_embedding.
    const customerId = await createCustomer();
    const ticketId = await createTicket(customerId);
    const otherTicketId = await createTicket(customerId);
    const sourceMessageId = await createInboundMessage(otherTicketId, customerId);
    await rows(insertEmbedding({ ticketId, sourceMessageId }));
    await expectRejected(sql`DELETE FROM ticket WHERE id = ${ticketId}::uuid`, FOREIGN_KEY_VIOLATION);
    await expectRejected(sql`DELETE FROM message WHERE id = ${sourceMessageId}::uuid`, FOREIGN_KEY_VIOLATION);
  });
});
