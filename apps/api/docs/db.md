---
description: Como escrever a conexão, o schema e as migrações do banco na api (Drizzle + Postgres 18)
globs: apps/api/src/db/**, apps/api/drizzle/**, apps/api/drizzle.config.ts, apps/api/test/db/**
related: docs/data-model/tables-core.md, docs/data-model/tables-support.md, docs/data-model/rules.md
---

# Banco na api: Drizzle + Postgres 18

O **que** o banco guarda está em `docs/data-model/`. Este doc diz **como** escrever isso no
código. Foi conferido nas versões instaladas: `drizzle-orm` 0.45, `drizzle-kit` 0.31 e
Postgres 18 (imagem `pgvector/pgvector:pg18`). Quando sua memória discordar daqui, este doc
vale mais.

## Onde fica cada coisa

| Arquivo | O que tem |
|---|---|
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
| `apps/api/test/setup.ts` | prepara o banco descartável dos testes (ver *Testes*) |

## Conexão: `apps/api/src/db/client.ts`

Use o driver `node-postgres` com um **`Pool`** e passe o schema:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.ts';

// Falha na hora se faltar variável, em vez de montar uma conexão com "undefined".
const { DB_PASSWORD, DB_NAME, DB_PORT } = process.env;
if (!DB_PASSWORD || !DB_NAME) {
  throw new Error('Faltam DB_PASSWORD e/ou DB_NAME (o .env fica na raiz do projeto)');
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

O `.env` fica na **raiz** do projeto, mas a api roda de dentro de `apps/api/`, e o Bun só carrega
o `.env` da pasta atual. Por isso, todo script do `package.json` que precisa do banco roda
com `bun --env-file=../../.env ...`. Não copie o `.env` para dentro de `apps/api/`.

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

**Índice em FK** — o Postgres não cria índice para FK sozinho. Toda coluna `*_id` usada em
busca ou `JOIN` ganha o seu:

```ts
(table) => [index('staff_session_staff_id_idx').on(table.staffId)],
```

**Regras que o banco garante** — todo `CHECK` e `UNIQUE` listado em
`docs/data-model/rules.md` entra no schema. Não deixe para validar só no código: o `mailer`
e o `worker` são Python e gravam no mesmo banco.

## Migrações

| Comando (de dentro de `apps/api/`) | Para quê |
|---|---|
| `bunx drizzle-kit generate --name <descricao>` | gera a migração a partir do schema; não precisa de banco |
| `bunx drizzle-kit generate --custom --name <descricao>` | cria uma migração **vazia**, já registrada, para SQL escrito à mão |

Regras:

- **Nunca `drizzle-kit push`.** Ele aplica sem gerar arquivo; o histórico se perde.
- **Rode `bun run typecheck` antes do `generate`.** O TypeScript acusa coluna que não existe mais
  (ex.: renomeou `password_hash` para `passwordHash` e um `check` ainda usa o nome antigo). Sem
  isso, o `generate` grava SQL quebrado, como `AND  IS NOT NULL`, sem dar erro.
- **Gere a migração depois de atualizar da `main`.** O Drizzle só roda migrações mais novas
  que a última aplicada; uma migração com data mais antiga, mergeada depois, é pulada em
  silêncio.
- **Nunca edite uma migração que já foi aplicada.** O Drizzle grava o hash mas não compara:
  a mudança não é detectada e o banco fica diferente do arquivo.
- Migração gerada não se edita à mão. SQL à mão vai numa migração `--custom`.
- **Migração gerada saiu errada e ainda não foi aplicada em nenhum banco** (os bancos
  descartáveis dos testes não contam): corrija o schema, **apague a pasta `apps/api/drizzle/`
  inteira** e gere tudo de novo, inclusive as `--custom`. **Nunca escreva à mão** uma migração
  gerada nem os arquivos de `meta/`: cada migração tem uma "foto" do schema em `meta/`, e se o SQL
  e a foto não baterem, o próximo `generate` cria migrações fantasmas para corrigir uma diferença
  que só existe na foto. Se não puder apagar a pasta, **pare e pergunte**.

### Inserir dados: a linha da IA

`docs/data-model/tables-core.md` diz que **a linha da IA em `staff` é criada pela migração
inicial**. Isso não sai do `generate`, que só cria tabelas. Na primeira vez que a tabela
`staff` for criada:

1. gere a migração das tabelas: `bunx drizzle-kit generate --name init`
2. crie a migração de dados: `bunx drizzle-kit generate --custom --name seed_ai_staff`
3. escreva o `INSERT` nela, **numa linha nova, abaixo do comentário**. O arquivo gerado
   termina sem quebra de linha: SQL colado no fim dele vira parte do comentário, a migração
   roda sem erro e não insere nada. A IA não tem login, então `email` e `password_hash` ficam
   nulos (o `CHECK` da tabela exige):

```sql
INSERT INTO "staff" ("kind", "display_name") VALUES ('ai', '<nome exibido da IA>');
```

O **nome exibido** da IA é decisão do projeto e não está na modelagem: se ninguém disse qual
é, **pergunte** em vez de inventar.

## Testes

As regras do banco têm testes em `apps/api/test/db/schema/`, um arquivo por tabela, no mesmo caminho
e com o mesmo nome do arquivo do schema. Eles são a prova de
que a tarefa terminou: **a tarefa só está pronta quando `bun run test` passa**.

Como funcionam: antes de tudo, o `apps/api/test/setup.ts` cria um banco descartável no Postgres do
`.env`, aplica as migrações de `apps/api/drizzle/` e conecta **pelo próprio `apps/api/src/db/client.ts`**. No fim,
apaga o banco. Então um `bun run test` verde também prova que as migrações aplicam e que a
conexão abre. Precisa do banco no ar: `bun run db:up`, da raiz.

- **Teste falhou: corrija o código, não o teste.** Os testes escrevem regras da modelagem;
  mudar um teste é mudar uma decisão do projeto, e isso se pergunta antes.
- **Tabela nova: crie o `apps/api/test/db/schema/<tabela>.spec.ts` dela** com as regras de
  `docs/data-model/rules.md`, no mesmo formato dos que já existem.
- O teste insere linhas direto com SQL, então não depende de nomes de propriedades do schema.

## Checklist antes de terminar uma tarefa no banco

- [ ] `id` com `` sql`uuidv7()` ``, nunca entre aspas
- [ ] propriedades em camelCase, colunas em snake_case; arquivo com o nome da tabela
- [ ] dentro de `` sql`...` ``, toda coluna com `${}`
- [ ] toda data com `withTimezone: true`
- [ ] todos os `CHECK` e `UNIQUE` de `docs/data-model/rules.md` para as tabelas tocadas
- [ ] índice em toda FK usada em busca ou `JOIN`
- [ ] nenhum `onDelete` que não esteja na modelagem
- [ ] se a tarefa criou a tabela `staff`: migração `--custom` com a linha da IA
- [ ] `apps/api/src/db/client.ts` com `Pool` e `schema`, sem `pg-proxy`
- [ ] `bun run typecheck` passou antes do `generate`
- [ ] migração gerada com `generate`, sem `push`, e nenhuma migração gerada escrita à mão
- [ ] `bun run typecheck` e `bun run test` passam (da raiz do projeto)
