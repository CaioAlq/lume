# Lume — modelagem do banco

Estado: **rascunho**. As decisões abaixo saíram das perguntas P1–P16 da sessão de
modelagem (2026-09-22). O que ainda não foi decidido está em **Perguntas em aberto**,
no fim, e não deve ser preenchido por suposição.

Convenção: identificadores em inglês (tabelas, colunas, valores); explicação em português.

**Por que `staff`:** o termo usual de helpdesk seria `agent`, mas num projeto com LLM
ele colide com *agente de IA*. `operator` foi descartado por ser palavra-chave do Postgres
(não reservada, mas ainda assim palavra-chave). `staff` não é palavra-chave no Postgres
nem no Python, e não tem outro sentido dentro do projeto.

---

## Visão geral

```
customer 1 ──── N ticket 1 ──── N message
                   │                 │
staff    1 ── N ───┘  (responsável)  │
staff    1 ───────────────────── N ──┘  (autor, quando não é o cliente)
```

- O **ticket** é o envelope; a conversa mora nas **mensagens**.
- A FK sempre mora no lado do "muitos": a mensagem aponta para o ticket, nunca o contrário.
- Todos os `id` são **UUIDv7** (`uuidv7()` do Postgres 18): únicos e crescentes no tempo.

---

## Tabelas

### `customer`

Um cliente por **endereço de e-mail**. O sistema não tenta adivinhar que dois endereços
são a mesma pessoa; quem liga tickets relacionados é o atendente.

| Coluna | O que guarda |
|---|---|
| `id` | UUIDv7 |
| `email` | endereço de e-mail — **único** |
| `created_at` | quando o primeiro e-mail desse endereço chegou |

### `staff`

Quem responde pelo lado do suporte. **A LLM também é um staff**, com UUID próprio, para
que tudo o que ela escreveu fique atribuído a ela (base da auditoria).

| Coluna | O que guarda |
|---|---|
| `id` | UUIDv7 |
| `name` | nome exibido |

> Os campos de login (e-mail, hash de senha) ficam para a modelagem de autenticação.
> Ver pergunta em aberto sobre como distinguir a LLM dos humanos.

### `ticket`

| Coluna | O que guarda |
|---|---|
| `id` | UUIDv7 |
| `customer_id` | FK → `customer`. Exatamente um cliente por ticket |
| `staff_id` | FK → `staff`. **O responsável atual**, não quem escreveu cada mensagem. Nulo até alguém assumir |
| `status` | estado do ciclo de vida — ver seção *Estados* |
| `archived` | booleano, **independente** do status (um spam é arquivado sem ser resolvido) |
| `created_at` | quando o ticket foi aberto |

Não existe `message_id` no ticket: um ticket tem várias mensagens, então essa coluna não
teria para qual apontar (P8).

### `message`

Uma tabela só, com as falas de todos intercaladas, para a conversa ser lida em ordem (P4).

| Coluna | O que guarda |
|---|---|
| `id` | UUIDv7 — também desempata a ordenação |
| `ticket_id` | FK → `ticket` |
| `customer_id` | FK → `customer`. Preenchido quando o autor é o cliente |
| `staff_id` | FK → `staff`. Preenchido quando o autor é um atendente (humano ou LLM) |
| `body` | texto da mensagem |
| `recorded_at` | hora em que **o nosso servidor** registrou a mensagem (P12) |

> `recorded_at` e não `received_at`: a mesma coluna vale para o e-mail que chega do
> cliente e para a resposta que o atendente escreve.

---

## Regras que o banco garante

Ficam no banco, e não no backend, porque **dois programas gravam mensagens**: a API em
TypeScript e o worker em Python. Regra no backend teria que existir duas vezes, em duas
linguagens, e um dia divergiria.

| Regra | Como |
|---|---|
| Toda mensagem tem **exatamente um** autor | `CHECK (num_nonnulls(customer_id, staff_id) = 1)` |
| Um cliente por endereço | `UNIQUE (customer.email)` |
| Nenhuma referência para registro inexistente | FKs em todas as colunas `*_id` |

Por que não "coluna de tipo + um `author_id`": isso é **associação polimórfica**. O
`author_id` apontaria para duas tabelas, então não poderia ter FK, e o banco aceitaria
qualquer UUID (P15).

---

## Ordem da conversa

```sql
ORDER BY recorded_at, id
```

- A hora do **servidor** manda, porque o `Date` do e-mail vem do relógio de quem enviou.
- No empate, o `id` desempata. Como é UUIDv7, a ordem é estável: sorteada uma vez, na
  criação, e não a cada consulta — o F5 não embaralha a conversa (P13, P16).
- Não existe coluna de ordem: calcular `ordem + 1` gera condição de corrida quando dois
  workers processam ao mesmo tempo.

---

## Estados do ticket

**Vistos pelo cliente:** `open` · `in_progress` · `resolved`

**Internos:** dentro de `in_progress` existem N estados que o cliente não vê — é onde a IA
trabalha. **Ainda não definidos** (ver abaixo).

**Transições conhecidas:**
- cliente responde um ticket `resolved` → volta para `open` (reabertura)
- ticket `resolved` → cliente é avisado por e-mail
- `archived` muda independentemente do `status`

---

## Perguntas em aberto

Não preencher por suposição — cada uma é uma decisão.

1. **Threading.** Quando o cliente responde, como o sistema descobre a qual ticket aquele
   e-mail pertence? *(estacionada desde a P1)*
2. **Estados internos.** Quais são os momentos pelos quais a IA faz o ticket passar
   (classificar, redigir, aguardar aprovação...)? E como representar: uma coluna `status`
   só, com um mapeamento para o que o cliente vê, ou duas colunas?
3. **Rascunho da LLM.** No modo rascunho, a LLM escreve e o humano aprova. Um rascunho
   ainda não enviado **é uma `message`**? Se for, aparece na conversa antes de ser
   enviado. Se não for, mora onde?
4. **LLM ou humano.** Como o sistema sabe que um `staff` é a LLM? Ela não faz login, os
   humanos fazem.
5. **Ligar tickets.** O atendente liga um ticket a outro ("já está sendo tratado no ticket
   tal"). Quantos tickets podem se ligar a quantos? *(é o lugar onde uma tabela de ligação
   é a resposta certa)*
6. **Auditoria da IA.** Onde ficam modelo, versão do prompt, latência, confiança e se o
   humano corrigiu?
