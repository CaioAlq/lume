---
description: Visão geral do app api: o que faz, organização por módulo, comandos e onde está cada doc
globs: apps/api/**
related: apps/api/docs/db.md, docs/architecture.md
---

# api — visão geral do app

A api do Lume: login, telas do atendente, aprovar rascunho, responder, resolver, atribuir.
Bun + TypeScript, Drizzle sobre Postgres 18. As regras do projeto inteiro estão no `AGENTS.md` da raiz.

**Neste doc, todo caminho é a partir de `apps/api/`** (ex.: `docs/db.md` é `apps/api/docs/db.md`). Este doc é `apps/api/api.md`.

## Organização por módulo

| Pasta | O que tem |
|---|---|
| `src/<modulo>/` | código do módulo |
| `test/<modulo>/` | testes do módulo, no mesmo caminho do `src/` |
| `docs/<modulo>.md` | o doc do módulo: como o código dele deve ser escrito |

Módulos hoje: **`db`** (conexão, schema e migrações; doc em `docs/db.md`).

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
| `bunx drizzle-kit generate --name <descricao>` | gera migração a partir do schema (ver `docs/db.md`) |

## Banco e testes

Tudo sobre conexão, schema, migrações e os testes das regras do banco está em `docs/db.md`.
Os testes em `test/db/` rodam num banco descartável e passam pelo `src/db/client.ts`.
