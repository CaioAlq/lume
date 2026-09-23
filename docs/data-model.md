# Lume — modelagem do banco

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
trabalho é a tabela `job` (ver abaixo), com `FOR UPDATE SKIP LOCKED` — sem Redis.

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
| `id` | UUIDv7. **É o id da conversa** que o e-mail não tem (ver *Threading*) |
| `customer_id` | FK → `customer`. **Quem abriu o ticket** |
| `staff_id` | FK → `staff`. **O responsável atual**, não o autor de cada mensagem. Nulo até alguém assumir |
| `subject` | assunto do primeiro e-mail. Pode ser texto vazio |
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

### `ticket_participant`

Quem participa do ticket **além de quem o abriu** — por exemplo, um colega que veio em
cópia (`Cc`) e nunca escreveu, mas deve receber as respostas (P22, P24).

| Coluna | O que guarda |
|---|---|
| `ticket_id` | FK → `ticket` |
| `customer_id` | FK → `customer` |
| `created_at` | |

- **Chave primária: o par `(ticket_id, customer_id)`** (P27). A mesma pessoa não entra duas
  vezes no mesmo ticket, e a tabela não precisa de `id` próprio.
- ⚠️ `UNIQUE` **no par**, nunca em cada coluna: `UNIQUE (ticket_id)` limitaria o ticket a um
  participante, e `UNIQUE (customer_id)` limitaria a pessoa a um ticket.
- **Quem abriu o ticket não entra aqui** — fica só em `ticket.customer_id` (P28).
- **Índice extra em `customer_id`.** O índice da PK começa por `ticket_id`, então serve
  para "participantes do ticket X", mas não para "tickets de que a pessoa Y participa". Um
  índice composto só ajuda buscas que começam pela **primeira** coluna dele.

**Quem recebe a resposta** = `ticket.customer_id` + todos da `ticket_participant`.

**Quem vira participante**, a cada e-mail que chega:

```
endereços do From, To e Cc
− endereços do próprio Lume     (lista em configuração: aliases, suporte+sufixo,
                                  endereço do provedor)
− quem abriu o ticket           (já está em ticket.customer_id)
− quem já é participante        (a PK recusa)
```

As duas primeiras exclusões ficam **no código**: um `CHECK` só enxerga a própria linha. A
terceira é garantida pela PK, e o `INSERT` repetido é tratado como "já é participante"
(`ON CONFLICT DO NOTHING`). Sem a primeira, o Lume mandaria e-mail para ele mesmo (P25).
Sem a segunda, quem abriu o ticket receberia cada resposta em dobro (P29).

**Cabeçalho só acrescenta, nunca remove** (P26). Se o cliente responde sem o colega em
cópia, o colega **continua** participante. Motivo: clicar em "Responder" em vez de
"Responder a todos" tira o `Cc` sem ninguém querer. Só o atendente remove um participante,
e a remoção fica registrada na `ticket_event`.

### `ticket_event`

Histórico do ticket: tudo o que mudou, quem mudou e quando. **Só recebe `INSERT`** — nunca
`UPDATE` nem `DELETE`. O usuário do banco usado pelos processos não tem permissão para
alterar ou apagar linhas dessa tabela.

| Coluna | O que guarda |
|---|---|
| `id` | UUIDv7 |
| `ticket_id` | FK → `ticket` |
| `staff_id` | FK → `staff`. Quem fez. Nulo quando foi o próprio sistema (ex.: reabertura por e-mail) |
| `kind` | o que aconteceu (lista abaixo) |
| `detail` | `jsonb` com os dados da mudança, ex.: `{"from": "open", "to": "resolved"}` |
| `created_at` | |

`kind`: `status_changed`, `assigned`, `urgency_changed`, `category_changed`,
`participant_added`, `participant_removed`, `marked_duplicate`, `archived`, `unarchived`.

### `draft`

Rascunho de resposta escrito pela IA, esperando o atendente. **Rascunho não é mensagem:**
mensagem é e-mail que existiu de verdade. Por isso `message_id_header` pode ser obrigatório.

| Coluna | O que guarda |
|---|---|
| `id` | UUIDv7 |
| `ticket_id` | FK → `ticket` |
| `ai_run_id` | FK → `ai_run`. A execução da IA que escreveu o rascunho |
| `body` | o texto proposto pela IA |
| `status` | `pending`, `sent` ou `discarded` |
| `message_id` | FK → `message`. A mensagem que saiu deste rascunho. Preenchido quando `sent` |
| `edited` | o atendente mudou o texto antes de enviar? Preenchido quando `sent` |
| `decided_by_staff_id` | FK → `staff`. Quem enviou ou descartou |
| `decided_at` | quando |
| `created_at` | |

Regras:
- **No máximo um rascunho pendente por ticket:** índice único parcial,
  `UNIQUE (ticket_id) WHERE status = 'pending'`.
- `status = 'sent'` se, e somente se, `message_id` e `edited` estão preenchidos.
- Quando chega uma resposta nova do cliente, o rascunho pendente vira `discarded` (ele
  respondia a uma conversa que mudou) e a IA escreve outro.

A coluna `edited` é a métrica de qualidade da IA: **em quantos rascunhos o humano precisou
mexer**.

### `ai_run`

Auditoria da IA: cada chamada a um modelo vira uma linha, com sucesso ou falha.

| Coluna | O que guarda |
|---|---|
| `id` | UUIDv7 |
| `ticket_id` | FK → `ticket` |
| `message_id` | FK → `message`. A mensagem que disparou a execução |
| `task` | `classify`, `embed` ou `draft` |
| `model` | o modelo usado (ex.: nome do arquivo GGUF) |
| `prompt_version` | versão do prompt. Nulo para `embed` |
| `status` | `succeeded` ou `failed` |
| `latency_ms` | quanto demorou |
| `input_tokens` | tokens de entrada, quando o servidor informa |
| `output_tokens` | tokens de saída, quando o servidor informa |
| `output` | `jsonb` com o resultado (ex.: `{"urgency": "high", "category": "login", "confidence": 0.82}`) |
| `error_message` | o erro, quando `failed` |
| `created_at` | |

Regra: `CHECK ((status = 'failed') = (error_message IS NOT NULL))`.

**A IA nunca sobrescreve uma decisão humana.** Se um atendente mudou a urgência ou a
categoria (existe `ticket_event` de `urgency_changed` ou `category_changed` com `staff_id`
humano), uma nova classificação é gravada na `ai_run`, mas não altera o ticket.

**Taxa de correção humana** = classificações da IA que um humano mudou depois + rascunhos
com `edited = true`. É a métrica que diz se a IA está ajudando.

### `ticket_embedding`

O vetor usado para achar **casos parecidos já resolvidos**.

| Coluna | O que guarda |
|---|---|
| `ticket_id` | PK e FK → `ticket`. Um vetor por ticket |
| `source_message_id` | FK → `message`. A mensagem que gerou o vetor: a primeira do cliente, que descreve o problema |
| `model` | o modelo de embedding usado |
| `embedding` | `vector(N)` do pgvector |
| `created_at` | |

- Índice **HNSW** com `vector_cosine_ops` (busca por similaridade de cosseno).
- `N` é fixado pelo modelo de embedding escolhido e **não muda depois**: trocar de modelo
  exige recalcular todos os vetores.
- **Por que busca vetorial, e não perguntar à LLM "isso é recorrente?":** a busca é
  determinística, rápida e testável. A LLM só redige, com os casos parecidos no contexto.

### `job`

A fila de trabalho entre os processos. É assim que o `mailer` avisa o `worker` que chegou
e-mail, e que a `api` avisa o `mailer` que tem resposta para enviar.

| Coluna | O que guarda |
|---|---|
| `id` | UUIDv7 |
| `kind` | `process_inbound` (IA processa um e-mail que chegou) ou `send_message` (enviar uma resposta) |
| `message_id` | FK → `message`. A mensagem a processar ou enviar |
| `status` | `pending`, `running`, `done` ou `failed` |
| `attempts` | quantas vezes já tentou |
| `run_after` | não executar antes disso (para esperar entre tentativas) |
| `locked_at` | quando um processo pegou o trabalho |
| `last_error` | o erro da última tentativa |
| `created_at` | |

- **Um trabalho de cada tipo por mensagem:** `UNIQUE (kind, message_id)`.
- Cada processo pega só os seus tipos: o `worker` pega `process_inbound`, e o `mailer` pega
  `send_message`.
- Pegar trabalho:
  `SELECT ... WHERE status = 'pending' AND run_after <= now() AND kind = $1
   ORDER BY run_after FOR UPDATE SKIP LOCKED LIMIT 1` — dois processos nunca pegam o mesmo.
- Falhou: `attempts + 1`, `run_after` cada vez mais longe; passou do limite, vira `failed`.
- Processo caiu no meio: trabalho `running` com `locked_at` antigo volta para `pending`.
- Índice parcial em `run_after` `WHERE status = 'pending'`.

---

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
- `References`: a cadeia de ids da conversa. Rede de segurança: quem escreve é o programa
  de e-mail de cada pessoa, e alguns cortam a lista.

**O Lume cria o id de conversa que o e-mail não tem: é o `ticket.id`.**

**O `message_id_header` é gravado em todas as mensagens:**
- **as que chegam:** lido do cabeçalho;
- **as que o Lume envia:** o Lume **gera** o `Message-ID` antes de enviar, no formato
  `<uuidv7@dominio-do-lume>`, e grava junto com a mensagem.

Nas respostas, o Lume preenche `In-Reply-To` com o `Message-ID` da última mensagem do
cliente e `References` com a cadeia do ticket, para a conversa aparecer agrupada no
programa de e-mail do cliente.

**Como o `mailer` decide o ticket de um e-mail que chega:**

```
1. In-Reply-To bate com algum message_id_header?   → ticket dessa mensagem
2. algum id do References bate?                    → ticket dessa mensagem
3. nada bateu                                      → ticket NOVO
4. o ticket encontrado é duplicado de outro?       → usa o ticket original
```

**Na dúvida, ticket novo, nunca adivinhar.** Um ticket duplicado aparece para o atendente,
que liga os dois. Uma resposta no ticket errado some dentro de outra conversa.

**O assunto não decide nada.** Pode ser editado, e muitos clientes escrevem "Ajuda".

---

## Fluxos

### E-mail chega (`mailer`)

Numa **única transação**:

1. grava a `message` com `ON CONFLICT (message_id_header) DO NOTHING`. Se não gravou
   nada, esse e-mail **já foi processado**: encerra a transação sem erro;
2. encontra ou cria o `customer` do `From`;
3. encontra o ticket pelo threading, ou cria um `ticket` novo (`open`);
4. acrescenta participantes, pelas regras da `ticket_participant`;
5. aplica a transição de `status` e grava a `ticket_event`;
6. descarta o rascunho pendente do ticket, se houver;
7. cria o `job` `process_inbound`.

Se qualquer passo falhar, nada fica gravado, e o e-mail é lido de novo na próxima vez.

### IA processa (`worker`, job `process_inbound`)

1. **Classificar** urgência e categoria → `ai_run`; aplica no ticket, a não ser que um
   humano já tenha mudado.
2. **Embedding** da primeira mensagem do cliente, se o ticket é novo → `ai_run` +
   `ticket_embedding`.
3. **Buscar** os tickets `resolved` mais parecidos (pgvector), com a última resposta da
   equipe em cada um.
4. **Redigir** um rascunho com esses casos no contexto → `ai_run` + `draft` (`pending`).

Na v1 **não existe envio automático**: todo rascunho passa por um humano.

### Atendente responde (`api`)

Numa **única transação**:

1. cria a `message` com `staff_id`, `delivery_status = 'pending'`, `recipients` (a
   fotografia de quem recebe) e o `message_id_header` gerado;
2. se veio de um rascunho, marca o `draft` como `sent`, com `message_id` e `edited`;
   senão, descarta o rascunho pendente;
3. `status` → `awaiting_customer`, com a `ticket_event`;
4. cria o `job` `send_message`.

### Enviar (`mailer`, job `send_message`)

**Grava primeiro, envia depois** (padrão *outbox*). A resposta já está no banco quando o
envio acontece; se o envio falhar, o `job` tenta de novo.

Se o processo cair **depois** de enviar e **antes** de marcar `sent`, a mensagem pode sair
duas vezes. Como o `Message-ID` é o mesmo, o programa de e-mail do cliente mostra as duas
cópias na mesma conversa. Se o provedor aceitar uma chave de idempotência, o `message.id`
é a chave, e a duplicação não acontece.

A ordem contrária (envia, depois grava) é pior: se a gravação falhar, o e-mail saiu e o
Lume não sabe. A resposta do cliente chega com um `In-Reply-To` que não bate com nada.

### Resolver (`api`)

`status` → `resolved`, `resolved_at` preenchido, `ticket_event`, e uma `message` avisando o
cliente, enviada pelo mesmo caminho de uma resposta.

### Marcar como duplicado (`api`)

O atendente liga o ticket B ao ticket A ("já está sendo tratado no ticket A"). Numa
transação:

1. `B.duplicate_of_ticket_id = A`, e B vira `resolved`;
2. quem abriu B e os participantes de B viram participantes de A (menos quem abriu A);
3. `ticket_event` `marked_duplicate` nos dois tickets.

Assim, quem escreveu em B continua recebendo o andamento de A. Se alguém responder em B,
o threading leva a resposta para A (passo 4 do threading).

Um ticket sempre aponta para o **original**, nunca para outro duplicado: se A também for
marcado como duplicado de C depois, os tickets que apontavam para A passam a apontar para
C. Isso é garantido no código.

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

1. **Modelo de embedding e o `N` do vetor.** O llama.cpp roda um modelo por servidor, então
   o embedding precisa de um segundo servidor ou de uma biblioteca no `worker`. O `N` é
   fixado na migração da `ticket_embedding`.
2. **Texto citado nas respostas.** Quem responde um e-mail costuma arrastar a conversa
   inteira citada embaixo (`> ...`). O `body` precisa ficar sem isso, tanto para exibir
   quanto para a IA ler.
3. **Provedor de envio.** Qual (Resend, Postmark, SES...), e se aceita chave de
   idempotência.
4. **Limite de tentativas** do `job` e o intervalo entre elas.
