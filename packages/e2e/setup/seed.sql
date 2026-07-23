-- packages/e2e/setup/seed.sql — idempotent two-chart seed for the parity gate.
-- TEST_USER_ID is substituted by prepare-stack.ts before execution.
DELETE FROM dtx_files WHERE simfile_id IN (1001, 1002);
DELETE FROM simfiles WHERE id IN (1001, 1002);

INSERT INTO simfiles (id, title, artist, bpm, user_id, is_published, display_id)
VALUES (1001, 'E2E Lifecycle Chart', 'E2E', 120, '__TEST_USER_ID__', 0, 1001);

INSERT INTO simfiles (id, title, artist, bpm, user_id, is_published, display_id)
VALUES (1002, 'E2E Download Chart', 'E2E', 140, '__TEST_USER_ID__', 1, 1002);

INSERT INTO dtx_files (label, level, simfile_id) VALUES ('BASIC', 50, 1002);
