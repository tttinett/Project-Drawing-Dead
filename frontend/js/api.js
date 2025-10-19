// ===== API ส่วนกลางของระบบจองโต๊ะ Tasty Bar =====
// ใช้ร่วมกันได้ทุกหน้า เช่น notifications.html, reservation-detail.html, results.html, ฯลฯ

// ✅ ตัวช่วยจัดรูปแบบข้อมูลจาก backend ให้ใช้ในหน้าได้ง่าย
function normalizeReservation(r) {
  // when: ถ้า backend ส่ง date_time มาก็ใช้เลย
  const when =
    r.date_time                               // จากวิว v_notifications
    || (r.date && r.time ? `${r.date} ${r.time}` : "")  // fallback
    || "";

  // table label: รองรับทั้ง alias `table` (จากวิว) และ `table_name` (จาก query ปกติ)
  const tableLabel = r.table ?? r.table_name ?? r.tableId ?? "ไม่ระบุ";

  // สถานะ: DB ใช้ 'pending' | 'confirmed' | 'canceled' (หนึ่ง L)
  const status = r.status === "cancelled" ? "canceled" : r.status;

  return { ...r, when, tableLabel, status };
}

window.API = {
  // ดึงรายการจองทั้งหมด (ใช้ในหน้าแจ้งเตือน)
  async list(params = {}) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`/api/reservations${qs ? "?" + qs : ""}`);
    if (!res.ok) throw new Error("โหลดรายการไม่สำเร็จ");
    const data = await res.json();
    return Array.isArray(data) ? data.map(normalizeReservation) : data;
  },

  // ดึงรายละเอียดการจอง (ใช้ใน reservation-detail.html)
  async get(id) {
    const res = await fetch(`/api/reservations/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error("ไม่พบข้อมูล");
    const r = await res.json();
    return normalizeReservation(r);
  },

  // ค้นหาการจองจากชื่อหรือเบอร์โทร (ใช้ใน results.html)
  async search({ name = "", phone = "" }) {
    const res = await fetch(`/api/reservations/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone }),
    });
    if (!res.ok) throw new Error("ค้นหาไม่สำเร็จ");
    const list = await res.json();
    return Array.isArray(list) ? list.map(normalizeReservation) : list;
  },

  // เพิ่มข้อมูลการจองใหม่ (ใช้ใน reserve.html)
  async create(payload) {
    const res = await fetch(`/api/reservations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("สร้างการจองไม่สำเร็จ");
    const r = await res.json();
    return normalizeReservation(r);
  },

  // ยืนยันการจอง
  async confirm(id) {
    const r = await fetch(`/api/reservations/${encodeURIComponent(id)}/confirm`, { method: "POST" });
    if (!r.ok) throw new Error("ยืนยันไม่สำเร็จ");
    const row = await r.json();
    return normalizeReservation(row);
  },

  // ยกเลิกการจอง
  async cancel(id, reason = "-") {
    const r = await fetch(`/api/reservations/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!r.ok) throw new Error("ยกเลิกไม่สำเร็จ");
    const row = await r.json();
    return normalizeReservation(row);
  },

  // กู้คืนการจองที่ถูกยกเลิก
  async restore(id) {
    const r = await fetch(`/api/reservations/${encodeURIComponent(id)}/restore`, { method: "POST" });
    if (!r.ok) throw new Error("กู้คืนไม่สำเร็จ");
    const row = await r.json();
    return normalizeReservation(row);
  },

  // แปลงสถานะเป็นข้อความภาษาไทย (รองรับทั้ง canceled/cancelled)
  statusText(s) {
    const v = s === "cancelled" ? "canceled" : s;
    switch (v) {
      case "pending":   return "รอดำเนินการ";
      case "confirmed": return "ยืนยันแล้ว";
      case "canceled":  return "ยกเลิกแล้ว";
      default:          return v ?? "-";
    }
  }
};

console.log("✅ API.js loaded (patched with normalizeReservation)");
