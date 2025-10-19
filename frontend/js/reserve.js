// frontend/js/reserve.js
async function loadTables() {
  const res = await fetch("/api/tables");
  const tables = await res.json();
  const div = document.getElementById("tableList");
  div.innerHTML = tables.map(t => `
    <div class="item">
      <div>
        <b>${t.table_name}</b> — สถานะ: <span>${t.status}</span>
      </div>
      <div>
        <button onclick="confirmReservationByTable(${t.table_id})">ยืนยัน</button>
        <button onclick="cancelReservationPrompt(${t.table_id})">ยกเลิก</button>
      </div>
    </div>
  `).join("");
}

async function loadReservations() {
  const res = await fetch("/api/reservations");
  const list = await res.json();
  const div = document.getElementById("resvList");
  if (!Array.isArray(list) || list.length === 0) {
    div.innerHTML = '<div class="item">ยังไม่มีข้อมูล</div>';
    return;
  }
  div.innerHTML = list.map(r => `
    <div class="item">
      <div>
        <b>#${r.id}</b> โต๊ะ: ${r.table} — ผู้จอง: ${r.name} — เวลา: ${r.date_time} — สถานะ: ${r.status}
      </div>
      <div>
        <button onclick="confirmReservation(${r.id})">ยืนยัน</button>
        <button onclick="cancelReservation(${r.id})">ยกเลิก</button>
      </div>
    </div>
  `).join("");
}

// ถ้ายืนยันโดยรู้ reservation_id
async function confirmReservation(id) {
  await fetch(`/api/confirm/${id}`, { method: "POST" });
  alert("✅ ยืนยันเรียบร้อย");
  await Promise.all([loadTables(), loadReservations()]);
}

// เดโม: ถ้ายืนยันโดยเลือกจาก table_id (สมมติว่าไปรูมกับรายการ pending ล่าสุด)
async function confirmReservationByTable(tableId) {
  // ในงานจริงควรมี API หา reservation_id ตาม tableId+เวลา
  alert("ตัวอย่างนี้สาธิตเฉย ๆ: โปรดใช้ปุ่มยืนยันในรายการจองด้านล่างที่มีหมายเลข #id");
}

async function cancelReservation(id) {
  const reason = prompt("เหตุผลการยกเลิก:");
  if (reason === null) return;
  await fetch(`/api/cancel/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  alert("❌ ยกเลิกเรียบร้อย");
  await Promise.all([loadTables(), loadReservations()]);
}

function cancelReservationPrompt(tableId) {
  alert("ตัวอย่างนี้สาธิตเฉย ๆ: โปรดกดยกเลิกที่รายการจองด้านล่าง (ต้องมีหมายเลข #id)");
}

loadTables();
loadReservations();
