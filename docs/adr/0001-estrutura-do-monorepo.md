---
description: ADR 0001 — por que o Lume é um monorepo com apps/, packages/ e docs por módulo
---

# 0001 — Estrutura do monorepo

- **Data:** 2026-10-20
- **Estado:** aceita

## Contexto

A api ficava sozinha em `api/`, e toda a documentação do banco num arquivo só, de 553 linhas.
O Lume vai ter quatro processos (api, web, mailer, worker), e não havia um lugar claro para as
regras de cada um nem um jeito de entregar ao agente local só o doc da pasta em que ele está
mexendo. Medições com o agente mostraram que ler o doc não basta: o que garante o resultado são
os testes, então cada módulo precisa de um lugar fixo para código, testes e doc.

## Decisão

- **Monorepo com workspaces do Bun:** `apps/*` e `packages/*`, um `bun.lock` só na raiz.
- **Um app por processo** em `apps/`. Os apps Python (mailer, worker) ficam fora dos workspaces
  do Bun, cada um com o próprio `pyproject.toml`.
- **`packages/shared`** para os tipos que a api e o web precisam conhecer igual.
- **Organização por módulo dentro de cada app:** `src/<modulo>/`, `test/<modulo>/` no mesmo
  caminho, e `docs/<modulo>.md`, um doc por módulo e não por arquivo.
- ~~**Um `AGENTS.md` só, na raiz,** com o que todo o projeto precisa e apontando para o doc geral
  de cada app (`apps/<app>/<app>.md`, na raiz do app). As ferramentas de agente carregam o
  `AGENTS.md` da pasta em que abrem e das de cima, não o de subpastas; um doc com `globs` chega
  pelo caminho.~~ **Substituído pelo [0002](0002-agents-por-app.md).**
- **Docs curtos (até ~250 linhas) com cabeçalho** `description`, `globs` e `related`. O `globs`
  liga o doc às pastas onde ele vale; os caminhos são sempre a partir da raiz.
- **`docs/` da raiz** para o que vale para o projeto inteiro: arquitetura, modelagem e ADRs.

## Consequências

- Os caminhos da api mudaram: `api/` virou `apps/api/`, e a conexão saiu de `src/db.ts` para
  `src/db/client.ts`.
- O `.env` continua na raiz; a api o carrega com `--env-file=../../.env`.
- `typecheck` e `test` rodam de qualquer app ou da raiz para todos (`bun run --filter`).
- `apps/web`, `apps/mailer` e `apps/worker` só são criados quando houver código para eles.
