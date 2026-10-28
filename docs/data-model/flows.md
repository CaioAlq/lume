---
description: Threading de e-mail e os fluxos de mailer, worker e api
globs: apps/mailer/**, apps/worker/**
related: docs/data-model/tables-core.md, docs/data-model/tables-support.md, docs/data-model/rules.md
---

# Lume — modelagem do banco: flows

> Parte da modelagem do Lume. Visão geral e índice das partes: `overview.md`.

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

1. se já existe `message` com esse `message_id_header`, o e-mail **já foi processado**:
   encerra sem gravar nada e sem erro;
2. encontra ou cria o `customer` do `From`;
3. encontra o ticket pelo threading, ou cria um `ticket` novo (`open`);
4. grava a `message` com `ON CONFLICT (message_id_header) DO NOTHING`. Se não gravou
   nada, outro processo gravou o mesmo e-mail ao mesmo tempo: **desfaz a transação inteira**
   (`raise psycopg.Rollback()`) e encerra sem erro. A `message` não vem primeiro porque
   precisa do `ticket_id`;
5. acrescenta participantes, pelas regras da `ticket_participant`;
6. aplica a transição de `status` e grava a `ticket_event`;
7. descarta o rascunho pendente do ticket, se houver;
8. cria o `job` `process_inbound`.

Se qualquer passo falhar, nada fica gravado, e o e-mail é lido de novo na próxima vez.

**Detalhes da leitura** (cada um tem teste em `apps/mailer/test/test_ingest.py`):
- **Endereços do Lume:** a lista vem da configuração; `suporte+qualquer@dominio` conta como
  `suporte@dominio`, e a comparação ignora maiúsculas. E-mail com `From` do Lume é ignorado.
- **Sem `Message-ID`:** o id vira `<sha256-dos-bytes@missing.lume>`. Ler o mesmo e-mail de
  novo dá o mesmo id, e o `ON CONFLICT` do passo 1 continua valendo.
- **`References` com mais de um id conhecido:** vale o **último** que bate (a lista vai do
  mais antigo ao mais novo). O `In-Reply-To` vem antes de todos.
- **Assunto:** decodificado (`=?utf-8?...?=`); sem assunto, texto vazio.
- **Corpo:** a parte `text/plain`; se só houver HTML, o texto dele sem as tags. O texto
  citado ainda não é cortado (pendência em `overview.md`).
- **Hora:** `recorded_at` é a hora do servidor; o `Date` do e-mail é ignorado.
- **Eventos:** cada participante novo gera `participant_added` com
  `{"customer_id": "<uuid>"}`; mudança de status gera `status_changed` com
  `{"from": ..., "to": ...}`. Os dois com `staff_id` nulo (foi o sistema). Ticket novo
  nasce `open` sem evento.

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

**O envio é pelo SMTP da própria caixa de suporte (Gmail)**, a mesma que o `mailer` lê por
IMAP. Assim o `Message-ID` que o Lume gerou é mantido, e a resposta aparece em Enviados da
caixa, como se alguém tivesse respondido de lá. Serviços de envio ficaram de fora: o SES
troca o `Message-ID` pelo dele, e os outros não garantem manter o nosso.

| | Gmail |
|---|---|
| SMTP | `smtp.gmail.com`, porta 465 (SSL) |
| IMAP | `imap.gmail.com`, porta 993 (SSL) |
| Login | o endereço da caixa + **senha de app** (exige verificação em duas etapas), no `.env` |
| `From` | o endereço da caixa; outro endereço o Gmail reescreve |
| Limite | ~500 destinatários por dia (conta pessoal); ~2000 no Workspace |

**Não enviar duas vezes.** Se o processo cair **depois** de enviar e **antes** de marcar
`sent`, o `job` volta e tentaria de novo. Por isso, **numa nova tentativa** (`attempts > 0`),
antes de enviar o `mailer` procura o `Message-ID` na pasta de enviados pelo IMAP
(`SEARCH HEADER Message-ID <id>`):
- **achou:** o e-mail já saiu; só marca `sent`;
- **não achou:** envia.

A pasta de enviados é achada pelo atributo `\Sent` do `LIST`, não pelo nome, porque o
Gmail traduz o nome da pasta para o idioma da conta. O Gmail salva sozinho em Enviados o
que sai pelo SMTP; não precisa de `APPEND`.

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
