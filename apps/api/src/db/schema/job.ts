import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { message } from './message.ts';

// A fila de trabalho entre os processos (docs/data-model/tables-support.md).
// É assim que o mailer avisa o worker que chegou e-mail, e que a api avisa o mailer
// que tem resposta para enviar.
export const job = pgTable(
  'job',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    kind: text('kind').notNull(),
    messageId: uuid('message_id').references(() => message.id).notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Um trabalho de cada tipo por mensagem: UNIQUE (kind, message_id).
    unique('job_kind_message_unique').on(table.kind, table.messageId),
    // kind é fechado: process_inbound ou send_message.
    check('job_kind_check', sql`${table.kind} IN ('process_inbound', 'send_message')`),
    // status é fechado: pending, running, done, failed.
    check('job_status_check', sql`${table.status} IN ('pending', 'running', 'done', 'failed')`),
    // attempts nunca é negativo.
    check('job_attempts_check', sql`${table.attempts} >= 0`),
    // locked_at preenchido se, e somente se, status = 'running'.
    check(
      'job_locked_at_check',
      sql`(${table.status} = 'running') = (${table.lockedAt} IS NOT NULL)`,
    ),
    // failed sempre tem last_error.
    check('job_last_error_check', sql`${table.status} <> 'failed' OR ${table.lastError} IS NOT NULL`),
    // Índice em message_id (o UNIQUE (kind, message_id) começa por kind e não serve para buscar
    // os trabalhos de uma mensagem).
    index('job_message_id_idx').on(table.messageId),
    // Índice parcial em run_after WHERE status = 'pending'.
    index('job_run_after_pending_idx').on(table.runAfter).where(
      sql`${table.status} = 'pending'`,
    ),
  ],
);
