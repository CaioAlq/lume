import { index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { customer } from './customer.ts';
import { ticket } from './ticket.ts';

// Participantes do ticket além de quem o abriu: um colega que veio em Cc e deve receber as
// respostas (docs/data-model/tables-support.md). Quem abriu o ticket não entra aqui — fica só em
// ticket.customer_id (P28).
//
// A chave é o par (ticket_id, customer_id): a mesma pessoa não entra duas vezes no mesmo ticket
// (P27). Por isso a tabela não tem id próprio.
export const ticketParticipant = pgTable(
  'ticket_participant',
  {
    ticketId: uuid('ticket_id').references(() => ticket.id).notNull(),
    customerId: uuid('customer_id').references(() => customer.id).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.ticketId, table.customerId] }),
    // O índice da PK começa por ticket_id; a busca "tickets de que a pessoa participa" precisa de
    // um índice próprio começando por customer_id (o Postgres não cria índice para FK sozinho).
    index('ticket_participant_customer_id_idx').on(table.customerId),
  ],
);
