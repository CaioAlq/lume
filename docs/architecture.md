---
description: Arquitetura do Lume: os processos, como se falam e onde cada parte mora no repositório
related: docs/data-model/overview.md
---

# Lume — arquitetura

## Processos

```
web (Angular) ──HTTP──▶ api (Bun/TS) ──┐
                                        ├──▶ Postgres + pgvector
IMAP / provedor ◀──▶ mailer (Python) ──┤
                                        │
llama.cpp ◀──HTTP── worker (Python) ───┘
```

| Processo | Faz |
|---|---|
| `api` | login, telas do atendente, aprovar rascunho, responder, resolver, atribuir |
| `mailer` | busca e-mails novos (IMAP), grava tickets e mensagens; envia as mensagens pendentes |
| `worker` | pipeline de IA: classificar, gerar embedding, buscar casos parecidos, redigir rascunho |

Os processos **não conversam entre si**: cada um só lê e grava no banco. A fila de
trabalho é a tabela `job` (ver `docs/data-model/tables-support.md`), com `FOR UPDATE SKIP LOCKED` — sem Redis.

## Onde cada parte mora

Monorepo com workspaces do Bun (`package.json` da raiz). Cada processo é um app em `apps/`;
o que é compartilhado entre apps TypeScript fica em `packages/`.

| Pasta | O que é | Stack |
|---|---|---|
| `apps/api/` | a api | Bun + TypeScript + Drizzle |
| `apps/web/` | as telas do atendente (ainda não existe) | Angular |
| `apps/mailer/` | IMAP e envio (ainda não existe) | Python + uv |
| `apps/worker/` | pipeline de IA (ainda não existe) | Python + uv |
| `packages/shared/` | tipos e contratos que a api e o web dividem | TypeScript |
| `docs/` | docs do projeto inteiro: esta arquitetura, a modelagem e as decisões (`adr/`) | |

Dentro de cada app TypeScript, o código é organizado **por módulo**. Regras do projeto inteiro
ficam só no `AGENTS.md` da raiz; o que é de um app fica no doc geral dele:

```
apps/<app>/
├── <app>.md          doc geral do app (ex.: apps/api/api.md)
├── docs/<modulo>.md   um doc por módulo, não por arquivo
├── src/<modulo>/      código do módulo
└── test/<modulo>/     testes, no mesmo caminho do src/
```

Os apps Python não entram nos workspaces do Bun: cada um tem o próprio `pyproject.toml`.
