# Lume

Helpdesk por e-mail: um endereço é o único canal de suporte de um app. Uma LLM local classifica
os e-mails por urgência, encontra casos parecidos já resolvidos e redige respostas; um humano
revisa e envia.

## Estrutura

| Pasta | O que é |
|---|---|
| `apps/api/` | a api (Bun + TypeScript + Drizzle) |
| `packages/shared/` | tipos e contratos que a api e o web dividem |
| `docs/` | arquitetura, modelagem do banco e decisões (`adr/`) |

Mapa completo em [`docs/architecture.md`](docs/architecture.md).

## Rodando

```bash
cp .env.example .env               # e troque os valores marcados
bun run db:up                      # liga o OrbStack (no Mac) e sobe o Postgres 18
bun install
bun run typecheck
bun run test
```
