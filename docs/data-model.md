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
| `customer_id` | FK → `customer`. **Quem abriu o ticket.** Outras pessoas podem ter mensagens nele (ex.: um colega que respondeu um encaminhamento) |
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
| `message_id_header` | o `Message-ID` do e-mail, copiado do cabeçalho — **único**. Não termina em `_id` porque não é FK: é um texto que veio do e-mail |

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
| Um e-mail é processado uma vez só | `UNIQUE (message.message_id_header)` |
| Nenhuma referência para registro inexistente | FKs em todas as colunas `*_id` |

Por que não "coluna de tipo + um `author_id`": isso é **associação polimórfica**. O
`author_id` apontaria para duas tabelas, então não poderia ter FK, e o banco aceitaria
qualquer UUID (P15).

---

## Threading: como uma resposta encontra o seu ticket

**O e-mail não tem id de conversa.** Cada e-mail tem o seu próprio `Message-ID`, e a
resposta aponta para o e-mail **imediatamente anterior**, como uma FK para o pai:

```
                Message-ID    In-Reply-To
seg  cliente    CAA1k3        —
qua  Lume       lume-8f3a     CAA1k3
qui  cliente    CAB7x9        lume-8f3a     ← escrito pelo Gmail do cliente, não pelo Lume
```

- `Message-ID`: o id deste e-mail, criado por quem envia.
- `In-Reply-To`: o `Message-ID` da mensagem respondida.
- `References`: a cadeia de ids da conversa. Útil como rede de segurança, mas quem
  escreve é o programa de e-mail de cada pessoa, e alguns cortam a lista.

**O Lume cria o id de conversa que o e-mail não tem: é o `ticket.id`.** Por isso a
conversa não depende de nenhum cliente de e-mail.

### Guardar o id de toda mensagem

O `message_id_header` é gravado em **todas** as mensagens:

- **as que chegam:** lido do cabeçalho `Message-ID`;
- **as que o Lume envia:** o Lume gera o `Message-ID` no envio e grava na mesma linha.

Guardar só o do primeiro e-mail não funciona: o cliente responde ao e-mail **do Lume**,
então o `In-Reply-To` que volta é o id de uma mensagem enviada pelo Lume.

### Como o Lume decide o ticket de um e-mail que chega

```
1. In-Reply-To bate com algum message_id_header?   → ticket dessa mensagem
2. algum id do References bate?                    → ticket dessa mensagem
3. nada bateu                                      → ticket NOVO
```

**Na dúvida, ticket novo, nunca adivinhar.** Um ticket duplicado aparece para o atendente,
que liga os dois. Uma resposta no ticket errado some dentro de outra conversa. É o mesmo
princípio *fail-safe* do `.gitignore`.

**O assunto não decide nada.** Pode ser editado, e muitos clientes escrevem "Ajuda" ou
"Dúvida". No máximo, serve de pista para o atendente.

### Processar o mesmo e-mail duas vezes

Se o worker ler um e-mail, gravar e cair antes de marcar como processado, vai ler de novo.
O `UNIQUE` em `message_id_header` faz o segundo `INSERT` falhar. **Esse erro não é falha:**
o código de ingestão trata como "já processado" (`ON CONFLICT DO NOTHING`) e segue.

### Destinatários da resposta

Quando o atendente responde, o e-mail vai para **todos que participam do ticket**, não só
para quem o abriu (decisão da P22). Onde a lista de participantes fica guardada ainda está
em aberto (ver abaixo).

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

1. ~~**Threading.**~~ Resolvido — ver a seção *Threading*.
2. **Estados internos.** Quais são os momentos pelos quais a IA faz o ticket passar
   (classificar, redigir, aguardar aprovação...)? E como representar: uma coluna `status`
   só, com um mapeamento para o que o cliente vê, ou duas colunas?
3. **Rascunho da LLM.** No modo rascunho, a LLM escreve e o humano aprova. Um rascunho
   ainda não enviado **é uma `message`**? Se for, aparece na conversa antes de ser
   enviado. Se não for, mora onde?
   **Amarrada ao `message_id_header`:** rascunho não enviado não tem `Message-ID`. A
   coluna só pode ser `NOT NULL` se rascunho **não** for uma `message`. (O `UNIQUE` do
   Postgres aceita vários nulos.)
4. **LLM ou humano.** Como o sistema sabe que um `staff` é a LLM? Ela não faz login, os
   humanos fazem.
5. **Ligar tickets.** O atendente liga um ticket a outro ("já está sendo tratado no ticket
   tal"). Quantos tickets podem se ligar a quantos? *(é o lugar onde uma tabela de ligação
   é a resposta certa)*
6. **Auditoria da IA.** Onde ficam modelo, versão do prompt, latência, confiança e se o
   humano corrigiu?
7. **Participantes.** O cliente manda o primeiro e-mail com um colega em cópia (`Cc`). O
   colega nunca escreve, mas deve receber as respostas. Onde o endereço dele fica
   guardado? Hoje, em lugar nenhum. *(P22)*
8. **Gravar e enviar.** O Lume grava a mensagem e depois envia, ou envia e depois grava?
   O que acontece em cada ordem se o segundo passo falhar?
