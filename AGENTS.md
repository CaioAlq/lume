# Lume — regras do projeto

Helpdesk por e-mail: um endereço é o único canal de suporte de um app. Uma LLM local
classifica os e-mails por urgência, encontra casos parecidos já resolvidos e redige
respostas; um humano revisa.

Este arquivo vale para o projeto inteiro. **Cada app tem o próprio `AGENTS.md`** com o que é só
dele. Para uma tarefa de um app só, **abra o agente na pasta do app**: ele carrega o `AGENTS.md`
do app e este juntos. Para uma tarefa que cruza apps, abra na raiz e leia o do app antes de mexer nele.

| App | Regras do app |
|---|---|
| api | `apps/api/AGENTS.md` |
| web | `apps/web/AGENTS.md` (nasce junto com o app; ainda não existe) |

---

## Estrutura

Monorepo com workspaces do Bun. Mapa completo e o porquê em `docs/architecture.md` e
`docs/adr/0001-estrutura-do-monorepo.md`.

```
apps/<app>/          um app por processo (hoje só apps/api)
  AGENTS.md          regras só do app: o que faz, módulos, comandos
  docs/<modulo>.md   um doc por módulo, não por arquivo
  src/<modulo>/      código, organizado por módulo
  test/<modulo>/     testes, no mesmo caminho do src/
packages/shared/     tipos e contratos que a api e o web dividem
docs/                docs do projeto inteiro: arquitetura, modelagem, decisões (adr/)
```

---

## Docs

A modelagem do banco está em `docs/data-model/` (comece pelo `overview.md`) e é a fonte da
verdade. **Não mude uma decisão registrada lá por conta própria** (ex.: criar coluna de ordem,
trocar as duas FKs de autor por um `author_id` genérico). Se achar que ela está errada, diga
por quê e pergunte antes.

**Antes de mexer numa área, leia o doc dela.** O cabeçalho `globs` de cada doc diz quais
pastas ele cobre (ex.: `apps/api/docs/db.md` cobre `apps/api/src/db/**`).

Decisão de arquitetura nova vira um ADR em `docs/adr/`, numerado (`0002-...md`).

---

## Comandos (da raiz)

| Comando | Para quê |
|---|---|
| `bun install` | instala as dependências de todos os apps e pacotes |
| `bun run db:up` | liga o OrbStack (no Mac) e sobe o Postgres, esperando ele ficar pronto; precisa do `.env` (sai do `.env.example`) |
| `bun run typecheck` | typecheck de todos os workspaces |
| `bun run test` | testes de todos os workspaces (precisa do banco no ar) |

---

## Antes de terminar

Rode, da raiz, **`bun run typecheck`** e **`bun run test`**. A tarefa só está pronta quando os
dois passam. Se um teste falhar, corrija o código, não o teste: os testes escrevem regras
do projeto, e mudar um teste é mudar uma decisão.

---

## Fatos do ambiente

Pontos em que a memória do modelo costuma estar desatualizada. Valem mais que ela.

- **Lockfiles são commitados**, nunca vão para o `.gitignore`: `bun.lock` (e o antigo
  binário `bun.lockb`), `pnpm-lock.yaml` e `uv.lock`.
- **`.angular/`** é cache do Angular CLI e vai no `.gitignore`.
- **Postgres 18:** o volume do container monta em `/var/lib/postgresql`, sem o `/data`
  no final (ver `compose.yaml`).

---

## Idioma

| Em inglês | Em português |
|---|---|
| tabelas, colunas, valores de status | comentários no código |
| variáveis, funções, classes, tipos | texto explicativo em `docs/` |
| nomes de arquivo e pasta | descrição da mensagem de commit |
| rotas da API, chaves de JSON | |

```ts
// Busca a conversa do ticket na ordem em que aconteceu.   ← comentário em português
export async function getTicketMessages(ticketId: string) { ... }   ← nome em inglês
```

Errado: `buscarMensagens`, `tabela_cliente`, `status = 'aberto'`.

---

## Nomes do domínio

| Conceito | Nome | Observação |
|---|---|---|
| cliente | `customer` | um por endereço de e-mail |
| atendente | `staff` | **inclui a LLM**, que é uma linha dessa tabela |
| ticket | `ticket` | |
| mensagem | `message` | |

**Nunca use `agent` nem `operator` para o atendente.** `agent` colide com *agente de
IA*, e neste projeto os dois conceitos convivem no mesmo código. `operator` é palavra-chave
do Postgres. Para o pipeline de IA, use nomes que descrevam o que ele faz (`classifier`,
`drafter`, `worker`), não `agent`.

**Nenhum identificador pode ser palavra-chave** do Postgres, do TypeScript ou do Python,
nem mesmo as não reservadas. Em particular, **não crie tabela `user`**: é reservada no
Postgres e exigiria aspas em toda consulta. Antes de criar um nome novo de tabela ou
coluna, confira; se estiver em dúvida, pergunte.

---

## Commits

[Conventional Commits](https://www.conventionalcommits.org): `tipo(escopo): descrição`.
Tipo e escopo em inglês; descrição em português, no presente, começando em minúscula.

```
feat(api): adiciona endpoint de listagem de tickets
fix(worker): corrige desempate na ordenação das mensagens
docs(db): adiciona modelagem inicial do banco
```

**Tipos:** `feat` · `fix` · `docs` · `refactor` · `test` · `chore` · `build` · `ci` ·
`perf` · `style`

**Escopos iniciais:** `db` · `api` · `mailer` · `worker` · `web` · `infra`. Crie um escopo novo só
quando surgir uma área nova do projeto, não para uma tarefa.

Linha do assunto com até 72 caracteres. Se precisar explicar o porquê, use o corpo do
commit, depois de uma linha em branco.
