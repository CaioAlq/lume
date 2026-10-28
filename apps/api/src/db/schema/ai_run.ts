import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { message } from './message.ts';
import { ticket } from './ticket.ts';

// Auditoria da IA: cada chamada a um modelo vira uma linha, com sucesso ou falha
// (docs/data-model/tables-support.md). A IA nunca sobrescreve decisão humana: se um
// atendente mudou urgência/categoria depois, a nova classificação é gravada aqui, mas
// não altera o ticket.
export const aiRun = pgTable(
  'ai_run',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    ticketId: uuid('ticket_id').references(() => ticket.id).notNull(),
    messageId: uuid('message_id').references(() => message.id).notNull(),
    task: text('task').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version'),
    status: text('status').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    output: jsonb('output'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // task é fechado: classify, embed ou draft.
    check('ai_run_task_check', sql`${table.task} IN ('classify', 'embed', 'draft')`),
    // status é fechado: succeeded ou failed.
    check('ai_run_status_check', sql`${table.status} IN ('succeeded', 'failed')`),
    // failed ⇔ error_message preenchido; falha não tem resultado (output nulo).
    check(
      'ai_run_status_error_check',
      sql`(
        (${table.status} <> 'failed' OR ${table.errorMessage} IS NOT NULL)
        AND
        (${table.errorMessage} IS NULL OR ${table.status} = 'failed')
      )`,
    ),
    check('ai_run_failed_output_check', sql`${table.status} <> 'failed' OR ${table.output} IS NULL`),
    // prompt_version nulo ⇔ task = 'embed'; classify e draft sempre registram a versão.
    check(
      'ai_run_prompt_version_check',
      sql`(
        (${table.task} <> 'embed' OR ${table.promptVersion} IS NULL)
        AND
        (${table.task} = 'embed' OR ${table.promptVersion} IS NOT NULL)
      )`,
    ),
    // Tempo e tokens nunca são negativos.
    check('ai_run_latency_check', sql`${table.latencyMs} >= 0`),
    check('ai_run_input_tokens_check', sql`${table.inputTokens} IS NULL OR ${table.inputTokens} >= 0`),
    check('ai_run_output_tokens_check', sql`${table.outputTokens} IS NULL OR ${table.outputTokens} >= 0`),
    // O Postgres não cria índice para FK sozinho: ticket_id e message_id são de auditoria.
    index('ai_run_ticket_id_idx').on(table.ticketId),
    index('ai_run_message_id_idx').on(table.messageId),
  ],
);
