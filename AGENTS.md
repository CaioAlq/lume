# Lume — regras do projeto

Helpdesk por e-mail: um endereço é o único canal de suporte de um app. Uma LLM local
classifica os e-mails por urgência, encontra casos parecidos já resolvidos e redige
respostas; um humano revisa.

A modelagem do banco está em `docs/data-model.md` e é a fonte da verdade. **Não mude uma
decisão registrada lá por conta própria** (ex.: criar coluna de ordem, trocar as duas FKs
de autor por um `author_id` genérico). Se achar que ela está errada, diga por quê e
pergunte antes.

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
