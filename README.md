# Lume

**Helpdesk por e-mail com IA que roda na sua máquina.** Um endereço de e-mail é o único canal de
suporte de um app: a IA classifica cada mensagem por urgência, encontra casos parecidos já
resolvidos e redige a resposta. Um humano revisa e envia. Nenhum e-mail de cliente sai para uma
API externa de IA.

O projeto também é um experimento sobre **desenvolvimento com LLM local**: boa parte do código é
escrita por um modelo open-weight rodando numa GPU de notebook, guiado por testes escritos antes e
por documentação feita para ser lida por agentes.

---

## O que este repositório mostra

- **IA local no produto.** Classificação, busca por similaridade (pgvector) e rascunho de resposta
  com um modelo servido pelo `llama.cpp`, sem depender de API paga nem mandar dado de cliente para
  fora.
- **IA local no desenvolvimento.** Um modelo de 35B parâmetros rodando numa RTX 4060 de notebook
  (8 GB) escreve código de produção. As decisões e a revisão ficam com um humano.
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
IMAP / provedor ◀──▶ mailer (Python) ──┤
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

## Desenvolvimento com LLM local

### O hardware

| | |
|---|---|
| Servidor do modelo | PC com **RTX 4060 Laptop (8 GB de VRAM)** e **32 GB de RAM**, `llama.cpp` |
| Modelo | **Ornith 1.5 35B A3B** (MoE, ~3B ativos por token), quantizado em Q4_K_L (~21 GB) |
| Como cabe | camadas de atenção na GPU, experts do MoE na RAM (`--n-cpu-moe`), contexto de 131k tokens |
| Velocidade | ~37 tokens/s de geração |
| Cliente | Agente de código [pi](https://github.com/earendil-works/pi) apontando para o servidor na rede local |

### Como o modelo foi escolhido

Com uma suíte própria de avaliação: 14 tarefas com nota automática em 7 categorias (edição com
SEARCH/REPLACE exato, depuração, uso de ferramentas, código, formato, contenção e contexto longo),
rodada com os mesmos parâmetros do uso real. Mais de dez modelos locais foram comparados; o Ornith
1.5 ficou em primeiro, com 99%.

### O fluxo

1. **Humano decide** o comportamento e as regras (em `docs/`), e **tudo vira teste antes do código**:
   hoje as regras do banco; a seguir os endpoints, as telas e o pipeline da IA.
2. **O agente local implementa** com o doc da área no contexto e termina rodando `bun run typecheck`
   e `bun run test`.
3. **Revisão** do diff contra os docs, com ajuda do Claude Code. O que o agente errou vira regra
   nova no doc ou teste novo, nunca só uma correção pontual.

### O que mudou o resultado, medido

Na mesma tarefa (conexão, schema e migrações das três primeiras tabelas), com o mesmo modelo:

| Configuração | Resultado |
|---|---|
| Modelagem num doc longo, sem testes | **9 de 13** checagens automáticas (conexão, migração e regras do banco); a conexão travava sem dar erro |
| Docs curtos por área + 18 testes escritos antes | **18 de 18** testes passando, typecheck limpo |

E o que **não** funcionou, também medido e descartado:

- **Pedir ao modelo que revisasse o próprio trabalho** antes de terminar: nenhum ganho de nota e
  ~55% mais tempo. O modelo confirma o que já acredita; um teste falhando traz informação nova.
- **Ferramentas extras no agente**: ~3.600 tokens a mais por requisição e quase nenhum uso. O agente
  ficou só com uma camada de permissões e uma extensão própria que entrega ao modelo o doc certo
  quando ele toca um arquivo da área.

---

## Documentação para agentes

- **`AGENTS.md` na raiz** com as regras do projeto e **um por app** (`apps/api/AGENTS.md`). Abrindo o
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
| mailer e worker | Python, uv, ruff, pytest (planejado) |
| LLM | `llama.cpp` com modelo open-weight local |
| infra | Docker Compose, monorepo com workspaces do Bun |

---

## Estado atual

O projeto está em construção, em fatias.

- **Pronto:** estrutura do monorepo, modelagem completa da v1 documentada, módulo de banco da api
  (`customer`, `staff`, `staff_session`) com migrações e 18 testes das regras.
- **Próximo:** tabelas `ticket` e `message`, depois o restante do banco, o mailer e o worker.
- **Meta da v1:** a fatia ponta a ponta. Um e-mail chega, vira ticket, a IA sugere uma resposta, o
  atendente aprova e o e-mail é enviado.

---

## Rodando

Pré-requisitos: Bun e Docker (no Mac, OrbStack ou Docker Desktop).

```bash
cp .env.example .env               # e troque os valores marcados
bun run db:up                      # liga o OrbStack (no Mac) e sobe o Postgres 18
bun install
bun run typecheck
bun run test
```

## Estrutura

| Pasta | O que é |
|---|---|
| `apps/api/` | a api, organizada por módulo (`src/`, `test/` e `docs/` com o mesmo nome) |
| `packages/shared/` | tipos e contratos que a api e o web dividem |
| `docs/` | arquitetura, modelagem do banco e decisões (`adr/`) |
| `scripts/` | scripts do projeto (ex.: subir o banco) |
