---
description: Visão geral da modelagem do Lume: componentes, mapa das tabelas, ordem da conversa e pendências
globs: apps/api/src/db/**, apps/api/drizzle/**, apps/mailer/**, apps/worker/**
related: docs/architecture.md, docs/data-model/tables-core.md, docs/data-model/tables-support.md, docs/data-model/rules.md, docs/data-model/flows.md
---

# Lume — modelagem do banco

Dividida em partes curtas, cada uma ligada às pastas onde vale:

| Parte | Conteúdo |
|---|---|
| `tables-core.md` | Tabelas principais: customer, staff, staff_session, ticket e message (colunas e constraints) |
| `tables-support.md` | Tabelas de apoio: ticket_participant, ticket_event, draft, ai_run, ticket_embedding e job |
| `rules.md` | Regras que o banco garante (CHECK, UNIQUE, FK, índices) e os estados do ticket |
| `flows.md` | Threading de e-mail e os fluxos de mailer, worker e api |

Estado: **completo para a v1**. As referências P1–P29 apontam para as perguntas da sessão
de modelagem em que cada decisão nasceu.

Convenção: identificadores em inglês (tabelas, colunas, valores); explicação em português.
Nenhum identificador é palavra-chave do Postgres, do Python ou do TypeScript — nem as não
reservadas (por isso `display_name` e não `name`, `error_message` e não `error`, `kind` e
não `type`).

**Por que `staff`:** o termo usual de helpdesk seria `agent`, mas num projeto com LLM ele
colide com *agente de IA*. `operator` foi descartado por ser palavra-chave do Postgres.

---

## Componentes

Os processos (`api`, `mailer`, `worker`, `web`) e como eles se falam estão em
`docs/architecture.md`.

---

## Visão geral das tabelas

```
customer 1 ── N ticket 1 ── N message
                  │  │           │
staff    1 ── N ──┘  │           │ (autor, quando não é o cliente)
staff    1 ─────────────────── N ┘
                     │
customer N ── ticket_participant ── N ticket   (quem recebe além de quem abriu)
ticket   1 ── N ticket_event                   (histórico do ticket)
ticket   1 ── N draft                          (rascunhos da IA)
ticket   1 ── N ai_run                         (auditoria da IA)
ticket   1 ── 1 ticket_embedding               (vetor para busca de casos parecidos)
message  1 ── N job                            (fila de trabalho)
staff    1 ── N staff_session                  (login)
ticket   N ── 1 ticket (duplicate_of_ticket_id)
```

- O **ticket** é o envelope; a conversa mora nas **mensagens**.
- A FK sempre mora no lado do "muitos". Tabela de ligação só quando a relação é **muitos
  para muitos** — no Lume, só a `ticket_participant`.
- Todos os `id` são **UUIDv7** (`uuidv7()` do Postgres 18): únicos e crescentes no tempo.
- Todas as datas são `timestamptz`.
- `*_id` sempre quer dizer FK. Coluna que guarda um id vindo de fora não termina em `_id`
  (ex.: `message_id_header`).

---


## Ordem da conversa

```sql
ORDER BY recorded_at, id
```

- A hora do **servidor** manda, porque o `Date` do e-mail vem do relógio de quem enviou.
- No empate, o `id` desempata. Como é UUIDv7, a ordem é estável (P13, P16).
- Não existe coluna de ordem: calcular `ordem + 1` gera condição de corrida.

---

## Pendências de implementação

Não mudam a modelagem, mas precisam de decisão ao escrever o código.

1. **Texto citado nas respostas.** Quem responde um e-mail costuma arrastar a conversa
   inteira citada embaixo (`> ...`). O `body` precisa ficar sem isso, tanto para exibir
   quanto para a IA ler.
2. **Provedor de envio.** Qual (Resend, Postmark, SES...), e se aceita chave de
   idempotência.
