# mailer — regras do app

Lê a caixa de suporte no Gmail (IMAP) e grava tickets e mensagens; envia as respostas (SMTP).
Python + uv. Vale junto com o `AGENTS.md` da raiz.

**Abra o agente na raiz do repositório** (não em `apps/mailer/`): o mailer usa as migrações de
`apps/api/drizzle/` e os docs de `docs/`, que ficam fora da pasta do app.

## Módulos

| Módulo | Faz | Regras em |
|---|---|---|
| `src/mailer/ingest.py` | grava um e-mail recebido, numa transação | `docs/data-model/flows.md` ("Threading" e "E-mail chega") |

O banco é da api: o schema e as migrações ficam em `apps/api/`. O mailer **não cria nem muda
tabela**; se faltar algo no banco, pare e pergunte.

## Testes

- `apps/mailer/test/test_<modulo>.py` testa `apps/mailer/src/mailer/<modulo>.py`.
- `test/conftest.py` carrega o `.env.example` (e o `.env`) da raiz, cria um banco descartável, aplica as migrações de `apps/api/drizzle/` e limpa
  as tabelas antes de cada teste. `test/helpers.py` monta e-mails de verdade (`make_email`).
- Os testes rodam no Postgres de verdade (`bun run db:up` antes).
- **Se um comando for bloqueado, pare e pergunte.** A config do banco local
  está no `.env.example`; não procure senha por outro caminho (`docker inspect`, variáveis do container).

## Comandos (de `apps/mailer/`)

| Comando | Para quê |
|---|---|
| `uv sync` | instala as dependências |
| `uv run pytest` | testes; o `test/conftest.py` carrega o `.env.example` (e o `.env`) da raiz sozinho |
| `uv add <pacote>` | nova dependência; **pergunte antes** |

Use só a biblioteca padrão do Python e o `psycopg` para o e-mail e o banco (`email`, `imaplib`,
`smtplib`, `html.parser`).
