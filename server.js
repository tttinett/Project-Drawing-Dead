import express from "express";
import cors from "cors";
import pool from "./db/db.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "frontend")));

// ---------------- Reservations API ----------------

// GET /api/reservations  (list)
app.get("/api/reservations", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        r.reservation_id       AS id,
        t.table_name           AS \`table\`,     -- ✅ ใช้ \`table\` (หลีกเลี่ยงชน keyword)
        r.customer_name        AS \`name\`,
        DATE(r.reserve_date)   AS \`date\`,      -- ✅ เอาเวลาออก
        r.status
      FROM reservations r
      JOIN tables t ON r.table_id = t.table_id
      ORDER BY r.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error("❌ DB Error:", err);
    res.status(500).json({ error: "DB_QUERY_ERROR" });
  }
});

// GET /api/reservations/:id  (detail)
app.get("/api/reservations/:id", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        r.reservation_id AS id,
        t.table_name     AS table_name,
        r.customer_name  AS name,
        r.reserve_date   AS date,
        r.phone, r.email,
        r.status, r.cancel_reason
      FROM reservations r
      JOIN tables t ON r.table_id = t.table_id
      WHERE r.reservation_id = ?
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "NOT_FOUND" });
    res.json(rows[0]);
  } catch (e) {
    console.error("DETAIL_ERROR:", e);
    res.status(500).json({ error: "DB_ERROR" });
  }
});

// POST /api/reservations (create) — UI ไม่มีเวลา แต่ DB ยังต้องการคอลัมน์นี้ → ใส่ค่า default
app.post("/api/reservations", async (req, res) => {
  try {
    const {
      table_id,
      customer_name,
      phone = null,
      email = null,
      reserve_date,
      // แม้ UI จะไม่ส่งมา เราตั้ง default เอง
      reserve_time,
      duration_min = 120,
    } = req.body || {};

    if (!table_id || !customer_name || !reserve_date) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "กรอก โต๊ะ/ชื่อ/วันที่ ให้ครบ" });
    }

    // ถ้าไม่ได้ส่ง reserve_time มา ให้ตั้งเป็น 00:00:00 เสมอ เพื่อให้ตรงกับสคีมา/ทริกเกอร์ที่คาดหวัง
    const timeForDb = (!reserve_time || !/^\d{2}:\d{2}(:\d{2})?$/.test(reserve_time))
      ? "00:00:00"
      : (reserve_time.length === 5 ? `${reserve_time}:00` : reserve_time);

    await pool.query(
      `INSERT INTO reservations
        (table_id, customer_name, phone, email, reserve_date, reserve_time, duration_min, status)
       VALUES (?,?,?,?,?,?,?, 'pending')`,
      [table_id, customer_name, phone, email, reserve_date, timeForDb, duration_min]
    );

    const [[row]] = await pool.query(`
      SELECT r.reservation_id AS id,
             t.table_name AS table_name,
             r.customer_name AS name,
             r.reserve_date AS date,
             r.status
      FROM reservations r
      JOIN tables t ON r.table_id = t.table_id
      WHERE r.reservation_id = LAST_INSERT_ID()
    `);

    res.status(201).json({ success: true, newItem: row });
  } catch (e) {
    if (e && (e.code === "ER_SIGNAL_EXCEPTION" || String(e.sqlMessage || "").includes("จองซ้อน"))) {
      return res.status(409).json({ error: "OVERLAP", message: "มีการจองซ้อนสำหรับโต๊ะนี้ในช่วงเวลาเดียวกัน" });
    }
    console.error("CREATE_ERROR:", e);
    res.status(500).json({ error: "DB_ERROR", message: "สร้างการจองไม่สำเร็จ" });
  }
});

// POST /api/reservations/search  (by name/phone)
// POST /api/reservations/search  (by name/phone)
app.post("/api/reservations/search", async (req, res) => {
  const { name = "", phone = "" } = req.body ?? {};
  try {
    const [rows] = await pool.query(`
      SELECT 
        r.reservation_id AS id,
        t.table_name     AS table,          -- ✅ ให้ชื่อฟิลด์เป็น table
        r.customer_name  AS name,
        DATE_FORMAT(r.reserve_date, '%Y-%m-%d') AS date,  -- ✅ วันที่แบบ YYYY-MM-DD
        r.status
      FROM reservations r 
      JOIN tables t ON r.table_id = t.table_id
      WHERE (? = '' OR r.customer_name LIKE CONCAT('%',?,'%'))
        AND (? = '' OR r.phone        LIKE CONCAT('%',?,'%'))
      ORDER BY r.created_at DESC
    `, [name, name, phone, phone]);

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "DB_ERROR" });
  }
});

// POST /api/reservations/:id/confirm
app.post("/api/reservations/:id/confirm", async (req, res) => {
  try {
    await pool.query("CALL sp_confirm_reservation(?)", [req.params.id]);
    const [[row]] = await pool.query(`
      SELECT r.reservation_id AS id, t.table_name AS table_name,
             r.customer_name AS name, r.reserve_date AS date, r.status
      FROM reservations r JOIN tables t ON r.table_id = t.table_id
      WHERE r.reservation_id = ?
    `, [req.params.id]);
    res.json(row);
  } catch (e) {
    console.error("CONFIRM_ERROR:", e);
    res.status(500).json({ error: "DB_ERROR" });
  }
});

// POST /api/reservations/:id/cancel
app.post("/api/reservations/:id/cancel", async (req, res) => {
  try {
    const reason = req.body?.reason ?? "-";
    await pool.query("CALL sp_cancel_reservation(?, ?)", [req.params.id, reason]);
    const [[row]] = await pool.query(`
      SELECT r.reservation_id AS id, t.table_name AS table_name,
             r.customer_name AS name, r.reserve_date AS date, r.status, r.cancel_reason
      FROM reservations r JOIN tables t ON r.table_id = t.table_id
      WHERE r.reservation_id = ?
    `, [req.params.id]);
    res.json(row);
  } catch (e) {
    console.error("CANCEL_ERROR:", e);
    res.status(500).json({ error: "DB_ERROR" });
  }
});

// POST /api/reservations/:id/restore
app.post("/api/reservations/:id/restore", async (req, res) => {
  try {
    await pool.query("CALL sp_restore_reservation(?)", [req.params.id]);
    const [[row]] = await pool.query(`
      SELECT r.reservation_id AS id, t.table_name AS table_name,
             r.customer_name AS name, r.reserve_date AS date, r.status
      FROM reservations r JOIN tables t ON r.table_id = t.table_id
      WHERE r.reservation_id = ?
    `, [req.params.id]);
    res.json(row);
  } catch (e) {
    console.error("RESTORE_ERROR:", e);
    res.status(500).json({ error: "DB_ERROR" });
  }
});

// Tables API
app.get("/api/tables", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM tables");
    res.json(rows);
  } catch (e) {
    console.error("TABLES_ERROR:", e);
    res.status(500).json({ error: "DB_ERROR" });
  }
});

// route เริ่มต้น
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "reserve.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
