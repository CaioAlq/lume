// Ajudantes dos testes de regra do banco. As consultas passam pelo apps/api/src/db/client.ts de verdade.
import { expect } from 'bun:test';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../../src/db/client.ts';

// Códigos de erro do Postgres para as regras que o banco garante.
export const CHECK_VIOLATION = '23514';
export const UNIQUE_VIOLATION = '23505';
export const FOREIGN_KEY_VIOLATION = '23503';
export const NOT_NULL_VIOLATION = '23502';

export async function rows<T>(query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

// O Drizzle embrulha o erro do pg; o código do Postgres fica em algum `cause` da cadeia.
function postgresCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current instanceof Error) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = current.cause;
  }
  return undefined;
}

// O banco tem que recusar o comando, e pelo motivo certo (o código do Postgres).
export async function expectRejected(query: SQL, code: string): Promise<void> {
  let error: unknown;
  try {
    await db.execute(query);
  } catch (caught) {
    error = caught;
  }
  expect(error, 'o banco aceitou um comando que a modelagem proíbe').toBeDefined();
  expect(postgresCode(error)).toBe(code);
}

// Valor único por teste, para os testes não colidirem entre si.
export function unique(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

// Linhas de apoio para os testes que precisam de um cliente, um atendente ou um ticket.
// Todas as colunas vão explícitas, para o teste não depender de valores padrão do schema.

export async function createCustomer(): Promise<string> {
  const [row] = await rows<{ id: string }>(sql`
    INSERT INTO customer (email, created_at) VALUES (${unique('c') + '@x.com'}, now()) RETURNING id`);
  if (!row) throw new Error('não conseguiu criar o customer de teste');
  return row.id;
}

export async function createHuman(): Promise<string> {
  const [row] = await rows<{ id: string }>(sql`
    INSERT INTO staff (kind, display_name, email, password_hash, active, created_at)
    VALUES ('human', 'teste', ${unique('s') + '@x.com'}, 'hash', true, now())
    RETURNING id`);
  if (!row) throw new Error('não conseguiu criar o staff de teste');
  return row.id;
}

export async function createTicket(customerId: string): Promise<string> {
  const [row] = await rows<{ id: string }>(sql`
    INSERT INTO ticket (customer_id, subject, status, archived, created_at)
    VALUES (${customerId}::uuid, 'assunto', 'open', false, now())
    RETURNING id`);
  if (!row) throw new Error('não conseguiu criar o ticket de teste');
  return row.id;
}

// Mensagem recebida do cliente: o que dispara a IA.
export async function createInboundMessage(ticketId: string, customerId: string): Promise<string> {
  const [row] = await rows<{ id: string }>(sql`
    INSERT INTO message (ticket_id, customer_id, staff_id, body, message_id_header, recorded_at,
                         delivery_status, sent_at, recipients)
    VALUES (${ticketId}::uuid, ${customerId}::uuid, NULL, 'corpo', ${`<${unique('m')}@x.com>`}, now(),
            NULL, NULL, NULL)
    RETURNING id`);
  if (!row) throw new Error('não conseguiu criar a mensagem recebida de teste');
  return row.id;
}

// Mensagem enviada pela equipe, ainda na fila de envio: o que sai de um rascunho.
export async function createOutboundMessage(ticketId: string, staffId: string): Promise<string> {
  const [row] = await rows<{ id: string }>(sql`
    INSERT INTO message (ticket_id, customer_id, staff_id, body, message_id_header, recorded_at,
                         delivery_status, sent_at, recipients)
    VALUES (${ticketId}::uuid, NULL, ${staffId}::uuid, 'corpo', ${`<${unique('m')}@x.com>`}, now(),
            'pending', NULL, ARRAY['cliente@x.com']::text[])
    RETURNING id`);
  if (!row) throw new Error('não conseguiu criar a mensagem enviada de teste');
  return row.id;
}

// Execução da IA que redigiu um rascunho, com sucesso.
export async function createAiRun(ticketId: string, messageId: string): Promise<string> {
  const [row] = await rows<{ id: string }>(sql`
    INSERT INTO ai_run (ticket_id, message_id, task, model, prompt_version, status, latency_ms,
                        input_tokens, output_tokens, output, error_message, created_at)
    VALUES (${ticketId}::uuid, ${messageId}::uuid, 'draft', 'modelo.gguf', 'v1', 'succeeded', 1000,
            NULL, NULL, NULL, NULL, now())
    RETURNING id`);
  if (!row) throw new Error('não conseguiu criar a ai_run de teste');
  return row.id;
}
