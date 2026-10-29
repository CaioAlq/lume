# Recebimento: grava no banco um e-mail que chegou na caixa de suporte.
# Regras em docs/data-model/flows.md ("Threading", "E-mail chega" e "Detalhes da leitura").
import hashlib
import re
from collections.abc import Iterable
from dataclasses import dataclass
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr
from html.parser import HTMLParser
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb


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


# Tags que separam blocos de texto: viram quebra de linha ao extrair o texto de um HTML.
BLOCK_TAGS = {
    'address', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'li', 'ol', 'p', 'pre', 'table', 'td', 'th', 'tr', 'ul',
}


class _HtmlText(HTMLParser):
    """Guarda só o texto de um HTML. Ignora o conteúdo de script e style."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skipping = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skipping += 1
        elif tag in BLOCK_TAGS:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skipping = max(0, self.skipping - 1)
        elif tag in BLOCK_TAGS:
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.skipping:
            self.parts.append(data)


def _ids(header_value) -> list[str]:
    """Os ids `<...>` de um cabeçalho (Message-ID, In-Reply-To, References), na ordem em que aparecem."""
    return re.findall(r'<[^<>\s]+>', str(header_value or ''))


def _addresses(msg, header: str) -> list:
    """Endereços (objetos `Address`) de todos os cabeçalhos com esse nome."""
    return [address for value in msg.get_all(header, []) for address in value.addresses]


def _body_text(msg) -> str:
    """Corpo em texto: a parte text/plain; se só houver HTML, o texto dele sem as tags."""
    part = msg.get_body(preferencelist=('plain', 'html'))
    if part is None:
        return ''
    content = part.get_content()
    if part.get_content_type() == 'text/html':
        extractor = _HtmlText()
        extractor.feed(content)
        extractor.close()
        content = ''.join(extractor.parts)
        content = re.sub(r'[ \t]+', ' ', content)
        content = re.sub(r'\n\s*\n+', '\n\n', content)
    return content.strip()


def parse(raw: bytes) -> ParsedEmail:
    """Lê os cabeçalhos e o corpo do e-mail (`email.parser.BytesParser` com `policy.default`)."""
    msg = BytesParser(policy=policy.default).parsebytes(raw)

    senders = _addresses(msg, 'From')
    if not senders or not senders[0].addr_spec:
        # Sem From não há quem abra o ticket. Falha alta, em vez de gravar um cliente sem e-mail.
        raise ValueError('e-mail sem From')
    sender = senders[0]

    addresses: list[str] = []
    for address in senders + _addresses(msg, 'To') + _addresses(msg, 'Cc'):
        spec = address.addr_spec.strip().lower()
        if spec and spec not in addresses:
            addresses.append(spec)

    # Sem Message-ID, o id é o hash dos bytes: ler o mesmo e-mail de novo dá o mesmo id.
    ids = _ids(msg['Message-ID'])
    message_id = ids[0] if ids else f'<{hashlib.sha256(raw).hexdigest()}@missing.lume>'

    in_reply_to_ids = _ids(msg['In-Reply-To'])

    return ParsedEmail(
        message_id=message_id,
        in_reply_to=in_reply_to_ids[0] if in_reply_to_ids else None,
        references=_ids(msg['References']),
        from_email=sender.addr_spec.strip().lower(),
        from_name=(sender.display_name or '').strip() or None,
        addresses=addresses,
        subject=str(msg['Subject'] or '').strip(),
        body=_body_text(msg),
    )


def _normalize(address: str) -> str:
    """Minúsculas, sem o nome do remetente e sem o `+sufixo` antes do @."""
    _, spec = parseaddr(address)
    local, _, domain = (spec or address).strip().lower().partition('@')
    return f"{local.split('+', 1)[0]}@{domain}"


def is_own(address: str, own_addresses: Iterable[str]) -> bool:
    """O endereço é do Lume? Ignora maiúsculas e o `+sufixo` antes do @."""
    target = _normalize(address)
    return any(_normalize(own) == target for own in own_addresses)


def find_ticket(conn: psycopg.Connection, email: ParsedEmail) -> UUID | None:
    """Ticket pelo threading (In-Reply-To, depois o References do último ao primeiro).
    Se o ticket achado é duplicado, devolve o original. None quando nada bate."""
    # Ordem de prioridade: In-Reply-To primeiro, depois as referências da mais nova para a mais antiga.
    candidates = ([email.in_reply_to] if email.in_reply_to else []) + list(reversed(email.references))
    if not candidates:
        return None

    found = dict(
        conn.execute(
            'SELECT message_id_header, ticket_id FROM message WHERE message_id_header = ANY(%s)',
            (candidates,),
        ).fetchall()
    )
    for candidate in candidates:
        if candidate in found:
            # duplicate_of_ticket_id sempre aponta para o original (garantido no código da api).
            [(ticket_id,)] = conn.execute(
                'SELECT COALESCE(duplicate_of_ticket_id, id) FROM ticket WHERE id = %s',
                (found[candidate],),
            ).fetchall()
            return ticket_id
    return None


def get_or_create_customer(conn: psycopg.Connection, email: str, name: str | None) -> UUID:
    email = email.lower()
    row = conn.execute(
        'INSERT INTO customer (email, display_name) VALUES (%s, %s) ON CONFLICT (email) DO NOTHING RETURNING id',
        (email, name),
    ).fetchone()
    if row is not None:
        return row[0]
    # Já existia: o nome do primeiro e-mail fica, não é trocado.
    return conn.execute('SELECT id FROM customer WHERE email = %s', (email,)).fetchone()[0]


def add_participants(conn: psycopg.Connection, ticket_id: UUID, customer_ids: Iterable[UUID]) -> None:
    """Acrescenta quem ainda não é participante (nem quem abriu o ticket), com `participant_added`."""
    [(opener_id,)] = conn.execute('SELECT customer_id FROM ticket WHERE id = %s', (ticket_id,)).fetchall()
    for customer_id in dict.fromkeys(customer_ids):
        if customer_id == opener_id:
            continue
        # ON CONFLICT: quem já é participante não gera evento de novo.
        row = conn.execute(
            """INSERT INTO ticket_participant (ticket_id, customer_id) VALUES (%s, %s)
               ON CONFLICT (ticket_id, customer_id) DO NOTHING RETURNING customer_id""",
            (ticket_id, customer_id),
        ).fetchone()
        if row is not None:
            conn.execute(
                """INSERT INTO ticket_event (ticket_id, staff_id, kind, detail)
                   VALUES (%s, NULL, 'participant_added', %s)""",
                (ticket_id, Jsonb({'customer_id': str(customer_id)})),
            )


def apply_customer_reply(conn: psycopg.Connection, ticket_id: UUID) -> None:
    """Transição de status quando o cliente escreve num ticket que já existe, com `status_changed`."""
    # FOR UPDATE: a api pode estar mudando o mesmo ticket ao mesmo tempo.
    [(status,)] = conn.execute('SELECT status FROM ticket WHERE id = %s FOR UPDATE', (ticket_id,)).fetchall()
    # open e awaiting_staff não mudam com a resposta do cliente, então não geram evento.
    if status not in ('awaiting_customer', 'resolved'):
        return
    # Reabrir um ticket resolvido também limpa resolved_at (ticket_resolved_check).
    conn.execute(
        "UPDATE ticket SET status = 'awaiting_staff', resolved_at = NULL WHERE id = %s",
        (ticket_id,),
    )
    conn.execute(
        """INSERT INTO ticket_event (ticket_id, staff_id, kind, detail)
           VALUES (%s, NULL, 'status_changed', %s)""",
        (ticket_id, Jsonb({'from': status, 'to': 'awaiting_staff'})),
    )


def discard_pending_draft(conn: psycopg.Connection, ticket_id: UUID) -> None:
    """A IA redige de novo depois da resposta do cliente: o rascunho pendente vira `discarded`, sem autor."""
    conn.execute(
        """UPDATE draft SET status = 'discarded', decided_at = now()
           WHERE ticket_id = %s AND status = 'pending'""",
        (ticket_id,),
    )


def _create_ticket(conn: psycopg.Connection, customer_id: UUID, subject: str) -> UUID:
    return conn.execute(
        "INSERT INTO ticket (customer_id, subject, status) VALUES (%s, %s, 'open') RETURNING id",
        (customer_id, subject),
    ).fetchone()[0]


def _record(conn: psycopg.Connection, email: ParsedEmail, own_addresses: list[str]) -> UUID | None:
    """Os passos do flows.md, dentro da transação que quem chama abriu."""
    # 1. Já foi processado?
    if conn.execute('SELECT 1 FROM message WHERE message_id_header = %s', (email.message_id,)).fetchone():
        return None

    # 2. Cliente do From.
    customer_id = get_or_create_customer(conn, email.from_email, email.from_name)

    # 3. Ticket pelo threading, ou ticket novo (open).
    ticket_id = find_ticket(conn, email)
    if ticket_id is None:
        ticket_id = _create_ticket(conn, customer_id, email.subject)

    # 4. A mensagem. Se outro processo gravou o mesmo e-mail ao mesmo tempo, desfaz tudo.
    row = conn.execute(
        """INSERT INTO message (ticket_id, customer_id, body, message_id_header, recorded_at)
           VALUES (%s, %s, %s, %s, now())
           ON CONFLICT (message_id_header) DO NOTHING RETURNING id""",
        (ticket_id, customer_id, email.body, email.message_id),
    ).fetchone()
    if row is None:
        raise psycopg.Rollback()
    message_id = row[0]

    # 5. Participantes: From, To e Cc, menos o Lume (quem abriu o ticket sai dentro de add_participants).
    candidates = [
        get_or_create_customer(conn, address, None)
        for address in email.addresses
        if not is_own(address, own_addresses)
    ]
    add_participants(conn, ticket_id, candidates)

    # 6. Status, 7. rascunho pendente, 8. trabalho da IA.
    apply_customer_reply(conn, ticket_id)
    discard_pending_draft(conn, ticket_id)
    conn.execute("INSERT INTO job (kind, message_id) VALUES ('process_inbound', %s)", (message_id,))
    return ticket_id


def ingest(conn: psycopg.Connection, raw: bytes, own_addresses: Iterable[str]) -> UUID | None:
    """Grava o e-mail `raw` (bytes RFC 5322) numa transação só, nos passos do flows.md.

    `own_addresses` são os endereços do próprio Lume (ex.: o da caixa de suporte).
    Devolve o id do ticket onde a mensagem entrou, ou None quando nada foi gravado:
    o e-mail já tinha sido processado, ou foi o próprio Lume que mandou.
    """
    email = parse(raw)
    own = list(own_addresses)
    if is_own(email.from_email, own):
        return None

    ticket_id = None
    # raise psycopg.Rollback() dentro de _record desfaz a transação e encerra sem erro.
    with conn.transaction():
        ticket_id = _record(conn, email, own)
    return ticket_id
