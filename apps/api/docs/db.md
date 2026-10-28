---
description: Como escrever a conexão e o schema do banco na api (Drizzle + Postgres 18)
globs: apps/api/src/db/**, apps/api/drizzle/**, apps/api/drizzle.config.ts, apps/api/test/db/**
related: apps/api/docs/db-migrations.md, docs/data-model/tables-core.md, docs/data-model/tables-support.md, docs/data-model/rules.md
---

# Banco na api: Drizzle + Postgres 18

O **que** o banco guarda está em `docs/data-model/`. Este doc diz **como** escrever isso no
código. Foi conferido nas versões instaladas: `drizzle-orm` 0.45, `drizzle-kit` 0.31 e
Postgres 18 (imagem `pgvector/pgvector:pg18`). Quando sua memória discordar daqui, este doc
vale mais.

## Onde fica cada coisa

O módulo é `db`: o código fica em `apps/api/src/db/` e os testes em `apps/api/test/db/`, no mesmo
caminho.

| Arquivo | O que tem |
|---|---|
| `apps/api/src/db/client.ts` | a conexão (`db`) que o resto da api importa |
| `apps/api/src/db/schema/<tabela>.ts` | uma tabela por arquivo; o nome do arquivo é o nome da tabela |
| `apps/api/src/db/schema/index.ts` | reexporta todas as tabelas |
| `apps/api/drizzle.config.ts` | configuração do `drizzle-kit` |
| `apps/api/drizzle/` | migrações geradas; vão para o git |
| `apps/api/test/db/schema/<tabela>.spec.ts` | testes das regras de cada tabela, espelhando `src/db/schema/<tabela>.ts` |
| `apps/api/test/db/schema/index.spec.ts` | regras que valem para todas as tabelas (ex.: datas com fuso) |
| `apps/api/test/db/helpers.ts` | funções comuns aos testes do banco (não é teste) |
| `apps/api/test/setup.ts` | prepara o banco descartável dos testes (ver *Testes*, em `apps/api/docs/db-migrations.md`) |

## Conexão: `apps/api/src/db/client.ts`

Use o driver `node-postgres` com um **`Pool`** e passe o schema:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.ts';

// Falha na hora se faltar variável, em vez de montar uma conexão com "undefined".
const { DB_PASSWORD, DB_NAME, DB_PORT } = process.env;
if (!DB_PASSWORD || !DB_NAME) {
  throw new Error('Faltam DB_PASSWORD e/ou DB_NAME (ficam no .env.example da raiz)');
}

const pool = new Pool({
  host: '127.0.0.1',
  user: 'postgres',
  password: DB_PASSWORD,
  database: DB_NAME,
  port: Number(DB_PORT ?? 5432),
});

export const db = drizzle(pool, { schema });
```

Por que assim:

- **`Pool`, não `Client`.** Um `Client` atende uma consulta por vez, não reconecta se cair e
  precisa de `await client.connect()`. Sem o `connect()`, toda consulta **trava para sempre,
  sem erro** (já aconteceu neste projeto).
- **Não use `drizzle-orm/pg-proxy`.** Ele é para quando o banco fica atrás de um proxy HTTP.
  Embrulhar um `Pool` nele funciona, mas é o caminho errado e perde recursos do driver.
- **Passe o `schema`.** Sem ele, as consultas relacionais (`db.query.*`) não existem.
- `host` e `user` são fixos porque o `compose.yaml` expõe o banco em `127.0.0.1` com o
  usuário `postgres`. As variáveis são as do `.env.example`: `DB_PASSWORD`, `DB_NAME`, `DB_PORT`.

## Variáveis de ambiente

A configuração do banco local está no `.env.example` da **raiz**; um `.env` ali, se existir, vale
por cima. A api roda de dentro de `apps/api/`, e o Bun só carrega o `.env` da pasta atual. Por isso,
todo script do `package.json` que precisa do banco roda com
`bun --env-file=../../.env.example --env-file=../../.env ...` (o segundo vale por cima; se não
existir, o Bun ignora). Não copie esses arquivos para dentro de `apps/api/`.

## `apps/api/drizzle.config.ts`

```ts
import { defineConfig } from 'drizzle-kit';

// generate não conecta no banco; migrate conecta e precisa das variáveis.
const { DB_PASSWORD, DB_NAME, DB_PORT } = process.env;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    host: '127.0.0.1',
    user: 'postgres',
    password: DB_PASSWORD,
    database: DB_NAME ?? '',
    port: Number(DB_PORT ?? 5432),
    ssl: false,
  },
});
```

O config **não** lança erro quando falta variável, porque o `generate` não usa o banco e
quebraria à toa. Mas também não monta uma URL com `undefined` dentro: passa os campos
separados.

## Schema: padrões

**Nomes** — propriedade do TypeScript em **camelCase**, coluna do banco em **snake_case**, sempre
assim, em todas as tabelas: `createdAt: timestamp('created_at', ...)`, `staffId: uuid('staff_id')`.
O arquivo tem o nome da tabela, com underscore: `staff_session.ts`, não `staff-session.ts`.

**Coluna dentro de `` sql`...` ``** — sempre com `${}`: `` sql`${table.email} = lower(${table.email})` ``.
Sem o `${}`, `lower(table.email)` vai para o SQL como texto literal, e a migração gerada quebra.
Um **array** do JavaScript dentro de `` sql`...` `` vira uma lista de parâmetros (`($1, $2)`), não um
array do Postgres: para um `text[]`, monte com `` sql`ARRAY[${sql.join(valores, sql`, `)}]::text[]` ``.

**`id`** — sempre UUIDv7 gerado pelo banco, com o template `sql`:

```ts
id: uuid('id').primaryKey().default(sql`uuidv7()`),
```

**Errado:** `.default('uuidv7()')`. Com aspas, vira o **texto** `'uuidv7()'` no SQL e a
migração quebra ao aplicar: `invalid input syntax for type uuid: "uuidv7()"`.

**Datas** — sempre com fuso:

```ts
createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
```

**Valores fechados** (`kind`, `status`, `urgency`...) — `text` + `CHECK`, **não** `pgEnum`.
É decisão da modelagem: acrescentar um valor num `CHECK` é uma migração simples.

```ts
(table) => [check('staff_kind_check', sql`${table.kind} IN ('human', 'ai')`)],
```

**Nome de constraint e índice** — `<tabela>_<regra>`, ex.: `customer_email_lower`,
`staff_session_staff_id_idx`.

**FK** — `.references(() => staff.id)` **sem** `onDelete`. O padrão do Postgres (bloquear a
exclusão) é o que a modelagem quer: `staff` e `customer` nunca são apagados, só desativados.
`ON DELETE CASCADE` só entra se estiver escrito em `docs/data-model/`.

**FK para a própria tabela** (ex.: `ticket.duplicate_of_ticket_id` → `ticket`) — tipe o retorno da
função com `AnyPgColumn`:

```ts
duplicateOfTicketId: uuid('duplicate_of_ticket_id').references((): AnyPgColumn => ticket.id),
```

Sem isso, o TypeScript estrito acusa referência circular (`TS7022`). **Nunca resolva com `any`** (ex.:
`PgTableWithColumns<any>`): apaga o tipo de todas as colunas, e `status = 123` passa no typecheck.

**Índice em FK** — o Postgres não cria índice para FK sozinho. Toda coluna `*_id` usada em
busca ou `JOIN` ganha o seu:

```ts
(table) => [index('staff_session_staff_id_idx').on(table.staffId)],
```

**Vetor do pgvector** — `vector` vem de `drizzle-orm/pg-core`, com o número de dimensões. O índice
HNSW usa `.using('hnsw', ...)`, com a classe de operador na coluna:

```ts
embedding: vector('embedding', { dimensions: 1024 }).notNull(),
// ...
(table) => [index('ticket_embedding_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops'))],
```

**Regras que o banco garante** — todo `CHECK` e `UNIQUE` listado em
`docs/data-model/rules.md` entra no schema. Não deixe para validar só no código: o `mailer`
e o `worker` são Python e gravam no mesmo banco.

## Migrações e testes

Os comandos e as regras das migrações, a extensão do pgvector, a linha da IA e como os testes
do banco funcionam estão em `apps/api/docs/db-migrations.md`.

## Checklist antes de terminar uma tarefa no banco

- [ ] `id` com `` sql`uuidv7()` ``, nunca entre aspas
- [ ] propriedades em camelCase, colunas em snake_case; arquivo com o nome da tabela
- [ ] dentro de `` sql`...` ``, toda coluna com `${}`
- [ ] toda data com `withTimezone: true`
- [ ] todos os `CHECK` e `UNIQUE` de `docs/data-model/rules.md` para as tabelas tocadas
- [ ] índice em toda FK usada em busca ou `JOIN`
- [ ] nenhum `onDelete` que não esteja na modelagem
- [ ] FK para a própria tabela com `AnyPgColumn`, nunca com `any`
- [ ] se a tarefa criou a tabela `staff`: migração `--custom` com a linha da IA
- [ ] se a tarefa usou `vector` pela primeira vez: migração `--custom` da extensão antes da tabela
- [ ] `apps/api/src/db/client.ts` com `Pool` e `schema`, sem `pg-proxy`
- [ ] `bun run typecheck` passou antes do `generate`
- [ ] migração gerada com `generate`, sem `push`, e nenhuma migração gerada escrita à mão
- [ ] `bun run typecheck` e `bun run test` passam (da raiz do projeto)
