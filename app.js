'use strict';

/* =========================================================================
   Kalkulátor FTE -> WPL — logika je 1:1 přepis původního calculator.py
   (funkce nacti_data_z_excelu a spocitej_a_uloz_kalkulaci), pouze běžící
   v prohlížeči nad SQLite databází přes sql.js.
   ========================================================================= */

const ZONES = ["service_zone", "meeting_zone", "backoffice_zone", "office_room"];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS absence (
  segment TEXT PRIMARY KEY,
  nepritomnost REAL,
  homeoffice REAL
);
CREATE TABLE IF NOT EXISTS casove_dotace (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment TEXT,
  pozice TEXT,
  service_zone REAL,
  meeting_zone REAL,
  backoffice_zone REAL,
  office_room REAL
);
CREATE TABLE IF NOT EXISTS excel_loads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  load_key TEXT,
  pobocka_id TEXT,
  pobocka_nazev TEXT,
  oteviraci_doba REAL,
  segment TEXT,
  pozice TEXT,
  fte REAL,
  wpl_load REAL,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS calculations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  load_key TEXT,
  calculation_key TEXT,
  segment TEXT,
  total_positions REAL,
  position_list TEXT,
  service_zone REAL,
  meeting_zone REAL,
  backoffice_zone REAL,
  office_room REAL,
  created_at TEXT
);
`;

// Výchozí referenční data — shodná s inicializace_db.py, použije se jen při
// založení nové (prázdné) databáze.
const SEED_ABSENCE = [
  ["MMMA", 22.9, 0.7], ["EPC", 19.7, 2.5], ["HC", 19.8, 5.6], ["PROVOZ", 21, 0.5],
  ["EPB", 18.6, 1.5], ["SBC", 19.5, 5.5], ["RKC", 17.1, 7], ["CESTOVNÍ", 0, 0],
  ["OSTATNÍ", 20.1, 2.3],
];

const SEED_CASOVE_DOTACE = [
  ["SBC", "firemní bankéř - medior", null, 20, 80, null],
  ["SBC", "podpora firemních bankéřů", null, 10, 90, null],
  ["SBC", "firemní bankéř - senior", null, 20, 80, null],
  ["SBC", "firemní bankéř - master", null, 20, 80, null],
  ["SBC", "manažer segmentu SB - regionální ředitel", null, null, null, 100],
  ["SBC", "manažer segmentu SB - team leader", null, null, 100, null],
  ["SBC", "spec. pro firemní pojištění - senior", null, 20, 80, null],
  ["RKC", "Ředitel regionálního korporátního centra", null, null, null, 100],
  ["RKC", "korporátní finanční analytik - senior", null, null, 100, null],
  ["RKC", "korporátní finanční analytik - master", null, null, 100, null],
  ["RKC", "spec. korporátní klientely - asistent", null, null, 100, null],
  ["RKC", "korporátní úvěrový specialista - medior", null, null, 100, null],
  ["RKC", "korporátní úvěrový specialista - senior", null, null, 100, null],
  ["PROVOZ", "regionální manažer provozu", null, null, 100, null],
  ["PROVOZ", "manažer provozu pob. sítě - team leader", null, null, 100, null],
  ["PROVOZ", "pobočkový specialista - provoz", null, null, 100, null],
  ["PROVOZ", "spec. provozu pobočkové sítě - medior", null, null, 100, null],
  ["PROVOZ", "spec. provozu pobočkové sítě - senior", null, null, 100, null],
  ["OSTATNÍ", "remote firemní bankéř - medior", null, null, 100, null],
  ["OSTATNÍ", "remote MMA bankéř - junior", null, null, 100, null],
  ["OSTATNÍ", "remote MMA bankéř - team leader", null, null, 100, null],
  ["OSTATNÍ", "remote premier bankéř - medior", null, null, 100, null],
  ["OSTATNÍ", "area leader virtuálního centra bydlení", null, null, 100, null],
  ["OSTATNÍ", "hypoteční specialista VCB - medior", null, null, 100, null],
  ["OSTATNÍ", "hypoteční specialista VCB - senior", null, null, 100, null],
  ["OSTATNÍ", "specialista podpory VCB - medior", null, null, 100, null],
  ["OSTATNÍ", "nedefinovaná pozice - 100 pct back office", null, null, 100, null],
  ["OSTATNÍ", "nedefinovaná pozice - 50 pct back office a 50 pct meeting zone", null, 50, 50, null],
  ["MMMA", "bankéř klientské péče - junior", 95, null, 5, null],
  ["MMMA", "bankéř klientské péče - medior", 95, null, 5, null],
  ["MMMA", "manažer segm. investice - reg. ředitel", null, null, 100, null],
  ["MMMA", "manažer segmentu investice - zástupce", null, null, 100, null],
  ["MMMA", "investiční specialista - medior", null, 60, 40, null],
  ["MMMA", "Retail Lead - area lead", null, null, null, 100],
  ["MMMA", "Retail Lead - regional lead", null, null, null, 100],
  ["MMMA", "Retail Lead - team lead", null, 60, 40, null],
  ["MMMA", "osobní bankéř - junior", 10, 70, 20, null],
  ["MMMA", "osobní bankéř - medior", null, 80, 20, null],
  ["MMMA", "osobní bankéř - senior", null, 80, 20, null],
  ["MMMA", "osobní bankéř - master", null, 80, 20, null],
  ["MMMA", "regionální manažer strategie - medior", null, null, 100, null],
  ["MMMA", "manažer segm. pojištění - reg. ředitel", null, null, 100, null],
  ["MMMA", "pojišťovací specialista - medior", null, 60, 40, null],
  ["HC", "hypoteční specialista - medior", null, 40, 60, null],
  ["HC", "hypoteční specialista - senior", null, 40, 60, null],
  ["HC", "manažer segm. hypo - regionální ředitel", null, null, 100, null],
  ["HC", "manažer segmentu hypo - zástupce", null, null, 100, null],
  ["HC", "pobočkový specialista - hypo", null, 40, 60, null],
  ["EPC", "Premier Bus. and Digi Assistant - senior", 100, null, null, null],
  ["EPC", "manaž. segm. Erste Premier - area leader", null, null, null, 100],
  ["EPC", "manaž. segm. Erste Premier - team leader bez portfolia", null, null, 100, null],
  ["EPC", "manaž. segm. Erste Premier - team leader s portfoliem", null, 30, 70, null],
  ["EPC", "premier bankéř - medior", null, 50, 50, null],
  ["EPC", "premier bankéř - master", null, 50, 50, null],
  ["EPC", "premier bankéř - senior", null, 50, 50, null],
  ["EPB", "asistentka EPB - medior", null, null, 100, null],
  ["EPB", "asistentka EPB - master", null, null, 100, null],
  ["EPB", "privátní bankéř - medior", null, 50, 100, null],
  ["EPB", "privátní bankéř - senior", null, 50, 100, null],
  ["EPB", "privátní bankéř - wealth management", null, 50, 100, null],
  ["EPB", "manažer segmentu EPB - regionál. ředitel", null, null, null, 100],
  ["EPB", "manažer segmentu EPB - zástupce", null, null, 100, null],
  ["CESTOVNÍ", "bankéř klientské péče - junior", null, 20, 80, null],
  ["CESTOVNÍ", "bankéř klientské péče - medior", null, 10, 90, null],
  ["CESTOVNÍ", "manažer segm. investice - reg. ředitel", null, 20, 80, null],
  ["CESTOVNÍ", "manažer segmentu investice - zástupce", null, null, 100, null],
  ["CESTOVNÍ", "investiční specialista - medior", null, null, 100, null],
  ["CESTOVNÍ", "Retail Lead - area lead", null, 20, 80, null],
  ["CESTOVNÍ", "Retail Lead - regional lead", null, null, 100, null],
  ["CESTOVNÍ", "Retail Lead - team lead", null, null, 100, null],
  ["CESTOVNÍ", "osobní bankéř - junior", null, null, 100, null],
  ["CESTOVNÍ", "osobní bankéř - medior", null, null, 100, null],
  ["CESTOVNÍ", "osobní bankéř - senior", null, null, 100, null],
  ["CESTOVNÍ", "regionální manažer strategie - medior", null, null, 100, null],
  ["CESTOVNÍ", "manažer segm. pojištění - reg. ředitel", null, null, 100, null],
  ["CESTOVNÍ", "pojišťovací specialista - medior", null, null, 100, null],
  ["CESTOVNÍ", "firemní bankéř - medior", null, null, 100, null],
  ["CESTOVNÍ", "podpora firemních bankéřů", null, null, 100, null],
  ["CESTOVNÍ", "firemní bankéř - senior", null, null, 100, null],
  ["CESTOVNÍ", "manažer segmentu SB - regionální ředitel", null, null, 100, null],
  ["CESTOVNÍ", "manažer segmentu SB - team leader", null, null, 100, null],
  ["CESTOVNÍ", "spec. pro firemní pojištění - senior", null, null, 100, null],
  ["CESTOVNÍ", "hypoteční specialista - medior", null, null, 100, null],
  ["CESTOVNÍ", "hypoteční specialista - senior", null, null, 100, null],
  ["CESTOVNÍ", "manažer segm. hypo - regionální ředitel", null, null, 100, null],
  ["CESTOVNÍ", "manažer segmentu hypo - zástupce", null, null, 100, null],
  ["CESTOVNÍ", "pobočkový specialista - hypo", null, null, 100, null],
  ["CESTOVNÍ", "Premier Bus. and Digi Assistant - senior", null, null, 100, null],
  ["CESTOVNÍ", "manaž. segm. Erste Premier - area leader", null, 50, 50, null],
  ["CESTOVNÍ", "manaž. segm. Erste Premier - team leader bez portfolia", 95, null, 5, null],
  ["CESTOVNÍ", "manaž. segm. Erste Premier - team leader s portfoliem", 95, null, 5, null],
  ["CESTOVNÍ", "premier bankéř - medior", null, null, 100, null],
  ["CESTOVNÍ", "premier bankéř - master", null, null, 100, null],
  ["CESTOVNÍ", "premier bankéř - senior", null, 60, 40, null],
  ["CESTOVNÍ", "asistentka EPB - medior", null, null, 100, null],
  ["CESTOVNÍ", "privátní bankéř - medior", null, null, 100, null],
  ["CESTOVNÍ", "privátní bankéř - senior", null, 60, 40, null],
  ["CESTOVNÍ", "privátní bankéř - wealth management", 10, 70, 20, null],
  ["CESTOVNÍ", "manažer segmentu EPB - regionál. ředitel", null, 80, 20, null],
  ["CESTOVNÍ", "manažer segmentu EPB - zástupce", null, 80, 20, null],
  ["CESTOVNÍ", "regionální manažer provozu", null, null, 100, null],
  ["CESTOVNÍ", "manažer provozu pob. sítě - team leader", null, null, 100, null],
  ["CESTOVNÍ", "pobočkový specialista - provoz", null, 60, 40, null],
  ["CESTOVNÍ", "spec. provozu pobočkové sítě - medior", null, 40, 60, null],
  ["CESTOVNÍ", "spec. provozu pobočkové sítě - senior", null, 40, 60, null],
  ["CESTOVNÍ", "Ředitel regionálního korporátního centra", null, null, 100, null],
  ["CESTOVNÍ", "korporátní finanční analytik - senior", null, null, 100, null],
  ["CESTOVNÍ", "korporátní finanční analytik - master", null, 40, 60, null],
  ["CESTOVNÍ", "spec. korporátní klientely - asistent", null, null, 100, null],
  ["CESTOVNÍ", "korporátní úvěrový specialista - medior", null, null, 100, null],
  ["CESTOVNÍ", "korporátní úvěrový specialista - senior", null, null, 100, null],
  ["CESTOVNÍ", "remote firemní bankéř - medior", null, 30, 70, null],
  ["CESTOVNÍ", "remote premier bankéř - medior", null, 50, 50, null],
  ["CESTOVNÍ", "area leader virtuálního centra bydlení", null, null, 100, null],
  ["CESTOVNÍ", "hypoteční specialista VCB - medior", null, 50, 100, null],
  ["CESTOVNÍ", "hypoteční specialista VCB - senior", null, 50, 100, null],
  ["CESTOVNÍ", "specialista podpory VCB - medior", null, 50, 100, null],
  ["CESTOVNÍ", "nedefinovaná pozice - 100 pct back office", null, null, 100, null],
  ["CESTOVNÍ", "nedefinovaná pozice - 50 pct back office a 50 pct meeting zone", null, null, 100, null],
  ["CESTOVNÍ", "asistentka EPB - master", null, null, 100, null],
  ["CESTOVNÍ", "osobní bankéř - master", null, 80, 20, null],
  ["CESTOVNÍ", "firemní bankéř - master", null, 20, 80, null],
];

/* ---------------------------- Stav aplikace ---------------------------- */

let SQL = null;
let db = null;
let fileHandle = null;
let fsaSupported = typeof window.showOpenFilePicker === "function";
let dbDirty = false;
let pendingLoad = null; // { load_key, pobocka_id, pobocka_nazev, oteviraci_doba, rows }
let pendingHandleNeedsPermission = null; // FileSystemFileHandle čekající na znovu-udělení oprávnění

/* ------------------------------- Nástroje ------------------------------- */

function toast(msg, type = "ok", ms = 4500) {
  const area = document.getElementById("toast-area");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  area.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function esc(s) {
  return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmt1(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  return n.toFixed(1);
}

function pad(n, len = 2) { return String(n).padStart(len, "0"); }

function nowStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-` +
         `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
}

function nowIso() { return new Date().toISOString(); }

function base64ToUint8Array(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------ SQLite DB ------------------------------- */

function dbAll(sql, params = [], dbi = db) {
  const stmt = dbi.prepare(sql);
  stmt.bind(params);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
}

function createNewDatabase() {
  db = new SQL.Database();
  db.run(SCHEMA_SQL);
  const insAbsence = db.prepare("INSERT INTO absence (segment, nepritomnost, homeoffice) VALUES (?, ?, ?)");
  SEED_ABSENCE.forEach((r) => { insAbsence.run(r); });
  insAbsence.free();
  const insDotace = db.prepare(`INSERT INTO casove_dotace
    (segment, pozice, service_zone, meeting_zone, backoffice_zone, office_room) VALUES (?, ?, ?, ?, ?, ?)`);
  SEED_CASOVE_DOTACE.forEach((r) => { insDotace.run(r); });
  insDotace.free();
}

function loadDatabaseFromBytes(bytes) {
  const candidate = new SQL.Database(new Uint8Array(bytes));
  // sanity-check: musí obsahovat základní tabulky, jinak jde o cizí soubor
  const names = dbAll("SELECT name FROM sqlite_master WHERE type='table'", [], candidate).map((r) => r.name);
  const required = ["absence", "casove_dotace", "excel_loads", "calculations"];
  const missing = required.filter((t) => !names.includes(t));
  if (missing.length) {
    candidate.run(SCHEMA_SQL); // doplní chybějící tabulky, zbytek dat zachová
  }
  db = candidate;
}

function exportDatabaseBytes() {
  return db.export();
}

/* ------------------------- Perzistence do souboru ------------------------ */

const IDB_NAME = "fte-wpl-app";
const IDB_STORE = "handles";

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const dbi = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = dbi.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbSetSafe(key, value) {
  // Zapamatování handle je jen pohodlí pro příští spuštění — jeho případné selhání
  // (např. IndexedDB zakázaná politikou prohlížeče) nesmí zablokovat samotné uložení dat.
  try { await idbSet(key, value); } catch (e) { console.warn("Nepodařilo se zapamatovat handle databáze:", e); }
}

async function idbGet(key) {
  const dbi = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = dbi.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function updateDbStatus(state, text) {
  const dot = document.querySelector("#dbStatus .dot");
  dot.className = "dot" + (state ? ` ${state}` : "");
  document.getElementById("dbStatusText").textContent = text;
  document.getElementById("btnSaveDbNow").style.display = (state === "warn") ? "inline-block" : "none";
}

async function persistDatabase(showToast = false) {
  if (!db) return;
  if (fileHandle) {
    try {
      const perm = await fileHandle.requestPermission({ mode: "readwrite" });
      if (perm !== "granted") throw new Error("Přístup k souboru nebyl povolen.");
      const writable = await fileHandle.createWritable();
      await writable.write(exportDatabaseBytes());
      await writable.close();
      dbDirty = false;
      updateDbStatus("ok", `Databáze připojena: ${fileHandle.name}`);
      if (showToast) toast("Databáze uložena na disk.", "ok");
      return;
    } catch (e) {
      console.error(e);
      dbDirty = true;
      updateDbStatus("warn", `Chyba při ukládání databáze — klikněte na „Uložit databázi“.`);
      toast("Nepodařilo se uložit databázi na disk: " + e.message, "err");
      return;
    }
  }
  // fallback bez File System Access API
  dbDirty = true;
  updateDbStatus("warn", "Databáze pouze v paměti — stáhněte a uložte ji do složky s aplikací.");
  if (showToast) toast("Prohlížeč nepodporuje přímý zápis, databázi je nutné stáhnout manuálně.", "warn");
}

function downloadDatabaseNow() {
  if (!db) { toast("Nejprve otevřete nebo vytvořte databázi.", "err"); return; }
  const bytes = exportDatabaseBytes();
  const blob = new Blob([bytes], { type: "application/x-sqlite3" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "fte_wpl_calculator.db";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  dbDirty = false;
  toast("Databáze byla stažena — přesuňte ji do složky s aplikací (přepíše starý soubor).", "ok");
}

async function connectExistingDatabase() {
  if (fsaSupported) {
    // Pokud už z minula známe handle k souboru (jen čeká na obnovení oprávnění),
    // zkusíme rovnou povolit přístup k němu — díky kliknutí máme potřebné gesto.
    if (pendingHandleNeedsPermission) {
      const handle = pendingHandleNeedsPermission;
      try {
        const perm = await handle.requestPermission({ mode: "readwrite" });
        if (perm === "granted") {
          const file = await handle.getFile();
          const bytes = await file.arrayBuffer();
          loadDatabaseFromBytes(bytes);
          fileHandle = handle;
          pendingHandleNeedsPermission = null;
          updateDbStatus("ok", `Databáze připojena: ${handle.name}`);
          toast("Přístup k databázi byl obnoven.", "ok");
          refreshAllTabsAfterDbChange();
          return;
        }
      } catch (e) {
        console.warn("Obnovení oprávnění se nezdařilo, otevřu výběr souboru:", e);
      }
    }
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "SQLite databáze", accept: { "application/x-sqlite3": [".db", ".sqlite", ".sqlite3"] } }],
        excludeAcceptAllOption: false,
      });
      const file = await handle.getFile();
      const bytes = await file.arrayBuffer();
      loadDatabaseFromBytes(bytes);
      fileHandle = handle;
      await idbSetSafe("dbFile", handle);
      updateDbStatus("ok", `Databáze připojena: ${handle.name}`);
      toast("Databáze byla připojena.", "ok");
      refreshAllTabsAfterDbChange();
    } catch (e) {
      if (e.name !== "AbortError") { console.error(e); toast("Nepodařilo se otevřít databázi: " + e.message, "err"); }
    }
  } else {
    document.getElementById("dbFileInputFallback").click();
  }
}

async function handleFallbackDbFile(file) {
  try {
    const bytes = await file.arrayBuffer();
    loadDatabaseFromBytes(bytes);
    fileHandle = null;
    updateDbStatus("warn", `Databáze načtena ze souboru „${file.name}“ (jen v paměti — po úpravách stáhněte).`);
    toast("Databáze byla načtena.", "ok");
    refreshAllTabsAfterDbChange();
  } catch (e) {
    console.error(e);
    toast("Nepodařilo se načíst databázi: " + e.message, "err");
  }
}

async function createNewDatabaseFlow() {
  createNewDatabase();
  if (fsaSupported) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: "fte_wpl_calculator.db",
        types: [{ description: "SQLite databáze", accept: { "application/x-sqlite3": [".db"] } }],
      });
      fileHandle = handle;
      await idbSetSafe("dbFile", handle);
      await persistDatabase();
      toast("Nová databáze byla vytvořena a uložena.", "ok");
    } catch (e) {
      if (e.name !== "AbortError") { console.error(e); toast("Databáze byla vytvořena v paměti, uložení se nezdařilo: " + e.message, "warn"); }
      updateDbStatus("warn", "Nová databáze je jen v paměti — stáhněte ji tlačítkem vpravo nahoře.");
    }
  } else {
    updateDbStatus("warn", "Nová databáze je jen v paměti — stáhněte ji tlačítkem vpravo nahoře.");
    toast("Nová databáze byla vytvořena v paměti prohlížeče.", "ok");
  }
  refreshAllTabsAfterDbChange();
}

async function tryReconnectStoredHandle() {
  if (!fsaSupported) { updateDbStatus(null, "Databáze nepřipojena — otevřete existující nebo vytvořte novou."); return; }
  try {
    const handle = await idbGet("dbFile");
    if (!handle) { updateDbStatus(null, "Databáze nepřipojena — otevřete existující nebo vytvořte novou."); return; }
    const perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm === "granted") {
      const file = await handle.getFile();
      const bytes = await file.arrayBuffer();
      loadDatabaseFromBytes(bytes);
      fileHandle = handle;
      updateDbStatus("ok", `Databáze připojena: ${handle.name}`);
      refreshAllTabsAfterDbChange();
    } else {
      pendingHandleNeedsPermission = handle;
      updateDbStatus("warn", `Databáze „${handle.name}“ nalezena — klikněte na „Otevřít databázi…“ pro obnovení přístupu.`);
    }
  } catch (e) {
    console.warn("Nelze obnovit uloženou databázi:", e);
    updateDbStatus(null, "Databáze nepřipojena — otevřete existující nebo vytvořte novou.");
  }
}

function requireDb() {
  if (!db) { toast("Nejprve otevřete nebo vytvořte databázi.", "err"); return false; }
  return true;
}

/* ---------------------------- Parsování Excelu ---------------------------- */

function excelCell(ws, addr) {
  const c = ws[addr];
  if (!c) return null;
  return c.v === undefined ? null : c.v;
}

function isBlank(v) { return v === null || v === undefined || v === ""; }

function parseVstupySheet(workbook) {
  if (!workbook.SheetNames.includes("VSTUPY")) {
    throw new Error("V Excelu chybí list „VSTUPY“.");
  }
  const ws = workbook.Sheets["VSTUPY"];
  const pobocka_id = excelCell(ws, "C1");
  const pobocka_nazev = excelCell(ws, "C2");
  const oteviraci_doba = excelCell(ws, "C3");
  const doba_vytezeni_wpl = excelCell(ws, "C4");

  if ([pobocka_id, pobocka_nazev, oteviraci_doba, doba_vytezeni_wpl].some(isBlank)) {
    throw new Error("Některé nezbytné hodnoty v Excelu chybí (C1, C2, C3, C4).");
  }

  const rows = [];
  let radek = 6;
  while (true) {
    const segment = excelCell(ws, "A" + radek);
    const pozice = excelCell(ws, "B" + radek);
    const fteRaw = excelCell(ws, "C" + radek);
    const wplRaw = excelCell(ws, "D" + radek);

    if (isBlank(segment) && isBlank(pozice) && isBlank(fteRaw) && isBlank(wplRaw)) break;
    if (isBlank(segment)) break;

    const fte = toNumberOrNull(fteRaw);
    if (fte === null || fte <= 0) { radek++; continue; }

    let wpl_load;
    if (String(segment).trim().toUpperCase() === "CESTOVNÍ") {
      wpl_load = toNumberOrNull(wplRaw); // pokud chybí, doplní se při výpočtu otevírací dobou
    } else {
      const parsed = toNumberOrNull(doba_vytezeni_wpl);
      wpl_load = parsed !== null ? parsed : 40.0;
    }

    rows.push({ segment: String(segment).trim(), pozice: String(pozice).trim(), fte, wpl_load });
    radek++;
  }

  return {
    pobocka_id: String(pobocka_id).trim(),
    pobocka_nazev: String(pobocka_nazev).trim(),
    oteviraci_doba: toNumberOrNull(oteviraci_doba) ?? 40,
    rows,
  };
}

async function handleExcelFile(file) {
  const msgsEl = document.getElementById("excelMsgs");
  msgsEl.innerHTML = "";
  document.getElementById("excelPreview").innerHTML = "";
  document.getElementById("resultsPanel").style.display = "none";
  if (!requireDb()) return;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const parsed = parseVstupySheet(wb);
    if (!parsed.rows.length) {
      msgsEl.innerHTML = `<div class="msg err">V listu „VSTUPY“ nebyl nalezen žádný řádek s FTE &gt; 0.</div>`;
      return;
    }
    const load_key = `load_${parsed.pobocka_id}-${parsed.pobocka_nazev}-${nowStamp()}`;
    const createdAt = nowIso();

    const ins = db.prepare(`INSERT INTO excel_loads
      (load_key, pobocka_id, pobocka_nazev, oteviraci_doba, segment, pozice, fte, wpl_load, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    parsed.rows.forEach((r) => {
      ins.run([load_key, parsed.pobocka_id, parsed.pobocka_nazev, parsed.oteviraci_doba,
        r.segment, r.pozice, r.fte, r.wpl_load, createdAt]);
    });
    ins.free();
    await persistDatabase();

    pendingLoad = { load_key, pobocka_id: parsed.pobocka_id, pobocka_nazev: parsed.pobocka_nazev,
      oteviraci_doba: parsed.oteviraci_doba, rows: parsed.rows };

    msgsEl.innerHTML = `<div class="msg ok">Checklist načten: <strong>${esc(parsed.pobocka_nazev)}</strong>
      (ID ${esc(parsed.pobocka_id)}), otevírací doba ${esc(parsed.oteviraci_doba)} h/týden,
      ${parsed.rows.length} pozic s FTE &gt; 0.</div>`;
    renderExcelPreview(parsed);
  } catch (e) {
    console.error(e);
    msgsEl.innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
  }
}

function renderExcelPreview(parsed) {
  const rowsHtml = parsed.rows.map((r) => `
    <tr>
      <td>${esc(r.segment)}</td>
      <td>${esc(r.pozice)}</td>
      <td>${fmt1(r.fte)}</td>
      <td>${r.wpl_load === null ? '<span class="muted">dle otevírací doby</span>' : fmt1(r.wpl_load)}</td>
    </tr>`).join("");
  document.getElementById("excelPreview").innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Segment</th><th>Pozice</th><th>FTE</th><th>Vytížení WPL (h/týden)</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="row" style="margin-top:14px;">
      <button class="btn" id="btnCalculate">Spočítat kalkulaci WPL</button>
    </div>`;
  document.getElementById("btnCalculate").addEventListener("click", runCalculation);
}

/* ------------------------------- Kalkulace -------------------------------- */

function runCalculation() {
  if (!pendingLoad) return;
  const { load_key, oteviraci_doba } = pendingLoad;

  const rows = dbAll("SELECT segment, pozice, fte, wpl_load FROM excel_loads WHERE load_key = ?", [load_key]);
  if (!rows.length) { toast("Pro tento checklist nejsou žádná data.", "err"); return; }

  const absenceRows = dbAll("SELECT segment, nepritomnost, homeoffice FROM absence");
  const absenceMap = {};
  absenceRows.forEach((r) => { absenceMap[r.segment] = [(r.nepritomnost || 0) / 100, (r.homeoffice || 0) / 100]; });

  const dotaceRows = dbAll("SELECT segment, pozice, service_zone, meeting_zone, backoffice_zone, office_room FROM casove_dotace");
  const dotaceMap = {};
  dotaceRows.forEach((r) => { dotaceMap[`${r.segment} ${r.pozice}`] = r; });

  const bySegment = {}; // segment -> { total_positions, position_list: Map, zones... }
  const celkem = { total_positions: 0, position_list: {}, service_zone: 0, meeting_zone: 0, backoffice_zone: 0, office_room: 0 };
  const warnings = [];

  rows.forEach((row) => {
    const fte = row.fte;
    if (fte === null || fte <= 0) return;
    const wplLoad = (row.wpl_load === null || row.wpl_load === undefined) ? oteviraci_doba : row.wpl_load;
    const [nepritomnost, homeoffice] = absenceMap[row.segment] || [0, 0];
    const vypocet = fte * wplLoad * (1 - nepritomnost - homeoffice);

    const dotace = dotaceMap[`${row.segment} ${row.pozice}`];
    if (!dotace) {
      warnings.push(`Chybí časová dotace pro segment „${row.segment}“ a pozici „${row.pozice}“ — řádek byl vynechán.`);
      return;
    }

    if (!bySegment[row.segment]) {
      bySegment[row.segment] = { total_positions: 0, position_list: {}, service_zone: 0, meeting_zone: 0, backoffice_zone: 0, office_room: 0 };
    }
    const seg = bySegment[row.segment];
    seg.total_positions += fte;
    seg.position_list[row.pozice] = (seg.position_list[row.pozice] || 0) + fte;
    celkem.total_positions += fte;
    celkem.position_list[row.pozice] = (celkem.position_list[row.pozice] || 0) + fte;

    ZONES.forEach((zone) => {
      const pct = dotace[zone] || 0;
      const hodiny = (vypocet * pct) / 100 / oteviraci_doba;
      seg[zone] += hodiny;
      celkem[zone] += hodiny;
    });
  });

  const segments = Object.keys(bySegment);
  if (!segments.length) {
    toast("Žádný řádek nešlo spočítat — chybí časové dotace pro všechny zadané pozice.", "err");
    return;
  }

  const calculation_key = `calculation_${pendingLoad.pobocka_id}-${pendingLoad.pobocka_nazev}-${nowStamp()}`;
  const createdAt = nowIso();
  const positionListStr = (list) => Object.entries(list).map(([poz, ft]) =>
    `${poz} (${Number.isInteger(ft) ? ft : ft.toFixed(1)})`).join(", ");

  const insCalc = db.prepare(`INSERT INTO calculations
    (load_key, calculation_key, segment, total_positions, position_list,
     service_zone, meeting_zone, backoffice_zone, office_room, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const resultRows = [];
  segments.forEach((seg) => {
    const s = bySegment[seg];
    const row = {
      segment: seg,
      total_positions: round1(s.total_positions),
      position_list: positionListStr(s.position_list),
      service_zone: round1(s.service_zone),
      meeting_zone: round1(s.meeting_zone),
      backoffice_zone: round1(s.backoffice_zone),
      office_room: round1(s.office_room),
    };
    resultRows.push(row);
    insCalc.run([load_key, calculation_key, row.segment, row.total_positions, row.position_list,
      row.service_zone, row.meeting_zone, row.backoffice_zone, row.office_room, createdAt]);
  });
  const celkemRow = {
    segment: "Celkem",
    total_positions: round1(celkem.total_positions),
    position_list: positionListStr(celkem.position_list),
    service_zone: round1(celkem.service_zone),
    meeting_zone: round1(celkem.meeting_zone),
    backoffice_zone: round1(celkem.backoffice_zone),
    office_room: round1(celkem.office_room),
  };
  insCalc.run([load_key, calculation_key, celkemRow.segment, celkemRow.total_positions, celkemRow.position_list,
    celkemRow.service_zone, celkemRow.meeting_zone, celkemRow.backoffice_zone, celkemRow.office_room, createdAt]);
  insCalc.free();

  persistDatabase();

  renderResults({ calculation_key, load_key, createdAt, rows: resultRows, celkem: celkemRow, warnings,
    pobocka_id: pendingLoad.pobocka_id, pobocka_nazev: pendingLoad.pobocka_nazev, oteviraci_doba });
  toast("Kalkulace byla spočítána a uložena do historie.", "ok");
  renderHistoryList();
}

function round1(n) { return Math.round(n * 10) / 10; }

function renderResults(result) {
  const panel = document.getElementById("resultsPanel");
  panel.style.display = "block";
  const warnHtml = result.warnings.length
    ? `<div class="msg warn">${result.warnings.map(esc).join("<br>")}</div>` : "";

  const rowsHtml = result.rows.map((r) => resultRowHtml(r)).join("") + resultRowHtml(result.celkem, true);

  document.getElementById("resultsArea").innerHTML = `
    ${warnHtml}
    <p class="muted">Calculation key: <code>${esc(result.calculation_key)}</code> · Load key: <code>${esc(result.load_key)}</code></p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Segment</th><th>FTE celkem</th><th>Pozice (FTE)</th>
          <th>Service zone</th><th>Meeting zone</th><th>Backoffice zone</th><th>Office room</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="row" style="margin-top:14px;">
      <button class="btn secondary" id="btnExportPdf">Exportovat PDF s přehledem WPL</button>
    </div>
    <div style="margin-top:10px; max-width:480px;">
      <label class="muted" for="pdfNote">Poznámka do PDF (nepovinné):</label>
      <textarea id="pdfNote" rows="2"></textarea>
    </div>`;
  document.getElementById("btnExportPdf").addEventListener("click", () => exportCalculationPdf(result));
}

function resultRowHtml(r, isTotal = false) {
  return `<tr class="${isTotal ? "total-row" : ""}">
    <td>${esc(r.segment)}</td>
    <td>${fmt1(r.total_positions)}</td>
    <td>${esc(r.position_list)}</td>
    <td>${fmt1(r.service_zone)}</td>
    <td>${fmt1(r.meeting_zone)}</td>
    <td>${fmt1(r.backoffice_zone)}</td>
    <td>${fmt1(r.office_room)}</td>
  </tr>`;
}

/* --------------------------------- PDF ------------------------------------ */

function exportCalculationPdf(result) {
  const note = document.getElementById("pdfNote") ? document.getElementById("pdfNote").value.trim() : "";
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  const marginX = 14;
  let y = 18;

  pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(16);
  pdf.text("Kalkulace FTE → WPL", marginX, y); y += 9;

  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(10);
  const infoLines = [
    `Název pobočky: ${result.pobocka_nazev}`,
    `ID pobočky: ${result.pobocka_id}`,
    `Otevírací doba: ${result.oteviraci_doba} h/týden`,
    `Load key: ${result.load_key}`,
    `Calculation key: ${result.calculation_key}`,
    `Datum vytvoření: ${new Date(result.createdAt).toLocaleString("cs-CZ")}`,
  ];
  infoLines.forEach((line) => { pdf.text(line, marginX, y); y += 6; });
  y += 4;

  pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(12);
  pdf.text("Souhrnná tabulka (WPL po zónách)", marginX, y); y += 7;

  const headers = ["Segment", "FTE", "ServiceZ", "MeetingZ", "BackofficeZ", "OfficeRoom"];
  const colW = [46, 20, 26, 26, 30, 26];
  const rowH = 7;
  const pageBottom = 280;

  // Poznámka: setFillColor/setTextColor se volají znovu před KAŽDOU buňkou,
  // ne jednou před smyčkou — jsPDF si barvu vyplně a barvu textu ukládá do
  // společné interní cache, takže prokládané kreslení obdélníku a textu by
  // jinak po první buňce tuto cache rozjelo a další buňky by se vykreslily
  // bez výplně / bílým textem na bílém pozadí.
  function drawHeader() {
    pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(9);
    let x = marginX;
    headers.forEach((h, i) => {
      pdf.setFillColor(39, 112, 240);
      pdf.rect(x, y, colW[i], rowH, "FD");
      pdf.setTextColor(255, 255, 255);
      pdf.text(h, x + 2, y + 5);
      x += colW[i];
    });
    y += rowH;
    pdf.setTextColor(0, 0, 0);
  }

  function drawRow(vals, fill) {
    if (y + rowH > pageBottom) { pdf.addPage(); y = 18; drawHeader(); }
    pdf.setFont("DejaVuSans", fill ? "bold" : "normal"); pdf.setFontSize(9);
    let x = marginX;
    vals.forEach((v, i) => {
      if (fill) pdf.setFillColor(200, 240, 210);
      pdf.rect(x, y, colW[i], rowH, fill ? "FD" : "D");
      pdf.setTextColor(0, 0, 0);
      pdf.text(String(v), x + 2, y + 5);
      x += colW[i];
    });
    y += rowH;
  }

  drawHeader();
  result.rows.forEach((r) => drawRow([r.segment, fmt1(r.total_positions), fmt1(r.service_zone),
    fmt1(r.meeting_zone), fmt1(r.backoffice_zone), fmt1(r.office_room)]));
  drawRow(["Celkem", fmt1(result.celkem.total_positions), fmt1(result.celkem.service_zone),
    fmt1(result.celkem.meeting_zone), fmt1(result.celkem.backoffice_zone), fmt1(result.celkem.office_room)], true);

  y += 8;
  const sumWpl = result.celkem.service_zone + result.celkem.meeting_zone +
                 result.celkem.backoffice_zone + result.celkem.office_room;
  pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(10);
  pdf.text(`Celkový počet WPL (ServiceZ + MeetingZ + BackofficeZ + OfficeRoom): ${sumWpl.toFixed(1)}`, marginX, y);
  y += 10;

  if (result.warnings.length) {
    pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(10);
    pdf.text("Upozornění:", marginX, y); y += 6;
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(9);
    result.warnings.forEach((w) => {
      const lines = pdf.splitTextToSize(w, 180);
      lines.forEach((line) => { if (y > pageBottom) { pdf.addPage(); y = 18; } pdf.text(line, marginX, y); y += 5; });
    });
    y += 4;
  }

  if (note) {
    pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(10);
    pdf.text("Poznámka:", marginX, y); y += 6;
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(9);
    pdf.splitTextToSize(note, 180).forEach((line) => { pdf.text(line, marginX, y); y += 5; });
  }

  pdf.save(`export_${result.calculation_key}.pdf`);
}

/* ------------------------------ Historie ---------------------------------- */

function renderHistoryList() {
  const el = document.getElementById("historyList");
  if (!db) { el.innerHTML = `<p class="muted">Nejprve připojte databázi.</p>`; return; }
  const calcs = dbAll(`
    SELECT calculation_key, load_key, MIN(created_at) AS created_at
    FROM calculations GROUP BY calculation_key ORDER BY created_at DESC`);
  if (!calcs.length) { el.innerHTML = `<p class="muted">Zatím žádné uložené kalkulace.</p>`; return; }

  el.innerHTML = calcs.map((c) => {
    const branch = dbAll("SELECT pobocka_id, pobocka_nazev FROM excel_loads WHERE load_key = ? LIMIT 1", [c.load_key])[0];
    const label = branch ? `${branch.pobocka_nazev} (ID ${branch.pobocka_id})` : "(neznámá pobočka)";
    return `<div class="history-item" data-calc="${esc(c.calculation_key)}" data-load="${esc(c.load_key)}">
      <div><strong>${esc(label)}</strong><br><span class="muted">${new Date(c.created_at).toLocaleString("cs-CZ")}</span></div>
      <div class="key">${esc(c.calculation_key)}</div>
    </div>`;
  }).join("");

  el.querySelectorAll(".history-item").forEach((item) => {
    item.addEventListener("click", () => showHistoryDetail(item.dataset.calc, item.dataset.load));
  });
}

function showHistoryDetail(calculationKey, loadKey) {
  const panel = document.getElementById("historyDetailPanel");
  panel.style.display = "block";
  const inputRows = dbAll("SELECT segment, pozice, fte, wpl_load, created_at FROM excel_loads WHERE load_key = ? ORDER BY id", [loadKey]);
  const resultRows = dbAll(`SELECT segment, total_positions, position_list, service_zone, meeting_zone,
    backoffice_zone, office_room FROM calculations WHERE calculation_key = ?
    ORDER BY (segment = 'Celkem'), id`, [calculationKey]);
  const branch = dbAll("SELECT pobocka_id, pobocka_nazev, oteviraci_doba FROM excel_loads WHERE load_key = ? LIMIT 1", [loadKey])[0];

  const inputHtml = inputRows.map((r) => `<tr><td>${esc(r.segment)}</td><td>${esc(r.pozice)}</td>
    <td>${fmt1(r.fte)}</td><td>${fmt1(r.wpl_load)}</td></tr>`).join("");
  const resultHtml = resultRows.map((r) => resultRowHtml(r, r.segment === "Celkem")).join("");
  const found = resultRows.find((r) => r.segment === "Celkem");

  document.getElementById("historyDetail").innerHTML = `
    <p class="muted">${branch ? `${esc(branch.pobocka_nazev)} (ID ${esc(branch.pobocka_id)}) · otevírací doba ${esc(branch.oteviraci_doba)} h/týden` : ""}</p>
    <p>Load key: <code>${esc(loadKey)}</code><br>Calculation key: <code>${esc(calculationKey)}</code></p>
    <h3>Vstupní data z checklistu</h3>
    <div class="table-wrap"><table><thead><tr><th>Segment</th><th>Pozice</th><th>FTE</th><th>Vytížení WPL</th></tr></thead>
    <tbody>${inputHtml}</tbody></table></div>
    <h3>Výsledek kalkulace</h3>
    <div class="table-wrap"><table><thead><tr><th>Segment</th><th>FTE celkem</th><th>Pozice (FTE)</th>
      <th>Service zone</th><th>Meeting zone</th><th>Backoffice zone</th><th>Office room</th></tr></thead>
      <tbody>${resultHtml}</tbody></table></div>
    <div class="row" style="margin-top:12px;">
      <button class="btn secondary" id="btnExportPdfHistory">Exportovat PDF s přehledem WPL</button>
    </div>`;

  document.getElementById("btnExportPdfHistory").addEventListener("click", () => {
    const rowsNoTotal = resultRows.filter((r) => r.segment !== "Celkem");
    exportCalculationPdf({
      calculation_key: calculationKey, load_key: loadKey,
      createdAt: nowIso(), rows: rowsNoTotal, celkem: found || {},
      warnings: [], pobocka_id: branch?.pobocka_id, pobocka_nazev: branch?.pobocka_nazev,
      oteviraci_doba: branch?.oteviraci_doba,
    });
  });
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* --------------------------- Referenční data ------------------------------ */

function renderAbsenceTable() {
  const el = document.getElementById("absenceTable");
  if (!db) { el.innerHTML = `<p class="muted">Nejprve připojte databázi.</p>`; return; }
  const rows = dbAll("SELECT segment, nepritomnost, homeoffice FROM absence ORDER BY segment");
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Segment</th><th>Nepřítomnost (%)</th><th>Homeoffice (%)</th><th></th></tr></thead>
    <tbody id="absenceTbody">
      ${rows.map(absenceRowHtml).join("")}
    </tbody></table></div>`;
  wireDeleteButtons("absenceTbody");
}

function absenceRowHtml(r) {
  return `<tr>
    <td><input type="text" value="${esc(r.segment)}" data-field="segment"></td>
    <td><input type="number" step="0.1" value="${r.nepritomnost ?? ""}" data-field="nepritomnost"></td>
    <td><input type="number" step="0.1" value="${r.homeoffice ?? ""}" data-field="homeoffice"></td>
    <td><button class="btn secondary small btn-del">✕</button></td>
  </tr>`;
}

function wireDeleteButtons(tbodyId) {
  document.getElementById(tbodyId).querySelectorAll(".btn-del").forEach((btn) => {
    btn.addEventListener("click", () => btn.closest("tr").remove());
  });
}

function saveAbsenceTable() {
  if (!requireDb()) return;
  const trs = document.querySelectorAll("#absenceTbody tr");
  const data = [];
  for (const tr of trs) {
    const segment = tr.querySelector('[data-field="segment"]').value.trim();
    if (!segment) continue;
    const nepritomnost = toNumberOrNull(tr.querySelector('[data-field="nepritomnost"]').value);
    const homeoffice = toNumberOrNull(tr.querySelector('[data-field="homeoffice"]').value);
    data.push([segment, nepritomnost ?? 0, homeoffice ?? 0]);
  }
  dbRun("DELETE FROM absence");
  const ins = db.prepare("INSERT INTO absence (segment, nepritomnost, homeoffice) VALUES (?, ?, ?)");
  data.forEach((r) => ins.run(r));
  ins.free();
  persistDatabase(true);
  renderAbsenceTable();
  toast("Tabulka absencí byla uložena.", "ok");
}

let dotaceFilterText = "";

function renderDotaceTable() {
  const el = document.getElementById("dotaceTable");
  if (!db) { el.innerHTML = `<p class="muted">Nejprve připojte databázi.</p>`; return; }
  const rows = dbAll("SELECT id, segment, pozice, service_zone, meeting_zone, backoffice_zone, office_room FROM casove_dotace ORDER BY segment, pozice");
  const filtered = dotaceFilterText
    ? rows.filter((r) => `${r.segment} ${r.pozice}`.toLowerCase().includes(dotaceFilterText))
    : rows;
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Segment</th><th>Pozice</th><th>ServiceZ %</th><th>MeetingZ %</th><th>BackofficeZ %</th><th>OfficeRoom %</th><th></th></tr></thead>
    <tbody id="dotaceTbody">
      ${filtered.map(dotaceRowHtml).join("")}
    </tbody></table></div>
    <p class="muted" style="margin-top:6px;">Zobrazeno ${filtered.length} z ${rows.length} pozic.
      ${dotaceFilterText ? "Uložení uloží pouze zobrazené (filtrované) řádky spolu se skrytými — filtr slouží jen k prohlížení." : ""}</p>`;
  wireDeleteButtons("dotaceTbody");
  // pro uložení potřebujeme i skryté (filtrované) řádky -> uchováme je v dataset
  el.dataset.hiddenRows = JSON.stringify(dotaceFilterText ? rows.filter((r) => !filtered.includes(r)) : []);
}

function dotaceRowHtml(r) {
  const f = (v) => v === null || v === undefined ? "" : v;
  return `<tr>
    <td><input type="text" value="${esc(r.segment)}" data-field="segment"></td>
    <td><input type="text" value="${esc(r.pozice)}" data-field="pozice"></td>
    <td><input type="number" step="1" value="${f(r.service_zone)}" data-field="service_zone"></td>
    <td><input type="number" step="1" value="${f(r.meeting_zone)}" data-field="meeting_zone"></td>
    <td><input type="number" step="1" value="${f(r.backoffice_zone)}" data-field="backoffice_zone"></td>
    <td><input type="number" step="1" value="${f(r.office_room)}" data-field="office_room"></td>
    <td><button class="btn secondary small btn-del">✕</button></td>
  </tr>`;
}

function saveDotaceTable() {
  if (!requireDb()) return;
  const trs = document.querySelectorAll("#dotaceTbody tr");
  const data = [];
  for (const tr of trs) {
    const segment = tr.querySelector('[data-field="segment"]').value.trim();
    const pozice = tr.querySelector('[data-field="pozice"]').value.trim();
    if (!segment || !pozice) continue;
    data.push([
      segment, pozice,
      toNumberOrNull(tr.querySelector('[data-field="service_zone"]').value),
      toNumberOrNull(tr.querySelector('[data-field="meeting_zone"]').value),
      toNumberOrNull(tr.querySelector('[data-field="backoffice_zone"]').value),
      toNumberOrNull(tr.querySelector('[data-field="office_room"]').value),
    ]);
  }
  const hidden = JSON.parse(document.getElementById("dotaceTable").dataset.hiddenRows || "[]");
  hidden.forEach((r) => data.push([r.segment, r.pozice, r.service_zone, r.meeting_zone, r.backoffice_zone, r.office_room]));

  dbRun("DELETE FROM casove_dotace");
  const ins = db.prepare(`INSERT INTO casove_dotace
    (segment, pozice, service_zone, meeting_zone, backoffice_zone, office_room) VALUES (?, ?, ?, ?, ?, ?)`);
  data.forEach((r) => ins.run(r));
  ins.free();
  persistDatabase(true);
  dotaceFilterText = "";
  document.getElementById("dotaceFilter").value = "";
  renderDotaceTable();
  toast("Tabulka časových dotací byla uložena.", "ok");
}

/* --------------------------------- Tabs ------------------------------------ */

function refreshAllTabsAfterDbChange() {
  renderHistoryList();
  renderAbsenceTable();
  renderDotaceTable();
  document.getElementById("historyDetailPanel").style.display = "none";
}

function setupTabs() {
  document.querySelectorAll(".tabbtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabbtn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll("section.tab").forEach((s) => s.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

/* -------------------------------- Init ------------------------------------- */

async function init() {
  setupTabs();

  document.getElementById("btnOpenDb").addEventListener("click", connectExistingDatabase);
  document.getElementById("btnNewDb").addEventListener("click", () => {
    if (db && !confirm("Vytvořit novou databázi? Aktuálně otevřená databáze zůstane beze změny (pokud je uložená).")) return;
    createNewDatabaseFlow();
  });
  document.getElementById("btnSaveDbNow").addEventListener("click", downloadDatabaseNow);

  if (!fsaSupported) {
    document.getElementById("dbFsaNote").style.display = "block";
    const input = document.createElement("input");
    input.type = "file"; input.id = "dbFileInputFallback"; input.accept = ".db,.sqlite,.sqlite3"; input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => { if (input.files[0]) handleFallbackDbFile(input.files[0]); input.value = ""; });
  }

  const dropzone = document.getElementById("dropzone");
  const excelInput = document.getElementById("excelInput");
  document.getElementById("btnPickExcel").addEventListener("click", () => excelInput.click());
  excelInput.addEventListener("change", () => { if (excelInput.files[0]) handleExcelFile(excelInput.files[0]); excelInput.value = ""; });
  ["dragenter", "dragover"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); }));
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleExcelFile(file);
  });

  document.getElementById("btnAddAbsenceRow").addEventListener("click", () => {
    document.getElementById("absenceTbody").insertAdjacentHTML("beforeend", absenceRowHtml({ segment: "", nepritomnost: 0, homeoffice: 0 }));
    wireDeleteButtons("absenceTbody");
  });
  document.getElementById("btnSaveAbsence").addEventListener("click", saveAbsenceTable);
  document.getElementById("btnAddDotaceRow").addEventListener("click", () => {
    document.getElementById("dotaceTbody").insertAdjacentHTML("beforeend", dotaceRowHtml({ segment: "", pozice: "", service_zone: null, meeting_zone: null, backoffice_zone: null, office_room: null }));
    wireDeleteButtons("dotaceTbody");
  });
  document.getElementById("btnSaveDotace").addEventListener("click", saveDotaceTable);
  document.getElementById("dotaceFilter").addEventListener("input", (e) => {
    dotaceFilterText = e.target.value.trim().toLowerCase();
    renderDotaceTable();
  });

  updateDbStatus(null, "Načítání SQLite modulu…");
  // sql-wasm.wasm se předává jako předem načtený binární blob (base64 z vendor/sql-wasm-binary.js),
  // protože prohlížeče při otevření souboru přes file:// blokují interní fetch() na .wasm soubor (CORS).
  SQL = await initSqlJs({ wasmBinary: base64ToUint8Array(window.SQL_WASM_BINARY_BASE64) });
  await tryReconnectStoredHandle();
  if (!db) updateDbStatus(null, "Databáze nepřipojena — otevřete existující nebo vytvořte novou.");
  refreshAllTabsAfterDbChange();
}

window.addEventListener("DOMContentLoaded", init);

window.addEventListener("beforeunload", (e) => {
  if (dbDirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
