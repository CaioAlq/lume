---
description: Tabelas de apoio: ticket_participant, ticket_event, draft, ai_run, ticket_embedding e job
globs: apps/api/src/db/schema/**, apps/api/drizzle/**, apps/api/test/db/**
related: docs/data-model/tables-core.md, docs/data-model/rules.md
---

# Lume — modelagem do banco: tables-support

> Parte da modelagem do Lume. Visão geral e índice das partes: `overview.md`.

## Tabelas (continuação)

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
| `detail` | `jsonb` com os dados da mudança, ex.: `{"from": "open", "to": "resolved"}`. Nulo quando a mudança não tem dados (ex.: `archived`) |
| `created_at` | |

`kind`: `status_changed`, `assigned`, `urgency_changed`, `category_changed`,
`participant_added`, `participant_removed`, `marked_duplicate`, `archived`, `unarchived`.

- **Índice em `ticket_id`** (o histórico de um ticket) **e em `staff_id`** (o que um atendente fez).

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
