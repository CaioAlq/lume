# Lume

[![CI](https://github.com/CaioAlq/lume/actions/workflows/ci.yml/badge.svg)](https://github.com/CaioAlq/lume/actions/workflows/ci.yml)

**Helpdesk por e-mail com IA que roda na sua máquina.** Um endereço de e-mail é o único canal de
suporte de um app: a IA classifica cada mensagem por urgência, encontra casos parecidos já
resolvidos e redige a resposta. Um humano revisa e envia. Nenhum e-mail de cliente sai para uma
API externa de IA.

O projeto também é um experimento sobre **desenvolvimento com IA guiado por testes**: as decisões
e os testes vêm antes, o código é escrito por um agente, e cada mudança no fluxo é medida.

## Por que este projeto

A ideia veio de uma dor comum de quem trabalha como freelancer e atende vários clientes: os pedidos
de suporte chegam por e-mail, misturados na caixa de entrada, e é fácil perder o fio de uma conversa,
esquecer quem está esperando resposta ou responder de novo algo que já foi resolvido antes. O Lume
organiza isso em tickets, ordena pela urgência e já sugere a resposta com base nos casos parecidos.

---

## O que este repositório mostra

- **IA local no produto.** Classificação, busca por similaridade (pgvector) e rascunho de resposta
  com um modelo servido pelo `llama.cpp`, sem depender de API paga nem mandar dado de cliente para
  fora.
- **Desenvolvimento com agentes, medido.** O código começou sendo escrito por um modelo local numa
  GPU de notebook; medindo na mesma tarefa, o fluxo passou para um modelo pequeno na nuvem como
  implementador, com testes e revisão por mutação. Os números estão abaixo.
- **Testes antes do código, no projeto inteiro.** Todo comportamento novo começa por um teste que
  falha: regras do banco, endpoints da api, telas do web, etapas do pipeline da IA. O agente só
  termina quando os testes passam. É o teste, não a opinião do modelo, que diz o que está pronto.
- **Documentação para humanos e para agentes.** Docs curtos, ligados às pastas onde valem, decisões
  registradas em ADRs e um `AGENTS.md` por app.
- **Decisões medidas.** Cada mudança no fluxo com o agente foi testada antes e depois; o que não
  melhorou o resultado saiu.

---

## Como funciona

```
web (Angular) ──HTTP──▶ api (Bun/TS) ──┐
                                        ├──▶ Postgres + pgvector
Gmail (IMAP+SMTP) ◀▶ mailer (Python) ──┤
                                        │
llama.cpp ◀──HTTP── worker (Python) ───┘
```

1. O **mailer** lê a caixa de entrada e grava cada e-mail como mensagem de um ticket, respeitando o
   encadeamento (`Message-ID`, `In-Reply-To`, `References`), para uma resposta do cliente não abrir
   ticket novo.
2. O **worker** chama a LLM local: classifica urgência e categoria, busca tickets parecidos já
   resolvidos por embedding e redige um rascunho com esses casos no contexto.
3. Na **web**, o atendente vê a fila por urgência e aprova, edita ou descarta o rascunho.
4. O envio passa por uma fila no próprio Postgres (`FOR UPDATE SKIP LOCKED`), sem Redis.

**A IA sugere, o humano decide.** O modo padrão é rascunho. Toda execução da IA fica registrada
(modelo, versão do prompt, latência, decisão e se o humano corrigiu), para medir a **taxa de
correção humana** ao longo do tempo.

As regras de integridade ficam no banco (`CHECK`, `UNIQUE`, FKs), e não só no código, porque três
programas em duas linguagens gravam nas mesmas tabelas. Detalhes em
[`docs/architecture.md`](docs/architecture.md) e [`docs/data-model/`](docs/data-model/overview.md).

---

## Desenvolvimento com agentes

**A concepção do projeto e toda a arquitetura são minhas:** a divisão em processos (api, mailer e
worker que só conversam pelo banco), a modelagem das tabelas e as regras que o banco garante, o
threading de e-mail, a fila em Postgres no lugar do Redis e o fluxo de trabalho com os agentes. A IA
escreve o código a partir dessas decisões, e todo PR passa pela minha aprovação antes do merge.

### O fluxo

1. **Humano decide** o comportamento e as regras (em `docs/`), e **tudo vira teste antes do código**.
2. **Um agente implementa** até os testes passarem, sem poder mudar os testes, fazer commit, trocar
   de branch nem ler segredos (regras de permissão na ferramenta, não só no prompt).
3. **Revisão** do diff contra os docs e **teste de mutação**: o código é estragado de propósito, um
   ponto por vez, para provar que os testes pegam o erro. O que escapa vira teste novo.

Hoje o **Claude Opus** escreve os testes e os docs e faz a revisão; o **Claude Haiku** implementa.

### Fase 1: LLM local como implementador

| | |
|---|---|
| Servidor do modelo | PC com **RTX 4060 Laptop (8 GB de VRAM)** e **32 GB de RAM**, `llama.cpp` |
| Modelos | MoE open-weight de ~35B (poucos bilhões ativos por token), quantizados em ~Q4 |
| Cliente | agente de código [pi](https://github.com/earendil-works/pi), na rede local |

O que mudou o resultado, na mesma tarefa (conexão, schema e migrações das três primeiras tabelas):

| Configuração | Resultado |
|---|---|
| Modelagem num doc longo, sem testes | **9 de 13** checagens automáticas; a conexão travava sem dar erro |
| Docs curtos por área + 18 testes escritos antes | **18 de 18** testes passando, typecheck limpo |

E o que **não** funcionou, medido e descartado: pedir ao modelo que revisasse o próprio trabalho
(nenhum ganho e ~55% mais tempo) e dar ferramentas extras ao agente (muitos tokens, quase nenhum uso).

### Fase 2: a medição que mudou o fluxo

Na tarefa do recebimento de e-mail (`apps/mailer`, 27 testes e esqueleto prontos):

| | LLM local (~35B, Q4) | Claude Haiku |
|---|---|---|
| Testes | **0 de 27** em 3 tentativas | **27 de 27** |
| Tempo | ~58 min somados | ~2 min |
| Comportamento | estourou o limite de saída tentando planejar tudo de uma vez; numa tentativa, contornou um bloqueio e expôs a senha do banco local | parou e apontou um erro **no teste**, sem mudá-lo |

Duas lições ficaram no fluxo: **as regras de permissão precisam bloquear o contorno**, não só o
comando (o agente que não lê o `.env` também não pode rodar `docker inspect`), e **o ponto fraco
passou a ser o teste, não o código**: o teste de mutação achou lacunas nos testes em todas as tarefas.

A IA **do produto** continua local: classificação, embedding e rascunho rodam no `llama.cpp`, e
nenhum e-mail de cliente vai para uma API externa.

---

## Documentação para agentes

- **`AGENTS.md` na raiz** com as regras do projeto e **um por app** (`apps/api/AGENTS.md`, `apps/mailer/AGENTS.md`). Abrindo o
  agente na pasta do app, ele carrega os dois desde o primeiro turno.
- **Docs curtos (até ~250 linhas)** com um cabeçalho que liga o doc às pastas onde ele vale:

  ```markdown
  ---
  description: Como escrever a conexão, o schema e as migrações do banco na api
  globs: apps/api/src/db/**, apps/api/drizzle/**, apps/api/test/db/**
  related: docs/data-model/rules.md
  ---
  ```
- **ADRs** em [`docs/adr/`](docs/adr/) para cada decisão de arquitetura, inclusive as que foram
  revistas depois.
- Os docs registram também o que o modelo costuma errar (versões novas de ferramentas, armadilhas do
  Drizzle), porque a memória dele é mais antiga que as versões instaladas.

---

## Stack

| Parte | Tecnologia |
|---|---|
| api | Bun, TypeScript 7, Drizzle ORM |
| banco | Postgres 18 + pgvector, UUIDv7, regras em `CHECK`/`UNIQUE` |
| testes | escritos antes do código: `bun test` na api (contra um Postgres de verdade, num banco descartável por execução), `pytest` no Python, o runner do Angular no web |
| web | Angular (planejado) |
| mailer | Python, uv, psycopg, pytest; e-mail pelo Gmail (IMAP + SMTP) |
| worker | Python, uv, pytest (planejado) |
| LLM do produto | `llama.cpp` com modelo open-weight local; embeddings com Qwen3-Embedding-0.6B |
| desenvolvimento | Claude Code (Opus orquestra e revisa, Haiku implementa), teste de mutação |
| infra | Docker Compose, monorepo com workspaces do Bun |

---

## Estado atual

O projeto está em construção, em fatias.

- **Pronto:** modelagem completa da v1 (11 tabelas, com `pgvector` e a fila de jobs) com migrações
  e **143 testes** das regras do banco; o **recebimento de e-mail** no mailer (threading,
  participantes, status, idempotência) com **27 testes**.
- **Próximo:** o mailer lendo a caixa do Gmail por IMAP, depois o worker de IA e as telas do atendente.
- **Meta da v1:** a fatia ponta a ponta. Um e-mail chega, vira ticket, a IA sugere uma resposta, o
  atendente aprova e o e-mail é enviado.

---

## Rodando

Pré-requisitos: Bun e Docker (no Mac, OrbStack ou Docker Desktop).

```bash
bun run db:up                      # liga o OrbStack (no Mac) e sobe o Postgres 18
bun install
bun run typecheck
bun run test                       # api: 143 testes contra um Postgres de verdade
cd apps/mailer && uv run pytest    # mailer: precisa do uv
```

O banco local usa a configuração do `.env.example` (senha só de desenvolvimento, ele escuta só em
`127.0.0.1`). O `.env` fica para segredo de verdade, como a senha de app do Gmail.

## Estrutura

| Pasta | O que é |
|---|---|
| `apps/api/` | a api, organizada por módulo (`src/`, `test/` e `docs/` com o mesmo nome) |
| `apps/mailer/` | o mailer em Python (`src/mailer/`, `test/`) |
| `packages/shared/` | tipos e contratos que a api e o web dividem |
| `docs/` | arquitetura, modelagem do banco e decisões (`adr/`) |
| `scripts/` | scripts do projeto (ex.: subir o banco) |

## Licença

[MIT](LICENSE)
