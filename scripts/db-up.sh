#!/usr/bin/env bash
# Sobe o banco do Lume: no macOS com OrbStack, liga o OrbStack antes; depois sobe o
# Postgres pelo compose e espera o healthcheck dizer que ele está pronto.
# Uso (da raiz): bun run db:up
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Falta o .env na raiz. Crie com: cp .env.example .env (e troque os valores)" >&2
  exit 1
fi

# O docker compose não liga o Docker: só conversa com ele. No Mac, quem traz o Docker é o
# OrbStack, e `orb start` não faz nada se ele já estiver ligado.
if [[ "$(uname)" == "Darwin" ]] && command -v orb >/dev/null 2>&1; then
  orb start
fi

if ! docker info >/dev/null 2>&1; then
  echo "O Docker não está respondendo. Ligue o OrbStack, o Docker Desktop ou o serviço docker e tente de novo." >&2
  exit 1
fi

# --wait espera o healthcheck do compose.yaml: quando o comando volta, o banco já aceita conexão.
docker compose up -d --wait database
echo "Banco no ar."
