import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { aiRun } from './ai_run.ts';
import { message } from './message.ts';
import { staff } from './staff.ts';
import { ticket } from './ticket.ts';

// Rascunho de resposta escrito pela IA, esperando o atendente. Rascunho não é mensagem:
// a `message_id` (FK → `message`) só é preenchida quando o rascunho é enviado — é a mensagem
// que saiu deste rascunho. Não confundir com o `message_id_header` de um e-mail recebido.
// Quando chega resposta nova do cliente, o rascunho pendente vira descartado e a IA escreve outro.
export const draft = pgTable(
  'draft',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    ticketId: uuid('ticket_id').references(() => ticket.id).notNull(),
    aiRunId: uuid('ai_run_id').references(() => aiRun.id).notNull(),
    body: text('body').notNull(),
    status: text('status').notNull(),
    // Uma mensagem sai de um rascunho só: a `message_id` só é preenchida em `sent`, e a
    // FK única garante que ela aponta para a mensagem que saiu deste rascunho.
    messageId: uuid('message_id').references(() => message.id).unique(),
    edited: boolean('edited'),
    decidedByStaffId: uuid('decided_by_staff_id').references(() => staff.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // status é fechado: pending, sent ou discarded.
    check('draft_status_check', sql`${table.status} IN ('pending', 'sent', 'discarded')`),
    // status = 'sent' ⇔ message_id e edited estão preenchidos. Rascunho pendente ou
    // descartado não tem mensagem (a de um rascunho só sai uma: UNIQUE message_id).
    check(
      'draft_sent_check',
      sql`(
        (${table.status} <> 'sent' AND ${table.messageId} IS NULL AND ${table.edited} IS NULL)
        OR
        (${table.status} = 'sent' AND ${table.messageId} IS NOT NULL AND ${table.edited} IS NOT NULL)
      )`,
    ),
    // decided_at preenchido ⇔ o rascunho saiu de pending (sent ou discarded).
    check('draft_decided_at_check', sql`(${table.status} <> 'pending') = (${table.decidedAt} IS NOT NULL)`),
    // pending não tem quem decidiu; sent exige quem enviou; discarded aceita com ou sem atendente.
    check(
      'draft_decided_by_staff_check',
      sql`(
        (${table.status} <> 'pending' OR ${table.decidedByStaffId} IS NULL)
        AND
        (${table.status} <> 'sent' OR ${table.decidedByStaffId} IS NOT NULL)
      )`,
    ),
    // O Postgres não cria índice para FK sozinho.
    index('draft_ticket_id_idx').on(table.ticketId),
    index('draft_ai_run_id_idx').on(table.aiRunId),
    index('draft_decided_by_staff_id_idx').on(table.decidedByStaffId),
    // No máximo um rascunho pendente por ticket: índice único parcial.
    uniqueIndex('draft_ticket_id_pending_unique').on(table.ticketId).where(sql`${table.status} = 'pending'`),

  ],
);
