# api — regras do app

A api do Lume: login, telas do atendente, aprovar rascunho, responder, resolver, atribuir.
Bun + TypeScript, Drizzle sobre Postgres 18. As regras do projeto inteiro estão no `AGENTS.md` da raiz.

**Para uma tarefa só da api, abra o agente em `apps/api/`:** ele carrega este arquivo e o
`AGENTS.md` da raiz juntos, e os comandos abaixo rodam sem `cd`.

## Organização por módulo

| Pasta | O que tem |
|---|---|
| `apps/api/src/<modulo>/` | código do módulo |
| `apps/api/test/<modulo>/` | testes do módulo, no mesmo caminho do `src/` |
| `apps/api/docs/<modulo>.md` | o doc do módulo: como o código dele deve ser escrito |

Módulos hoje: **`db`** (conexão, schema e migrações; doc em `apps/api/docs/db.md`).

**Módulo novo:** crie as três partes juntas. O doc começa com o cabeçalho que liga o doc às
pastas dele:

```markdown
---
description: do que o módulo trata, numa linha
globs: apps/api/src/<modulo>/**, apps/api/test/<modulo>/**
related: docs/data-model/rules.md
---
```

## Comandos (de dentro de `apps/api/`)

| Comando | Para quê |
|---|---|
| `bun run typecheck` | typecheck só da api |
| `bun run test` | testes só da api; carrega o `.env` da raiz e precisa do banco no ar |
| `bunx drizzle-kit generate --name <descricao>` | gera migração a partir do schema (ver `apps/api/docs/db.md`) |

## Banco e testes

Tudo sobre conexão, schema, migrações e os testes das regras do banco está em `apps/api/docs/db.md`.
Os testes em `apps/api/test/db/` rodam num banco descartável e passam pelo `apps/api/src/db/client.ts`.
