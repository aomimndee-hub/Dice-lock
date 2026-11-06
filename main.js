import OBR from "https://esm.sh/@owlbear-rodeo/sdk";

const CHANNEL = "com.example.dice-lock/channel";
const STORE = "dice-lock-v1";
const SIDES = [4, 6, 8, 10, 12, 20, 100];
const FALLBACK_MS = 3500;

const $ = (s) => document.querySelector(s);

let role = "PLAYER";
let me = { id: "", name: "" };
let others = [];
let state = { enabled: true, locks: [] }; // เก็บเฉพาะในเบราว์เซอร์ของ DM
let selectedSides = 20;
const seen = new Set();
const lockedRids = new Set(); // ใช้โชว์ 🔒 ในบันทึกของ DM เท่านั้น
const pending = new Map();

try {
  const saved = JSON.parse(localStorage.getItem(STORE) || "null");
  if (saved) state = saved;
} catch {}
const save = () => {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {}
};

const rand = (n) => 1 + Math.floor(Math.random() * n);
const everyone = () => [{ id: me.id, name: me.name + " (ฉัน)", role }, ...others];

// DM คนเดียวที่ทำหน้าที่ตัดสินผล (id น้อยสุดในหมู่ DM) กันตอบซ้ำเมื่อมี DM หลายคน
function isLeader() {
  if (role !== "GM") return false;
  const gmIds = [me.id, ...others.filter((p) => p.role === "GM").map((p) => p.id)];
  return gmIds.sort()[0] === me.id;
}

function send(data, destination) {
  return OBR.broadcast.sendMessage(CHANNEL, data, { destination });
}

// ---- ตัดสินผล (ทำงานที่เครื่อง DM เท่านั้น) ----
function resolve(req) {
  const rolls = [];
  let usedLock = false;
  for (let i = 0; i < req.count; i++) {
    let v;
    const idx = state.enabled
      ? state.locks.findIndex(
          (l) => (l.pid === "*" || l.pid === req.pid) && l.sides === req.sides
        )
      : -1;
    if (idx >= 0) {
      const l = state.locks[idx];
      v = Math.min(Math.max(l.value, 1), req.sides);
      usedLock = true;
      if (l.mode === "once") state.locks.splice(idx, 1);
    } else {
      v = rand(req.sides);
    }
    rolls.push(v);
  }
  if (usedLock) {
    lockedRids.add(req.rid);
    save();
    renderLocks();
  }
  const total = rolls.reduce((a, b) => a + b, 0) + req.mod;
  // ผลที่ส่งให้ทุกคนไม่มีข้อมูลว่าถูกล็อก
  send({ type: "result", ...req, rolls, total }, "ALL");
}

// ---- สร้างคำขอทอย ----
function requestRoll() {
  const count = Math.min(20, Math.max(1, parseInt($("#count").value) || 1));
  const mod = parseInt($("#mod").value) || 0;
  const req = {
    rid: crypto.randomUUID(),
    pid: me.id,
    name: me.name,
    label: $("#label").value.trim(),
    count,
    sides: selectedSides,
    mod,
  };
  if (isLeader()) return resolve(req);

  send({ type: "request", ...req }, "REMOTE");
  // ถ้า DM ไม่ออนไลน์ ให้ทอยสุ่มเองเพื่อไม่ให้เกมค้าง
  const t = setTimeout(() => {
    if (!pending.has(req.rid)) return;
    pending.delete(req.rid);
    const rolls = Array.from({ length: count }, () => rand(req.sides));
    const total = rolls.reduce((a, b) => a + b, 0) + mod;
    send({ type: "result", ...req, rolls, total }, "ALL");
  }, FALLBACK_MS);
  pending.set(req.rid, t);
}

// ---- บันทึกผล ----
function addLog(r) {
  if (seen.has(r.rid)) return;
  seen.add(r.rid);
  const t = pending.get(r.rid);
  if (t) { clearTimeout(t); pending.delete(r.rid); }

  const el = document.createElement("div");
  el.className = "entry";
  const modTxt = r.mod ? (r.mod > 0 ? `+${r.mod}` : r.mod) : "";
  const lock = role === "GM" && lockedRids.has(r.rid) ? " 🔒" : "";
  el.innerHTML =
    `<b></b> ทอย ${r.count}d${r.sides}${modTxt}` +
    (r.label ? ` <i></i>` : "") +
    `: [${r.rolls.join(", ")}] = <span class="total">${r.total}</span>${lock}`;
  el.querySelector("b").textContent = r.name;
  if (r.label) el.querySelector("i").textContent = `(${r.label})`;
  const log = $("#log");
  log.prepend(el);
  while (log.children.length > 40) log.lastChild.remove();
}

// ---- UI ----
function renderDice() {
  const box = $("#dice");
  box.innerHTML = "";
  for (const s of SIDES) {
    const b = document.createElement("button");
    b.textContent = "d" + s;
    if (s === selectedSides) b.className = "on";
    b.onclick = () => { selectedSides = s; renderDice(); };
    box.appendChild(b);
  }
}

function renderDM() {
  if (role !== "GM") return;
  $("#dm").classList.remove("hidden");
  const ps = $("#lockPlayer");
  const cur = ps.value;
  ps.innerHTML = "";
  ps.add(new Option("ทุกคน", "*"));
  for (const p of everyone()) ps.add(new Option(p.name, p.id));
  if ([...ps.options].some((o) => o.value === cur)) ps.value = cur;
  if (!$("#lockSides").options.length) {
    for (const s of SIDES) $("#lockSides").add(new Option("d" + s, s));
    $("#lockSides").value = "20";
  }
  $("#enabled").checked = state.enabled;
  renderLocks();
}

function renderLocks() {
  if (role !== "GM") return;
  const box = $("#locks");
  box.innerHTML = "";
  const names = Object.fromEntries(everyone().map((p) => [p.id, p.name]));
  state.locks.forEach((l, i) => {
    const row = document.createElement("div");
    row.className = "lock";
    const who = l.pid === "*" ? "ทุกคน" : names[l.pid] || "(ออกจากห้องแล้ว)";
    const span = document.createElement("span");
    span.textContent = `${who} · d${l.sides} → ${l.value} · ${l.mode === "once" ? "ครั้งเดียว" : "ตลอด"}`;
    const del = document.createElement("button");
    del.textContent = "ลบ";
    del.onclick = () => { state.locks.splice(i, 1); save(); renderLocks(); };
    row.append(span, del);
    box.appendChild(row);
  });
  if (!state.locks.length) box.innerHTML = '<p class="muted">ยังไม่มีล็อก</p>';
}

OBR.onReady(async () => {
  role = await OBR.player.getRole();
  me = { id: await OBR.player.getId(), name: await OBR.player.getName() };
  others = await OBR.party.getPlayers();

  OBR.party.onChange((p) => { others = p; renderDM(); });
  OBR.player.onChange(async (p) => { role = p.role; me.name = p.name; renderDM(); });

  OBR.broadcast.onMessage(CHANNEL, (event) => {
    const d = event.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "request" && isLeader()) resolve(d);
    else if (d.type === "result") addLog(d);
  });

  renderDice();
  $("#roll").onclick = requestRoll;
  $("#enabled").onchange = (e) => { state.enabled = e.target.checked; save(); };
  $("#addLock").onclick = () => {
    const value = parseInt($("#lockValue").value);
    if (!value || value < 1) return;
    state.locks.push({
      pid: $("#lockPlayer").value,
      sides: parseInt($("#lockSides").value),
      value,
      mode: $("#lockMode").value,
    });
    save();
    renderLocks();
  };
  renderDM();
});
