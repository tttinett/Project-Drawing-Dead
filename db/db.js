// db/db.js
import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: "localhost",
  user: "root",      // ⚠️ เปลี่ยนให้ตรงกับเครื่องของคุณ
  password: "",      // ⚠️ ใส่รหัสผ่านถ้ามี
  database: "tastybar",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export default pool;
