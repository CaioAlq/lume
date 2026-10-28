# Especifica o recebimento (docs/data-model/flows.md, "Threading" e "E-mail chega").
import hashlib
import re
from datetime import datetime, UTC

import psycopg
import pytest

from helpers import OWN, count, make_email, make_html_only_email, rows
from mailer.ingest import ingest


def ai_staff(conn):
    return conn.execute("SELECT id FROM staff WHERE kind = 'ai'").fetchone()[0]


def staff_reply(conn, ticket_id, message_id_header):
    """Uma resposta da equipe já enviada, como o envio gravaria."""
    conn.execute(
        """INSERT INTO message (ticket_id, staff_id, body, message_id_header, recorded_at, delivery_status, sent_at, recipients)
           VALUES (%s, %s, 'Resposta da equipe', %s, now(), 'sent', now(), ARRAY['ana@cliente.test'])""",
        (ticket_id, ai_staff(conn), message_id_header),
    )


def set_status(conn, ticket_id, status):
    resolved = 'now()' if status == 'resolved' else 'NULL'
    conn.execute(f'UPDATE ticket SET status = %s, resolved_at = {resolved} WHERE id = %s', (status, ticket_id))


def status_events(conn, ticket_id):
    return rows(
        conn,
        "SELECT staff_id, detail FROM ticket_event WHERE ticket_id = %s AND kind = 'status_changed'",
        ticket_id,
    )


# --- e-mail novo -------------------------------------------------------------------------


def test_new_email_creates_customer_ticket_and_message(conn):
    ticket_id = ingest(conn, make_email(from_='Ana Souza <Ana@Cliente.test>'), OWN)

    assert ticket_id is not None
    [(customer_id, email, name)] = rows(conn, 'SELECT id, email, display_name FROM customer')
    assert (email, name) == ('ana@cliente.test', 'Ana Souza')
    assert rows(conn, 'SELECT id, customer_id, subject, status, staff_id FROM ticket') == [
        (ticket_id, customer_id, 'Não consigo entrar', 'open', None)
    ]
    [msg] = rows(
        conn,
        """SELECT ticket_id, customer_id, staff_id, message_id_header, delivery_status, sent_at, recipients
           FROM message""",
    )
    assert msg == (ticket_id, customer_id, None, '<a1@cliente.test>', None, None, None)
    [(body,)] = rows(conn, 'SELECT body FROM message')
    assert body.strip() == 'Olá, minha senha não funciona.'


def test_new_ticket_has_no_status_event(conn):
    """Nascer `open` não é mudança de status."""
    ticket_id = ingest(conn, make_email(), OWN)
    assert status_events(conn, ticket_id) == []


def test_existing_customer_is_reused_ignoring_case(conn):
    ingest(conn, make_email(from_='ana@cliente.test', message_id='<a1@cliente.test>'), OWN)
    ingest(conn, make_email(from_='ANA@cliente.test', message_id='<a2@cliente.test>'), OWN)
    assert count(conn, 'customer') == 1


def test_subject_is_decoded_and_missing_subject_is_empty(conn):
    first = ingest(conn, make_email(subject='=?utf-8?q?Fatura_em_dobro_=C3=A9?=', message_id='<s1@c.test>'), OWN)
    second = ingest(conn, make_email(subject=None, message_id='<s2@c.test>'), OWN)
    assert rows(conn, 'SELECT subject FROM ticket WHERE id = %s', first) == [('Fatura em dobro é',)]
    assert rows(conn, 'SELECT subject FROM ticket WHERE id = %s', second) == [('',)]


def test_recorded_at_is_server_time_not_date_header(conn):
    ingest(conn, make_email(date=datetime(2001, 1, 1, tzinfo=UTC)), OWN)
    [(recorded_at,)] = rows(conn, 'SELECT recorded_at FROM message')
    assert abs((datetime.now(UTC) - recorded_at).total_seconds()) < 60


def test_creates_process_inbound_job_for_the_message(conn):
    ingest(conn, make_email(), OWN)
    [(message_id,)] = rows(conn, 'SELECT id FROM message')
    assert rows(conn, 'SELECT kind, message_id, status FROM job') == [('process_inbound', message_id, 'pending')]


# --- idempotência ------------------------------------------------------------------------


def test_same_message_id_twice_records_nothing_the_second_time(conn):
    raw = make_email()
    assert ingest(conn, raw, OWN) is not None
    assert ingest(conn, raw, OWN) is None
    for table in ('customer', 'ticket', 'message', 'job'):
        assert count(conn, table) == 1, table


def test_missing_message_id_gets_one_from_the_raw_bytes(conn):
    """Sem Message-ID, o id vem do hash do e-mail: ler o mesmo e-mail de novo não duplica."""
    raw = make_email(message_id=None)
    ingest(conn, raw, OWN)
    assert ingest(conn, raw, OWN) is None
    [(header,)] = rows(conn, 'SELECT message_id_header FROM message')
    assert header == f'<{hashlib.sha256(raw).hexdigest()}@missing.lume>'


# --- threading ---------------------------------------------------------------------------


def test_in_reply_to_puts_message_in_that_ticket(conn):
    ticket_id = ingest(conn, make_email(message_id='<a1@c.test>'), OWN)
    staff_reply(conn, ticket_id, '<r1@lume.test>')
    again = ingest(conn, make_email(message_id='<a2@c.test>', in_reply_to='<r1@lume.test>'), OWN)
    assert again == ticket_id
    assert count(conn, 'ticket') == 1


def test_references_is_used_when_in_reply_to_matches_nothing(conn):
    ticket_id = ingest(conn, make_email(message_id='<a1@c.test>'), OWN)
    raw = make_email(message_id='<a2@c.test>', in_reply_to='<sumiu@x.test>', references='<a1@c.test> <sumiu@x.test>')
    assert ingest(conn, raw, OWN) == ticket_id


def test_in_reply_to_wins_over_references(conn):
    first = ingest(conn, make_email(message_id='<a1@c.test>'), OWN)
    second = ingest(conn, make_email(message_id='<b1@c.test>'), OWN)
    raw = make_email(message_id='<a2@c.test>', in_reply_to='<b1@c.test>', references='<a1@c.test>')
    assert ingest(conn, raw, OWN) == second != first


def test_references_uses_the_most_recent_matching_id(conn):
    """O References vai do mais antigo ao mais novo; vale o último id que bate."""
    first = ingest(conn, make_email(message_id='<a1@c.test>'), OWN)
    second = ingest(conn, make_email(message_id='<b1@c.test>'), OWN)
    raw = make_email(message_id='<a2@c.test>', references='<a1@c.test> <b1@c.test> <sumiu@x.test>')
    assert ingest(conn, raw, OWN) == second != first


def test_same_subject_and_customer_without_headers_is_a_new_ticket(conn):
    first = ingest(conn, make_email(message_id='<a1@c.test>', subject='Ajuda'), OWN)
    second = ingest(conn, make_email(message_id='<a2@c.test>', subject='Ajuda'), OWN)
    assert first != second
    assert count(conn, 'ticket') == 2


def test_reply_to_a_duplicate_goes_to_the_original(conn):
    original = ingest(conn, make_email(message_id='<a1@c.test>'), OWN)
    duplicate = ingest(conn, make_email(message_id='<b1@c.test>'), OWN)
    set_status(conn, duplicate, 'resolved')
    conn.execute('UPDATE ticket SET duplicate_of_ticket_id = %s WHERE id = %s', (original, duplicate))

    assert ingest(conn, make_email(message_id='<b2@c.test>', in_reply_to='<b1@c.test>'), OWN) == original


# --- participantes -----------------------------------------------------------------------


def participants(conn, ticket_id):
    return sorted(
        r[0]
        for r in rows(
            conn,
            """SELECT c.email FROM ticket_participant p JOIN customer c ON c.id = p.customer_id
               WHERE p.ticket_id = %s""",
            ticket_id,
        )
    )


def test_to_and_cc_become_participants_except_lume_and_opener(conn):
    raw = make_email(
        from_='ana@cliente.test',
        to='Suporte <SUPORTE@lume.test>, bruno@cliente.test',
        cc='ana@cliente.test, Carla <Carla@cliente.test>, suporte+vendas@lume.test',
    )
    ticket_id = ingest(conn, raw, OWN)
    assert participants(conn, ticket_id) == ['bruno@cliente.test', 'carla@cliente.test']
    assert count(conn, 'customer') == 3  # o Lume não vira customer


def test_each_new_participant_gets_an_event(conn):
    ticket_id = ingest(conn, make_email(cc='bruno@cliente.test'), OWN)
    [(bruno,)] = rows(conn, "SELECT id FROM customer WHERE email = 'bruno@cliente.test'")
    assert rows(conn, "SELECT staff_id, detail FROM ticket_event WHERE kind = 'participant_added'") == [
        (None, {'customer_id': str(bruno)})
    ]
    assert ticket_id is not None


def test_headers_only_add_participants_never_remove(conn):
    ticket_id = ingest(conn, make_email(message_id='<a1@c.test>', cc='bruno@cliente.test'), OWN)
    ingest(conn, make_email(message_id='<a2@c.test>', in_reply_to='<a1@c.test>'), OWN)
    ingest(conn, make_email(message_id='<a3@c.test>', in_reply_to='<a2@c.test>', cc='bruno@cliente.test'), OWN)
    assert participants(conn, ticket_id) == ['bruno@cliente.test']
    assert rows(conn, "SELECT count(*) FROM ticket_event WHERE kind = 'participant_added'") == [(1,)]


def test_participant_who_writes_does_not_change_the_opener(conn):
    ticket_id = ingest(conn, make_email(message_id='<a1@c.test>', cc='bruno@cliente.test'), OWN)
    ingest(conn, make_email(from_='bruno@cliente.test', message_id='<b1@c.test>', in_reply_to='<a1@c.test>'), OWN)
    [(opener,)] = rows(conn, 'SELECT c.email FROM ticket t JOIN customer c ON c.id = t.customer_id')
    assert opener == 'ana@cliente.test'
    assert participants(conn, ticket_id) == ['bruno@cliente.test']


def test_email_from_lume_itself_is_ignored(conn):
    assert ingest(conn, make_email(from_='Suporte <suporte+x@LUME.test>'), OWN) is None
    for table in ('customer', 'ticket', 'message', 'job'):
        assert count(conn, table) == 0, table


# --- status ------------------------------------------------------------------------------


def reply_in_status(conn, status):
    ticket_id = ingest(conn, make_email(message_id='<a1@c.test>'), OWN)
    if status != 'open':
        set_status(conn, ticket_id, status)
    ingest(conn, make_email(message_id='<a2@c.test>', in_reply_to='<a1@c.test>'), OWN)
    return ticket_id


@pytest.mark.parametrize('status', ['open', 'awaiting_staff'])
def test_customer_writing_again_keeps_status_without_event(conn, status):
    ticket_id = reply_in_status(conn, status)
    assert rows(conn, 'SELECT status FROM ticket') == [(status,)]
    assert status_events(conn, ticket_id) == []


@pytest.mark.parametrize('status', ['awaiting_customer', 'resolved'])
def test_customer_reply_moves_to_awaiting_staff_with_event(conn, status):
    ticket_id = reply_in_status(conn, status)
    assert rows(conn, 'SELECT status, resolved_at FROM ticket') == [('awaiting_staff', None)]
    assert status_events(conn, ticket_id) == [(None, {'from': status, 'to': 'awaiting_staff'})]


# --- rascunho ----------------------------------------------------------------------------


def test_pending_draft_is_discarded_by_the_system(conn):
    ticket_id = ingest(conn, make_email(message_id='<a1@c.test>'), OWN)
    [(message_id,)] = rows(conn, 'SELECT id FROM message')
    [(run_id,)] = rows(
        conn,
        """INSERT INTO ai_run (ticket_id, message_id, task, model, prompt_version, status, latency_ms, output)
           VALUES (%s, %s, 'draft', 'm', 'v1', 'succeeded', 1, '{}') RETURNING id""",
        ticket_id, message_id,
    )
    conn.execute("INSERT INTO draft (ticket_id, ai_run_id, body, status) VALUES (%s, %s, 'x', 'pending')", (ticket_id, run_id))

    ingest(conn, make_email(message_id='<a2@c.test>', in_reply_to='<a1@c.test>'), OWN)

    [(status, by, decided_at)] = rows(conn, 'SELECT status, decided_by_staff_id, decided_at FROM draft')
    assert (status, by) == ('discarded', None)
    assert decided_at is not None


# --- corpo -------------------------------------------------------------------------------


def test_body_prefers_plain_text_over_html(conn):
    ingest(conn, make_email(body='versão texto', html='<p>versão <b>html</b></p>'), OWN)
    [(body,)] = rows(conn, 'SELECT body FROM message')
    assert body.strip() == 'versão texto'


def test_html_only_body_is_stored_without_tags(conn):
    ingest(conn, make_html_only_email('<html><body><p>Olá <b>equipe</b></p><p>tchau</p></body></html>'), OWN)
    [(body,)] = rows(conn, 'SELECT body FROM message')
    assert '<' not in body
    assert re.sub(r'\s+', ' ', body).strip() == 'Olá equipe tchau'


# --- transação ---------------------------------------------------------------------------


def test_failure_in_any_step_records_nothing(conn):
    conn.execute(
        """CREATE FUNCTION fail_job() RETURNS trigger LANGUAGE plpgsql AS
           $f$ BEGIN RAISE EXCEPTION 'falha de teste'; END $f$"""
    )
    conn.execute('CREATE TRIGGER fail_job BEFORE INSERT ON job FOR EACH ROW EXECUTE FUNCTION fail_job()')
    try:
        with pytest.raises(psycopg.Error):
            ingest(conn, make_email(cc='bruno@cliente.test'), OWN)
        for table in ('customer', 'ticket', 'message', 'ticket_participant', 'ticket_event'):
            assert count(conn, table) == 0, table
    finally:
        conn.execute('DROP TRIGGER fail_job ON job')
        conn.execute('DROP FUNCTION fail_job()')
