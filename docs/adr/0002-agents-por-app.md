---
description: ADR 0002 — cada app tem o próprio AGENTS.md, e o agente é aberto na pasta do app
---

# 0002 — `AGENTS.md` por app

- **Data:** 2026-10-20
- **Estado:** aceita
- **Substitui:** o item sobre `AGENTS.md` do [0001](0001-estrutura-do-monorepo.md)

## Contexto

O 0001 deixou um `AGENTS.md` só, na raiz, e o guia de cada app em `apps/<app>/<app>.md`, um doc
com cabeçalho `globs` que só chega ao agente pela extensão local, e só quando ele lê ou edita um
arquivo do app. O agente costuma começar uma tarefa com comandos de shell (`ls`, `cat`), então
planejava sem o guia do app.

## Decisão

- Cada app tem o próprio `AGENTS.md` (ex.: `apps/api/AGENTS.md`), sem cabeçalho.
- Para uma tarefa de um app só, o agente é aberto **na pasta do app**. As ferramentas de agente
  carregam o `AGENTS.md` da pasta em que abrem e de todas as de cima: o do app e o da raiz chegam
  juntos, desde o primeiro turno, sem depender de extensão.
- Para uma tarefa que cruza apps, o agente é aberto na raiz e lê o `AGENTS.md` do app antes de
  mexer nele.
- Os docs de módulo (`apps/<app>/docs/<modulo>.md`) e a modelagem (`docs/data-model/`) continuam
  com cabeçalho `globs`, entregues quando o agente mexe na área.

## Consequências

- O `AGENTS.md` do app funciona em qualquer ferramenta que siga a convenção, não só no ambiente
  local com a extensão.
- Os comandos do app (`bun run test`, `bunx drizzle-kit generate`) rodam sem `cd`.
