import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { staff } from './staff.ts';
import { ticket } from './ticket.ts';

// Histórico do ticket: tudo o que mudou, quem mudou e quando. Só recebe INSERT — nunca UPDATE nem
// DELETE (docs/data-model/tables-support.md).
export const ticketEvent = pgTable(
  'ticket_event',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    ticketId: uuid('ticket_id').references(() => ticket.id).notNull(),
    staffId: uuid('staff_id').references(() => staff.id),
    kind: text('kind').notNull(),
    detail: jsonb('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // kind é fechado: acrescentar um valor novo é um CHECK, não um ENUM (docs/data-model/rules.md).
    check(
      'ticket_event_kind_check',
      sql`${table.kind} IN ('status_changed', 'assigned', 'urgency_changed', 'category_changed', 'participant_added', 'participant_removed', 'marked_duplicate', 'archived', 'unarchived')`,
    ),
    // O Postgres não cria índice para FK sozinho: ticket_id (histórico) e staff_id (quem fez).
    index('ticket_event_ticket_id_idx').on(table.ticketId),
    index('ticket_event_staff_id_idx').on(table.staffId),
  ],
);
