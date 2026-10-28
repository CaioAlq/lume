# Apoio aos testes: monta e-mails de verdade (bytes RFC 5322) e lê o banco.
from email.message import EmailMessage
from email.utils import format_datetime
from datetime import datetime, UTC

OWN = ['suporte@lume.test']


def make_email(
    *,
    from_: str = 'Ana Souza <ana@cliente.test>',
    to: str = 'suporte@lume.test',
    cc: str | None = None,
    subject: str | None = 'Não consigo entrar',
    message_id: str | None = '<a1@cliente.test>',
    in_reply_to: str | None = None,
    references: str | None = None,
    date: datetime | None = None,
    body: str = 'Olá, minha senha não funciona.',
    html: str | None = None,
) -> bytes:
    msg = EmailMessage()
    msg['From'] = from_
    msg['To'] = to
    if cc:
        msg['Cc'] = cc
    if subject is not None:
        msg['Subject'] = subject
    if message_id:
        msg['Message-ID'] = message_id
    if in_reply_to:
        msg['In-Reply-To'] = in_reply_to
    if references:
        msg['References'] = references
    msg['Date'] = format_datetime(date or datetime.now(UTC))
    msg.set_content(body)
    if html is not None:
        msg.add_alternative(html, subtype='html')
    return bytes(msg)


def make_html_only_email(html: str, message_id: str = '<h1@cliente.test>') -> bytes:
    msg = EmailMessage()
    msg['From'] = 'ana@cliente.test'
    msg['To'] = 'suporte@lume.test'
    msg['Subject'] = 'Só HTML'
    msg['Message-ID'] = message_id
    msg.set_content(html, subtype='html')
    return bytes(msg)


def rows(conn, sql: str, *params) -> list[tuple]:
    return conn.execute(sql, params).fetchall()


def count(conn, table: str) -> int:
    return conn.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
