import { index, pgTable, text, timestamp, uuid, vector } from 'drizzle-orm/pg-core';
import { message } from './message.ts';
import { ticket } from './ticket.ts';

// O vetor usado para achar casos parecidos já resolvidos (docs/data-model/tables-support.md).
// Um vetor por ticket: a PK é o ticket_id. O modelo é o Qwen3-Embedding-0.6B, com 1024
// dimensões, o tamanho cheio dele.
export const ticketEmbedding = pgTable(
  'ticket_embedding',
  {
    ticketId: uuid('ticket_id').primaryKey().references(() => ticket.id).notNull(),
    sourceMessageId: uuid('source_message_id').references(() => message.id).notNull(),
    model: text('model').notNull(),
    embedding: vector('embedding', { dimensions: 1024 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Índice HNSW com vector_cosine_ops para busca por similaridade de cosseno.
    index('ticket_embedding_embedding_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
    // Índice em source_message_id (a PK já cobre o ticket_id).
    index('ticket_embedding_source_message_id_idx').on(table.sourceMessageId),
  ],
);
