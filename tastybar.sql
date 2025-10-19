-- =============================================
-- Database: tastybar (with transactions in procedures)
-- =============================================

DROP DATABASE IF EXISTS tastybar;
CREATE DATABASE tastybar CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE tastybar;

-- =========================
-- Owners
-- =========================
CREATE TABLE owners (
  owner_id    INT AUTO_INCREMENT PRIMARY KEY,
  shop_name   VARCHAR(100) NOT NULL,
  username    VARCHAR(50)  NOT NULL UNIQUE,
  password    VARCHAR(100) NOT NULL
);

INSERT INTO owners (shop_name, username, password)
VALUES ('Tasty Bar', 'TongEiw', '1234');

-- =========================
-- Tables
-- =========================
CREATE TABLE tables (
  table_id   INT AUTO_INCREMENT PRIMARY KEY,
  table_name VARCHAR(20) NOT NULL,
  status     ENUM('free','busy') NOT NULL DEFAULT 'free',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO tables (table_name, status) VALUES
('Table 1','free'),
('Table 2','busy'),
('Table 3','free'),
('Table 4','busy');

-- =========================
-- Reservations
-- =========================
CREATE TABLE reservations (
  reservation_id INT AUTO_INCREMENT PRIMARY KEY,
  table_id       INT NOT NULL,
  customer_name  VARCHAR(100) NOT NULL,
  phone          VARCHAR(20),
  email          VARCHAR(120),
  reserve_date   DATE NOT NULL,
  reserve_time   TIME NOT NULL,
  duration_min   INT  NOT NULL DEFAULT 120,
  status         ENUM('pending','confirmed','canceled') NOT NULL DEFAULT 'pending',
  cancel_reason  VARCHAR(255),
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_resv_table FOREIGN KEY (table_id) REFERENCES tables(table_id)
);

ALTER TABLE reservations
  ADD COLUMN start_dt DATETIME GENERATED ALWAYS AS (TIMESTAMP(reserve_date, reserve_time)) STORED,
  ADD COLUMN end_dt   DATETIME GENERATED ALWAYS AS (DATE_ADD(TIMESTAMP(reserve_date, reserve_time), INTERVAL duration_min MINUTE)) STORED;

CREATE INDEX idx_resv_table_time  ON reservations(table_id, start_dt, end_dt);
CREATE INDEX idx_resv_status_time ON reservations(status, start_dt);

-- Mock data
INSERT INTO reservations (table_id, customer_name, phone, email, reserve_date, reserve_time, duration_min, status)
VALUES
(1, 'Hojun',   '0991234567', 'hojun@mail.com', '2025-10-16','19:00:00', 120, 'pending'),
(2, 'Jonh',   '0987654321', 'john@mail.com',  '2025-10-17','20:00:00', 120, 'confirmed'),
(3, 'Bam', '0612345678', 'bam@mail.com',   '2025-10-18','18:30:00', 120, 'canceled'),
(4, 'Zojer',   '0801231234', 'zojer@mail.com', '2025-11-01','21:00:00', 150, 'confirmed');

-- =========================
-- View
-- =========================
CREATE OR REPLACE VIEW v_notifications AS
SELECT
  r.reservation_id AS id,
  t.table_name     AS `table`,
  r.customer_name  AS name,
  DATE_FORMAT(r.start_dt, '%Y-%m-%d %H:%i') AS date_time,
  r.reserve_date   AS `date`,
  r.reserve_time   AS `time`,
  r.status         AS `status`
FROM reservations r
JOIN tables t ON r.table_id = t.table_id
ORDER BY r.created_at DESC;

-- =========================
-- Triggers
-- =========================
DELIMITER $$

DROP TRIGGER IF EXISTS trg_resv_no_overlap_bi $$
CREATE TRIGGER trg_resv_no_overlap_bi
BEFORE INSERT ON reservations
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1 FROM reservations r
    WHERE r.table_id = NEW.table_id
      AND r.status <> 'canceled'
      AND (NEW.start_dt < r.end_dt AND NEW.end_dt > r.start_dt)
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'มีการจองซ้อนสำหรับโต๊ะนี้ในช่วงเวลาเดียวกัน';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_resv_sync_table_au $$
CREATE TRIGGER trg_resv_sync_table_au
AFTER UPDATE ON reservations
FOR EACH ROW
BEGIN
  DECLARE active_count INT DEFAULT 0;
  SELECT COUNT(*) INTO active_count
  FROM reservations r
  WHERE r.table_id = NEW.table_id
    AND r.status = 'confirmed'
    AND r.end_dt > NOW();

  IF active_count > 0 THEN
    UPDATE tables SET status = 'busy' WHERE table_id = NEW.table_id;
  ELSE
    UPDATE tables SET status = 'free' WHERE table_id = NEW.table_id;
  END IF;
END $$

DELIMITER ;

-- =========================
-- Stored Procedures (WITH TRANSACTIONS + error handlers)
-- =========================
DELIMITER $$

DROP PROCEDURE IF EXISTS sp_confirm_reservation $$
CREATE PROCEDURE sp_confirm_reservation(IN p_resv_id INT)
BEGIN
  DECLARE v_table_id INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;
    SELECT table_id INTO v_table_id FROM reservations WHERE reservation_id = p_resv_id FOR UPDATE;
    UPDATE reservations SET status = 'confirmed', cancel_reason = NULL WHERE reservation_id = p_resv_id;
    UPDATE tables SET status = 'busy' WHERE table_id = v_table_id;
  COMMIT;
END $$

DROP PROCEDURE IF EXISTS sp_cancel_reservation $$
CREATE PROCEDURE sp_cancel_reservation(IN p_resv_id INT, IN p_reason VARCHAR(255))
BEGIN
  DECLARE v_table_id INT;
  DECLARE active_count INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;
    SELECT table_id INTO v_table_id FROM reservations WHERE reservation_id = p_resv_id FOR UPDATE;
    UPDATE reservations SET status = 'canceled', cancel_reason = p_reason WHERE reservation_id = p_resv_id;
    SELECT COUNT(*) INTO active_count FROM reservations r WHERE r.table_id = v_table_id AND r.status = 'confirmed' AND r.end_dt > NOW();
    IF active_count = 0 THEN
      UPDATE tables SET status = 'free' WHERE table_id = v_table_id;
    END IF;
  COMMIT;
END $$

DROP PROCEDURE IF EXISTS sp_restore_reservation $$
CREATE PROCEDURE sp_restore_reservation(IN p_resv_id INT)
BEGIN
  DECLARE v_table_id INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;
    SELECT table_id INTO v_table_id FROM reservations WHERE reservation_id = p_resv_id FOR UPDATE;
    UPDATE reservations SET status = 'pending', cancel_reason = NULL WHERE reservation_id = p_resv_id;
    UPDATE tables SET status = 'free' WHERE table_id = v_table_id;
  COMMIT;
END $$

DELIMITER ;

-- =========================
-- Events
-- =========================
SET GLOBAL event_scheduler = ON;

DELIMITER $$

DROP EVENT IF EXISTS ev_auto_cancel_overdue $$
CREATE EVENT ev_auto_cancel_overdue
  ON SCHEDULE EVERY 1 DAY
  STARTS TIMESTAMP(CURRENT_DATE, '03:00:00')
  DO
BEGIN
  UPDATE reservations
     SET status = 'canceled',
         cancel_reason = 'หมดเวลา/ไม่ยืนยัน'
   WHERE status = 'pending'
     AND end_dt < NOW();
END $$

DROP EVENT IF EXISTS ev_sync_table_status $$
CREATE EVENT ev_sync_table_status
  ON SCHEDULE EVERY 10 MINUTE
  DO
BEGIN
  UPDATE tables t
  JOIN (
    SELECT table_id, COUNT(*) AS cnt
    FROM reservations
    WHERE status = 'confirmed' AND end_dt > NOW()
    GROUP BY table_id
  ) x ON x.table_id = t.table_id
  SET t.status = 'busy';

  UPDATE tables t
  LEFT JOIN (
    SELECT table_id, COUNT(*) AS cnt
    FROM reservations
    WHERE status = 'confirmed' AND end_dt > NOW()
    GROUP BY table_id
  ) x ON x.table_id = t.table_id
  SET t.status = 'free'
  WHERE x.table_id IS NULL;
END $$

DELIMITER ;

-- End of script
