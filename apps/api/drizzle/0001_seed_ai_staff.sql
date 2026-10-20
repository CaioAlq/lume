-- Custom SQL migration file, put your code below!

-- A linha da IA em staff: a IA não faz login, então email e password_hash ficam nulos.
INSERT INTO "staff" ("kind", "display_name") VALUES ('ai', 'HelpIA');
