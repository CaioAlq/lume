---
description: Migrações (generate, --custom, extensão do pgvector, linha da IA) e testes do banco na api
globs: apps/api/drizzle/**, apps/api/test/db/**, apps/api/test/setup.ts
related: apps/api/docs/db.md, docs/data-model/rules.md, docs/data-model/tables-support.md
---

# Banco na api: migrações e testes

Continua o `apps/api/docs/db.md`, que trata da conexão e do schema. Vale o mesmo de lá: foi
conferido nas versões instaladas, e quando sua memória discordar daqui, este doc vale mais.

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
- **Migração desta tarefa saiu errada e ainda não foi aplicada em nenhum banco** (os bancos
  descartáveis dos testes não contam): corrija o schema, volte `apps/api/drizzle/` ao estado da
  `main` e gere de novo só o que esta tarefa criou. Da raiz do projeto:

  ```bash
  git fetch origin
  git restore --source=origin/main --staged --worktree -- apps/api/drizzle/
  git clean -f -- apps/api/drizzle/
  ```

  O `restore` devolve o que já estava na `main` (inclusive o `_journal.json`) e o `clean` apaga o
  que esta tarefa criou; depois, `generate` de novo e refaça as `--custom` desta tarefa. **Nunca
  apague migração que já está na `main`.** Se os comandos forem bloqueados, **pare e pergunte**.
- **Nunca escreva à mão** migração gerada nem o `meta/`: cada migração tem uma "foto" do schema em
  `meta/`, e se SQL e foto não baterem, o `generate` cria migrações fantasmas.

### Extensão do pgvector

O tipo `vector` só existe depois de `CREATE EXTENSION vector`, e o `generate` não cria extensão.
Na primeira vez que uma tabela usar `vector`, crie a migração da extensão **antes** de gerar a
da tabela:

1. `bunx drizzle-kit generate --custom --name vector_extension`
2. escreva, **numa linha nova, abaixo do comentário** (mesmo cuidado da linha da IA, abaixo):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

3. só então `bunx drizzle-kit generate --name <descricao>` para a tabela.

Na ordem inversa, a migração da tabela roda antes da extensão e falha com
`type "vector" does not exist`.

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
  `docs/data-model/rules.md` e da seção dela em `tables-*.md`, no mesmo formato dos que já existem.
- **Teste de regra tem que poder falhar** com o schema errado. `UNIQUE` ou PK de duas colunas
  testa o par repetido e os vizinhos aceitos: mesmo `a` com outro `b`, outro `a` com o mesmo `b`.
- O teste insere linhas direto com SQL, então não depende de nomes de propriedades do schema.
