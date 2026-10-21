import { sql } from 'drizzle-orm';
import { boolean, check, index, type AnyPgColumn, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { customer } from './customer.ts';
import { staff } from './staff.ts';

// O envelope da conversa. A conversa mora na message (docs/data-model/tables-core.md).
// A FK própria (duplicate_of_ticket_id -> ticket) faz a tabela se referenciar dentro da
// própria inicialização. A anotação do retorno como AnyPgColumn quebra o ciclo de inferência
// circular sem usar `any` (que apagaria o tipo de todas as colunas, apps/api/docs/db.md).
export const ticket = pgTable(
  'ticket',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    customerId: uuid('customer_id').references(() => customer.id).notNull(),
    staffId: uuid('staff_id').references(() => staff.id),
    subject: text('subject').notNull(),
    status: text('status').notNull(),
    urgency: text('urgency'),
    category: text('category'),
    archived: boolean('archived').notNull().default(false),
    duplicateOfTicketId: uuid('duplicate_of_ticket_id').references((): AnyPgColumn => ticket.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    // Status resolvido ⇔ tem data de resolução (docs/data-model/rules.md).
    check('ticket_status_check', sql`${table.status} IN ('open', 'awaiting_staff', 'awaiting_customer', 'resolved')`),
    check('ticket_urgency_check', sql`${table.urgency} IN ('low', 'normal', 'high', 'urgent')`),
    check(
      'ticket_resolved_check',
      sql`(${table.status} = 'resolved') = (${table.resolvedAt} IS NOT NULL)`,
    ),
    // Um ticket não é duplicado de si mesmo.
    check('ticket_duplicate_check', sql`${table.duplicateOfTicketId} <> ${table.id}`),
    // FKs usadas em busca e JOIN ganham índice (o Postgres não cria sozinho).
    index('ticket_customer_id_idx').on(table.customerId),
    index('ticket_staff_id_idx').on(table.staffId),
    index('ticket_duplicate_of_ticket_id_idx').on(table.duplicateOfTicketId),
  ],
);
