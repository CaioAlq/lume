---
description: ADR 0003 — todo comportamento novo do projeto começa por um teste que falha
---

# 0003 — Testes antes do código

- **Data:** 2026-10-20
- **Estado:** aceita

## Contexto

Boa parte do código do Lume é escrita por um agente com LLM local. Medindo esse agente na mesma
tarefa, o que estava só em documentação ele errava com frequência, mesmo depois de ler o doc
certo; o que virou teste ele acertou. Um teste falhando traz para o agente uma informação que ele
não tinha. Pedir que ele revise o próprio trabalho não trouxe ganho.

## Decisão

- **Todo comportamento novo começa por um teste que falha**, em qualquer parte do projeto: banco,
  api, web, mailer e worker.
- O teste é escrito a partir dos docs, roda, falha pelo motivo certo, e só então vem o código.
- Bug encontrado vira primeiro um teste que o reproduz.
- O teste escreve uma decisão do projeto: mudá-lo para passar exige perguntar antes.
- Cada parte usa o runner da sua stack: `bun test` no TypeScript, `pytest` no Python, o runner do
  Angular no web.

## Consequências

- Cada app nasce com o runner de testes configurado, antes da primeira funcionalidade.
- Uma tarefa para o agente vem com os testes prontos (a especificação) ou começa por eles.
- `bun run test` (e o `pytest` dos apps Python) é o critério de pronto, junto com o typecheck.
