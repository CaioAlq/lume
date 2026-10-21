---
description: Tabelas principais: customer, staff, staff_session, ticket e message (colunas e constraints)
globs: apps/api/src/db/schema/**, apps/api/drizzle/**, apps/api/test/db/**
related: docs/data-model/tables-support.md, docs/data-model/rules.md
---

# Lume — modelagem do banco: tables-core

> Parte da modelagem do Lume. Visão geral e índice das partes: `overview.md`.

## Tabelas

### `customer`

Um cliente por **endereço de e-mail**. O sistema não tenta adivinhar que dois endereços são
a mesma pessoa; quem liga tickets relacionados é o atendente.

| Coluna | O que guarda |
|---|---|
| `id` | UUIDv7 |
| `email` | endereço de e-mail, **sempre em minúsculas** — único |
| `display_name` | nome que veio no `From` do e-mail. Pode ser nulo |
| `created_at` | quando o primeiro e-mail desse endereço chegou |

O e-mail é gravado em minúsculas para `Joao@x.com` e `joao@x.com` não virarem dois
clientes. O banco garante: `CHECK (email = lower(email))`.

### `staff`

Quem responde pelo lado do suporte. **A LLM também é um `staff`**, com UUID próprio, para
que tudo o que ela escreveu fique atribuído a ela.

| Coluna | O que guarda |
|---|---|
| `id` | UUIDv7 |
| `kind` | `human` ou `ai` |
| `display_name` | nome exibido |
| `email` | login do humano, em minúsculas — único. Nulo para a IA |
| `password_hash` | hash **argon2id** da senha. Nulo para a IA |
| `active` | desativar sem apagar (o histórico continua apontando para ele) |
| `created_at` | |

A IA **não faz login**, e o banco garante isso:

```sql
CHECK (
  (kind = 'human' AND email IS NOT NULL AND password_hash IS NOT NULL) OR
  (kind = 'ai'    AND email IS NULL     AND password_hash IS NULL)
)
```

A linha da IA é criada pela migração inicial. O modelo que ela usa em cada execução fica
registrado na `ai_run`, não aqui: trocar de modelo não cria outro `staff`.

### `staff_session`

Sessão de login dos atendentes humanos. O navegador guarda um **cookie `httpOnly` e
`SameSite`** com um token aleatório; o banco guarda só o **hash** desse token.

| Coluna | O que guarda |
|---|---|
| `id` | UUIDv7 |
| `staff_id` | FK → `staff` |
| `token_hash` | SHA-256 do token do cookie — único |
| `created_at` | |
| `expires_at` | depois disso a sessão não vale mais |
| `last_seen_at` | último uso, para expirar sessões paradas |

Guardar o hash, e não o token: se o banco vazar, quem copiar a tabela não consegue usar as
sessões. Logout apaga a linha.

### `ticket`

| Coluna | O que guarda |
|---|---|
| `id` | UUIDv7. **É o id da conversa** que o e-mail não tem (ver *Threading*, em `flows.md`) |
| `customer_id` | FK → `customer`. **Quem abriu o ticket** |
| `staff_id` | FK → `staff`. **O responsável atual**, não o autor de cada mensagem. Nulo até alguém assumir |
| `subject` | assunto do primeiro e-mail. **Obrigatório** (nunca nulo), mas pode ser texto vazio |
| `status` | ver *Estados do ticket* |
| `urgency` | `low`, `normal`, `high` ou `urgent`. Nulo até ser classificado |
| `category` | categoria dada pela IA ou pelo atendente. Nulo até ser classificado |
| `archived` | booleano, **independente** do `status` (um spam é arquivado sem ser resolvido) |
| `duplicate_of_ticket_id` | FK → `ticket`. Preenchido quando este ticket é duplicado de outro |
| `created_at` | |
| `resolved_at` | quando foi resolvido. Nulo se não está resolvido |

Regras:
- `CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))` — os dois campos não podem
  discordar. Numa reabertura, `resolved_at` volta a ser nulo; o histórico fica na
  `ticket_event`.
- `CHECK (duplicate_of_ticket_id <> id)` — um ticket não é duplicado de si mesmo.

Não existe `message_id` no ticket: um ticket tem várias mensagens (P8).

### `message`

Uma tabela só, com as falas de todos intercaladas, para a conversa ser lida em ordem (P4).
**Toda linha é um e-mail de verdade**, recebido ou enviado — rascunho não é mensagem (ver
`draft`).

| Coluna | O que guarda |
|---|---|
| `id` | UUIDv7 — também desempata a ordenação |
| `ticket_id` | FK → `ticket` |
| `customer_id` | FK → `customer`. Preenchido quando o autor é um cliente |
| `staff_id` | FK → `staff`. Preenchido quando o autor é a equipe (humano ou IA) |
| `body` | texto da mensagem |
| `message_id_header` | o `Message-ID` do e-mail — **único e obrigatório** |
| `recorded_at` | hora em que **o nosso servidor** registrou a mensagem (P12) |
| `delivery_status` | só para mensagens enviadas: `pending`, `sent` ou `failed` |
| `sent_at` | quando o provedor aceitou o envio |
| `recipients` | só para mensagens enviadas: lista (`text[]`) de endereços para quem foi mandada |

Regras:
- **Exatamente um autor:** `CHECK (num_nonnulls(customer_id, staff_id) = 1)`. Não é
  "coluna de tipo + `author_id`": isso seria **associação polimórfica**, e o banco não
  conseguiria ter FK (P15).
- **Recebida × enviada:** mensagem de cliente tem `delivery_status`, `sent_at` e
  `recipients` nulos; mensagem da equipe tem `delivery_status` e `recipients` preenchidos.
- `sent_at` preenchido se, e somente se, `delivery_status = 'sent'`.

O `customer_id` da mensagem **pode ser diferente** do `ticket.customer_id` — por exemplo,
o colega que respondeu um e-mail encaminhado.

**`recipients` é uma fotografia.** Os participantes do ticket mudam com o tempo; a lista
de quem recebeu **esta** mensagem é gravada no momento do envio e nunca mais muda.
