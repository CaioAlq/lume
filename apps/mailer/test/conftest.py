# Roda antes dos testes. Carrega o .env.example (e o .env) da raiz, cria um banco descartável no Postgres dele e
# aplica as migrações de apps/api/drizzle (a api é dona do schema). No fim, apaga.
import json
import os
import time
from pathlib import Path

import psycopg
import pytest

MIGRATIONS = Path(__file__).parents[2] / 'api' / 'drizzle'
ROOT = Path(__file__).parents[3]


def _load_env() -> None:
    """Carrega o .env da raiz (segredos, se existir) e o .env.example (banco local), nessa
    ordem: o que já foi definido não é sobrescrito, então o .env vale por cima."""
    for env_file in (ROOT / '.env', ROOT / '.env.example'):
        if not env_file.exists():
            continue
        for line in env_file.read_text().splitlines():
            key, sep, value = line.partition('=')
            if sep and not key.strip().startswith('#'):
                os.environ.setdefault(key.strip(), value.strip())


_load_env()

# Tabelas que um teste pode sujar. A linha da IA em staff vem da migração e fica.
TABLES = 'job, ticket_embedding, draft, ai_run, ticket_event, ticket_participant, message, ticket, customer'


def _connect(dbname: str, autocommit: bool = True) -> psycopg.Connection:
    password, port = os.environ.get('DB_PASSWORD'), os.environ.get('DB_PORT', '5432')
    if not password or not os.environ.get('DB_NAME'):
        raise RuntimeError('Faltam DB_PASSWORD e/ou DB_NAME no .env.example da raiz')
    try:
        return psycopg.connect(
            host='127.0.0.1', port=port, user='postgres', password=password, dbname=dbname,
            autocommit=autocommit, connect_timeout=15,
        )
    except psycopg.OperationalError as error:
        raise RuntimeError(f'Banco fora do ar na porta {port}. Suba com: bun run db:up (da raiz)') from error


def _migrate(conn: psycopg.Connection) -> None:
    journal = json.loads((MIGRATIONS / 'meta' / '_journal.json').read_text())
    for entry in journal['entries']:
        sql = (MIGRATIONS / f"{entry['tag']}.sql").read_text()
        for statement in sql.split('--> statement-breakpoint'):
            if statement.strip():
                conn.execute(statement)


@pytest.fixture(scope='session')
def database():
    admin = _connect(os.environ.get('DB_NAME', ''))
    name = f'lume_test_mailer_{time.time_ns()}'
    admin.execute(f'CREATE DATABASE {name}')
    try:
        with _connect(name) as conn:
            _migrate(conn)
        yield name
    finally:
        admin.execute(f'DROP DATABASE IF EXISTS {name} WITH (FORCE)')
        admin.close()


@pytest.fixture
def conn(database):
    """Conexão limpa por teste. Fora de transação: o ingest abre a dele."""
    with _connect(database) as connection:
        connection.execute(f'TRUNCATE {TABLES} CASCADE')
        yield connection
