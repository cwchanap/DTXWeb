-- packages/e2e-web/setup/seed.sql — idempotent four-chart seed for the parity gate.
-- TEST_USER_ID is substituted by prepare-stack.ts before execution.
DELETE FROM dtx_files WHERE simfile_id IN (1001, 1002, 1003, 1004);
DELETE FROM simfiles WHERE id IN (1001, 1002, 1003, 1004);

INSERT INTO simfiles (id, title, artist, bpm, user_id, is_published, display_id)
VALUES (1001, 'E2E Lifecycle Chart', 'E2E', 120, '__TEST_USER_ID__', 0, 1001);

INSERT INTO simfiles (id, title, artist, bpm, user_id, is_published, display_id)
VALUES (1002, 'E2E Download Chart', 'E2E', 140, '__TEST_USER_ID__', 1, 1002);

INSERT INTO simfiles (id, title, artist, bpm, user_id, is_published, display_id)
VALUES (1003, 'E2E Private Download Chart', 'E2E', 130, '__TEST_USER_ID__', 0, 1003);

-- Published chart whose SET.def exercises mixed directive forms, duplicate
-- labels, a >L5 slot and a subdirectory file reference. Row insert order is
-- significant: the two 'Basic Multi' rows pair FIFO with the SET.def entries
-- of the same label (r2Enrichment filesByLabel shift()).
INSERT INTO simfiles (id, title, artist, bpm, user_id, is_published, display_id)
VALUES (1004, 'E2E SET.def Chart', 'E2E', 150, '__TEST_USER_ID__', 1, 1004);

INSERT INTO dtx_files (label, level, simfile_id) VALUES ('BASIC', 40, 1001);
INSERT INTO dtx_files (label, level, simfile_id) VALUES ('BASIC', 50, 1002);
INSERT INTO dtx_files (label, level, simfile_id) VALUES ('BASIC', 45, 1003);
INSERT INTO dtx_files (label, level, simfile_id) VALUES ('Basic Easy', 40, 1004);
INSERT INTO dtx_files (label, level, simfile_id) VALUES ('Basic Multi', 50, 1004);
INSERT INTO dtx_files (label, level, simfile_id) VALUES ('Basic Multi', 60, 1004);
INSERT INTO dtx_files (label, level, simfile_id) VALUES ('Extreme L6', 85, 1004);
