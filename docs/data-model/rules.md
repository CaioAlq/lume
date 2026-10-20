---
description: Regras que o banco garante (CHECK, UNIQUE, FK, índices) e os estados do ticket
globs: api/src/schema/**, api/drizzle/**
related: docs/data-model/tables-core.md, docs/data-model/tables-support.md
---

# Lume — modelagem do banco: rules

> Parte da modelagem do Lume. Visão geral e índice das partes: `overview.md`.

## Regras que o banco garante

Ficam no banco, e não no código, porque **vários programas gravam**: a `api` em TypeScript,
o `mailer` e o `worker` em Python. Regra no código teria que existir em duas linguagens.

| Regra | Onde |
|---|---|
| Nenhuma referência para registro inexistente | FKs em todas as colunas `*_id` |
| Um cliente por endereço, em minúsculas | `customer`: `UNIQUE (email)`, `CHECK (email = lower(email))` |
| IA não tem login; humano tem | `staff`: `CHECK` de `kind` com `email` e `password_hash` |
| Resolvido ⇔ tem data de resolução | `ticket`: `CHECK` de `status` com `resolved_at` |
| Ticket não é duplicado de si mesmo | `ticket`: `CHECK (duplicate_of_ticket_id <> id)` |
| Toda mensagem tem exatamente um autor | `message`: `CHECK (num_nonnulls(customer_id, staff_id) = 1)` |
| Um e-mail é processado uma vez só | `message`: `UNIQUE (message_id_header)` |
| Recebida não tem dados de envio | `message`: `CHECK` de autor com `delivery_status` e `recipients` |
| Uma pessoa entra uma vez só em cada ticket | `ticket_participant`: PK `(ticket_id, customer_id)` |
| No máximo um rascunho pendente por ticket | `draft`: índice único parcial |
| Falha sempre tem mensagem de erro | `ai_run`: `CHECK` de `status` com `error_message` |
| Um trabalho de cada tipo por mensagem | `job`: `UNIQUE (kind, message_id)` |
| Valores fechados (`status`, `kind`, `urgency`...) | `CHECK (coluna IN (...))` em cada tabela |

**Valores fechados usam `text` + `CHECK`, não `ENUM` do Postgres:** acrescentar um valor novo
num `CHECK` é uma migração simples; mudar um `ENUM` é mais trabalhoso.

**O Postgres não cria índice para FK sozinho.** Toda coluna `*_id` usada em busca ou em
`JOIN` precisa de índice próprio (ex.: `message.ticket_id`, `ticket.customer_id`,
`ticket_participant.customer_id`).

---

## Estados do ticket

Um campo só, `status`, com os valores internos. O que o cliente vê é **calculado** a partir
dele — dois campos poderiam discordar; um cálculo não.

| `status` | Significa | Cliente vê |
|---|---|---|
| `open` | chegou e a equipe ainda não respondeu nenhuma vez | aberto |
| `awaiting_staff` | a vez é da equipe (o cliente respondeu, ou tem rascunho para revisar) | em andamento |
| `awaiting_customer` | a equipe respondeu; a vez é do cliente | em andamento |
| `resolved` | resolvido | resolvido |

O trabalho da IA (classificar, redigir) **não é estado do ticket**: é estado do trabalho na
tabela `job`. Ticket e trabalho da IA são duas máquinas de estado diferentes.

**Transições:**

```
e-mail novo, sem ticket          → open
open              + cliente escreve   → open
open              + equipe responde   → awaiting_customer
awaiting_customer + cliente responde  → awaiting_staff
awaiting_staff    + equipe responde   → awaiting_customer
qualquer um       + atendente resolve → resolved         (cliente é avisado por e-mail)
resolved          + cliente responde  → awaiting_staff   (reabertura; resolved_at volta a nulo)
```

`archived` muda independentemente do `status`. Toda mudança de `status` gera uma
`ticket_event`.
