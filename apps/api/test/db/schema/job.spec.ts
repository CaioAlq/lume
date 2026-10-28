// Regras da tabela job (docs/data-model/tables-support.md e rules.md).
import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { db } from '../../../src/db/client.ts';
import {
  CHECK_VIOLATION,
  createCustomer,
  createInboundMessage,
  createTicket,
  expectRejected,
  FOREIGN_KEY_VIOLATION,
  NOT_NULL_VIOLATION,
  rows,
  UNIQUE_VIOLATION,
} from '../helpers.ts';

// Uma mensagem recebida, a que o worker vai processar.
async function createMessage(): Promise<string> {
  const customerId = await createCustomer();
  return createInboundMessage(await createTicket(customerId), customerId);
}

interface Job {
  messageId: string | null;
  kind?: string | null;
  status?: string | null;
  attempts?: number | null;
  locked?: boolean;
  lastError?: string | null;
}

// Monta o INSERT com todas as colunas explícitas; `locked: true` grava now() em locked_at.
function insertJob(j: Job) {
  const kind = j.kind === undefined ? 'process_inbound' : j.kind;
  const status = j.status === undefined ? 'pending' : j.status;
  const attempts = j.attempts === undefined ? 0 : j.attempts;
  return sql`
    INSERT INTO job (kind, message_id, status, attempts, run_after, locked_at, last_error, created_at)
    VALUES (${kind}, ${j.messageId}::uuid, ${status}, ${attempts}::int, now(),
            ${j.locked ? sql`now()` : sql`NULL`}, ${j.lastError ?? null}, now())`;
}

// Os quatro formatos válidos, um por status.
function pending(messageId: string): Job {
  return { messageId };
}

function running(messageId: string): Job {
  return { messageId, status: 'running', attempts: 1, locked: true };
}

function done(messageId: string): Job {
  return { messageId, status: 'done', attempts: 1 };
}

function failed(messageId: string): Job {
  return { messageId, status: 'failed', attempts: 5, lastError: 'timeout' };
}

// Índices que começam pela coluna, com o filtro (WHERE) de cada um; null quando não tem filtro.
async function indexesStartingWith(column: string) {
  return rows<{ predicate: string | null }>(sql`
    SELECT pg_get_expr(i.indpred, i.indrelid) AS predicate
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indrelid = 'job'::regclass AND a.attname = ${column}`);
}

describe('job', () => {
  test('o banco gera o id como UUIDv7', async () => {
    const [row] = await rows<{ version: number }>(
      sql`${insertJob(pending(await createMessage()))} RETURNING uuid_extract_version(id) AS version`,
    );
    expect(row?.version).toBe(7);
  });

  test('os quatro formatos válidos são aceitos: pending, running, done e failed', async () => {
    await rows(insertJob(pending(await createMessage())));
    await rows(insertJob(running(await createMessage())));
    await rows(insertJob(done(await createMessage())));
    await rows(insertJob(failed(await createMessage())));
  });

  test('pending com tentativas anteriores e o último erro é aceito (esperando nova tentativa)', async () => {
    await rows(insertJob({ ...pending(await createMessage()), attempts: 2, lastError: 'timeout' }));
  });

  test('quem cria só informa kind e message_id: o banco preenche o resto', async () => {
    const messageId = await createMessage();
    const [row] = await rows<{ status: string; attempts: number; run_after_now: boolean; created: boolean }>(sql`
      INSERT INTO job (kind, message_id) VALUES ('process_inbound', ${messageId}::uuid)
      RETURNING status, attempts, run_after <= now() AS run_after_now, created_at IS NOT NULL AS created`);
    expect(row).toEqual({ status: 'pending', attempts: 0, run_after_now: true, created: true });
  });

  test('kind, message_id, status e attempts são obrigatórios', async () => {
    const messageId = await createMessage();
    await expectRejected(insertJob({ ...pending(messageId), kind: null }), NOT_NULL_VIOLATION);
    await expectRejected(insertJob({ ...pending(messageId), messageId: null }), NOT_NULL_VIOLATION);
    await expectRejected(insertJob({ ...pending(messageId), status: null }), NOT_NULL_VIOLATION);
    await expectRejected(insertJob({ ...pending(messageId), attempts: null }), NOT_NULL_VIOLATION);
  });

  test('run_after é obrigatório', async () => {
    const messageId = await createMessage();
    await expectRejected(
      sql`INSERT INTO job (kind, message_id, run_after) VALUES ('process_inbound', ${messageId}::uuid, NULL)`,
      NOT_NULL_VIOLATION,
    );
  });

  test('kind ou status fora da lista é recusado', async () => {
    const messageId = await createMessage();
    await expectRejected(insertJob({ ...pending(messageId), kind: 'classify' }), CHECK_VIOLATION);
    await expectRejected(insertJob({ ...done(messageId), status: 'canceled' }), CHECK_VIOLATION);
  });

  test('mensagem que não existe é recusada (FK)', async () => {
    await expectRejected(insertJob(pending(crypto.randomUUID())), FOREIGN_KEY_VIOLATION);
  });

  test('um trabalho de cada tipo por mensagem: o par repetido é recusado', async () => {
    const messageId = await createMessage();
    await rows(insertJob(pending(messageId)));
    await expectRejected(insertJob(done(messageId)), UNIQUE_VIOLATION);
  });

  test('a mesma mensagem aceita um trabalho de outro tipo', async () => {
    const messageId = await createMessage();
    await rows(insertJob(done(messageId)));
    await rows(insertJob({ ...pending(messageId), kind: 'send_message' }));
  });

  test('o mesmo tipo aceita outra mensagem', async () => {
    await rows(insertJob(pending(await createMessage())));
    await rows(insertJob(pending(await createMessage())));
  });

  test('attempts nunca é negativo', async () => {
    await expectRejected(insertJob({ ...pending(await createMessage()), attempts: -1 }), CHECK_VIOLATION);
  });

  test('locked_at preenchido se, e somente se, o trabalho está running', async () => {
    const messageId = await createMessage();
    await expectRejected(insertJob({ ...running(messageId), locked: false }), CHECK_VIOLATION);
    await expectRejected(insertJob({ ...pending(messageId), locked: true }), CHECK_VIOLATION);
    await expectRejected(insertJob({ ...done(messageId), locked: true }), CHECK_VIOLATION);
    await expectRejected(insertJob({ ...failed(messageId), locked: true }), CHECK_VIOLATION);
  });

  test('failed sem last_error é recusado', async () => {
    await expectRejected(insertJob({ ...failed(await createMessage()), lastError: null }), CHECK_VIOLATION);
  });

  test('message_id tem índice próprio', async () => {
    expect(await indexesStartingWith('message_id')).not.toEqual([]);
  });

  test('run_after tem índice parcial só dos pendentes', async () => {
    const indexes = await indexesStartingWith('run_after');
    expect(indexes.some((i) => i.predicate?.includes("'pending'"))).toBe(true);
  });

  // A consulta de tables-support.md, limitada às mensagens deste teste para não pegar as dos outros.
  test('pegar trabalho: dois processos pegam os pendentes vencidos em ordem, nunca o mesmo', async () => {
    const [older, newer, later] = [await createMessage(), await createMessage(), await createMessage()];
    await rows(sql`
      INSERT INTO job (kind, message_id, run_after) VALUES
        ('send_message', ${newer}::uuid, now() - interval '1 minute'),
        ('send_message', ${older}::uuid, now() - interval '2 minutes'),
        ('send_message', ${later}::uuid, now() + interval '1 hour')`);
    const claim = sql`
      SELECT message_id FROM job
      WHERE status = 'pending' AND run_after <= now() AND kind = 'send_message'
        AND message_id IN (${older}::uuid, ${newer}::uuid, ${later}::uuid)
      ORDER BY run_after FOR UPDATE SKIP LOCKED LIMIT 1`;

    // Cada transação é uma conexão, como um processo: o primeiro segura o mais antigo e o segundo pula ele.
    await db.transaction(async (first) => {
      expect((await first.execute(claim)).rows).toEqual([{ message_id: older }]);
      await db.transaction(async (second) => {
        expect((await second.execute(claim)).rows).toEqual([{ message_id: newer }]);
        // Um terceiro não acha nada: os vencidos estão presos e o outro ainda não venceu.
        await db.transaction(async (third) => {
          expect((await third.execute(claim)).rows).toEqual([]);
        });
      });
    });
  });

  test('apagar a mensagem de um trabalho é recusado: sem ON DELETE CASCADE', async () => {
    const messageId = await createMessage();
    await rows(insertJob(pending(messageId)));
    await expectRejected(sql`DELETE FROM message WHERE id = ${messageId}::uuid`, FOREIGN_KEY_VIOLATION);
  });
});
