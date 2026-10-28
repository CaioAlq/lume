# Recebimento: grava no banco um e-mail que chegou na caixa de suporte.
# Regras em docs/data-model/flows.md ("Threading", "E-mail chega" e "Detalhes da leitura").
from collections.abc import Iterable
from dataclasses import dataclass
from uuid import UUID

import psycopg


@dataclass
class ParsedEmail:
    message_id: str            # o Message-ID, ou o gerado do hash quando falta
    in_reply_to: str | None
    references: list[str]      # na ordem do cabeçalho: do mais antigo ao mais novo
    from_email: str            # em minúsculas
    from_name: str | None
    addresses: list[str]       # From, To e Cc, em minúsculas, sem repetir
    subject: str
    body: str


def parse(raw: bytes) -> ParsedEmail:
    """Lê os cabeçalhos e o corpo do e-mail (`email.parser.BytesParser` com `policy.default`)."""
    raise NotImplementedError


def is_own(address: str, own_addresses: Iterable[str]) -> bool:
    """O endereço é do Lume? Ignora maiúsculas e o `+sufixo` antes do @."""
    raise NotImplementedError


def find_ticket(conn: psycopg.Connection, email: ParsedEmail) -> UUID | None:
    """Ticket pelo threading (In-Reply-To, depois o References do último ao primeiro).
    Se o ticket achado é duplicado, devolve o original. None quando nada bate."""
    raise NotImplementedError


def get_or_create_customer(conn: psycopg.Connection, email: str, name: str | None) -> UUID:
    raise NotImplementedError


def add_participants(conn: psycopg.Connection, ticket_id: UUID, customer_ids: Iterable[UUID]) -> None:
    """Acrescenta quem ainda não é participante (nem quem abriu o ticket), com `participant_added`."""
    raise NotImplementedError


def apply_customer_reply(conn: psycopg.Connection, ticket_id: UUID) -> None:
    """Transição de status quando o cliente escreve num ticket que já existe, com `status_changed`."""
    raise NotImplementedError


def discard_pending_draft(conn: psycopg.Connection, ticket_id: UUID) -> None:
    raise NotImplementedError


def ingest(conn: psycopg.Connection, raw: bytes, own_addresses: Iterable[str]) -> UUID | None:
    """Grava o e-mail `raw` (bytes RFC 5322) numa transação só, nos passos do flows.md.

    `own_addresses` são os endereços do próprio Lume (ex.: o da caixa de suporte).
    Devolve o id do ticket onde a mensagem entrou, ou None quando nada foi gravado:
    o e-mail já tinha sido processado, ou foi o próprio Lume que mandou.
    """
    raise NotImplementedError
