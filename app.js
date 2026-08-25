'use strict';

/* =========================================================================
   Kalkulátor FTE -> WPL — logika je 1:1 přepis původního calculator.py
   (funkce nacti_data_z_excelu a spocitej_a_uloz_kalkulaci), pouze běžící
   v prohlížeči nad SQLite databází přes sql.js.
   ========================================================================= */

const ZONES = ["service_zone", "meeting_zone", "backoffice_zone", "office_room"];

// Číselník důvodů kalkulace — vybírá se při zadání kalkulace (krok 2 průvodce),
// platí stejně pro Excel i manuální zadání.
const CALCULATION_REASONS = ["Přechod na cashless", "Modernizace", "Ad-hoc kalkulace", "Optimalizace"];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS absence (
  segment TEXT PRIMARY KEY,
  nepritomnost REAL,
  homeoffice REAL,
  ref_version_id INTEGER
);
CREATE TABLE IF NOT EXISTS casove_dotace (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment TEXT,
  pozice TEXT,
  service_zone REAL,
  meeting_zone REAL,
  backoffice_zone REAL,
  office_room REAL,
  fasttrack_share REAL,
  ref_version_id INTEGER
);
CREATE TABLE IF NOT EXISTS excel_loads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  load_key TEXT,
  pobocka_id TEXT,
  pobocka_nazev TEXT,
  oteviraci_doba REAL,
  shift_mode INTEGER,
  segment TEXT,
  pozice TEXT,
  fte REAL,
  wpl_load REAL,
  created_at TEXT,
  source_branch TEXT
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
  created_at TEXT,
  ref_version_id INTEGER,
  status TEXT,
  duvod TEXT
);
CREATE TABLE IF NOT EXISTS ref_data_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT,
  note TEXT,
  absence_json TEXT,
  dotace_json TEXT,
  furniture_json TEXT
);
CREATE TABLE IF NOT EXISTS furniture_to_zone (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment TEXT,
  furniture TEXT,
  zone TEXT,
  wpl_counter REAL,
  ref_version_id INTEGER
);
CREATE TABLE IF NOT EXISTS layouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  layout_key TEXT,
  calculation_key TEXT,
  segment TEXT,
  zone TEXT,
  furniture TEXT,
  wpl_assigned REAL,
  calculated_wpl REAL,
  piece_count REAL,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS pobocky (
  id_pobocky TEXT PRIMARY KEY,
  nazev TEXT,
  region TEXT
);
CREATE TABLE IF NOT EXISTS calculation_stats (
  calculation_key TEXT PRIMARY KEY,
  load_key TEXT,
  format_typ TEXT,
  celkem_fte REAL,
  celkem_wpl REAL,
  wpl_fte_ratio REAL,
  backoffice_pct REAL,
  meeting_pct REAL,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS segments (
  segment_key TEXT PRIMARY KEY,
  nazev TEXT,
  sort_order INTEGER,
  color TEXT,
  icon TEXT
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS specialist_export (
  branch_id TEXT PRIMARY KEY,
  branch_name TEXT,
  imported_at TEXT,
  source TEXT,
  payload TEXT
);
CREATE TABLE IF NOT EXISTS catchment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT,
  source_name TEXT,
  region TEXT,
  slot INTEGER,
  target_name TEXT,
  visits REAL,
  share REAL,
  distance_km REAL,
  transfer_pct REAL,
  imported_at TEXT,
  source TEXT
);
CREATE TABLE IF NOT EXISTS catchment_selection (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  load_key TEXT,
  source_id TEXT,
  source_name TEXT,
  transfer_pct REAL,
  fte_mode TEXT,
  fte_total REAL,
  visits_day REAL,
  visits_total REAL,
  payload TEXT
);
CREATE TABLE IF NOT EXISTS layout_extras (
  calculation_key TEXT PRIMARY KEY,
  payload TEXT
);
CREATE TABLE IF NOT EXISTS layout_staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  calculation_key TEXT,
  piece_key TEXT,
  segment TEXT,
  pozice TEXT
);
CREATE TABLE IF NOT EXISTS branch_export (
  branch_id TEXT PRIMARY KEY,
  branch_name TEXT,
  imported_at TEXT,
  source TEXT,
  payload TEXT
);
CREATE TABLE IF NOT EXISTS visitor_data (
  pobocka_id TEXT PRIMARY KEY,
  nazev TEXT,
  imported_at TEXT,
  source TEXT,
  report_title TEXT,
  consts_json TEXT,
  payload TEXT
);
CREATE TABLE IF NOT EXISTS calculation_visitor (
  calculation_key TEXT PRIMARY KEY,
  pobocka_id TEXT,
  nazev TEXT,
  imported_at TEXT,
  source TEXT,
  report_title TEXT,
  consts_json TEXT,
  payload TEXT
);
`;

// Doplní chybějící tabulky/sloupce v databázích vytvořených starší verzí aplikace.
// Výchozí podíl fast tracku u pozic (v %) — přesně to, co dřív bylo v kódu.
// Od teď je hodnota u každé pozice v tabulce `casove_dotace` a dá se změnit
// v „Data a Excel šablona → Pozice a jejich časové dotace“.
const DEFAULT_FASTTRACK_SHARE = {
  "osobní bankéř - medior": 20,
  "osobní bankéř - senior": 10,
};

// Doplní výchozí podíl fast tracku, pokud ho ještě žádná pozice nastavený nemá
// (nová databáze nebo databáze ze starší verze aplikace). Vynulované hodnoty od
// uživatele se nepřepíšou — ukládají se jako 0, ne NULL.
function applyFasttrackDefaults(dbi) {
  const set = dbAll("SELECT COUNT(*) AS n FROM casove_dotace WHERE fasttrack_share IS NOT NULL", [], dbi)[0].n;
  if (set === 0) {
    Object.entries(DEFAULT_FASTTRACK_SHARE).forEach(([pozice, pct]) => {
      dbi.run("UPDATE casove_dotace SET fasttrack_share = ? WHERE LOWER(pozice) = ?", [pct, pozice]);
    });
  }
  dbi.run("UPDATE casove_dotace SET fasttrack_share = 0 WHERE fasttrack_share IS NULL");
}

function migrateSchema(dbi) {
  dbi.run(SCHEMA_SQL);
  try { dbi.run("ALTER TABLE calculations ADD COLUMN ref_version_id INTEGER"); } catch (e) { /* sloupec už existuje */ }
  try { dbi.run("ALTER TABLE calculations ADD COLUMN status TEXT"); } catch (e) { /* sloupec už existuje */ }
  dbi.run("UPDATE calculations SET status = 'rozpracovana' WHERE status IS NULL");
  try { dbi.run("ALTER TABLE calculations ADD COLUMN duvod TEXT"); } catch (e) { /* sloupec už existuje */ }
  // Verze referenčních dat, ve které daný řádek naposledy vznikl nebo se změnil.
  try { dbi.run("ALTER TABLE absence ADD COLUMN ref_version_id INTEGER"); } catch (e) { /* sloupec už existuje */ }
  try { dbi.run("ALTER TABLE casove_dotace ADD COLUMN ref_version_id INTEGER"); } catch (e) { /* sloupec už existuje */ }
  // Podíl backoffice času, který pozice odsedí na fast tracku místo vlastního
  // kancelářského místa (v %). Dřív byl zadrátovaný v kódu, teď je to nastavení
  // u každé pozice — výchozí hodnoty odpovídají dosavadnímu chování.
  try { dbi.run("ALTER TABLE casove_dotace ADD COLUMN fasttrack_share REAL"); } catch (e) { /* sloupec už existuje */ }
  applyFasttrackDefaults(dbi);
  try { dbi.run("ALTER TABLE furniture_to_zone ADD COLUMN ref_version_id INTEGER"); } catch (e) { /* sloupec už existuje */ }
  // Směnový režim pobočky (otevírací doba > doba vytížení pozice).
  try { dbi.run("ALTER TABLE excel_loads ADD COLUMN shift_mode INTEGER"); } catch (e) { /* sloupec už existuje */ }
  // Řádky, které do checklistu přišly ze spádové pobočky (převzatí zaměstnanci).
  try { dbi.run("ALTER TABLE excel_loads ADD COLUMN source_branch TEXT"); } catch (e) { /* sloupec už existuje */ }
  try { dbi.run("ALTER TABLE ref_data_versions ADD COLUMN furniture_json TEXT"); } catch (e) { /* sloupec už existuje */ }
  const furnitureCount = dbAll("SELECT COUNT(*) AS n FROM furniture_to_zone", [], dbi)[0].n;
  if (furnitureCount === 0) {
    const ins = dbi.prepare("INSERT INTO furniture_to_zone (segment, furniture, zone, wpl_counter) VALUES (?, ?, ?, ?)");
    SEED_FURNITURE.forEach((r) => { ins.run(r); });
    ins.free();
  }
  // Oprava dat: „Interní zasedací místnost - malá“ se počítá jako WPL (1 WPL/kus),
  // dříve byla vedená jako prvek nepřispívající k WPL. Podmínka `wpl_counter = 0`
  // opravuje jen původní (chybnou) hodnotu — vlastní úpravu na jinou hodnotu
  // v modulu „Struktura checklistu“ ponechá být.
  dbi.run("UPDATE furniture_to_zone SET wpl_counter = 1 WHERE furniture = 'Interní zasedací místnost - malá' AND wpl_counter = 0");
  // Doplnění dat: segmenty SBC a HC neměly v Meeting zone žádný nábytkový prvek,
  // takže potřebu WPL ke schůzkám nešlo rozpočítat na konkrétní kusy. Doplní se
  // „Jednací místnost“ (1 WPL/kus) stejně jako u ostatních segmentů; pravidlo
  // pro předvyplnění počtu z kalkulace na ni platí automaticky (LAYOUT_RULES).
  ["SBC", "HC"].forEach((segment) => {
    dbi.run(`INSERT INTO furniture_to_zone (segment, furniture, zone, wpl_counter)
      SELECT ?, 'Jednací místnost', 'meeting_zone', 1
      WHERE NOT EXISTS (SELECT 1 FROM furniture_to_zone
        WHERE segment = ? AND zone = 'meeting_zone' AND furniture = 'Jednací místnost')`, [segment, segment]);
  });
  const pobockyCount = dbAll("SELECT COUNT(*) AS n FROM pobocky", [], dbi)[0].n;
  if (pobockyCount === 0) {
    const ins = dbi.prepare("INSERT INTO pobocky (id_pobocky, nazev, region) VALUES (?, ?, ?)");
    SEED_POBOCKY.forEach((r) => { ins.run(r); });
    ins.free();
  }
  dbi.run(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)`);
  dbi.run(`CREATE TABLE IF NOT EXISTS specialist_export (branch_id TEXT PRIMARY KEY, branch_name TEXT,
    imported_at TEXT, source TEXT, payload TEXT)`);
  const segmentsCount = dbAll("SELECT COUNT(*) AS n FROM segments", [], dbi)[0].n;
  if (segmentsCount === 0) {
    const ins = dbi.prepare("INSERT INTO segments (segment_key, nazev, sort_order, color, icon) VALUES (?, ?, ?, ?, ?)");
    SEED_SEGMENTS.forEach((r) => { ins.run(r); });
    ins.free();
  }
}

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

// Nábytek dostupný pro přiřazení do layoutu, po segmentech a zónách — shodné
// s furniture_to_zone z inicializace_db.py (bez odkazů na buňky Excelu, export
// zpět do checklistu tato aplikace nedělá).
const SEED_FURNITURE = [
  ["OSTATNÍ", "Kancelářské místo", "backoffice_zone", 1],
  ["OSTATNÍ", "Kancelář", "backoffice_zone", 1],
  ["OSTATNÍ", "Flex box", "backoffice_zone", 1],
  ["OSTATNÍ", "Fast track backoffice", "backoffice_zone", 0],
  ["OSTATNÍ", "Jednací místnost", "meeting_zone", 1],

  ["CESTOVNÍ", "Kancelářské místo", "backoffice_zone", 1],
  ["CESTOVNÍ", "Flex box", "backoffice_zone", 1],
  ["CESTOVNÍ", "Fast track backoffice", "backoffice_zone", 0],
  ["CESTOVNÍ", "Kancelář", "office_room", 1],
  ["CESTOVNÍ", "Jednací místnost", "meeting_zone", 1],

  ["CESTOVNÍ POZICE", "Kancelářské místo", "backoffice_zone", 1],
  ["CESTOVNÍ POZICE", "Kancelář", "backoffice_zone", 1],
  ["CESTOVNÍ POZICE", "Flex box", "backoffice_zone", 1],
  ["CESTOVNÍ POZICE", "Fast track backoffice", "backoffice_zone", 0],

  ["EPB", "Kancelářské místo", "backoffice_zone", 1],
  ["EPB", "Flex box", "backoffice_zone", 1],
  ["EPB", "Fast track backoffice", "backoffice_zone", 0],
  ["EPB", "Jednací místnost", "meeting_zone", 1],
  ["EPB", "Kancelář", "office_room", 1],
  ["EPB", "Recepce", "service_zone", 1],
  ["EPB", "Čekací zóna (lounge)", "service_zone", 0],

  ["EPC", "Kancelářské místo", "backoffice_zone", 1],
  ["EPC", "Fast track backoffice", "backoffice_zone", 0],
  ["EPC", "Flex box", "backoffice_zone", 1],
  ["EPC", "Jednací místnost", "meeting_zone", 1],
  ["EPC", "Kancelář", "office_room", 1],
  ["EPC", "Recepce", "service_zone", 1],
  ["EPC", "Čekací zóna (lounge)", "service_zone", 0],

  ["HC", "Kancelářské místo", "backoffice_zone", 1],
  ["HC", "Flex box", "backoffice_zone", 1],
  ["HC", "Fast track backoffice", "backoffice_zone", 0],
  ["HC", "Jednací místnost", "meeting_zone", 1],
  ["HC", "Kancelář", "office_room", 1],

  ["PROVOZ", "Kancelářské místo", "backoffice_zone", 1],
  ["PROVOZ", "Flex box", "backoffice_zone", 1],
  ["PROVOZ", "Fast track backoffice", "backoffice_zone", 0],
  ["PROVOZ", "Kancelář", "office_room", 1],

  ["RKC", "Kancelářské místo", "backoffice_zone", 1],
  ["RKC", "Flex box", "backoffice_zone", 1],
  ["RKC", "Fast track backoffice", "backoffice_zone", 0],
  ["RKC", "Jednací místnost", "meeting_zone", 1],
  ["RKC", "Kancelář", "office_room", 1],
  ["RKC", "Recepce", "service_zone", 1],

  ["SBC", "Kancelářské místo", "backoffice_zone", 1],
  ["SBC", "Flex box", "backoffice_zone", 1],
  ["SBC", "Fast track backoffice", "backoffice_zone", 0],
  ["SBC", "Jednací místnost", "meeting_zone", 1],
  ["SBC", "Kancelář", "office_room", 1],

  ["MMMA", "Flex box", "meeting_zone", 1],
  ["MMMA", "Jednací místnost", "meeting_zone", 1],
  ["MMMA", "Semidescreete room", "meeting_zone", 1],
  ["MMMA", "Záliv", "meeting_zone", 1],
  ["MMMA", "Lenka", "meeting_zone", 1],
  ["MMMA", "Kancelář", "office_room", 1],
  ["MMMA", "Theke - nízká", "service_zone", 1],
  ["MMMA", "Theke - vysoká", "service_zone", 1],
  ["MMMA", "Lenka vítací", "service_zone", 1],
  ["MMMA", "Fast track (stolek a židle)", "service_zone", 0],
  ["MMMA", "Čekací zóna (židle)", "service_zone", 0],
  ["MMMA", "Čekací zóna (obývák)", "service_zone", 0],
  ["MMMA", "Lenka", "service_zone", 1],
  ["MMMA", "Martička", "service_zone", 1],
  ["MMMA", "Martička s TT", "service_zone", 1],
  ["MMMA", "Pokladní ostrov typu 1/2C (1:1,TT+TT,1WPL)", "service_zone", 1],
  ["MMMA", "Pokladní ostrov typu 1/2C (1:1,ARP+TT,1WPL)", "service_zone", 1],
  ["MMMA", "Pokladní ostrov typu 1/2C (1:1,ARP+TT+TT,1WPL)", "service_zone", 1],
  ["MMMA", "Pokladní ostrov typu C (1:1,TT+TT,1WPL)", "service_zone", 1],
  ["MMMA", "Pokladní ostrov typu C (1:1,ARP+TT+TT,1WPL)", "service_zone", 1],
  ["MMMA", "Pokladní ostrov typu C (1:1,ARP+TT+TT,2WPL)", "service_zone", 2],
  ["MMMA", "Pokladna s bezpečnostní nástavbou", "service_zone", 1],
  ["MMMA", "Kancelářské místo", "backoffice_zone", 1],
  ["MMMA", "Fast track backoffice", "backoffice_zone", 0],
  ["MMMA", "Interní zasedací místnost - malá", "backoffice_zone", 1],
  ["MMMA", "Interní zasedací místnost - velká", "backoffice_zone", 1],
  ["MMMA", "Relax zóna", "backoffice_zone", 0],
  ["MMMA", "Flex box", "backoffice_zone", 1],
];

// Seznam poboček (ID pobočky, název, region) pro manuální vytvoření kalkulace
// bez nahrání Excelu — uživatel vybere pobočku podle názvu a ID se doplní.
const SEED_POBOCKY = [
  ["505", "Praha 6 - Vítězné nám.", "Praha"],
  ["134", "Kladno", "Severozápadní Čechy"],
  ["338", "Ostrava - Nová Karolina Park", "Severní Morava"],
  ["282", "Pardubice, tř. Míru", "Východní Čechy"],
  ["486", "Praha 5 - Štefánikova", "Praha"],
  ["391", "Nový Jičín", "Severní Morava"],
  ["469", "Praha 4 (Budějovická)", "Praha"],
  ["540", "Plzeň - Františkánská", "Jihozápadní Čechy"],
  ["413", "Opava", "Severní Morava"],
  ["123", "Ústí nad Labem", "Severozápadní Čechy"],
  ["182", "Liberec", "Severozápadní Čechy"],
  ["397", "Olomouc", "Severní Morava"],
  ["148", "Mladá Boleslav", "Severozápadní Čechy"],
  ["384", "Havířov - Město", "Severní Morava"],
  ["372", "Frýdek-Místek", "Severní Morava"],
  ["578", "České Budějovice", "Jihozápadní Čechy"],
  ["74", "Hodonín", "Jižní Morava"],
  ["1", "Brno (Jánská)", "Jižní Morava"],
  ["128", "Beroun", "Severozápadní Čechy"],
  ["93", "Kroměříž", "Jižní Morava"],
  ["84", "Jihlava", "Jižní Morava"],
  ["118", "Znojmo", "Jižní Morava"],
  ["51", "Břeclav", "Jižní Morava"],
  ["368", "Prostějov", "Severní Morava"],
  ["144", "Kralupy nad Vltavou", "Severozápadní Čechy"],
  ["435", "Šumperk", "Severní Morava"],
  ["562", "Benešov", "Jihozápadní Čechy"],
  ["218", "Hradec Králové - ČSA", "Východní Čechy"],
  ["459", "Praha 2 (Jugoslávská)", "Praha"],
  ["511", "Praha 8 (Sokolovská)", "Praha"],
  ["228", "Kolín", "Východní Čechy"],
  ["174", "Chomutov", "Severozápadní Čechy"],
  ["151", "TRIO Ml. Boleslav", "Severozápadní Čechy"],
  ["569", "Příbram", "Jihozápadní Čechy"],
  ["383", "Karviná", "Severní Morava"],
  ["629", "Tábor", "Jihozápadní Čechy"],
  ["60", "Zlín", "Jižní Morava"],
  ["107", "Uherské Hradiště", "Jižní Morava"],
  ["600", "Jindřichův Hradec", "Jihozápadní Čechy"],
  ["246", "Havlíčkův Brod", "Východní Čechy"],
  ["199", "Most", "Severozápadní Čechy"],
  ["272", "Náchod", "Východní Čechy"],
  ["656", "Rokycany", "Jihozápadní Čechy"],
  ["429", "Přerov", "Severní Morava"],
  ["477", "Praha - OC Chodov", "Praha"],
  ["636", "Domažlice", "Jihozápadní Čechy"],
  ["178", "Jablonec nad Nisou", "Severozápadní Čechy"],
  ["100", "Třebíč", "Jižní Morava"],
  ["108", "Uherský Brod", "Jižní Morava"],
  ["192", "Litoměřice", "Severozápadní Čechy"],
  ["253", "Chrudim", "Východní Čechy"],
  ["266", "Jičín", "Východní Čechy"],
  ["646", "Karlovy Vary", "Jihozápadní Čechy"],
  ["114", "Vyškov", "Jižní Morava"],
  ["204", "Teplice", "Severozápadní Čechy"],
  ["354", "Kopřivnice", "Severní Morava"],
  ["653", "Klatovy", "Jihozápadní Čechy"],
  ["331", "Žďár nad Sázavou", "Východní Čechy"],
  ["3", "Kounicova", "Jižní Morava"],
  ["291", "Rychnov nad Kněžnou", "Východní Čechy"],
  ["160", "Česká Lípa", "Severozápadní Čechy"],
  ["392", "Valašské Meziříčí", "Severní Morava"],
  ["541", "Plzeň - OC Plaza", "Jihozápadní Čechy"],
  ["167", "Děčín", "Severozápadní Čechy"],
  ["307", "Trutnov", "Východní Čechy"],
  ["156", "Rakovník", "Severozápadní Čechy"],
  ["38", "Pelhřimov", "Jižní Morava"],
  ["523", "Vršovické nám.", "Praha"],
  ["146", "Mělník", "Severozápadní Čechy"],
  ["497", "Praha 8 - Ládví", "Praha"],
  ["136", "Slaný", "Severozápadní Čechy"],
  ["129", "Hořovice", "Severozápadní Čechy"],
  ["366", "Vsetín", "Severní Morava"],
  ["512", "Verneřická", "Praha"],
  ["348", "Ostrava - Poruba (U Soudu)", "Severní Morava"],
  ["191", "Roudnice nad Labem", "Severozápadní Čechy"],
  ["377", "Třinec - Lyžbice", "Severní Morava"],
  ["519", "OC Letňany", "Praha"],
  ["101", "Moravské Budějovice", "Jižní Morava"],
  ["612", "Písek", "Jihozápadní Čechy"],
  ["474", "Novodvorská", "Praha"],
  ["465", "Vinohradská 112", "Praha"],
  ["660", "Sokolov", "Jihozápadní Čechy"],
  ["386", "Orlová", "Severní Morava"],
  ["524", "Starostrašnická", "Praha"],
  ["493", "Strossmayerovo náměstí", "Praha"],
  ["29", "Vaňkovka", "Jižní Morava"],
  ["473", "Háje", "Praha"],
  ["471", "Sofijské náměstí", "Praha"],
  ["243", "Nymburk", "Východní Čechy"],
  ["546", "Plzeň - Lochotín", "Jihozápadní Čechy"],
  ["521", "Praha 9 - Centrum Černý Most", "Praha"],
  ["393", "Rožnov pod Radhoštěm", "Severní Morava"],
  ["75", "Kyjov", "Jižní Morava"],
  ["414", "Hlučín", "Severní Morava"],
  ["430", "Hranice", "Severní Morava"],
  ["362", "OA Kotva Ostrava-Zábřeh", "Severní Morava"],
  ["236", "Čáslav", "Východní Čechy"],
  ["135", "Kročehlavy", "Severozápadní Čechy"],
  ["198", "Louny", "Severozápadní Čechy"],
  ["349", "Ostrava - Dubina", "Severní Morava"],
  ["344", "Ostrava - Hrabůvka", "Severní Morava"],
  ["436", "Jeseník", "Severní Morava"],
  ["235", "Kutná Hora", "Východní Čechy"],
  ["642", "Cheb", "Jihozápadní Čechy"],
  ["52", "Hustopeče u Brna", "Jižní Morava"],
  ["43", "Blansko", "Jižní Morava"],
  ["387", "Český Těšín", "Severní Morava"],
  ["451", "Praha 1 - Národní", "Praha"],
  ["571", "Dobříš", "Jihozápadní Čechy"],
  ["360", "Shopping Park Ostrava", "Severní Morava"],
  ["355", "Bohumín", "Severní Morava"],
  ["563", "Vlašim", "Jihozápadní Čechy"],
  ["142", "Brandýs nad Labem", "Severozápadní Čechy"],
  ["535", "Říčany", "Praha"],
  ["145", "Neratovice", "Severozápadní Čechy"],
  ["528", "Topolová", "Praha"],
  ["241", "Poděbrady", "Východní Čechy"],
  ["66", "Valašské Klobouky", "Jižní Morava"],
  ["419", "Krnov", "Severní Morava"],
  ["11", "Královo Pole", "Jižní Morava"],
  ["403", "Uničov", "Severní Morava"],
  ["374", "Jablunkov", "Severní Morava"],
  ["498", "Praha 8 - OC Krakov", "Praha"],
  ["446", "Václavské náměstí", "Praha"],
  ["624", "Strakonice", "Jihozápadní Čechy"],
  ["22", "OC Campus Square Brno", "Jižní Morava"],
  ["219", "Střelecká", "Východní Čechy"],
  ["211", "OC Olympia Teplice-Srbice", "Severozápadní Čechy"],
  ["299", "Svitavy", "Východní Čechy"],
  ["667", "Stříbro", "Jihozápadní Čechy"],
  ["64", "Otrokovice - Atrium", "Jižní Morava"],
  ["150", "Mnichovo Hradiště", "Severozápadní Čechy"],
  ["508", "Praha 6 - Petřiny", "Praha"],
  ["27", "Vinohrady", "Jižní Morava"],
  ["437", "Mohelnice", "Severní Morava"],
  ["438", "Zábřeh", "Severní Morava"],
  ["490", "Luka", "Praha"],
  ["632", "Soběslav", "Jihozápadní Čechy"],
  ["321", "Ústí nad Orlicí", "Východní Čechy"],
  ["287", "OC Globus Pardubice", "Východní Čechy"],
  ["8", "Křídlovická", "Jižní Morava"],
  ["185", "OC Nisa Liberec", "Severozápadní Čechy"],
  ["335", "Velké Meziříčí", "Východní Čechy"],
  ["376", "Frýdlant nad Ostravicí", "Severní Morava"],
  ["5", "Brno - Masarykova", "Jižní Morava"],
  ["175", "Kadaň", "Severozápadní Čechy"],
  ["520", "Újezd nad Lesy", "Praha"],
  ["14", "OC Olympia Brno", "Jižní Morava"],
  ["516", "OC Čakovice", "Praha"],
  ["553", "OC Olympia Plzeň", "Jihozápadní Čechy"],
  ["488", "Radotín", "Praha"],
  ["416", "Bruntál", "Severní Morava"],
  ["595", "Český Krumlov", "Jihozápadní Čechy"],
  ["168", "Rumburk", "Severozápadní Čechy"],
  ["315", "Vrchlabí", "Východní Čechy"],
  ["265", "Hořice", "Východní Čechy"],
  ["292", "Dobruška", "Východní Čechy"],
  ["618", "Prachatice", "Jihozápadní Čechy"],
  ["472", "GEMINI", "Praha"],
  ["555", "Nýřany", "Jihozápadní Čechy"],
  ["449", "Dlouhá", "Praha"],
  ["212", "Turnov", "Severozápadní Čechy"],
  ["67", "Vizovice", "Jižní Morava"],
  ["36", "Humpolec", "Jižní Morava"],
  ["242", "Lysá nad Labem", "Východní Čechy"],
  ["402", "Šternberk", "Severní Morava"],
  ["325", "Vysoké Mýto", "Východní Čechy"],
  ["531", "Horní Měcholupy", "Praha"],
  ["53", "Mikulov na Moravě", "Jižní Morava"],
  ["353", "Frenštát pod Radhoštěm", "Severní Morava"],
  ["76", "Veselí nad Moravou", "Jižní Morava"],
  ["518", "Vysočany", "Praha"],
  ["188", "OC Forum Liberec", "Severozápadní Čechy"],
  ["637", "Holýšov", "Jihozápadní Čechy"],
  ["550", "Blovice", "Jihozápadní Čechy"],
  ["20", "Tišnov", "Jižní Morava"],
  ["157", "Nové Strašecí", "Severozápadní Čechy"],
  ["21", "Židlochovice", "Jižní Morava"],
  ["601", "Dačice", "Jihozápadní Čechy"],
  ["552", "Přeštice", "Jihozápadní Čechy"],
  ["666", "Tachov", "Jihozápadní Čechy"],
  ["159", "Žatec", "Severozápadní Čechy"],
  ["564", "Votice", "Jihozápadní Čechy"],
  ["602", "Třeboň", "Jihozápadní Čechy"],
  ["450", "Na Příkopě", "Praha"],
  ["454", "Nuselská", "Praha"],
  ["158", "Podbořany", "Severozápadní Čechy"],
  ["510", "Řepy", "Praha"],
  ["544", "Plzeň - Slovany", "Jihozápadní Čechy"],
  ["255", "Hlinsko v Čechách", "Východní Čechy"],
  ["149", "Benátky nad Jizerou", "Severozápadní Čechy"],
  ["45", "Letovice", "Jižní Morava"],
  ["301", "Litomyšl", "Východní Čechy"],
  ["332", "Bystřice nad Pernštejnem", "Východní Čechy"],
  ["95", "Bystřice pod Hostýnem", "Jižní Morava"],
  ["119", "Moravský Krumlov", "Jižní Morava"],
  ["303", "Polička", "Východní Čechy"],
  ["203", "Litvínov", "Severozápadní Čechy"],
  ["230", "Český Brod", "Východní Čechy"],
  ["193", "Lovosice", "Severozápadní Čechy"],
  ["492", "Praha 5 - OC Zličín", "Praha"],
  ["92", "OC City Park Jihlava", "Jižní Morava"],
  ["324", "Lanškroun", "Východní Čechy"],
  ["579", "Trhové Sviny", "Jihozápadní Čechy"],
  ["17", "Ivančice", "Jižní Morava"],
  ["339", "Bílovec", "Severní Morava"],
  ["222", "Nový Bydžov", "Východní Čechy"],
  ["545", "Sušice", "Jihozápadní Čechy"],
  ["44", "Boskovice", "Jižní Morava"],
  ["234", "Pečky", "Východní Čechy"],
  ["248", "Ledeč nad Sázavou", "Východní Čechy"],
  ["590", "Č. Budějovice - OC Globus", "Jihozápadní Čechy"],
  ["91", "OC Třebíč", "Jižní Morava"],
  ["672", "Olomouc - OC Šantovka", "Severní Morava"],
  ["86", "Třešť", "Jižní Morava"],
  ["120", "Hrušovany nad Jevišovkou", "Jižní Morava"],
  ["277", "Jaroměř", "Východní Čechy"],
  ["162", "Nový Bor", "Severozápadní Čechy"],
  ["184", "Frýdlant v Čechách", "Severozápadní Čechy"],
  ["294", "Týniště nad Orlicí", "Východní Čechy"],
  ["323", "Česká Třebová", "Východní Čechy"],
  ["286", "Přelouč", "Východní Čechy"],
  ["534", "Kostelec nad Černými lesy", "Východní Čechy"],
  ["554", "Kralovice", "Jihozápadní Čechy"],
  ["596", "Kaplice", "Jihozápadní Čechy"],
  ["24", "Pohořelice", "Jižní Morava"],
  ["293", "Kostelec nad Orlicí", "Východní Čechy"],
  ["328", "Žamberk", "Východní Čechy"],
  ["359", "Ostrava - Poruba 8", "Severní Morava"],
  ["334", "Velká Bíteš", "Východní Čechy"],
  ["274", "Červený Kostelec", "Východní Čechy"],
  ["187", "Jablonec nad Nisou - OC Rýnovka", "Severozápadní Čechy"],
  ["314", "Dvůr Králové nad Labem", "Východní Čechy"],
  ["247", "Chotěboř", "Východní Čechy"],
  ["581", "Č. Budějovice - Sokolská", "Jihozápadní Čechy"],
  ["94", "Holešov", "Jižní Morava"],
  ["89", "Polná", "Jižní Morava"],
  ["593", "Č. Budějovice - Lidická", "Jihozápadní Čechy"],
  ["398", "OC HANÁ Olomouc", "Severní Morava"],
  ["460", "Karlovo nám.", "Praha"],
  ["223", "Futurum Hradec Králové", "Východní Čechy"],
  ["215", "Semily", "Severozápadní Čechy"],
  ["12", "Žabovřesky", "Jižní Morava"],
  ["645", "Mariánské Lázně", "Jihozápadní Čechy"],
  ["264", "Nová Paka", "Východní Čechy"],
  ["169", "Varnsdorf", "Severozápadní Čechy"],
  ["491", "Nové Butovice", "Praha"],
  ["418", "Vrbno pod Pradědem", "Severní Morava"],
  ["613", "Milevsko", "Jihozápadní Čechy"],
  ["19", "Rosice", "Jižní Morava"],
  ["317", "Úpice", "Východní Čechy"],
  ["423", "Kravaře", "Severní Morava"],
  ["231", "Čelákovice", "Východní Čechy"],
  ["257", "Skuteč", "Východní Čechy"],
  ["662", "Chodov", "Jihozápadní Čechy"],
  ["576", "Jílové u Prahy", "Jihozápadní Čechy"],
  ["631", "Sezimovo Ústí", "Jihozápadní Čechy"],
  ["179", "Tanvald", "Severozápadní Čechy"],
  ["401", "Olomouc - OC Bělidla", "Severní Morava"],
  ["605", "Suchdol nad Lužnicí", "Jihozápadní Čechy"],
  ["572", "Sedlčany", "Jihozápadní Čechy"],
  ["500", "KAMERA (Barrandov)", "Praha"],
  ["327", "Letohrad", "Východní Čechy"],
  ["570", "Sázava", "Jihozápadní Čechy"],
  ["2", "Brno - Česká", "Jižní Morava"],
  ["651", "Toužim", "Jihozápadní Čechy"],
  ["117", "Slavkov u Brna", "Jižní Morava"],
  ["333", "Nové Město na Moravě", "Východní Čechy"],
  ["580", "Týn nad Vltavou", "Jihozápadní Čechy"],
  ["205", "Bílina", "Severozápadní Čechy"],
  ["283", "Holice v Čechách", "Východní Čechy"],
  ["395", "Odry", "Severní Morava"],
  ["619", "Vimperk", "Jihozápadní Čechy"],
  ["18", "Kuřim", "Jižní Morava"],
  ["464", "Sladkovského nám.", "Praha"],
  ["32", "Šlapanice", "Jižní Morava"],
  ["643", "Aš", "Jihozápadní Čechy"],
  ["186", "Hrádek nad Nisou", "Severozápadní Čechy"],
  ["573", "Březnice", "Jihozápadní Čechy"],
  ["221", "Chlumec nad Cidlinou", "Východní Čechy"],
  ["239", "Zruč nad Sázavou", "Východní Čechy"],
  ["102", "Náměšť nad Oslavou", "Jižní Morava"],
  ["161", "Mimoň", "Severozápadní Čechy"],
  ["125", "Děčín 4", "Severozápadní Čechy"],
  ["213", "Jilemnice", "Severozápadní Čechy"],
  ["417", "Rýmařov", "Severní Morava"],
  ["669", "Planá", "Jihozápadní Čechy"],
  ["194", "Štětí", "Severozápadní Čechy"],
  ["447", "Vodičkova", "Praha"],
  ["548", "Horažďovice", "Jihozápadní Čechy"],
  ["479", "Palmovka", "Praha"],
  ["399", "Litovel", "Severní Morava"],
  ["77", "Strážnice", "Jižní Morava"],
  ["273", "Broumov", "Východní Čechy"],
  ["254", "Heřmanův Městec", "Východní Čechy"],
  ["304", "Jevíčko", "Východní Čechy"],
  ["529", "Uhříněves", "Praha"],
  ["80", "Bzenec", "Jižní Morava"],
  ["302", "Moravská Třebová", "Východní Čechy"],
  ["330", "Králíky", "Východní Čechy"],
  ["237", "Uhlířské Janovice", "Východní Čechy"],
  ["626", "Vodňany", "Jihozápadní Čechy"],
  ["37", "Pacov", "Jižní Morava"],
  ["663", "Kraslice", "Jihozápadní Čechy"],
  ["495", "Dělnická", "Praha"],
  ["326", "Choceň", "Východní Čechy"],
  ["85", "Telč", "Jižní Morava"],
  ["115", "Bučovice", "Jižní Morava"],
  ["515", "Praha 9 - OC Galerie Harfa", "Praha"],
  ["648", "Ostrov", "Jihozápadní Čechy"],
  ["625", "Blatná", "Jihozápadní Čechy"],
  ["556", "Plzeň - Skvrňany", "Jihozápadní Čechy"],
  ["432", "Lipník nad Bečvou", "Severní Morava"],
  ["68", "Zlín - Dvanáctka", "Jižní Morava"],
  ["220", "Hradec Králové - OC Aupark", "Východní Čechy"],
  ["173", "Česká Kamenice", "Severozápadní Čechy"],
];

// Barevné a ikonové schéma segmentů — zdroj pravdy je od teď tabulka `segments`
// (upravitelná v modulu "Struktura checklistu"), toto je jen výchozí obsazení
// při založení nové databáze / migraci starší databáze bez této tabulky.
const SEED_SEGMENTS = [
  ["MMMA", "MMMA", 1, "#2770f0", "🏠"],
  ["SBC", "SBC", 2, "#0bb43f", "🏢"],
  ["HC", "HC", 3, "#f0a020", "🏡"],
  ["EPC", "EPC", 4, "#8b5cf6", "💼"],
  ["EPB", "EPB", 5, "#d6336c", "👑"],
  ["PROVOZ", "PROVOZ", 6, "#0e7490", "⚙️"],
  ["RKC", "RKC", 7, "#b45309", "🏭"],
  ["CESTOVNÍ", "CESTOVNÍ", 8, "#64748b", "🚗"],
  ["CESTOVNÍ POZICE", "CESTOVNÍ POZICE", 9, "#94a3b8", "🚙"],
  ["OSTATNÍ", "OSTATNÍ", 10, "#6b7684", "📋"],
];

// segment_key -> {segment_key, nazev, sort_order, color, icon}, načteno z tabulky
// `segments` po připojení/změně databáze. Segmenty, které se v této tabulce
// nenajdou (např. ručně zadaný nový segment při manuálním vstupu), dostanou
// neutrální výchozí vzhled z getSegmentMeta().
let segmentMetaCache = {};

function refreshSegmentMetaCache() {
  segmentMetaCache = {};
  if (!db) return;
  try {
    dbAll("SELECT segment_key, nazev, sort_order, color, icon FROM segments").forEach((r) => {
      segmentMetaCache[r.segment_key] = r;
    });
  } catch (e) { /* tabulka ještě neexistuje (stará databáze před migrací) */ }
}

function getSegmentMeta(key) {
  return segmentMetaCache[key] || { segment_key: key, nazev: key, sort_order: 999, color: "#6b7684", icon: "📋" };
}

// Barevný "štítek" segmentu pro použití v HTML tabulkách/přehledech.
function segmentBadgeHtml(key) {
  const m = getSegmentMeta(key);
  return `<span class="seg-badge" style="background:${m.color}22; color:${m.color}; border:1px solid ${m.color}66;">${m.icon} ${esc(key)}</span>`;
}

// Světlý odstín barvy segmentu (barva smíchaná s bílou) — používá se jako
// podbarvení buněk se segmentem v PDF, aby bylo nastavení barev v „Segmentech“
// vidět i v exportu, ale text zůstal čitelný.
function segmentTintRgb(segmentKey, mix = 0.82) {
  const [r, g, b] = hexToRgb(getSegmentMeta(segmentKey).color);
  return [r, g, b].map((c) => Math.round(c + (255 - c) * mix));
}

// Je barva tmavá? (relativní jas podle vnímání) — podle toho se volí bílé nebo
// tmavé písmo, aby text na barvě segmentu zůstal čitelný.
function isDarkColor(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) < 150;
}

function hexToRgb(hex) {
  const h = String(hex || "#6b7684").replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16) || 0, parseInt(n.slice(2, 4), 16) || 0, parseInt(n.slice(4, 6), 16) || 0];
}

/* ------------- Odkud data pocházejí (barevné označení zdroje) --------------- */
// V aplikaci se mísí dva nezávislé zdroje čísel: kalkulace FTE → WPL (zadané FTE
// + referenční data) a report návštěvnosti (skutečné návštěvy). Aby bylo hned
// vidět, na čem která část stojí, nese každý blok barevný štítek zdroje a stejně
// barevný levý pruh.

const DATA_SOURCES = {
  calc: { label: "z kalkulace FTE → WPL", color: "#2770f0",
    title: "Počítá se ze zadaných FTE a referenčních dat (časové dotace, absence)." },
  visit: { label: "z návštěvních dat", color: "#0e9f6e",
    title: "Počítá se ze skutečných návštěv v reportu návštěvnosti." },
  mix: { label: "kalkulace + návštěvní data", color: "#8b5cf6",
    title: "Kombinuje kapacitu z kalkulace FTE → WPL se skutečnou návštěvností z reportu." },
  hr: { label: "z exportu specialistů", color: "#d97706",
    title: "Aktuální obsazenost pobočky z personálního exportu (export_specialiste.xlsx)." },
  branch: { label: "z exportu poboček", color: "#0e7490",
    title: "Rating, výnosy a prodeje pobočky z exportu poboček (pobocky-export.xlsx)." },
  catchment: { label: "ze spádových poboček", color: "#c026a3",
    title: "Zaměstnanci a návštěvy převzaté z jiných poboček (spadove_pobocky.xlsx)." },
  ref: { label: "referenční data", color: "#6b7684",
    title: "Nastavení v referenčních datech — nezávisí na konkrétní kalkulaci." },
};

function srcBadgeHtml(kind) {
  const s = DATA_SOURCES[kind];
  if (!s) return "";
  return `<span class="src-badge src-${kind}" title="${esc(s.title)}">${esc(s.label)}</span>`;
}

// Legenda k barevnému označení zdrojů — jednou nad výsledkem kalkulace.
function srcLegendHtml() {
  return `<div class="src-legend muted">Barevné označení zdroje dat:
    ${Object.entries(DATA_SOURCES).filter(([k]) => k !== "ref").map(([k, s]) =>
      `<span class="src-legend-item" title="${esc(s.title)}"><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join("")}
  </div>`;
}

/* ------------- Vytížení zón podle časových dotací (progress bar) ----------- */
// Časová dotace pozice (ServiceZ / MeetingZ / BackofficeZ / OfficeRoom v %) se
// vedle čísel ukazuje i jako vodorovný pruh — u soupisu zaměstnanců na pobočce
// (v aplikaci i v PDF) a v tabulce časových dotací v referenčních datech.

const ZONE_COLORS = {
  service_zone: "#2770f0",     // modrá — obsluha na hale
  meeting_zone: "#0bb43f",     // zelená — schůzky
  backoffice_zone: "#f0a020",  // oranžová — backoffice
  office_room: "#8b5cf6",      // fialová — kancelář
};
const ZONE_REST_COLOR = "#d8dde5"; // zbytek do 100 % (nezařazený čas)

// Mapa "segment||pozice" -> rozdělení času po zónách. Pokud je k dispozici verze
// referenčních dat kalkulace, bere se snapshot z ní (aby report odpovídal tomu,
// s čím se počítalo); jinak aktuální tabulka casove_dotace.
function dotaceSplitMap(refVersionId) {
  const map = {};
  const version = refVersionId ? getRefVersionById(refVersionId) : null;
  if (version && version.dotace) {
    version.dotace.forEach(([seg, poz, sv, me, bo, of]) => {
      map[`${seg}||${poz}`] = { service_zone: sv || 0, meeting_zone: me || 0, backoffice_zone: bo || 0, office_room: of || 0 };
    });
    return map;
  }
  if (!db) return map;
  dbAll(`SELECT segment, pozice, service_zone, meeting_zone, backoffice_zone, office_room FROM casove_dotace`)
    .forEach((r) => {
      map[`${r.segment}||${r.pozice}`] = { service_zone: r.service_zone || 0, meeting_zone: r.meeting_zone || 0,
        backoffice_zone: r.backoffice_zone || 0, office_room: r.office_room || 0 };
    });
  return map;
}

// Mapa "segment||pozice" -> podíl fast tracku v % (nastavení u pozice).
// Stejně jako dotace se bere přednostně ze snapshotu verze, se kterou kalkulace
// vznikla; starší verze snapshotu podíl neobsahují, tam je 0.
function fasttrackShareMap(refVersionId) {
  const map = {};
  const version = refVersionId ? getRefVersionById(refVersionId) : null;
  if (version && version.dotace) {
    version.dotace.forEach(([seg, poz, sv, me, bo, of, ft]) => { map[`${seg}||${poz}`] = Number(ft) || 0; });
    return map;
  }
  if (!db) return map;
  try {
    dbAll("SELECT segment, pozice, fasttrack_share FROM casove_dotace").forEach((r) => {
      map[`${r.segment}||${r.pozice}`] = Number(r.fasttrack_share) || 0;
    });
  } catch (e) { /* starší databáze bez sloupce */ }
  return map;
}

function zoneSplitTotal(split) {
  return ZONES.reduce((sum, z) => sum + (Number(split && split[z]) || 0), 0);
}

// Vodorovný pruh s podílem zón. `split` je objekt { service_zone: %, ... }.
function zoneSplitBarHtml(split, options = {}) {
  if (!split) return `<span class="muted">bez časové dotace</span>`;
  const total = zoneSplitTotal(split);
  if (!total) return `<span class="muted">bez časové dotace</span>`;
  const scale = Math.max(100, total); // přes 100 % se pruh nepřeteče, jen zhustí
  const parts = ZONES.filter((z) => (Number(split[z]) || 0) > 0).map((z) => {
    const v = Number(split[z]) || 0;
    return `<span class="zbar-seg" style="width:${(v / scale) * 100}%; background:${ZONE_COLORS[z]};"
      title="${esc(ZONE_LABELS[z])}: ${fmt1(v)} %">${v >= 12 ? `${Math.round(v)}` : ""}</span>`;
  }).join("");
  const rest = scale - total;
  const restHtml = rest > 0.01
    ? `<span class="zbar-seg zbar-rest" style="width:${(rest / scale) * 100}%;" title="Nezařazený čas: ${fmt1(rest)} %"></span>`
    : "";
  const note = total < 99.9 ? `<span class="zbar-note muted" title="Součet dotací je pod 100 %">${fmt1(total)} %</span>` : "";
  return `<div class="zbar${options.compact ? " compact" : ""}">${parts}${restHtml}</div>${note}`;
}

function zoneLegendHtml(label = "Vytížení zón podle časových dotací:") {
  return `<div class="zbar-legend muted">${esc(label)}
    ${ZONES.map((z) => `<span><i style="background:${ZONE_COLORS[z]}"></i>${esc(ZONE_LABELS[z])}</span>`).join("")}
    <span><i style="background:${ZONE_REST_COLOR}"></i>nezařazeno</span></div>`;
}

// Čekací zóna: „obývák“ je sestava tří židlí. Do doporučení se dává nejvýš
// jeden obývák (víc si lze v layoutu přidat ručně) a zbytek židlí se doplní
// jednotlivými kusy.
const CHAIRS_PER_SOFA = 3;
const MAX_SUGGESTED_SOFAS = 1;

// Rozdělení doporučeného počtu židlí mezi obývák(y) a jednotlivé židle.
function waitingZoneSplit(chairs, hasSofa) {
  const total = Math.max(0, Math.round(chairs || 0));
  if (!hasSofa) return { sofas: 0, chairs: total };
  const sofas = Math.min(MAX_SUGGESTED_SOFAS, Math.floor(total / CHAIRS_PER_SOFA));
  return { sofas, chairs: total - sofas * CHAIRS_PER_SOFA };
}

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

// Počty kusů nábytku jsou celá čísla — "9 ks" se čte lépe než "9.0 ks".
function fmtPieces(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
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
  applyFasttrackDefaults(db);
  const insFurniture = db.prepare("INSERT INTO furniture_to_zone (segment, furniture, zone, wpl_counter) VALUES (?, ?, ?, ?)");
  SEED_FURNITURE.forEach((r) => { insFurniture.run(r); });
  insFurniture.free();
  const insPobocky = db.prepare("INSERT INTO pobocky (id_pobocky, nazev, region) VALUES (?, ?, ?)");
  SEED_POBOCKY.forEach((r) => { insPobocky.run(r); });
  insPobocky.free();
  const insSegments = db.prepare("INSERT INTO segments (segment_key, nazev, sort_order, color, icon) VALUES (?, ?, ?, ?, ?)");
  SEED_SEGMENTS.forEach((r) => { insSegments.run(r); });
  insSegments.free();
  refreshSettingsCache();
  const versionId = ensureRefVersionUpToDate("Založení nové databáze");
  // Výchozí referenční data patří do první verze.
  dbRun("UPDATE absence SET ref_version_id = ?", [versionId]);
  dbRun("UPDATE casove_dotace SET ref_version_id = ?", [versionId]);
  dbRun("UPDATE furniture_to_zone SET ref_version_id = ?", [versionId]);
  refreshSegmentMetaCache();
}

function loadDatabaseFromBytes(bytes) {
  const candidate = new SQL.Database(new Uint8Array(bytes));
  migrateSchema(candidate); // doplní chybějící tabulky/sloupce ze starších verzí aplikace, zbytek dat zachová
  db = candidate;
  refreshSettingsCache();
  const versionId = ensureRefVersionUpToDate("Stav při připojení databáze");
  // Řádky referenčních dat z databází uložených před zavedením evidence verzí
  // u jednotlivých řádků dostanou verzi platnou při připojení — její snapshot
  // tyto hodnoty skutečně obsahuje, takže je zařazení správné. Další úpravy už
  // stamp posunou jen u řádků, které se opravdu změní.
  dbRun("UPDATE absence SET ref_version_id = ? WHERE ref_version_id IS NULL", [versionId]);
  dbRun("UPDATE casove_dotace SET ref_version_id = ? WHERE ref_version_id IS NULL", [versionId]);
  dbRun("UPDATE furniture_to_zone SET ref_version_id = ? WHERE ref_version_id IS NULL", [versionId]);
  // Verze uložené před zavedením verzování nábytku snapshot nábytku neobsahují.
  // U té, se kterou se databáze připojila, ho doplníme podle aktuálního stavu —
  // ten se od jejího vzniku nemohl změnit (jinak by výše vznikla verze nová),
  // takže je zařazení správné a detail verze je pak úplný.
  dbRun("UPDATE ref_data_versions SET furniture_json = ? WHERE id = ? AND furniture_json IS NULL",
    [JSON.stringify(snapshotRefData().furniture), versionId]);
  backfillCalculationStats(); // dopočítá ukazatele pro kalkulace uložené před zavedením benchmarku
  refreshSegmentMetaCache();
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

/* ---------------------------- Nastavení aplikace --------------------------- */
// Uživatelská nastavení (zatím vzhled a chování generované Excel šablony) žijí
// v tabulce `app_settings` jako dvojice klíč/hodnota. Definice níže je zdroj
// pravdy: podle ní se vykreslí formulář v „Struktuře checklistu“, z ní se berou
// výchozí hodnoty a podle typu se hodnota převádí zpět na číslo/logickou hodnotu.

const SETTINGS_DEFS = [
  { key: "tpl_color_title", group: "colors", label: "Titulek a boční popisky", type: "color", def: "#2770f0" },
  { key: "tpl_color_section", group: "colors", label: "Hlavičky sekcí", type: "color", def: "#235377" },
  { key: "tpl_color_segment", group: "colors", label: "Popisek segmentu", type: "color", def: "#00a4a2" },
  { key: "tpl_color_sum", group: "colors", label: "Součtové buňky", type: "color", def: "#00a4a3" },
  { key: "tpl_color_zone", group: "colors", label: "Popisek zóny", type: "color", def: "#e7e6e6" },
  { key: "tpl_color_headercell", group: "colors", label: "Vyplňované buňky v hlavičce", type: "color", def: "#f2f2f2" },
  { key: "tpl_color_input", group: "colors", label: "Písmo vyplňovaných buněk", type: "color", def: "#0070c0" },
  { key: "tpl_color_ondark", group: "colors", label: "Písmo na tmavém podbarvení", type: "color", def: "#ffffff" },

  { key: "tpl_use_segment_colors", group: "tpl", label: "Barvit segmenty podle tabulky Segmenty", type: "bool", def: "1",
    help: "Popisek segmentu v CHL dostane vlastní barvu segmentu místo jednotné tyrkysové." },
  { key: "tpl_font", group: "tpl", label: "Písmo šablony", type: "text", def: "Arial" },
  { key: "tpl_cestovni_rows", group: "tpl", label: "Volných řádků pro cestovní pozice", type: "int", def: "9", min: 0, max: 60 },
  { key: "tpl_note_rows", group: "tpl", label: "Řádků pro doplňující informace", type: "int", def: "8", min: 1, max: 40 },
  { key: "tpl_default_hours", group: "tpl", label: "Předvyplněná otevírací doba (h/týden)", type: "num", def: "40" },
  { key: "tpl_col_width_gh", group: "tpl", label: "Šířka sloupců G a H", type: "num", def: "19.86" },
  { key: "tpl_hide_helper_sheets", group: "tpl", label: "Skrýt listy VSTUPY a Pobočky", type: "bool", def: "1" },
  { key: "tpl_collapse_notes", group: "tpl", label: "Sloupec K s poznámkami sbalit (skrýt)", type: "bool", def: "1" },
  { key: "tpl_freeze_header", group: "tpl", label: "Ukotvit hlavičku listu CHL", type: "bool", def: "1" },
  { key: "tpl_protect_sheet", group: "tpl", label: "Zamknout list — editovat jen vyplňovaná pole", type: "bool", def: "1",
    help: "Zamkne listy a odemkne jen buňky k zadávání (FTE, počty, poznámky, hlavička), aby se šablona nerozbila." },
  { key: "tpl_protect_password", group: "tpl", label: "Heslo pro odemčení listu (nepovinné)", type: "text", def: "" },
];
const SETTINGS_BY_KEY = {};
SETTINGS_DEFS.forEach((d) => { SETTINGS_BY_KEY[d.key] = d; });

let settingsCache = null;

function refreshSettingsCache() {
  settingsCache = {};
  if (!db) return;
  try {
    dbAll("SELECT key, value FROM app_settings").forEach((r) => { settingsCache[r.key] = r.value; });
  } catch (e) { /* tabulka ještě neexistuje (stará databáze před migrací) */ }
}

function getSetting(key) {
  if (settingsCache === null) refreshSettingsCache();
  const def = SETTINGS_BY_KEY[key];
  const raw = settingsCache[key];
  return raw === undefined || raw === null || raw === "" ? (def ? def.def : "") : raw;
}

function getSettingNum(key) {
  const n = Number(String(getSetting(key)).replace(",", "."));
  return Number.isFinite(n) ? n : Number(SETTINGS_BY_KEY[key].def);
}

function getSettingBool(key) { return getSetting(key) === "1"; }

function setSettings(pairs) {
  const ins = db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  Object.entries(pairs).forEach(([k, v]) => ins.run([k, String(v)]));
  ins.free();
  refreshSettingsCache();
}

// #rrggbb -> ARGB pro OOXML (FFRRGGBB)
function hexToArgb(hex) {
  const h = String(hex || "").replace("#", "").trim();
  return `FF${(h.length === 6 ? h : "000000").toUpperCase()}`;
}

/* ---------------------------- Parsování Excelu ---------------------------- */

function excelCell(ws, addr) {
  const c = ws[addr];
  if (!c) return null;
  return c.v === undefined ? null : c.v;
}

function isBlank(v) { return v === null || v === undefined || v === ""; }

// Vyhodnotí jeden řádek pozice (segment, pozice, FTE, WPL) přesně podle pravidel
// nacti_data_z_excelu: FTE <= 0 se vynechá; WPL se u segmentu CESTOVNÍ bere ze
// zadané hodnoty (chybí-li, dopočte se při kalkulaci z otevírací doby), jinak se
// použije `defaultWpl` (C4 v Excelu / "Doba vytížení WPL" u manuálního zadání).
// Používá jak parsování Excelu, tak manuální zadání pozic — obě cesty tak mají
// vždy identické chování.
function buildLoadRow(segment, pozice, fteRaw, wplRaw, defaultWpl) {
  if (isBlank(segment) || isBlank(pozice)) return null;
  const fte = toNumberOrNull(fteRaw);
  if (fte === null || fte <= 0) return null;

  let wpl_load;
  if (String(segment).trim().toUpperCase() === "CESTOVNÍ") {
    wpl_load = toNumberOrNull(wplRaw); // pokud chybí, doplní se při výpočtu otevírací dobou
  } else {
    const parsed = toNumberOrNull(defaultWpl);
    wpl_load = parsed !== null ? parsed : 40.0;
  }
  return { segment: String(segment).trim(), pozice: String(pozice).trim(), fte, wpl_load };
}

function parseVstupySheet(workbook) {
  if (!workbook.SheetNames.includes("VSTUPY")) {
    throw new Error("V Excelu chybí list „VSTUPY“.");
  }
  const ws = workbook.Sheets["VSTUPY"];
  const pobocka_id = excelCell(ws, "C1");
  const pobocka_nazev = excelCell(ws, "C2");
  const oteviraci_doba = excelCell(ws, "C3");
  const doba_vytezeni_wpl = excelCell(ws, "C4");
  // Příznak směnového režimu (F1) přidaly novější šablony — u starších zůstane
  // prázdný a režim se pozná z rozdílu hodin.
  const shiftRaw = excelCell(ws, "F1");
  const shiftFlag = isBlank(shiftRaw) ? null
    : ["ano", "yes", "1", "true", "x"].includes(String(shiftRaw).trim().toLowerCase());

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

    const row = buildLoadRow(segment, pozice, fteRaw, wplRaw, doba_vytezeni_wpl);
    if (row) rows.push(row);
    radek++;
  }

  return {
    pobocka_id: String(pobocka_id).trim(),
    pobocka_nazev: String(pobocka_nazev).trim(),
    oteviraci_doba: toNumberOrNull(oteviraci_doba) ?? 40,
    doba_vytezeni_wpl: toNumberOrNull(doba_vytezeni_wpl) ?? (toNumberOrNull(oteviraci_doba) ?? 40),
    shiftFlag,
    rows,
  };
}

// Uloží řádky pozic pro pobočku do excel_loads (ať už pochází z nahraného Excelu,
// nebo z manuálního zadání) a nastaví je jako aktuálně rozpracovaný checklist
// (pendingLoad), ze kterého se pak spočítá kalkulace — od tohoto bodu je průběh
// pro obě cesty zadání naprosto shodný.
async function commitLoad(pobocka_id, pobocka_nazev, oteviraci_doba, rows, shiftMode) {
  const load_key = `load_${pobocka_id}-${pobocka_nazev}-${nowStamp()}`;
  const createdAt = nowIso();

  const ins = db.prepare(`INSERT INTO excel_loads
    (load_key, pobocka_id, pobocka_nazev, oteviraci_doba, shift_mode, segment, pozice, fte, wpl_load, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  rows.forEach((r) => {
    ins.run([load_key, pobocka_id, pobocka_nazev, oteviraci_doba, shiftMode ? 1 : 0,
      r.segment, r.pozice, r.fte, r.wpl_load, createdAt]);
  });
  ins.free();

  await persistDatabase();

  const committed = { load_key, pobocka_id, pobocka_nazev, oteviraci_doba, rows, shiftMode: !!shiftMode };
  pendingLoad = committed;
  return committed;
}

async function handleExcelFile(file) {
  const msgsEl = document.getElementById("excelMsgs");
  msgsEl.innerHTML = "";
  document.getElementById("excelPreview").innerHTML = "";
  document.getElementById("resultsPanel").style.display = "none";
  document.getElementById("layoutPanel").style.display = "none";
  document.getElementById("calcFlow").style.display = "none";
  if (!requireDb()) return;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const parsed = parseVstupySheet(wb);
    if (!parsed.rows.length) {
      msgsEl.innerHTML = `<div class="msg err">V listu „VSTUPY“ nebyl nalezen žádný řádek s FTE &gt; 0.</div>`;
      return;
    }
    // Otevírací doba výrazně vyšší než doba vytížení pozice = pobočka jede na
    // směny (typicky obchodní centra otevřená 7 dní v týdnu).
    const autoShift = parsed.shiftFlag !== null && parsed.shiftFlag !== undefined
      ? parsed.shiftFlag : isShiftMode(parsed.oteviraci_doba, parsed.doba_vytezeni_wpl);
    const committed = await commitLoad(parsed.pobocka_id, parsed.pobocka_nazev, parsed.oteviraci_doba,
      parsed.rows, autoShift);
    committed.doba_vytezeni_wpl = parsed.doba_vytezeni_wpl;
    msgsEl.innerHTML = `<div class="msg ok">Checklist načten: <strong>${esc(parsed.pobocka_nazev)}</strong>
      (ID ${esc(parsed.pobocka_id)}), otevírací doba ${esc(parsed.oteviraci_doba)} h/týden,
      ${parsed.rows.length} pozic s FTE &gt; 0.</div>`;
    renderExcelPreview(committed);
  } catch (e) {
    console.error(e);
    msgsEl.innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
  }
}

function renderExcelPreview(parsed) {
  const splits = dotaceSplitMap(null);
  const loadHours = parsed.doba_vytezeni_wpl
    ?? (parsed.rows.find((r) => String(r.segment).trim().toUpperCase() !== "CESTOVNÍ") || {}).wpl_load
    ?? parsed.oteviraci_doba;
  // Porovnání se skutečným stavem se dělá jen z vlastních pozic pobočky —
  // převzaté FTE ze spádových poboček by ho zkreslily.
  const ownRows = parsed.rows.filter((r) => !r.source_branch);
  const cmp = compareFteWithSpecialists(ownRows, parsed.pobocka_id, parsed.pobocka_nazev);
  const rowsHtml = parsed.rows.map((r) => `
    <tr${r.source_branch ? ' class="cm-taken-row"' : ""}>
      <td>${segmentBadgeHtml(r.segment)}</td>
      <td>${esc(r.pozice)}${r.source_branch
        ? ` <span class="src-badge src-catchment" title="Převzato ze spádové pobočky">${esc(r.source_branch)}</span>`
        : ""}</td>
      <td>${fmt1(r.fte)}</td>
      <td>${r.wpl_load === null ? '<span class="muted">dle otevírací doby</span>' : fmt1(r.wpl_load)}</td>
      <td>${zoneSplitBarHtml(splits[`${r.segment}||${r.pozice}`])}</td>
    </tr>`).join("");
  document.getElementById("excelPreview").innerHTML = `
    <label class="shift-check"><input type="checkbox" id="previewShiftMode"${parsed.shiftMode ? " checked" : ""}>
      <span><strong>Pobočka se směnovým režimem</strong> — otevírací doba je delší než doba vytížení
      jedné pozice (typicky obchodní centra otevřená 7 dní v týdnu), zaměstnanci se střídají.
      <span id="previewShiftBadge">${shiftBadgeHtml(parsed.shiftMode)}</span></span></label>
    <div id="previewShiftInfo">${shiftInfoHtml(parsed.oteviraci_doba, loadHours, !!parsed.shiftMode)}</div>
    ${zoneLegendHtml()}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Segment</th><th>Pozice</th><th>FTE</th><th>Vytížení WPL (h/týden)</th>
          <th>Vytížení zón</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    ${renderFteComparisonHtml(cmp, { open: true })}
    <div id="catchmentPanel"></div>
    <div class="row" style="margin-top:14px;">
      <button class="btn" id="btnCalculate">Spočítat kalkulaci WPL</button>
    </div>`;
  document.getElementById("btnCalculate").addEventListener("click", runCalculation);
  renderCatchmentPanel("catchmentPanel", parsed);

  // Směnový režim se dá u načteného checklistu přepnout — hodnota se hned uloží
  // k nahrávce, takže s ní počítá i kalkulace a její PDF.
  const shiftBox = document.getElementById("previewShiftMode");
  shiftBox.addEventListener("change", () => {
    const on = shiftBox.checked;
    if (parsed.load_key) {
      dbRun("UPDATE excel_loads SET shift_mode = ? WHERE load_key = ?", [on ? 1 : 0, parsed.load_key]);
      persistDatabase();
    }
    parsed.shiftMode = on;
    if (pendingLoad && pendingLoad.load_key === parsed.load_key) pendingLoad.shiftMode = on;
    document.getElementById("previewShiftInfo").innerHTML = shiftInfoHtml(parsed.oteviraci_doba, loadHours, on);
    document.getElementById("previewShiftBadge").innerHTML = shiftBadgeHtml(on);
  });
}

/* ------------------------- Manuální zadání pozic --------------------------- */

function getKnownSegments() {
  return dbAll("SELECT DISTINCT segment FROM casove_dotace ORDER BY segment").map((r) => r.segment);
}

function getPositionsForSegment(segment) {
  return dbAll("SELECT DISTINCT pozice FROM casove_dotace WHERE segment = ? ORDER BY pozice", [segment]).map((r) => r.pozice);
}

function renderPobockyDatalist() {
  const dl = document.getElementById("pobockyDatalist");
  if (!dl || !db) return;
  const rows = dbAll("SELECT nazev FROM pobocky ORDER BY nazev");
  dl.innerHTML = rows.map((r) => `<option value="${esc(r.nazev)}"></option>`).join("");
}

function manualRowHtml() {
  const segments = getKnownSegments();
  const firstSeg = segments[0] || "";
  const segOptions = segments.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  const pozOptions = getPositionsForSegment(firstSeg).map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
  const isCestovni = firstSeg.trim().toUpperCase() === "CESTOVNÍ";
  const wplPlaceholder = isCestovni ? "zadejte vytížení, např. 12" : "dle otevírací doby";
  return `<tr class="manual-row">
    <td><select class="manual-segment">${segOptions}</select></td>
    <td><select class="manual-pozice">${pozOptions}</select></td>
    <td><input type="number" class="manual-fte" min="0" step="0.1" placeholder="0"></td>
    <td><input type="number" class="manual-wpl" min="0" step="0.5" placeholder="${wplPlaceholder}"${isCestovni ? "" : " disabled"}></td>
    <td><button class="btn secondary small btn-del">✕</button></td>
  </tr>`;
}

function wireManualRow(tr) {
  const segSelect = tr.querySelector(".manual-segment");
  const pozSelect = tr.querySelector(".manual-pozice");
  const wplInput = tr.querySelector(".manual-wpl");
  segSelect.addEventListener("change", () => {
    const seg = segSelect.value;
    pozSelect.innerHTML = getPositionsForSegment(seg).map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
    const isCestovni = seg.trim().toUpperCase() === "CESTOVNÍ";
    wplInput.disabled = !isCestovni;
    wplInput.placeholder = isCestovni ? "zadejte vytížení, např. 12" : "dle otevírací doby";
    if (!isCestovni) wplInput.value = "";
  });
  tr.querySelector(".btn-del").addEventListener("click", () => tr.remove());
}

function addManualRow() {
  const tbody = document.getElementById("manualRowsTbody");
  tbody.insertAdjacentHTML("beforeend", manualRowHtml());
  wireManualRow(tbody.lastElementChild);
}

/* ------------- Export specialistů (obsazenost pozic po pobočkách) ---------- */
// Soubor `data/export_specialiste.xlsx`: první řádek je hlavička, ve sloupci A
// je branch_id (kód pobočky), ve sloupci B název pobočky a od dalších sloupců
// jsou názvy pozic s počty na dané pobočce. Import se uloží do databáze
// (tabulka `specialist_export`), takže se pak dá u manuálního zadání jedním
// kliknutím načíst obsazenost vybrané pobočky.

// Sloupce, které nejsou pozice.
const SPECIALIST_META_COLS = new Set(["branch_id", "branch_name", "gps_x", "gps_y", "evidenční stav"]);

function normalizePozice(v) { return String(v || "").trim().toLowerCase().replace(/\s+/g, " "); }

// Mapa "název pozice" -> segment. Pozice jsou v `casove_dotace` vedené i pod
// segmentem CESTOVNÍ (model cestovních pozic) — pro obsazenost pobočky se bere
// vždy „domovský“ segment, tedy ten, který CESTOVNÍ není.
function positionSegmentMap() {
  const map = {};
  if (!db) return map;
  dbAll("SELECT segment, pozice FROM casove_dotace ORDER BY id").forEach((r) => {
    const key = normalizePozice(r.pozice);
    const cestovni = String(r.segment).trim().toUpperCase().startsWith("CESTOVNÍ");
    if (!map[key] || (!cestovni && map[key].cestovni)) {
      map[key] = { segment: r.segment, pozice: r.pozice, cestovni };
    }
  });
  return map;
}

function parseSpecialistExport(workbook) {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],
    { header: 1, blankrows: false });
  if (!rows.length) throw new Error("List je prázdný.");
  const header = (rows[0] || []).map((h) => String(h || "").trim());
  if (normalizePozice(header[0]) !== "branch_id") {
    throw new Error(`První sloupec má být „branch_id“, je tam „${header[0]}“.`);
  }
  const known = positionSegmentMap();
  const posCols = [];
  const unknown = [];
  header.forEach((h, i) => {
    if (i === 0 || !h || SPECIALIST_META_COLS.has(normalizePozice(h))) return;
    if (known[normalizePozice(h)]) posCols.push({ index: i, pozice: h });
    else unknown.push(h);
  });
  if (!posCols.length) throw new Error("V hlavičce nejsou žádné názvy pozic známé z referenčních dat.");

  const branches = [];
  rows.slice(1).forEach((r) => {
    const id = r[0];
    if (id === undefined || id === null || String(id).trim() === "") return;
    const counts = {};
    posCols.forEach(({ index, pozice }) => {
      const v = Number(r[index]);
      if (Number.isFinite(v) && v > 0) counts[pozice] = v;
    });
    branches.push({ branch_id: String(id).trim(), branch_name: String(r[1] || "").trim(), counts });
  });
  return { branches, positions: posCols.length, unknown };
}

function specialistSetStatus(html, cls) {
  const el = document.getElementById("specialistStatus");
  if (el) el.innerHTML = `<div class="msg ${cls || ""}">${html}</div>`;
}

async function handleSpecialistExportFile(file) {
  if (!requireDb()) return;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const parsed = parseSpecialistExport(XLSX.read(data, { type: "array" }));
    const importedAt = nowIso();
    dbRun("DELETE FROM specialist_export");
    const ins = db.prepare(`INSERT INTO specialist_export
      (branch_id, branch_name, imported_at, source, payload) VALUES (?, ?, ?, ?, ?)`);
    parsed.branches.forEach((b) => {
      ins.run([b.branch_id, b.branch_name, importedAt, file.name, JSON.stringify(b.counts)]);
    });
    ins.free();
    await persistDatabase();
    specialistSetStatus(`Načteno <strong>${parsed.branches.length}</strong> poboček`
      + ` a ${parsed.positions} pozic ze souboru <strong>${esc(file.name)}</strong>.`
      + (parsed.unknown.length
        ? ` Nerozpoznané sloupce (${parsed.unknown.length}): ${esc(parsed.unknown.join(", "))}.` : ""), "ok");
    renderSpecialistInfo();
    applySpecialistPositions({ silent: true });
  } catch (e) {
    console.error(e);
    specialistSetStatus(`Export se nepodařilo načíst: ${esc(e.message)}`, "err");
  }
}

function specialistExportInfo() {
  if (!db) return null;
  try {
    const row = dbAll(`SELECT COUNT(*) AS n, MAX(imported_at) AS imported_at, MAX(source) AS source
      FROM specialist_export`)[0];
    return row && row.n ? row : null;
  } catch (e) { return null; }
}

function specialistRowFor(pobockaId, pobockaNazev) {
  if (!db) return null;
  if (pobockaId) {
    const byId = dbAll("SELECT * FROM specialist_export WHERE branch_id = ?", [String(pobockaId).trim()])[0];
    if (byId) return byId;
  }
  if (!pobockaNazev) return null;
  return dbAll("SELECT * FROM specialist_export WHERE LOWER(branch_name) = ?",
    [String(pobockaNazev).trim().toLowerCase()])[0] || null;
}

// Doplní řádky manuálního zadání podle obsazenosti pobočky z exportu.
function applySpecialistPositions(options = {}) {
  if (!requireDb()) return;
  if (!specialistExportInfo()) {
    if (!options.silent) {
      specialistSetStatus("Nejprve nahrajte soubor <code>export_specialiste.xlsx</code>"
        + " — je ve složce s aplikací (podsložka <code>data</code>).", "warn");
    }
    return;
  }
  const pobockaId = document.getElementById("manualPobockaId").value.trim();
  const pobockaNazev = document.getElementById("manualPobockaName").value.trim();
  const row = specialistRowFor(pobockaId, pobockaNazev);
  if (!row) {
    if (!options.silent) {
      specialistSetStatus(`Pobočka <strong>${esc(pobockaNazev || pobockaId || "—")}</strong>`
        + " v exportu není. Zkontrolujte ID pobočky.", "warn");
    }
    return;
  }
  const counts = JSON.parse(row.payload || "{}");
  const known = positionSegmentMap();
  const filled = [];
  const skipped = [];
  Object.entries(counts).forEach(([pozice, count]) => {
    const found = known[normalizePozice(pozice)];
    if (found) filled.push({ segment: found.segment, pozice: found.pozice, fte: count });
    else skipped.push(pozice);
  });
  if (!filled.length) {
    if (!options.silent) {
      specialistSetStatus(`Pobočka <strong>${esc(row.branch_name || row.branch_id)}</strong>`
        + " má v exportu nulovou obsazenost.", "warn");
    }
    return;
  }
  filled.sort((a, b) => a.segment.localeCompare(b.segment, "cs") || a.pozice.localeCompare(b.pozice, "cs"));

  const tbody = document.getElementById("manualRowsTbody");
  tbody.innerHTML = "";
  filled.forEach((r) => {
    tbody.insertAdjacentHTML("beforeend", manualRowHtml());
    const tr = tbody.lastElementChild;
    wireManualRow(tr);
    const segSelect = tr.querySelector(".manual-segment");
    segSelect.value = r.segment;
    segSelect.dispatchEvent(new Event("change"));
    tr.querySelector(".manual-pozice").value = r.pozice;
    tr.querySelector(".manual-fte").value = r.fte;
  });
  const total = filled.reduce((a, r) => a + r.fte, 0);
  specialistSetStatus(`Načteno z exportu: <strong>${esc(row.branch_name || row.branch_id)}</strong>`
    + ` (ID ${esc(row.branch_id)}) — ${filled.length} pozic, celkem ${fmt1(total)} FTE.`
    + (skipped.length ? ` Vynecháno (chybí časová dotace): ${esc(skipped.join(", "))}.` : "")
    + " Hodnoty lze před spočítáním upravit.", "ok");
}

function renderSpecialistInfo() {
  const el = document.getElementById("specialistInfo");
  if (!el) return;
  const info = specialistExportInfo();
  el.innerHTML = info
    ? `Export specialistů: <strong>${info.n}</strong> poboček`
      + `${info.source ? ` ze souboru ${esc(info.source)}` : ""}`
      + `${info.imported_at ? `, import ${new Date(info.imported_at).toLocaleString("cs-CZ")}` : ""}.`
    : "Export specialistů zatím není naimportovaný — soubor <code>export_specialiste.xlsx</code>"
      + " najdete ve složce s aplikací (podsložka <code>data</code>).";
}

/* ------------- Export poboček (pobocky-export.xlsx) ------------------------ */
// Soubor `pobocky-export.xlsx` je datový slovník o pobočkách: adresa a zařazení
// (region, oblast, ORP), rating pobočky za roky 23–25 včetně trendu a kvintilu,
// výnosy a nové výnosy za roky 21–25 a prodeje po produktech (počty a kvintily).
// Aplikace si soubor uloží celý (tabulka `branch_export`, payload = všechny
// sloupce beze změny) a při čtení si z něj vytáhne, co potřebuje — hlavičku PDF
// sestavy a kartu pobočky v „Dodatečné analytice“.
//
// Názvy sloupců se poznávají podle normalizovaného textu (bez diakritiky, bez
// interpunkce), takže drobné odchylky v hlavičce (velká písmena, tečky, emoji
// u „Nebezpečné zóny“) import nerozhodí.

function deacc(v) {
  return String(v === null || v === undefined ? "" : v).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normHeader(v) {
  return deacc(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Prodejní kategorie ze slovníku. `match` je normalizovaný úryvek hlavičky;
// přiřazuje se od nejdelšího, aby „Revol. úvěry“ nespadly do „Úvěry“.
const BRANCH_SALES_PRODUCTS = [
  { key: "ucty", label: "Účty", match: "ucty" },
  { key: "hypoteky", label: "Hypotéky", match: "hypoteky" },
  { key: "pojZivot", label: "Poj. život", match: "poj zivot" },
  { key: "pojNezivot", label: "Poj. neživot", match: "poj nezivot" },
  { key: "invPravid", label: "Inv. pravid.", match: "inv pravid" },
  { key: "invJednor", label: "Inv. jednor.", match: "inv jednor" },
  { key: "revolUvery", label: "Revol. úvěry", match: "revol uvery" },
  { key: "uvery", label: "Úvěry", match: "uvery" },
  { key: "penze", label: "Penze", match: "penze" },
];

// Kvintil 1 = nejlepší pětina poboček, 5 = nejslabší. Barvy se používají
// v aplikaci i v PDF (pill u ratingu, kvintily u výnosů a prodejů).
const QUINTILE_COLORS = ["#0e9f6e", "#5aa84f", "#f0a020", "#ef7d3b", "#e02424"];

function quintileColor(q) {
  const n = Math.round(Number(q));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? QUINTILE_COLORS[n - 1] : "#6b7482";
}

function branchNum(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[\s\u00a0]/g, "").replace(/[^\d,.\-]/g, "").replace(",", ".");
  const x = parseFloat(cleaned);
  return Number.isFinite(x) ? x : null;
}

// Celá čísla s mezerami po tisících — čte se to stejně v aplikaci i v PDF.
function fmtNum0(v) {
  const n = branchNum(v);
  if (n === null) return "—";
  return Math.round(n).toLocaleString("cs-CZ").replace(/\u00a0/g, " ");
}

// Malé hodnoty (změny, procenta) by zaokrouhlením na celé číslo ztratily smysl,
// velké částky se naopak čtou lépe bez desetin.
function fmtNumAuto(v) {
  const n = branchNum(v);
  if (n === null) return "—";
  if (Math.abs(n) >= 1000 || Number.isInteger(n)) return fmtNum0(n);
  return String(Math.round(n * 10) / 10).replace(".", ",");
}

function parseBranchExport(workbook) {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],
    { header: 1, blankrows: false });
  if (!rows.length) throw new Error("List je prázdný.");
  const header = (rows[0] || []).map((h) => String(h === null || h === undefined ? "" : h).trim());
  const firstNorm = normHeader(header[0]);
  if (!["id pobocky", "branch id", "id", "id pobocka"].includes(firstNorm)) {
    throw new Error(`První sloupec má být „ID Pobočky“, je tam „${header[0]}“.`);
  }
  // Prázdné a duplicitní hlavičky dostanou jednoznačný název, aby se hodnota
  // sloupce neztratila.
  const names = [];
  header.forEach((h, i) => {
    let name = h || `sloupec ${i + 1}`;
    while (names.includes(name)) name += " ";
    names.push(name);
  });

  const branches = [];
  rows.slice(1).forEach((r) => {
    const id = r[0];
    if (id === undefined || id === null || String(id).trim() === "") return;
    const payload = {};
    names.forEach((name, i) => {
      const v = r[i];
      if (v !== undefined && v !== null && v !== "") payload[name] = v;
    });
    branches.push({
      branch_id: String(id).trim(),
      branch_name: String(r[1] === undefined || r[1] === null ? "" : r[1]).trim(),
      payload,
    });
  });
  return { branches, columns: names.filter((n) => !/^sloupec \d+$/.test(n)) };
}

// Ze surových sloupců vytáhne to, co aplikace umí zobrazit. Zbytek zůstává
// dostupný v `raw`, takže se ze slovníku nic neztrácí.
function branchFields(payload) {
  const keys = Object.keys(payload || {});
  const norm = {};
  keys.forEach((k) => { norm[k] = normHeader(k); });
  const pick = (fn) => keys.find((k) => fn(norm[k]));
  const text = (k) => (k && payload[k] !== undefined ? String(payload[k]).trim() : null);
  const number = (k) => (k ? branchNum(payload[k]) : null);

  // Výnosy a nové výnosy po letech: „Výnosy 23“, „Nové výnosy 25“ atd.
  const yearly = (isNew) => keys
    .map((k) => {
      const n = norm[k];
      const isNewCol = n.startsWith("nove ");
      if (isNewCol !== isNew || !n.includes("vynosy") || n.includes("kvintil")
        || n.includes("trend") || n.includes("zmena")) return null;
      const m = /(\d{2})(?!.*\d)/.exec(n);
      return m ? { year: Number(m[1]), value: branchNum(payload[k]), header: k } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.year - b.year);

  const revenues = yearly(false);
  const newRevenues = yearly(true);

  // Prodeje po produktech — sloupec s „kvintil“ je kvintil, sloupec s „objem“
  // (pokud v exportu je) objem, ostatní je počet prodejů. Delší názvy se
  // přiřazují první, aby „Revol. úvěry“ nesebraly „Úvěry“.
  const claimed = new Set();
  const products = [...BRANCH_SALES_PRODUCTS].sort((a, b) => b.match.length - a.match.length);
  const salesByKey = {};
  products.forEach((prod) => {
    keys.forEach((k) => {
      const n = norm[k];
      if (claimed.has(k) || !n.includes(prod.match)) return;
      if (!n.includes("prodej") && !n.includes("kvintil") && !n.includes("objem")
        && !n.includes("ks") && n !== prod.match) return;
      claimed.add(k);
      const slot = n.includes("kvintil") ? "kvintil" : (n.includes("objem") ? "volume" : "count");
      salesByKey[prod.key] = salesByKey[prod.key] || { key: prod.key, label: prod.label };
      if (salesByKey[prod.key][slot] === undefined) {
        salesByKey[prod.key][slot] = branchNum(payload[k]);
        salesByKey[prod.key][`${slot}Header`] = k;
      }
    });
  });
  const sales = BRANCH_SALES_PRODUCTS.map((prod) => salesByKey[prod.key])
    .filter((x) => x && (x.count !== undefined || x.kvintil !== undefined));

  const mesto = text(pick((n) => n === "mesto"));
  const obvod = text(pick((n) => n.startsWith("obvod")));
  const ulice = text(pick((n) => n === "ulice"));
  const cp = text(pick((n) => n.startsWith("c popisne")));
  const co = text(pick((n) => n.startsWith("c orientacni")));
  const cislo = [cp, co].filter(Boolean).join("/");
  const address = [[ulice, cislo].filter(Boolean).join(" "),
    [mesto, obvod && obvod !== mesto ? obvod : null].filter(Boolean).join(" – ")]
    .filter(Boolean).join(", ");

  return {
    id: text(pick((n) => n === "id pobocky" || n === "branch id" || n === "id")),
    nazev: text(pick((n) => n.startsWith("nazev pobocky"))),
    region: text(pick((n) => n === "region")),
    regionFixed: text(pick((n) => n === "region fixed")),
    oblast: text(pick((n) => n === "oblast")),
    mesto, obvod, ulice, cisloPopisne: cp, cisloOrientacni: co, address,
    orp: text(pick((n) => n === "orp")),
    orpKod: text(pick((n) => n.startsWith("orp kod"))),
    krajskeMesto: text(pick((n) => n.includes("krajske") && n.includes("mesto"))),
    ruian: text(pick((n) => n.startsWith("ruian"))),
    rating: {
      r23: number(pick((n) => n === "rating 23")),
      r24: number(pick((n) => n === "rating 24")),
      r25: number(pick((n) => n === "rating 25")),
      r25text: text(pick((n) => n === "rating 25")),
      kvintil: number(pick((n) => n.includes("rating") && n.includes("kvintil"))),
      trend: text(pick((n) => n.includes("trend") && n.includes("rating"))),
      change: number(pick((n) => n.includes("zmena ratingu") && !n.includes("perc"))),
      changePerc: number(pick((n) => n.includes("zmena ratingu") && n.includes("perc"))),
      danger: text(pick((n) => n.includes("nebezpecna zona"))),
    },
    revenues,
    revenueLast: revenues.length ? revenues[revenues.length - 1] : null,
    revenueTrend: text(pick((n) => n.includes("trend") && n.includes("vynos"))),
    newRevenues,
    newRevenueLast: newRevenues.length ? newRevenues[newRevenues.length - 1] : null,
    newRevenueKvintil: number(pick((n) => n.startsWith("nove vynosy") && n.includes("kvintil"))),
    newRevenueChange: number(pick((n) => n.includes("zmena novych vynosu"))),
    salesTotal: number(pick((n) => n.includes("prodeje celkem"))),
    salesTotalHeader: pick((n) => n.includes("prodeje celkem")) || null,
    sales,
    raw: payload,
  };
}

// Nejlepší prodejní kategorie pobočky — podle počtu prodejů, při shodě podle
// kvintilu (1 = nejlepší pětina poboček).
function topBranchSales(fields, count = 4) {
  return (fields.sales || [])
    .filter((s) => branchNum(s.count) !== null && branchNum(s.count) > 0)
    .sort((a, b) => (branchNum(b.count) - branchNum(a.count))
      || ((branchNum(a.kvintil) ?? 9) - (branchNum(b.kvintil) ?? 9)))
    .slice(0, count);
}

async function handleBranchExportFile(file) {
  if (!requireDb()) return;
  const data = new Uint8Array(await file.arrayBuffer());
  const parsed = parseBranchExport(XLSX.read(data, { type: "array" }));
  const importedAt = nowIso();
  dbRun("DELETE FROM branch_export");
  const ins = db.prepare(`INSERT INTO branch_export
    (branch_id, branch_name, imported_at, source, payload) VALUES (?, ?, ?, ?, ?)`);
  parsed.branches.forEach((b) => {
    ins.run([b.branch_id, b.branch_name, importedAt, file.name, JSON.stringify(b.payload)]);
  });
  ins.free();
  await persistDatabase();
  return { branches: parsed.branches.length, columns: parsed.columns.length };
}

function branchExportInfo() {
  if (!db) return null;
  try {
    const row = dbAll(`SELECT COUNT(*) AS n, MAX(imported_at) AS imported_at, MAX(source) AS source
      FROM branch_export`)[0];
    return row && row.n ? row : null;
  } catch (e) { return null; }
}

function branchExportRowFor(pobockaId, pobockaNazev) {
  if (!db) return null;
  try {
    if (pobockaId !== null && pobockaId !== undefined && String(pobockaId).trim() !== "") {
      const byId = dbAll("SELECT * FROM branch_export WHERE branch_id = ?", [String(pobockaId).trim()])[0];
      if (byId) return byId;
    }
    if (!pobockaNazev) return null;
    return dbAll("SELECT * FROM branch_export WHERE LOWER(branch_name) = ?",
      [String(pobockaNazev).trim().toLowerCase()])[0] || null;
  } catch (e) { return null; }
}

// Model pro hlavičku PDF a kartu pobočky: rating, zařazení, adresa, výnosy
// a nejlepší prodeje. Když pobočka v exportu není, vrací null a hlavička se
// prostě nevykreslí.
function branchProfile(pobockaId, pobockaNazev) {
  const row = branchExportRowFor(pobockaId, pobockaNazev);
  if (!row) return null;
  let payload = {};
  try { payload = JSON.parse(row.payload || "{}"); } catch (e) { return null; }
  const fields = branchFields(payload);
  return {
    branchId: row.branch_id,
    branchName: row.branch_name || fields.nazev || "",
    importedAt: row.imported_at,
    source: row.source,
    fields,
    topSales: topBranchSales(fields),
  };
}

// Trend ratingu / výnosů: v exportu může být číslo i slovo — barva se hádá
// z obojího, ať je pill čitelný v aplikaci i v PDF.
function trendTone(value) {
  const n = branchNum(value);
  if (n !== null && String(value).trim() !== "") {
    if (n > 0) return "up";
    if (n < 0) return "down";
    return "flat";
  }
  const t = normHeader(value);
  if (!t) return "flat";
  if (/rost|up|zlep|vzest|leps/.test(t) || String(value).includes("↑")) return "up";
  if (/kles|down|zhors|pokles|horsi/.test(t) || String(value).includes("↓")) return "down";
  return "flat";
}

const TREND_COLORS = { up: "#0e9f6e", down: "#e02424", flat: "#6b7482" };
const TREND_ARROWS = { up: "▲", down: "▼", flat: "→" };

// Změna hodnoty mezi dvěma roky: znaménko, barva a případně i procentní změna
// z vedlejšího sloupce. Vrací null, když sloupec v exportu chybí.
function changeLabel(value, percValue) {
  const n = branchNum(value);
  const perc = branchNum(percValue);
  if (n === null && perc === null) return null;
  const base = n === null ? null : `${n > 0 ? "+" : ""}${fmtNumAuto(n)}`;
  const pct = perc === null ? null : `${perc > 0 ? "+" : ""}${fmtNumAuto(perc)} %`;
  const tone = trendTone(n !== null ? n : perc);
  return { tone, color: TREND_COLORS[tone], text: [base, pct && base ? `(${pct})` : pct].filter(Boolean).join(" ") };
}

function trendLabel(value) {
  const tone = trendTone(value);
  const raw = value === null || value === undefined || String(value).trim() === "" ? "—" : String(value).trim();
  return { tone, color: TREND_COLORS[tone], text: `${TREND_ARROWS[tone]} ${raw}` };
}

/* ------------- Karta pobočky v aplikaci (stejná data jako v PDF) ----------- */

function branchProfileHtml(profile, options = {}) {
  if (!profile) {
    return options.quiet ? "" : `<p class="muted">Pro tuto pobočku nejsou data z exportu poboček
      (<code>pobocky-export.xlsx</code>) — připojte ho v části „Dodatečná analytika“.</p>`;
  }
  const f = profile.fields;
  const rating = f.rating.r25text || "—";
  const ratingColor = quintileColor(f.rating.kvintil);
  const trend = trendLabel(f.rating.trend);
  // Změna ratingu se bere ze sloupce „Změna ratingu 25/24“ (v procentech je vedle
  // ve sloupci „Změna ratingu perc 25/24“).
  const change = changeLabel(f.rating.change, f.rating.changePerc);
  const kv = (q) => (branchNum(q) === null ? "" :
    ` <span class="bx-kv" style="background:${quintileColor(q)};">kvintil ${fmtPieces(branchNum(q))}</span>`);
  const salesHtml = profile.topSales.length
    ? profile.topSales.map((s) => `<li><strong>${esc(s.label)}</strong>
        ${fmtNum0(s.count)} prodejů${s.volume !== undefined && s.volume !== null
          ? ` · objem ${fmtNum0(s.volume)}` : ""}${kv(s.kvintil)}</li>`).join("")
    : `<li class="muted">Export neobsahuje počty prodejů.</li>`;

  return `<div class="bx-card ${options.compact ? "bx-compact" : ""}">
    <div class="bx-pills">
      <span class="bx-pill" style="background:${ratingColor};">Rating 25: ${esc(rating)}</span>
      ${change ? `<span class="bx-pill" style="background:${change.color};">Změna ratingu 25/24:
        ${esc(change.text)}</span>` : ""}
      <span class="bx-pill" style="background:${trend.color};">Trend ratingu 23–25: ${esc(trend.text)}</span>
      <span class="bx-pill" style="background:${quintileColor(f.newRevenueKvintil)};">Nové výnosy kvintil:
        ${branchNum(f.newRevenueKvintil) === null ? "—" : fmtPieces(branchNum(f.newRevenueKvintil))}</span>
      ${srcBadgeHtml("branch")}
    </div>
    <div class="bx-grid">
      <div><span class="muted">Region</span><strong>${esc(f.region || f.regionFixed || "—")}</strong></div>
      <div><span class="muted">Oblast</span><strong>${esc(f.oblast || "—")}</strong></div>
      <div><span class="muted">Adresa</span><strong>${esc(f.address || "—")}</strong></div>
      <div><span class="muted">Nové výnosy${f.newRevenueLast ? ` ${f.newRevenueLast.year}` : ""}</span>
        <strong>${f.newRevenueLast ? fmtNum0(f.newRevenueLast.value) : "—"}${kv(f.newRevenueKvintil)}
        ${branchNum(f.newRevenueChange) !== null
          ? `<span class="muted">(změna 25/24: ${fmtNumAuto(f.newRevenueChange)})</span>` : ""}</strong></div>
      <div><span class="muted">Výnosy${f.revenueLast ? ` ${f.revenueLast.year}` : ""}</span>
        <strong>${f.revenueLast ? fmtNum0(f.revenueLast.value) : "—"}
        ${f.revenueTrend ? `<span class="muted">(trend ${esc(f.revenueTrend)})</span>` : ""}</strong></div>
      <div><span class="muted">Prodeje celkem</span><strong>${fmtNum0(f.salesTotal)}</strong></div>
    </div>
    <div class="bx-sales">
      <span class="muted">Nejlepší obchody pobočky (podle počtu prodejů):</span>
      <ul>${salesHtml}</ul>
    </div>
    <p class="muted bx-note">Data z exportu poboček${profile.source ? ` (${esc(profile.source)})` : ""}${
      profile.importedAt ? `, import ${new Date(profile.importedAt).toLocaleString("cs-CZ")}` : ""}.
      Objem prodeje po kategoriích export obsahuje jen tehdy, je-li v něm sloupec „objem“ —
      jinak jsou peněžní hodnoty dostupné jako výnosy a nové výnosy.</p>
  </div>`;
}

/* ------- Porovnání zadaných FTE se skutečným stavem z exportu specialistů --- */
// Zadané FTE (checklist / manuální zadání) proti aktuální obsazenosti pobočky
// v `export_specialiste.xlsx`. Slouží ke kontrole vstupu — do PDF exportu se
// tato část záměrně netiskne.

function compareFteWithSpecialists(inputRows, pobockaId, pobockaNazev) {
  if (!db || !(inputRows || []).length) return null;
  const row = specialistRowFor(pobockaId, pobockaNazev);
  if (!row) return null;
  const actual = JSON.parse(row.payload || "{}");
  const known = positionSegmentMap();

  const map = {};   // "pozice" -> { pozice, segment, planned, actual }
  const put = (pozice, segment, key, value) => {
    const k = normalizePozice(pozice);
    if (!map[k]) map[k] = { pozice, segment: segment || "", planned: 0, actual: 0 };
    if (segment && !map[k].segment) map[k].segment = segment;
    map[k][key] += value;
  };
  inputRows.forEach((r) => put(r.pozice, r.segment, "planned", Number(r.fte) || 0));
  Object.entries(actual).forEach(([pozice, count]) => {
    const found = known[normalizePozice(pozice)];
    put(pozice, found ? found.segment : "", "actual", Number(count) || 0);
  });

  const rows = Object.values(map).map((x) => ({ ...x, diff: round1(x.planned - x.actual) }))
    .sort((a, b) => (a.segment || "").localeCompare(b.segment || "", "cs")
      || a.pozice.localeCompare(b.pozice, "cs"));
  const totals = rows.reduce((acc, x) => ({
    planned: acc.planned + x.planned, actual: acc.actual + x.actual,
  }), { planned: 0, actual: 0 });
  return {
    branch: { id: row.branch_id, nazev: row.branch_name, importedAt: row.imported_at },
    rows,
    totals: { ...totals, diff: round1(totals.planned - totals.actual) },
    onlyPlanned: rows.filter((x) => x.planned > 0 && x.actual === 0),
    onlyActual: rows.filter((x) => x.actual > 0 && x.planned === 0),
    changed: rows.filter((x) => x.planned > 0 && x.actual > 0 && Math.abs(x.diff) > 0.001),
  };
}

function diffCellHtml(diff) {
  if (Math.abs(diff) < 0.001) return `<span class="cmp-same">0</span>`;
  return `<span class="${diff > 0 ? "cmp-plus" : "cmp-minus"}">${diff > 0 ? "+" : ""}${fmt1(diff)}</span>`;
}

function renderFteComparisonHtml(cmp, options = {}) {
  if (!cmp) {
    return options.quiet ? "" : `<details class="cmp-box"><summary>Porovnání se skutečným stavem
      ${srcBadgeHtml("hr")}</summary>
      <p class="muted">Pro tuto pobočku nejsou data v exportu specialistů. Načtěte
        <code>export_specialiste.xlsx</code> v části „Dodatečná analytika“ nebo v manuálním zadání.</p></details>`;
  }
  const rowHtml = cmp.rows.map((r) => `<tr class="${Math.abs(r.diff) > 0.001 ? "cmp-diff-row" : ""}">
    <td>${r.segment ? segmentBadgeHtml(r.segment) : '<span class="muted">—</span>'}</td>
    <td>${esc(r.pozice)}</td>
    <td class="num">${r.planned ? fmt1(r.planned) : '<span class="muted">—</span>'}</td>
    <td class="num">${r.actual ? fmt1(r.actual) : '<span class="muted">—</span>'}</td>
    <td class="num">${diffCellHtml(r.diff)}</td>
  </tr>`).join("");

  const verdict = Math.abs(cmp.totals.diff) < 0.001
    ? `Zadané FTE se skutečným stavem <strong>souhlasí</strong> (${fmt1(cmp.totals.planned)} FTE).`
    : `Zadáno <strong>${fmt1(cmp.totals.planned)} FTE</strong>, aktuální stav dle exportu`
      + ` <strong>${fmt1(cmp.totals.actual)} FTE</strong> — rozdíl`
      + ` <strong>${cmp.totals.diff > 0 ? "+" : ""}${fmt1(cmp.totals.diff)} FTE</strong>`
      + `${cmp.totals.diff > 0 ? " (kalkulace počítá s více lidmi, než je dnes na pobočce)"
        : " (kalkulace počítá s méně lidmi, než je dnes na pobočce)"}.`;

  return `<details class="cmp-box"${options.open ? " open" : ""}>
    <summary>Porovnání zadaných FTE se skutečným stavem ${srcBadgeHtml("hr")}
      <span class="muted">${esc(cmp.branch.nazev || "")} (ID ${esc(cmp.branch.id)})</span></summary>
    <p>${verdict}</p>
    <div class="table-wrap"><table class="visitor-table">
      <thead><tr><th>Segment</th><th>Pozice</th><th>Zadáno (FTE)</th><th>Aktuální stav</th><th>Rozdíl</th></tr></thead>
      <tbody>${rowHtml}
        <tr class="total-row"><td>Celkem</td><td></td>
          <td class="num"><strong>${fmt1(cmp.totals.planned)}</strong></td>
          <td class="num"><strong>${fmt1(cmp.totals.actual)}</strong></td>
          <td class="num"><strong>${diffCellHtml(cmp.totals.diff)}</strong></td></tr>
      </tbody></table></div>
    <p class="muted">${cmp.changed.length} pozic se počtem navíc/méně ·
      ${cmp.onlyPlanned.length} jen v kalkulaci · ${cmp.onlyActual.length} jen v aktuálním stavu.
      Aktuální stav je z exportu specialistů${cmp.branch.importedAt
        ? ` (import ${new Date(cmp.branch.importedAt).toLocaleString("cs-CZ")})` : ""}.
      <strong>Do PDF exportu se toto porovnání netiskne.</strong></p>
  </details>`;
}

/* ------- Porovnání zadaných FTE se skutečným stavem — konec sekce ---------- */

/* --------------------------- Směnový režim pobočky -------------------------- */
// Když je otevírací doba pobočky (např. 70 h/týden v obchodním centru) výrazně
// vyšší než doba vytížení jedné pozice (např. 40 h/týden), nejsou všichni
// zaměstnanci na pobočce naráz — točí se na směny. Kalkulace to zvládá už svým
// vzorcem (dělí se otevírací dobou), takže na jedno pracovní místo pak vychází
// méně WPL na FTE. Aplikace tento stav pojmenuje, ukáže „směnový faktor“
// a nechá ho u checklistu potvrdit zaškrtávátkem.

const SHIFT_TOLERANCE_H = 2;   // menší rozdíl je jen zaokrouhlení, ne směny

// Uložený příznak u nahrávky checklistu; když chybí (starší databáze), pozná se
// z rozdílu otevírací doby a doby vytížení.
function shiftModeOfLoad(loadKey, openHours, loadHours) {
  if (db && loadKey) {
    try {
      const row = dbAll("SELECT shift_mode FROM excel_loads WHERE load_key = ? LIMIT 1", [loadKey])[0];
      if (row && row.shift_mode !== null && row.shift_mode !== undefined) return !!row.shift_mode;
    } catch (e) { /* starší databáze bez sloupce */ }
  }
  return isShiftMode(openHours, loadHours);
}

function isShiftMode(openHours, loadHours) {
  const open = Number(openHours) || 0;
  const load = Number(loadHours) || 0;
  return open > 0 && load > 0 && open - load > SHIFT_TOLERANCE_H;
}

// Kolik FTE je potřeba na pokrytí jednoho pracovního místa po celou otevírací
// dobu (70 ÷ 40 = 1,75) a jaká část otevírací doby je pokrytá jednou pozicí.
function shiftFactor(openHours, loadHours) {
  const open = Number(openHours) || 0;
  const load = Number(loadHours) || 0;
  if (!open || !load) return null;
  return { open, load, ftePerSeat: open / load, coverage: load / open };
}

function shiftBadgeHtml(on) {
  return on ? `<span class="badge shift" title="Otevírací doba je vyšší než doba vytížení pozice —
    zaměstnanci se na pobočce střídají na směny.">🔁 Směnový režim</span>` : "";
}

// Vysvětlující řádek pod formulářem i u výsledku kalkulace.
function shiftInfoHtml(openHours, loadHours, on) {
  const f = shiftFactor(openHours, loadHours);
  if (!f) return "";
  const detected = isShiftMode(openHours, loadHours);
  if (!detected && !on) {
    return `<p class="muted">Otevírací doba ${fmt1(f.open)} h/týden = doba vytížení pozice`
      + ` ${fmt1(f.load)} h/týden — všichni jsou na pobočce ve stejnou dobu (bez směn).</p>`;
  }
  return `<p class="${on ? "shift-note" : "shift-note warn"}">${on ? "🔁" : "⚠️"}
    Otevírací doba <strong>${fmt1(f.open)} h/týden</strong> je vyšší než doba vytížení jedné pozice
    <strong>${fmt1(f.load)} h/týden</strong> — jedna pozice pokryje jen
    <strong>${Math.round(f.coverage * 100)} %</strong> otevírací doby, na plné pokrytí jednoho
    pracovního místa je potřeba <strong>${fmt1(f.ftePerSeat)} FTE</strong>.
    ${on ? "Checklist je označený jako směnový režim — kalkulace tak počítá s tím, že se lidé střídají."
      : "Pokud se na pobočce střídají směny, zaškrtněte „Pobočka se směnovým režimem“."}</p>`;
}

/* --------------------------------- Wizard ----------------------------------- */
// Průvodce "Nový výpočet" má 4 kroky: 1) volba zdroje dat, 2) zadání pozic
// (Excel nebo manuálně), 3) výsledek, 4) sestavení layoutu. Kroky 3 a 4 se
// zobrazí společně po úspěšném spočítání kalkulace. Díky tomu po dokončení
// kalkulace nezůstává nahoře viditelný formulář pro zadání dalšího vstupu —
// to byl hlavní zdroj zmatku v předchozí verzi.

let wizardStep = 1;

function updateStepper() {
  document.querySelectorAll("#stepper .step").forEach((el) => {
    const n = Number(el.dataset.step);
    el.classList.toggle("done", n < wizardStep);
    el.classList.toggle("active", n === wizardStep);
  });
  document.getElementById("newCalcRow").style.display = wizardStep >= 3 ? "flex" : "none";
}

function resetInputForms() {
  document.getElementById("calcReason").value = "";
  document.getElementById("manualRowsTbody").innerHTML = "";
  document.getElementById("manualPobockaName").value = "";
  document.getElementById("manualPobockaId").value = "";
  document.getElementById("manualRegionInfo").textContent = "";
  document.getElementById("manualOtevDoba").value = "40";
  document.getElementById("manualVytezeniWpl").value = "40";
  document.getElementById("excelInput").value = "";
  document.getElementById("excelMsgs").innerHTML = "";
  document.getElementById("excelPreview").innerHTML = "";
}

function goToWizardStep(n) {
  wizardStep = n;
  document.getElementById("stepSource").style.display = n === 1 ? "block" : "none";
  document.getElementById("stepSourceSummary").style.display = n >= 2 ? "block" : "none";
  document.getElementById("stepInput").style.display = n === 2 ? "block" : "none";
  if (n === 1) resetInputForms();
  if (n < 3) {
    document.getElementById("resultsPanel").style.display = "none";
    document.getElementById("layoutPanel").style.display = "none";
    document.getElementById("calcFlow").style.display = "none";
  }
  updateStepper();
}

function chooseSource(mode) {
  document.getElementById("sourceSummaryText").textContent = mode === "excel" ? "Excel checklist" : "Manuální zadání";
  document.getElementById("modeExcel").style.display = mode === "excel" ? "block" : "none";
  document.getElementById("modeManual").style.display = mode === "manual" ? "block" : "none";
  if (mode === "manual") {
    renderSpecialistInfo();
    const open = toNumberOrNull(document.getElementById("manualOtevDoba").value) ?? 0;
    const load = toNumberOrNull(document.getElementById("manualVytezeniWpl").value) ?? 0;
    document.getElementById("manualShiftInfo").innerHTML =
      shiftInfoHtml(open, load, document.getElementById("manualShiftMode").checked);
  }
  if (mode === "manual" && document.getElementById("manualRowsTbody").children.length === 0) {
    addManualRow();
  }
  goToWizardStep(2);
}

async function handleCommitManual() {
  const msgsEl = document.getElementById("excelMsgs");
  msgsEl.innerHTML = "";
  document.getElementById("excelPreview").innerHTML = "";
  document.getElementById("resultsPanel").style.display = "none";
  document.getElementById("layoutPanel").style.display = "none";
  document.getElementById("calcFlow").style.display = "none";
  if (!requireDb()) return;

  const pobocka_nazev = document.getElementById("manualPobockaName").value.trim();
  const pobocka_id = document.getElementById("manualPobockaId").value.trim();
  const oteviraci_doba = toNumberOrNull(document.getElementById("manualOtevDoba").value) ?? 40;
  const doba_vytezeni_wpl = document.getElementById("manualVytezeniWpl").value;

  if (!pobocka_nazev || !pobocka_id) {
    msgsEl.innerHTML = `<div class="msg err">Zadejte název i ID pobočky.</div>`;
    return;
  }

  const rows = [];
  document.querySelectorAll("#manualRowsTbody .manual-row").forEach((tr) => {
    const row = buildLoadRow(
      tr.querySelector(".manual-segment").value,
      tr.querySelector(".manual-pozice").value,
      tr.querySelector(".manual-fte").value,
      tr.querySelector(".manual-wpl").value,
      doba_vytezeni_wpl,
    );
    if (row) rows.push(row);
  });
  if (!rows.length) {
    msgsEl.innerHTML = `<div class="msg err">Zadejte alespoň jednu pozici s FTE &gt; 0.</div>`;
    return;
  }

  const shiftMode = document.getElementById("manualShiftMode").checked;
  const committed = await commitLoad(pobocka_id, pobocka_nazev, oteviraci_doba, rows, shiftMode);
  committed.doba_vytezeni_wpl = toNumberOrNull(doba_vytezeni_wpl) ?? oteviraci_doba;
  msgsEl.innerHTML = `<div class="msg ok">Kalkulace vytvořena manuálně: <strong>${esc(pobocka_nazev)}</strong>
    (ID ${esc(pobocka_id)}), ${rows.length} pozic s FTE &gt; 0.`
    + `${shiftMode ? " Pobočka je označená jako <strong>směnový režim</strong>." : ""}</div>`;
  renderExcelPreview(committed);
}

/* ------------------------------- Kalkulace -------------------------------- */

function runCalculation() {
  if (!pendingLoad) return;
  const { load_key, oteviraci_doba } = pendingLoad;

  const duvod = document.getElementById("calcReason").value;
  if (!duvod) { toast("Vyberte důvod kalkulace.", "err"); return; }

  // `source_branch` = řádek převzatý ze spádové pobočky; do výpočtu vstupuje
  // stejně jako vlastní pozice, jen se dá odlišit ve výpisech.
  const rows = dbAll(`SELECT segment, pozice, fte, wpl_load, source_branch FROM excel_loads
    WHERE load_key = ?`, [load_key]);
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
  const refVersionId = ensureRefVersionUpToDate();
  const positionListStr = (list) => Object.entries(list).map(([poz, ft]) =>
    `${poz} (${Number.isInteger(ft) ? ft : ft.toFixed(1)})`).join(", ");

  const insCalc = db.prepare(`INSERT INTO calculations
    (load_key, calculation_key, segment, total_positions, position_list,
     service_zone, meeting_zone, backoffice_zone, office_room, created_at, ref_version_id, status, duvod)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

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
      row.service_zone, row.meeting_zone, row.backoffice_zone, row.office_room, createdAt, refVersionId, "rozpracovana", duvod]);
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
    celkemRow.service_zone, celkemRow.meeting_zone, celkemRow.backoffice_zone, celkemRow.office_room, createdAt, refVersionId, "rozpracovana", duvod]);
  insCalc.free();

  const inputRows = rows.map((r) => ({ segment: r.segment, pozice: r.pozice, fte: r.fte, wpl_load: r.wpl_load,
    source_branch: r.source_branch || null }));
  const stats = computeCalculationStats({ rows: resultRows, celkem: celkemRow, inputRows });
  persistCalculationStats(calculation_key, load_key, stats, createdAt);

  // Data z reportu návštěvnosti se ke kalkulaci uloží jako snapshot — kalkulace
  // tak zůstane reprodukovatelná i po importu novějšího reportu.
  saveVisitorSnapshot(calculation_key, getVisitorData(pendingLoad.pobocka_id, pendingLoad.pobocka_nazev));

  persistDatabase();

  // Doba vytížení pozice (u ne-cestovních řádků je u všech stejná) a příznak
  // směnového režimu putují do výsledku, aby se daly ukázat i vysvětlit.
  const loadHours = (inputRows.find((r) => String(r.segment).trim().toUpperCase() !== "CESTOVNÍ") || {}).wpl_load
    ?? oteviraci_doba;
  const shiftMode = shiftModeOfLoad(load_key, oteviraci_doba, loadHours);
  renderResults({ calculation_key, load_key, createdAt, rows: resultRows, celkem: celkemRow, warnings, inputRows,
    refVersionId, pobocka_id: pendingLoad.pobocka_id, pobocka_nazev: pendingLoad.pobocka_nazev, oteviraci_doba,
    doba_vytezeni_wpl: loadHours, shiftMode, duvod });
  goToWizardStep(4);
  toast("Kalkulace byla spočítána a uložena do historie.", "ok");
  renderHistoryList();
}

function round1(n) { return Math.round(n * 10) / 10; }

function renderResults(result) {
  const panel = document.getElementById("resultsPanel");
  panel.style.display = "block";
  document.getElementById("calcFlow").style.display = "flex";
  const warnHtml = result.warnings.length
    ? `<div class="msg warn">${result.warnings.map(esc).join("<br>")}</div>` : "";

  const rowsHtml = result.rows.map((r) => resultRowHtml(r)).join("") + resultRowHtml(result.celkem, true);
  const stats = computeCalculationStats(result);
  const status = getCalculationStatus(result.calculation_key);
  const visitor = getVisitorForCalculation(result.calculation_key, result.pobocka_id, result.pobocka_nazev);

  document.getElementById("resultsArea").innerHTML = `
    ${warnHtml}
    ${srcLegendHtml()}
    <p class="muted">Calculation key: <code>${esc(result.calculation_key)}</code> · Load key: <code>${esc(result.load_key)}</code></p>
    ${result.duvod ? `<p class="muted">Důvod kalkulace: <strong>${esc(result.duvod)}</strong></p>` : ""}
    <div class="status-row">${statusBadgeHtml(status)}${shiftBadgeHtml(result.shiftMode)}
      <span class="muted">stav se přepíná na konci, v části „Výstup a sestava“</span></div>
    ${shiftInfoHtml(result.oteviraci_doba, result.doba_vytezeni_wpl, !!result.shiftMode)}
    ${branchProfileHtml(branchProfile(result.pobocka_id, result.pobocka_nazev), { quiet: true })}
    <h3>Výsledek kalkulace ${srcBadgeHtml("calc")}${calcResultHelpHtml(result)}</h3>
    <div class="table-wrap src-box-calc">
      <table>
        <thead><tr><th>Segment</th><th>FTE celkem</th><th>Pozice (FTE)</th>
          <th>Service zone</th><th>Meeting zone</th><th>Backoffice zone</th><th>Office room</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    ${renderFteComparisonHtml(compareFteWithSpecialists(
      (result.inputRows || []).filter((r) => !r.source_branch), result.pobocka_id, result.pobocka_nazev),
      { quiet: true })}
    ${catchmentSummaryHtml(result.load_key, result.pobocka_id, result.pobocka_nazev)}
    ${refVersionDetailsHtml(result.refVersionId)}
    ${renderStatsSection(stats)}
    ${renderYearCapacityHtml(computeYearCapacity({ stats, visitor, calcResult: result }))}
    ${noAbsenceVariantHtml(result)}
    ${visitor ? renderVisitorSectionHtml(visitor, { stats, inputRows: result.inputRows })
      : renderVisitorMissingHtml(result.pobocka_nazev, result.pobocka_id)}`;

  document.getElementById("layoutPanel").style.display = "block";
  const meta = {
    calculation_key: result.calculation_key, pobocka_id: result.pobocka_id, pobocka_nazev: result.pobocka_nazev,
    stats, calcResult: result, pdfOptionsSuffix: "",
  };
  renderLayoutSection("layoutArea", result.rows, meta);

  // Výstup a sestava jsou poslední blok — stejné pořadí jako v timeline vlevo.
  document.getElementById("outputPanel").style.display = "block";
  renderOutputSection("outputArea", "", {
    result, stats, visitor, meta, segmentRows: result.rows,
    onStatusChange: () => { renderResults(result); renderHistoryList(); },
  });

  renderCalcTimeline(result);
}

/* ------------------- Výstup a sestava (poslední blok) ---------------------- */
// Jedno místo pro všechno generování: co se má vygenerovat, v jakém rozsahu,
// kopírování do schránky a potvrzení kalkulace.
// Kontext pro překreslení boxu (po uložení layoutu se mění dostupný rozsah).
const outputSectionCtx = {};

function refreshOutputSection(suffix) {
  const ctx = outputSectionCtx[suffix === undefined ? "" : suffix];
  if (!ctx) return;
  // Poznámka a vybraný rozsah se překreslením neztratí.
  const noteEl = document.getElementById(`pdfNote${ctx.suffix}`);
  const scopeEl = document.querySelector(`input[name="pdfScope${ctx.suffix}"]:checked`);
  const keep = { note: noteEl ? noteEl.value : "", scope: scopeEl ? scopeEl.value : null };
  renderOutputSection(ctx.containerId, ctx.suffix, ctx, keep);
}

function renderOutputSection(containerId, suffix, ctx, keep) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const { result, stats, visitor, meta, segmentRows, onStatusChange } = ctx;
  outputSectionCtx[suffix] = { containerId, suffix, result, stats, visitor, meta, segmentRows, onStatusChange };
  const status = getCalculationStatus(result.calculation_key);
  const layoutRows = getExistingLayout(result.calculation_key);

  container.innerHTML = pdfOptionsBoxHtml(suffix, {
    hasVisitor: !!visitor, hasLayout: layoutRows.length > 0, status,
  });

  if (keep) {
    const noteEl = container.querySelector(`#pdfNote${suffix}`);
    if (noteEl && keep.note) noteEl.value = keep.note;
    if (keep.scope) {
      const radio = container.querySelector(`input[name="pdfScope${suffix}"][value="${keep.scope}"]`);
      if (radio && !radio.disabled) radio.checked = true;
    }
  }

  container.querySelector(`#btnExportPdf${suffix}`).addEventListener("click", () => {
    exportPdfByScope(result, layoutRows, meta, segmentRows, collectPdfOptions(suffix));
  });
  container.querySelector(`#btnCopyResult${suffix}`).addEventListener("click", () => copyResultToClipboard(result, stats));
  const btnFurniture = container.querySelector(`#btnCopyFurniture${suffix}`);
  if (layoutRows.length) {
    btnFurniture.addEventListener("click", () => copyFurnitureToClipboard(layoutRows, result));
  } else {
    btnFurniture.disabled = true;
    btnFurniture.title = "Nejprve uložte layout.";
  }
  container.querySelector(`#btnToggleStatus${suffix}`).addEventListener("click", () => {
    setCalculationStatus(result.calculation_key, status === "potvrzena" ? "rozpracovana" : "potvrzena");
    if (onStatusChange) onStatusChange();
  });
}

/* ------------------ Vertikální timeline vedle kalkulace -------------------- */
// Levý pruh vedle výsledku kalkulace: v jakém bodě zpracování se uživatel
// nachází — kalkulace → analýza a detaily → sestavení layoutu → výstup.
// Kliknutím se odroluje na příslušnou část, aktivní bod se zvýrazňuje podle
// toho, co je zrovna vidět.

let calcTimelineObserver = null;

function calcTimelineSteps(result) {
  const layoutSaved = result && result.calculation_key
    ? getExistingLayout(result.calculation_key).length > 0 : false;
  const hasVisitor = !!document.querySelector("#resultsArea .visitor-section .visitor-cards");
  return [
    { key: "vysledek", title: "Kalkulace a výsledek",
      note: `${fmt1(result.celkem.total_positions)} FTE → ${fmt1(ZONES.reduce((a, z) => a + (result.celkem[z] || 0), 0))} WPL`,
      target: "#resultsArea", state: "done" },
    { key: "ukazatele", title: "Klíčové ukazatele a kapacita",
      note: "formát pobočky, benchmark, roční kapacita",
      target: "#resultsArea .ycap-box", fallback: "#resultsArea .kpi-table", state: "done" },
    { key: "navstevnost", title: "Analýza návštěvnosti",
      note: hasVisitor ? "doporučení prostor, Monte Carlo" : "bez reportu návštěvnosti",
      target: "#resultsArea .visitor-section", state: hasVisitor ? "done" : "todo",
      disabled: !document.querySelector("#resultsArea .visitor-section") },
    { key: "layout", title: "Sestavení layoutu",
      note: layoutSaved ? "layout uložený" : "vyberte nábytek a uložte",
      target: "#layoutPanel", state: layoutSaved ? "done" : "current" },
    { key: "kapacita", title: "Kapacitní shrnutí",
      note: "stačí to na špičku?",
      target: "#layoutArea .cap-box", state: layoutSaved ? "done" : "todo" },
    { key: "vystup", title: "Výstup a sestava",
      note: "co se vygeneruje, kopírování, potvrzení",
      target: "#outputArea .pdf-box", fallback: "#outputPanel", state: layoutSaved ? "current" : "todo" },
  ];
}

function renderCalcTimeline(result) {
  const el = document.getElementById("calcTimeline");
  if (!el || !result) return;
  const steps = calcTimelineSteps(result);
  el.innerHTML = `<h3>Postup</h3>${steps.map((st, i) => `
    <button type="button" class="ctl-item ${st.state}${st.disabled ? " disabled" : ""}"
      data-target="${esc(st.target)}"${st.fallback ? ` data-fallback="${esc(st.fallback)}"` : ""}
      ${st.disabled ? "disabled" : ""}>
      <span class="ctl-title">${i + 1}. ${esc(st.title)}</span>
      <span class="ctl-note">${esc(st.note)}</span>
    </button>`).join("")}`;

  el.querySelectorAll(".ctl-item:not(.disabled)").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.querySelector(btn.dataset.target)
        || (btn.dataset.fallback ? document.querySelector(btn.dataset.fallback) : null);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // Zvýraznění bodu, který je zrovna vidět.
  if (calcTimelineObserver) calcTimelineObserver.disconnect();
  const watched = [];
  el.querySelectorAll(".ctl-item").forEach((btn) => {
    const target = document.querySelector(btn.dataset.target)
      || (btn.dataset.fallback ? document.querySelector(btn.dataset.fallback) : null);
    if (target) watched.push([target, btn]);
  });
  if (!watched.length || typeof IntersectionObserver !== "function") return;
  calcTimelineObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const pair = watched.find(([t]) => t === entry.target);
      if (!pair) return;
      if (entry.isIntersecting) {
        el.querySelectorAll(".ctl-item.active").forEach((b) => b.classList.remove("active"));
        pair[1].classList.add("active");
      }
    });
  }, { rootMargin: "-20% 0px -65% 0px" });
  watched.forEach(([target]) => calcTimelineObserver.observe(target));
}

/* ------------- Kopírování výsledku do schránky (MS Teams apod.) ------------- */
// MS Teams (a Outlook, Word, Excel…) při vložení ze schránky čte flavour
// "text/html" — a protože si nechává jen inline styly (class/CSS ze stránky
// zahodí), sestavuje se tabulka s barvami a rámečky napsanými přímo v atributu
// style. Do schránky se vkládá i "text/plain" (tabulátory) jako záloha pro
// aplikace, které HTML neberou.
function buildResultClipboardHtml(result, stats) {
  const TD = "border:1px solid #c9d2de; padding:5px 9px; font-size:12px;";
  const TH = `${TD} background:#2770f0; color:#ffffff; font-weight:700; text-align:left;`;
  const num = "text-align:right; white-space:nowrap;";

  const headers = ["Segment", "FTE celkem", "Service zone", "Meeting zone", "Backoffice zone", "Office room"];
  const headHtml = headers.map((h, i) => `<th style="${TH}${i ? num : ""}">${esc(h)}</th>`).join("");

  const rowHtml = (r, isTotal) => {
    const base = isTotal ? `${TD} background:#eafcef; font-weight:700;` : TD;
    const color = isTotal ? null : getSegmentMeta(r.segment).color;
    const first = isTotal
      ? `<td style="${base}">${esc(r.segment)}</td>`
      : `<td style="${base} color:${color}; font-weight:700;">${esc(r.segment)}</td>`;
    return `<tr>${first}` + [r.total_positions, r.service_zone, r.meeting_zone, r.backoffice_zone, r.office_room]
      .map((v) => `<td style="${base}${num}">${fmt1(v)}</td>`).join("") + `</tr>`;
  };

  const infoLine = [
    `<strong>${esc(result.pobocka_nazev || "")}</strong> (ID ${esc(result.pobocka_id || "")})`,
    result.duvod ? `důvod: ${esc(result.duvod)}` : null,
    `otevírací doba ${esc(result.oteviraci_doba)} h/týden`,
    `${new Date(result.createdAt).toLocaleString("cs-CZ")}`,
  ].filter(Boolean).join(" · ");

  // Doporučení prostor z reportu návštěvnosti se do schránky přidá jen tehdy,
  // když jsou pro pobočku data k dispozici.
  const visitor = getVisitorForCalculation(result.calculation_key, result.pobocka_id, result.pobocka_nazev);
  const visitorRooms = visitor ? computeVisitorMetrics(visitor).rooms : null;

  const kpi = [
    ["Stanovený formát pobočky", esc(stats.formatTyp)],
    ["Doporučený počet fasttracků na hale", String(stats.recommendedFasttracks)],
    ["Doporučený počet židlí v čekací zóně", String(stats.recommendedChairs)],
    ["Potřebná plocha (WPL × 25 m²)", `${stats.requiredAreaM2.toFixed(1)} m²`],
    ["Poměr WPL / FTE", stats.wplFteRatio === null ? "—" : `${stats.wplFteRatio.toFixed(1)} %`],
    ["Podíl Backoffice zóny", stats.backofficePct === null ? "—" : `${stats.backofficePct.toFixed(1)} %`],
    ["Podíl míst pro jednání s klientem", stats.meetingPct === null ? "—" : `${stats.meetingPct.toFixed(1)} %`],
    ...(visitorRooms ? [
      ["Doporučené zasedací místnosti (návštěvnost, P95)", String(visitorRooms.meeting_rooms)],
      ["Doporučená servisní místa (návštěvnost, P95)", String(visitorRooms.service_desks)],
    ] : []),
  ].map(([k, v]) => `<tr><td style="${TD}">${k}</td><td style="${TD}${num}">${v}</td></tr>`).join("");

  return `<div style="font-family:Segoe UI,Arial,sans-serif; color:#1c2530;">
    <p style="font-size:15px; font-weight:700; margin:0 0 4px;">Kalkulace FTE → WPL</p>
    <p style="font-size:12px; margin:0 0 10px;">${infoLine}</p>
    <table style="border-collapse:collapse;" cellspacing="0" cellpadding="0">
      <thead><tr>${headHtml}</tr></thead>
      <tbody>${result.rows.map((r) => rowHtml(r, false)).join("")}${rowHtml(result.celkem, true)}</tbody>
    </table>
    <p style="font-size:13px; font-weight:700; margin:14px 0 4px;">Klíčové ukazatele</p>
    <table style="border-collapse:collapse;" cellspacing="0" cellpadding="0"><tbody>${kpi}</tbody></table>
  </div>`;
}

function buildResultClipboardText(result, stats) {
  const line = (cells) => cells.join("\t");
  const out = [
    "Kalkulace FTE → WPL",
    `${result.pobocka_nazev || ""} (ID ${result.pobocka_id || ""})${result.duvod ? ` · důvod: ${result.duvod}` : ""}`,
    "",
    line(["Segment", "FTE celkem", "Service zone", "Meeting zone", "Backoffice zone", "Office room"]),
  ];
  [...result.rows, result.celkem].forEach((r) => out.push(line([r.segment, fmt1(r.total_positions),
    fmt1(r.service_zone), fmt1(r.meeting_zone), fmt1(r.backoffice_zone), fmt1(r.office_room)])));
  out.push("", "Klíčové ukazatele");
  out.push(line(["Stanovený formát pobočky", stats.formatTyp]));
  out.push(line(["Doporučený počet fasttracků na hale", String(stats.recommendedFasttracks)]));
  out.push(line(["Doporučený počet židlí v čekací zóně", String(stats.recommendedChairs)]));
  out.push(line(["Potřebná plocha (WPL × 25 m²)", `${stats.requiredAreaM2.toFixed(1)} m²`]));
  if (stats.wplFteRatio !== null) out.push(line(["Poměr WPL / FTE", `${stats.wplFteRatio.toFixed(1)} %`]));
  if (stats.backofficePct !== null) out.push(line(["Podíl Backoffice zóny", `${stats.backofficePct.toFixed(1)} %`]));
  if (stats.meetingPct !== null) out.push(line(["Podíl míst pro jednání s klientem", `${stats.meetingPct.toFixed(1)} %`]));
  return out.join("\n");
}

// Zkopíruje do schránky HTML i čistý text současně (Teams/Outlook/Word si
// vezmou HTML, ostatní text). Používá se pro výsledek kalkulace i pro přehled
// nábytku z layoutu.
async function copyToClipboardBoth(html, text, okMsg) {
  // Preferovaná cesta: asynchronní Clipboard API s oběma formáty současně.
  try {
    if (navigator.clipboard && typeof window.ClipboardItem === "function") {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
      toast(okMsg, "ok");
      return true;
    }
  } catch (e) {
    console.warn("Clipboard API selhalo, zkouším execCommand:", e);
  }

  // Záloha pro prohlížeče/kontexty bez Clipboard API: vybere skrytý prvek
  // s HTML obsahem a nechá ho zkopírovat přes execCommand („copy“ vybraného
  // HTML zachová formátování).
  try {
    const holder = document.createElement("div");
    holder.setAttribute("contenteditable", "true");
    holder.style.cssText = "position:fixed; left:-9999px; top:0; white-space:normal;";
    holder.innerHTML = html;
    document.body.appendChild(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand("copy");
    sel.removeAllRanges();
    holder.remove();
    if (ok) { toast(okMsg, "ok"); return true; }
    throw new Error("execCommand('copy') vrátil false");
  } catch (e) {
    console.error(e);
    toast("Kopírování do schránky se nezdařilo: " + e.message, "err");
    return false;
  }
}

function copyResultToClipboard(result, stats) {
  return copyToClipboardBoth(buildResultClipboardHtml(result, stats),
    buildResultClipboardText(result, stats),
    "Výsledek zkopírován — vložte do Teams přes Ctrl+V.");
}

// Přehled nábytku po segmentech a zónách do schránky — formátovaná tabulka
// pro Teams/Outlook/Word i varianta v čistém textu.
function buildFurnitureClipboardHtml(layoutRows, result) {
  const TD = "border:1px solid #c9d2de; padding:5px 9px; font-size:12px;";
  const TH = `${TD} background:#2770f0; color:#ffffff; font-weight:700; text-align:left;`;
  const num = "text-align:right; white-space:nowrap;";
  const bySeg = {};
  const order = [];
  layoutRows.forEach((r) => {
    if (!bySeg[r.segment]) { bySeg[r.segment] = []; order.push(r.segment); }
    bySeg[r.segment].push(r);
  });
  const rowsHtml = order.map((segment) => {
    const items = bySeg[segment];
    const pieces = items.reduce((a, r) => a + (r.piece_count || 0), 0);
    const wpl = items.reduce((a, r) => a + (r.wpl_assigned || 0), 0);
    return items.map((r, i) => `<tr>
        ${i === 0 ? `<td style="${TD} font-weight:700;" rowspan="${items.length}">${esc(segment)}</td>` : ""}
        <td style="${TD}">${esc(ZONE_LABELS[r.zone] || r.zone)}</td>
        <td style="${TD}">${esc(r.furniture)}</td>
        <td style="${TD}${num}">${fmtPieces(r.piece_count)}</td>
        <td style="${TD}${num}">${fmt1(r.wpl_assigned)}</td></tr>`).join("")
      + `<tr><td style="${TD} background:#eef3fb; font-weight:700;" colspan="3">Celkem ${esc(segment)}</td>
        <td style="${TD}${num} background:#eef3fb; font-weight:700;">${fmtPieces(pieces)}</td>
        <td style="${TD}${num} background:#eef3fb; font-weight:700;">${fmt1(wpl)}</td></tr>`;
  }).join("");
  const totalPieces = layoutRows.reduce((a, r) => a + (r.piece_count || 0), 0);
  const totalWpl = layoutRows.reduce((a, r) => a + (r.wpl_assigned || 0), 0);

  return `<div style="font-family:Segoe UI,Arial,sans-serif; color:#1c2530;">
    <p style="font-size:15px; font-weight:700; margin:0 0 4px;">Nábytek po segmentech a zónách</p>
    <p style="font-size:12px; margin:0 0 10px;"><strong>${esc(result.pobocka_nazev || "")}</strong>
      (ID ${esc(result.pobocka_id || "")}) · ${new Date().toLocaleString("cs-CZ")}</p>
    <table style="border-collapse:collapse;" cellspacing="0" cellpadding="0">
      <thead><tr><th style="${TH}">Segment</th><th style="${TH}">Zóna</th><th style="${TH}">Nábytkový prvek</th>
        <th style="${TH}${num}">Počet ks</th><th style="${TH}${num}">WPL</th></tr></thead>
      <tbody>${rowsHtml}
        <tr><td style="${TD} background:#eafcef; font-weight:700;" colspan="3">Celkem za pobočku</td>
          <td style="${TD}${num} background:#eafcef; font-weight:700;">${fmtPieces(totalPieces)}</td>
          <td style="${TD}${num} background:#eafcef; font-weight:700;">${fmt1(totalWpl)}</td></tr>
      </tbody>
    </table>
  </div>`;
}

function buildFurnitureClipboardText(layoutRows, result) {
  const out = [`Nábytek po segmentech a zónách — ${result.pobocka_nazev || ""} (ID ${result.pobocka_id || ""})`, ""];
  out.push(["Segment", "Zóna", "Nábytkový prvek", "Počet ks", "WPL"].join("\t"));
  layoutRows.forEach((r) => {
    out.push([r.segment, ZONE_LABELS[r.zone] || r.zone, r.furniture, fmtPieces(r.piece_count), fmt1(r.wpl_assigned)].join("\t"));
  });
  out.push(["Celkem", "", "", fmtPieces(layoutRows.reduce((a, r) => a + (r.piece_count || 0), 0)),
    fmt1(layoutRows.reduce((a, r) => a + (r.wpl_assigned || 0), 0))].join("\t"));
  return out.join("\n");
}

function copyFurnitureToClipboard(layoutRows, result) {
  if (!layoutRows || !layoutRows.length) { toast("Layout ještě není uložený.", "err"); return; }
  return copyToClipboardBoth(buildFurnitureClipboardHtml(layoutRows, result),
    buildFurnitureClipboardText(layoutRows, result),
    "Přehled nábytku zkopírován — vložte přes Ctrl+V.");
}

// Zobrazí formát pobočky, doporučení pro layout a poměrové ukazatele (WPL/FTE,
// podíl backoffice a míst pro jednání s klientem) včetně srovnání s benchmarkem
// ostatních kalkulací se stejným formátem pobočky. checkboxId řídí, jestli se
// tato sekce zahrne i do PDF exportu.
// Krátké vysvětlení, odkud se doporučený počet fast tracků / židlí vzal.
function recommendationNote(stats, kind) {
  const p = stats.peak;
  if (!p) {
    return "odhad z WPL — pro pobočku zatím nemáme report návštěvnosti";
  }
  if (kind === "chairs") {
    return `špička ${Math.round(p.arrivalsP95)} klientů za hodinu × ${PEAK_MODEL.WAIT_MINS} min čekání`
      + ` × doprovod ${PEAK_MODEL.COMPANION_FACTOR}`;
  }
  return `špička ${Math.round(peakP95(p.walkins))} klientů bez objednání za hodinu, polovina z nich`
    + ` na fast track × ${PEAK_MODEL.FASTTRACK_MINS} min`;
}

function renderStatsSection(stats) {
  const benchmark = getBenchmark(stats.formatTyp);
  const fmtPct = (v) => (v === null || v === undefined || Number.isNaN(v)) ? "—" : `${v.toFixed(1)} %`;
  const deltaHtml = (value, avg) => {
    if (!benchmark || value === null || avg === null || avg === undefined) return "";
    const diff = value - avg;
    const cls = diff > 0 ? "kpi-up" : diff < 0 ? "kpi-down" : "";
    return ` <span class="muted ${cls}">(benchmark ${fmtPct(avg)}, rozdíl ${diff >= 0 ? "+" : ""}${diff.toFixed(1)} p.b.)</span>`;
  };
  const benchmarkNote = benchmark
    ? `Benchmark je průměr ${czechCalcCount(benchmark.n)} s formátem „${esc(stats.formatTyp)}“.`
    : `Zatím není dostatek kalkulací pro benchmark formátu „${esc(stats.formatTyp)}“.`;
  return `
    <div style="margin-top:14px;">
      <h3>Klíčové ukazatele ${srcBadgeHtml("calc")}</h3>
      <div class="table-wrap"><table class="kpi-table">
        <tr><td>Stanovený formát pobočky</td><td><strong>${esc(stats.formatTyp)}</strong>
          <span class="muted">(dle ${stats.obchodniFteSumDisplay} obchodních FTE)</span></td></tr>
        <tr><td>Doporučený počet fasttracků na hale</td><td>${stats.recommendedFasttracks}
          <span class="muted">(${esc(recommendationNote(stats, "fasttracks"))})</span></td></tr>
        <tr><td>Doporučený počet židlí v čekací zóně</td><td>${stats.recommendedChairs}
          <span class="muted">(${esc(recommendationNote(stats, "chairs"))})</span></td></tr>
        <tr><td>Potřebná plocha</td><td>${stats.requiredAreaM2.toFixed(1)} m² <span class="muted">(WPL × 25 m²)</span></td></tr>
        <tr><td>Poměr WPL / FTE</td><td>${fmtPct(stats.wplFteRatio)}${deltaHtml(stats.wplFteRatio, benchmark?.avg_ratio)}</td></tr>
        <tr><td>Podíl Backoffice zóny</td><td>${fmtPct(stats.backofficePct)}${deltaHtml(stats.backofficePct, benchmark?.avg_backoffice)}</td></tr>
        <tr><td>Podíl míst pro jednání s klientem (meeting zone)</td><td>${fmtPct(stats.meetingPct)}${deltaHtml(stats.meetingPct, benchmark?.avg_meeting)}</td></tr>
      </table></div>
      <p class="muted">${benchmarkNote}</p>
    </div>`;
}

// Vrátí sbalitelné shrnutí referenčních dat, se kterými byla kalkulace spočítána.
function refVersionDetailsHtml(refVersionId) {
  if (!refVersionId) return "";
  const version = getRefVersionById(refVersionId);
  if (!version) return "";
  return `<details style="margin-top:12px;">
    <summary style="cursor:pointer; color:var(--muted);">Referenční data použitá při této kalkulaci: verze #${version.id}
      — ${esc(version.note)} (${new Date(version.created_at).toLocaleString("cs-CZ")})</summary>
    <div style="margin-top:8px;">
      <h3>Absence po segmentech</h3>
      ${renderReadonlyAbsenceTable(version.absence)}
      <h3>Časové dotace pozic</h3>
      ${renderReadonlyDotaceTable(version.dotace)}
      <h3>Nábytkové prvky</h3>
      ${renderReadonlyFurnitureTable(version.furniture)}
    </div>
  </details>`;
}

function resultRowHtml(r, isTotal = false) {
  return `<tr class="${isTotal ? "total-row" : ""}">
    <td>${isTotal ? esc(r.segment) : segmentBadgeHtml(r.segment)}</td>
    <td>${fmt1(r.total_positions)}</td>
    <td>${esc(r.position_list)}</td>
    <td>${fmt1(r.service_zone)}</td>
    <td>${fmt1(r.meeting_zone)}</td>
    <td>${fmt1(r.backoffice_zone)}</td>
    <td>${fmt1(r.office_room)}</td>
  </tr>`;
}

/* ------------ Kapacitní shrnutí — srozumitelně, bez odborných pojmů -------- */
// Kolik kterých prvků je potřeba na špičku (z kalkulace FTE i z reálné
// návštěvnosti a Monte Carla) a jestli na to layout stačí. Cílem je, aby se
// z toho dalo přečíst „stačí / nestačí a o kolik“ bez znalosti pojmů jako P95.

// Do které kategorie nábytkový prvek patří — pořadí rozhoduje, první pravidlo
// vyhrává (židle a fast tracky jsou taky v service zone, ale nejsou to přepážky).
// Kolik míst k sezení jeden kus představuje — obývák je sestava tří židlí,
// takže se do kapacity čekací zóny počítá jako tři místa.
const SEATS_PER_PIECE = [
  { test: (f) => /obývák/i.test(f), seats: CHAIRS_PER_SOFA },
];

function seatsOfPiece(furniture) {
  const found = SEATS_PER_PIECE.find((x) => x.test(String(furniture || "")));
  return found ? found.seats : 1;
}

const CAPACITY_CATEGORIES = [
  { key: "chairs", test: (r) => /čekací zóna/i.test(r.furniture),
    weight: (r) => seatsOfPiece(r.furniture) },
  { key: "fasttracks", test: (r) => r.zone === "service_zone" && /fast track/i.test(r.furniture) },
  { key: "serviceDesks", test: (r) => r.zone === "service_zone" },
  { key: "meetings", test: (r) => r.zone === "meeting_zone" },
  { key: "backoffice", test: (r) => r.zone === "backoffice_zone" },
  { key: "office", test: (r) => r.zone === "office_room" },
];

function countLayoutByCategory(layoutRows) {
  const counts = { chairs: 0, fasttracks: 0, serviceDesks: 0, meetings: 0, backoffice: 0, office: 0 };
  // U kategorií s vahou (čekací zóna) se počítají místa k sezení, ne kusy —
  // obývák = 3 židle. Kusy se drží zvlášť pro popisek „z čeho se to skládá“.
  const pieces = { chairs: 0 };
  (layoutRows || []).forEach((r) => {
    const cat = CAPACITY_CATEGORIES.find((c) => c.test(r));
    if (!cat) return;
    const qty = Number(r.piece_count) || 0;
    counts[cat.key] += qty * (cat.weight ? cat.weight(r) : 1);
    if (cat.key === "chairs") pieces.chairs += qty;
  });
  counts.chairPieces = pieces.chairs;
  return counts;
}

// Verdikt jednoho řádku: stačí / těsné / nestačí.
function capacityStatus(need, have) {
  if (need <= 0) return have > 0 ? "ok" : "ok";
  if (have >= need) return "ok";
  if (need - have <= 1 && have / need >= 0.7) return "tight";
  return "missing";
}

function computeCapacityCheck({ stats, visitor, calcResult, layoutRows }) {
  const m = visitor ? computeVisitorMetrics(visitor) : null;
  const peak = stats.peak || (m ? computePeakModel(m) : null);
  const counts = countLayoutByCategory(layoutRows);
  const hasLayout = (layoutRows || []).length > 0;

  // needNormal = kolik by stačilo v běžné špičce (bez rezervy na silný den),
  // need = kolik je potřeba na silný den. Rozdíl obou čísel je v grafu vidět
  // jako pásmo mezi „běžnou špičkou“ a „silným dnem“.
  const item = (key, label, short, needCalc, needReport, have, plain, needNormal, haveNote) => {
    const need = Math.max(needCalc || 0, needReport || 0);
    return { key, label, short, needCalc: needCalc || 0, needReport: needReport === null ? null : (needReport || 0),
      need, needNormal: Math.min(needNormal === undefined || needNormal === null ? need : needNormal, need),
      have, haveNote: haveNote || null, missing: Math.max(0, need - have),
      status: capacityStatus(need, have), plain };
  };

  const cMeetingMins = (m && m.consts.MEETING_MINS) || VISITOR_CONSTS_DEFAULT.MEETING_MINS;
  const cWalkinMins = (m && m.consts.WALKIN_AVG_MINS) || VISITOR_CONSTS_DEFAULT.WALKIN_AVG_MINS;
  const normal = peak ? {
    meetings: Math.ceil((peak.meetings * cMeetingMins) / 60),
    serviceDesks: Math.ceil((peak.bezhot * cWalkinMins) / 60),
    chairs: Math.max(PEAK_MODEL.MIN_CHAIRS,
      Math.ceil((peak.arrivals * PEAK_MODEL.COMPANION_FACTOR * PEAK_MODEL.WAIT_MINS) / 60)),
    fasttracks: Math.max(PEAK_MODEL.MIN_FASTTRACKS,
      Math.ceil((peak.walkins * PEAK_MODEL.FASTTRACK_SHARE * PEAK_MODEL.FASTTRACK_MINS) / 60)),
  } : {};

  const items = [
    item("meetings", "Místa na sjednanou schůzku (jednací místnosti)", "místo na schůzku",
      Math.ceil(stats.meetingZoneWpl || 0), m ? m.rooms.meeting_rooms : null, counts.meetings,
      "Tolik klientů může naráz sedět s bankéřem u sjednané schůzky.", normal.meetings),
    // Fast track je taky obsluha na hale — do kapacity servisních míst se počítá,
    // a zároveň má vlastní řádek (na rychlé bezhotovostní operace).
    item("serviceDesks", "Servisní místa (Lenka, Theke, fast tracky — obsluha na hale)", "servisní místo",
      Math.ceil(stats.serviceZoneWpl || 0), m ? m.rooms.service_desks : null,
      counts.serviceDesks + counts.fasttracks,
      "Tolik lidí naráz obsluhuje klienty, kteří přijdou bez objednání. Počítají se i fast tracky.",
      normal.serviceDesks,
      counts.fasttracks > 0
        ? `přepážky ${fmtPieces(counts.serviceDesks)} + fast tracky ${fmtPieces(counts.fasttracks)}`
        : null),
    item("chairs", "Židle v čekací zóně", "židle v čekací zóně",
      stats.recommendedChairs, null, counts.chairs,
      `Tolik klientů naráz sedí a čeká, než na ně přijde řada. Obývák se počítá jako ${CHAIRS_PER_SOFA} židle.`,
      normal.chairs,
      // Kusů je méně než míst — do popisku patří, z čeho se kapacita skládá.
      counts.chairPieces && counts.chairPieces !== counts.chairs
        ? `${fmtPieces(counts.chairPieces)} ks = ${fmtPieces(counts.chairs)} míst`
        : null),
    item("fasttracks", "Fast tracky na hale", "fast track",
      stats.recommendedFasttracks, null, counts.fasttracks,
      "Místa pro rychlé bezhotovostní vyřízení, které trvá pár minut.", normal.fasttracks),
    item("backoffice", "Kancelářská místa v zázemí", "kancelářské místo v zázemí",
      Math.ceil(stats.backofficeZoneWpl || 0), null, counts.backoffice,
      "Místa na práci, u které bankéř nepotřebuje klienta."),
  ];
  if ((stats.officeRoomWpl || 0) > 0 || counts.office > 0) {
    items.push(item("office", "Kancelář (vedení pobočky)", "kancelář",
      Math.ceil(stats.officeRoomWpl || 0), null, counts.office,
      "Samostatná kancelář mimo otevřený prostor."));
  }

  // Lidé: vejdou se špičkové požadavky do bankéřů zadaných v kalkulaci?
  const bankerFte = computeBankerFte(calcResult ? calcResult.inputRows : []);
  const people = [];
  if (m && m.mc) {
    const presence = m.mc.presencePct / 100;
    // Běžná poptávka = příchody v nejsilnější hodině × doba obsluhy; P95 z Monte
    // Carla je stejná hodnota s rezervou na silný den.
    const normalOb = m.mc.rows.reduce((a, r) => Math.max(a, ((r.lamOnline + r.lamFyzicka) * cMeetingMins) / 60), 0);
    const normalSvc = m.mc.rows.reduce((a, r) => Math.max(a, (r.lamBezhot * cWalkinMins) / 60), 0);
    people.push({
      key: "ob", label: "Bankéři na schůzky (obchodní)",
      need: m.mc.peakP95Ob, needNormal: Math.min(normalOb, m.mc.peakP95Ob),
      have: bankerFte.sales * presence, fte: bankerFte.sales, presence,
      plain: "Kolik bankéřů musí být ve špičce naráz u klientů.",
    });
    if (bankerFte.serviceTotal > 0 || m.mc.peakP95Svc > 0) {
      people.push({
        key: "bkp", label: "Servisní obsluha (BKP medior + OB junior)",
        need: m.mc.peakP95Svc, needNormal: Math.min(normalSvc, m.mc.peakP95Svc),
        have: bankerFte.serviceTotal * presence, fte: bankerFte.serviceTotal, presence,
        plain: "Kolik lidí musí ve špičce naráz obsluhovat rychlé požadavky.",
      });
    }
    // Pokladna — jen když má pobočka hotovostní provoz (není cashless).
    const cashPeak = m.hours.reduce((a, r) => Math.max(a, r.hotovost), 0);
    if (m.d.has_cash || bankerFte.cashier > 0 || cashPeak > 0) {
      const cashNeed = (peakP95(cashPeak) * cWalkinMins) / 60;
      people.push({
        key: "cash", label: "Pokladna (bankéř klientské péče - junior)",
        need: cashNeed, needNormal: Math.min((cashPeak * cWalkinMins) / 60, cashNeed),
        have: bankerFte.cashier * presence, fte: bankerFte.cashier, presence,
        plain: m.d.has_cash === false && !bankerFte.cashier
          ? "Pobočka je dle reportu bez hotovosti — pokladník není potřeba."
          : "Kolik lidí musí ve špičce naráz obsluhovat hotovostní operace.",
      });
    }
    people.forEach((p) => {
      p.status = capacityStatus(Math.round(p.need * 10) / 10, Math.round(p.have * 10) / 10);
      p.missing = Math.max(0, p.need - p.have);
    });
  }

  const missingItems = items.filter((i) => i.status === "missing");
  const tightItems = items.filter((i) => i.status === "tight");
  const peopleShort = people.filter((p) => p.status !== "ok");
  const peopleNote = peopleShort.length
    ? ` Lidí je ve špičce málo: ${peopleShort.map((p) => `${p.label.toLowerCase()} chybí ${vFmt1(p.missing)}`).join(", ")}.`
    : "";
  let verdict;
  if (!hasLayout) {
    verdict = { status: "none",
      text: `Layout zatím není sestavený — níže je vidět, kolik čeho bude potřeba.${peopleNote}` };
  } else if (missingItems.length) {
    verdict = { status: "missing",
      text: `Ve špičce to nevyjde: chybí ${missingItems.map((i) => `${fmtPieces(i.missing)}× ${i.short}`).join(", ")}.${peopleNote}` };
  } else if (tightItems.length) {
    verdict = { status: "tight",
      text: `Layout špičku zvládne jen těsně — hlídejte ${tightItems.map((i) => i.short).join(", ")}.${peopleNote}` };
  } else if (peopleShort.length) {
    verdict = { status: "tight",
      text: `Nábytku je dost, ale lidí ne.${peopleNote}` };
  } else {
    verdict = { status: "ok", text: "Layout na špičku stačí — všech prvků je tolik, kolik je potřeba." };
  }

  const meetingChecks = computeMeetingChecks({ stats, m, bankerFte, counts, calcResult });

  return { m, peak, counts, items, people, bankerFte, verdict, hasLayout, hasReport: !!m, peopleShort,
    meetingChecks };
}

// Slovní úvod: co je „špička“ a s čím se počítá — bez zkratek.
function capacityIntroLines(check) {
  const { m, peak } = check;
  if (!m || !peak) {
    return ["Pro tuto pobočku nemáme report návštěvnosti, takže se počítá jen z počtu FTE zadaných v kalkulaci. "
      + "Po naimportování reportu se doporučení upřesní podle skutečných návštěv."];
  }
  const hourLabel = visitorHourLabel(peak.hour);
  return [
    `Nejrušnější hodina dne je na této pobočce ${hourLabel} — přijde v ní průměrně `
      + `${vFmt1(peak.arrivals)} klientů.`,
    `Některé dny jsou ale silnější než průměr. Aby to fungovalo i v takový den (zhruba jeden den z dvaceti), `
      + `počítáme s ${Math.round(peak.arrivalsP95)} klienty v té hodině — z toho asi `
      + `${Math.round(peakP95(peak.walkins))} přijde bez objednání na rychlé vyřízení a `
      + `${Math.round(peakP95(peak.meetings))} na sjednanou schůzku.`,
    `Židle: každý čeká průměrně ${PEAK_MODEL.WAIT_MINS} minut, někdo přijde s doprovodem — `
      + `v čekací zóně tak sedí naráz zhruba ${vFmt1(peak.chairsRaw)} lidí, zaokrouhleno na `
      + `${peak.chairs} ${peak.chairs === 1 ? "židli" : "židle"}.`,
    `Fast tracky: rychlé vyřízení trvá kolem ${PEAK_MODEL.FASTTRACK_MINS} minut a míří na něj zhruba `
      + `polovina lidí bez objednání — potřeba je ${peak.fasttracks} `
      + `${peak.fasttracks === 1 ? "fast track" : "fast tracky"}.`,
  ];
}

const CAPACITY_STATUS_META = {
  ok: { icon: "✅", label: "Stačí", cls: "cap-ok" },
  tight: { icon: "⚠️", label: "Těsné", cls: "cap-tight" },
  missing: { icon: "❌", label: "Nestačí", cls: "cap-missing" },
  none: { icon: "ℹ️", label: "Bez layoutu", cls: "cap-none" },
};

function capacityRowVerdict(it) {
  if (it.status === "ok") {
    const extra = it.have - it.need;
    return extra > 0 ? `Stačí, máte i ${fmtPieces(extra)} navíc.` : "Stačí přesně.";
  }
  if (it.status === "tight") return `Těsné — ve špičce může chybět ${fmtPieces(it.missing)}.`;
  return `Chybí ${fmtPieces(it.missing)} — na tolik lidí se ve špičce nedostane.`;
}

// Sestaví kapacitní shrnutí pro daný layout (řádky s počty kusů) — používá
// se v sekci layoutu i v PDF.
function capacityCheckHtmlFor(meta, layoutRows, preloadedVisitor) {
  if (!meta || !meta.stats) return "";
  const visitor = preloadedVisitor !== undefined
    ? preloadedVisitor
    : getVisitorForCalculation(meta.calculation_key, meta.pobocka_id, meta.pobocka_nazev);
  return renderCapacityCheckHtml(computeCapacityCheck({
    stats: meta.stats, visitor, calcResult: meta.calcResult, layoutRows,
  }));
}

// Přečte aktuálně zadané počty kusů z formuláře layoutu (ještě před uložením),
// aby šlo shrnutí „vejde se to?“ přepočítávat rovnou při psaní.
function readLayoutFormRows(container) {
  const rows = [];
  container.querySelectorAll(".layout-group[data-segment]").forEach((g) => {
    const { segment, zone } = g.dataset;
    g.querySelectorAll("input.layout-qty").forEach((inp) => {
      const pieces = Number(inp.value) || 0;
      if (pieces <= 0) return;
      rows.push({ segment, zone, furniture: inp.dataset.furniture, piece_count: pieces,
        wpl_assigned: pieces * (Number(inp.dataset.wplCounter) || 0) });
    });
  });
  return rows;
}

/* ------------- Graf kapacity proti špičce (bullet chart) ------------------- */
// Jeden řádek = jeden druh místa nebo lidí. Barevný pruh je to, co je
// k dispozici (v layoutu / na place), svislé značky ukazují, kolik je potřeba
// v běžné špičce a kolik v silný den (P95). Na první pohled je vidět, jestli
// pruh za značky dosáhne.

// Připraví řádky grafu ze společné struktury computeCapacityCheck.
function capacityChartRows(check) {
  const rows = check.items.map((it) => ({
    label: it.label,
    normal: it.needNormal,
    p95: it.need,
    capacity: it.have,
    status: it.status,
    unit: "ks",
    decimals: 0,
  }));
  check.people.forEach((p) => {
    rows.push({
      label: p.label,
      normal: p.needNormal === undefined ? p.need : p.needNormal,
      p95: p.need,
      capacity: p.have,
      status: p.status,
      unit: "lidí",
      decimals: 1,
    });
  });
  return rows;
}

function capacityBarColor(status) {
  return status === "ok" ? "#0bb43f" : status === "tight" ? "#e0a112" : "#d03636";
}

// Všechny řádky mají stejné měřítko: 100 % = potřeba na silný den. Svislá plná
// čára je proto u všech řádků na stejném místě a stačí se podívat, jestli za ni
// barevný pruh dosáhne. Osa jde do 150 % potřeby.
const CAPCHART_SCALE = 1.5;

function capacityChartPct(value, p95) {
  const base = (p95 || 1) * CAPCHART_SCALE;
  return Math.max(0, Math.min(100, (value / base) * 100));
}

function renderCapacityChartHtml(check) {
  const rows = capacityChartRows(check);
  if (!rows.length) return "";
  const num = (v, d) => (d ? v.toFixed(1) : String(Math.round(v)));
  const targetPct = 100 / CAPCHART_SCALE; // poloha značky „silný den“ (66.7 %)

  const barsHtml = rows.map((r) => {
    const pct = (v) => `${capacityChartPct(v, r.p95).toFixed(1)}%`;
    const meta = CAPACITY_STATUS_META[r.status] || CAPACITY_STATUS_META.none;
    const coverage = r.p95 > 0 ? Math.round((r.capacity / r.p95) * 100) : 100;
    return `<div class="capchart-row">
      <div class="capchart-label">${esc(r.label)}</div>
      <div class="capchart-track">
        <div class="capchart-zone" style="left:${pct(r.normal)}; width:${(targetPct - capacityChartPct(r.normal, r.p95)).toFixed(1)}%;"></div>
        <div class="capchart-bar" style="width:${pct(r.capacity)}; background:${capacityBarColor(r.status)};"></div>
        <div class="capchart-mark capchart-mark-normal" style="left:${pct(r.normal)};"
          title="Běžná špička: ${num(r.normal, r.decimals)}"></div>
        <div class="capchart-mark capchart-mark-p95" style="left:${targetPct.toFixed(1)}%;"
          title="Silný den: ${num(r.p95, r.decimals)}"></div>
      </div>
      <div class="capchart-value">
        <strong>${num(r.capacity, r.decimals)}</strong> / ${num(r.p95, r.decimals)} ${esc(r.unit)}
        <span class="muted">(${coverage} %)</span>
        <span class="capchart-icon">${meta.icon}</span>
      </div>
    </div>`;
  }).join("");

  return `<div class="capchart">
    <div class="capchart-legend">
      <span><i class="capchart-key-bar"></i> kolik je k dispozici (layout / lidé na place)</span>
      <span><i class="capchart-key-normal"></i> potřeba v běžné špičce</span>
      <span><i class="capchart-key-p95"></i> potřeba v silný den (1 den z 20)</span>
      <span><i class="capchart-key-zone"></i> pásmo mezi nimi</span>
    </div>
    ${barsHtml}
    <div class="capchart-row capchart-axis">
      <div class="capchart-label"></div>
      <div class="capchart-track">
        <span style="left:0;">0</span>
        <span style="left:${targetPct.toFixed(1)}%;">potřeba na silný den</span>
        <span style="left:100%;">+50 %</span>
      </div>
      <div class="capchart-value"></div>
    </div>
    <p class="muted" style="margin:8px 0 0;">Všechny řádky mají stejné měřítko: svislá plná čára je potřeba
      na silný den. Pruh za čárou = kapacita stačí. Pruh mezi tečkovanou a plnou čarou = běžný den v pohodě,
      silný den těsný. Pruh před tečkovanou čarou = nestačí ani běžná špička.</p>
  </div>`;
}

// Stejný graf do PDF — obdélníky a svislé značky.
function drawCapacityChartPdf(pdf, startY, check, marginX, pageBottom) {
  const rows = capacityChartRows(check);
  if (!rows.length) return startY;
  let y = startY;
  const labelW = 56;
  const valueW = 41;
  const trackX = marginX + labelW;
  const trackW = 182 - labelW - valueW;
  const rowH = 7.4;
  const barH = 4.4;
  const num = (v, d) => (d ? v.toFixed(1) : String(Math.round(v)));

  const need = rows.length * rowH + 16;
  if (y + need > pageBottom) { pdf.addPage(); y = 18; }

  pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(10);
  pdf.text("Kapacita proti špičce — jedním pohledem", marginX, y); y += 5.5;
  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(7);
  pdf.setTextColor(120, 120, 120);
  pdf.text("Pruh = kolik je k dispozici · tečkovaná značka = běžná špička · plná značka = potřeba na silný den "
    + "(1 den z 20, u všech řádků na stejném místě)", marginX, y);
  pdf.setTextColor(0, 0, 0);
  y += 4;

  rows.forEach((r) => {
    if (y + rowH > pageBottom) { pdf.addPage(); y = 18; }
    const xOf = (v) => trackX + (capacityChartPct(v, r.p95) / 100) * trackW;

    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(7.2);
    pdf.text(r.label, marginX, y + 3.4, { maxWidth: labelW - 2 });

    // dráha
    pdfFill(pdf, "#eef2f9");
    pdf.rect(trackX, y, trackW, barH, "F");
    // pásmo mezi běžnou špičkou a silným dnem
    const zoneW = xOf(r.p95) - xOf(r.normal);
    const coverage = r.p95 > 0 ? Math.round((r.capacity / r.p95) * 100) : 100;
    if (zoneW > 0.2) {
      pdfFill(pdf, "#dbe6f7");
      pdf.rect(xOf(r.normal), y, zoneW, barH, "F");
    }
    // kapacita
    pdfFill(pdf, capacityBarColor(r.status));
    pdf.rect(trackX, y, Math.max(xOf(r.capacity) - trackX, 0.3), barH, "F");
    // značky
    pdfStroke(pdf, "#475569", 0.4);
    pdfSetDash(pdf, [0.8, 0.8]);
    pdf.line(xOf(r.normal), y - 0.7, xOf(r.normal), y + barH + 0.7);
    pdfSetDash(pdf, []);
    pdfStroke(pdf, "#1c2530", 0.6);
    pdf.line(xOf(r.p95), y - 1, xOf(r.p95), y + barH + 1);

    pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(7.2);
    pdf.setTextColor(0, 0, 0);
    const icon = r.status === "ok" ? "OK" : r.status === "tight" ? "těsné" : "chybí";
    pdf.text(`${num(r.capacity, r.decimals)} / ${num(r.p95, r.decimals)} ${r.unit} (${coverage} %) ${icon}`,
      trackX + trackW + 2, y + 3.4, { maxWidth: valueW - 1 });
    pdf.setLineWidth(0.2);
    pdf.setDrawColor(0, 0, 0);
    y += rowH;
  });

  return y + 4;
}

function renderCapacityCheckHtml(check) {
  const intro = capacityIntroLines(check).map((l) => `<p>${l}</p>`).join("");
  const v = CAPACITY_STATUS_META[check.verdict.status];

  const rowsHtml = check.items.map((it) => {
    const meta = CAPACITY_STATUS_META[it.status];
    const needDetail = [
      `z kalkulace ${fmtPieces(it.needCalc)}`,
      it.needReport === null ? null : `z návštěvnosti ${fmtPieces(it.needReport)}`,
    ].filter(Boolean).join(" · ");
    return `<tr class="${meta.cls}">
      <td><strong>${esc(it.label)}</strong><br><span class="muted">${esc(it.plain)}</span></td>
      <td class="num"><strong>${fmtPieces(it.need)}</strong><br><span class="muted">${esc(needDetail)}</span></td>
      <td class="num">${fmtPieces(it.have)}${it.haveNote
        ? `<br><span class="muted">${esc(it.haveNote)}</span>` : ""}</td>
      <td>${meta.icon} ${esc(capacityRowVerdict(it))}</td>
    </tr>`;
  }).join("");

  const peopleHtml = check.people.length ? `
    <h4>A vyjdou na to lidé?</h4>
    <div class="table-wrap"><table class="visitor-table cap-table">
      <thead><tr><th>Kdo</th><th>Potřeba ve špičce</th><th>Reálně na place</th><th>Jak to vypadá</th></tr></thead>
      <tbody>${check.people.map((p) => {
        const meta = CAPACITY_STATUS_META[p.status];
        return `<tr class="${meta.cls}">
          <td><strong>${esc(p.label)}</strong><br><span class="muted">${esc(p.plain)}</span></td>
          <td class="num">${vFmt1(p.need)}<br><span class="muted">lidí naráz</span></td>
          <td class="num">${vFmt1(p.have)}<br><span class="muted">z ${vFmt1(p.fte)} FTE v kalkulaci
            (${Math.round(p.presence * 100)} % je v práci)</span></td>
          <td>${meta.icon} ${p.status === "ok" ? "Stačí."
            : `Chybí ${vFmt1(p.missing)} člověka — ve špičce se tvoří fronta.`}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>
    <p class="muted">„Reálně na place“ = zadané FTE mínus dovolené, nemoci a homeoffice
      (${check.m && check.m.mc ? vFmt1(check.m.mc.presencePct) : "77"} % času je člověk skutečně na pobočce).</p>` : "";

  const meetingChecksHtml = renderMeetingChecksHtml(check.meetingChecks);

  const todo = [
    ...check.items.filter((i) => i.status !== "ok").map((i) =>
      `<li><strong>${esc(i.label)}</strong>: doplnit ${fmtPieces(i.missing)} (v layoutu ${fmtPieces(i.have)},
        potřeba ${fmtPieces(i.need)}).</li>`),
    ...check.people.filter((p) => p.status !== "ok").map((p) =>
      `<li><strong>${esc(p.label)}</strong>: ve špičce chybí ${vFmt1(p.missing)} člověka — buď posílit směnu,
        nebo počítat s tím, že klienti budou čekat.</li>`),
  ].join("");

  return `<div class="cap-box src-box-mix">
    <h3>Kapacitní shrnutí — stačí to na špičku? ${srcBadgeHtml("mix")}</h3>
    <div class="cap-verdict ${v.cls}">${v.icon} ${esc(check.verdict.text)}</div>
    ${renderCapacityChartHtml(check)}
    <div class="cap-intro">${intro}</div>
    <div class="table-wrap"><table class="visitor-table cap-table">
      <thead><tr><th>Co</th><th>Kolik je potřeba ve špičce</th><th>Kolik je v layoutu</th><th>Jak to vypadá</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
    <p class="muted">Potřeba = vyšší z obou pohledů: kolik vychází z počtu FTE v kalkulaci a kolik vychází
      ze skutečné návštěvnosti ve špičce. Kde návštěvnost nic neříká (zázemí, kancelář), platí jen kalkulace.</p>
    ${peopleHtml}
    ${meetingChecksHtml}
    ${todo ? `<h4>Co s tím</h4><ul class="cap-todo">${todo}</ul>`
      : `<p class="cap-ok-note">✅ Není co doplňovat — layout pokrývá špičku i s rezervou na silný den.</p>`}
  </div>`;
}

/* ------- Kontrolní varianta kalkulace bez uplatnění nepřítomnosti ---------- */
// Stejný výpočet jako kalkulace, jen bez odečtení nepřítomnosti a homeoffice
// (koeficient 1 místo 1 − nepřítomnost − homeoffice). Je to jen informativní
// pohled „kolik by WPL vyšlo, kdyby byli všichni vždy na place“ — schovaný
// v rozbalovací sekci, do PDF exportu ani do schránky se nedostane.
function computeNoAbsenceVariant(result) {
  const inputRows = result.inputRows || [];
  const oteviraciDoba = Number(result.oteviraci_doba) || 0;
  if (!inputRows.length || !oteviraciDoba || !db) return null;

  // Časové dotace se berou ze stejné verze referenčních dat, se kterou
  // kalkulace vznikla — aby varianta odpovídala právě jí, ne pozdějším změnám.
  const version = result.refVersionId ? getRefVersionById(result.refVersionId) : null;
  const dotaceMap = {};
  if (version && version.dotace && version.dotace.length) {
    version.dotace.forEach((r) => {
      dotaceMap[`${r[0]}\u0000${r[1]}`] = {
        service_zone: r[2], meeting_zone: r[3], backoffice_zone: r[4], office_room: r[5],
      };
    });
  } else {
    dbAll("SELECT segment, pozice, service_zone, meeting_zone, backoffice_zone, office_room FROM casove_dotace")
      .forEach((r) => { dotaceMap[`${r.segment}\u0000${r.pozice}`] = r; });
  }

  const bySegment = {};
  const order = [];
  const celkem = { segment: "Celkem", total_positions: 0, service_zone: 0, meeting_zone: 0, backoffice_zone: 0, office_room: 0 };
  let missing = 0;
  inputRows.forEach((row) => {
    const fte = Number(row.fte) || 0;
    if (fte <= 0) return;
    const dotace = dotaceMap[`${row.segment}\u0000${row.pozice}`];
    if (!dotace) { missing += 1; return; }
    const wplLoad = (row.wpl_load === null || row.wpl_load === undefined) ? oteviraciDoba : row.wpl_load;
    const vypocet = fte * wplLoad; // bez (1 − nepřítomnost − homeoffice)
    if (!bySegment[row.segment]) {
      bySegment[row.segment] = { segment: row.segment, total_positions: 0, service_zone: 0, meeting_zone: 0, backoffice_zone: 0, office_room: 0 };
      order.push(row.segment);
    }
    const seg = bySegment[row.segment];
    seg.total_positions += fte;
    celkem.total_positions += fte;
    ZONES.forEach((zone) => {
      const hodiny = (vypocet * (dotace[zone] || 0)) / 100 / oteviraciDoba;
      seg[zone] += hodiny;
      celkem[zone] += hodiny;
    });
  });
  if (!order.length) return null;

  const round = (r) => ({
    segment: r.segment,
    total_positions: round1(r.total_positions),
    service_zone: round1(r.service_zone),
    meeting_zone: round1(r.meeting_zone),
    backoffice_zone: round1(r.backoffice_zone),
    office_room: round1(r.office_room),
    wplTotal: round1(r.service_zone + r.meeting_zone + r.backoffice_zone + r.office_room),
  });

  return {
    rows: order.map((seg) => round(bySegment[seg])),
    celkem: round(celkem),
    missing,
    refVersionId: version ? version.id : null,
  };
}

// Rozbalovací (výchozí zavřená) sekce s kontrolní variantou bez nepřítomnosti.
function noAbsenceVariantHtml(result) {
  const variant = computeNoAbsenceVariant(result);
  if (!variant) return "";
  const actualWpl = ZONES.reduce((a, z) => a + (result.celkem[z] || 0), 0);
  const diff = variant.celkem.wplTotal - actualWpl;
  const pct = actualWpl > 0 ? (diff / actualWpl) * 100 : null;

  const row = (r, isTotal) => `<tr class="${isTotal ? "total-row" : ""}">
    <td>${isTotal ? esc(r.segment) : segmentBadgeHtml(r.segment)}</td>
    <td class="num">${fmt1(r.total_positions)}</td>
    ${ZONES.map((z) => `<td class="num">${fmt1(r[z])}</td>`).join("")}
    <td class="num"><strong>${fmt1(r.wplTotal)}</strong></td>
  </tr>`;

  return `<details class="hidden-variant">
    <summary>Kontrolní varianta bez uplatnění nepřítomnosti <span class="badge warn">jen pro informaci</span></summary>
    <p class="muted">Stejný výpočet jako kalkulace, ale s koeficientem 1 místo
      (1 − nepřítomnost − homeoffice) — ukazuje, kolik WPL by vyšlo, kdyby byli všichni vždy na pobočce.
      <strong>Neukládá se ani se nikam netiskne</strong> — do PDF exportu, do spojené sestavy ani do schránky
      se tato varianta nedostane. Závazný je vždy výsledek kalkulace nahoře.</p>
    <div class="table-wrap"><table class="visitor-table">
      <thead><tr><th>Segment</th><th>FTE celkem</th>
        ${ZONES.map((z) => `<th>${esc(ZONE_LABELS[z])}</th>`).join("")}<th>WPL celkem</th></tr></thead>
      <tbody>${variant.rows.map((r) => row(r, false)).join("")}${row(variant.celkem, true)}</tbody>
    </table></div>
    <p class="muted">WPL bez nepřítomnosti: <strong>${fmt1(variant.celkem.wplTotal)}</strong> ·
      WPL z kalkulace: <strong>${fmt1(round1(actualWpl))}</strong> ·
      rozdíl <strong>${diff >= 0 ? "+" : ""}${fmt1(round1(diff))}</strong>${pct === null ? ""
        : ` (${diff >= 0 ? "+" : ""}${pct.toFixed(1)} %)`}.
      ${variant.missing ? `${variant.missing} řádků bylo vynecháno — chybí pro ně časová dotace.` : ""}</p>
  </details>`;
}

/* ------------------- Nastavení PDF exportu (jedno místo) -------------------- */
// Všechna zaškrtávátka pro obsah PDF jsou v jednom boxu pod kalkulací, aby se
// nastavení nehledalo po jednotlivých sekcích. Stejné nastavení používá jak
// samostatný export kalkulace, tak spojená sestava (kalkulace + layout).
// `suffix` odlišuje box u nové kalkulace ("") od boxu v detailu historie
// ("History") — id prvků musí být na stránce jednoznačná.

const PDF_CHAPTERS = [
  { key: "calc", title: "Kalkulace FTE → WPL", color: "#2770f0",
    note: "Vychází ze zadaných FTE a referenčních dat (časové dotace, absence)." },
  { key: "capacity", title: "Kapacita pobočky", color: "#0e9f6e",
    note: "Kolik času je k dispozici, co ho spotřebuje a jestli to vyjde ve špičce." },
  { key: "layout", title: "Layout pobočky", color: "#8b5cf6",
    note: "Přiřazený nábytek proti potřebě WPL z kalkulace." },
];

function pdfChapter(key) { return PDF_CHAPTERS.find((c) => c.key === key); }

// Jednotlivé části PDF v tom pořadí, v jakém se tisknou. `group` je kapitola,
// `needsVisitor` označuje části, které bez reportu návštěvnosti nejdou vytisknout.
const PDF_OPTION_DEFS = [
  // 1) Kalkulace FTE → WPL
  { key: "detailBox", id: "pdfIncDetailBox", group: "calc", def: true,
    label: "Šedý blok s detaily (pobočka, klíče, datum)" },
  { key: "refData", id: "pdfIncRefData", group: "calc", def: true,
    label: "Informace o použitých referenčních datech (v šedém bloku)" },
  { key: "inputPositions", id: "pdfIncPositions", group: "calc", def: true,
    label: "Přehled pozic z checklistu (s pruhy vytížení zón)" },
  { key: "summaryTable", id: "pdfIncSummary", group: "calc", def: true,
    label: "Souhrnná tabulka (WPL po zónách) a doporučení (fasttracky, židle, plocha)" },
  // Ponecháno původní id — používá ho i starší uložené nastavení a testy.
  { key: "includeStats", id: "pdfIncludeStats", group: "calc", def: true,
    label: "Klíčové ukazatele a benchmark" },
  { key: "warnings", id: "pdfIncWarnings", group: "calc", def: true,
    label: "Upozornění z výpočtu" },

  // 2) Kapacita pobočky
  { key: "yearCapacity", id: "pdfIncYearCapacity", group: "capacity", def: true,
    label: "Roční kapacita — kolik času je a co ho spotřebuje" },
  { key: "includeVisitor", id: "pdfIncludeVisitor", group: "capacity", def: true, needsVisitor: true,
    label: "Návštěvnost a doporučení prostor (+ srovnání s kalkulací)" },
  { key: "visitorBankers", id: "pdfIncVisitorBankers", group: "capacity", def: false, needsVisitor: true,
    label: "Otevírací doba a návštěvy na bankéře" },
  { key: "visitorMcHours", id: "pdfIncVisitorMcHours", group: "capacity", def: true, needsVisitor: true,
    label: "Monte Carlo model průměrného dne (1 000 simulací)" },
  { key: "visitorMcDist", id: "pdfIncVisitorMcDist", group: "capacity", def: true, needsVisitor: true,
    label: "Distribuce celkové denní FTE poptávky (bankéř-hodiny/den)" },
  { key: "plainSummary", id: "pdfIncPlain", group: "capacity", def: true,
    label: "Kapacitní shrnutí — stačí to na špičku?" },
  { key: "meetingChecks", id: "pdfIncMeetingChecks", group: "capacity", def: true,
    label: "Tři kontroly míst pro schůzky (meeting zone)" },

  // 3) Layout pobočky
  { key: "layoutDetailBox", id: "pdfIncLayoutDetailBox", group: "layout", def: true,
    label: "Šedý blok s detaily (pobočka, klíč kalkulace, datum)" },
  { key: "layoutOverview", id: "pdfIncLayoutOverview", group: "layout", def: true,
    label: "Kompletní přehled WPL po zónách a segmentech" },
  { key: "layoutFurniture", id: "pdfIncLayoutFurniture", group: "layout", def: true,
    label: "Seznam nábytku po zónách a segmentech (kompaktní výpis)" },
  { key: "layoutAnalysis", id: "pdfIncLayoutAnalysis", group: "layout", def: true,
    label: "Analýza segmentů, zón a jejich prvků" },
  // Schéma je obrázek na celou šířku stránky — proto je ve výchozím stavu vypnuté
  // a uživatel si ho do sestavy přidá zaškrtnutím.
  { key: "layoutFloorPlan", id: "pdfIncLayoutFloorPlan", group: "layout", def: false,
    label: "Schéma pobočky (půdorys s nakresleným nábytkem)" },
];

// Zpětná kompatibilita: starší nastavení (i testy) používaly jedno zaškrtávátko
// „visitorCharts“ pro oba grafy Monte Carla.
const PDF_OPTION_ALIASES = { visitorCharts: ["visitorMcHours", "visitorMcDist"] };

// Naposledy použité nastavení (v rámci běhu aplikace) — aby se po překreslení
// výsledku (např. po potvrzení kalkulace) zaškrtávátka vrátila tak, jak byla.
const pdfOptionState = {};

function pdfOptionChecked(def) {
  const stored = pdfOptionState[def.key];
  return stored === undefined ? def.def : stored;
}

// Rozsah generování — přednastavené celky, které se dají vygenerovat samostatně.
// Rozsah = seznam kapitol, pořadí kapitol je vždy stejné.
const PDF_SCOPES = [
  { key: "vse", label: "Celá sestava", note: "kalkulace + kapacita pobočky + layout",
    groups: ["calc", "capacity", "layout"] },
  { key: "kalkulace", label: "Jen kalkulace", note: "pozice, WPL po zónách, ukazatele a benchmark",
    groups: ["calc"] },
  { key: "navstevnost", label: "Jen kapacita pobočky", note: "roční kapacita, návštěvnost, špička, kontroly schůzek",
    groups: ["capacity"] },
  { key: "layout", label: "Jen layout pobočky", note: "přehled WPL, nábytek po zónách, analýza",
    groups: ["layout"] },
];

function pdfScopeGroups(scope) {
  const found = PDF_SCOPES.find((x) => x.key === scope);
  return found ? found.groups : PDF_SCOPES[0].groups;
}

// Vrátí HTML boxu s nastavením PDF. `hasVisitor` vypne skupinu návštěvnosti,
// pokud pro pobočku žádná data z reportu nejsou.
function pdfOptionsBoxHtml(suffix, { hasVisitor = false, hasLayout = false, status = "rozpracovana" } = {}) {
  // Zaškrtávátka jsou seskupená po kapitolách a ve stejném pořadí, v jakém se
  // části tisknou — box tak zároveň slouží jako obsah budoucího PDF.
  const groupHtml = PDF_CHAPTERS.map((chapter, ci) => {
    const defs = PDF_OPTION_DEFS.filter((d) => d.group === chapter.key);
    const items = defs.map((d, i) => {
      const disabled = !!d.needsVisitor && !hasVisitor;
      return `
      <label class="pdf-opt${disabled ? " pdf-opt-off" : ""}"${disabled
        ? ' title="Pro tuto pobočku nejsou naimportovaná data návštěvnosti."' : ""}>
        <input type="checkbox" id="${d.id}${suffix}" data-pdf-opt="${d.key}"
          ${pdfOptionChecked(d) && !disabled ? "checked" : ""}${disabled ? " disabled" : ""}>
        <span><span class="pdf-opt-order">${i + 1}.</span> ${esc(d.label)}</span></label>`;
    }).join("");
    const noVisitor = defs.some((d) => d.needsVisitor) && !hasVisitor;
    return `<fieldset class="pdf-opt-group" style="--chapter-color:${chapter.color};">
      <legend><span class="pdf-chapter-num" style="background:${chapter.color};">${ci + 1}</span>
        ${esc(chapter.title)}</legend>
      <p class="muted pdf-chapter-note">${esc(chapter.note)}</p>
      ${items}
      ${noVisitor ? `<p class="muted" style="margin:6px 0 0;">Části z reportu návštěvnosti jsou nedostupné —
        pro tuto pobočku nejsou naimportovaná data návštěvnosti.</p>` : ""}
      ${chapter.key === "layout" && !hasLayout ? `<p class="muted" style="margin:6px 0 0;">Layout ještě není
        uložený — kapitola se do PDF netiskne.</p>` : ""}
    </fieldset>`;
  }).join("");

  const scopeHtml = PDF_SCOPES.map((sc, i) => {
    const disabled = sc.key === "layout" && !hasLayout;
    return `<label class="pdf-scope-item${disabled ? " pdf-opt-off" : ""}">
      <input type="radio" name="pdfScope${suffix}" value="${sc.key}"${i === 0 ? " checked" : ""}
        ${disabled ? " disabled" : ""}>
      <span><strong>${esc(sc.label)}</strong><span class="muted">${esc(sc.note)}</span></span></label>`;
  }).join("");

  const confirmed = status === "potvrzena";

  return `<div class="pdf-box">
    <h3>Co se má vygenerovat</h3>
    <p class="muted">Nejprve rozsah (které kapitoly), potom si v jednotlivých kapitolách odškrtněte části,
      které se tisknout nemají. <strong>Číslování odpovídá pořadí v PDF.</strong>
      Detail návštěv po hodinách a kontrolní varianta bez nepřítomnosti se do PDF netisknou nikdy.</p>
    <div class="pdf-scope">${scopeHtml}</div>
    <div class="pdf-opt-grid">${groupHtml}</div>
    <div class="pdf-box-note">
      <label class="muted" for="pdfNote${suffix}">Poznámka do PDF (nepovinné) — vytiskne se
        <strong>v záhlaví první stránky</strong>, žlutě podbarvená s vykřičníkem:</label>
      <textarea id="pdfNote${suffix}" rows="2"
        placeholder="Např. Pozor: kalkulace vychází z plánovaného stavu po přestavbě."></textarea>
    </div>
    <div class="row" style="margin-top:12px;">
      <button class="btn" id="btnExportPdf${suffix}">Vygenerovat PDF</button>
      <button class="btn secondary" id="btnCopyResult${suffix}">📋 Kopírovat kalkulaci</button>
      <button class="btn secondary" id="btnCopyFurniture${suffix}">📋 Kopírovat nábytek po segmentech</button>
    </div>
    <p class="muted" style="margin:8px 0 0;">Kopírování do schránky vloží formátovanou tabulku —
      do MS Teams, Outlooku, Wordu i Excelu.</p>
    <div class="pdf-box-status">
      ${statusBadgeHtml(status)}
      <button class="btn ${confirmed ? "secondary" : ""}" id="btnToggleStatus${suffix}">${confirmed
        ? "Vrátit do rozpracované" : "Potvrdit / uzavřít kalkulaci"}</button>
      <span class="muted">${confirmed
        ? "Kalkulace je uzavřená — v historii je označená zeleným proužkem."
        : "Po potvrzení se kalkulace v historii označí zeleným proužkem."}</span>
    </div>
  </div>`;
}

// Doplní chybějící volby výchozími hodnotami — aby PDF šlo vygenerovat i bez
// boxu (např. z testu nebo ze staršího volání s pouhou poznámkou).
function normalizePdfOptions(options) {
  const out = {};
  PDF_OPTION_DEFS.forEach((d) => {
    let value = (options && options[d.key] !== undefined) ? !!options[d.key] : d.def;
    // starší klíč (např. visitorCharts) přebije výchozí hodnotu obou grafů
    Object.entries(PDF_OPTION_ALIASES).forEach(([alias, keys]) => {
      if (keys.includes(d.key) && options && options[alias] !== undefined && options[d.key] === undefined) {
        value = !!options[alias];
      }
    });
    out[d.key] = value;
  });
  out.note = (options && options.note) || "";
  out.scope = (options && options.scope) || "vse";
  return out;
}

// Přečte nastavení z boxu a uloží si ho pro další překreslení.
function collectPdfOptions(suffix) {
  const out = {};
  PDF_OPTION_DEFS.forEach((d) => {
    const el = document.getElementById(`${d.id}${suffix}`);
    const value = el ? (el.checked && !el.disabled) : pdfOptionChecked(d);
    out[d.key] = value;
    if (el && !el.disabled) pdfOptionState[d.key] = el.checked;
  });
  const noteEl = document.getElementById(`pdfNote${suffix}`);
  out.note = noteEl ? noteEl.value.trim() : "";

  // Rozsah generování zamaskuje skupiny, které do vybraného celku nepatří.
  const scopeEl = document.querySelector(`input[name="pdfScope${suffix}"]:checked`);
  out.scope = scopeEl ? scopeEl.value : "vse";
  const groups = pdfScopeGroups(out.scope);
  PDF_OPTION_DEFS.forEach((d) => { if (!groups.includes(d.group)) out[d.key] = false; });
  return out;
}

// Vygeneruje PDF podle vybraného rozsahu. Kapitoly jdou vždy ve stejném pořadí
// (kalkulace → kapacita → layout) a každá začíná na nové stránce barevnou
// hlavičkou, takže je sestava přehledná i po vytištění.
function exportPdfByScope(result, layoutRows, meta, segmentRows, options) {
  const opt = normalizePdfOptions(options);
  const scope = opt.scope;
  const chapters = pdfScopeGroups(scope);
  const key = meta.calculation_key || result.calculation_key || "export";
  const pdf = newPdfDoc();
  const stats = meta.stats || computeCalculationStats(result);
  const marginX = 14;
  let y = 18;
  let first = true;

  // Poznámka uživatele patří do záhlaví titulní stránky — žlutě podbarvená
  // s vykřičníkem, aby ji nikdo nepřehlédl.
  y = drawPdfHeaderNote(pdf, y, opt.note, marginX);

  // Profil pobočky z exportu poboček — rating, zařazení, výnosy, nejlepší obchody.
  y = drawPdfBranchHeader(pdf, y, branchProfile(result.pobocka_id, result.pobocka_nazev), marginX);

  const startChapter = (chapterKey) => {
    const chapter = pdfChapter(chapterKey);
    if (!first) { pdf.addPage(); y = 18; }
    first = false;
    y = drawPdfChapterTitle(pdf, y, chapter, PDF_CHAPTERS.indexOf(chapter) + 1, marginX);
    return chapter;
  };

  if (chapters.includes("calc")) {
    const chapter = startChapter("calc");
    y = drawCalcChapterPdf(pdf, y, result, opt, stats, chapter);
  }
  if (chapters.includes("capacity")) {
    const chapter = startChapter("capacity");
    y = drawCapacityChapterPdf(pdf, y, result, opt, stats, chapter);
  }
  if (chapters.includes("layout") && layoutRows && layoutRows.length) {
    const chapter = startChapter("layout");
    y = drawLayoutChapterPdf(pdf, y, layoutRows, meta, segmentRows, opt, chapter);
  }

  const prefix = scope === "vse" ? "sestava"
    : scope === "navstevnost" ? "navstevnost" : scope === "layout" ? "layout" : "kalkulace";
  pdf.save(`${prefix}_${key}.pdf`);
  toast(`PDF (${PDF_SCOPES.find((x) => x.key === scope).label.toLowerCase()}) bylo vygenerováno.`, "ok");
}

/* --------------------------------- PDF ------------------------------------ */

// Pozice počítané do "obchodních FTE" pro stanovení formátu pobočky — přesný
// přepis obchodni_pozice z původního calculator.py (export_calculation_to_pdf).
// Zachováno včetně původní nedokonalosti: porovnává se s pozicí převedenou na
// malá písmena, takže položky s velkými písmeny uprostřed (např. "VCB",
// "Erste Premier") se nikdy neshodnou — to platilo i v původní aplikaci.
const OBCHODNI_POZICE = new Set([
  "firemní bankéř - medior", "firemní bankéř - master", "firemní bankéř - senior",
  "podpora firemních bankéřů", "spec. pro firemní pojištění - senior",
  "remote firemní bankéř - medior", "remote premier bankéř - medior",
  "hypoteční specialista VCB - medior", "hypoteční specialista VCB - senior",
  "bankéř klientské péče - junior", "bankéř klientské péče - medior",
  "investiční specialista - medior", "osobní bankéř - junior", "osobní bankéř - medior",
  "osobní bankéř - senior", "osobní bankéř - master", "pojišťovací specialista - medior",
  "hypoteční specialista - medior", "hypoteční specialista - senior", "pobočkový specialista - hypo",
  "manaž. segm. Erste Premier - team leader s portfoliem", "premier bankéř - medior",
  "premier bankéř - master", "premier bankéř - senior", "privátní bankéř - medior",
  "privátní bankéř - senior", "privátní bankéř - wealth management",
]);
const MEETING_ZONE_SUM_SEGMENTS = ["MMMA", "SBC", "HC"];

/* ------------------ Model špičky na bankovní hale -------------------------- */
// Kolik lidí je na pobočce naráz v nejsilnější hodině a co z toho plyne pro
// počet židlí v čekací zóně a počet fast tracků. Vychází z reálných návštěv
// z reportu návštěvnosti: vezme se nejsilnější hodina dne a přidá se rezerva na
// silný den (P95 = λ + 1.645·√λ — den, jaký přijde zhruba 1× za 20 otevíracích
// dní). Z počtu příchozích za hodinu se přes Littleho pravidlo (počet lidí
// v místě = příchody za hodinu × doba strávená v místě ÷ 60) dopočítá, kolik
// klientů sedí v čekací zóně naráz a kolik fast tracků je potřeba.
//
// Konstanty jsou na jednom místě, aby se daly upravit podle zkušeností z provozu.
const PEAK_MODEL = {
  Z: 1.645,              // rezerva na silný den (P95 ≈ 1× za 20 otevíracích dní)
  WAIT_MINS: 10,         // jak dlouho klient ve špičce průměrně čeká, než na něj přijde řada
  COMPANION_FACTOR: 1.2, // část klientů přijde ve dvou (doprovod) → víc židlí
  MIN_CHAIRS: 2,
  FASTTRACK_SHARE: 0.5,  // podíl bezhotovostních (walk-in) klientů, které obslouží fast track
  FASTTRACK_MINS: 10,    // jak dlouho trvá jedno vyřízení na fast tracku
  MIN_FASTTRACKS: 1,
};

const peakP95 = (lambda) => lambda + PEAK_MODEL.Z * Math.sqrt(lambda);

// `metrics` = výstup computeVisitorMetrics. Vrací null, pokud pobočka nemá
// v reportu použitelná data o návštěvách po hodinách.
function computePeakModel(metrics) {
  if (!metrics || !metrics.peakHour) return null;
  const arrivals = metrics.peakHour.total;
  const walkins = metrics.hours.reduce((a, r) => Math.max(a, r.walkins), 0);
  const bezhot = metrics.hours.reduce((a, r) => Math.max(a, r.bezhot), 0);
  const meetings = metrics.hours.reduce((a, r) => Math.max(a, r.meetings), 0);
  const arrivalsP95 = peakP95(arrivals);
  const walkinsP95 = peakP95(walkins);
  const chairsRaw = (arrivalsP95 * PEAK_MODEL.COMPANION_FACTOR * PEAK_MODEL.WAIT_MINS) / 60;
  const fasttracksRaw = (walkinsP95 * PEAK_MODEL.FASTTRACK_SHARE * PEAK_MODEL.FASTTRACK_MINS) / 60;
  return {
    hour: metrics.peakHour.hour,
    arrivals, arrivalsP95,
    walkins, walkinsP95, bezhot, bezhotP95: peakP95(bezhot),
    meetings, meetingsP95: peakP95(meetings),
    chairsRaw, fasttracksRaw,
    chairs: Math.max(PEAK_MODEL.MIN_CHAIRS, Math.ceil(chairsRaw)),
    fasttracks: Math.max(PEAK_MODEL.MIN_FASTTRACKS, Math.ceil(fasttracksRaw)),
  };
}

// Spočítá odvozené ukazatele kalkulace ze segmentových řádků (bez "Celkem"),
// řádku "Celkem" a vstupních pozic z checklistu. Používá se jak pro okamžité
// zobrazení po dokončení kalkulace, tak pro PDF export a pro zpětné dopočítání
// (backfill) starších kalkulací do tabulky calculation_stats.
function computeCalculationStats(result) {
  let meetingZoneSum = 0;
  result.rows.forEach((r) => {
    if (MEETING_ZONE_SUM_SEGMENTS.includes(r.segment)) meetingZoneSum += r.meeting_zone || 0;
  });

  let obchodniFteSum = 0;
  (result.inputRows || []).forEach((r) => {
    const segmentLower = String(r.segment).trim().toLowerCase();
    const pozLower = String(r.pozice).trim().toLowerCase();
    if (segmentLower !== "cestovní" && OBCHODNI_POZICE.has(pozLower)) obchodniFteSum += r.fte || 0;
  });

  let formatTyp;
  if (obchodniFteSum >= 25) formatTyp = "flagship";
  else if (obchodniFteSum >= 10) formatTyp = "medium";
  else if (obchodniFteSum >= 5) formatTyp = "medium economy";
  else formatTyp = "small";

  // Doporučený počet židlí v čekací zóně a fast tracků se počítá ze špičky
  // reálné návštěvnosti; když pro pobočku report nemáme, použije se původní
  // odhad z WPL (15 % / 50 % service + meeting zóny).
  let peak = null;
  try {
    const visitor = getVisitorForCalculation(result.calculation_key, result.pobocka_id, result.pobocka_nazev);
    if (visitor) peak = computePeakModel(computeVisitorMetrics(visitor));
  } catch (e) { /* bez dat návštěvnosti se použije odhad z WPL */ }

  const serviceZone = result.celkem.service_zone || 0;
  const meetingZoneTotal = result.celkem.meeting_zone || 0;
  const backofficeZone = result.celkem.backoffice_zone || 0;
  const officeRoom = result.celkem.office_room || 0;
  const celkemWpl = serviceZone + meetingZoneTotal + backofficeZone + officeRoom;
  const celkemFte = result.celkem.total_positions || 0;
  const combinedTotal = serviceZone + meetingZoneTotal;

  return {
    meetingZoneSum,
    obchodniFteSum,
    obchodniFteSumDisplay: round1(obchodniFteSum).toFixed(1),
    formatTyp,
    peak,
    recommendationSource: peak ? "report" : "wpl",
    recommendedFasttracks: peak ? peak.fasttracks : Math.ceil(combinedTotal * 0.15),
    recommendedChairs: peak ? peak.chairs : Math.ceil(combinedTotal * 0.50),
    celkemFte,
    celkemWpl,
    serviceZoneWpl: serviceZone,
    meetingZoneWpl: meetingZoneTotal,
    backofficeZoneWpl: backofficeZone,
    officeRoomWpl: officeRoom,
    requiredAreaM2: celkemWpl * PLAN_M2_PER_WPL,   // stejné pravidlo jako plochy místností ve schématu
    wplFteRatio: celkemFte > 0 ? (celkemWpl / celkemFte) * 100 : null,
    backofficePct: celkemWpl > 0 ? (backofficeZone / celkemWpl) * 100 : null,
    meetingPct: celkemWpl > 0 ? (meetingZoneTotal / celkemWpl) * 100 : null,
  };
}

function persistCalculationStats(calculationKey, loadKey, stats, createdAt) {
  db.run(`INSERT OR REPLACE INTO calculation_stats
    (calculation_key, load_key, format_typ, celkem_fte, celkem_wpl, wpl_fte_ratio, backoffice_pct, meeting_pct, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [calculationKey, loadKey, stats.formatTyp, stats.celkemFte, stats.celkemWpl,
      stats.wplFteRatio, stats.backofficePct, stats.meetingPct, createdAt]);
}

// Stav kalkulace — "rozpracovana" (výchozí, hned po spočítání) nebo "potvrzena"
// (uzavřená, ručně potvrzená uživatelem). Ukládá se na všechny řádky se stejným
// calculation_key (jsou vždy nastaveny shodně, mění se jen společně).
function getCalculationStatus(calculationKey) {
  const row = dbAll("SELECT status FROM calculations WHERE calculation_key = ? LIMIT 1", [calculationKey])[0];
  return (row && row.status) || "rozpracovana";
}

function setCalculationStatus(calculationKey, status) {
  dbRun("UPDATE calculations SET status = ? WHERE calculation_key = ?", [status, calculationKey]);
  persistDatabase(true);
}

function statusBadgeHtml(status) {
  const confirmed = status === "potvrzena";
  return `<span class="badge ${confirmed ? "ok" : "warn"}">${confirmed ? "Potvrzená / uzavřená" : "Rozpracovaná"}</span>`;
}

function getBenchmark(formatTyp) {
  const row = dbAll(`SELECT AVG(wpl_fte_ratio) AS avg_ratio, AVG(backoffice_pct) AS avg_backoffice,
    AVG(meeting_pct) AS avg_meeting, COUNT(*) AS n
    FROM calculation_stats WHERE format_typ = ?`, [formatTyp])[0];
  return row && row.n > 0 ? row : null;
}

// Dopočítá calculation_stats pro kalkulace uložené ještě před zavedením této
// funkce, aby benchmark fungoval i s dříve pořízenou historií.
function backfillCalculationStats() {
  const missing = dbAll(`
    SELECT DISTINCT c.calculation_key AS calculation_key, c.load_key AS load_key
    FROM calculations c
    LEFT JOIN calculation_stats cs ON cs.calculation_key = c.calculation_key
    WHERE cs.calculation_key IS NULL`);
  missing.forEach(({ calculation_key, load_key }) => {
    try {
      const rows = dbAll(`SELECT segment, total_positions, service_zone, meeting_zone, backoffice_zone, office_room, created_at
        FROM calculations WHERE calculation_key = ?`, [calculation_key]);
      const celkemRow = rows.find((r) => r.segment === "Celkem");
      const segmentRows = rows.filter((r) => r.segment !== "Celkem");
      if (!celkemRow) return;
      const inputRows = dbAll("SELECT segment, pozice, fte FROM excel_loads WHERE load_key = ?", [load_key]);
      const stats = computeCalculationStats({ rows: segmentRows, celkem: celkemRow, inputRows });
      persistCalculationStats(calculation_key, load_key, stats, celkemRow.created_at || nowIso());
    } catch (e) {
      console.warn("Nepodařilo se dopočítat calculation_stats pro", calculation_key, e);
    }
  });
}

// Vrátí [nepritomnost, homeoffice] pro daný segment ze snapshotu verze referenčních
// dat (formát [[segment, nepritomnost, homeoffice], ...]) — [0, 0], pokud chybí.
function absenceFromSnapshot(absenceSnapshot, segment) {
  const row = (absenceSnapshot || []).find((r) => r[0] === segment);
  return row ? [row[1] || 0, row[2] || 0] : [0, 0];
}

function newPdfDoc() {
  const { jsPDF } = window.jspdf;
  return new jsPDF();
}

// Vykreslení PDF je rozdělené po kapitolách (viz PDF_CHAPTERS): každá kapitola
// má vlastní funkci drawXxxChapterPdf(pdf, y, …) a exportPdfByScope() je skládá
// v pevném pořadí — kalkulace → kapacita pobočky → layout. Kapitoly začínají na
// nové stránce barevnou hlavičkou, sekce uvnitř mají barevný praporek.

/* --------- Soupis zaměstnanců na pobočce s pruhem vytížení zón ------------- */
// Místo prostého výpisu se pozice tisknou jako tabulka: segment (obarvený podle
// nastavení Segmenty), pozice, FTE, WPL a vodorovný pruh s rozdělením času po
// zónách podle časových dotací (ServiceZ / MeetingZ / BackofficeZ / OfficeRoom).
function drawInputPositionsPdf(pdf, startY, result, marginX, pageBottom, color) {
  const splits = dotaceSplitMap(result.refVersionId);
  const colW = [30, 62, 14, 14, 62];
  const rowH = 6.2;

  let y = drawPdfSectionTitle(pdf, startY, "Přehled pozic z checklistu", color, { need: 40, marginX, pageBottom });

  // Legenda zón
  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(7.2);
  let lx = marginX;
  ZONES.forEach((z) => {
    const [r, g, b] = hexToRgb(ZONE_COLORS[z]);
    pdf.setFillColor(r, g, b);
    pdf.rect(lx, y - 2.4, 2.6, 2.6, "F");
    pdf.setTextColor(90, 98, 112);
    pdf.text(ZONE_LABELS[z], lx + 3.6, y);
    lx += pdf.getTextWidth(ZONE_LABELS[z]) + 10;
  });
  pdf.setTextColor(0, 0, 0);
  y += 4.5;

  const headers = ["Segment", "Pozice", "FTE", "WPL", "Vytížení zón (% času)"];
  const drawHeader = () => {
    pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(7.6);
    let x = marginX;
    headers.forEach((h, i) => {
      pdf.setFillColor(39, 112, 240);
      pdf.setDrawColor(150, 160, 175);
      pdf.rect(x, y, colW[i], rowH, "FD");
      pdf.setTextColor(255, 255, 255);
      pdf.text(h, x + 1.6, y + 4.2);
      x += colW[i];
    });
    y += rowH;
    pdf.setTextColor(0, 0, 0);
  };
  drawHeader();

  result.inputRows.forEach((r) => {
    if (y + rowH > pageBottom) { pdf.addPage(); y = 18; drawHeader(); }
    const split = splits[`${r.segment}||${r.pozice}`];
    const wplDisplay = r.wpl_load ?? result.oteviraci_doba;
    const vals = [r.segment, r.pozice, fmt1(r.fte), fmt1(wplDisplay)];
    let x = marginX;
    vals.forEach((v, i) => {
      // Buňka segmentu se podbarví jeho barvou ze „Segmentů“ (světlý odstín).
      if (i === 0) {
        const [sr, sg, sb] = segmentTintRgb(r.segment);
        pdf.setFillColor(sr, sg, sb);
      } else {
        pdf.setFillColor(255, 255, 255);
      }
      pdf.setDrawColor(150, 160, 175);
      pdf.rect(x, y, colW[i], rowH, "FD");
      pdf.setTextColor(0, 0, 0);
      pdf.setFont("DejaVuSans", i === 0 ? "bold" : "normal"); pdf.setFontSize(7.4);
      pdf.text(String(v), x + 1.6, y + 4.2, { maxWidth: colW[i] - 3 });
      x += colW[i];
    });

    // Pruh vytížení zón
    pdf.setFillColor(255, 255, 255); pdf.setDrawColor(150, 160, 175);
    pdf.rect(x, y, colW[4], rowH, "FD");
    const total = zoneSplitTotal(split);
    const barX = x + 1.6; const barW = colW[4] - 3.2; const barY = y + 1.4; const barH = rowH - 2.8;
    if (!total) {
      pdf.setTextColor(120, 128, 140); pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(6.6);
      pdf.text("bez časové dotace", barX, y + 4.2);
    } else {
      const scale = Math.max(100, total);
      pdf.setFillColor(...hexToRgb(ZONE_REST_COLOR));
      pdf.rect(barX, barY, barW, barH, "F");
      let bx = barX;
      ZONES.forEach((z) => {
        const v = Number(split[z]) || 0;
        if (v <= 0) return;
        const w = (v / scale) * barW;
        pdf.setFillColor(...hexToRgb(ZONE_COLORS[z]));
        pdf.rect(bx, barY, w, barH, "F");
        if (w > 7) {
          pdf.setTextColor(255, 255, 255); pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(5.6);
          pdf.text(`${Math.round(v)}`, bx + w / 2, barY + barH - 0.7, { align: "center" });
        }
        bx += w;
      });
    }
    pdf.setTextColor(0, 0, 0);
    y += rowH;
  });

  pdf.setDrawColor(0, 0, 0);
  return y + 5;
}

/* ------------------ 1. kapitola: Kalkulace FTE → WPL ----------------------- */
// Obsah kapitoly v pořadí, v jakém je i v boxu „Co se má vygenerovat“:
// šedý blok s detaily → přehled pozic z checklistu → souhrnná tabulka
// (WPL po zónách) → klíčové ukazatele a benchmark → upozornění z výpočtu.
function drawCalcChapterPdf(pdf, startY, result, opt, stats, chapter) {
  const marginX = PDF_MARGIN_X;
  const pageBottom = PDF_PAGE_BOTTOM;
  const color = chapter.color;
  let y = startY;

  if (opt.detailBox) {
    const version = result.refVersionId ? getRefVersionById(result.refVersionId) : null;
    const presentSegments = [...new Set((result.inputRows || []).map((r) => r.segment))];
    const detailLines = [
      `Název pobočky: ${result.pobocka_nazev}`,
      `ID pobočky: ${result.pobocka_id}`,
      `Otevírací doba: ${result.oteviraci_doba} h/týden`,
      `Doba vytížení WPL: ${result.doba_vytezeni_wpl ?? result.oteviraci_doba} h/týden`
        + `${result.shiftMode ? " — pobočka se směnovým režimem" : ""}`,
      `Load key: ${result.load_key}`,
      `Calculation key: ${result.calculation_key}`,
      `Datum vytvoření: ${new Date(result.createdAt).toLocaleString("cs-CZ")}`,
    ];
    // Spádové pobočky: co se do kalkulace připočetlo (aby to bylo i v tisku).
    const cm = catchmentSummary(result.load_key, result.pobocka_id, result.pobocka_nazev);
    if (cm) {
      detailLines.push(`Spádové pobočky: ${cm.branches.map((b) => `${b.source_name}`
        + ` (přesun ${fmt1(b.transfer_pct)} %, +${fmt1(b.fte_total)} FTE)`).join(", ")}`);
      detailLines.push(`Připočteno ze spádových poboček: +${fmt1(cm.fte)} FTE`
        + `${cm.visitsDay ? `, +${fmt1(cm.visitsDay)} návštěv/den` : ""}`
        + `${cm.pct ? ` (návštěvnost +${fmt1(cm.pct)} %)` : ""}`);
    }
    const sf = result.shiftMode ? shiftFactor(result.oteviraci_doba, result.doba_vytezeni_wpl) : null;
    if (sf) {
      detailLines.push(`Směnový režim: jedna pozice pokryje ${Math.round(sf.coverage * 100)} % otevírací doby,`
        + ` na plné pokrytí jednoho pracovního místa je potřeba ${fmt1(sf.ftePerSeat)} FTE.`);
    }
    if (opt.refData) {
      if (version) {
        detailLines.push(`Referenční data: verze #${version.id} — ${version.note}`
          + ` (${new Date(version.created_at).toLocaleString("cs-CZ")})`);
        const absenceParts = presentSegments.map((seg) => {
          const [nepritomnost, homeoffice] = absenceFromSnapshot(version.absence, seg);
          return `${seg} ${(nepritomnost + homeoffice).toFixed(1)} %`;
        });
        detailLines.push(`Celková nepřítomnost dle segmentů: ${absenceParts.join(", ")}`);
      } else {
        detailLines.push("Referenční data: verze neznámá (kalkulace vytvořena před zavedením verzování).");
      }
    }
    y = drawPdfDetailBox(pdf, y, detailLines, marginX, pageBottom);
    y += 3;
  }

  if (opt.inputPositions && (result.inputRows || []).length) {
    y = drawInputPositionsPdf(pdf, y, result, marginX, pageBottom, color);
  }

  if (opt.summaryTable) {
    y = drawPdfSectionTitle(pdf, y, "Souhrnná tabulka (WPL po zónách)", color, { need: 40 });

    const headers = ["Segment", "FTE", "ServiceZ", "MeetingZ", "BackofficeZ", "OfficeRoom"];
    const colW = [46, 20, 26, 26, 30, 26];
    const rowH = 7;

    // Poznámka: setFillColor/setTextColor se volají znovu před KAŽDOU buňkou,
    // ne jednou před smyčkou — jsPDF si barvu vyplně a barvu textu ukládá do
    // společné interní cache, takže prokládané kreslení obdélníku a textu by
    // jinak po první buňce tuto cache rozjelo a další buňky by se vykreslily
    // bez výplně / bílým textem na bílém pozadí.
    const drawHeader = () => {
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
    };

    const drawRow = (vals, fill) => {
      if (y + rowH > pageBottom) { pdf.addPage(); y = 18; drawHeader(); }
      pdf.setFont("DejaVuSans", fill ? "bold" : "normal"); pdf.setFontSize(9);
      let x = marginX;
      vals.forEach((v, i) => {
        let cellFilled = fill;
        if (fill) pdf.setFillColor(200, 240, 210);
        else if (i === 0 && v !== "Celkem") { pdf.setFillColor(...segmentTintRgb(v)); cellFilled = true; }
        pdf.rect(x, y, colW[i], rowH, cellFilled ? "FD" : "D");
        pdf.setTextColor(0, 0, 0);
        let textX = x + 2;
        if (i === 0 && v !== "Celkem") {
          const [r, g, b] = hexToRgb(getSegmentMeta(v).color);
          pdf.setFillColor(r, g, b);
          pdf.rect(x + 2, y + 2, 3, 3, "F");
          textX += 4.5;
        }
        pdf.text(String(v), textX, y + 5);
        x += colW[i];
      });
      y += rowH;
    };

    drawHeader();
    result.rows.forEach((r) => drawRow([r.segment, fmt1(r.total_positions), fmt1(r.service_zone),
      fmt1(r.meeting_zone), fmt1(r.backoffice_zone), fmt1(r.office_room)]));
    drawRow(["Celkem", fmt1(result.celkem.total_positions), fmt1(result.celkem.service_zone),
      fmt1(result.celkem.meeting_zone), fmt1(result.celkem.backoffice_zone), fmt1(result.celkem.office_room)], true);

    y = drawPdfSubTitle(pdf, y, "Doporučení z kalkulace", { space: 6 });
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(8.6);
    const celkemSum = (result.celkem.service_zone || 0) + (result.celkem.meeting_zone || 0) +
                       (result.celkem.backoffice_zone || 0) + (result.celkem.office_room || 0);
    [
      `Celkový součet zón z řádku „Celkem“: ${celkemSum.toFixed(2)} WPL`,
      `Součet meeting_zone pro segmenty MMMA, SBC, HC: ${stats.meetingZoneSum.toFixed(2)}`,
      `Stanovený formát dle počtu (${stats.obchodniFteSumDisplay}) obchodních FTE: ${stats.formatTyp}`,
      `Doporučený počet fasttracků na hale: ${stats.recommendedFasttracks} (${recommendationNote(stats, "fasttracks")})`,
      `Doporučený počet židlí v čekací zóně: ${stats.recommendedChairs} (${recommendationNote(stats, "chairs")})`,
      `Potřebná plocha (WPL × 25 m²): ${stats.requiredAreaM2.toFixed(1)} m²`,
    ].forEach((line) => {
      pdf.splitTextToSize(line, PDF_CONTENT_W).forEach((l) => {
        if (y > pageBottom) { pdf.addPage(); y = 18; }
        pdf.text(l, marginX, y); y += 5.2;
      });
    });
    y += 2;
  }

  if (opt.includeStats) {
    y = drawPdfSectionTitle(pdf, y, "Klíčové ukazatele a benchmark", color, { need: 34 });
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(9);
    const benchmark = getBenchmark(stats.formatTyp);
    const pctOrDash = (v) => (v === null || v === undefined || Number.isNaN(v)) ? "—" : `${v.toFixed(1)} %`;
    const withBenchmark = (label, value, avg) => {
      let line = `${label}: ${pctOrDash(value)}`;
      if (benchmark && value !== null && avg !== null && avg !== undefined) {
        const diff = value - avg;
        line += ` (benchmark ${stats.formatTyp}: ${pctOrDash(avg)}, rozdíl ${diff >= 0 ? "+" : ""}${diff.toFixed(1)} p.b.)`;
      }
      return line;
    };
    [
      withBenchmark("Poměr WPL / FTE", stats.wplFteRatio, benchmark?.avg_ratio),
      withBenchmark("Podíl Backoffice zóny", stats.backofficePct, benchmark?.avg_backoffice),
      withBenchmark("Podíl míst pro jednání s klientem (meeting zone)", stats.meetingPct, benchmark?.avg_meeting),
    ].forEach((line) => {
      pdf.splitTextToSize(line, PDF_CONTENT_W).forEach((l) => {
        if (y > pageBottom) { pdf.addPage(); y = 18; }
        pdf.text(l, marginX, y); y += 5.5;
      });
    });
    y += 1.5;
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(8);
    pdf.setTextColor(120, 120, 120);
    pdf.text(benchmark ? `Benchmark vychází z ${czechCalcCount(benchmark.n)} s formátem „${stats.formatTyp}“.`
      : `Zatím není dostatek kalkulací pro benchmark formátu „${stats.formatTyp}“.`, marginX, y);
    pdf.setTextColor(0, 0, 0);
    y += 4;
  }

  if (opt.warnings && (result.warnings || []).length) {
    y = drawPdfSectionTitle(pdf, y, "Upozornění z výpočtu", color, { need: 20, size: 10.5 });
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(9);
    result.warnings.forEach((w) => {
      pdf.splitTextToSize(w, 178).forEach((line) => {
        if (y > pageBottom) { pdf.addPage(); y = 18; }
        pdf.text(line, marginX + 2, y); y += 5;
      });
    });
    y += 2;
  }

  return y;
}

/* -------------------- 2. kapitola: Kapacita pobočky ------------------------ */
// Roční kapacita → návštěvnost a doporučení prostor → návštěvy na bankéře →
// Monte Carlo (hodinová poptávka) → distribuce denní poptávky → kapacitní
// shrnutí → tři kontroly míst pro schůzky.
function drawCapacityChapterPdf(pdf, startY, result, opt, stats, chapter) {
  const marginX = PDF_MARGIN_X;
  const pageBottom = PDF_PAGE_BOTTOM;
  const color = chapter.color;
  let y = startY;
  const visitor = getVisitorForCalculation(result.calculation_key, result.pobocka_id, result.pobocka_nazev);

  if (opt.yearCapacity) {
    y = drawYearCapacityPdf(pdf, y, computeYearCapacity({ stats, visitor, calcResult: result }),
      marginX, pageBottom, color);
  }

  const wantsVisitor = opt.includeVisitor || opt.visitorBankers || opt.visitorMcHours || opt.visitorMcDist;
  if (wantsVisitor) {
    if (visitor) {
      y = drawVisitorPdf(pdf, y, visitor, marginX, pageBottom, stats, {
        recommendations: opt.includeVisitor,
        bankers: opt.visitorBankers,
        mcHours: opt.visitorMcHours,
        mcDist: opt.visitorMcDist,
        inputRows: result.inputRows,
        color,
      });
    } else {
      y = drawPdfSectionTitle(pdf, y, "Návštěvnost a doporučení prostor", color, { need: 16 });
      pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(9);
      pdf.setTextColor(120, 120, 120);
      pdf.text("Pro tuto pobočku nejsou naimportovaná data návštěvnosti.", marginX, y);
      pdf.setTextColor(0, 0, 0);
      y += 6;
    }
  }

  if (opt.plainSummary || opt.meetingChecks) {
    y = drawCapacityCheckPdf(pdf, y, result, stats, marginX, pageBottom,
      { summary: opt.plainSummary, meetingChecks: opt.meetingChecks, color });
  }

  return y;
}

/* ==================== Návštěvnost a doporučení prostor ===================== */
// Data pocházejí z HTML reportu návštěvnosti („Analýza návštěvnosti“), který má
// všechna čísla vložená přímo v sobě jako JS objekt `const DATA = {…}` (klíčem
// je ID pobočky) a konstanty modelu jako `const C = {…}`. Import report načte
// v prohlížeči, vytáhne z něj obě struktury a uloží si pro každou pobočku tu
// část, kterou kalkulace používá: doporučení prostor, návštěvy po hodinách a
// Monte Carlo model. Při spočítání kalkulace se data pobočky uloží i jako
// snapshot ke kalkulaci (tabulka calculation_visitor), aby zůstala kalkulace
// zpětně reprodukovatelná i po importu novějšího reportu.

const VISITOR_CONSTS_DEFAULT = {
  MEETING_MINS: 45,
  WALKIN_AVG_MINS: 15,
  ABSENCE_RATE: 0.229,
  MC_ITERATIONS: 1000,
  WORK_MINS_DAY: 450,
};

// Řady Monte Carla mají 16 hodnot a pokrývají hodiny 6–21 (v reportu je graf
// „P95 FTE poptávka po hodinách (6h–21h)“); by_hour má 24 hodnot (index = hodina).
const VISITOR_MC_HOUR_FROM = 6;
const VISITOR_MC_HOURS = 16;

// Typy návštěv v reportu. Do doporučení prostor vstupují stejné dvě skupiny
// jako v reportu: schůzky (online + fyzická) → zasedací místnosti,
// bezhotovostní obsluha (walk-in) → servisní místa.
const VISITOR_TYPES = [
  { key: "fyzicka", label: "Fyzická schůzka", color: "#2770f0" },
  { key: "online", label: "Online schůzka", color: "#7c3aed" },
  { key: "bezhot", label: "Bezhotovostní obsluha", color: "#0891b2" },
  { key: "hotovost", label: "Hotovostní obsluha", color: "#d97706" },
];

// Pole z reportu, která si aplikace ukládá — ostatní (heatmapy, měsíční a denní
// řady, prodeje, benchmark) kalkulace nepotřebuje a jen by nadouvala databázi.
const VISITOR_KEEP_KEYS = ["name", "fte", "bankers", "svc_fte", "has_svc", "cashier_fte", "has_cash",
  "poc_kli", "total", "by_type", "by_hour", "by_weekday", "n_days", "n_days_wd", "has_time",
  "annual_open_days", "ph_tyden", "is_vikend", "od_days", "branch_format", "rooms", "mc", "mc_boost"];

// Role u klienta se určují podle přesných názvů pozic z checklistu:
//   • schůzky (osobní bankéři) — osobní bankéř junior / medior / senior / master,
//   • servisní obsluha — hlavně bankéř klientské péče - medior, servis zvládne
//     i osobní bankéř - junior (proto je v obou rolích),
//   • pokladna (pobočka s hotovostí, tedy ne cashless) — bankéř klientské péče
//     - junior.
const ROLE_POSITIONS = {
  ob: ["osobní bankéř - junior", "osobní bankéř - medior", "osobní bankéř - senior", "osobní bankéř - master"],
  serviceCore: ["bankéř klientské péče - medior"],
  serviceAlso: ["osobní bankéř - junior"],
  cashier: ["bankéř klientské péče - junior"],
};

const WEEKDAY_NAMES = ["Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota", "Neděle"];

/* ----------------------------- Import reportu ------------------------------ */

// Najde v textu deklaraci `const <name> = {` a vrátí naparsovaný objektový
// literál (v reportu je to čisté JSON). Závorky se párují s ohledem na
// řetězce, aby import neskončil na apostrofu nebo závorce v názvu pobočky.
function extractJsObjectLiteral(text, name) {
  const decl = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{`);
  const m = decl.exec(text);
  if (!m) return null;
  const start = text.indexOf("{", m.index);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error(`Deklaraci „${name}“ v reportu nešlo dočíst — chybí uzavírací závorka.`);
}

function parseVisitorReport(text) {
  const data = extractJsObjectLiteral(text, "DATA");
  if (!data) throw new Error("Tohle není report návštěvnosti — nenašel jsem v souboru data (const DATA).");
  const consts = extractJsObjectLiteral(text, "C") || VISITOR_CONSTS_DEFAULT;
  const titleMatch = /<title>([^<]*)<\/title>/i.exec(text);
  const branches = Object.entries(data).map(([id, d]) => {
    const payload = {};
    VISITOR_KEEP_KEYS.forEach((k) => { if (d[k] !== undefined) payload[k] = d[k]; });
    return { pobocka_id: String(id), nazev: d.name || "", payload };
  });
  return { title: titleMatch ? titleMatch[1].trim() : "Report návštěvnosti", consts, branches };
}

async function handleVisitorReportFile(file) {
  const statusEl = document.getElementById("visitorImportStatus");
  if (!db) { toast("Nejprve otevřete nebo vytvořte databázi.", "err"); return; }
  statusEl.innerHTML = `<div class="msg">Načítám report ${esc(file.name)}…</div>`;
  try {
    const text = await file.text();
    const parsed = parseVisitorReport(text);
    if (!parsed.branches.length) throw new Error("Report neobsahuje žádnou pobočku.");
    const importedAt = nowIso();
    const constsJson = JSON.stringify(parsed.consts);
    const ins = db.prepare(`INSERT OR REPLACE INTO visitor_data
      (pobocka_id, nazev, imported_at, source, report_title, consts_json, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    parsed.branches.forEach((b) => {
      ins.run([b.pobocka_id, b.nazev, importedAt, file.name, parsed.title, constsJson, JSON.stringify(b.payload)]);
    });
    ins.free();
    await persistDatabase();
    const fromReport = parsed.branches.filter((b) => b.payload.rooms).length;
    statusEl.innerHTML = `<div class="msg ok">Report <strong>${esc(parsed.title)}</strong>
      (${esc(file.name)}) načten: <strong>${parsed.branches.length}</strong> poboček,
      z toho ${fromReport} s doporučením prostor přímo z reportu — u ostatních se doporučení dopočítá
      z návštěv po hodinách stejným vzorcem.</div>`;
    renderVisitorList();
    toast(`Načteno ${parsed.branches.length} poboček z reportu návštěvnosti.`, "ok");
  } catch (e) {
    console.error(e);
    statusEl.innerHTML = `<div class="msg err">Report se nepodařilo načíst: ${esc(e.message)}</div>`;
  }
}

/* --------------- Spádové pobočky (spadove_pobocky.xlsx) -------------------- */
// Soubor říká, kam by šli klienti z dané pobočky: jeden řádek = jedna pobočka
// (sloupec „ID Pobočky“) a k ní až tři spádové pobočky se sloupci
// „Spádová pobočka N“, „Spád. návštěvy N“, „Spád. podíl N“, „Vzdálenost km N“
// a „Odhad přesunu % N“.
//
// V kalkulaci se to používá obráceně: pro počítanou pobočku se hledají řádky,
// kde je jako spádová pobočka právě ona — to jsou pobočky, ze kterých k ní
// mohou přejít klienti (a s nimi i zaměstnanci).

const CATCHMENT_SLOTS = [1, 2, 3];

// „2 382“ → 2382, „0.6 %“ → 0.6, „5.1 km“ → 5.1, „—“ → null.
function catchNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = String(v).replace(/[\s ]/g, "").replace(",", ".");
  if (!t || t === "—" || t === "-" || t === "–") return null;
  const m = /-?\d+(\.\d+)?/.exec(t);
  return m ? parseFloat(m[0]) : null;
}

function catchText(v) {
  const t = String(v === null || v === undefined ? "" : v).trim();
  return !t || t === "—" || t === "-" || t === "–" ? "" : t;
}

// Porovnání názvů poboček — bez diakritiky, bez interpunkce, malými písmeny.
function branchKey(name) {
  return normHeader(name);
}

function parseCatchment(workbook) {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],
    { header: 1, blankrows: false });
  if (!rows.length) throw new Error("List je prázdný.");
  const header = (rows[0] || []).map((h) => String(h === null || h === undefined ? "" : h).trim());
  const norm = header.map(normHeader);
  const idx = (test) => norm.findIndex(test);

  const cId = idx((n) => n === "id pobocky" || n === "id pobocka" || n === "id");
  const cName = idx((n) => n.startsWith("nazev pobocky"));
  const cRegion = idx((n) => n === "region");
  if (cId < 0) throw new Error(`Chybí sloupec „ID Pobočky“ (nalezeno: ${header.slice(0, 3).join(", ")}).`);

  // Sloupce pro každou ze tří spádových poboček.
  const slots = CATCHMENT_SLOTS.map((i) => ({
    slot: i,
    name: idx((n) => n === `spadova pobocka ${i}`),
    visits: idx((n) => n.startsWith("spad navstevy") && n.endsWith(String(i))),
    share: idx((n) => n.startsWith("spad podil") && n.endsWith(String(i))),
    distance: idx((n) => n.startsWith("vzdalenost km") && n.endsWith(String(i))),
    transfer: idx((n) => n.includes("odhad presunu") && n.endsWith(String(i))),
  })).filter((s) => s.name >= 0);
  if (!slots.length) throw new Error("Nenašel jsem ani jeden sloupec „Spádová pobočka N“.");

  const out = [];
  let branches = 0;
  rows.slice(1).forEach((r) => {
    const sourceId = catchText(r[cId]);
    const sourceName = cName >= 0 ? catchText(r[cName]) : "";
    if (!sourceId && !sourceName) return;
    branches++;
    slots.forEach((sl) => {
      const target = catchText(r[sl.name]);
      if (!target) return;
      out.push({
        source_id: sourceId, source_name: sourceName,
        region: cRegion >= 0 ? catchText(r[cRegion]) : "",
        slot: sl.slot, target_name: target,
        visits: sl.visits >= 0 ? catchNum(r[sl.visits]) : null,
        share: sl.share >= 0 ? catchNum(r[sl.share]) : null,
        distance_km: sl.distance >= 0 ? catchNum(r[sl.distance]) : null,
        transfer_pct: sl.transfer >= 0 ? catchNum(r[sl.transfer]) : null,
      });
    });
  });
  return { rows: out, branches, slots: slots.length };
}

async function handleCatchmentFile(file) {
  if (!requireDb()) return null;
  const data = new Uint8Array(await file.arrayBuffer());
  const parsed = parseCatchment(XLSX.read(data, { type: "array" }));
  const importedAt = nowIso();
  dbRun("DELETE FROM catchment");
  const ins = db.prepare(`INSERT INTO catchment
    (source_id, source_name, region, slot, target_name, visits, share, distance_km, transfer_pct,
     imported_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  parsed.rows.forEach((r) => {
    ins.run([r.source_id, r.source_name, r.region, r.slot, r.target_name, r.visits, r.share,
      r.distance_km, r.transfer_pct, importedAt, file.name]);
  });
  ins.free();
  await persistDatabase();
  return { pairs: parsed.rows.length, branches: parsed.branches };
}

function catchmentInfo() {
  if (!db) return null;
  try {
    const row = dbAll(`SELECT COUNT(*) AS n, COUNT(DISTINCT source_id) AS branches,
      MAX(imported_at) AS imported_at, MAX(source) AS source FROM catchment`)[0];
    return row && row.n ? row : null;
  } catch (e) { return null; }
}

// Pobočky, ze kterých mohou klienti přejít na počítanou pobočku (našeptávání).
// Hledá se podle názvu počítané pobočky ve sloupcích „Spádová pobočka N“.
function catchmentSuggestions(pobockaNazev) {
  if (!db || !pobockaNazev) return [];
  try {
    const key = branchKey(pobockaNazev);
    return dbAll("SELECT * FROM catchment").filter((r) => branchKey(r.target_name) === key)
      .map((r) => ({
        source_id: r.source_id, source_name: r.source_name, region: r.region,
        slot: r.slot, visits: r.visits, share: r.share, distance_km: r.distance_km,
        transfer_pct: r.transfer_pct,
      }))
      .sort((a, b) => (b.transfer_pct || 0) - (a.transfer_pct || 0) || (b.visits || 0) - (a.visits || 0));
  } catch (e) { return []; }
}

/* --------- FTE spádové pobočky: z databáze, nebo zadané ručně -------------- */
// „Z databáze“ = obsazenost z exportu specialistů; když pobočka v exportu není,
// zkusí se poslední načtený checklist té pobočky (tabulka excel_loads).

function catchmentFteFromDb(sourceId, sourceName) {
  const known = positionSegmentMap();
  const row = specialistRowFor(sourceId, sourceName);
  if (row) {
    const counts = JSON.parse(row.payload || "{}");
    const rows = Object.entries(counts).map(([pozice, fte]) => {
      const found = known[normalizePozice(pozice)];
      return { segment: found ? found.segment : "OSTATNÍ", pozice: found ? found.pozice : pozice,
        fte: Number(fte) || 0 };
    }).filter((r) => r.fte > 0);
    if (rows.length) return { rows, origin: `export specialistů (${row.branch_name || row.branch_id})` };
  }
  // záloha: poslední checklist té pobočky
  try {
    const load = dbAll(`SELECT load_key FROM excel_loads
      WHERE (pobocka_id = ? OR LOWER(pobocka_nazev) = ?) AND source_branch IS NULL
      ORDER BY id DESC LIMIT 1`, [String(sourceId || ""), String(sourceName || "").toLowerCase()])[0];
    if (load) {
      const rows = dbAll(`SELECT segment, pozice, fte FROM excel_loads
        WHERE load_key = ? AND source_branch IS NULL AND fte > 0`, [load.load_key])
        .map((r) => ({ segment: r.segment, pozice: r.pozice, fte: Number(r.fte) || 0 }));
      if (rows.length) return { rows, origin: "poslední načtený checklist pobočky" };
    }
  } catch (e) { /* starší databáze */ }
  return { rows: [], origin: null };
}

// Návštěvy spádové pobočky z reportu návštěvnosti (pokud je naimportovaný).
function catchmentVisits(sourceId, sourceName) {
  const v = getVisitorData(sourceId, sourceName);
  if (!v) return null;
  const m = computeVisitorMetrics(v);
  return { visitsTotal: Number(v.d.total) || 0, visitsPerDay: m && m.visitsPerDay ? m.visitsPerDay : null,
    days: Number(v.d.n_days) || 0, nazev: v.nazev };
}

/* ------------------- Výběr spádových poboček ke checklistu ------------------ */

function getCatchmentSelection(loadKey) {
  if (!db || !loadKey) return [];
  try {
    return dbAll("SELECT * FROM catchment_selection WHERE load_key = ? ORDER BY id", [loadKey])
      .map((r) => ({ ...r, rows: r.payload ? JSON.parse(r.payload) : [] }));
  } catch (e) { return []; }
}

// Uloží výběr a rovnou zapíše/odepíše převzaté pozice ve vstupních řádcích
// checklistu (excel_loads se sloupcem source_branch), aby s nimi kalkulace
// počítala úplně stejně jako s vlastními FTE pobočky.
async function saveCatchmentSelection(load, selections) {
  if (!db || !load || !load.load_key) return;
  const loadKey = load.load_key;
  dbRun("DELETE FROM catchment_selection WHERE load_key = ?", [loadKey]);
  dbRun("DELETE FROM excel_loads WHERE load_key = ? AND source_branch IS NOT NULL", [loadKey]);

  const insSel = db.prepare(`INSERT INTO catchment_selection
    (load_key, source_id, source_name, transfer_pct, fte_mode, fte_total, visits_day, visits_total, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insRow = db.prepare(`INSERT INTO excel_loads
    (load_key, pobocka_id, pobocka_nazev, oteviraci_doba, shift_mode, segment, pozice, fte, wpl_load,
     created_at, source_branch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const createdAt = nowIso();
  selections.forEach((sel) => {
    const share = (Number(sel.transfer_pct) || 0) / 100;
    const fteTotal = (sel.rows || []).reduce((sum, r) => sum + (Number(r.fte) || 0), 0);
    insSel.run([loadKey, sel.source_id || "", sel.source_name, Number(sel.transfer_pct) || 0,
      sel.fte_mode || "db", round1(fteTotal), sel.visits_day ?? null, sel.visits_total ?? null,
      JSON.stringify(sel.rows || [])]);
    // Převzaté pozice se do checklistu zapíšou s vlastní dobou vytížení jako
    // ostatní řádky (u CESTOVNÍ vlastní hodnota, jinak podle otevírací doby).
    (sel.rows || []).forEach((r) => {
      const fte = Number(r.fte) || 0;
      if (fte <= 0) return;
      const isCestovni = String(r.segment).trim().toUpperCase().startsWith("CESTOVNÍ");
      insRow.run([loadKey, load.pobocka_id, load.pobocka_nazev, load.oteviraci_doba,
        load.shiftMode ? 1 : 0, r.segment, r.pozice, round1(fte),
        isCestovni ? (Number(r.wpl_load) || load.oteviraci_doba) : load.oteviraci_doba,
        createdAt, sel.source_name]);
    });
  });
  insSel.free();
  insRow.free();
  await persistDatabase();

  // pendingLoad drží řádky, ze kterých se počítá — načtou se znovu z databáze
  if (pendingLoad && pendingLoad.load_key === loadKey) {
    pendingLoad.rows = dbAll(`SELECT segment, pozice, fte, wpl_load, source_branch FROM excel_loads
      WHERE load_key = ? ORDER BY id`, [loadKey])
      .map((r) => ({ segment: r.segment, pozice: r.pozice, fte: r.fte, wpl_load: r.wpl_load,
        source_branch: r.source_branch || null }));
  }
}

// Souhrn: kolik FTE a kolik návštěv spádové pobočky přidávají.
function catchmentSummary(loadKey, pobockaId, pobockaNazev) {
  const sel = getCatchmentSelection(loadKey);
  if (!sel.length) return null;
  const own = catchmentVisits(pobockaId, pobockaNazev);
  const fte = sel.reduce((s, x) => s + (Number(x.fte_total) || 0), 0);
  const visitsDay = sel.reduce((s, x) => s + (Number(x.visits_day) || 0), 0);
  const visitsTotal = sel.reduce((s, x) => s + (Number(x.visits_total) || 0), 0);
  const ownDay = own && own.visitsPerDay ? own.visitsPerDay : null;
  return {
    branches: sel,
    fte: round1(fte),
    visitsDay: Math.round(visitsDay * 10) / 10,
    visitsTotal: Math.round(visitsTotal),
    ownVisitsDay: ownDay,
    ownVisitsTotal: own ? own.visitsTotal : null,
    // Poměr, kterým se přiškálují návštěvy z reportu (1 = bez změny).
    factor: ownDay && ownDay > 0 ? 1 + visitsDay / ownDay : 1,
    pct: ownDay && ownDay > 0 ? (visitsDay / ownDay) * 100 : null,
  };
}

/* --------- Přiškálování návštěvnosti o návštěvy ze spádových poboček ------- */
// Návštěvy (a poptávka, která z nich lineárně vychází) se vynásobí poměrem.
// Pravděpodobnost přetížení z reportu se nepřepočítává — není lineární, proto
// je taková sekce v aplikaci označená štítkem „ze spádových poboček“.
function scaleVisitorForCatchment(visitor, factor) {
  if (!visitor || !(factor > 1.0001)) return visitor;
  const copy = JSON.parse(JSON.stringify(visitor));
  const d = copy.d || {};
  const mul = (obj, keys) => keys.forEach((k) => {
    if (typeof obj[k] === "number") obj[k] *= factor;
  });
  mul(d, ["total", "poc_kli"]);
  if (d.by_type) Object.keys(d.by_type).forEach((k) => {
    if (typeof d.by_type[k] === "number") d.by_type[k] *= factor;
  });
  [d.by_hour, d.by_weekday].forEach((map) => {
    if (!map) return;
    Object.keys(map).forEach((k) => {
      const v = map[k];
      if (typeof v === "number") map[k] = v * factor;
      else if (v && typeof v === "object") Object.keys(v).forEach((kk) => {
        if (typeof v[kk] === "number") v[kk] *= factor;
      });
    });
  });
  [d.mc, d.mc_boost].forEach((mc) => {
    if (!mc) return;
    ["lam_online", "lam_fyzicka", "lam_bezhot", "p50_util", "p95_util", "p95_ob_fte", "p95_svc_fte"]
      .forEach((k) => { if (Array.isArray(mc[k])) mc[k] = mc[k].map((x) => (Number(x) || 0) * factor); });
    mul(mc, ["ob_p95_day", "svc_p95_day"]);
  });
  // Doporučení prostor z reportu platí pro původní návštěvnost — po přiškálování
  // se smaže, aby si aplikace doporučení dopočítala z upravených návštěv sama.
  delete d.rooms;
  copy.catchmentFactor = factor;
  return copy;
}

// Data návštěvnosti pro kalkulaci včetně navýšení ze spádových poboček.
function visitorWithCatchment(visitor, loadKey, pobockaId, pobockaNazev) {
  const sum = catchmentSummary(loadKey, pobockaId, pobockaNazev);
  if (!visitor || !sum || !(sum.factor > 1.0001)) return visitor;
  return scaleVisitorForCatchment(visitor, sum.factor);
}

/* ---------- Spádové pobočky: panel u načteného checklistu (UI) ------------- */

const catchmentUi = {};   // load_key -> rozpracovaný výběr (než se uloží)

const CATCHMENT_DEFAULT_DAYS = 250;   // odhad otevíracích dnů, když je neznáme

// Kolik návštěv převezme počítaná pobočka z jedné spádové pobočky.
function catchmentBranchVisits(sel, suggestion) {
  const share = (Number(sel.transfer_pct) || 0) / 100;
  const v = catchmentVisits(sel.source_id, sel.source_name);
  if (v && (v.visitsPerDay || v.visitsTotal)) {
    const perDay = v.visitsPerDay || (v.visitsTotal / (v.days || CATCHMENT_DEFAULT_DAYS));
    return { day: perDay * share, total: (v.visitsTotal || perDay * (v.days || CATCHMENT_DEFAULT_DAYS)) * share,
      origin: "report návštěvnosti spádové pobočky", baseDay: perDay, baseTotal: v.visitsTotal };
  }
  const pair = suggestion && suggestion.visits ? Number(suggestion.visits) : null;
  if (pair) {
    return { day: (pair * share) / CATCHMENT_DEFAULT_DAYS, total: pair * share,
      origin: "sloupec „Spád. návštěvy“ ze souboru", baseDay: pair / CATCHMENT_DEFAULT_DAYS, baseTotal: pair };
  }
  return { day: 0, total: 0, origin: null, baseDay: null, baseTotal: null };
}

function catchmentRowHtml(r, i) {
  const segments = getKnownSegments();
  const segOptions = segments.map((sg) =>
    `<option value="${esc(sg)}"${sg === r.segment ? " selected" : ""}>${esc(sg)}</option>`).join("");
  const pozOptions = getPositionsForSegment(r.segment || segments[0]).map((pz) =>
    `<option value="${esc(pz)}"${pz === r.pozice ? " selected" : ""}>${esc(pz)}</option>`).join("");
  return `<tr class="cm-row" data-idx="${i}">
    <td><select class="cm-seg">${segOptions}</select></td>
    <td><select class="cm-poz">${pozOptions}</select></td>
    <td><input type="number" class="cm-fte" min="0" step="0.1" value="${r.fte ?? ""}"></td>
    <td><button class="btn secondary small cm-row-del">✕</button></td>
  </tr>`;
}

function catchmentItemHtml(sel, i, suggestion) {
  const vis = catchmentBranchVisits(sel, suggestion);
  const fteTotal = (sel.rows || []).reduce((s, r) => s + (Number(r.fte) || 0), 0);
  const dbInfo = sel.db_origin ? `<span class="muted">(${esc(sel.db_origin)})</span>` : "";
  return `<div class="cm-item" data-idx="${i}">
    <div class="cm-head">
      <strong>${esc(sel.source_name)}</strong>
      ${sel.source_id ? `<span class="muted">ID ${esc(sel.source_id)}</span>` : ""}
      ${suggestion && suggestion.distance_km ? `<span class="muted">${fmt1(suggestion.distance_km)} km</span>` : ""}
      ${suggestion && suggestion.region ? `<span class="muted">${esc(suggestion.region)}</span>` : ""}
      <button class="btn secondary small cm-del" title="Odebrat pobočku">✕</button>
    </div>
    <div class="cm-grid">
      <label>Odhad přesunu klientů
        <span class="cm-num"><input type="number" class="cm-transfer" min="0" max="100" step="1"
          value="${sel.transfer_pct ?? 0}"> %</span></label>
      <div class="cm-visits">
        ${vis.origin
          ? `Návštěvy spádové pobočky: <strong>${vis.baseDay ? fmt1(vis.baseDay) : "?"}</strong>/den
             (${vis.baseTotal ? fmtNum0(vis.baseTotal) : "?"} celkem) → <strong>převezme se
             ${fmt1(vis.day)}</strong> návštěv/den <span class="muted">(${esc(vis.origin)})</span>`
          : `<span class="muted">Pro tuto pobočku nejsou data o návštěvnosti — návštěvy se nepřipočítají,
             přidají se jen FTE.</span>`}
      </div>
    </div>
    <div class="cm-mode">
      <label><input type="radio" name="cmMode${i}" class="cm-mode-db" value="db"
        ${sel.fte_mode !== "manual" ? "checked" : ""}> FTE z databáze ${dbInfo}</label>
      <label><input type="radio" name="cmMode${i}" class="cm-mode-manual" value="manual"
        ${sel.fte_mode === "manual" ? "checked" : ""}> zadat zaměstnance ručně</label>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Segment</th><th>Pozice</th><th>FTE</th><th></th></tr></thead>
      <tbody class="cm-rows">${(sel.rows || []).map(catchmentRowHtml).join("")}</tbody>
    </table></div>
    <div class="row" style="margin-top:6px;">
      <button class="btn secondary small cm-row-add">+ Přidat pozici</button>
      <span class="muted">Převzato <strong>${fmt1(fteTotal)} FTE</strong></span>
    </div>
  </div>`;
}

function catchmentPanelHtml(load, state, suggestions) {
  const info = catchmentInfo();
  const chosen = new Set(state.map((x) => branchKey(x.source_name)));
  const sugHtml = suggestions.map((sg) => `<label class="cm-sug${chosen.has(branchKey(sg.source_name))
    ? " on" : ""}">
    <input type="checkbox" class="cm-sug-check" data-name="${esc(sg.source_name)}"
      data-id="${esc(sg.source_id || "")}" data-transfer="${sg.transfer_pct ?? 0}"
      ${chosen.has(branchKey(sg.source_name)) ? "checked" : ""}>
    <span><strong>${esc(sg.source_name)}</strong>
      ${sg.transfer_pct !== null && sg.transfer_pct !== undefined
        ? `<span class="cm-pct">odhad přesunu ${fmt1(sg.transfer_pct)} %</span>`
        : `<span class="muted">odhad přesunu neuveden</span>`}
      ${sg.distance_km ? `<span class="muted">${fmt1(sg.distance_km)} km</span>` : ""}
      ${sg.visits ? `<span class="muted">${fmtNum0(sg.visits)} spád. návštěv</span>` : ""}
    </span></label>`).join("");

  const totals = state.reduce((acc, sel, i) => {
    const vis = catchmentBranchVisits(sel, suggestions.find((sg) => branchKey(sg.source_name) === branchKey(sel.source_name)));
    acc.fte += (sel.rows || []).reduce((s, r) => s + (Number(r.fte) || 0), 0);
    acc.day += vis.day;
    acc.total += vis.total;
    return acc;
  }, { fte: 0, day: 0, total: 0 });
  const own = catchmentVisits(load.pobocka_id, load.pobocka_nazev);
  const ownDay = own && own.visitsPerDay ? own.visitsPerDay : null;

  // Rozbalené, když je co nabídnout (nebo už je něco vybráno) — ať si uživatel
  // možnosti všimne; jinak zůstane sbalené, aby náhled checklistu nezaplňovalo.
  return `<details class="cm-box"${state.length || suggestions.length ? " open" : ""}>
    <summary>Spádové pobočky — přebírá tato pobočka klienty a zaměstnance odjinud?
      ${srcBadgeHtml("catchment")}
      ${state.length ? `<span class="cm-chip">${state.length} pobočky · +${fmt1(totals.fte)} FTE</span>` : ""}
    </summary>
    <p class="muted">Vyberte pobočky, ze kterých na <strong>${esc(load.pobocka_nazev)}</strong> přejdou
      klienti (a případně i zaměstnanci). Našeptávají se podle souboru
      <code>spadove_pobocky.xlsx</code>${info ? ` (${info.branches} poboček)` : ""}; přidat lze i jakoukoli
      další pobočku z číselníku. Převzaté FTE se <strong>připočítají do kalkulace</strong> a převzaté
      návštěvy <strong>navýší návštěvnost</strong> — všechno označené štítkem
      „ze spádových poboček“.</p>
    ${info ? "" : `<div class="msg warn">Soubor <code>spadove_pobocky.xlsx</code> není načtený —
      našeptávání nebude fungovat. Připojte ho v části „Dodatečná analytika“ (hledá se i ve složce
      <code>zdroje</code>).</div>`}
    ${suggestions.length ? `<div class="cm-sugs">
      <span class="muted">Podle souboru na tuto pobočku spáduje:</span>${sugHtml}</div>`
      : `<p class="muted">Soubor pro pobočku „${esc(load.pobocka_nazev)}“ žádnou spádovou vazbu neuvádí —
         pobočky přidejte ručně z číselníku.</p>`}
    <div class="row cm-add-row">
      <input type="text" id="cmAddName" list="pobockyDatalist" placeholder="Přidat pobočku z číselníku…">
      <button class="btn secondary small" id="cmAddBtn">+ Přidat pobočku</button>
    </div>
    <div class="cm-items">${state.map((sel, i) => catchmentItemHtml(sel, i,
      suggestions.find((sg) => branchKey(sg.source_name) === branchKey(sel.source_name)))).join("")}</div>
    ${state.length ? `<div class="cm-summary">
      Přebírá se celkem <strong>+${fmt1(totals.fte)} FTE</strong> ·
      <strong>+${fmt1(totals.day)} návštěv/den</strong>
      (${fmtNum0(totals.total)} za rok)${ownDay
        ? ` — návštěvnost pobočky roste z ${fmt1(ownDay)} na ${fmt1(ownDay + totals.day)} návštěv/den,
            tedy o <strong>${fmt1((totals.day / ownDay) * 100)} %</strong>` : ""}.
    </div>` : ""}
    <div class="row" style="margin-top:10px;">
      <button class="btn" id="cmApply">✓ Použít do kalkulace</button>
      ${state.length ? `<button class="btn secondary" id="cmClear">Zrušit všechny</button>` : ""}
      <span class="muted">Uložením se převzaté pozice přidají do vstupních dat checklistu.</span>
    </div>
  </details>`;
}

// Vykreslí panel a naváže obsluhu. `load` je aktuální nahrávka checklistu.
function renderCatchmentPanel(containerId, load) {
  const container = document.getElementById(containerId);
  if (!container || !load) return;
  const loadKey = load.load_key;
  const suggestions = catchmentSuggestions(load.pobocka_nazev);
  if (!catchmentUi[loadKey]) {
    catchmentUi[loadKey] = getCatchmentSelection(loadKey).map((r) => ({
      source_id: r.source_id, source_name: r.source_name, transfer_pct: r.transfer_pct,
      fte_mode: r.fte_mode, rows: r.rows || [],
    }));
  }
  const state = catchmentUi[loadKey];
  container.innerHTML = catchmentPanelHtml(load, state, suggestions);

  const rerender = () => renderCatchmentPanel(containerId, load);
  const addBranch = (name, id, transfer) => {
    if (!name) return;
    if (state.some((x) => branchKey(x.source_name) === branchKey(name))) return;
    const db = catchmentFteFromDb(id, name);
    state.push({ source_id: id || (dbAll("SELECT id_pobocky FROM pobocky WHERE LOWER(nazev) = ?",
      [String(name).toLowerCase()])[0] || {}).id_pobocky || "",
      source_name: name, transfer_pct: transfer ?? 0, fte_mode: "db",
      rows: db.rows, db_origin: db.origin });
    rerender();
  };

  container.querySelectorAll(".cm-sug-check").forEach((cb) => {
    cb.addEventListener("change", () => {
      const name = cb.dataset.name;
      if (cb.checked) addBranch(name, cb.dataset.id, Number(cb.dataset.transfer) || 0);
      else {
        const i = state.findIndex((x) => branchKey(x.source_name) === branchKey(name));
        if (i >= 0) state.splice(i, 1);
        rerender();
      }
    });
  });
  const addInput = container.querySelector("#cmAddName");
  container.querySelector("#cmAddBtn").addEventListener("click", () => {
    const name = addInput.value.trim();
    const sug = suggestions.find((sg) => branchKey(sg.source_name) === branchKey(name));
    addBranch(name, sug ? sug.source_id : "", sug ? sug.transfer_pct : 0);
    addInput.value = "";
  });

  container.querySelectorAll(".cm-item").forEach((item) => {
    const i = Number(item.dataset.idx);
    const sel = state[i];
    item.querySelector(".cm-del").addEventListener("click", () => { state.splice(i, 1); rerender(); });
    item.querySelector(".cm-transfer").addEventListener("input", (e) => {
      sel.transfer_pct = toNumberOrNull(e.target.value) ?? 0;
      // souhrn i převzaté návštěvy se přepočítají hned
      rerender();
    });
    item.querySelector(".cm-mode-db").addEventListener("change", () => {
      const db = catchmentFteFromDb(sel.source_id, sel.source_name);
      sel.fte_mode = "db";
      sel.rows = db.rows;
      sel.db_origin = db.origin;
      if (!db.rows.length) toast(`Pro pobočku ${sel.source_name} nejsou v databázi data o FTE — zadejte je ručně.`, "warn");
      rerender();
    });
    item.querySelector(".cm-mode-manual").addEventListener("change", () => {
      sel.fte_mode = "manual";
      rerender();
    });
    item.querySelector(".cm-row-add").addEventListener("click", () => {
      const segments = getKnownSegments();
      sel.rows = [...(sel.rows || []), { segment: segments[0] || "", pozice: getPositionsForSegment(segments[0])[0] || "", fte: 1 }];
      sel.fte_mode = "manual";
      rerender();
    });
    item.querySelectorAll(".cm-row").forEach((tr) => {
      const ri = Number(tr.dataset.idx);
      tr.querySelector(".cm-seg").addEventListener("change", (e) => {
        sel.rows[ri].segment = e.target.value;
        sel.rows[ri].pozice = getPositionsForSegment(e.target.value)[0] || "";
        sel.fte_mode = "manual";
        rerender();
      });
      tr.querySelector(".cm-poz").addEventListener("change", (e) => {
        sel.rows[ri].pozice = e.target.value;
        sel.fte_mode = "manual";
      });
      tr.querySelector(".cm-fte").addEventListener("input", (e) => {
        sel.rows[ri].fte = toNumberOrNull(e.target.value) ?? 0;
        sel.fte_mode = "manual";
      });
      tr.querySelector(".cm-row-del").addEventListener("click", () => {
        sel.rows.splice(ri, 1);
        sel.fte_mode = "manual";
        rerender();
      });
    });
  });

  container.querySelector("#cmApply").addEventListener("click", async () => {
    const selections = state.map((sel) => {
      const sug = suggestions.find((sg) => branchKey(sg.source_name) === branchKey(sel.source_name));
      const vis = catchmentBranchVisits(sel, sug);
      return { ...sel, visits_day: vis.day, visits_total: vis.total };
    });
    await saveCatchmentSelection(load, selections);
    toast(selections.length
      ? `Spádové pobočky použity: ${selections.length} pobočky, +${fmt1(selections
        .reduce((s, x) => s + (x.rows || []).reduce((a, r) => a + (Number(r.fte) || 0), 0), 0))} FTE.`
      : "Spádové pobočky odebrány z kalkulace.", "ok");
    renderExcelPreview(pendingLoad || load);
  });
  const clearBtn = container.querySelector("#cmClear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => { catchmentUi[loadKey] = []; rerender(); });
  }
}

// Souhrnný blok se štítkem — kolik spádové pobočky přidaly (výsledek, historie).
function catchmentSummaryHtml(loadKey, pobockaId, pobockaNazev, options = {}) {
  const sum = catchmentSummary(loadKey, pobockaId, pobockaNazev);
  if (!sum) return "";
  const rows = sum.branches.map((b) => `<tr>
    <td><strong>${esc(b.source_name)}</strong>${b.source_id
      ? ` <span class="muted">ID ${esc(b.source_id)}</span>` : ""}</td>
    <td class="num">${fmt1(b.transfer_pct)} %</td>
    <td class="num">${fmt1(b.fte_total)}</td>
    <td class="num">${b.visits_day ? fmt1(b.visits_day) : "—"}</td>
    <td class="num">${b.visits_total ? fmtNum0(b.visits_total) : "—"}</td>
    <td>${b.fte_mode === "manual" ? "ručně" : "z databáze"}</td>
  </tr>`).join("");
  return `<details class="cm-box src-box-catchment"${options.open ? " open" : ""}>
    <summary>Spádové pobočky — převzaté FTE a návštěvy ${srcBadgeHtml("catchment")}
      <span class="cm-chip">${sum.branches.length} pobočky · +${fmt1(sum.fte)} FTE${sum.pct
        ? ` · +${fmt1(sum.pct)} % návštěv` : ""}</span></summary>
    <div class="table-wrap"><table class="visitor-table">
      <thead><tr><th>Pobočka</th><th>Odhad přesunu</th><th>Převzato FTE</th>
        <th>Návštěvy/den</th><th>Návštěvy/rok</th><th>Zdroj FTE</th></tr></thead>
      <tbody>${rows}
        <tr class="total-row"><td>Celkem</td><td></td>
          <td class="num"><strong>${fmt1(sum.fte)}</strong></td>
          <td class="num"><strong>${fmt1(sum.visitsDay)}</strong></td>
          <td class="num"><strong>${fmtNum0(sum.visitsTotal)}</strong></td><td></td></tr>
      </tbody></table></div>
    <p class="muted">${sum.ownVisitsDay
      ? `Návštěvnost pobočky roste z <strong>${fmt1(sum.ownVisitsDay)}</strong> na
         <strong>${fmt1(sum.ownVisitsDay + sum.visitsDay)}</strong> návštěv/den, tedy o
         <strong>${fmt1(sum.pct)} %</strong>. Sekce kapacity pobočky proto počítají s navýšenou
         návštěvností (poměr ${(Math.round(sum.factor * 1000) / 1000).toString().replace(".", ",")}×).`
      : "Pro tuto pobočku nejsou naimportovaná data návštěvnosti, proto se navyšují jen FTE."}
      Převzaté pozice jsou v přehledu pozic označené štítkem „ze spádových poboček“.
      Pravděpodobnost přetížení z reportu se nepřepočítává (není lineární).</p>
  </details>`;
}

/* --------------------------- Dodatečná analytika --------------------------- */
// Záložka „Dodatečná analytika“ sdružuje všechna doplňková data, která aplikace
// umí použít vedle vlastní kalkulace:
//   • report_navstevnost.html   — návštěvy po hodinách, doporučení prostor, Monte Carlo
//   • export_specialiste.xlsx   — aktuální obsazenost pozic po pobočkách
//   • pobocky-export.xlsx       — rating, výnosy a prodeje pobočky
// Soubory se hledají samy ve složce s aplikací (a v podsložce `data`). Když
// aplikace běží přes file://, prohlížeč interní fetch() na souboru zakáže —
// v tom případě se dá jednou připojit celá složka (File System Access API,
// handle se pamatuje v IndexedDB) nebo připojit každý soubor ručně.

const ANALYTICS_DIRS = ["", "data/", "zdroje/", "sources/"];   // kde se soubory hledají

const ANALYTICS_SOURCES = [
  {
    key: "visitor",
    file: "report_navstevnost.html",
    label: "Report návštěvnosti",
    accept: ".html,.htm",
    src: "visit",
    desc: "Návštěvy po hodinách, doporučení prostor a Monte Carlo model průměrného dne. "
      + "Používá se v kapitole „Kapacita pobočky“.",
    info: () => {
      if (!db) return null;
      try {
        const row = dbAll(`SELECT COUNT(*) AS n, MAX(imported_at) AS imported_at, MAX(source) AS source,
          MAX(report_title) AS title FROM visitor_data`)[0];
        return row && row.n ? row : null;
      } catch (e) { return null; }
    },
    detail: (info) => `${info.n} poboček${info.title ? ` — ${esc(info.title)}` : ""}`,
    attach: (file) => handleVisitorReportFile(file),
  },
  {
    key: "specialist",
    file: "export_specialiste.xlsx",
    label: "Export specialistů",
    accept: ".xlsx,.xls",
    src: "hr",
    desc: "Aktuální obsazenost pozic po pobočkách. Umí předvyplnit manuální zadání a slouží "
      + "k porovnání zadaných FTE se skutečným stavem.",
    info: () => specialistExportInfo(),
    detail: (info) => `${info.n} poboček`,
    attach: (file) => handleSpecialistExportFile(file),
  },
  {
    key: "catchment",
    file: "spadove_pobocky.xlsx",
    label: "Spádové pobočky",
    accept: ".xlsx,.xls",
    src: "catchment",
    desc: "Kam by šli klienti z jednotlivých poboček (až tři spádové pobočky, jejich návštěvy, "
      + "vzdálenost a odhad přesunu). Používá se při kalkulaci, když pobočka přebírá klienty "
      + "a zaměstnance z jiných poboček.",
    info: () => catchmentInfo(),
    detail: (info) => `${info.branches} poboček, ${info.n} vazeb`,
    attach: (file) => handleCatchmentFile(file),
  },
  {
    key: "branches",
    file: "pobocky-export.xlsx",
    label: "Export poboček",
    accept: ".xlsx,.xls",
    src: "branch",
    desc: "Rating pobočky 23–25 včetně trendu a kvintilu, výnosy a nové výnosy, prodeje po produktech. "
      + "Tiskne se do hlavičky titulní stránky PDF sestavy.",
    info: () => branchExportInfo(),
    detail: (info) => `${info.n} poboček`,
    attach: async (file) => {
      const res = await handleBranchExportFile(file);
      renderBranchExportList();
      return res;
    },
  },
];

function analyticsSource(key) { return ANALYTICS_SOURCES.find((s) => s.key === key); }

function analyticsSetStatus(html, cls) {
  const el = document.getElementById("analyticsStatus");
  if (el) el.innerHTML = html ? `<div class="msg ${cls || ""}">${html}</div>` : "";
}

// Zkusí soubor najít vedle aplikace přes fetch() — funguje, když je aplikace
// vystavená přes http(s). Na file:// fetch spadne a vrací se null.
async function fetchLocalFile(name) {
  // U souborového režimu (file://) prohlížeč fetch() na soubor vedle aplikace
  // zakazuje (CORS) — nemá smysl to zkoušet a plnit konzoli chybami.
  if (location.protocol === "file:") return null;
  for (const dir of ANALYTICS_DIRS) {
    try {
      const res = await fetch(`${dir}${name}`, { cache: "no-store" });
      if (!res || !res.ok) continue;
      const blob = await res.blob();
      if (blob.size > 0) return new File([blob], name, { type: blob.type });
    } catch (e) { /* file:// nebo soubor neexistuje — hledá se dál */ }
  }
  return null;
}

// Druhá cesta: uživatel jednou povolí složku s daty, handle se zapamatuje
// a příště už se soubory načtou samy i na file://.
async function dataDirHandle() {
  if (!fsaSupported) return null;
  try {
    const dir = await idbGet("dataDir");
    if (!dir) return null;
    const perm = await dir.queryPermission({ mode: "read" });
    return perm === "granted" ? dir : null;
  } catch (e) { return null; }
}

async function dirFile(dir, name) {
  const targets = [];
  targets.push(dir);
  try { targets.push(await dir.getDirectoryHandle("data")); } catch (e) { /* podsložka není */ }
  for (const target of targets) {
    try {
      const fh = await target.getFileHandle(name);
      return await fh.getFile();
    } catch (e) { /* v této složce soubor není */ }
  }
  return null;
}

async function findAnalyticsFile(name) {
  const byFetch = await fetchLocalFile(name);
  if (byFetch) return { file: byFetch, how: "ze složky s aplikací" };
  const dir = await dataDirHandle();
  if (dir) {
    const f = await dirFile(dir, name);
    if (f) return { file: f, how: `z připojené složky ${dir.name}` };
  }
  return null;
}

// Automatické připojení. Bez `force` se přeskočí zdroje, které už v databázi
// jsou — aby import po každém přepnutí záložky nepřepisoval načtená data.
let analyticsAutoRunning = false;

async function autoAttachAnalytics(options = {}) {
  if (!db || analyticsAutoRunning) return [];
  analyticsAutoRunning = true;
  const results = [];
  try {
    for (const source of ANALYTICS_SOURCES) {
      const info = source.info();
      if (info && !options.force) { results.push({ source, skipped: true, info }); continue; }
      const found = await findAnalyticsFile(source.file);
      if (!found) { results.push({ source, missing: true }); continue; }
      try {
        await source.attach(found.file);
        results.push({ source, attached: true, how: found.how });
      } catch (e) {
        console.error(e);
        results.push({ source, error: e.message });
      }
    }
  } finally {
    analyticsAutoRunning = false;
  }
  renderAnalyticsSources();
  {
    const attached = results.filter((r) => r.attached);
    const errors = results.filter((r) => r.error);
    const missing = results.filter((r) => r.missing);
    const parts = [];
    if (attached.length) {
      parts.push(`Připojeno automaticky: ${attached.map((r) => `<strong>${esc(r.source.file)}</strong>`
        + ` (${esc(r.how)})`).join(", ")}.`);
    }
    if (missing.length) {
      parts.push(`Ve složce s aplikací nebyly nalezeny: ${missing.map((r) => `<code>${esc(r.source.file)}</code>`)
        .join(", ")} — připojte je tlačítkem u dané položky${fsaSupported
          ? ", nebo připojte celou složku s daty" : ""}.`);
    }
    errors.forEach((r) => parts.push(`<strong>${esc(r.source.file)}</strong>: ${esc(r.error)}`));
    // Při tichém běhu (přepnutí záložky) se hlásí jen to, co se opravdu připojilo,
    // ať uživatele nezahlcuje výpis chybějících souborů po každém kliknutí.
    if (!options.silent) analyticsSetStatus(parts.join("<br>"), errors.length ? "err" : (attached.length ? "ok" : "warn"));
    else if (attached.length || errors.length) {
      analyticsSetStatus([...parts.filter((_, i) => i === 0 || errors.length)].join("<br>"),
        errors.length ? "err" : "ok");
    }
  }
  return results;
}

// Připojení celé složky — jednorázové povolení, které přežije zavření aplikace.
async function pickDataDirectory() {
  if (!window.showDirectoryPicker) {
    analyticsSetStatus("Tento prohlížeč neumí připojit složku. Připojte soubory jednotlivě.", "warn");
    return;
  }
  try {
    const dir = await window.showDirectoryPicker({ mode: "read" });
    await idbSetSafe("dataDir", dir);
    analyticsSetStatus(`Složka <strong>${esc(dir.name)}</strong> připojena — hledám v ní datové soubory…`, "ok");
    await autoAttachAnalytics({ force: true });
  } catch (e) {
    if (e && e.name === "AbortError") return;
    console.error(e);
    analyticsSetStatus(`Složku se nepodařilo připojit: ${esc(e.message)}`, "err");
  }
}

/* --------- Karty připojených souborů (stav + ruční připojení) -------------- */

function renderAnalyticsSources() {
  const el = document.getElementById("analyticsSources");
  if (!el) return;
  el.innerHTML = ANALYTICS_SOURCES.map((source) => {
    const info = db ? source.info() : null;
    const state = info ? "ok" : "off";
    return `<div class="an-card an-${state}">
      <div class="an-head">
        <span class="an-dot"></span>
        <strong>${esc(source.label)}</strong>
        ${srcBadgeHtml(source.src)}
        <code>${esc(source.file)}</code>
      </div>
      <p class="muted an-desc">${source.desc}</p>
      <p class="an-state">${info
        ? `<span class="an-ok">Připojeno</span> — ${source.detail(info)}${info.source
            ? `, soubor <strong>${esc(info.source)}</strong>` : ""}${info.imported_at
            ? `, import ${new Date(info.imported_at).toLocaleString("cs-CZ")}` : ""}.`
        : `<span class="an-off-label">Nepřipojeno</span> — soubor
            <code>${esc(source.file)}</code> nebyl ve složce nalezen.`}</p>
      <div class="row">
        <button class="btn secondary small an-attach" data-source="${source.key}">
          ${info ? "Připojit jiný soubor…" : "Připojit soubor…"}</button>
      </div>
    </div>`;
  }).join("");

  el.querySelectorAll(".an-attach").forEach((btn) => {
    btn.addEventListener("click", () => {
      const source = analyticsSource(btn.dataset.source);
      const input = document.getElementById("analyticsFileInput");
      input.accept = source.accept;
      input.dataset.source = source.key;
      input.click();
    });
  });
}

async function handleAnalyticsPickedFile(file, key) {
  const source = analyticsSource(key);
  if (!source || !file) return;
  if (!requireDb()) return;
  analyticsSetStatus(`Načítám <strong>${esc(file.name)}</strong>…`);
  try {
    await source.attach(file);
    analyticsSetStatus(`<strong>${esc(source.label)}</strong> načten ze souboru`
      + ` <strong>${esc(file.name)}</strong>.`, "ok");
  } catch (e) {
    console.error(e);
    analyticsSetStatus(`${esc(source.label)}: soubor se nepodařilo načíst — ${esc(e.message)}`, "err");
  }
  renderAnalyticsSources();
}

/* ----------------- Seznam poboček z exportu poboček ------------------------ */

let branchExportFilter = "";

function renderBranchExportList() {
  const el = document.getElementById("branchExportList");
  if (!el) return;
  if (!db || !branchExportInfo()) {
    el.innerHTML = `<p class="muted">Export poboček není připojený — soubor
      <code>pobocky-export.xlsx</code> patří do složky s aplikací.</p>`;
    return;
  }
  const rows = dbAll("SELECT * FROM branch_export ORDER BY branch_name");
  const q = branchExportFilter.trim().toLowerCase();
  const shown = rows.filter((r) => !q
    || String(r.branch_name || "").toLowerCase().includes(q)
    || String(r.branch_id || "").toLowerCase().includes(q));
  if (!shown.length) {
    el.innerHTML = `<p class="muted">Filtru „${esc(branchExportFilter)}“ neodpovídá žádná pobočka.</p>`;
    return;
  }
  const body = shown.slice(0, 400).map((r) => {
    let f = null;
    try { f = branchFields(JSON.parse(r.payload || "{}")); } catch (e) { f = null; }
    const kvColor = f ? quintileColor(f.rating.kvintil) : "#6b7482";
    return `<tr class="bx-row" data-id="${esc(r.branch_id)}">
      <td>${esc(r.branch_id)}</td>
      <td><strong>${esc(r.branch_name)}</strong></td>
      <td>${esc(f ? (f.region || f.regionFixed || "") : "")}</td>
      <td>${esc(f ? (f.oblast || "") : "")}</td>
      <td class="num"><span class="bx-kv" style="background:${kvColor};">${f && f.rating.r25text
        ? esc(f.rating.r25text) : "—"}</span></td>
      <td class="num">${f && f.revenueLast ? fmtNum0(f.revenueLast.value) : "—"}</td>
      <td class="num">${f ? fmtNum0(f.salesTotal) : "—"}</td>
    </tr>`;
  }).join("");

  el.innerHTML = `<p class="muted">${shown.length} z ${rows.length} poboček${shown.length > 400
    ? " (zobrazeno prvních 400)" : ""} · klikněte na řádek pro kartu pobočky.</p>
    <div class="table-wrap"><table class="visitor-table">
      <thead><tr><th>ID</th><th>Pobočka</th><th>Region</th><th>Oblast</th><th>Rating 25</th>
        <th>Výnosy</th><th>Prodeje celkem</th></tr></thead>
      <tbody>${body}</tbody></table></div>`;

  el.querySelectorAll(".bx-row").forEach((tr) => {
    tr.addEventListener("click", () => showBranchExportDetail(tr.dataset.id));
  });
}

function showBranchExportDetail(branchId) {
  const panel = document.getElementById("branchExportDetailPanel");
  const el = document.getElementById("branchExportDetail");
  if (!panel || !el) return;
  const profile = branchProfile(branchId, null);
  if (!profile) { panel.style.display = "none"; return; }
  panel.style.display = "block";
  const f = profile.fields;
  const yearRow = (label, list) => (list.length
    ? `<tr><th>${label}</th>${list.map((x) => `<td class="num">${fmtNum0(x.value)}</td>`).join("")}</tr>` : "");
  const years = f.revenues.length ? f.revenues : f.newRevenues;
  el.innerHTML = `<h3>${esc(profile.branchName)} <span class="muted">(ID ${esc(profile.branchId)})</span></h3>
    ${branchProfileHtml(profile)}
    ${years.length ? `<h4>Výnosy po letech</h4>
      <div class="table-wrap"><table class="visitor-table">
        <thead><tr><th></th>${years.map((x) => `<th class="num">${x.year}</th>`).join("")}</tr></thead>
        <tbody>${yearRow("Výnosy", f.revenues)}${yearRow("Nové výnosy", f.newRevenues)}</tbody>
      </table></div>` : ""}
    ${f.sales.length ? `<h4>Prodeje po kategoriích</h4>
      <div class="table-wrap"><table class="visitor-table">
        <thead><tr><th>Kategorie</th><th class="num">Prodeje</th><th class="num">Kvintil</th>
          ${f.sales.some((x) => x.volume !== undefined) ? '<th class="num">Objem</th>' : ""}</tr></thead>
        <tbody>${f.sales.map((sp) => `<tr><td>${esc(sp.label)}</td>
          <td class="num">${fmtNum0(sp.count)}</td>
          <td class="num">${branchNum(sp.kvintil) === null ? "—"
            : `<span class="bx-kv" style="background:${quintileColor(sp.kvintil)};">${fmtPieces(branchNum(sp.kvintil))}</span>`}</td>
          ${f.sales.some((x) => x.volume !== undefined)
            ? `<td class="num">${sp.volume === undefined ? "—" : fmtNum0(sp.volume)}</td>` : ""}</tr>`).join("")}
        </tbody></table></div>` : ""}
    <details class="cmp-box"><summary>Všechny sloupce z exportu (${Object.keys(f.raw).length})</summary>
      <div class="table-wrap"><table class="visitor-table"><tbody>${Object.entries(f.raw)
        .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table></div>
    </details>`;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* --------------------- Přístup k datům + snapshot ke kalkulaci -------------- */

function decodeVisitorRow(row) {
  if (!row) return null;
  try {
    return {
      pobocka_id: row.pobocka_id,
      nazev: row.nazev,
      imported_at: row.imported_at,
      source: row.source,
      report_title: row.report_title,
      consts: row.consts_json ? JSON.parse(row.consts_json) : VISITOR_CONSTS_DEFAULT,
      d: JSON.parse(row.payload),
    };
  } catch (e) {
    console.warn("Data návštěvnosti nešlo přečíst:", e);
    return null;
  }
}

// Data návštěvnosti pobočky z posledního importovaného reportu. Pobočka se
// hledá primárně podle ID (klíč v reportu), jako záloha podle názvu.
function getVisitorData(pobockaId, pobockaNazev) {
  if (!db) return null;
  let row = null;
  if (pobockaId !== null && pobockaId !== undefined && String(pobockaId) !== "") {
    row = dbAll("SELECT * FROM visitor_data WHERE pobocka_id = ?", [String(pobockaId)])[0] || null;
  }
  if (!row && pobockaNazev) {
    row = dbAll("SELECT * FROM visitor_data WHERE nazev = ?", [String(pobockaNazev)])[0] || null;
  }
  return decodeVisitorRow(row);
}

function saveVisitorSnapshot(calculationKey, visitor) {
  if (!visitor) return;
  dbRun(`INSERT OR REPLACE INTO calculation_visitor
    (calculation_key, pobocka_id, nazev, imported_at, source, report_title, consts_json, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [calculationKey, visitor.pobocka_id, visitor.nazev, visitor.imported_at, visitor.source,
      visitor.report_title, JSON.stringify(visitor.consts), JSON.stringify(visitor.d)]);
}

// Data návštěvnosti pro konkrétní kalkulaci: nejdřív snapshot uložený při jejím
// spočítání (aby se kalkulace neměnila pod rukama), jinak aktuálně importovaná
// data pobočky — tak se doporučení prostor objeví i u kalkulací spočítaných
// ještě před importem reportu.
function getVisitorForCalculation(calculationKey, pobockaId, pobockaNazev) {
  if (!db) return null;
  const snap = calculationKey
    ? decodeVisitorRow(dbAll("SELECT * FROM calculation_visitor WHERE calculation_key = ?", [calculationKey])[0])
    : null;
  const base = snap ? { ...snap, isSnapshot: true } : (() => {
    const live = getVisitorData(pobockaId, pobockaNazev);
    return live ? { ...live, isSnapshot: false } : null;
  })();
  if (!base) return null;
  // Když kalkulace přebírá klienty ze spádových poboček, návštěvnost se navýší
  // poměrem převzatých návštěv — tady, aby s tím počítaly všechny sekce i PDF.
  const loadKey = calculationKey ? (dbAll("SELECT load_key FROM calculations WHERE calculation_key = ? LIMIT 1",
    [calculationKey])[0] || {}).load_key : null;
  return visitorWithCatchment(base, loadKey, pobockaId, pobockaNazev);
}

/* --------------------------- Odvozené ukazatele ---------------------------- */

// Doporučení prostor stejným vzorcem jako report: λ = průměrné příchody
// v nejfrekventovanější hodině, P95 = λ + 1.645·√λ, počet míst = ⌈P95 × obsluha
// v minutách ÷ 60⌉. Použije se u poboček, u kterých report doporučení neuvádí
// (nemají v datech blok `rooms`) — u ostatních se bere hodnota z reportu.
function computeRoomsFromHours(byHour, consts) {
  const online = (byHour && byHour.online) || [];
  const fyzicka = (byHour && byHour.fyzicka) || [];
  const bezhot = (byHour && byHour.bezhot) || [];
  let peakMtg = 0;
  let peakBez = 0;
  for (let h = 0; h < 24; h++) {
    peakMtg = Math.max(peakMtg, (online[h] || 0) + (fyzicka[h] || 0));
    peakBez = Math.max(peakBez, bezhot[h] || 0);
  }
  const p95 = (lam) => lam + 1.645 * Math.sqrt(lam);
  const mtgMins = consts.MEETING_MINS ?? VISITOR_CONSTS_DEFAULT.MEETING_MINS;
  const walkMins = consts.WALKIN_AVG_MINS ?? VISITOR_CONSTS_DEFAULT.WALKIN_AVG_MINS;
  return {
    meeting_rooms: Math.ceil((p95(peakMtg) * mtgMins) / 60),
    service_desks: Math.ceil((p95(peakBez) * walkMins) / 60),
    peak_mtg_lam: peakMtg, p95_mtg: p95(peakMtg), delta_mtg: p95(peakMtg) - peakMtg,
    peak_bezhot_lam: peakBez, p95_bezhot: p95(peakBez), delta_bezhot: p95(peakBez) - peakBez,
    derived: true,
  };
}

function summarizeVisitorMc(mc, consts) {
  const rows = [];
  const len = Math.max((mc.p95_util || []).length, (mc.overload_prob || []).length, VISITOR_MC_HOURS);
  for (let i = 0; i < len; i++) {
    rows.push({
      hour: VISITOR_MC_HOUR_FROM + i,
      lamOnline: (mc.lam_online || [])[i] || 0,
      lamFyzicka: (mc.lam_fyzicka || [])[i] || 0,
      lamBezhot: (mc.lam_bezhot || [])[i] || 0,
      p50Util: (mc.p50_util || [])[i] || 0,
      p95Util: (mc.p95_util || [])[i] || 0,
      overloadProb: (mc.overload_prob || [])[i] || 0,
      p95ObFte: (mc.p95_ob_fte || [])[i] || 0,
      p95SvcFte: (mc.p95_svc_fte || [])[i] || 0,
    });
  }
  return {
    rows,
    // Součet pravděpodobností přetížení po hodinách = průměrný počet hodin za
    // den, kdy poptávka přeteče kapacitu (stejný ukazatel jako v reportu).
    overloadHours: (mc.overload_prob || []).reduce((a, b) => a + b, 0) / 100,
    nIter: mc.n_iter || consts.MC_ITERATIONS || VISITOR_CONSTS_DEFAULT.MC_ITERATIONS,
    coveragePct: mc.coverage_pct,
    bankersFor95: mc.bankers_for_95,
    currentBankers: mc.current_bankers,
    svcFte: mc.svc_fte,
    peakP95Ob: (mc.p95_ob_fte || []).reduce((a, b) => Math.max(a, b), 0),
    peakP95Svc: (mc.p95_svc_fte || []).reduce((a, b) => Math.max(a, b), 0),
    obCapFte: mc.ob_cap_fte, svcCapFte: mc.svc_cap_fte,
    obCapDay: mc.ob_cap_day, obP95Day: mc.ob_p95_day,
    svcCapDay: mc.svc_cap_day, svcP95Day: mc.svc_p95_day,
    // Histogramy denní poptávky (pro graf distribuce v PDF).
    obHist: mc.ob_hist || [], obEdges: mc.ob_edges || [],
    svcHist: mc.svc_hist || [], svcEdges: mc.svc_edges || [],
    presencePct: (1 - (consts.ABSENCE_RATE ?? VISITOR_CONSTS_DEFAULT.ABSENCE_RATE)) * 100,
  };
}

// FTE v jednotlivých rolích u klienta podle pozic zadaných v kalkulaci.
// „osobní bankéř - junior“ se počítá do schůzek i do servisní obsluhy, do
// celkového počtu ale jen jednou.
function computeBankerFte(inputRows) {
  const norm = (v) => String(v || "").trim().toLowerCase();
  const inRole = (pozice, role) => ROLE_POSITIONS[role].includes(norm(pozice));
  const rows = [];
  (inputRows || []).forEach((r) => {
    const fte = Number(r.fte) || 0;
    if (fte <= 0) return;
    const roles = ["ob", "serviceCore", "serviceAlso", "cashier"].filter((role) => inRole(r.pozice, role));
    if (!roles.length) return;
    rows.push({ segment: r.segment, pozice: String(r.pozice), fte, roles,
      ob: roles.includes("ob"),
      service: roles.includes("serviceCore") || roles.includes("serviceAlso"),
      cashier: roles.includes("cashier") });
  });
  const sum = (fn) => rows.filter(fn).reduce((a, r) => a + r.fte, 0);
  const sales = sum((r) => r.ob);
  const serviceCore = sum((r) => r.roles.includes("serviceCore"));
  const serviceAlso = sum((r) => r.roles.includes("serviceAlso"));
  const cashier = sum((r) => r.cashier);
  return {
    rows, sales, serviceCore, serviceAlso, cashier,
    serviceTotal: serviceCore + serviceAlso,
    // Celkem bez dvojího počítání: osobní bankéři + BKP medior + BKP junior.
    total: sales + serviceCore + cashier,
  };
}

// Otevírací doba pobočky podle reportu — z ní je vidět i to, jestli je pobočka
// víkendová (otevřeno v sobotu/nedělí) a kolik má otevíracích dnů v roce.
function visitorOpeningSummary(d) {
  const days = Array.isArray(d.od_days) ? d.od_days : [];
  const openDays = days.filter((x) => !x.closed);
  const weekendOpen = days.filter((x) => x.wknd && !x.closed);
  return {
    days,
    hoursPerWeek: d.ph_tyden === undefined ? null : d.ph_tyden,
    annualOpenDays: d.annual_open_days === undefined ? null : d.annual_open_days,
    isWeekend: !!d.is_vikend || weekendOpen.length > 0,
    weekendLabels: weekendOpen.map((x) => x.lbl),
    openDaysPerWeek: days.length ? openDays.length : null,
    label: days.length
      ? (weekendOpen.length ? `otevřeno i o víkendu (${weekendOpen.map((x) => x.lbl).join(", ")})`
        : "otevřeno jen v pracovní dny")
      : (d.is_vikend ? "víkendová pobočka" : null),
  };
}

// Návštěvy po dnech týdne — počet dnů v datech je pro každý den jiný
// (n_days_wd), takže průměr na den se počítá zvlášť pro každý den.
function visitorWeekdayRows(d) {
  const byWeekday = d.by_weekday || {};
  const nDays = d.n_days_wd || [];
  const openDays = Array.isArray(d.od_days) ? d.od_days : [];
  if (!Object.keys(byWeekday).length) return [];
  return WEEKDAY_NAMES.map((name, i) => {
    const total = VISITOR_TYPES.reduce((a, t) => a + ((byWeekday[t.key] || [])[i] || 0), 0);
    const days = nDays[i] || 0;
    const od = openDays[i] || null;
    return {
      name, total, days,
      perDay: days ? total / days : null,
      closed: od ? !!od.closed : null,
      hours: od && od.tot ? od.tot : "",
      weekend: od ? !!od.wknd : i >= 5,
    };
  });
}

function computeVisitorMetrics(visitor) {
  const d = visitor.d || {};
  const consts = visitor.consts || VISITOR_CONSTS_DEFAULT;
  const byHour = d.by_hour || {};
  const rooms = d.rooms ? { ...d.rooms, derived: false } : computeRoomsFromHours(byHour, consts);
  const hours = [];
  let peakHour = null;
  for (let h = VISITOR_MC_HOUR_FROM; h < VISITOR_MC_HOUR_FROM + VISITOR_MC_HOURS; h++) {
    const row = { hour: h, mcIndex: h - VISITOR_MC_HOUR_FROM };
    VISITOR_TYPES.forEach((t) => { row[t.key] = (byHour[t.key] || [])[h] || 0; });
    row.meetings = row.fyzicka + row.online;
    row.walkins = row.bezhot + row.hotovost;
    row.total = row.meetings + row.walkins;
    hours.push(row);
    if (!peakHour || row.total > peakHour.total) peakHour = row;
  }
  const dayTotal = hours.reduce((a, r) => a + r.total, 0);
  const metrics = {
    consts, rooms, hours, dayTotal,
    peakHour: peakHour && peakHour.total > 0 ? peakHour : null,
    maxHourTotal: hours.reduce((a, r) => Math.max(a, r.total), 0),
    visitsPerDay: d.n_days ? d.total / d.n_days : null,
    opening: visitorOpeningSummary(d),
    weekdays: visitorWeekdayRows(d),
    mc: d.mc ? summarizeVisitorMc(d.mc, consts) : null,
    mcBoost: d.mc_boost ? summarizeVisitorMc(d.mc_boost, consts) : null,
    d,
  };

  // Doporučený počet míst ve třech variantách; ve zbytku aplikace i sestavy se
  // pracuje s variantou Monte Carlo a) (pokud ji report pro pobočku má).
  metrics.roomVariants = computeRoomVariants(metrics);
  const primary = metrics.roomVariants.primary;
  metrics.rooms = { ...rooms, meeting_rooms: primary.meetingRooms, service_desks: primary.serviceDesks,
    variantKey: primary.key, variantLabel: primary.label };
  return metrics;
}

/* --------- Doporučený počet míst ve třech variantách ----------------------- */
// 1) Reálná data — skutečné návštěvy: průměrný den (propustnost proti otevírací
//    době) i špička s rezervou na silný den (λ + 1.645·√λ). Doporučuje se ta
//    vyšší, tedy špička.
// 2) Monte Carlo a) — základní simulace z reportu: špičková P95 poptávka
//    v FTE za hodinu = tolik míst musí být obsazeno naráz.
// 3) Monte Carlo b) — stejná simulace s návštěvností vyšší o 20 %.
function computeRoomVariants(metrics) {
  const { consts, rooms, opening, d } = metrics;
  const mtgMins = consts.MEETING_MINS ?? VISITOR_CONSTS_DEFAULT.MEETING_MINS;
  const walkMins = consts.WALKIN_AVG_MINS ?? VISITOR_CONSTS_DEFAULT.WALKIN_AVG_MINS;
  const variants = [];

  // 1) Reálná data
  const openMinutes = (opening && opening.hoursPerWeek && opening.openDaysPerWeek)
    ? (opening.hoursPerWeek / opening.openDaysPerWeek) * 60 : null;
  let avgMeetingRooms = null;
  let avgServiceDesks = null;
  let avgDetail = "";
  if (openMinutes && d.by_type && d.n_days) {
    const perDay = (n) => (Number(n) || 0) / d.n_days;
    const meetingsDay = perDay(d.by_type.online) + perDay(d.by_type.fyzicka);
    const walkinsDay = perDay(d.by_type.bezhot);
    avgMeetingRooms = Math.ceil((meetingsDay * mtgMins) / openMinutes);
    avgServiceDesks = Math.ceil((walkinsDay * walkMins) / openMinutes);
    avgDetail = `průměrný den: ${vFmt1(meetingsDay)} schůzek × ${mtgMins} min a ${vFmt1(walkinsDay)} `
      + `bezhotovostních × ${walkMins} min proti ${Math.round(openMinutes)} min otevřeno `
      + `→ ${avgMeetingRooms} / ${avgServiceDesks}`;
  }
  // Kolik schůzek / klientů bez objednání je dnes a kolik by jich muselo být,
  // aby doporučený počet míst byl využitý na 90 %. Vychází z lineárního vztahu
  // mezi denním počtem návštěv a souběžnou obsazeností ve špičce.
  const meetingsNowDay = (d.by_type && d.n_days)
    ? ((Number(d.by_type.online) || 0) + (Number(d.by_type.fyzicka) || 0)) / d.n_days : null;
  const walkinsNowDay = (d.by_type && d.n_days) ? (Number(d.by_type.bezhot) || 0) / d.n_days : null;
  const TARGET_UTIL = 0.9;
  const load = (nowDay, assumedFactor, peakConcurrency, places) => {
    if (nowDay === null || !peakConcurrency || !places) return null;
    const assumed = nowDay * assumedFactor;
    return {
      nowDay,
      assumedDay: assumed,
      peakConcurrency,
      utilPct: (peakConcurrency / places) * 100,
      for90: (assumed * (TARGET_UTIL * places)) / peakConcurrency,
    };
  };

  variants.push({
    key: "real",
    label: "Reálná data (skutečné návštěvy a kapacita)",
    short: "reálná data",
    meetingRooms: rooms.meeting_rooms,
    serviceDesks: rooms.service_desks,
    detail: `špička: λ ${vFmt2(rooms.peak_mtg_lam)} → P95 ${vFmt2(rooms.p95_mtg)} × ${mtgMins} min ÷ 60 `
      + `a λ ${vFmt2(rooms.peak_bezhot_lam)} → P95 ${vFmt2(rooms.p95_bezhot)} × ${walkMins} min ÷ 60`
      + (avgDetail ? `; ${avgDetail}` : ""),
    avgMeetingRooms, avgServiceDesks,
    meetingLoad: load(meetingsNowDay, 1, (rooms.p95_mtg * mtgMins) / 60, rooms.meeting_rooms),
    walkinLoad: load(walkinsNowDay, 1, (rooms.p95_bezhot * walkMins) / 60, rooms.service_desks),
  });

  // 2) a 3) Monte Carlo — kolik míst musí být naráz obsazeno ve špičce
  const mcVariant = (mc, key, label, short, note, factor) => {
    if (!mc) return null;
    const meetingRooms = Math.ceil(mc.peakP95Ob);
    const serviceDesks = Math.ceil(mc.peakP95Svc);
    return {
      key, label, short, meetingRooms, serviceDesks,
      detail: `špičková P95 poptávka ze simulace: ${vFmt1(mc.peakP95Ob)} schůzek naráz`
        + `${mc.peakP95Svc > 0 ? ` a ${vFmt1(mc.peakP95Svc)} obsluh bez objednání` : ""}`
        + `${note ? ` (${note})` : ""}`,
      meetingLoad: load(meetingsNowDay, factor, mc.peakP95Ob, meetingRooms),
      walkinLoad: load(walkinsNowDay, factor, mc.peakP95Svc, serviceDesks),
    };
  };
  const mcA = mcVariant(metrics.mc, "mcA", "Monte Carlo — varianta a) základní", "Monte Carlo a)",
    `${vFmtInt(metrics.mc ? metrics.mc.nIter : 0)} simulací`, 1);
  const mcB = mcVariant(metrics.mcBoost, "mcB", "Monte Carlo — varianta b) návštěvnost +20 %", "Monte Carlo b)",
    "stejná simulace s o 20 % vyšší návštěvností", 1.2);
  if (mcA) variants.push(mcA);
  if (mcB) variants.push(mcB);

  return { variants, primary: mcA || variants[0], hasMc: !!mcA, meetingsNowDay, walkinsNowDay, targetUtil: TARGET_UTIL };
}

/* --------------------------- Zobrazení v aplikaci -------------------------- */

function visitorHourLabel(h) { return `${h}:00–${h + 1}:00`; }
function vFmt2(n) { return (n === null || n === undefined || Number.isNaN(n)) ? "—" : Number(n).toFixed(2); }
function vFmt1(n) { return (n === null || n === undefined || Number.isNaN(n)) ? "—" : Number(n).toFixed(1); }
function vFmtInt(n) { return (n === null || n === undefined || Number.isNaN(n)) ? "—" : Math.round(n).toLocaleString("cs-CZ"); }

// Sekce „Návštěvnost a doporučení prostor“ — doporučené zasedací místnosti a
// servisní místa (včetně mezivýpočtu λ / P95), srovnání s kalkulací, detail
// návštěv po hodinách a Monte Carlo model. `options.stats` (klíčové ukazatele
// kalkulace) zapne srovnávací tabulku, `options.checkboxId` přepínač do PDF.
function renderVisitorSectionHtml(visitor, options = {}) {
  const { stats = null, inputRows = null } = options;
  const m = computeVisitorMetrics(visitor);
  const d = m.d;
  const rooms = m.rooms;

  const infoParts = [
    `Zdroj: <strong>${esc(visitor.report_title || "report návštěvnosti")}</strong>`,
    visitor.source ? `soubor ${esc(visitor.source)}` : null,
    visitor.imported_at ? `import ${new Date(visitor.imported_at).toLocaleString("cs-CZ")}` : null,
    visitor.isSnapshot ? "snapshot uložený ke kalkulaci" : "aktuálně importovaná data",
  ].filter(Boolean);
  const branchParts = [
    `pobočka <strong>${esc(visitor.nazev || "")}</strong> (ID ${esc(visitor.pobocka_id)})`,
    d.total !== undefined ? `${vFmtInt(d.total)} návštěv` : null,
    d.n_days ? `${vFmtInt(d.n_days)} dnů` : null,
    m.visitsPerDay !== null ? `${vFmt1(m.visitsPerDay)} návštěv/den` : null,
    d.branch_format ? `formát dle reportu: ${esc(d.branch_format)}` : null,
    d.bankers !== undefined ? `${vFmt1(d.bankers)} bankéřů OB` : null,
    d.has_svc ? `servisní zóna ${vFmt1(d.svc_fte)} FTE` : "bez servisní zóny",
  ].filter(Boolean);

  const primaryLabel = m.roomVariants.primary.short || m.roomVariants.primary.label;
  const cards = `<div class="visitor-cards">
    <div class="vcard"><div class="vcard-l">Doporučené zasedací místnosti</div>
      <div class="vcard-v" style="color:#1d4ed8;">${vFmtInt(rooms.meeting_rooms)}</div>
      <div class="vcard-s">dle ${esc(primaryLabel)}</div></div>
    <div class="vcard"><div class="vcard-l">Doporučená servisní místa</div>
      <div class="vcard-v" style="color:#0891b2;">${vFmtInt(rooms.service_desks)}</div>
      <div class="vcard-s">dle ${esc(primaryLabel)}</div></div>
    <div class="vcard"><div class="vcard-l">Nejsilnější hodina</div>
      <div class="vcard-v">${m.peakHour ? esc(visitorHourLabel(m.peakHour.hour)) : "—"}</div>
      <div class="vcard-s">${m.peakHour ? `${vFmt1(m.peakHour.total)} návštěv/hod` : "bez dat o časech"}</div></div>
    ${m.mc ? `<div class="vcard"><div class="vcard-l">Přetížení (Monte Carlo)</div>
      <div class="vcard-v" style="color:${m.mc.overloadHours < 0.5 ? "#15803d" : m.mc.overloadHours < 2 ? "#b45309" : "#b91c1c"};">${vFmt1(m.mc.overloadHours)} h</div>
      <div class="vcard-s">/ den průměrně</div></div>` : ""}
  </div>`;

  const mtgMins = m.consts.MEETING_MINS ?? VISITOR_CONSTS_DEFAULT.MEETING_MINS;
  const walkMins = m.consts.WALKIN_AVG_MINS ?? VISITOR_CONSTS_DEFAULT.WALKIN_AVG_MINS;
  const rv = m.roomVariants;
  // Ke každé variantě: kolik návštěv je dnes (resp. s čím varianta počítá)
  // a kolik by jich muselo být, aby byl doporučený počet míst využitý na 90 %.
  const loadCell = (v, load, unit) => {
    if (!load) return `<td class="num"><strong>${vFmtInt(v)}</strong></td>`;
    const diff = load.for90 - load.nowDay;
    return `<td class="num"><strong>${vFmtInt(v)}</strong>
      <span class="muted">využití ${vFmtInt(load.utilPct)} %</span>
      <span class="muted">dnes ${vFmt1(load.nowDay)} ${esc(unit)}/den${load.assumedDay !== load.nowDay
        ? ` (model počítá ${vFmt1(load.assumedDay)})` : ""}</span>
      <span class="muted">na 90 % využití: <strong>${vFmt1(load.for90)}</strong>/den
        (${diff >= 0 ? "+" : ""}${vFmt1(diff)})</span></td>`;
  };

  const roomsTable = `<h4>Doporučený počet míst — tři varianty ${srcBadgeHtml("visit")}</h4>
    <div class="table-wrap"><table class="visitor-table variant-table">
      <thead><tr><th>Varianta</th><th>Zasedací místnosti<br><span class="muted">a kolik schůzek unesou</span></th>
        <th>Servisní místa<br><span class="muted">a kolik klientů bez objednání unesou</span></th>
        <th>Z čeho vychází</th></tr></thead>
      <tbody>${rv.variants.map((v) => `<tr class="${v.key === rv.primary.key ? "visitor-peak" : ""}">
        <td><strong>${esc(v.label)}</strong>${v.key === rv.primary.key
          ? ' <span class="badge ok">použito v sestavě</span>' : ""}</td>
        ${loadCell(v.meetingRooms, v.meetingLoad, "schůzek")}
        ${loadCell(v.serviceDesks, v.walkinLoad, "klientů")}
        <td class="muted">${esc(v.detail)}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="muted">Schůzka se obsluhuje ${mtgMins} min, klient bez objednání ${walkMins} min.
      λ = průměrné příchody v nejfrekventovanější hodině, P95 = λ + 1.645·√λ (silný den, zhruba 1 den z 20).
      „Na 90 % využití“ = kolik návštěv denně by muselo přijít, aby byl doporučený počet míst ve špičce
      obsazený z 90 % (v závorce rozdíl proti dnešku).
      ${rv.hasMc
        ? "V dalších částech (kapacitní shrnutí, srovnání s kalkulací, grafy) se pracuje s variantou Monte Carlo a)."
        : "Report u této pobočky Monte Carlo neuvádí — v dalších částech se pracuje s variantou podle reálných dat."}
      ${rooms.derived ? "Doporučení ze špičky reálných dat report neuvádí, dopočítalo ho stejným vzorcem v aplikaci." : ""}</p>`;

  const compare = stats ? renderVisitorCompareHtml(rooms, stats) : "";
  const bankers = renderVisitorBankersHtml(m, inputRows);

  const hoursRows = m.hours.map((r) => {
    const width = m.maxHourTotal > 0 ? (r.total / m.maxHourTotal) * 100 : 0;
    return `<tr class="${m.peakHour && r.hour === m.peakHour.hour ? "visitor-peak" : ""}">
      <td>${esc(visitorHourLabel(r.hour))}</td>
      ${VISITOR_TYPES.map((t) => `<td class="num">${vFmt2(r[t.key])}</td>`).join("")}
      <td class="num">${vFmt2(r.meetings)}</td><td class="num">${vFmt2(r.walkins)}</td>
      <td class="num"><strong>${vFmt2(r.total)}</strong></td>
      <td class="visitor-bar-cell"><span class="visitor-bar" style="width:${width.toFixed(1)}%;"></span></td>
    </tr>`;
  }).join("");
  const hoursDetail = `<details class="visitor-details"><summary>Detail návštěv po hodinách (průměr na otevírací den)</summary>
    <div class="table-wrap"><table class="visitor-table">
      <thead><tr><th>Hodina</th>${VISITOR_TYPES.map((t) => `<th>${esc(t.label)}</th>`).join("")}
        <th>Schůzky</th><th>Walk-in</th><th>Celkem</th><th></th></tr></thead>
      <tbody>${hoursRows}</tbody>
      <tfoot><tr class="total-row"><td>Celkem 6–21 h</td>
        ${VISITOR_TYPES.map((t) => `<td class="num">${vFmt2(m.hours.reduce((a, r) => a + r[t.key], 0))}</td>`).join("")}
        <td class="num">${vFmt2(m.hours.reduce((a, r) => a + r.meetings, 0))}</td>
        <td class="num">${vFmt2(m.hours.reduce((a, r) => a + r.walkins, 0))}</td>
        <td class="num"><strong>${vFmt2(m.dayTotal)}</strong></td><td></td></tr></tfoot>
    </table></div>
    <p class="muted">Hodnoty jsou průměrné počty návštěv v dané hodině na jeden otevírací den
      (${vFmtInt(d.n_days)} dnů v reportu). Zvýrazněná je nejsilnější hodina, ze které vychází doporučení prostor.</p>
  </details>`;

  const mcDetail = m.mc ? renderVisitorMcHtml(m) : `<p class="muted">Report u této pobočky Monte Carlo model neuvádí.</p>`;


  return `<div class="visitor-section src-box-visit">
    <h3>Návštěvnost a doporučení prostor ${srcBadgeHtml("visit")}</h3>
    <p class="muted">${infoParts.join(" · ")}</p>
    <p class="muted">${branchParts.join(" · ")}</p>
    ${cards}
    ${roomsTable}
    ${compare}
    ${bankers}
    ${hoursDetail}
    ${mcDetail}
  </div>`;
}

/* ---------- Roční kapacita pobočky (barevný pruh pod kalkulací) ------------ */
// Tři pruhy na jedné škále (bankéř-hodiny za rok) ukazují, kolik času vlastně
// je a co ho spotřebuje:
//   1) otevírací doba × počet bankéřů — hrubý strop,
//   2) kolik z toho jsou bankéři fakticky přítomni (po odečtení nepřítomnosti),
//   3) kolik z přítomného času spotřebuje obsluha klientů podle reálných návštěv.
const YEAR_CAPACITY = {
  MEETING_SLOT_MINS: 60,   // schůzka 45 min + 15 min příprava
  WALKIN_MINS: 15,         // obsluha klienta bez objednání
  DEFAULT_OPEN_DAYS_YEAR: 252,
  DEFAULT_OPEN_DAYS_WEEK: 5,
};

function computeYearCapacity({ stats, visitor, calcResult }) {
  const inputRows = (calcResult && calcResult.inputRows) || [];
  const bankers = computeBankerFte(inputRows);
  if (!bankers.total) return null;

  const m = visitor ? computeVisitorMetrics(visitor) : null;

  // Otevírací doba: přednostně z reportu (zná i víkendové pobočky).
  let openHoursDay = null;
  let openDaysYear = YEAR_CAPACITY.DEFAULT_OPEN_DAYS_YEAR;
  let openSource = "";
  if (m && m.opening && m.opening.hoursPerWeek && m.opening.openDaysPerWeek) {
    openHoursDay = m.opening.hoursPerWeek / m.opening.openDaysPerWeek;
    openDaysYear = m.opening.annualOpenDays || YEAR_CAPACITY.DEFAULT_OPEN_DAYS_YEAR;
    openSource = `report: ${vFmt1(m.opening.hoursPerWeek)} h/týden, ${m.opening.openDaysPerWeek} dnů v týdnu`;
  } else if (calcResult && Number(calcResult.oteviraci_doba)) {
    openHoursDay = Number(calcResult.oteviraci_doba) / YEAR_CAPACITY.DEFAULT_OPEN_DAYS_WEEK;
    openSource = `kalkulace: ${fmt1(Number(calcResult.oteviraci_doba))} h/týden ÷ 5 dnů`;
  }
  if (!openHoursDay) return null;
  const openHoursYear = openHoursDay * openDaysYear;

  // Přítomnost: vážený průměr (1 − nepřítomnost − homeoffice) přes segmenty,
  // ve kterých jsou bankéři — ze stejné verze referenčních dat jako kalkulace.
  const version = calcResult && calcResult.refVersionId ? getRefVersionById(calcResult.refVersionId) : null;
  const absenceFor = (segment) => {
    if (version) {
      const [nep, ho] = absenceFromSnapshot(version.absence, segment);
      return (nep + ho) / 100;
    }
    const row = db ? dbAll("SELECT nepritomnost, homeoffice FROM absence WHERE segment = ?", [segment])[0] : null;
    return row ? ((row.nepritomnost || 0) + (row.homeoffice || 0)) / 100 : 0;
  };
  let weighted = 0;
  bankers.rows.forEach((r) => { weighted += r.fte * (1 - absenceFor(r.segment)); });
  const presenceFactor = bankers.total > 0 ? weighted / bankers.total : 1;

  const totalHours = bankers.total * openHoursYear;
  const presentHours = totalHours * presenceFactor;
  const absentHours = totalHours - presentHours;

  // Obsluha klientů podle reálných dat (přepočtená na rok podle otevíracích dnů).
  let meetingHours = null;
  let walkinHours = null;
  if (m && m.d && m.d.by_type && m.d.n_days) {
    const perDay = (n) => (Number(n) || 0) / m.d.n_days;
    const meetingsYear = (perDay(m.d.by_type.online) + perDay(m.d.by_type.fyzicka)) * openDaysYear;
    const walkinsYear = (perDay(m.d.by_type.bezhot) + perDay(m.d.by_type.hotovost)) * openDaysYear;
    meetingHours = (meetingsYear * YEAR_CAPACITY.MEETING_SLOT_MINS) / 60;
    walkinHours = (walkinsYear * YEAR_CAPACITY.WALKIN_MINS) / 60;
  }
  const clientHours = meetingHours === null ? null : meetingHours + walkinHours;
  const restHours = clientHours === null ? null : Math.max(0, presentHours - clientHours);

  return {
    bankers, openHoursDay, openDaysYear, openHoursYear, openSource,
    presenceFactor, absencePct: (1 - presenceFactor) * 100,
    totalHours, presentHours, absentHours,
    meetingHours, walkinHours, clientHours, restHours,
    utilPct: clientHours === null || presentHours <= 0 ? null : (clientHours / presentHours) * 100,
    overloaded: clientHours !== null && clientHours > presentHours,
  };
}

const YEAR_CAP_COLORS = {
  total: "#2770f0",
  present: "#0bb43f",
  absent: "#c9d2de",
  meetings: "#1b57c4",
  walkins: "#0891b2",
  rest: "#bfe6cd",
};

function renderYearCapacityHtml(yc) {
  if (!yc) return "";
  const hrs = (v) => `${Math.round(v).toLocaleString("cs-CZ")} h`;
  const pct = (v) => `${Math.round((v / yc.totalHours) * 100)} %`;
  const seg = (value, color, label) => `<div class="ycap-seg" style="width:${((value / yc.totalHours) * 100).toFixed(2)}%;
    background:${color};" title="${esc(label)}: ${hrs(value)}"><span>${esc(label)}</span></div>`;

  const bar3 = yc.clientHours === null
    ? `<div class="ycap-bar ycap-empty">Bez reportu návštěvnosti nelze spočítat, kolik času spotřebují klienti.</div>`
    : `<div class="ycap-bar">
        ${seg(yc.meetingHours, YEAR_CAP_COLORS.meetings, "Schůzky")}
        ${seg(yc.walkinHours, YEAR_CAP_COLORS.walkins, "Obsluha bez objednání")}
        ${seg(yc.restHours, YEAR_CAP_COLORS.rest, "Zbývá")}
      </div>`;

  const rows = [
    { label: "Otevřeno × bankéři", note: `${vFmtInt(yc.openDaysYear)} otevíracích dnů × ${vFmt1(yc.openHoursDay)} h `
        + `× ${vFmt1(yc.bankers.total)} FTE bankéřů`,
      bar: `<div class="ycap-bar">${seg(yc.totalHours, YEAR_CAP_COLORS.total, "Otevírací doba × bankéři")}</div>`,
      value: hrs(yc.totalHours), sub: "100 %" },
    { label: "Fakticky přítomni", note: `po odečtení nepřítomnosti a homeoffice (${vFmt1(yc.absencePct)} %)`,
      bar: `<div class="ycap-bar">${seg(yc.presentHours, YEAR_CAP_COLORS.present, "Na pobočce")}`
        + `${seg(yc.absentHours, YEAR_CAP_COLORS.absent, "Nepřítomnost")}</div>`,
      value: hrs(yc.presentHours), sub: pct(yc.presentHours) },
    { label: "Spotřebují klienti", note: yc.clientHours === null ? "chybí report návštěvnosti"
        : `schůzky ${hrs(yc.meetingHours)} (60 min/schůzku) + obsluha bez objednání ${hrs(yc.walkinHours)} (15 min)`,
      bar: bar3,
      value: yc.clientHours === null ? "—" : hrs(yc.clientHours),
      sub: yc.clientHours === null ? "" : pct(yc.clientHours) },
  ];

  const verdict = yc.utilPct === null ? "" : `<div class="ycap-verdict ${yc.overloaded ? "ycap-over"
    : yc.utilPct > 85 ? "ycap-tight" : "ycap-ok"}">
    ${yc.overloaded ? "❌" : yc.utilPct > 85 ? "⚠️" : "✅"}
    Obsluha klientů spotřebuje <strong>${vFmt1(yc.utilPct)} %</strong> času, který jsou bankéři na pobočce.
    ${yc.overloaded ? "Na tolik klientů kapacita nestačí — něco musí zůstat neobslouženo nebo se přesčas."
      : yc.utilPct > 85 ? "Zbývá jen malá rezerva na porady, školení a administrativu."
      : `Zbývá ${hrs(yc.restHours)} na porady, školení, administrativu a rezervu.`}</div>`;

  return `<div class="ycap-box src-box-mix">
    <h3>Roční kapacita — kolik času je a co ho spotřebuje ${srcBadgeHtml("mix")}</h3>
    <p class="muted">Vše je přepočítané na <strong>bankéř-hodiny za rok</strong> a všechny pruhy mají stejné
      měřítko (100 % = otevírací doba × počet bankéřů). Otevírací doba ${esc(yc.openSource)}.</p>
    <div class="ycap-rows">
      ${rows.map((r) => `<div class="ycap-row">
        <div class="ycap-label"><strong>${esc(r.label)}</strong><span class="muted">${esc(r.note)}</span></div>
        ${r.bar}
        <div class="ycap-value"><strong>${esc(r.value)}</strong><span class="muted">${esc(r.sub)}</span></div>
      </div>`).join("")}
    </div>
    ${verdict}
  </div>`;
}

// Stejný pruhový přehled do PDF.
function drawYearCapacityPdf(pdf, startY, yc, marginX, pageBottom, color) {
  if (!yc) return startY;
  let y = startY;
  const labelW = 52;
  const valueW = 28;
  const trackX = marginX + labelW;
  const trackW = 182 - labelW - valueW;
  const hrs = (v) => `${Math.round(v).toLocaleString("cs-CZ")} h`;
  const wOf = (v) => (v / yc.totalHours) * trackW;

  y = drawPdfSectionTitle(pdf, y, "Roční kapacita — kolik času je a co ho spotřebuje", color,
    { need: 50, marginX, pageBottom, space: 0 });
  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(7.5);
  pdf.setTextColor(120, 120, 120);
  pdf.splitTextToSize("Vše přepočítané na bankéř-hodiny za rok, všechny pruhy mají stejné měřítko "
    + `(100 % = otevírací doba × počet bankéřů). Otevírací doba ${yc.openSource}.`, 182)
    .forEach((l) => { pdf.text(l, marginX, y); y += 4; });
  pdf.setTextColor(0, 0, 0);
  y += 2;

  const rows = [
    { label: "Otevřeno × bankéři",
      note: `${vFmtInt(yc.openDaysYear)} dnů × ${vFmt1(yc.openHoursDay)} h × ${vFmt1(yc.bankers.total)} FTE`,
      segs: [[yc.totalHours, YEAR_CAP_COLORS.total]], value: hrs(yc.totalHours), sub: "100 %" },
    { label: "Fakticky přítomni", note: `nepřítomnost ${vFmt1(yc.absencePct)} %`,
      segs: [[yc.presentHours, YEAR_CAP_COLORS.present], [yc.absentHours, YEAR_CAP_COLORS.absent]],
      value: hrs(yc.presentHours), sub: `${Math.round((yc.presentHours / yc.totalHours) * 100)} %` },
  ];
  if (yc.clientHours !== null) {
    rows.push({ label: "Spotřebují klienti", note: "schůzky 60 min · obsluha bez objednání 15 min",
      segs: [[yc.meetingHours, YEAR_CAP_COLORS.meetings], [yc.walkinHours, YEAR_CAP_COLORS.walkins],
        [yc.restHours, YEAR_CAP_COLORS.rest]],
      value: hrs(yc.clientHours), sub: `${Math.round((yc.clientHours / yc.totalHours) * 100)} %` });
  }

  const rowH = 11;
  rows.forEach((r) => {
    if (y + rowH > pageBottom) { pdf.addPage(); y = 18; }
    pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(7.6);
    pdf.text(r.label, marginX, y + 3.6, { maxWidth: labelW - 2 });
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(6.6);
    pdf.setTextColor(120, 120, 120);
    pdf.text(r.note, marginX, y + 7.4, { maxWidth: labelW - 2 });
    pdf.setTextColor(0, 0, 0);

    pdfFill(pdf, "#eef2f9");
    pdf.rect(trackX, y, trackW, 6, "F");
    let cx = trackX;
    r.segs.forEach(([value, color]) => {
      const w = wOf(value);
      if (w <= 0) return;
      pdfFill(pdf, color);
      pdf.rect(cx, y, w, 6, "F");
      cx += w;
    });

    pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(7.6);
    pdf.text(r.value, trackX + trackW + 2, y + 3.6);
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(6.6);
    pdf.setTextColor(120, 120, 120);
    pdf.text(r.sub, trackX + trackW + 2, y + 7.4);
    pdf.setTextColor(0, 0, 0);
    y += rowH;
  });

  // Legenda
  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(6.8);
  let lx = trackX;
  [["Na pobočce", YEAR_CAP_COLORS.present], ["Nepřítomnost", YEAR_CAP_COLORS.absent],
    ["Schůzky", YEAR_CAP_COLORS.meetings], ["Bez objednání", YEAR_CAP_COLORS.walkins],
    ["Zbývá", YEAR_CAP_COLORS.rest]].forEach(([label, color]) => {
    pdfFill(pdf, color);
    pdf.rect(lx, y + 0.6, 3, 2.4, "F");
    pdf.setTextColor(110, 118, 130);
    pdf.text(label, lx + 4, y + 2.8);
    lx += 4 + pdf.getTextWidth(label) + 5;
  });
  pdf.setTextColor(0, 0, 0);
  y += 6;

  if (yc.utilPct !== null) {
    pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(8.5);
    const [cr, cg, cb] = hexToRgb(yc.overloaded ? "#a41f1f" : yc.utilPct > 85 ? "#8a5c00" : "#0a7a33");
    const verdictLines = pdf.splitTextToSize(
      `Obsluha klientů spotřebuje ${vFmt1(yc.utilPct)} % času, který jsou bankéři na pobočce`
      + `${yc.overloaded ? " — na tolik klientů kapacita nestačí."
        : yc.utilPct > 85 ? " — rezerva na porady a administrativu je malá."
        : ` — zbývá ${hrs(yc.restHours)} na porady, školení a administrativu.`}`, 178);
    // Verdikt se nerozděluje mezi stránky — buď se vejde celý, nebo jde na další.
    if (y + verdictLines.length * 5 + 4 > pageBottom) { pdf.addPage(); y = 18; }
    pdf.setTextColor(cr, cg, cb);
    verdictLines.forEach((l) => { pdf.text(l, marginX, y + 3); y += 5; });
    pdf.setTextColor(0, 0, 0);
    y += 3;
  }

  return y + 3;
}

/* ------- Tři kontroly kapacity míst pro schůzky (meeting zone) ------------- */
// Tři nezávislé pohledy na otázku „stačí WPL v meeting zone?“:
//   1) kapacita bankéřů — každý bankéř má zvládnout 5 schůzek denně,
//   2) klientský model — každý klient pobočky přijde 1× ročně na schůzku,
//   3) reálná data návštěv z reportu návštěvnosti.
const MEETING_CHECK_MODEL = {
  MEETING_MINS: 45,             // délka schůzky
  PREP_MINS: 15,                // příprava/úklid mezi schůzkami
  MEETINGS_PER_BANKER_DAY: 5,   // kolik schůzek denně má bankéř zvládnout
  CLIENT_MEETINGS_PER_YEAR: 1,  // kolikrát ročně přijde klient na schůzku
  DEFAULT_OPEN_DAYS_WEEK: 5,
  DEFAULT_OPEN_DAYS_YEAR: 252,
};

function computeMeetingChecks({ stats, m, bankerFte, counts, calcResult }) {
  const slotMins = MEETING_CHECK_MODEL.MEETING_MINS + MEETING_CHECK_MODEL.PREP_MINS;

  // Kolik minut denně je pobočka otevřená — přednostně z reportu (zná i to,
  // jestli je pobočka víkendová), jinak z otevírací doby zadané v kalkulaci.
  let openMinutes = null;
  let openSource = "";
  if (m && m.opening && m.opening.hoursPerWeek && m.opening.openDaysPerWeek) {
    openMinutes = (m.opening.hoursPerWeek / m.opening.openDaysPerWeek) * 60;
    openSource = `${vFmt1(m.opening.hoursPerWeek)} h/týden ÷ ${m.opening.openDaysPerWeek} otevíracích dnů (report)`;
  } else if (calcResult && Number(calcResult.oteviraci_doba)) {
    openMinutes = (Number(calcResult.oteviraci_doba) / MEETING_CHECK_MODEL.DEFAULT_OPEN_DAYS_WEEK) * 60;
    openSource = `${fmt1(Number(calcResult.oteviraci_doba))} h/týden ÷ ${MEETING_CHECK_MODEL.DEFAULT_OPEN_DAYS_WEEK} dnů (kalkulace)`;
  }
  if (!openMinutes) return null;

  const wplFromCalc = stats.meetingZoneWpl || 0;
  const inLayout = counts ? counts.meetings : 0;
  const available = inLayout > 0 ? inLayout : wplFromCalc;
  const availableLabel = inLayout > 0
    ? `${fmtPieces(inLayout)} míst v layoutu`
    : `${fmt1(wplFromCalc)} WPL z kalkulace`;

  // Potřeba míst = kolik schůzkových hodin za den je potřeba obsloužit,
  // vydělené délkou otevírací doby (Littleho pravidlo).
  const placesFor = (meetingsPerDay) => (meetingsPerDay * slotMins) / openMinutes;
  const mk = (key, index, title, assumption, meetingsPerDay, formula, extra) => {
    const need = placesFor(meetingsPerDay);
    const needRounded = Math.ceil(Math.round(need * 100) / 100);
    return {
      key, index, title, assumption, formula, extra: extra || null,
      meetingsPerDay, need, needRounded, available, availableLabel,
      inLayout, wplFromCalc,
      missing: Math.max(0, needRounded - available),
      status: capacityStatus(needRounded, available),
    };
  };

  const checks = [];

  // 1) Kapacita bankéřů
  const bankers = bankerFte.sales > 0 ? bankerFte.sales : bankerFte.total; // schůzky dělají osobní bankéři
  if (bankers > 0) {
    const meetingsPerDay = bankers * MEETING_CHECK_MODEL.MEETINGS_PER_BANKER_DAY;
    checks.push(mk("bankers", 1, "Aby bankéři stihli 5 schůzek denně",
      `Každý z ${vFmt1(bankers)} osobních bankéřů v kalkulaci má denně odbavit `
      + `${MEETING_CHECK_MODEL.MEETINGS_PER_BANKER_DAY} schůzky (${MEETING_CHECK_MODEL.MEETING_MINS} min schůzka `
      + `+ ${MEETING_CHECK_MODEL.PREP_MINS} min příprava = ${slotMins} min).`,
      meetingsPerDay,
      `${vFmt1(bankers)} osobních bankéřů × ${MEETING_CHECK_MODEL.MEETINGS_PER_BANKER_DAY} schůzek × ${slotMins} min `
      + `÷ ${Math.round(openMinutes)} min otevřeno`));
  }

  // 2) Klientský model — každý klient 1× ročně
  const clients = m && m.d ? Number(m.d.poc_kli) || 0 : 0;
  const openDaysYear = (m && m.d && Number(m.d.annual_open_days)) || MEETING_CHECK_MODEL.DEFAULT_OPEN_DAYS_YEAR;
  if (clients > 0) {
    const meetingsPerDay = (clients * MEETING_CHECK_MODEL.CLIENT_MEETINGS_PER_YEAR) / openDaysYear;
    checks.push(mk("clients", 2, "Kdyby každý klient přišel 1× ročně",
      `Pobočka má ${vFmtInt(clients)} klientů. Kdyby každý z nich přišel jednou za rok na schůzku, `
      + `vyjde to na ${vFmt1(meetingsPerDay)} schůzek denně.`,
      meetingsPerDay,
      `${vFmtInt(clients)} klientů ÷ ${vFmtInt(openDaysYear)} otevíracích dnů × ${slotMins} min `
      + `÷ ${Math.round(openMinutes)} min otevřeno`));
  }

  // 3) Reálná data návštěv
  if (m && m.d && m.d.by_type && m.d.n_days) {
    const realMeetings = (Number(m.d.by_type.online) || 0) + (Number(m.d.by_type.fyzicka) || 0);
    const meetingsPerDay = realMeetings / m.d.n_days;
    const peakRooms = m.rooms ? m.rooms.meeting_rooms : null;
    const check = mk("real", 3, "Podle skutečných návštěv z reportu",
      `Za ${vFmtInt(m.d.n_days)} dnů přišlo na schůzku ${vFmtInt(realMeetings)} klientů, `
      + `to je ${vFmt1(meetingsPerDay)} schůzek na otevírací den.`,
      meetingsPerDay,
      `${vFmt1(meetingsPerDay)} schůzek/den × ${slotMins} min ÷ ${Math.round(openMinutes)} min otevřeno`,
      peakRooms !== null
        ? `Tohle je průměrný den. Ve špičce silného dne je potřeba ${vFmtInt(peakRooms)} míst `
          + `(doporučení prostor z reportu).`
        : null);
    check.peakRooms = peakRooms;
    checks.push(check);
  }

  return checks.length ? { slotMins, openMinutes, openSource, available, availableLabel, inLayout, wplFromCalc, checks } : null;
}

function renderMeetingChecksHtml(mc) {
  if (!mc) return "";
  const cards = mc.checks.map((c) => {
    const meta = CAPACITY_STATUS_META[c.status] || CAPACITY_STATUS_META.none;
    return `<div class="mcheck mcheck-${c.status}">
      <div class="mcheck-head"><span class="mcheck-num">Kontrola ${c.index}</span>
        <span class="mcheck-title">${esc(c.title)}</span></div>
      <p class="mcheck-assume">${esc(c.assumption)}</p>
      <div class="mcheck-numbers">
        <div><span class="mcheck-label">Potřeba míst</span><span class="mcheck-value">${c.needRounded}</span>
          <span class="mcheck-sub">${vFmt2(c.need)} přesně</span></div>
        <div><span class="mcheck-label">K dispozici</span><span class="mcheck-value">${fmtPieces(c.available)}</span>
          <span class="mcheck-sub">${esc(c.availableLabel)}</span></div>
      </div>
      <p class="mcheck-formula">${esc(c.formula)}</p>
      <div class="mcheck-verdict">${meta.icon} ${c.status === "ok"
        ? "Stačí." : c.status === "tight" ? `Těsné — může chybět ${fmtPieces(c.missing)}.`
        : `Nestačí — chybí ${fmtPieces(c.missing)}.`}</div>
      ${c.extra ? `<p class="mcheck-extra">${esc(c.extra)}</p>` : ""}
    </div>`;
  }).join("");

  return `<h4>Tři kontroly míst pro schůzky (meeting zone) ${srcBadgeHtml("mix")}</h4>
    <p class="muted">Tři nezávislé pohledy na stejnou otázku — stačí místa na schůzky?
      Schůzka se počítá jako ${MEETING_CHECK_MODEL.MEETING_MINS} min + ${MEETING_CHECK_MODEL.PREP_MINS} min příprava
      (${mc.slotMins} min na jedno místo), otevírací doba ${esc(mc.openSource)}
      = ${Math.round(mc.openMinutes)} minut denně.</p>
    <div class="mcheck-grid">${cards}</div>`;
}

// Zástupný text, pokud pro pobočku nejsou naimportovaná data návštěvnosti.
function renderVisitorMissingHtml(pobockaNazev, pobockaId) {
  const imported = db ? dbAll("SELECT COUNT(*) AS n FROM visitor_data")[0].n : 0;
  return `<div class="visitor-section src-box-visit">
    <h3>Návštěvnost a doporučení prostor ${srcBadgeHtml("visit")}</h3>
    <p class="muted">${imported
      ? `Naimportovaný report návštěvnosti neobsahuje pobočku „${esc(pobockaNazev || "")}“ (ID ${esc(pobockaId || "")}).`
      : "Zatím není naimportovaný žádný report návštěvnosti."}
      Doporučení prostor (zasedací místnosti a servisní místa), návštěvy po hodinách a Monte Carlo model
      se do kalkulace doplní po nahrání HTML reportu návštěvnosti v záložce <strong>„Návštěvnost“</strong>.</p>
  </div>`;
}

// Otevírací doba pobočky z reportu a denní návštěvy na bankéře — spočítané
// z reálných návštěv reportu a z FTE bankéřů zadaných v kalkulaci.
function renderVisitorBankersHtml(m, inputRows) {
  const d = m.d;
  const opening = m.opening;
  const perDay = m.visitsPerDay;
  const bankers = computeBankerFte(inputRows);
  const reportBankers = Number(d.bankers) || 0;

  const openingLine = [
    opening.hoursPerWeek ? `<strong>${vFmt1(opening.hoursPerWeek)} h/týden</strong>` : null,
    opening.openDaysPerWeek ? `${opening.openDaysPerWeek} dnů v týdnu` : null,
    opening.label,
    opening.annualOpenDays ? `${vFmtInt(opening.annualOpenDays)} otevíracích dnů/rok` : null,
    d.n_days ? `${vFmtInt(d.n_days)} dnů s návštěvami v datech reportu` : null,
  ].filter(Boolean).join(" · ");

  const perBanker = (fte) => (fte > 0 && perDay !== null ? perDay / fte : null);
  const card = (label, value, sub) => `<div class="vcard"><div class="vcard-l">${label}</div>
    <div class="vcard-v">${value}</div><div class="vcard-s">${sub}</div></div>`;

  const cards = `<div class="visitor-cards">
    ${card("Denní návštěvy na bankéře", bankers.total > 0 ? vFmt1(perBanker(bankers.total)) : "—",
      bankers.total > 0 ? `${vFmt1(perDay)} návštěv/den ÷ ${vFmt1(bankers.total)} FTE bankéřů z kalkulace`
        : "v kalkulaci není žádná pozice bankéře")}
    ${bankers.sales > 0 ? card("Jen osobní bankéři (schůzky)",
      vFmt1(perBanker(bankers.sales)),
      `${vFmt1(perDay)} návštěv/den ÷ ${vFmt1(bankers.sales)} FTE osobních bankéřů`) : ""}
    ${reportBankers > 0 ? card("Dle stavu v reportu", vFmt1(perBanker(reportBankers)),
      `${vFmt1(perDay)} návštěv/den ÷ ${vFmt1(reportBankers)} FTE bankéřů OB dle reportu`) : ""}
    ${card("Otevírací doba dle reportu", opening.hoursPerWeek ? `${vFmt1(opening.hoursPerWeek)} h` : "—",
      opening.isWeekend ? "otevřeno i o víkendu" : "jen pracovní dny")}
  </div>`;

  const bankerRows = bankers.rows.length
    ? `<div class="table-wrap"><table class="visitor-table">
        <thead><tr><th>Segment</th><th>Pozice</th><th>FTE</th><th>Typ</th></tr></thead>
        <tbody>${bankers.rows.map((r) => `<tr><td>${segmentBadgeHtml(r.segment)}</td>
          <td>${esc(r.pozice)}</td><td class="num">${vFmt1(r.fte)}</td>
          <td>${esc([r.ob ? "schůzky" : null, r.service ? "servis" : null,
            r.cashier ? "pokladna" : null].filter(Boolean).join(" + "))}</td></tr>`).join("")}
          <tr class="total-row"><td>Celkem</td><td></td><td class="num">${vFmt1(bankers.total)}</td>
            <td>${vFmt1(bankers.sales)} schůzky · ${vFmt1(bankers.serviceTotal)} servis${bankers.serviceAlso > 0
              ? ` (z toho ${vFmt1(bankers.serviceAlso)} OB junior)` : ""}${bankers.cashier > 0
              ? ` · ${vFmt1(bankers.cashier)} pokladna` : ""}</td></tr>
        </tbody></table></div>`
    : `<p class="muted">V kalkulaci není žádná z pozic obsluhujících klienta (osobní bankéř junior/medior/senior/master,
        bankéř klientské péče medior/junior) — ukazatel návštěv na bankéře nelze spočítat.</p>`;

  const openingTable = opening.days.length
    ? `<div class="table-wrap"><table class="visitor-table">
        <thead><tr><th>Den</th><th>Dopoledne</th><th>Odpoledne</th><th>Celkem</th></tr></thead>
        <tbody>${opening.days.map((x) => `<tr${x.wknd ? ' class="visitor-peak"' : ""}>
          <td>${esc(x.lbl)}</td><td>${x.closed ? "zavřeno" : esc(x.dop || "")}</td>
          <td>${x.closed ? "" : esc(x.odp || "")}</td><td class="num">${x.closed ? "—" : esc(x.tot || "")}</td>
          </tr>`).join("")}</tbody></table></div>`
    : `<p class="muted">Report u této pobočky otevírací dobu po dnech neuvádí.</p>`;

  const weekdayTable = m.weekdays.length
    ? `<div class="table-wrap"><table class="visitor-table">
        <thead><tr><th>Den</th><th>Otevírací doba</th><th>Dnů v datech</th><th>Návštěv celkem</th>
          <th>Návštěv/den</th><th>Na bankéře</th></tr></thead>
        <tbody>${m.weekdays.map((r) => `<tr${r.weekend ? ' class="visitor-peak"' : ""}>
          <td>${esc(r.name)}</td><td>${r.closed ? "zavřeno" : esc(r.hours || "—")}</td>
          <td class="num">${vFmtInt(r.days)}</td><td class="num">${vFmtInt(r.total)}</td>
          <td class="num">${r.perDay === null ? "—" : vFmt1(r.perDay)}</td>
          <td class="num">${r.perDay !== null && bankers.total > 0 ? vFmt1(r.perDay / bankers.total) : "—"}</td>
          </tr>`).join("")}</tbody></table></div>`
    : "";

  return `<h4>Otevírací doba a návštěvy na bankéře ${srcBadgeHtml("mix")}</h4>
    <p class="muted">${openingLine || "Report u této pobočky otevírací dobu neuvádí."}</p>
    ${cards}
    ${bankerRows}
    <details class="visitor-details"><summary>Otevírací doba a návštěvnost po dnech týdne</summary>
      ${openingTable}
      ${weekdayTable}
      <p class="muted">Průměr na den se u každého dne počítá z počtu dnů, které jsou pro daný den v datech
        reportu — u víkendových dnů je jich typicky méně. Sloupec „Na bankéře“ dělí návštěvy na den
        počtem FTE bankéřů z kalkulace${bankers.total > 0 ? ` (${vFmt1(bankers.total)})` : ""}.</p>
    </details>`;
}

// Srovnání doporučení z reálné návštěvnosti s potřebou WPL, která vyšla
// z kalkulace podle FTE — dvě nezávislé cesty ke stejné otázce „kolik míst“.
function renderVisitorCompareHtml(rooms, stats) {
  const row = (label, calcValue, reportValue, hint) => {
    const diff = reportValue - calcValue;
    // Kladný rozdíl (report chce víc míst než kalkulace) je riziko kapacity →
    // oranžově; záporný je jen informace o rezervě → modře.
    const cls = Math.abs(diff) < 0.5 ? "visitor-cool" : diff > 0 ? "visitor-warm" : "visitor-neutral";
    return `<tr><td>${esc(label)}</td><td class="num">${vFmt1(calcValue)}</td>
      <td class="num">${vFmtInt(reportValue)}</td>
      <td class="num ${cls}">${diff >= 0 ? "+" : ""}${vFmt1(diff)}</td>
      <td class="muted">${esc(hint)}</td></tr>`;
  };
  return `<h4>Srovnání s kalkulací ${srcBadgeHtml("mix")}</h4>
    <div class="table-wrap"><table class="visitor-table">
      <thead><tr><th>Prostor</th><th>Kalkulace (WPL z FTE)</th><th>Doporučení z návštěvnosti</th>
        <th>Rozdíl</th><th></th></tr></thead>
      <tbody>
        ${row("Místa pro jednání s klientem (meeting zone)", stats.meetingZoneWpl, rooms.meeting_rooms,
          "kalkulace vychází z časových dotací pozic, report ze špičky schůzek")}
        ${row("Servisní místa (service zone)", stats.serviceZoneWpl, rooms.service_desks,
          "kalkulace vychází z časových dotací pozic, report ze špičky walk-inů")}
      </tbody></table></div>
    <p class="muted">Kladný rozdíl znamená, že reálná návštěvnost ve špičce potřebuje víc míst, než vychází
      z kalkulace FTE → WPL; záporný naopak. Doporučení prostor z reportu kalkulaci nepřepisuje — slouží
      jako druhý pohled při sestavování layoutu.</p>`;
}

/* ------------- Grafy Monte Carla v aplikaci (SVG) -------------------------- */
// Stejné dva grafy jako v PDF: křivka P95 poptávky po hodinách proti kapacitě
// a histogram rozdělení celkové denní poptávky.

function svgFteLineChart(mc, hasSvc, W = 520, H = 150) {
  if (!mc || !mc.rows.length) return "";
  const pl = 30;
  const pr = 46;
  const pt = 8;
  const pb = 20;
  const pw = W - pl - pr;
  const ph = H - pt - pb;
  const rows = mc.rows;
  const n = rows.length;
  const capOb = mc.obCapFte || 0;
  const capSvc = mc.svcCapFte || 0;
  const maxY = Math.max(...rows.map((r) => r.p95ObFte), ...(hasSvc ? rows.map((r) => r.p95SvcFte) : [0]),
    capOb, hasSvc ? capSvc : 0) * 1.15 || 1;
  const xs = (i) => pl + (n > 1 ? (i / (n - 1)) * pw : 0);
  const ys = (v) => pt + ph * (1 - Math.min(v, maxY) / maxY);
  const step = chartTickStep(maxY);

  let grid = "";
  for (let v = 0; v <= maxY * 1.02; v += step) {
    const yy = ys(v).toFixed(1);
    grid += `<line x1="${pl}" y1="${yy}" x2="${pl + pw}" y2="${yy}" stroke="#e2e8f0" stroke-width="1"/>`
      + `<text x="${pl - 4}" y="${yy}" text-anchor="end" dominant-baseline="middle" font-size="9"
         fill="#94a3b8">${Math.round(v * 100) / 100}</text>`;
  }
  const xLabels = rows.map((r, i) => (i % 2 === 0
    ? `<text x="${xs(i).toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="9" fill="#94a3b8">${r.hour}h</text>`
    : "")).join("");
  const capLine = (value, color, label) => `<line x1="${pl}" y1="${ys(value).toFixed(1)}" x2="${pl + pw}"
      y2="${ys(value).toFixed(1)}" stroke="${color}" stroke-width="1.6" stroke-dasharray="6,3"/>
    <text x="${pl + pw + 3}" y="${ys(value).toFixed(1)}" dominant-baseline="middle" font-size="9"
      fill="${color}">${label} ${vFmt1(value)}</text>`;
  const line = (values, color, width) => `<path d="${values.map((v, i) =>
    `${i === 0 ? "M" : "L"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(" ")}"
    fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"/>`;
  const obValues = rows.map((r) => r.p95ObFte);
  const area = `<path d="${obValues.map((v, i) => `${i === 0 ? "M" : "L"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(" ")}
    L${xs(n - 1).toFixed(1)},${(pt + ph).toFixed(1)} L${pl},${(pt + ph).toFixed(1)} Z" fill="#2770f0" fill-opacity="0.07"/>`;

  return `<svg viewBox="0 0 ${W} ${H}" class="mc-svg" role="img">
    <rect x="${pl}" y="${pt}" width="${pw}" height="${ph}" fill="#f8faff" rx="3"/>
    ${grid}${xLabels}
    ${capLine(capOb, "#2563eb", "OB")}
    ${hasSvc ? capLine(capSvc, "#d97706", "SVC") : ""}
    ${area}
    ${hasSvc ? line(rows.map((r) => r.p95SvcFte), "#d97706", 1.6) : ""}
    ${line(obValues, "#2563eb", 2.2)}
    <line x1="${pl}" y1="${pt}" x2="${pl}" y2="${pt + ph}" stroke="#94a3b8" stroke-width="1"/>
    <line x1="${pl}" y1="${pt + ph}" x2="${pl + pw}" y2="${pt + ph}" stroke="#94a3b8" stroke-width="1"/>
  </svg>`;
}

function svgHistChart(counts, edges, capV, p95V, color, W = 250, H = 120) {
  if (!counts || !counts.length || !edges || edges.length < 2) return "";
  const pl = 26;
  const pr = 16;
  const pt = 6;
  const pb = 18;
  const pw = W - pl - pr;
  const ph = H - pt - pb;
  const maxX = edges[edges.length - 1] || 1;
  const maxC = Math.max(...counts, 1);
  const xs = (v) => pl + (Math.min(v, maxX) / maxX) * pw;
  const ys = (v) => pt + ph * (1 - v / maxC);
  const bars = counts.map((c, i) => {
    if (!c) return "";
    const x1 = xs(edges[i]);
    const w = Math.max(xs(edges[i + 1]) - x1 - 0.5, 0.6);
    const yy = ys(c);
    return `<rect x="${x1.toFixed(1)}" y="${yy.toFixed(1)}" width="${w.toFixed(1)}"
      height="${(pt + ph - yy).toFixed(1)}" fill="${color}" fill-opacity="0.8"/>`;
  }).join("");
  const vline = (value, stroke) => (value > 0
    ? `<line x1="${xs(value).toFixed(1)}" y1="${pt}" x2="${xs(value).toFixed(1)}" y2="${pt + ph}"
        stroke="${stroke}" stroke-width="1.6" stroke-dasharray="4,3"/>`
    : "");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const v = t * maxX;
    return `<text x="${xs(v).toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="9"
      fill="#94a3b8">${vFmt1(v)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="mc-svg" role="img">
    <rect x="${pl}" y="${pt}" width="${pw}" height="${ph}" fill="#f8faff" rx="3"/>
    ${bars}${vline(capV, "#475569")}${vline(p95V, "#16a34a")}
    <line x1="${pl}" y1="${pt}" x2="${pl}" y2="${pt + ph}" stroke="#94a3b8" stroke-width="1"/>
    <line x1="${pl}" y1="${pt + ph}" x2="${pl + pw}" y2="${pt + ph}" stroke="#94a3b8" stroke-width="1"/>
    ${ticks}
  </svg>`;
}

// Oba grafy pohromadě i s popisky — používá se v sekci Monte Carla.
function visitorMcChartsHtml(m, mc, hasSvc) {
  return `<div class="mc-charts">
    <div class="mc-chart-title">P95 FTE poptávka po hodinách (6h–21h)</div>
    <div class="mc-chart-note">OB (modrá)${hasSvc ? " · servis BKP (oranžová)" : ""} · kapacita = přerušovaná čára
      (FTE = bankéř × ${Math.round(mc.presencePct)} % přítomnost)</div>
    ${svgFteLineChart(mc, hasSvc)}
    <div class="mc-chart-title">Distribuce celkové denní FTE poptávky (bankéř-hodiny/den)</div>
    <div class="mc-chart-note">Frekvence simulovaných dnů · šedá přerušovaná = kapacita · zelená = P95 poptávky</div>
    <div class="mc-hist-row">
      <div>
        <div class="mc-hist-title" style="color:#2563eb;">OB tým (schůzky) — kapacita ${vFmt1(mc.obCapDay)} h ·
          P95 ${vFmt1(mc.obP95Day)} h</div>
        ${svgHistChart(mc.obHist, mc.obEdges, mc.obCapDay, mc.obP95Day, "#2563eb", hasSvc ? 250 : 520, 120)}
      </div>
      ${hasSvc ? `<div>
        <div class="mc-hist-title" style="color:#d97706;">Servisní zóna (BKP) — kapacita ${vFmt1(mc.svcCapDay)} h ·
          P95 ${vFmt1(mc.svcP95Day)} h</div>
        ${svgHistChart(mc.svcHist, mc.svcEdges, mc.svcCapDay, mc.svcP95Day, "#d97706", 250, 120)}
      </div>` : ""}
    </div>
  </div>`;
}

function renderVisitorMcHtml(m) {
  const mc = m.mc;
  const utilCls = (v) => (v >= 100 ? "visitor-hot" : v >= 85 ? "visitor-warm" : "visitor-cool");
  const overloadCls = (v) => (v >= 50 ? "visitor-hot" : v > 0 ? "visitor-warm" : "visitor-cool");
  const summaryRow = (label, base, boost) => `<tr><td>${esc(label)}</td><td class="num">${base}</td>
    ${m.mcBoost ? `<td class="num">${boost}</td>` : ""}</tr>`;
  const sum = (x) => [
    ["Pravděpodobné hodiny přetížení / den", `${vFmt1(x.overloadHours)} h`],
    ["Pokrytí poptávky (podíl simulací bez přetížení)", x.coveragePct === null || x.coveragePct === undefined ? "—" : `${vFmt1(x.coveragePct)} %`],
    ["Bankéřů OB pro 95% pokrytí", x.bankersFor95 === null || x.bankersFor95 === undefined ? "> +3" : vFmt1(x.bankersFor95)],
    ["Bankéřů OB dnes", vFmt1(x.currentBankers)],
    ["Špičková P95 poptávka OB", `${vFmt1(x.peakP95Ob)} FTE/hod`],
    ["Kapacita OB", `${vFmt1(x.obCapFte)} FTE/hod · ${vFmt1(x.obCapDay)} h/den`],
    ["P95 denní poptávka OB", `${vFmt1(x.obP95Day)} h/den`],
    ["Servisní zóna (BKP)", x.svcFte ? `${vFmt1(x.svcFte)} FTE · kapacita ${vFmt1(x.svcCapDay)} h/den · P95 ${vFmt1(x.svcP95Day)} h/den` : "—"],
  ];
  const baseSum = sum(mc);
  const boostSum = m.mcBoost ? sum(m.mcBoost) : null;
  const summary = baseSum.map(([label, v], i) => summaryRow(label, v, boostSum ? boostSum[i][1] : "")).join("");

  const hasSvc = !!(m.d.has_svc && mc.svcFte);
  // Detailní hodinová tabulka je nahrazená grafy (stejnými jako v PDF); zůstává
  // schovaná jako doplněk pro toho, kdo potřebuje přesná čísla.
  const hourRows = mc.rows.map((r) => `<tr>
    <td>${esc(visitorHourLabel(r.hour))}</td>
    <td class="num">${vFmt2(r.lamFyzicka)}</td><td class="num">${vFmt2(r.lamOnline)}</td>
    <td class="num">${vFmt2(r.lamBezhot)}</td>
    <td class="num">${vFmt1(r.p95ObFte)}</td><td class="num">${vFmt1(r.p95SvcFte)}</td>
    <td class="num">${vFmt1(r.p50Util)} %</td>
    <td class="num ${utilCls(r.p95Util)}">${vFmt1(r.p95Util)} %</td>
    <td class="num ${overloadCls(r.overloadProb)}">${vFmt1(r.overloadProb)} %</td>
  </tr>`).join("");

  return `<details class="visitor-details"><summary>${srcBadgeHtml("visit")} Monte Carlo model průměrného dne
      (${vFmtInt(mc.nIter)} simulací)</summary>
    <p class="muted">Příchody v každé hodině se losují z Poissonova rozdělení s λ z reálných dat, kapacita
      počítá s ${vFmt1(mc.presencePct)} % efektivní přítomností bankéře.
      ${m.mcBoost ? "Druhý sloupec je varianta s vyšší návštěvností (+20 %) z reportu." : ""}</p>
    <div class="table-wrap"><table class="visitor-table">
      <thead><tr><th>Ukazatel</th><th>Základní varianta</th>${m.mcBoost ? "<th>Varianta +20 %</th>" : ""}</tr></thead>
      <tbody>${summary}</tbody></table></div>
    ${visitorMcChartsHtml(m, mc, hasSvc)}
    <details class="visitor-details" style="margin-top:12px;">
      <summary>Přesná čísla po hodinách (tabulka)</summary>
      <div class="table-wrap" style="margin-top:8px;"><table class="visitor-table">
        <thead><tr><th>Hodina</th><th>λ fyzická</th><th>λ online</th><th>λ bezhot.</th>
          <th>P95 OB FTE</th><th>P95 servis FTE</th><th>Vytížení P50</th><th>Vytížení P95</th>
          <th>Přetížení</th></tr></thead>
        <tbody>${hourRows}</tbody></table></div>
      <p class="muted">Vytížení = poptávka / kapacita v dané hodině (P50 = medián, P95 = 95. percentil simulací).
        „Přetížení“ je podíl simulací, ve kterých poptávka v dané hodině přeteče kapacitu.</p>
    </details>
  </details>`;
}

/* ------------------------------- Záložka ---------------------------------- */

let visitorFilterText = "";

function renderVisitorList() {
  const el = document.getElementById("visitorList");
  if (!el) return;
  if (!db) { el.innerHTML = `<p class="muted">Databáze není připojena.</p>`; return; }
  const rows = dbAll("SELECT * FROM visitor_data ORDER BY nazev");
  if (!rows.length) {
    el.innerHTML = `<p class="muted">Zatím není naimportovaný žádný report návštěvnosti.</p>`;
    return;
  }
  const needle = visitorFilterText.trim().toLowerCase();
  const items = rows.map(decodeVisitorRow).filter(Boolean).filter((v) => !needle
    || String(v.nazev).toLowerCase().includes(needle) || String(v.pobocka_id).toLowerCase().includes(needle));
  const body = items.map((v) => {
    const m = computeVisitorMetrics(v);
    return `<tr class="visitor-row" data-id="${esc(v.pobocka_id)}">
      <td>${esc(v.pobocka_id)}</td><td><strong>${esc(v.nazev)}</strong></td>
      <td>${esc(m.d.branch_format || "—")}</td>
      <td class="num">${vFmtInt(m.d.total)}</td>
      <td class="num">${vFmt1(m.visitsPerDay)}</td>
      <td>${m.peakHour ? esc(visitorHourLabel(m.peakHour.hour)) : "—"}</td>
      <td class="num">${vFmtInt(m.rooms.meeting_rooms)}${m.rooms.derived ? "*" : ""}</td>
      <td class="num">${vFmtInt(m.rooms.service_desks)}${m.rooms.derived ? "*" : ""}</td>
      <td class="num">${m.mc ? `${vFmt1(m.mc.overloadHours)} h` : "—"}</td>
    </tr>`;
  }).join("");
  el.innerHTML = `<p class="muted">Report: <strong>${esc(rows[0].report_title || "")}</strong>
      (${esc(rows[0].source || "")}, import ${new Date(rows[0].imported_at).toLocaleString("cs-CZ")}) ·
      ${rows.length} poboček${needle ? `, zobrazeno ${items.length}` : ""}.
      Hvězdička = doporučení dopočítané v aplikaci (report ho u pobočky neuvádí).</p>
    <div class="table-wrap"><table class="visitor-table">
      <thead><tr><th>ID</th><th>Pobočka</th><th>Formát</th><th>Návštěv celkem</th><th>Návštěv/den</th>
        <th>Špička</th><th>Zasedací m.</th><th>Servisní místa</th><th>Přetížení MC</th></tr></thead>
      <tbody>${body || `<tr><td colspan="9" class="muted">Žádná pobočka neodpovídá filtru.</td></tr>`}</tbody>
    </table></div>`;
  el.querySelectorAll(".visitor-row").forEach((tr) => {
    tr.addEventListener("click", () => showVisitorDetail(tr.dataset.id));
  });
}

function showVisitorDetail(pobockaId) {
  const visitor = getVisitorData(pobockaId, null);
  if (!visitor) { toast("Data pobočky se nepodařilo načíst.", "err"); return; }
  const panel = document.getElementById("visitorDetailPanel");
  panel.style.display = "block";
  document.getElementById("visitorDetail").innerHTML = renderVisitorSectionHtml(visitor);
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ---------------------------------- PDF ----------------------------------- */

/* --------------- Nadpisy kapitol a sekcí v PDF (barevně) ------------------- */
// Kapitola = barevný pruh přes celou šířku s číslem a názvem, sekce = nadpis
// s barevným svislým praporkem v barvě kapitoly. Kolem obojího se drží pevné
// mezery, aby text nikde nelepil na tabulky ani na grafy.

const PDF_MARGIN_X = 14;
const PDF_PAGE_BOTTOM = 280;
const PDF_CONTENT_W = 182;

function drawPdfChapterTitle(pdf, startY, chapter, number, marginX = PDF_MARGIN_X) {
  let y = startY;
  const barH = 12;
  pdf.setFillColor(...hexToRgb(chapter.color));
  pdf.rect(marginX, y, PDF_CONTENT_W, barH, "F");
  pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(13);
  pdf.setTextColor(255, 255, 255);
  pdf.text(`${number}.  ${chapter.title}`, marginX + 4, y + 8.2);
  pdf.setTextColor(0, 0, 0);
  y += barH + 4;
  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(7.8);
  pdf.setTextColor(110, 118, 130);
  pdf.text(chapter.note, marginX, y);
  pdf.setTextColor(0, 0, 0);
  return y + 7;
}

// Nadpis sekce uvnitř kapitoly. `space` je mezera nad nadpisem (výchozí 6 mm),
// vrací y už pod nadpisem s odsazením pro obsah.
function drawPdfSectionTitle(pdf, startY, title, color, options = {}) {
  const marginX = options.marginX || PDF_MARGIN_X;
  const size = options.size || 11.5;
  const need = options.need || 24;
  let y = startY + (options.space === undefined ? 6 : options.space);
  if (y + need > (options.pageBottom || PDF_PAGE_BOTTOM)) { pdf.addPage(); y = 18; }
  pdf.setFillColor(...hexToRgb(color || "#2770f0"));
  pdf.rect(marginX, y - 4.2, 2.4, 5.6, "F");
  pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(size);
  pdf.setTextColor(28, 37, 48);
  pdf.text(title, marginX + 5, y);
  pdf.setTextColor(0, 0, 0);
  return y + 6.5;
}

// Menší podnadpis (uvnitř sekce) — bez praporku, jen tučně a s mezerou.
function drawPdfSubTitle(pdf, startY, title, options = {}) {
  const marginX = options.marginX || PDF_MARGIN_X;
  let y = startY + (options.space === undefined ? 4 : options.space);
  if (y + (options.need || 16) > (options.pageBottom || PDF_PAGE_BOTTOM)) { pdf.addPage(); y = 18; }
  pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(options.size || 9.6);
  pdf.text(title, marginX, y);
  return y + 5.4;
}

/* ------------------ Šedý boxík s detaily (hlavička PDF) -------------------- */
// Detaily pobočky a kalkulace vypadají líp oddělené od zbytku sestavy:
// světle šedý podklad, tmavší šedý text.
function drawPdfDetailBox(pdf, startY, lines, marginX, pageBottom, width = 182) {
  const inset = 6;        // odsazení boxíku od okraje stránky
  const padX = 7;         // vnitřní odsazení textu
  const boxX = marginX + inset;
  const boxW = width - inset * 2;
  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(9);
  const wrapped = [];
  lines.forEach((l) => pdf.splitTextToSize(l, boxW - padX * 2).forEach((w) => wrapped.push(w)));
  const lineH = 5;
  const boxH = wrapped.length * lineH + 8;
  let y = startY + 1;
  if (y + boxH > pageBottom) { pdf.addPage(); y = 18; }
  pdf.setFillColor(243, 245, 248);
  pdf.setDrawColor(223, 228, 235);
  pdf.setLineWidth(0.2);
  pdf.roundedRect(boxX, y, boxW, boxH, 2.2, 2.2, "FD");
  pdf.setTextColor(84, 94, 108);
  let ty = y + 7;
  wrapped.forEach((l) => { pdf.text(l, boxX + padX, ty); ty += lineH; });
  pdf.setTextColor(0, 0, 0);
  pdf.setDrawColor(0, 0, 0);
  return y + boxH + 1;
}

/* -------------------- Poznámka v záhlaví titulní stránky -------------------- */
// Poznámka od uživatele se tiskne hned na začátek první stránky sestavy, aby ji
// čtenář nemohl přehlédnout: žlutě podbarvený rámeček s vykřičníkem v kolečku.
function drawPdfHeaderNote(pdf, startY, note, marginX, width = PDF_CONTENT_W) {
  const text = String(note || "").trim();
  if (!text) return startY;
  const padX = 7;
  const badgeW = 10;             // místo pro kolečko s vykřičníkem
  const textX = marginX + padX + badgeW;
  const textW = width - padX * 2 - badgeW;
  pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(9.5);
  const wrapped = [];
  text.split(/\r?\n/).forEach((par) => {
    if (!par.trim()) { wrapped.push(""); return; }
    pdf.splitTextToSize(par, textW).forEach((w) => wrapped.push(w));
  });
  const lineH = 5;
  const boxH = Math.max(wrapped.length * lineH + 7, 14);
  const y = startY;

  pdf.setFillColor(255, 246, 199);        // světle žlutá
  pdf.setDrawColor(217, 119, 6);          // jantarový rámeček
  pdf.setLineWidth(0.5);
  pdf.roundedRect(marginX, y, width, boxH, 2.2, 2.2, "FD");

  // kolečko s vykřičníkem
  pdf.setFillColor(217, 119, 6);
  pdf.circle(marginX + padX + 1.6, y + 6.2, 3.2, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(10);
  pdf.text("!", marginX + padX + 0.6, y + 7.7);

  pdf.setTextColor(124, 45, 18);          // tmavě hnědočervený text
  pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(9.5);
  let ty = y + 6.6;
  wrapped.forEach((l) => { if (l) pdf.text(l, textX, ty); ty += lineH; });

  pdf.setFont("DejaVuSans", "normal");
  pdf.setTextColor(0, 0, 0);
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.2);
  return y + boxH + 5;
}

/* ---------------- Hlavička titulní stránky: profil pobočky ------------------ */
// Barevné „pilulky“ (rating a jeho trend) a pod nimi zařazení, adresa, výnosy
// a nejlepší obchody pobočky — vše z exportu poboček. Kreslí se na začátek
// první stránky sestavy, pod poznámku uživatele.

function hexRgb(hex) {
  const h = String(hex || "").replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Vykreslí jednu pilulku a vrátí její šířku (včetně mezery za ní).
function drawPdfPill(pdf, x, y, text, hex, height = 7) {
  pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(8.5);
  const w = pdf.getTextWidth(text) + 8;
  const [r, g, b] = hexRgb(hex);
  pdf.setFillColor(r, g, b);
  pdf.roundedRect(x, y, w, height, height / 2, height / 2, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.text(text, x + 4, y + height / 2 + 1.5);
  pdf.setTextColor(0, 0, 0);
  return w + 3;
}

function drawPdfBranchHeader(pdf, startY, profile, marginX, width = PDF_CONTENT_W) {
  if (!profile) return startY;
  const f = profile.fields;
  let y = startY;

  // 1) pilulky: rating (barva podle kvintilu ratingu), změna ratingu 25/24,
  // trend ratingu 23–25 a kvintil nových výnosů. Když se do řádku nevejdou,
  // pokračují na dalším.
  const change = changeLabel(f.rating.change, f.rating.changePerc);
  const trend = trendLabel(f.rating.trend);
  const pills = [
    { text: `Rating 25: ${f.rating.r25text || "—"}`, color: quintileColor(f.rating.kvintil) },
    branchNum(f.rating.kvintil) === null ? null
      : { text: `Rating kvintil ${fmtPieces(branchNum(f.rating.kvintil))}`, color: quintileColor(f.rating.kvintil) },
    change ? { text: `Změna ratingu 25/24: ${change.text}`, color: change.color } : null,
    { text: `Trend ratingu 23–25: ${f.rating.trend || "—"}`, color: trend.color },
    { text: `Nové výnosy kvintil: ${branchNum(f.newRevenueKvintil) === null
      ? "—" : fmtPieces(branchNum(f.newRevenueKvintil))}`, color: quintileColor(f.newRevenueKvintil) },
  ].filter(Boolean);
  let x = marginX;
  pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(8.5);
  pills.forEach((pill) => {
    const w = pdf.getTextWidth(pill.text) + 8;
    if (x > marginX && x + w > marginX + width) { x = marginX; y += 10; }
    x += drawPdfPill(pdf, x, y, pill.text, pill.color);
    pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(8.5);
  });
  y += 11;

  // 2) zařazení, adresa a výnosy
  const kv = (q) => (branchNum(q) === null ? "" : ` (kvintil ${fmtPieces(branchNum(q))})`);
  const lines = [
    ["Region / Oblast", [f.region || f.regionFixed || "—", f.oblast || "—"].join("  ·  ")],
    ["Adresa", f.address || "—"],
    ["Nové výnosy" + (f.newRevenueLast ? ` ${f.newRevenueLast.year}` : ""),
      (f.newRevenueLast ? fmtNum0(f.newRevenueLast.value) : "—") + kv(f.newRevenueKvintil)
      + (branchNum(f.newRevenueChange) !== null
        ? `  ·  změna 25/24: ${fmtNumAuto(f.newRevenueChange)}` : "")],
    ["Výnosy" + (f.revenueLast ? ` ${f.revenueLast.year}` : ""),
      (f.revenueLast ? fmtNum0(f.revenueLast.value) : "—")
      + (f.revenueTrend ? `  ·  trend 21–25: ${f.revenueTrend}` : "")],
  ];

  const top = topBranchSales(f);
  const salesText = top.length
    ? top.map((sp) => `${sp.label} ${fmtNum0(sp.count)} prodejů`
      + (sp.volume !== undefined && sp.volume !== null ? `, objem ${fmtNum0(sp.volume)}` : "")
      + kv(sp.kvintil)).join("  ·  ")
    : "export neobsahuje počty prodejů";
  lines.push([`Nejlepší obchody${branchNum(f.salesTotal) !== null
    ? ` (celkem ${fmtNum0(f.salesTotal)})` : ""}`, salesText]);

  const labelW = 34;
  const valueW = width - labelW - 8;
  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(8.5);
  const wrapped = lines.map(([label, value]) => ({
    label, rows: pdf.splitTextToSize(String(value), valueW),
  }));
  const lineH = 4.6;
  const boxH = wrapped.reduce((acc, w) => acc + w.rows.length * lineH, 0) + 6;

  pdf.setFillColor(240, 247, 250);
  pdf.setDrawColor(14, 116, 144);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(marginX, y, width, boxH, 2, 2, "FD");
  let ty = y + 5.4;
  wrapped.forEach((w) => {
    pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(8.5); pdf.setTextColor(14, 116, 144);
    pdf.text(w.label, marginX + 4, ty, { maxWidth: labelW - 2 });
    pdf.setFont("DejaVuSans", "normal"); pdf.setTextColor(40, 46, 56);
    w.rows.forEach((row, i) => { pdf.text(row, marginX + 4 + labelW, ty + i * lineH); });
    ty += w.rows.length * lineH;
  });
  pdf.setTextColor(0, 0, 0);
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.2);
  return y + boxH + 5;
}

/* --------------------- Tabulková pomůcka pro PDF --------------------------- */
// Vykreslí jednoduchou tabulku (hlavička + řádky s pevnými šířkami sloupců)
// a vrátí novou souřadnici y. Řádek může být pole hodnot, nebo objekt
// { vals, highlight } pro zvýrazněný řádek. setFillColor/setTextColor se volají
// znovu před každou buňkou — jsPDF si barvy drží ve společné cache, takže
// prokládané rect()/text() by je jinak po první buňce rozjelo.
// Vzhled odpovídá tabulkám v aplikaci: modrá hlavička s bílým textem, jemné
// šedé linky, střídavě podbarvené řádky a zvýrazněné mezisoučty.
const PDF_TABLE_STYLE = {
  header: { fill: [39, 112, 240], text: [255, 255, 255], bold: true },
  even: { fill: [252, 253, 255] },
  odd: { fill: [255, 255, 255] },
  highlight: { fill: [224, 236, 255], bold: true },
  subtotal: { fill: [238, 243, 251], bold: true },
  total: { fill: [234, 252, 239], bold: true },
  border: [214, 222, 232],
};

function drawPdfSimpleTable(pdf, { x, y, headers, colW, rows, fontSize = 7.4, rowH = 6, pageBottom = 280, align }) {
  let cy = y;
  const lineH = fontSize * 0.42;   // výška řádku textu v mm pro danou velikost písma
  const padY = 4.2;
  const alignments = align || [];

  // Text, který se do sloupce nevejde, se zalomí — výška řádku se tomu
  // přizpůsobí, aby text nepřetékal přes rámeček buňky.
  const wrap = (vals, bold) => {
    pdf.setFont("DejaVuSans", bold ? "bold" : "normal"); pdf.setFontSize(fontSize);
    const cells = vals.map((v, i) => pdf.splitTextToSize(String(v), colW[i] - 2.8));
    const maxLines = cells.reduce((a, c) => Math.max(a, c.length), 1);
    return { cells, height: Math.max(rowH, padY + (maxLines - 1) * lineH + 2) };
  };

  // cellFills = { indexSloupce: [r,g,b] } — přebije podbarvení řádku; používá
  // se pro buňky se segmentem, které dostanou barvu podle nastavení Segmenty.
  const drawCells = (vals, style, cellFills) => {
    const { cells, height } = wrap(vals, style.bold);
    const [br, bg, bb] = PDF_TABLE_STYLE.border;
    let cx = x;
    cells.forEach((lines, i) => {
      const fill = (cellFills && cellFills[i]) || style.fill;
      pdf.setFillColor(fill[0], fill[1], fill[2]);
      pdf.setDrawColor(br, bg, bb);
      pdf.setLineWidth(0.15);
      pdf.rect(cx, cy, colW[i], height, "FD");
      const [tr, tg, tb] = style.text || [28, 37, 48];
      pdf.setTextColor(tr, tg, tb);
      const right = alignments[i] === "right";
      lines.forEach((line, li) => {
        const ty = cy + padY + li * lineH;
        if (right) pdf.text(line, cx + colW[i] - 1.4, ty, { align: "right" });
        else pdf.text(line, cx + 1.4, ty);
      });
      cx += colW[i];
    });
    cy += height;
    pdf.setTextColor(0, 0, 0);
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.2);
  };

  const drawHeader = () => drawCells(headers, PDF_TABLE_STYLE.header);

  drawHeader();
  rows.forEach((r, idx) => {
    const vals = Array.isArray(r) ? r : r.vals;
    // variant: highlight / subtotal / total, jinak střídavé podbarvení
    const variant = Array.isArray(r) ? null : (r.variant || (r.highlight ? "highlight" : null));
    const style = variant ? PDF_TABLE_STYLE[variant] || PDF_TABLE_STYLE.highlight
      : (idx % 2 ? PDF_TABLE_STYLE.even : PDF_TABLE_STYLE.odd);
    const { height } = wrap(vals, style.bold);
    if (cy + height > pageBottom) { pdf.addPage(); cy = 18; drawHeader(); }
    drawCells(vals, style, Array.isArray(r) ? null : r.cellFills);
  });
  return cy;
}

// Otevírací doba pobočky z reportu a denní návštěvy na bankéře — do PDF se
// tiskne jen když si ji uživatel zapne v nastavení PDF.
function drawVisitorBankersPdf(pdf, startY, m, inputRows, marginX, pageBottom) {
  let y = startY;
  const newPageIfNeeded = (need) => { if (y + need > pageBottom) { pdf.addPage(); y = 18; } };
  const bankers = computeBankerFte(inputRows);
  const opening = m.opening;
  const perDay = m.visitsPerDay;
  const perBanker = (fte) => (fte > 0 && perDay !== null ? perDay / fte : null);
  const dash = (v) => (v === null ? "—" : vFmt1(v));

  newPageIfNeeded(30);
  pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(10);
  pdf.text("Otevírací doba a návštěvy na bankéře", marginX, y); y += 6;
  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(8.5);
  [
    `Otevírací doba dle reportu: ${opening.hoursPerWeek ? `${vFmt1(opening.hoursPerWeek)} h/týden` : "neuvedena"}`
      + `${opening.openDaysPerWeek ? `, ${opening.openDaysPerWeek} dnů v týdnu` : ""}`
      + `${opening.label ? `, ${opening.label}` : ""}`
      + `${opening.annualOpenDays ? `, ${vFmtInt(opening.annualOpenDays)} otevíracích dnů/rok` : ""}`,
    `Návštěvy: ${vFmtInt(m.d.total)} za ${vFmtInt(m.d.n_days)} dnů = ${dash(perDay)} návštěv na otevírací den`,
    `Bankéři z kalkulace: ${vFmt1(bankers.total)} FTE`
      + ` (schůzky ${vFmt1(bankers.sales)}, servis ${vFmt1(bankers.serviceTotal)}`
      + `${bankers.serviceAlso > 0 ? ` včetně ${vFmt1(bankers.serviceAlso)} OB junior` : ""}`
      + `${bankers.cashier > 0 ? `, pokladna ${vFmt1(bankers.cashier)}` : ""})`,
    `Denní návštěvy na bankéře: ${dash(perBanker(bankers.total))}`
      + `${bankers.sales > 0 ? ` · jen osobní bankéři: ${dash(perBanker(bankers.sales))}` : ""}`
      + `${Number(m.d.bankers) > 0 ? ` · dle stavu bankéřů v reportu (${vFmt1(m.d.bankers)} FTE): ${dash(perBanker(Number(m.d.bankers)))}` : ""}`,
  ].forEach((line) => {
    pdf.splitTextToSize(line, 182).forEach((l) => { newPageIfNeeded(6); pdf.text(l, marginX, y); y += 5; });
  });
  y += 2;

  if (m.weekdays.length) {
    newPageIfNeeded(20);
    y = drawPdfSimpleTable(pdf, {
      x: marginX, y,
      headers: ["Den", "Otevírací doba", "Dnů v datech", "Návštěv celkem", "Návštěv/den", "Na bankéře"],
      colW: [30, 32, 28, 32, 30, 30],
      rows: m.weekdays.map((r) => ({
        vals: [r.name, r.closed ? "zavřeno" : (r.hours || "—"), vFmtInt(r.days), vFmtInt(r.total),
          r.perDay === null ? "—" : vFmt1(r.perDay),
          r.perDay !== null && bankers.total > 0 ? vFmt1(r.perDay / bankers.total) : "—"],
        highlight: r.weekend && !r.closed,
      })),
      pageBottom,
    });
    y += 3;
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(7.5);
    pdf.setTextColor(120, 120, 120);
    pdf.splitTextToSize("Průměr na den se u každého dne počítá z počtu dnů, které jsou pro daný den v datech "
      + "reportu. Sloupec „Na bankéře“ dělí návštěvy na den počtem FTE bankéřů z kalkulace.", 182)
      .forEach((l) => { newPageIfNeeded(5); pdf.text(l, marginX, y); y += 4.2; });
    pdf.setTextColor(0, 0, 0);
    y += 5;
  }

  return y;
}

/* ------------------- Grafy Monte Carla do PDF ------------------------------ */
// jsPDF neumí grafy — obě vizualizace se skládají z čar a obdélníků. Vychází
// ze stejných dat i stejného vzhledu jako SVG grafy v HTML reportu (osy,
// přerušované čáry kapacity, popisky).

function pdfSetDash(pdf, pattern) {
  if (typeof pdf.setLineDashPattern === "function") pdf.setLineDashPattern(pattern, 0);
}

function pdfStroke(pdf, hex, width) {
  const [r, g, b] = hexToRgb(hex);
  pdf.setDrawColor(r, g, b);
  pdf.setLineWidth(width);
}

function pdfFill(pdf, hex) {
  const [r, g, b] = hexToRgb(hex);
  pdf.setFillColor(r, g, b);
}

function pdfTextColor(pdf, hex) {
  const [r, g, b] = hexToRgb(hex);
  pdf.setTextColor(r, g, b);
}

// Krok osy Y podle rozsahu — stejná logika jako v reportu.
function chartTickStep(maxY) {
  if (maxY <= 1.5) return 0.25;
  if (maxY <= 3) return 0.5;
  if (maxY <= 6) return 1;
  if (maxY <= 12) return 2;
  return 5;
}

// Graf „P95 FTE poptávka po hodinách (6h–21h)“: poptávka OB (a servisní zóny)
// po hodinách proti kapacitě vykreslené přerušovanou čárou.
function drawMcFteLineChartPdf(pdf, x, y, w, h, mc, hasSvc) {
  const pl = 11;
  const pr = 17;
  const pt = 3;
  const pb = 7;
  const pw = w - pl - pr;
  const ph = h - pt - pb;
  const rows = mc.rows;
  const n = rows.length;
  const capOb = mc.obCapFte || 0;
  const capSvc = mc.svcCapFte || 0;
  const maxY = Math.max(
    ...rows.map((r) => r.p95ObFte),
    ...(hasSvc ? rows.map((r) => r.p95SvcFte) : [0]),
    capOb, hasSvc ? capSvc : 0,
  ) * 1.15 || 1;
  const xs = (i) => x + pl + (n > 1 ? (i / (n - 1)) * pw : 0);
  const ys = (v) => y + pt + ph * (1 - Math.min(v, maxY) / maxY);

  pdfFill(pdf, "#f8faff");
  pdf.rect(x + pl, y + pt, pw, ph, "F");

  // Mřížka + popisky osy Y
  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(5.5);
  const step = chartTickStep(maxY);
  for (let v = 0; v <= maxY * 1.02; v += step) {
    const yy = ys(v);
    pdfStroke(pdf, "#e2e8f0", 0.15);
    pdf.line(x + pl, yy, x + pl + pw, yy);
    pdfTextColor(pdf, "#94a3b8");
    pdf.text(String(Math.round(v * 100) / 100), x + pl - 1, yy + 0.7, { align: "right" });
  }

  // Popisky osy X po dvou hodinách
  rows.forEach((r, i) => {
    if (i % 2 !== 0) return;
    pdfTextColor(pdf, "#94a3b8");
    pdf.text(`${r.hour}h`, xs(i), y + h - 2.4, { align: "center" });
  });

  // Kapacita — přerušovaná čára s popiskem vpravo
  const capLine = (value, hex, label) => {
    const yy = ys(value);
    pdfStroke(pdf, hex, 0.4);
    pdfSetDash(pdf, [1.4, 1]);
    pdf.line(x + pl, yy, x + pl + pw, yy);
    pdfSetDash(pdf, []);
    pdfTextColor(pdf, hex);
    pdf.text(`${label} ${vFmt1(value)}`, x + pl + pw + 1, yy + 0.7);
  };
  capLine(capOb, "#2563eb", "OB");
  if (hasSvc) capLine(capSvc, "#d97706", "SVC");

  // Křivky poptávky
  const polyline = (values, hex, width) => {
    pdfStroke(pdf, hex, width);
    for (let i = 1; i < values.length; i++) {
      pdf.line(xs(i - 1), ys(values[i - 1]), xs(i), ys(values[i]));
    }
  };
  if (hasSvc) polyline(rows.map((r) => r.p95SvcFte), "#d97706", 0.4);
  polyline(rows.map((r) => r.p95ObFte), "#2563eb", 0.6);

  // Osy
  pdfStroke(pdf, "#94a3b8", 0.2);
  pdf.line(x + pl, y + pt, x + pl, y + pt + ph);
  pdf.line(x + pl, y + pt + ph, x + pl + pw, y + pt + ph);

  pdf.setTextColor(0, 0, 0);
  pdf.setLineWidth(0.2);
  pdf.setDrawColor(0, 0, 0);
  return y + h;
}

// Histogram „Distribuce celkové denní FTE poptávky“: četnosti simulovaných dnů,
// šedá přerušovaná čára = kapacita, zelená = P95 poptávky.
function drawMcHistPdf(pdf, x, y, w, h, counts, edges, capV, p95V, hex) {
  if (!counts || !counts.length || !edges || edges.length < 2) return y;
  const pl = 9;
  const pr = 3;
  const pt = 3;
  const pb = 6;
  const pw = w - pl - pr;
  const ph = h - pt - pb;
  const maxX = edges[edges.length - 1] || 1;
  const maxC = Math.max(...counts, 1);
  const xs = (v) => x + pl + (Math.min(v, maxX) / maxX) * pw;
  const ys = (v) => y + pt + ph * (1 - v / maxC);

  pdfFill(pdf, "#f8faff");
  pdf.rect(x + pl, y + pt, pw, ph, "F");

  pdfFill(pdf, hex);
  counts.forEach((c, i) => {
    if (!c) return;
    const x1 = xs(edges[i]);
    const barW = Math.max(xs(edges[i + 1]) - x1 - 0.15, 0.2);
    const barY = ys(c);
    pdf.rect(x1, barY, barW, y + pt + ph - barY, "F");
  });

  const vline = (value, colorHex) => {
    if (value === null || value === undefined || value <= 0) return;
    const xx = xs(value);
    pdfStroke(pdf, colorHex, 0.4);
    pdfSetDash(pdf, [1.2, 0.9]);
    pdf.line(xx, y + pt, xx, y + pt + ph);
    pdfSetDash(pdf, []);
  };
  vline(capV, "#475569");
  vline(p95V, "#16a34a");

  // Popisky osy X (5 hodnot) + osy
  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(5.5);
  pdfTextColor(pdf, "#94a3b8");
  [0, 0.25, 0.5, 0.75, 1].forEach((t) => {
    const v = t * maxX;
    pdf.text(vFmt1(v), xs(v), y + h - 1.8, { align: "center" });
  });
  pdfStroke(pdf, "#94a3b8", 0.2);
  pdf.line(x + pl, y + pt, x + pl, y + pt + ph);
  pdf.line(x + pl, y + pt + ph, x + pl + pw, y + pt + ph);

  pdf.setTextColor(0, 0, 0);
  pdf.setLineWidth(0.2);
  pdf.setDrawColor(0, 0, 0);
  return y + h;
}

// Tři kontroly míst pro schůzky do PDF — každá jako samostatný boxík
// s barevným pruhem vlevo, aby šly od sebe na první pohled odlišit.
function drawMeetingChecksPdf(pdf, startY, mc, marginX, pageBottom, color) {
  let y = startY;
  const width = 182;
  const statusFill = { ok: [240, 251, 244], tight: [255, 250, 240], missing: [253, 243, 243], none: [246, 248, 251] };
  const statusBar = { ok: [11, 180, 63], tight: [224, 161, 18], missing: [208, 54, 54], none: [107, 118, 132] };
  const statusWord = { ok: "Stačí", tight: "Těsné", missing: "Nestačí", none: "—" };

  y = drawPdfSectionTitle(pdf, y, "Tři kontroly míst pro schůzky (meeting zone)", color,
    { need: 46, marginX, pageBottom });
  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(7.5);
  pdf.setTextColor(120, 120, 120);
  pdf.splitTextToSize(`Schůzka = ${MEETING_CHECK_MODEL.MEETING_MINS} min + ${MEETING_CHECK_MODEL.PREP_MINS} min `
    + `příprava (${mc.slotMins} min na místo) · otevírací doba ${mc.openSource} = ${Math.round(mc.openMinutes)} `
    + `minut denně · k dispozici ${mc.availableLabel}`, width)
    .forEach((l) => { pdf.text(l, marginX, y); y += 4; });
  pdf.setTextColor(0, 0, 0);
  y += 2;

  mc.checks.forEach((c) => {
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(8);
    const assumeLines = pdf.splitTextToSize(c.assumption, width - 12);
    const formulaLines = pdf.splitTextToSize(`Výpočet: ${c.formula}`, width - 12);
    const extraLines = c.extra ? pdf.splitTextToSize(c.extra, width - 12) : [];
    const boxH = 11 + (assumeLines.length + formulaLines.length + extraLines.length) * 4.2 + 6;
    if (y + boxH > pageBottom) { pdf.addPage(); y = 18; }

    const fill = statusFill[c.status] || statusFill.none;
    const bar = statusBar[c.status] || statusBar.none;
    pdf.setFillColor(fill[0], fill[1], fill[2]);
    pdf.setDrawColor(223, 228, 235);
    pdf.setLineWidth(0.2);
    pdf.roundedRect(marginX, y, width, boxH, 1.6, 1.6, "FD");
    pdf.setFillColor(bar[0], bar[1], bar[2]);
    pdf.rect(marginX, y, 2.2, boxH, "F");

    let ty = y + 5.6;
    pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(9);
    pdf.setTextColor(bar[0], bar[1], bar[2]);
    pdf.text(`Kontrola ${c.index}`, marginX + 6, ty);
    pdf.setTextColor(28, 37, 48);
    pdf.text(c.title, marginX + 28, ty);
    ty += 5;

    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(8);
    pdf.setTextColor(70, 80, 94);
    assumeLines.forEach((l) => { pdf.text(l, marginX + 6, ty); ty += 4.2; });
    formulaLines.forEach((l) => { pdf.text(l, marginX + 6, ty); ty += 4.2; });
    extraLines.forEach((l) => { pdf.text(l, marginX + 6, ty); ty += 4.2; });

    pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(8.5);
    pdf.setTextColor(bar[0], bar[1], bar[2]);
    const verdict = `Potřeba ${c.needRounded} míst · k dispozici ${fmtPieces(c.available)} · `
      + `${statusWord[c.status]}${c.missing > 0 ? ` (chybí ${fmtPieces(c.missing)})` : ""}`;
    pdf.text(verdict, marginX + 6, ty + 0.8);
    pdf.setTextColor(0, 0, 0);
    pdf.setDrawColor(0, 0, 0);
    y += boxH + 3;
  });

  return y + 3;
}

// Kapacitní shrnutí do PDF: verdikt, slovní vysvětlení
// špičky a tabulka potřeba vs. layout. Layout se dohledá v databázi podle
// calculation_key, takže shrnutí funguje i v samostatném PDF kalkulace.
function drawCapacityCheckPdf(pdf, startY, result, stats, marginX, pageBottom, opts) {
  const { summary = true, meetingChecks = true, color = "#0e9f6e" } = opts || {};
  let y = startY;
  if (!db || !result.calculation_key) return y;
  let layoutRows = [];
  try { layoutRows = getExistingLayout(result.calculation_key); } catch (e) { layoutRows = []; }
  const visitor = getVisitorForCalculation(result.calculation_key, result.pobocka_id, result.pobocka_nazev);
  const check = computeCapacityCheck({ stats, visitor, calcResult: result, layoutRows });
  const newPageIfNeeded = (need) => { if (y + need > pageBottom) { pdf.addPage(); y = 18; } };

  if (!summary) {
    // Jen tři kontroly míst pro schůzky — kapacitní shrnutí je odškrtnuté.
    if (check.meetingChecks && meetingChecks) {
      y = drawMeetingChecksPdf(pdf, y, check.meetingChecks, marginX, pageBottom, color);
    }
    return y;
  }

  y = drawPdfSectionTitle(pdf, y, "Kapacitní shrnutí — stačí to na špičku?", color,
    { need: 50, marginX, pageBottom });

  // Verdikt v barevném pruhu
  const verdictColor = { ok: [232, 249, 238], tight: [255, 246, 224], missing: [253, 234, 234], none: [238, 242, 249] };
  const verdictText = { ok: [10, 122, 51], tight: [138, 92, 0], missing: [164, 31, 31], none: [107, 118, 132] };
  const vc = verdictColor[check.verdict.status] || verdictColor.none;
  const vt = verdictText[check.verdict.status] || verdictText.none;
  const verdictLines = pdf.splitTextToSize(check.verdict.text, 176);
  const boxH = 6 + verdictLines.length * 5;
  newPageIfNeeded(boxH + 6);
  pdf.setFillColor(vc[0], vc[1], vc[2]);
  pdf.rect(marginX, y, 182, boxH, "F");
  pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(10);
  pdf.setTextColor(vt[0], vt[1], vt[2]);
  let vy = y + 5.5;
  verdictLines.forEach((l) => { pdf.text(l, marginX + 3, vy); vy += 5; });
  pdf.setTextColor(0, 0, 0);
  y += boxH + 5;

  // Graf kapacity proti špičce
  y = drawCapacityChartPdf(pdf, y, check, marginX, pageBottom);

  // Slovní vysvětlení špičky
  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(9);
  capacityIntroLines(check).forEach((line) => {
    pdf.splitTextToSize(line, 182).forEach((l) => { newPageIfNeeded(6); pdf.text(l, marginX, y); y += 5; });
    y += 1.5;
  });
  y += 2;

  // Tabulka potřeba vs. layout
  newPageIfNeeded(24);
  y = drawPdfSimpleTable(pdf, {
    x: marginX, y,
    headers: ["Co", "Potřeba ve špičce", "V layoutu", "Jak to vypadá"],
    colW: [58, 26, 34, 64],
    rows: check.items.map((it) => ({
      vals: [it.label, fmtPieces(it.need),
        it.haveNote ? `${fmtPieces(it.have)} (${it.haveNote})` : fmtPieces(it.have),
        `${CAPACITY_STATUS_META[it.status].label} — ${capacityRowVerdict(it)}`],
      highlight: it.status !== "ok",
    })),
    fontSize: 7.4, rowH: 6.4, pageBottom,
  });
  y += 3;
  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(7.5);
  pdf.setTextColor(120, 120, 120);
  pdf.splitTextToSize("Potřeba = vyšší z obou pohledů: kolik vychází z počtu FTE v kalkulaci a kolik "
    + "ze skutečné návštěvnosti ve špičce.", 182)
    .forEach((l) => { newPageIfNeeded(5); pdf.text(l, marginX, y); y += 4.2; });
  pdf.setTextColor(0, 0, 0);
  y += 4;

  if (check.people.length) {
    y = drawPdfSubTitle(pdf, y, "A vyjdou na to lidé?", { marginX, pageBottom, need: 26, size: 10 });
    y = drawPdfSimpleTable(pdf, {
      x: marginX, y,
      headers: ["Kdo", "Potřeba ve špičce", "Reálně na place", "Jak to vypadá"],
      colW: [64, 30, 30, 58],
      rows: check.people.map((p) => ({
        vals: [p.label, `${vFmt1(p.need)} lidí`, `${vFmt1(p.have)} z ${vFmt1(p.fte)} FTE`,
          p.status === "ok" ? "Stačí." : `Chybí ${vFmt1(p.missing)} — ve špičce se tvoří fronta.`],
        highlight: p.status !== "ok",
      })),
      fontSize: 7.4, rowH: 6.4, pageBottom,
    });
    y += 3;
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(7.5);
    pdf.setTextColor(120, 120, 120);
    pdf.text(`„Reálně na place“ = zadané FTE mínus dovolené, nemoci a homeoffice.`, marginX, y);
    pdf.setTextColor(0, 0, 0);
    y += 6;
  }

  // Tři kontroly míst pro schůzky — každá ve vlastním boxíku s barevným pruhem.
  if (check.meetingChecks && meetingChecks) {
    y = drawMeetingChecksPdf(pdf, y, check.meetingChecks, marginX, pageBottom, color);
  }

  const todo = [
    ...check.items.filter((i) => i.status !== "ok").map((i) =>
      `- ${i.label}: doplnit ${fmtPieces(i.missing)} (v layoutu ${fmtPieces(i.have)}, potřeba ${fmtPieces(i.need)}).`),
    ...check.people.filter((p) => p.status !== "ok").map((p) =>
      `- ${p.label}: ve špičce chybí ${vFmt1(p.missing)} člověka — posílit směnu, nebo počítat s čekáním klientů.`),
  ];
  if (todo.length) {
    y = drawPdfSubTitle(pdf, y, "Co s tím", { marginX, pageBottom, need: 12 + todo.length * 5, size: 10 });
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(9);
    todo.forEach((line) => {
      pdf.splitTextToSize(line, 178).forEach((l) => { newPageIfNeeded(6); pdf.text(l, marginX + 2, y); y += 5; });
    });
  } else if (check.hasLayout) {
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(9);
    pdf.text("Není co doplňovat — layout pokrývá špičku i s rezervou na silný den.", marginX, y); y += 5;
  }
  y += 6;
  return y;
}

// Vykreslí sekci návštěvnosti a doporučení prostor do PDF (do už existujícího
// dokumentu od zadané souřadnice y) a vrátí novou souřadnici y.
function drawVisitorPdf(pdf, startY, visitor, marginX, pageBottom, stats, opts) {
  const { recommendations = true, bankers = false, mcHours = true, mcDist = true,
    inputRows = null, color = "#0e9f6e" } = opts || {};
  if (!recommendations && !bankers && !mcHours && !mcDist) return startY;
  const m = computeVisitorMetrics(visitor);
  const d = m.d;
  const rooms = m.rooms;
  let y = startY;

  const newPageIfNeeded = (need) => { if (y + need > pageBottom) { pdf.addPage(); y = 18; } };

  const drawTable = (headers, colW, dataRows, fontSize = 7.4) => {
    y = drawPdfSimpleTable(pdf, { x: marginX, y, headers, colW, rows: dataRows, fontSize, pageBottom });
  };

  y = drawPdfSectionTitle(pdf, y, "Návštěvnost a doporučení prostor", color,
    { need: 60, marginX, pageBottom });

  y = drawPdfDetailBox(pdf, y, [
    `Zdroj: ${visitor.report_title || "report návštěvnosti"}${visitor.source ? ` (${visitor.source})` : ""}` +
      `${visitor.imported_at ? `, import ${new Date(visitor.imported_at).toLocaleString("cs-CZ")}` : ""}`,
    `Pobočka: ${visitor.nazev || ""} (ID ${visitor.pobocka_id})` +
      `${d.branch_format ? `, formát dle reportu: ${d.branch_format}` : ""}`,
    `Návštěvy: ${vFmtInt(d.total)} za ${vFmtInt(d.n_days)} dnů` +
      `${m.visitsPerDay !== null ? ` (${vFmt1(m.visitsPerDay)} / den)` : ""}` +
      `${d.bankers !== undefined ? `, ${vFmt1(d.bankers)} bankéřů OB` : ""}` +
      `${d.has_svc ? `, servisní zóna ${vFmt1(d.svc_fte)} FTE` : ", bez servisní zóny"}`,
  ], marginX, pageBottom);
  y += 4;

  if (recommendations) {
  const rv = m.roomVariants;
  y = drawPdfSubTitle(pdf, y,
    `Doporučení prostor: ${rooms.meeting_rooms} zasedacích místností, ${rooms.service_desks} servisních míst`
    + ` (${rv.primary.short || rv.primary.label})`, { marginX, pageBottom, need: 30, size: 10 });

  const mtgMins = m.consts.MEETING_MINS ?? VISITOR_CONSTS_DEFAULT.MEETING_MINS;
  const walkMins = m.consts.WALKIN_AVG_MINS ?? VISITOR_CONSTS_DEFAULT.WALKIN_AVG_MINS;
  drawTable(
    ["Varianta", "Zasedací místnosti", "Servisní místa", "Z čeho vychází"],
    [40, 42, 42, 58],
    rv.variants.map((v) => {
      const cell = (places, load, unit) => (load
        ? `${places}\nvyužití ${Math.round(load.utilPct)} % · dnes ${vFmt1(load.nowDay)} ${unit}/den`
          + `${load.assumedDay !== load.nowDay ? ` (model ${vFmt1(load.assumedDay)})` : ""}`
          + `\nna 90 %: ${vFmt1(load.for90)}/den`
        : String(places));
      return {
        vals: [v.label, cell(v.meetingRooms, v.meetingLoad, "schůzek"),
          cell(v.serviceDesks, v.walkinLoad, "klientů"), v.detail],
        variant: v.key === rv.primary.key ? "highlight" : null,
      };
    }),
  );
  y += 3;
  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(7.5);
  pdf.setTextColor(120, 120, 120);
  pdf.splitTextToSize(`Schůzka se obsluhuje ${mtgMins} min, klient bez objednání ${walkMins} min. `
    + "λ = průměrné příchody v nejfrekventovanější hodině, P95 = λ + 1.645·√λ (silný den, zhruba 1 den z 20). "
    + "„Na 90 %“ = kolik návštěv denně by muselo přijít, aby byl doporučený počet míst ve špičce obsazený z 90 %. "
    + (rv.hasMc
      ? "Ve zbytku sestavy se pracuje s variantou Monte Carlo a) — zvýrazněný řádek."
      : "Report u této pobočky Monte Carlo neuvádí — ve zbytku sestavy se pracuje s variantou podle reálných dat."),
    182)
    .forEach((l) => { newPageIfNeeded(5); pdf.text(l, marginX, y); y += 4.2; });
  pdf.setTextColor(0, 0, 0);
  y += 5;

  // Srovnání s potřebou WPL z kalkulace — dvě nezávislé cesty ke stejné otázce.
  if (stats) {
    y = drawPdfSubTitle(pdf, y, "Srovnání s kalkulací", { marginX, pageBottom, need: 30, size: 10 });
    drawTable(
      ["Prostor", "Kalkulace (WPL z FTE)", "Doporučení z návštěvnosti", "Rozdíl"],
      [80, 40, 42, 20],
      [
        ["Místa pro jednání s klientem (meeting zone)", vFmt1(stats.meetingZoneWpl), String(rooms.meeting_rooms),
          `${rooms.meeting_rooms - stats.meetingZoneWpl >= 0 ? "+" : ""}${vFmt1(rooms.meeting_rooms - stats.meetingZoneWpl)}`],
        ["Servisní místa (service zone)", vFmt1(stats.serviceZoneWpl), String(rooms.service_desks),
          `${rooms.service_desks - stats.serviceZoneWpl >= 0 ? "+" : ""}${vFmt1(rooms.service_desks - stats.serviceZoneWpl)}`],
      ],
    );
    y += 3;
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(7.5);
    pdf.setTextColor(120, 120, 120);
    pdf.splitTextToSize("Kladný rozdíl znamená, že reálná návštěvnost ve špičce potřebuje víc míst, než vychází "
      + "z kalkulace FTE → WPL. Doporučení prostor kalkulaci nepřepisuje — je to druhý pohled při sestavování layoutu.", 182)
      .forEach((l) => { newPageIfNeeded(5); pdf.text(l, marginX, y); y += 4.2; });
    pdf.setTextColor(0, 0, 0);
    y += 5;
  }
  } // konec doporučení prostor a srovnání s kalkulací

  // Otevírací doba a denní návštěvy na bankéře (volitelné).
  if (bankers) y = drawVisitorBankersPdf(pdf, y, m, inputRows, marginX, pageBottom);

  // Detail návštěv po hodinách je záměrně jen v aplikaci — do PDF jde jen
  // doporučení prostor, srovnání s kalkulací a Monte Carlo v podobě grafů.

  if ((mcHours || mcDist) && m.mc) {
    const mc = m.mc;
    const hasSvc = !!(m.d.has_svc && mc.svcFte);
    if (mcHours) {
    y = drawPdfSectionTitle(pdf, y, `Monte Carlo model průměrného dne (${vFmtInt(mc.nIter)} simulací)`, color,
      { need: 60, marginX, pageBottom, size: 10.5 });
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(8.5);
    [
      `Pravděpodobné hodiny přetížení: ${vFmt1(mc.overloadHours)} h / den` +
        (m.mcBoost ? ` (varianta +20 %: ${vFmt1(m.mcBoost.overloadHours)} h / den)` : ""),
      `Pokrytí poptávky: ${mc.coveragePct === null || mc.coveragePct === undefined ? "—" : `${vFmt1(mc.coveragePct)} %`}` +
        `, bankéřů OB pro 95% pokrytí: ${mc.bankersFor95 === null || mc.bankersFor95 === undefined ? "> +3" : vFmt1(mc.bankersFor95)}` +
        `, dnes ${vFmt1(mc.currentBankers)}`,
      `Špičková P95 poptávka OB: ${vFmt1(mc.peakP95Ob)} FTE/hod · kapacita ${vFmt1(mc.obCapFte)} FTE/hod` +
        ` (${vFmt1(mc.presencePct)} % efektivní přítomnost)`,
      `Denní poptávka OB: P95 ${vFmt1(mc.obP95Day)} h/den proti kapacitě ${vFmt1(mc.obCapDay)} h/den` +
        (hasSvc ? ` · servisní zóna P95 ${vFmt1(mc.svcP95Day)} h/den proti ${vFmt1(mc.svcCapDay)} h/den` : ""),
    ].forEach((line) => {
      pdf.splitTextToSize(line, 182).forEach((l) => { newPageIfNeeded(6); pdf.text(l, marginX, y); y += 5; });
    });
    y += 3;

    // Graf 1 — P95 FTE poptávka po hodinách
    const lineChartH = 46;
    y = drawPdfSubTitle(pdf, y, "P95 FTE poptávka po hodinách (6h–21h)",
      { marginX, pageBottom, need: lineChartH + 16, size: 9.2, space: 2 });
    y -= 1;
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(7);
    pdf.setTextColor(120, 120, 120);
    pdf.text(`OB (modrá)${hasSvc ? " · servis BKP (oranžová)" : ""} · kapacita = přerušovaná čára `
      + `(FTE = bankéř × ${vFmt1(mc.presencePct)} % přítomnost)`, marginX, y); y += 3.5;
    pdf.setTextColor(0, 0, 0);
    y = drawMcFteLineChartPdf(pdf, marginX, y, 182, lineChartH, mc, hasSvc);
    y += 6;
    } // konec hodinové poptávky

    if (mcDist) {
    // Graf 2 — distribuce celkové denní FTE poptávky
    const histH = 36;
    y = drawPdfSectionTitle(pdf, y, "Distribuce celkové denní FTE poptávky (bankéř-hodiny/den)", color,
      { need: histH + 22, marginX, pageBottom, size: 10.5 });
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(7);
    pdf.setTextColor(120, 120, 120);
    pdf.text("Frekvence simulovaných dnů · šedá přerušovaná = kapacita · zelená = P95 poptávky", marginX, y);
    y += 4;
    pdf.setTextColor(0, 0, 0);

    const histW = hasSvc ? 89 : 182;
    pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(7);
    pdfTextColor(pdf, "#2563eb");
    pdf.text(`OB tým (schůzky) — kapacita ${vFmt1(mc.obCapDay)} h · P95 ${vFmt1(mc.obP95Day)} h`,
      marginX, y, { maxWidth: histW });
    if (hasSvc) {
      pdfTextColor(pdf, "#d97706");
      pdf.text(`Servisní zóna (BKP) — kapacita ${vFmt1(mc.svcCapDay)} h · P95 ${vFmt1(mc.svcP95Day)} h`,
        marginX + 93, y, { maxWidth: histW });
    }
    pdf.setTextColor(0, 0, 0);
    y += 2.5;
    const histTop = y;
    y = drawMcHistPdf(pdf, marginX, histTop, histW, histH, mc.obHist, mc.obEdges, mc.obCapDay, mc.obP95Day, "#2563eb");
    if (hasSvc) {
      drawMcHistPdf(pdf, marginX + 93, histTop, histW, histH, mc.svcHist, mc.svcEdges,
        mc.svcCapDay, mc.svcP95Day, "#d97706");
    }
    y += 6;
    } // konec distribuce denní poptávky
  }

  return y;
}

/* --------------------------- Sestavení layoutu ----------------------------- */

const ZONE_LABELS = {
  service_zone: "Service zone",
  meeting_zone: "Meeting zone",
  backoffice_zone: "Backoffice zone",
  office_room: "Office room",
};

const ZONE_LABELS_SHORT = {
  service_zone: "ServiceZ",
  meeting_zone: "MeetingZ",
  backoffice_zone: "BackofficeZ",
  office_room: "OfficeRoom",
};

/* --------------------- Kompletní přehled WPL (matice) ---------------------- */
// Sestaví kompletní přehled WPL po segmentech a zónách: potřebu z kalkulace,
// počet FTE, poměr WPL/FTE (celkem i za každý segment zvlášť) a — pokud už je
// layout sestavený — také skutečně přiřazené WPL. Používá se pro zobrazení
// v aplikaci i pro PDF export layoutu, aby obojí vycházelo ze stejných čísel.
//
// `celkemRow` (řádek „Celkem“ z kalkulace) je nepovinný, ale měl by se předávat:
// hodnoty v něm vznikly zaokrouhlením nezaokrouhlených součtů, takže se mohou
// o desetinu lišit od součtu už zaokrouhlených hodnot jednotlivých segmentů
// (např. segmenty 2.3 + 0.0, ale Celkem 2.4). Řádek „Celkem“ je autoritativní —
// je to totéž číslo, které ukazuje tabulka výsledku kalkulace i klíčové
// ukazatele, takže přehled musí vycházet z něj, aby si čísla na jedné obrazovce
// neodporovala. Bez něj se použije součet segmentů jako nejlepší přiblížení.
function computeWplOverview(segmentRows, layoutRows, celkemRow) {
  const assignedBySegZone = {};
  const piecesBySegZone = {};
  (layoutRows || []).forEach((r) => {
    const key = `${r.segment}||${r.zone}`;
    assignedBySegZone[key] = (assignedBySegZone[key] || 0) + (r.wpl_assigned || 0);
    piecesBySegZone[key] = (piecesBySegZone[key] || 0) + (r.piece_count || 0);
  });

  const rows = (segmentRows || []).map((seg) => {
    const zones = {}, assignedZones = {}, pieces = {};
    let wplTotal = 0, assignedTotal = 0, piecesTotal = 0;
    ZONES.forEach((z) => {
      const key = `${seg.segment}||${z}`;
      zones[z] = seg[z] || 0;
      assignedZones[z] = assignedBySegZone[key] || 0;
      pieces[z] = piecesBySegZone[key] || 0;
      wplTotal += zones[z];
      assignedTotal += assignedZones[z];
      piecesTotal += pieces[z];
    });
    const fte = seg.total_positions || 0;
    return {
      segment: seg.segment, fte, zones, assignedZones, pieces,
      wplTotal, assignedTotal, piecesTotal,
      wplPerFtePct: fte > 0 ? (wplTotal / fte) * 100 : null,
    };
  });

  const total = {
    segment: "Celkem", fte: 0, zones: {}, assignedZones: {}, pieces: {},
    wplTotal: 0, assignedTotal: 0, piecesTotal: 0,
  };
  ZONES.forEach((z) => { total.zones[z] = 0; total.assignedZones[z] = 0; total.pieces[z] = 0; });
  rows.forEach((r) => {
    total.fte += r.fte;
    total.wplTotal += r.wplTotal;
    total.assignedTotal += r.assignedTotal;
    total.piecesTotal += r.piecesTotal;
    ZONES.forEach((z) => {
      total.zones[z] += r.zones[z];
      total.assignedZones[z] += r.assignedZones[z];
      total.pieces[z] += r.pieces[z];
    });
  });
  // Potřeba WPL i FTE se v součtovém řádku přebírá z autoritativního řádku
  // „Celkem“ kalkulace (viz komentář u hlavičky funkce). Přiřazené WPL a počty
  // kusů zůstávají součtem z layoutu — ty žádným zaokrouhlením neprošly.
  if (celkemRow) {
    total.fte = celkemRow.total_positions || 0;
    total.wplTotal = 0;
    ZONES.forEach((z) => { total.zones[z] = celkemRow[z] || 0; total.wplTotal += total.zones[z]; });
  }
  total.wplPerFtePct = total.fte > 0 ? (total.wplTotal / total.fte) * 100 : null;

  return { rows, total, hasLayout: (layoutRows || []).length > 0 };
}

/* ------------------- Pravidla pro předvyplnění layoutu --------------------- */
// Deklarativní definice pravidel, podle kterých se v sestavení layoutu
// automaticky předvyplní (a barevně zvýrazní) počty kusů. Ze stejné definice se
// generuje i nápověda pod ikonou „?“ u nadpisu „Sestavení layoutu“, takže popis
// pravidel se nemůže rozejít se skutečným chováním aplikace.
//
// - `zone`      … zóna, ve které pravidlo platí
// - `furniture` … přesný název nábytkového prvku (pravidlo se použije jen
//                 u segmentů, které tento prvek v dané zóně skutečně mají)
// - `formats`   … pro které formáty pobočky pravidlo platí; null = pro všechny
// - `qty`       … funkce ({ required, stats }) -> doporučený počet kusů
//                 (`required` je potřeba WPL dané skupiny segment+zóna)
// Čekací zóna a obývák: konstanty a waitingZoneSplit() jsou u ostatních
// společných pomůcek nahoře (potřebuje je i kapacitní shrnutí).

// Pokladní pracoviště, které se doporučí, když je na pobočce pokladník
// (pozice „bankéř klientské péče - junior“ — viz ROLE_POSITIONS.cashier).
const CASHIER_FURNITURE = "Pokladní ostrov typu C (1:1,TT+TT,1WPL)";

// Kolik WPL v backoffice zóně segmentu připadá na pozice, které mají nastavený
// podíl fast tracku — tato část potřeby se přesune z „Kancelářské místo“ na
// „Fast track backoffice“. Podíl je nastavení u pozice (sloupec
// `casove_dotace.fasttrack_share` v %), ne pevná hodnota v kódu.
// Počítá se ze stejných vstupů jako kalkulace: FTE × doba vytížení ×
// (1 − nepřítomnost − homeoffice) × dotace backoffice % ÷ otevírací doba.
function backofficeFastTrackShift(segment, calcResult) {
  if (!calcResult || !(calcResult.inputRows || []).length || !calcResult.oteviraci_doba) return 0;
  const splits = dotaceSplitMap(calcResult.refVersionId);
  const shares = fasttrackShareMap(calcResult.refVersionId);
  const openHours = calcResult.oteviraci_doba;
  let shift = 0;
  calcResult.inputRows.forEach((r) => {
    if (r.segment !== segment) return;
    const share = (shares[`${r.segment}||${r.pozice}`] || 0) / 100;
    if (!share) return;
    const split = splits[`${r.segment}||${r.pozice}`];
    if (!split || !split.backoffice_zone) return;
    const [nep, ho] = absenceForCalculation(calcResult, r.segment);
    const wplLoad = (r.wpl_load === null || r.wpl_load === undefined) ? openHours : r.wpl_load;
    const wpl = ((r.fte || 0) * wplLoad * (1 - nep / 100 - ho / 100) * (split.backoffice_zone / 100)) / openHours;
    shift += wpl * share;
  });
  return shift;
}

// Přehled pozic s nastaveným podílem fast tracku — do nápovědy k pravidlům,
// aby text odpovídal tomu, co je v referenčních datech.
function fasttrackShareList() {
  if (!db) return [];
  try {
    return dbAll(`SELECT pozice, MAX(fasttrack_share) AS share FROM casove_dotace
      WHERE fasttrack_share > 0 GROUP BY pozice ORDER BY share DESC, pozice`);
  } catch (e) { return []; }
}

// Nepřítomnost a homeoffice segmentu (v %) — přednostně ze snapshotu verze
// referenčních dat, se kterou kalkulace vznikla, jinak z aktuální tabulky.
function absenceForCalculation(calcResult, segment) {
  const version = calcResult && calcResult.refVersionId ? getRefVersionById(calcResult.refVersionId) : null;
  if (version && version.absence) return absenceFromSnapshot(version.absence, segment);
  if (!db) return [0, 0];
  const row = dbAll("SELECT nepritomnost, homeoffice FROM absence WHERE segment = ?", [segment])[0];
  return row ? [row.nepritomnost || 0, row.homeoffice || 0] : [0, 0];
}

// Počet pokladníků (FTE) v kalkulaci — pozice „bankéř klientské péče - junior“.
function cashierFteOf(calcResult) {
  if (!calcResult || !(calcResult.inputRows || []).length) return 0;
  return computeBankerFte(calcResult.inputRows).cashier;
}

const LAYOUT_RULES = [
  {
    zone: "service_zone", furniture: "Fast track (stolek a židle)", formats: null,
    qty: ({ stats }) => stats.recommendedFasttracks,
    text: "<strong>Fast track (stolek a židle)</strong> = doporučený počet fasttracků na hale.",
  },
  {
    // Obývák je sestava tří židlí — z doporučeného počtu židlí se nejdřív složí
    // obýváky (celé trojice) a teprve zbytek se doplní jednotlivými židlemi.
    zone: "service_zone", furniture: "Čekací zóna (obývák)", formats: ["medium", "flagship"],
    qty: ({ stats }) => waitingZoneSplit(stats.recommendedChairs, true).sofas,
    text: `<strong>Čekací zóna (obývák)</strong> = jeden obývák je sestava ${CHAIRS_PER_SOFA} židlí. `
      + `Do doporučení se dává <strong>nejvýš ${MAX_SUGGESTED_SOFAS} obývák</strong> (vejde-li se, tedy `
      + `je-li potřeba alespoň ${CHAIRS_PER_SOFA} židle) — víc obýváků lze v layoutu přidat ručně.`,
  },
  {
    zone: "service_zone", furniture: "Čekací zóna (židle)", formats: null,
    qty: ({ stats, hasSofa }) => waitingZoneSplit(stats.recommendedChairs, hasSofa).chairs,
    text: "<strong>Čekací zóna (židle)</strong> = doporučený počet židlí v čekací zóně; tam, kde je "
      + "i obývák (formát medium a flagship), zbytek nad obývák "
      + `(potřeba 8 židlí → 1 obývák + 5 židlí).`,
  },
  {
    zone: "service_zone", furniture: "Lenka vítací", formats: ["small", "medium economy"],
    qty: () => 1,
    text: "Vítací pracoviště <strong>Lenka vítací</strong> — vždy právě 1 ks, i když je potřeba WPL vyšší.",
  },
  {
    zone: "service_zone", furniture: "Theke - nízká", formats: ["medium"],
    qty: () => 1,
    text: "Vítací pracoviště <strong>Theke - nízká</strong> — vždy právě 1 ks, i když je potřeba WPL vyšší.",
  },
  {
    zone: "service_zone", furniture: "Theke - vysoká", formats: ["flagship"],
    qty: () => 1,
    text: "Vítací pracoviště <strong>Theke - vysoká</strong> — vždy právě 1 ks, i když je potřeba WPL vyšší.",
  },
  {
    // Vítací pracoviště pokrývá 1 WPL; co ze potřeby service zone zbyde, jde na
    // pracoviště „Lenka“. Zaokrouhluje se nahoru — jakýkoliv zbytek dostane
    // vlastní pracoviště, aby potřeba WPL nezůstala nepokrytá.
    zone: "service_zone", furniture: "Lenka", formats: null,
    qty: ({ required }) => (required > 1 ? Math.ceil(required - 1) : 0),
    text: "Zbytek potřeby WPL v Service zone nad rámec vítacího pracoviště se přiřadí na pracoviště " +
      "<strong>Lenka</strong> (potřeba 3,4 → 1 ks vítacího + 3 ks Lenka; jakýkoliv zbytek se zaokrouhlí nahoru).",
  },
  {
    // Pokladník = pozice „bankéř klientské péče - junior“ (ROLE_POSITIONS.cashier).
    zone: "service_zone", furniture: CASHIER_FURNITURE, formats: null,
    qty: ({ cashierFte }) => (cashierFte > 0 ? 1 : 0),
    text: `Je-li na pobočce <strong>pokladník</strong> (pozice „bankéř klientské péče - junior“), `
      + `předvyplní se <strong>1 ks ${CASHIER_FURNITURE}</strong> — jedna pokladna.`,
  },
  {
    zone: "backoffice_zone", furniture: "Interní zasedací místnost - malá", formats: ["medium economy"],
    qty: () => 1,
    text: "Zasedací místnost <strong>Interní zasedací místnost - malá</strong> = 1 ks.",
  },
  {
    zone: "backoffice_zone", furniture: "Interní zasedací místnost - velká", formats: ["medium", "flagship"],
    qty: () => 1,
    text: "Zasedací místnost <strong>Interní zasedací místnost - velká</strong> = 1 ks.",
  },
  {
    zone: "meeting_zone", furniture: "Jednací místnost", formats: null,
    qty: ({ required }) => Math.round(required),
    text: "Celá potřeba WPL v Meeting zone se přiřadí na <strong>Jednací místnost</strong> " +
      "(potřeba WPL 5 → 5 ks; u desetinných hodnot zaokrouhleno).",
  },
  {
    zone: "backoffice_zone", furniture: "Kancelářské místo", formats: null,
    qty: ({ required, backofficeShift }) => Math.floor(Math.max(0, required - backofficeShift)),
    text: "Potřeba WPL v Backoffice zone se přiřadí na <strong>Kancelářské místo</strong> "
      + "(potřeba WPL 5 → 5 ks; desetinná část se zaokrouhluje dolů). Nejdřív se ale odečte část, "
      + "kterou pozice odsedí na fast tracku — viz pravidlo níže.",
  },
  {
    zone: "backoffice_zone", furniture: "Fast track backoffice", formats: null,
    qty: ({ required, backofficeShift }) => {
      const rest = Math.max(0, required - backofficeShift);
      return Math.ceil(backofficeShift) + (rest - Math.floor(rest) > 0.5 ? 1 : 0);
    },
    text: () => {
      const list = fasttrackShareList();
      return "Část backoffice času pozic se přesune z kancelářského místa na "
        + "<strong>Fast track backoffice</strong> podle nastavení <strong>Fast track %</strong> u pozice "
        + "(„Data a Excel šablona → Pozice a jejich časové dotace“): "
        + (list.length
          ? list.map((r) => `<strong>${esc(r.pozice)}</strong> ${fmtPieces(r.share)} %`).join(", ")
          : "zatím žádná pozice nemá podíl fast tracku nastavený")
        + ". Tato část potřeby WPL se odečte od „Kancelářské místo“ a přiřadí se jako fast tracky "
        + "(zaokrouhleno nahoru) — fast track se nevykazuje jako WPL, takže se šetří plocha i náklady. "
        + "Navíc platí původní pravidlo: je-li desetinná část zbylé potřeby větší než 0,5, přidá se "
        + "ještě 1 ks fast tracku.";
    },
  },
  {
    zone: "office_room", furniture: "Kancelář", formats: null,
    qty: ({ required }) => (required > 0 ? Math.max(1, Math.round(required)) : 0),
    text: "Je-li v zóně Office room jakákoliv potřeba WPL, předvyplní se <strong>Kancelář</strong>.",
  },
];

// Formát pobočky se v aplikaci ukládá jako "medium economy", uživatelé ho ale
// píší i jako "medium-economy" — pro porovnání s pravidly se sjednotí.
function normalizeFormatKey(formatTyp) {
  return String(formatTyp || "").trim().toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ");
}

// Vrátí mapu "segment||zóna||nábytek" -> doporučený počet kusů pro danou
// kalkulaci. Pravidlo se použije jen tam, kde daný segment a zóna odpovídající
// nábytkový prvek skutečně mají (podle tabulky furniture_to_zone).
function computeLayoutSuggestions(segmentRows, stats, calcResult) {
  if (!stats) return {};
  const formatKey = normalizeFormatKey(stats.formatTyp);
  const cashierFte = cashierFteOf(calcResult);
  const out = {};
  segmentRows.forEach((seg) => {
    // Kolik potřeby WPL v backoffice zóně se přesune na fast tracky, a jestli
    // segment vůbec obývák má (pak jdou židle jen jako zbytek do trojic).
    const backofficeShift = backofficeFastTrackShift(seg.segment, calcResult);
    ZONES.forEach((zone) => {
      const required = seg[zone] || 0;
      const names = new Set(getFurnitureOptions(seg.segment, zone).map((o) => o.furniture));
      if (!names.size) return;
      const hasSofa = names.has("Čekací zóna (obývák)") && ["medium", "flagship"].includes(formatKey);
      LAYOUT_RULES.forEach((rule) => {
        if (rule.zone !== zone) return;
        if (rule.formats && !rule.formats.includes(formatKey)) return;
        if (!names.has(rule.furniture)) return;
        const qty = Math.max(0, Math.round(rule.qty({ required, stats, segment: seg.segment,
          calcResult, formatKey, cashierFte, backofficeShift, hasSofa }) || 0));
        if (qty > 0) out[`${seg.segment}||${zone}||${rule.furniture}`] = qty;
      });
    });
  });
  return out;
}

// Ikona nápovědy u výsledku kalkulace — vysvětlí vzorec a rozepíše ho na dvou
// konkrétních pozicích. Pokud jsou v kalkulaci, použijí se její skutečná čísla
// (FTE, otevírací doba, verze referenčních dat), jinak modelový 1 FTE.
const CALC_EXAMPLE_POSITIONS = ["osobní bankéř - medior", "bankéř klientské péče - medior"];

function calcExampleHtml(result, poziceLower) {
  const openHours = (result && result.oteviraci_doba) || 40;
  const row = ((result && result.inputRows) || [])
    .find((r) => String(r.pozice).trim().toLowerCase() === poziceLower);
  const segment = row ? row.segment : "MMMA";
  const pozice = row ? row.pozice : poziceLower;
  const split = dotaceSplitMap(result && result.refVersionId)[`${segment}||${pozice}`];
  if (!split || !zoneSplitTotal(split)) return "";

  const fte = row ? (row.fte || 0) : 1;
  const wplLoad = (row && row.wpl_load !== null && row.wpl_load !== undefined) ? row.wpl_load : openHours;
  const [nep, ho] = absenceForCalculation(result, segment);
  const coef = 1 - nep / 100 - ho / 100;
  const hours = fte * wplLoad * coef;
  const zoneLines = ZONES.filter((z) => (Number(split[z]) || 0) > 0).map((z) => {
    const wpl = (hours * (Number(split[z]) / 100)) / openHours;
    return `<li>${esc(ZONE_LABELS[z])}: ${fmt1(hours)} h × ${fmt1(split[z])} %`
      + ` ÷ ${fmt1(openHours)} h = <strong>${wpl.toFixed(2)} WPL</strong></li>`;
  }).join("");
  const total = ZONES.reduce((a, z) => a + (hours * (Number(split[z]) || 0) / 100) / openHours, 0);

  return `<p style="margin:9px 0 3px;"><strong>${esc(pozice)}</strong> (${esc(segment)})${row
    ? "" : " — v této kalkulaci není, ukázka pro 1 FTE"}</p>
    <ol style="margin:0 0 4px; padding-left:18px;">
      <li>Zadané FTE: <strong>${fmt1(fte)}</strong>, doba vytížení <strong>${fmt1(wplLoad)} h/týden</strong></li>
      <li>Koeficient přítomnosti: 1 − nepřítomnost ${fmt1(nep)} % − homeoffice ${fmt1(ho)} %
        = <strong>${coef.toFixed(3)}</strong></li>
      <li>Efektivně odpracováno: ${fmt1(fte)} × ${fmt1(wplLoad)} × ${coef.toFixed(3)}
        = <strong>${fmt1(hours)} h/týden</strong></li>
      <li>Rozdělení podle časové dotace pozice:<ul style="margin:3px 0 0;">${zoneLines}</ul></li>
    </ol>
    <p style="margin:0 0 6px;">Celkem tato pozice generuje <strong>${total.toFixed(2)} WPL</strong>.</p>`;
}

// Vysvětlení směnového režimu do nápovědy u výsledku kalkulace — proč při
// otevírací době vyšší než doba vytížení vychází na jedno místo více FTE.
function shiftHelpHtml(result) {
  const f = result ? shiftFactor(result.oteviraci_doba, result.doba_vytezeni_wpl) : null;
  if (!f || !isShiftMode(result.oteviraci_doba, result.doba_vytezeni_wpl)) return "";
  return `<p style="margin:8px 0 0; padding-top:6px; border-top:1px dashed rgba(255,255,255,.3);">
    <strong>Směnový režim:</strong> otevírací doba ${fmt1(f.open)} h/týden je vyšší než doba vytížení
    pozice ${fmt1(f.load)} h/týden (typicky obchodní centrum otevřené 7 dní v týdnu). Ve vzorci se dělí
    otevírací dobou, takže jedna pozice pokryje jen ${Math.round(f.coverage * 100)} % otevírací doby —
    na jedno pracovní místo obsazené po celou otevírací dobu je potřeba ${fmt1(f.ftePerSeat)} FTE.
    Kalkulace tím sama počítá s tím, že lidé nejsou na pobočce všichni naráz, ale střídají se.</p>`;
}

function calcResultHelpHtml(result) {
  const openHours = (result && result.oteviraci_doba) || 40;
  const examples = CALC_EXAMPLE_POSITIONS.map((pz) => calcExampleHtml(result, pz)).filter(Boolean).join("");
  return `<span class="help-icon" tabindex="0">?<span class="help-tooltip">
    <strong>Jak se počítá kapacita (WPL) z FTE</strong>
    <p style="margin:6px 0;">Pro každý řádek checklistu a každou zónu zvlášť:</p>
    <p style="margin:0 0 4px;"><code>WPL = FTE × doba vytížení × (1 − nepřítomnost − homeoffice)
      × dotace zóny % ÷ otevírací doba pobočky</code></p>
    <p style="margin:0 0 6px;">Doba vytížení je počet hodin, které pozice týdně odpracuje (u segmentu
      CESTOVNÍ vlastní hodnota z checklistu, jinak otevírací doba pobočky — tady
      <strong>${fmt1(openHours)} h/týden</strong>). Nepřítomnost a homeoffice bere kalkulace
      z referenčních dat podle segmentu, časovou dotaci podle segmentu a pozice.</p>
    ${examples || '<p style="margin:0;">Pro ukázku chybí časové dotace pozic v referenčních datech.</p>'}
    <p style="margin:6px 0 0;">WPL jednotlivých řádků se sečtou po zónách do segmentu a do řádku
      „Celkem“ — to je potřeba pracovních míst, kterou pak pokrývá layout.</p>
    ${shiftHelpHtml(result)}
  </span></span>`;
}

// Nápověda u nadpisu „Sestavení layoutu“ se překresluje po každé změně
// referenčních dat — texty pravidel se generují z nastavení v databázi
// (např. podíl fast tracku u pozic), takže musí být vždy aktuální.
function renderLayoutRulesHelp() {
  const el = document.getElementById("layoutRulesHelp");
  if (el) el.innerHTML = layoutRulesHelpHtml();
}

// Ikona nápovědy s výpisem všech platných pravidel — obsah se generuje
// z LAYOUT_RULES, aby odpovídal tomu, co aplikace skutečně dělá.
function layoutRulesHelpHtml() {
  const formatLabel = (formats) => formats ? `pro formát ${formats.join(", ")}` : "pro všechny formáty";
  const items = LAYOUT_RULES.map((r) =>
    `<li>${typeof r.text === "function" ? r.text() : r.text}`
    + ` <span style="opacity:.7">(${ZONE_LABELS[r.zone]}, ${formatLabel(r.formats)})</span></li>`).join("");
  return `<span class="help-icon" tabindex="0">?<span class="help-tooltip">
    <strong>Pravidla pro předvyplnění layoutu</strong>
    <ul>${items}</ul>
    Předvyplněné hodnoty jsou barevně zvýrazněné a označené štítkem „doporučeno“ — jde o návrh,
    který lze libovolně přepsat. Pravidlo se použije jen u segmentů, které daný nábytkový prvek
    v dané zóně mají. Při úpravě už uloženého layoutu se předvyplnění neprovádí, aby nepřepsalo
    dříve zadané hodnoty.
  </span></span>`;
}

function getFurnitureOptions(segment, zone) {
  return dbAll("SELECT furniture, wpl_counter FROM furniture_to_zone WHERE segment = ? AND zone = ? ORDER BY id", [segment, zone]);
}

function getExistingLayout(calculationKey) {
  return dbAll(`SELECT layout_key, segment, zone, furniture, wpl_assigned, calculated_wpl, piece_count
    FROM layouts WHERE calculation_key = ? ORDER BY id`, [calculationKey]);
}

// segmentRows = výsledkové řádky kalkulace (bez řádku "Celkem"), meta = {calculation_key, pobocka_id, pobocka_nazev}
function renderLayoutSection(containerId, segmentRows, meta) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const existing = getExistingLayout(meta.calculation_key);
  if (existing.length) {
    renderLayoutReadonly(container, existing, meta, segmentRows);
  } else {
    renderLayoutForm(container, segmentRows, meta, []);
  }
}

// existingRows (volitelné) předvyplní počty kusů uloženého layoutu při úpravě.
// Zóny se spočítaným požadavkem WPL == 0 se také zobrazí (jen s poznámkou),
// aby šlo nábytek přiřadit i nad rámec výpočtu jako pojistku/ruční korekci.
function renderLayoutForm(container, segmentRows, meta, existingRows) {
  const existingMap = {};
  (existingRows || []).forEach((r) => { existingMap[`${r.segment}||${r.zone}||${r.furniture}`] = r.piece_count; });
  // Doporučené předvyplnění podle pravidel (LAYOUT_RULES) se použije jen u nového,
  // zatím neuloženého layoutu — při úpravě uloženého layoutu by přepsalo hodnoty,
  // které už uživatel zadal.
  const isEdit = (existingRows || []).length > 0;
  const suggestions = isEdit ? {} : computeLayoutSuggestions(segmentRows, meta.stats, meta.calcResult);

  let groupsHtml = "";
  let anyGroup = false;
  segmentRows.forEach((seg) => {
    ZONES.forEach((zone) => {
      const required = seg[zone] || 0;
      const options = getFurnitureOptions(seg.segment, zone);
      if (!options.length) {
        if (required > 0) {
          anyGroup = true;
          groupsHtml += `
            <div class="layout-group">
              <h4>${segmentBadgeHtml(seg.segment)} — ${ZONE_LABELS[zone]} <span class="muted">(potřeba WPL: ${fmt1(required)})</span></h4>
              <p class="muted">Pro tento segment a zónu nejsou v databázi definované žádné nábytkové prvky
              (tabulka „furniture_to_zone“) — WPL nelze rozpočítat na konkrétní kusy nábytku.</p>
            </div>`;
        }
        return;
      }
      anyGroup = true;
      let hasPrefill = false;
      const rowsHtml = options.map((o) => {
        const key = `${seg.segment}||${zone}||${o.furniture}`;
        const suggested = suggestions[key] || 0;
        const prefill = isEdit ? (existingMap[key] || 0) : suggested;
        if (prefill > 0) hasPrefill = true;
        return `<tr class="${suggested > 0 ? "layout-row-suggested" : ""}">
          <td>${esc(o.furniture)}${suggested > 0
            ? ` <span class="layout-suggest-badge" title="Předvyplněno podle pravidel pro formát „${esc(meta.stats?.formatTyp)}“">doporučeno</span>`
            : ""}</td>
          <td>${o.wpl_counter > 0 ? fmt1(o.wpl_counter) : '<span class="muted">nepřispívá k WPL</span>'}</td>
          <td><input type="number" min="0" step="1" value="${prefill}" class="layout-qty${suggested > 0 ? " suggested" : ""}"
            data-furniture="${esc(o.furniture)}" data-wpl-counter="${o.wpl_counter}"></td>
        </tr>`;
      }).join("");
      const groupBody = `
        <div class="layout-group" data-segment="${esc(seg.segment)}" data-zone="${zone}" data-required="${required}">
          <h4>${segmentBadgeHtml(seg.segment)} — ${ZONE_LABELS[zone]} <span class="muted">(potřeba WPL: ${fmt1(required)})</span></h4>
          <div class="table-wrap"><table>
            <thead><tr><th>Nábytek</th><th>WPL / kus</th><th>Počet kusů</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table></div>
          <p class="muted layout-summary">Přiřazeno WPL: <strong>0.0</strong> / ${fmt1(required)}</p>
        </div>`;
      // Zóny bez vypočítané potřeby WPL se sbalí do <details>, aby nezahlcovaly
      // formulář — jde jen o ruční pojistku/rezervu nad rámec výpočtu. Pokud
      // v nich ale už něco přiřazeno je (např. při úpravě layoutu), zůstanou rozbalené.
      if (required <= 0) {
        groupsHtml += `<details class="layout-optional-zone"${hasPrefill ? " open" : ""}>
          <summary>${segmentBadgeHtml(seg.segment)} — ${ZONE_LABELS[zone]} <span class="muted">(bez výpočtu WPL — ruční přiřazení)</span></summary>
          ${groupBody}
        </details>`;
      } else {
        groupsHtml += groupBody;
      }
    });
  });
  if (!anyGroup) {
    container.innerHTML = `<p class="muted">Pro tuto kalkulaci nejsou v databázi definované žádné nábytkové prvky — sestavení layoutu se neprovádí.</p>`;
    return;
  }
  const suffix = meta.pdfOptionsSuffix || "";
  container.innerHTML = `${groupsHtml}
    <div class="layout-actions">
      <button class="btn big" id="btnSaveLayout">💾 Uložit layout</button>
      <span class="muted">Uložením se layout zapíše ke kalkulaci — teprve pak se dá vygenerovat
        kapitola „Layout pobočky“ v PDF a zkopírovat nábytek do schránky.</span>
    </div>
    <div class="cap-box-holder"></div>
    <div class="fp-panel">
      <h4>Schéma pobočky (půdorys) ${srcBadgeHtml("calc")}</h4>
      <p class="muted">Kreslí se z počtů zadaných výše — každý kus nábytku je samostatný symbol.
        Schéma se překresluje průběžně, jak počty měníte.</p>
      <div id="floorPlanArea${suffix}"></div>
    </div>`;
  wireLayoutFormListeners(container);

  // Kapacitní shrnutí se přepočítává rovnou při zadávání počtů kusů, aby
  // bylo hned vidět, jestli zadané množství na špičku stačí. Data návštěvnosti
  // se načtou jednou dopředu, ne při každém stisku klávesy.
  const capHolder = container.querySelector(".cap-box-holder");
  const visitorForCap = getVisitorForCalculation(meta.calculation_key, meta.pobocka_id, meta.pobocka_nazev);
  const refreshCapBox = () => {
    capHolder.innerHTML = capacityCheckHtmlFor(meta, readLayoutFormRows(container), visitorForCap);
  };
  refreshCapBox();
  // Schéma pobočky se překresluje ze stejných dat, ale se zpožděním — překreslení
  // celého plánu při každém stisku klávesy by zdržovalo psaní.
  const drawPlan = () => renderFloorPlan(`floorPlanArea${suffix}`, readLayoutFormRows(container), meta, suffix);
  drawPlan();
  let planTimer = null;
  container.addEventListener("input", (e) => {
    if (!e.target.classList.contains("layout-qty")) return;
    refreshCapBox();
    clearTimeout(planTimer);
    planTimer = setTimeout(drawPlan, 450);
  });
  // Tlačítka se hledají v rámci `container`, ne přes document.getElementById —
  // sekce layoutu je na stránce dvakrát (krok 4 průvodce a detail v historii),
  // takže stejná id existují ve dvou instancích a globální hledání by našlo
  // vždy jen tu první.
  container.querySelector("#btnSaveLayout").addEventListener("click", () => saveLayoutAssignment(container, meta, segmentRows));
}

function wireLayoutFormListeners(container) {
  container.querySelectorAll(".layout-group").forEach((group) => {
    const summaryEl = group.querySelector(".layout-summary");
    if (!summaryEl) return; // informační skupina bez definovaného nábytku (jen text, žádné vstupy)
    const update = () => {
      let assigned = 0;
      group.querySelectorAll(".layout-qty").forEach((input) => {
        const pieces = parseInt(input.value, 10) || 0;
        const wplCounter = parseFloat(input.dataset.wplCounter) || 0;
        assigned += pieces * wplCounter;
      });
      const required = parseFloat(group.dataset.required);
      summaryEl.querySelector("strong").textContent = assigned.toFixed(1);
      summaryEl.classList.toggle("over", assigned > required);
    };
    group.querySelectorAll(".layout-qty").forEach((input) => input.addEventListener("input", update));
    update(); // zohlední předvyplněné hodnoty při úpravě existujícího layoutu
  });
}

function saveLayoutAssignment(container, meta, segmentRows) {
  const layoutKey = `layout_${meta.pobocka_id}-${meta.pobocka_nazev}-${nowStamp()}`;
  const createdAt = nowIso();
  const rows = [];
  container.querySelectorAll(".layout-group").forEach((group) => {
    const segment = group.dataset.segment;
    const zone = group.dataset.zone;
    if (!segment || !zone) return; // skupina bez nábytkových prvků (jen informační poznámka)
    const required = parseFloat(group.dataset.required);
    group.querySelectorAll(".layout-qty").forEach((input) => {
      const pieces = parseInt(input.value, 10) || 0;
      if (pieces <= 0) return;
      const wplCounter = parseFloat(input.dataset.wplCounter) || 0;
      rows.push({ segment, zone, furniture: input.dataset.furniture,
        piece_count: pieces, wpl_assigned: pieces * wplCounter, calculated_wpl: required });
    });
  });
  if (!rows.length) { toast("Nebyl přiřazen žádný nábytek — zadejte alespoň jeden počet kusů.", "err"); return; }

  // Úprava existujícího layoutu přepíše původní přiřazení (nezakládá historii verzí).
  dbRun("DELETE FROM layouts WHERE calculation_key = ?", [meta.calculation_key]);
  const ins = db.prepare(`INSERT INTO layouts
    (layout_key, calculation_key, segment, zone, furniture, wpl_assigned, calculated_wpl, piece_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  rows.forEach((r) => {
    ins.run([layoutKey, meta.calculation_key, r.segment, r.zone, r.furniture, r.wpl_assigned, r.calculated_wpl, r.piece_count, createdAt]);
  });
  ins.free();
  persistDatabase();
  toast("Layout byl uložen.", "ok");
  renderLayoutReadonly(container, getExistingLayout(meta.calculation_key), meta, segmentRows);
  // Uložený layout zpřístupní rozsah „jen layout“, kopírování nábytku a překlopí
  // timeline vedle kalkulace.
  refreshOutputSection(meta.pdfOptionsSuffix || "");
  if (container.id === "layoutArea" && meta.calcResult) renderCalcTimeline(meta.calcResult);
}

// Kompletní přehled WPL po zónách a segmentech vč. FTE a poměru WPL/FTE
// (celkem i za každý segment zvlášť). Je-li layout už sestavený, ukazuje se
// u každé zóny i skutečně přiřazené WPL ve formátu "potřeba / přiřazeno".
function renderWplOverviewHtml(overview) {
  const pct = (v) => (v === null || v === undefined || Number.isNaN(v)) ? "—" : `${v.toFixed(1)} %`;
  const cell = (req, asg) => {
    if (!overview.hasLayout) return `<td>${fmt1(req)}</td>`;
    const cls = asg + 0.05 < req ? "wpl-under" : asg > req + 0.05 ? "wpl-over" : "wpl-ok";
    return `<td>${fmt1(req)} <span class="${cls}">/ ${fmt1(asg)}</span></td>`;
  };
  const rowHtml = (r, isTotal) => `<tr class="${isTotal ? "total-row" : ""}">
    <td>${isTotal ? esc(r.segment) : segmentBadgeHtml(r.segment)}</td>
    <td>${fmt1(r.fte)}</td>
    ${ZONES.map((z) => cell(r.zones[z], r.assignedZones[z])).join("")}
    ${cell(r.wplTotal, r.assignedTotal)}
    <td>${pct(r.wplPerFtePct)}</td>
  </tr>`;
  return `<h4 style="margin-top:0;">Kompletní přehled WPL po zónách a segmentech ${srcBadgeHtml("calc")}</h4>
    <div class="table-wrap"><table class="wpl-overview">
      <thead><tr><th>Segment</th><th>FTE</th>
        ${ZONES.map((z) => `<th>${ZONE_LABELS[z]}</th>`).join("")}
        <th>WPL celkem</th><th>WPL / FTE</th></tr></thead>
      <tbody>${overview.rows.map((r) => rowHtml(r, false)).join("")}${rowHtml(overview.total, true)}</tbody>
    </table></div>
    <p class="muted">${overview.hasLayout
      ? 'U každé zóny je uvedena <strong>potřeba WPL z kalkulace</strong> a za lomítkem <strong>skutečně přiřazené WPL</strong> ze sestaveného layoutu (zeleně shoda, oranžově méně, modře více než potřeba).'
      : "Uvedena je potřeba WPL z kalkulace."}
      Sloupec <strong>WPL / FTE</strong> udává, na kolik FTE dané WPL vychází — celkem i za každý segment zvlášť.</p>`;
}

// Rozbalovací analýza segmentů, zón a jejich prvků — jedna jednotná tabulka.
// Každý nábytkový prvek má vlastní řádek; buňky segmentu a zóny se slučují přes
// rowspan, takže se celá analýza čte jako jedna tabulka, a ne jako vnořené bloky.
// Pozn.: kvůli rowspan nelze zarovnávat sloupce přes :nth-child (na řádcích, kde
// je buňka sloučená, se indexy posunou) — číselné buňky proto nesou class="num".
function renderZoneAnalysisHtml(overview, layoutRows) {
  const byKey = {};
  (layoutRows || []).forEach((r) => { (byKey[`${r.segment}||${r.zone}`] = byKey[`${r.segment}||${r.zone}`] || []).push(r); });

  const bodyRows = [];
  overview.rows.forEach((segRow) => {
    // Zóny, do kterých se něco přiřadilo, nebo u kterých kalkulace vyžaduje WPL.
    const zones = ZONES.filter((z) => (byKey[`${segRow.segment}||${z}`] || []).length > 0 || segRow.zones[z] > 0);
    if (!zones.length) return;

    // Buňka segmentu se slučuje přes všechny jeho řádky (prázdná zóna = 1 řádek).
    const segSpan = zones.reduce((n, z) => n + Math.max(1, (byKey[`${segRow.segment}||${z}`] || []).length), 0);
    let segCellEmitted = false;

    zones.forEach((z) => {
      const items = byKey[`${segRow.segment}||${z}`] || [];
      const rowsForZone = items.length ? items : [null];
      rowsForZone.forEach((it, i) => {
        let html = "<tr>";
        if (!segCellEmitted) {
          html += `<td rowspan="${segSpan}" class="analysis-seg-cell">${segmentBadgeHtml(segRow.segment)}
            <span class="muted">FTE ${fmt1(segRow.fte)} · WPL ${fmt1(segRow.wplTotal)}</span></td>`;
          segCellEmitted = true;
        }
        if (i === 0) {
          html += `<td rowspan="${rowsForZone.length}" class="analysis-zone-cell">${ZONE_LABELS[z]}
            <span class="muted">potřeba WPL ${fmt1(segRow.zones[z])} · přiřazeno ${fmt1(segRow.assignedZones[z])}</span></td>`;
        }
        if (it) {
          const perPiece = it.piece_count > 0 ? it.wpl_assigned / it.piece_count : 0;
          html += `<td>${esc(it.furniture)}</td>
            <td class="num">${fmtPieces(it.piece_count)}</td>
            <td class="num">${perPiece > 0 ? fmt1(perPiece) : '<span class="muted">—</span>'}</td>
            <td class="num">${fmt1(it.wpl_assigned)}</td>`;
        } else {
          html += `<td colspan="3" class="muted">Do této zóny nebyl přiřazen žádný nábytek.</td>
            <td class="num">0.0</td>`;
        }
        bodyRows.push(html + "</tr>");
      });
    });

    bodyRows.push(`<tr class="analysis-subtotal">
      <td colspan="3">Celkem ${esc(segRow.segment)}</td>
      <td class="num">${fmtPieces(segRow.piecesTotal)}</td>
      <td class="num"></td>
      <td class="num">${fmt1(segRow.assignedTotal)}</td></tr>`);
  });

  if (!bodyRows.length) {
    return `<details class="analysis-wrap" style="margin-top:16px;">
      <summary><strong>Analýza segmentů, zón a jejich prvků</strong></summary>
      <p class="muted" style="margin-top:10px;">Zatím není co analyzovat — nevyšla potřeba WPL v žádné zóně.</p>
    </details>`;
  }

  bodyRows.push(`<tr class="total-row">
    <td colspan="3">Celkem za pobočku</td>
    <td class="num">${fmtPieces(overview.total.piecesTotal)}</td>
    <td class="num"></td>
    <td class="num">${fmt1(overview.total.assignedTotal)}</td></tr>`);

  return `<details class="analysis-wrap" style="margin-top:16px;">
    <summary><strong>Analýza segmentů, zón a jejich prvků</strong>
      <span class="muted">(rozbalte pro detailní tabulku)</span></summary>
    <div class="table-wrap" style="margin-top:10px;"><table class="analysis-table">
      <thead><tr><th>Segment</th><th>Zóna</th><th>Nábytkový prvek</th>
        <th class="num">Počet ks</th><th class="num">WPL / kus</th><th class="num">WPL přiřazeno</th></tr></thead>
      <tbody>${bodyRows.join("")}</tbody>
    </table></div>
  </details>`;
}

/* ---------------- Nábytek připadající na druh zaměstnance ------------------ */
// Rozpočítá nábytek ze sestaveného layoutu na jednotlivé druhy zaměstnanců
// (pozice z checklistu). Postup: pro každou pozici se spočítá její WPL po zónách
// úplně stejným výpočtem jako v runCalculation() (FTE × vytížení × (1 − absence
// − homeoffice), rozdělené procenty časové dotace), a nábytek přiřazený do dané
// zóny se pak rozdělí mezi pozice podle jejich podílu na WPL té zóny. Výsledný
// počet kusů je proto zlomkový — jde o podíl, který na danou pozici připadá.
//
// Referenční data se berou ze snapshotu verze, se kterou byla kalkulace
// spočítána (aby pozdější úpravy referenčních dat výsledek nezkreslily); pokud
// verze není známá, použije se aktuální stav tabulek.
function computePositionFurniture(calcResult, layoutRows) {
  const version = calcResult && calcResult.refVersionId ? getRefVersionById(calcResult.refVersionId) : null;
  const absenceMap = {}, dotaceMap = {};
  if (version) {
    version.absence.forEach(([seg, nep, ho]) => { absenceMap[seg] = [(nep || 0) / 100, (ho || 0) / 100]; });
    version.dotace.forEach(([seg, poz, s, m, b, o]) => {
      dotaceMap[`${seg} ${poz}`] = { service_zone: s, meeting_zone: m, backoffice_zone: b, office_room: o };
    });
  } else {
    dbAll("SELECT segment, nepritomnost, homeoffice FROM absence")
      .forEach((r) => { absenceMap[r.segment] = [(r.nepritomnost || 0) / 100, (r.homeoffice || 0) / 100]; });
    dbAll("SELECT segment, pozice, service_zone, meeting_zone, backoffice_zone, office_room FROM casove_dotace")
      .forEach((r) => { dotaceMap[`${r.segment} ${r.pozice}`] = r; });
  }

  const oteviraci = calcResult.oteviraci_doba || 40;
  const positions = {};   // "segment||pozice" -> { segment, pozice, fte, zones }
  const zoneTotals = {};  // "segment||zóna"   -> celkové WPL zóny
  (calcResult.inputRows || []).forEach((r) => {
    if (!r.fte || r.fte <= 0) return;
    const dotace = dotaceMap[`${r.segment} ${r.pozice}`];
    if (!dotace) return; // pozice bez časové dotace se do kalkulace nedostala
    const wplLoad = (r.wpl_load === null || r.wpl_load === undefined) ? oteviraci : r.wpl_load;
    const [nep, ho] = absenceMap[r.segment] || [0, 0];
    const vypocet = r.fte * wplLoad * (1 - nep - ho);
    const key = `${r.segment}||${r.pozice}`;
    if (!positions[key]) positions[key] = { segment: r.segment, pozice: r.pozice, fte: 0, zones: {} };
    positions[key].fte += r.fte;
    ZONES.forEach((z) => {
      const hodiny = (vypocet * (dotace[z] || 0)) / 100 / oteviraci;
      positions[key].zones[z] = (positions[key].zones[z] || 0) + hodiny;
      zoneTotals[`${r.segment}||${z}`] = (zoneTotals[`${r.segment}||${z}`] || 0) + hodiny;
    });
  });

  const furnitureByZone = {};
  (layoutRows || []).forEach((r) => {
    (furnitureByZone[`${r.segment}||${r.zone}`] = furnitureByZone[`${r.segment}||${r.zone}`] || []).push(r);
  });

  const result = Object.values(positions).map((p) => {
    const items = {};
    let wplTotal = 0;
    ZONES.forEach((z) => {
      const wpl = p.zones[z] || 0;
      wplTotal += wpl;
      const zoneTotal = zoneTotals[`${p.segment}||${z}`] || 0;
      if (wpl <= 0 || zoneTotal <= 0) return;
      const share = wpl / zoneTotal;
      (furnitureByZone[`${p.segment}||${z}`] || []).forEach((f) => {
        const k = `${z}||${f.furniture}`;
        if (!items[k]) items[k] = { zone: z, furniture: f.furniture, pieces: 0, wpl: 0 };
        items[k].pieces += (f.piece_count || 0) * share;
        items[k].wpl += (f.wpl_assigned || 0) * share;
      });
    });
    return {
      ...p, wplTotal, items: Object.values(items),
      piecesTotal: Object.values(items).reduce((s, it) => s + it.pieces, 0),
    };
  }).filter((p) => p.items.length > 0)
    .sort((a, b) => a.segment.localeCompare(b.segment) || b.wplTotal - a.wplTotal);

  // Nábytek v zónách, kde kalkulace nevyžaduje žádné WPL (typicky prvky doplněné
  // podle pravidel nebo ručně — vítací pracoviště, fasttracky, čekací zóna),
  // nelze na pozice rozpočítat: žádná pozice v takové zóně WPL negeneruje, takže
  // neexistuje podíl, kterým by se dělil. Vykazuje se proto zvlášť, aby součty
  // odpovídaly skutečnému obsahu layoutu a nic „nezmizelo“.
  const unallocated = [];
  Object.keys(furnitureByZone).forEach((key) => {
    if ((zoneTotals[key] || 0) > 0) return;
    const [segment, zone] = key.split("||");
    furnitureByZone[key].forEach((f) => {
      unallocated.push({ segment, zone, furniture: f.furniture, pieces: f.piece_count || 0 });
    });
  });

  return { positions: result, unallocated };
}

function renderPositionFurnitureHtml(calcResult, layoutRows) {
  if (!calcResult) return "";
  const { positions, unallocated } = computePositionFurniture(calcResult, layoutRows);
  if (!positions.length && !unallocated.length) {
    return `<details class="analysis-wrap" style="margin-top:16px;">
      <summary><strong>Nábytek připadající na druh zaměstnance</strong></summary>
      <p class="muted" style="margin-top:10px;">Zatím není co rozpočítat — do layoutu nebyl přiřazen žádný nábytek
        v zónách, které některá pozice využívá.</p>
    </details>`;
  }

  const frac = (n) => n.toFixed(2).replace(/\.00$/, "");
  const bodyRows = [];
  positions.forEach((p) => {
    p.items.forEach((it, i) => {
      let html = "<tr>";
      if (i === 0) {
        html += `<td rowspan="${p.items.length}" class="analysis-seg-cell">${segmentBadgeHtml(p.segment)}</td>
          <td rowspan="${p.items.length}" class="analysis-zone-cell">${esc(p.pozice)}
            <span class="muted">FTE ${fmt1(p.fte)} · WPL ${fmt1(p.wplTotal)}</span></td>`;
      }
      html += `<td>${ZONE_LABELS[it.zone]}</td>
        <td>${esc(it.furniture)}</td>
        <td class="num">${frac(it.pieces)}</td>
        <td class="num">${p.fte > 0 ? frac(it.pieces / p.fte) : "—"}</td>`;
      bodyRows.push(html + "</tr>");
    });
    bodyRows.push(`<tr class="analysis-subtotal">
      <td colspan="4">Celkem ${esc(p.pozice)}</td>
      <td class="num">${frac(p.piecesTotal)}</td>
      <td class="num">${p.fte > 0 ? frac(p.piecesTotal / p.fte) : "—"}</td></tr>`);
  });

  // Nerozpočítaný nábytek (zóny bez potřeby WPL) — vykazuje se zvlášť.
  if (unallocated.length) {
    unallocated.forEach((u, i) => {
      let html = "<tr>";
      if (i === 0) {
        html += `<td rowspan="${unallocated.length}" class="analysis-seg-cell muted">—</td>
          <td rowspan="${unallocated.length}" class="analysis-zone-cell">Nerozpočítáno
            <span class="muted">zóna bez potřeby WPL</span></td>`;
      }
      html += `<td>${segmentBadgeHtml(u.segment)} ${ZONE_LABELS[u.zone]}</td>
        <td>${esc(u.furniture)}</td>
        <td class="num">${frac(u.pieces)}</td>
        <td class="num">—</td>`;
      bodyRows.push(html + "</tr>");
    });
    bodyRows.push(`<tr class="analysis-subtotal">
      <td colspan="4">Celkem nerozpočítáno</td>
      <td class="num">${frac(unallocated.reduce((s, u) => s + u.pieces, 0))}</td>
      <td class="num">—</td></tr>`);
  }

  return `<details class="analysis-wrap" style="margin-top:16px;">
    <summary><strong>Nábytek připadající na druh zaměstnance</strong>
      <span class="muted">(rozbalte pro detailní tabulku)</span></summary>
    <div class="table-wrap" style="margin-top:10px;"><table class="analysis-table">
      <thead><tr><th>Segment</th><th>Pozice (druh zaměstnance)</th><th>Zóna</th><th>Nábytkový prvek</th>
        <th class="num">Připadá ks</th><th class="num">z toho na 1 FTE</th></tr></thead>
      <tbody>${bodyRows.join("")}</tbody>
    </table></div>
    <p class="muted" style="margin-top:8px;">Nábytek přiřazený do zóny je rozpočítaný mezi pozice podle jejich podílu
      na potřebě WPL dané zóny, proto jsou počty kusů zlomkové — jde o podíl, který na danou pozici připadá.
      Prvky, které nepřispívají k WPL (např. fasttracky), se rozpočítávají stejným podílem.
      ${unallocated.length ? 'Řádky <strong>„Nerozpočítáno“</strong> jsou prvky v zónách, kde kalkulace nevyžaduje žádné WPL (typicky vítací pracoviště, fasttracky nebo čekací zóna doplněné podle pravidel či ručně) — na pozice je nelze rozdělit, protože v takové zóně žádná pozice WPL negeneruje.' : ""}</p>
  </details>`;
}

/* ------------------- Schéma pobočky (půdorys) — Fabric.js ------------------- */
// Z uloženého (nebo právě zadávaného) layoutu se nakreslí půdorysné schéma
// pobočky: zóny jako místnosti a v nich **přesný počet** zadaných nábytkových
// prvků nakreslených jako symboly (theke s židlí, jednací místnost se stolem
// a židlemi, pokladní ostrov, čekací židle, obývák, fast tracky, kancelářská
// místa). Kreslí se přes Fabric.js (`vendor/fabric.min.js`), takže se s prvky
// dá i hýbat — schéma je návrh rozmístění, ne CAD výkres.

// Základní barvy a konstanty kreslení.
const PLAN_STROKE = "#5b6472";
const PLAN_WALL = "#41495a";
const PLAN_CHAIR = "#9aa6b8";
const PLAN_GRID = 5;                 // krok přichytávání při posunu prvku
const PLAN_MAX_PIECES = 320;         // pojistka proti extrémně velkému schématu
const PLAN_M2_PER_WPL = 25;          // plocha potřebná na jeden WPL (m²)

// Měřítko schématu: 40 px = 1 metr. Rozměry symbolů jsou proto zadané v metrech
// (`wm` × `hm`) a přepočítávají se na pixely — schéma tak drží reálné proporce
// (stůl 160 cm je zřetelně větší než stůl 120 cm).
const PLAN_PX_PER_M = 40;
const mpx = (m) => Math.round(m * PLAN_PX_PER_M);

// Doplňkové barvy kreslení (nábytek sám má barvu podle segmentu).
const PLAN_WOOD = "#e3c9a3";
const PLAN_WOOD_LINE = "#c9a877";
const PLAN_GLASS = "rgba(150, 214, 232, 0.35)";
const PLAN_GLASS_LINE = "#3f9fb8";
const PLAN_TT = "#4b5563";          // pokladna (TT)
const PLAN_TV = "#2b3240";
const PLAN_PLANT = "#2f9e5f";
const PLAN_SCREEN = "#7c8698";      // paraván

/* --- kreslicí pomůcky (lokální souřadnice symbolu od 0,0) --- */

function planRect(x, y, w, h, fill, opts = {}) {
  return new fabric.Rect({
    left: x, top: y, width: w, height: h, fill,
    stroke: opts.stroke === undefined ? PLAN_STROKE : opts.stroke,
    strokeWidth: opts.strokeWidth === undefined ? 1 : opts.strokeWidth,
    rx: opts.rx || 0, ry: opts.ry || 0, opacity: opts.opacity === undefined ? 1 : opts.opacity,
    strokeDashArray: opts.dash || null,
  });
}

function planCircle(cx, cy, r, fill, stroke, opts = {}) {
  return new fabric.Circle({
    left: cx - r, top: cy - r, radius: r, fill,
    stroke: stroke === undefined ? PLAN_STROKE : stroke,
    strokeWidth: opts.strokeWidth === undefined ? 1.2 : opts.strokeWidth,
    strokeDashArray: opts.dash || null,
  });
}

function planLine(x1, y1, x2, y2, color, width = 1) {
  return new fabric.Line([x1, y1, x2, y2], { stroke: color, strokeWidth: width });
}

function planPath(d, opts = {}) {
  return new fabric.Path(d, {
    fill: opts.fill === undefined ? "" : opts.fill,
    stroke: opts.stroke === undefined ? PLAN_STROKE : opts.stroke,
    strokeWidth: opts.strokeWidth === undefined ? 1.2 : opts.strokeWidth,
    strokeDashArray: opts.dash || null,
    opacity: opts.opacity === undefined ? 1 : opts.opacity,
  });
}

function planText(text, x, y, size = 8, color = "#46505f", opts = {}) {
  return new fabric.Text(text, {
    left: x, top: y, fontSize: size, fill: color,
    fontFamily: "Segoe UI, Arial, sans-serif", fontWeight: opts.bold ? "bold" : "normal",
  });
}

// Židle se sedákem a opěradlem. `dir` je strana opěradla (n/s/e/w), takže je
// v půdorysu vidět, kam člověk kouká.
function planChairDir(cx, cy, size, dir = "n", fill, stroke) {
  const half = size / 2;
  const t = Math.max(2.5, size * 0.24);
  const back = { n: [cx - half, cy - half - t, size, t], s: [cx - half, cy + half, size, t],
    w: [cx - half - t, cy - half, t, size], e: [cx + half, cy - half, t, size] }[dir];
  return [
    planRect(back[0], back[1], back[2], back[3], stroke || PLAN_STROKE, { rx: 2, ry: 2, strokeWidth: 0 }),
    planRect(cx - half, cy - half, size, size, fill || PLAN_CHAIR, { rx: 3, ry: 3, stroke: stroke || PLAN_STROKE }),
  ];
}

// Monitor / počítač na stole.
function planMonitor(cx, cy, w = 15) {
  return [
    planRect(cx - w / 2, cy - 5, w, 9, "#ffffff", { rx: 1.5, ry: 1.5, stroke: PLAN_STROKE }),
    planRect(cx - 3, cy + 4, 6, 2.4, PLAN_STROKE, { strokeWidth: 0 }),
  ];
}

// Pokladna (TT) na pracovišti.
function planTT(cx, cy, w = 14) {
  return [
    planRect(cx - w / 2, cy - 6, w, 11, PLAN_TT, { rx: 2, ry: 2, stroke: PLAN_TT }),
    planRect(cx - w / 2 + 2, cy - 4, w - 4, 4, "#cfd6e0", { strokeWidth: 0 }),
  ];
}

// Půlkruhový stůl — rovná strana u bankéře, oblouk ke klientům.
function planSemiTable(cx, yFlat, r, c) {
  return [planPath(`M ${cx - r} ${yFlat} A ${r} ${r} 0 0 0 ${cx + r} ${yFlat} Z`,
    { fill: c.body, stroke: c.line, strokeWidth: 1.4 })];
}

// Dřevěná podlaha (čekací zóna) — podklad s prkny.
function planWoodFloor(x, y, w, h) {
  const objs = [planRect(x, y, w, h, PLAN_WOOD, { stroke: PLAN_WOOD_LINE, strokeWidth: 1 })];
  for (let i = 1; i < Math.round(w / 12); i++) {
    objs.push(planLine(x + i * 12, y + 1, x + i * 12, y + h - 1, PLAN_WOOD_LINE, 0.6));
  }
  return objs;
}

// Stěny místnosti + dveře s obloukem otevírání.
function planRoomWalls(w, h, opts = {}) {
  const objs = [planRect(0, 0, w, h, opts.fill || "#ffffff",
    { stroke: PLAN_WALL, strokeWidth: 2.2, rx: 2, ry: 2 })];
  if (opts.glass) {
    objs.push(planRect(1, 1, w - 2, h - 2, PLAN_GLASS, { stroke: PLAN_GLASS_LINE, strokeWidth: 1.4, dash: [5, 3] }));
  }
  const d = Math.min(26, h * 0.4);
  objs.push(planRect(0, h - d - 8, 3, d, opts.fill || "#ffffff", { strokeWidth: 0 }));
  objs.push(planPath(`M 3 ${h - d - 8} A ${d} ${d} 0 0 1 ${3 + d} ${h - 8}`,
    { stroke: PLAN_WALL, strokeWidth: 1, opacity: 0.45 }));
  return objs;
}

// Květina v květináči (relax zóna).
function planPlant(cx, cy) {
  return [
    planRect(cx - 5, cy, 10, 8, "#b98b5e", { rx: 1.5, ry: 1.5 }),
    planCircle(cx, cy - 5, 7, PLAN_PLANT, "#1e7a45"),
  ];
}

// Televize na stěně.
function planTV(x, y, w) {
  return [planRect(x, y, w, 4.5, PLAN_TV, { rx: 1, ry: 1, strokeWidth: 0 })];
}

// Nabíječky u stolu — dvě malé značky.
function planChargers(x, y) {
  return [planCircle(x, y, 2, "#f0a020", "#b97a10", { strokeWidth: 0.8 }),
    planCircle(x + 6, y, 2, "#f0a020", "#b97a10", { strokeWidth: 0.8 })];
}

// Pohovka (tři místa) — opěradlo, sedák, dělení.
function planSofa(x, y, w, h, c) {
  const objs = [
    planRect(x, y, w, h * 0.28, c.line, { rx: 4, ry: 4, strokeWidth: 0 }),
    planRect(x, y + h * 0.24, w, h * 0.76, c.body, { rx: 5, ry: 5, stroke: c.line }),
  ];
  [1, 2].forEach((i) => objs.push(planLine(x + (w * i) / 3, y + h * 0.28, x + (w * i) / 3, y + h * 0.95,
    c.line, 0.8)));
  return objs;
}

/* --- katalog symbolů ---------------------------------------------------------
 * `match` se testuje na název prvku bez diakritiky a malými písmeny, první
 * shoda vyhrává (proto je „fast track backoffice“ dřív než „fast track“).
 * `wm`/`hm` je půdorysná velikost v metrech, `draw(w, h, colors)` vrací fabric
 * objekty v lokálních souřadnicích. `colors.body` je světlý odstín barvy
 * segmentu, `colors.line` plná barva segmentu.
 * -------------------------------------------------------------------------- */
const PLAN_SYMBOLS = [
  // ---------- pokladní pracoviště (dřív než obecná „pokladna“) ----------
  {
    key: "cashSafe", match: /pokladna.*(bezpecnostn|nastavb)/, wm: 2.4, hm: 2.2,
    short: "Pokladna s bezpečnostní nástavbou (uzavřená budka)",
    draw: (w, h, c) => [
      // uzavřená budka: pevné stěny, prosklená přepážka ke klientovi a pokladna vevnitř
      planRect(0, 0, w, h, "#ffffff", { stroke: PLAN_WALL, strokeWidth: 3, rx: 2, ry: 2 }),
      planRect(3, 3, w - 6, h * 0.16, PLAN_GLASS, { stroke: PLAN_GLASS_LINE, strokeWidth: 1.4 }),
      planRect(w * 0.16, h * 0.16 + 6, w * 0.68, 3.5, PLAN_TT, { strokeWidth: 0 }),   // průchod peněz
      planRect(w * 0.14, h * 0.42, w * 0.72, h * 0.24, c.body, { rx: 2, ry: 2, strokeWidth: 1.6, stroke: c.line }),
      ...planTT(w * 0.34, h * 0.54),
      ...planMonitor(w * 0.68, h * 0.52, 13),
      ...planChairDir(w * 0.5, h * 0.8, 20, "s"),
      planRect(w * 0.06, h * 0.72, w * 0.16, h * 0.2, PLAN_TT, { rx: 2, ry: 2, stroke: PLAN_TT }),  // trezorek
    ],
  },
  {
    // Jediná varianta se dvěma pracovními místy (2 WPL) → dvě židle pro bankéře.
    key: "cashIslandC2", match: /pokladni ostrov typu c.*2wpl/, wm: 2.6, hm: 1.7,
    short: "Pokladní ostrov C, 2 WPL (dvě židle bankéře, klient stojí)",
    draw: (w, h, c) => planCashIsland(w, h, c, 2),
  },
  {
    key: "cashIslandC", match: /pokladni ostrov typu c/, wm: 2.3, hm: 1.7,
    short: "Pokladní ostrov C (židle bankéře, klient stojí)",
    draw: (w, h, c) => planCashIsland(w, h, c, 1),
  },
  {
    key: "cashIslandHalfC", match: /pokladni ostrov typu 1\/2c/, wm: 1.8, hm: 1.7,
    short: "Pokladní ostrov 1/2C (židle bankéře, klient stojí)",
    draw: (w, h, c) => planCashIsland(w, h, c, 1),
  },
  {
    key: "cash", match: /pokladn/, wm: 2.0, hm: 1.7, short: "Pokladní pracoviště (židle bankéře)",
    draw: (w, h, c) => planCashIsland(w, h, c, 1),
  },

  // ---------- théky a pracoviště na hale ----------
  {
    key: "thekeHigh", match: /theke.*vysok/, wm: 2.6, hm: 2.6,
    short: "Theke vysoká — kulatý pult, 2 židle bankéřů, kulatý koberec",
    draw: (w, h, c) => planRoundTheke(w, h, c, 2),
  },
  {
    key: "thekeLow", match: /theke.*nizk/, wm: 2.1, hm: 2.1,
    short: "Theke nízká — kulatý pult, 1 židle bankéře, kulatý koberec",
    draw: (w, h, c) => planRoundTheke(w, h, c, 1),
  },
  { key: "theke", match: /theke|pult/, wm: 2.2, hm: 2.2, short: "Theke (kulatý pult, koberec)",
    draw: (w, h, c) => planRoundTheke(w, h, c, 1) },
  {
    key: "marticka_tt", match: /marticka.*tt/, wm: 1.9, hm: 2.0, short: "Martička s TT",
    draw: (w, h, c) => [
      planRect(w * 0.1, h * 0.34, w * 0.8, h * 0.3, c.body, { rx: 2, ry: 2, strokeWidth: 1.6, stroke: c.line }),
      ...planTT(w * 0.3, h * 0.49),
      ...planMonitor(w * 0.68, h * 0.46, 14),
      ...planChairDir(w * 0.5, h * 0.14, 19, "n", PLAN_CHAIR),       // bankéř
      ...planChairDir(w * 0.3, h * 0.82, 18, "s"),                    // klienti
      ...planChairDir(w * 0.7, h * 0.82, 18, "s"),
    ],
  },
  {
    key: "marticka", match: /marticka/, wm: 1.9, hm: 2.0, short: "Martička",
    draw: (w, h, c) => [
      planRect(w * 0.1, h * 0.34, w * 0.8, h * 0.3, c.body, { rx: 2, ry: 2, strokeWidth: 1.6, stroke: c.line }),
      ...planMonitor(w * 0.5, h * 0.46, 16),
      ...planChairDir(w * 0.5, h * 0.14, 19, "n", PLAN_CHAIR),
      ...planChairDir(w * 0.3, h * 0.82, 18, "s"),
      ...planChairDir(w * 0.7, h * 0.82, 18, "s"),
    ],
  },
  {
    key: "welcome", match: /lenka vitac|vitaci lenka|recepce/, wm: 2.6, hm: 1.8,
    short: "Vítací lenka (půlkruh s paravánem)",
    draw: (w, h, c) => {
      const cx = w / 2; const r = Math.min(w, h * 1.6) / 2;
      return [
        // paraván jako půlkruh za pultem
        planPath(`M ${cx - r} ${h * 0.78} A ${r} ${r} 0 0 1 ${cx + r} ${h * 0.78}`,
          { stroke: PLAN_SCREEN, strokeWidth: 4, opacity: 0.85 }),
        // půlkruhový pult
        planPath(`M ${cx - r * 0.68} ${h * 0.78} A ${r * 0.68} ${r * 0.68} 0 0 1 ${cx + r * 0.68} ${h * 0.78} Z`,
          { fill: c.body, stroke: c.line, strokeWidth: 1.6 }),
        ...planMonitor(cx, h * 0.6, 14),
        ...planChairDir(cx, h * 0.9, 19, "s"),                        // přísed
      ];
    },
  },
  {
    key: "lenka", match: /lenka/, wm: 2.3, hm: 2.1, short: "Lenka (stůl, bankéř + 2 klienti)",
    draw: (w, h, c) => [
      planRect(w * 0.08, h * 0.36, w * 0.84, h * 0.28, c.body, { rx: 3, ry: 3, strokeWidth: 1.6, stroke: c.line }),
      ...planMonitor(w * 0.5, h * 0.47, 15),
      ...planChairDir(w * 0.5, h * 0.16, 20, "n", PLAN_CHAIR),        // bankéř s počítačem
      ...planChairDir(w * 0.28, h * 0.84, 18, "s"),                   // klient 1
      ...planChairDir(w * 0.72, h * 0.84, 18, "s"),                   // klient 2
    ],
  },
  {
    key: "fastTrackBo", match: /fast\s*track\s*backoffice/, wm: 1.6, hm: 1.5,
    short: "Fast track backoffice (stůl do 120 cm, bez PC)",
    draw: (w, h, c) => [
      planRect(w * 0.1, h * 0.3, mpx(1.2), h * 0.28, c.body, { rx: 2, ry: 2, strokeWidth: 1.4, stroke: c.line }),
      ...planChairDir(w * 0.1 + mpx(0.6), h * 0.78, 20, "s"),
    ],
  },
  {
    key: "fastTrackHall", match: /fast\s*track/, wm: 1.7, hm: 1.7,
    short: "Fast track (stolek a tři přísedy)",
    draw: (w, h, c) => {
      // podle vzoru: kulatý stolek a tři zaoblené přísedy okolo
      const cx = w / 2; const cy = h / 2; const r = Math.min(w, h) * 0.24;
      const objs = [
        planCircle(cx, cy, r, "#ffffff", c.line, { dash: [4, 3] }),
        planCircle(cx, cy, r * 0.34, c.body, c.line),
      ];
      [-90, 30, 150].forEach((deg) => {
        const rad = (deg * Math.PI) / 180;
        const sx = cx + Math.cos(rad) * (r * 1.5) - 11;
        const sy = cy + Math.sin(rad) * (r * 1.5) - 9;
        objs.push(planRect(sx, sy, 22, 18, c.body, { rx: 8, ry: 8, strokeWidth: 1.4, stroke: c.line }));
      });
      return objs;
    },
  },

  // ---------- čekací zóna ----------
  {
    key: "sofa", match: /obyvak/, wm: 2.0, hm: 2.0, short: "Obývák (3 židle + stolek, podlaha 2×2 m)",
    draw: (w, h, c) => [
      ...planWoodFloor(0, 0, w, h),
      planCircle(w / 2, h / 2, mpx(0.28), c.body, c.line),            // stoleček
      ...planChairDir(w / 2, h * 0.2, 18, "n"),
      ...planChairDir(w * 0.22, h * 0.68, 18, "w"),
      ...planChairDir(w * 0.78, h * 0.68, 18, "e"),
    ],
  },
  {
    key: "lounge", match: /lounge/, wm: 3.0, hm: 2.2, short: "Lounge (pohovka, křesla, stolek)",
    draw: (w, h, c) => [
      ...planWoodFloor(0, 0, w, h),
      ...planSofa(w * 0.08, h * 0.1, w * 0.5, h * 0.3, c),
      planCircle(w * 0.34, h * 0.66, mpx(0.3), c.body, c.line),
      ...planChairDir(w * 0.7, h * 0.35, 19, "e"),
      ...planChairDir(w * 0.7, h * 0.72, 19, "e"),
    ],
  },
  {
    key: "chair", match: /cekaci zona \(zidle\)|^zidle/, wm: 0.7, hm: 0.8, short: "Čekací židle u stěny",
    draw: (w, h, c) => [
      planRect(0, 0, w, 3.5, PLAN_SCREEN, { strokeWidth: 0, opacity: 0.7 }),   // stěna
      ...planChairDir(w / 2, h * 0.6, Math.min(w, h) * 0.7, "n", c.body, c.line),
    ],
  },

  // ---------- meeting zone ----------
  {
    key: "meetingRoom", match: /jednaci mistnost/, wm: 3.6, hm: 3.0,
    short: "Jednací místnost (půlkruhový stůl, TV, PC, nabíječky)",
    draw: (w, h, c) => [
      ...planRoomWalls(w, h),
      ...planTV(w * 0.34, 4, w * 0.32),                               // televize na stěně
      ...planSemiTable(w / 2, h * 0.42, mpx(0.85), c),
      ...planMonitor(w * 0.5, h * 0.5, 15),
      ...planChargers(w * 0.5 - 3, h * 0.6),
      ...planChairDir(w * 0.5, h * 0.72, 20, "s", PLAN_CHAIR),        // bankéř
      ...planChairDir(w * 0.3, h * 0.24, 19, "n"),                    // klienti
      ...planChairDir(w * 0.7, h * 0.24, 19, "n"),
      planText("Jednací", 6, h - 13, 7.5, "#6b7482"),
    ],
  },
  {
    key: "semiRoom", match: /semidescreete|semi discrete|semidiskret/, wm: 2.7, hm: 2.4,
    short: "Semidescreete room (malý půlkruhový stůl)",
    draw: (w, h, c) => [
      ...planRoomWalls(w, h),
      ...planSemiTable(w / 2, h * 0.44, mpx(0.6), c),
      ...planChairDir(w * 0.5, h * 0.7, 19, "s", PLAN_CHAIR),
      ...planChairDir(w * 0.32, h * 0.26, 18, "n"),
      ...planChairDir(w * 0.68, h * 0.26, 18, "n"),
      planText("Semi", 6, h - 12, 7, "#6b7482"),
    ],
  },
  {
    key: "remoteRoom", match: /remote\s*room/, wm: 2.0, hm: 2.0,
    short: "Remote room (skleněná budka, židle, stolek, TV s AI avatarem)",
    draw: (w, h, c) => [
      ...planRoomWalls(w, h, { glass: true }),
      ...planTV(w * 0.3, 5, w * 0.4),
      planCircle(w * 0.5, 9, 3.4, "#7fd3ea", PLAN_TV, { strokeWidth: 0.8 }),   // AI avatar na obrazovce
      planRect(w * 0.36, h * 0.48, w * 0.28, h * 0.14, c.body, { rx: 2, ry: 2, stroke: c.line }),
      ...planChairDir(w * 0.5, h * 0.74, 19, "s"),
      planText("AI", w * 0.5 - 4, 14, 6, "#123", { bold: true }),
    ],
  },
  {
    key: "flexBox", match: /flex\s*box/, wm: 1.9, hm: 1.9, short: "Flex box (skleněná budka)",
    draw: (w, h, c) => [
      ...planRoomWalls(w, h, { glass: true }),
      planRect(w * 0.34, h * 0.42, w * 0.32, h * 0.16, c.body, { rx: 2, ry: 2, stroke: c.line }),
      ...planChairDir(w * 0.5, h * 0.26, 17, "n"),
      ...planChairDir(w * 0.5, h * 0.74, 17, "s"),
    ],
  },
  {
    key: "zaliv", match: /zaliv/, wm: 2.5, hm: 2.1, short: "Záliv (polouzavřené místo s paravány)",
    draw: (w, h, c) => [
      planPath(`M 2 ${h - 4} L 2 6 L ${w - 2} 6 L ${w - 2} ${h - 4}`,
        { stroke: PLAN_SCREEN, strokeWidth: 4, opacity: 0.85 }),
      planRect(w * 0.22, h * 0.4, w * 0.56, h * 0.24, c.body, { rx: 2, ry: 2, stroke: c.line }),
      ...planMonitor(w * 0.5, h * 0.5, 14),
      ...planChairDir(w * 0.5, h * 0.22, 18, "n", PLAN_CHAIR),
      ...planChairDir(w * 0.36, h * 0.78, 18, "s"),
      ...planChairDir(w * 0.64, h * 0.78, 18, "s"),
    ],
  },

  // ---------- backoffice / kancelář ----------
  {
    key: "officeRoom", match: /^kancelar$|kancelar mistnost|^kancelar /, wm: 2.9, hm: 2.5,
    short: "Kancelář (místnost, pracovní stůl, PC, židle)",
    draw: (w, h, c) => [
      ...planRoomWalls(w, h),
      planRect(w * 0.16, h * 0.24, mpx(1.6), h * 0.26, c.body, { rx: 2, ry: 2, strokeWidth: 1.4, stroke: c.line }),
      ...planMonitor(w * 0.16 + mpx(0.8), h * 0.36, 15),
      ...planChairDir(w * 0.16 + mpx(0.8), h * 0.64, 20, "s"),
      planText("Kancelář", 6, h - 13, 7.5, "#6b7482"),
    ],
  },
  {
    key: "deskWork", match: /kancelarske misto/, wm: 2.0, hm: 1.7,
    short: "Kancelářské místo (stůl 160 cm s PC)",
    draw: (w, h, c) => [
      planRect(w * 0.06, h * 0.28, mpx(1.6), h * 0.3, c.body, { rx: 2, ry: 2, strokeWidth: 1.4, stroke: c.line }),
      ...planMonitor(w * 0.06 + mpx(0.8), h * 0.42, 16),
      ...planChairDir(w * 0.06 + mpx(0.8), h * 0.76, 20, "s"),
    ],
  },
  {
    key: "internalSmall", match: /interni zasedaci mistnost - mal/, wm: 4.8, hm: 3.4,
    short: "Interní zasedačka malá (stůl do 12 židlí)",
    draw: (w, h, c) => planInternalMeeting(w, h, c, 5),
  },
  {
    key: "internalBig", match: /interni zasedaci mistnost - velk/, wm: 6.2, hm: 4.0,
    short: "Interní zasedačka velká (stůl nad 13 židlí)",
    draw: (w, h, c) => planInternalMeeting(w, h, c, 7),
  },
  {
    key: "internal", match: /zasedaci mistnost/, wm: 4.8, hm: 3.4, short: "Interní zasedačka",
    draw: (w, h, c) => planInternalMeeting(w, h, c, 5),
  },
  {
    key: "relax", match: /relax/, wm: 3.2, hm: 2.5, short: "Relax zóna (pohovka, květina, tapeta)",
    draw: (w, h, c) => {
      const objs = planRoomWalls(w, h, { fill: "#fdf6ee" });
      // tapeta na stěně — jemný vzor
      for (let i = 1; i < 8; i++) {
        objs.push(planLine(4 + i * ((w - 8) / 8), 3, 4 + i * ((w - 8) / 8) - 6, h - 4, "#e6d3c0", 0.7));
      }
      objs.push(...planSofa(w * 0.12, h * 0.3, w * 0.46, h * 0.34, c));
      objs.push(planCircle(w * 0.7, h * 0.52, mpx(0.3), c.body, c.line));
      objs.push(...planPlant(w * 0.86, h * 0.62));
      objs.push(planText("Relax", 6, h - 13, 7.5, "#8a6a4d"));
      return objs;
    },
  },

  // ---------- ostatní ----------
  {
    key: "generic", match: /.*/, wm: 1.9, hm: 1.5, short: null,
    draw: (w, h, c) => [
      planRect(0, h * 0.2, w, h * 0.6, c.body, { rx: 3, ry: 3, strokeWidth: 1.4, stroke: c.line }),
    ],
  },
];

// Kulatý pult (théka) podle skutečné podoby: vnější kruh pultu, vnitřní kruh
// pracovní plochy a přísedy okolo. Vysoká théka je větší než nízká.
// Kulatá théka: kulatý koberec, prstenec pultu a uvnitř místa pro bankéře
// (nízká 1 židle, vysoká 2 židle). Klienti u théky stojí, židle pro ně nejsou.
function planRoundTheke(w, h, c, bankers) {
  const cx = w / 2; const cy = h / 2;
  const rCarpet = Math.min(w, h) / 2 - 1;
  const r = rCarpet * 0.74;                       // prstenec pultu
  const objs = [
    // kulatý koberec pod thékou
    planCircle(cx, cy, rCarpet, "#efe6da", "#d8c9b6", { strokeWidth: 1.2, dash: [4, 3] }),
    planCircle(cx, cy, r, c.body, c.line, { strokeWidth: 2 }),           // pult
    planCircle(cx, cy, r * 0.66, "#ffffff", c.line, { strokeWidth: 1 }),  // vnitřní pracovní plocha
  ];
  const chair = 17;
  if (bankers <= 1) {
    objs.push(...planMonitor(cx, cy - r * 0.34, 12));
    objs.push(...planChairDir(cx, cy + r * 0.18, chair, "n", PLAN_CHAIR));
  } else {
    for (let i = 0; i < bankers; i++) {
      const dx = (i === 0 ? -1 : 1) * r * 0.3;
      objs.push(...planMonitor(cx + dx, cy - r * 0.36, 11));
      objs.push(...planChairDir(cx + dx, cy + r * 0.2, chair, "n", PLAN_CHAIR));
    }
  }
  return objs;
}

// Pokladní pracoviště: pult s pokladnou (TT) a židlí pro bankéře, klient stojí
// před pultem (žádná klientská židle). `bankers` = počet pracovních míst.
function planCashIsland(w, h, c, bankers) {
  const objs = [
    planRect(0, h * 0.24, w, h * 0.36, c.body, { rx: 3, ry: 3, strokeWidth: 1.6, stroke: c.line }),
    planRect(0, h * 0.18, w, 4, PLAN_GLASS, { stroke: PLAN_GLASS_LINE, strokeWidth: 1 }),  // přepážka
  ];
  for (let i = 0; i < bankers; i++) {
    const cxp = bankers === 1 ? w * 0.5 : w * (i === 0 ? 0.28 : 0.72);
    objs.push(...planTT(cxp - 12, h * 0.4, 13));
    objs.push(...planMonitor(cxp + 12, h * 0.38, 12));
    objs.push(...planChairDir(cxp, h * 0.78, 20, "s", PLAN_CHAIR));
  }
  return objs;
}

// Interní zasedací místnost: velký hranatý stůl a židle po obou delších stranách
// (plus po jedné na koncích). `perSide` řídí velikost — malá do 12 židlí,
// velká nad 13.
function planInternalMeeting(w, h, c, perSide) {
  const objs = planRoomWalls(w, h);
  const tw = w * 0.6; const th = h * 0.34;
  const tx = (w - tw) / 2; const ty = (h - th) / 2;
  objs.push(planRect(tx, ty, tw, th, c.body, { rx: 3, ry: 3, strokeWidth: 1.6, stroke: c.line }));
  for (let i = 0; i < perSide; i++) {
    const cx = tx + ((i + 0.5) * tw) / perSide;
    objs.push(...planChairDir(cx, ty - 13, 18, "n"));
    objs.push(...planChairDir(cx, ty + th + 13, 18, "s"));
  }
  objs.push(...planChairDir(tx - 13, ty + th / 2, 18, "w"));
  objs.push(...planChairDir(tx + tw + 13, ty + th / 2, 18, "e"));
  objs.push(...planTV(w * 0.4, 4, w * 0.2));
  objs.push(planText(`${perSide * 2 + 2} míst`, 6, h - 13, 7.5, "#6b7482"));
  return objs;
}

function planSymbolFor(furniture) {
  const n = deacc(furniture).toLowerCase();
  const found = PLAN_SYMBOLS.find((s) => s.match.test(n)) || PLAN_SYMBOLS[PLAN_SYMBOLS.length - 1];
  // Rozměry v metrech se přepočtou na pixely jen jednou.
  if (found.w === undefined) { found.w = mpx(found.wm); found.h = mpx(found.hm); }
  return found;
}

/* ------------- Vybavení pobočky (bankomaty, denní místnost, …) -------------- */
// Prvky, které nevyplývají z výpočtu WPL, ale na pobočce jsou a mají být ve
// schématu: samoobslužná zóna s bankomaty, denní místnost pro zaměstnance,
// vyvolávací systém Frontmatic, klientské bezpečnostní schránky a trezory
// v backoffice. Zadávají se zaškrtnutím u sestavení layoutu a ukládají se ke
// kalkulaci (tabulka `layout_extras`).

const ATM_TYPES = ["Výběrový", "Vkladový", "Recyklační", "Transakční", "Příprava"];
const ATM_SHORT = { "Výběrový": "VÝB", "Vkladový": "VKL", "Recyklační": "REC", "Transakční": "TRA", "Příprava": "PŘÍ" };

const LAYOUT_EXTRAS_DEFAULT = { atm: {}, dayRoom: false, frontmatic: false, lockers: false, vaults: 0 };

function getLayoutExtras(calculationKey) {
  const out = { ...LAYOUT_EXTRAS_DEFAULT, atm: {} };
  if (!db || !calculationKey) return out;
  try {
    const row = dbAll("SELECT payload FROM layout_extras WHERE calculation_key = ?", [calculationKey])[0];
    if (!row) return out;
    const saved = JSON.parse(row.payload || "{}");
    return { ...out, ...saved, atm: { ...(saved.atm || {}) } };
  } catch (e) { return out; }
}

function saveLayoutExtras(calculationKey, extras) {
  if (!db || !calculationKey) return;
  dbRun("INSERT OR REPLACE INTO layout_extras (calculation_key, payload) VALUES (?, ?)",
    [calculationKey, JSON.stringify(extras)]);
  persistDatabase();
}

function atmTotal(extras) {
  return ATM_TYPES.reduce((sum, t) => sum + (Number((extras.atm || {})[t]) || 0), 0);
}

// Má vybavení vůbec něco nakresleného?
function extrasCount(extras) {
  return atmTotal(extras) + (extras.dayRoom ? 1 : 0) + (extras.frontmatic ? 1 : 0)
    + (extras.lockers ? 1 : 0) + (Number(extras.vaults) || 0);
}

/* --- symboly vybavení (velikost se u samoobslužné zóny počítá z počtu) --- */

// Bankomat v samoobslužné zóně. Každý zadaný kus je vlastní prvek, takže se
// zóna, oddělená zdí, zaplní přesně tolika bankomaty, kolik je zadáno.
function atmSymbol(type) {
  const key = `atm_${deacc(type).toLowerCase().replace(/\W+/g, "")}`;
  const sym = {
    key, wm: 1.0, hm: 1.1, short: `Bankomat — ${type}`,
    draw: (w, h) => [
      planRect(0, 0, w, h, "#dbe6f5", { stroke: "#2770f0", strokeWidth: 1.6, rx: 3, ry: 3 }),
      planRect(4, 4, w - 8, h * 0.34, "#22303f", { rx: 1.5, ry: 1.5, strokeWidth: 0 }),   // obrazovka
      planRect(7, h * 0.46, w - 14, h * 0.18, "#ffffff", { rx: 1, ry: 1 }),                // klávesnice
      planRect(w * 0.2, h * 0.72, w * 0.6, 5, "#8a94a6", { strokeWidth: 0 }),              // výdej
      planText(ATM_SHORT[type] || String(type).slice(0, 3).toUpperCase(), 5, h * 0.82, 6.5,
        "#1b4fa8", { bold: true }),
    ],
  };
  return extraSymbol(sym);
}

// Denní místnost pro zaměstnance: kuchyňská linka, mikrovlnka, stůl se židlemi,
// televize, květina a koše.
const DAY_ROOM_SYMBOL = {
  key: "dayRoom", wm: 4.0, hm: 3.0, short: "Denní místnost (kuchyňka, stůl, TV)",
  draw: (w, h, c) => {
    const objs = planRoomWalls(w, h, { fill: "#fdfbf5" });
    // kuchyňská linka s dřezem a mikrovlnkou
    objs.push(planRect(6, 8, w * 0.5, mpx(0.6), "#cbd5e1", { stroke: "#94a3b8", strokeWidth: 1.2, rx: 2, ry: 2 }));
    objs.push(planRect(12, 12, 14, 10, "#ffffff", { rx: 1.5, ry: 1.5 }));           // dřez
    objs.push(planRect(34, 11, 20, 13, "#e5e7eb", { rx: 2, ry: 2, stroke: "#94a3b8" })); // mikrovlnka
    objs.push(planRect(37, 14, 12, 7, "#3f4a5a", { rx: 1, ry: 1, strokeWidth: 0 }));
    objs.push(planText("kuchyňka", 8, 8 + mpx(0.6) + 2, 6, "#6b7482"));
    // jídelní stůl se čtyřmi židlemi
    const tx = w * 0.42; const ty = h * 0.45; const tw = mpx(1.2); const th = mpx(0.8);
    objs.push(planRect(tx, ty, tw, th, "#e8d7bd", { stroke: "#b08e63", strokeWidth: 1.4, rx: 3, ry: 3 }));
    objs.push(...planChairDir(tx + tw * 0.3, ty - 12, 17, "n"));
    objs.push(...planChairDir(tx + tw * 0.7, ty - 12, 17, "n"));
    objs.push(...planChairDir(tx + tw * 0.3, ty + th + 12, 17, "s"));
    objs.push(...planChairDir(tx + tw * 0.7, ty + th + 12, 17, "s"));
    // televize, květina, koše
    objs.push(...planTV(w * 0.62, 4, w * 0.3));
    objs.push(...planPlant(w - 16, h - 22));
    objs.push(planRect(8, h - 20, 9, 12, "#93a1b3", { rx: 2, ry: 2 }));
    objs.push(planRect(20, h - 20, 9, 12, "#7ea86f", { rx: 2, ry: 2 }));
    objs.push(planText("koše", 8, h - 7, 5.8, "#6b7482"));
    return objs;
  },
};

// Vyvolávací systém Frontmatic: kiosek s tiskárnou čísel a tabule s čísly.
const FRONTMATIC_SYMBOL = {
  key: "frontmatic", wm: 1.4, hm: 1.5, short: "Frontmatic — vyvolávací systém",
  draw: (w, h) => [
    planRect(w * 0.18, h * 0.22, w * 0.34, h * 0.6, "#3f4a5a", { rx: 3, ry: 3, stroke: "#22303f" }),
    planRect(w * 0.22, h * 0.3, w * 0.26, h * 0.2, "#7fd3ea", { rx: 1.5, ry: 1.5, strokeWidth: 0 }),
    planRect(w * 0.24, h * 0.56, w * 0.22, 4, "#ffffff", { strokeWidth: 0 }),   // výdej lístků
    planRect(w * 0.6, h * 0.16, w * 0.34, h * 0.28, "#22303f", { rx: 2, ry: 2, strokeWidth: 0 }),
    planText("A12", w * 0.66, h * 0.24, 8, "#7ef0a0", { bold: true }),
    planText("B07", w * 0.66, h * 0.33, 7, "#f0d97e"),
  ],
};

// Klientské bezpečnostní schránky v servisní zóně.
const LOCKERS_SYMBOL = {
  key: "lockers", wm: 1.8, hm: 0.8, short: "Bezpečnostní schránky pro klienty",
  draw: (w, h, c) => {
    const objs = [planRect(0, 0, w, h, c.body, { stroke: c.line, strokeWidth: 1.6, rx: 2, ry: 2 })];
    const cols = 6; const rows = 2;
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const bx = 3 + col * ((w - 6) / cols); const by = 3 + r * ((h - 6) / rows);
        objs.push(planRect(bx + 1, by + 1, (w - 6) / cols - 2, (h - 6) / rows - 2, "#ffffff",
          { stroke: c.line, strokeWidth: 0.8, rx: 1, ry: 1 }));
        objs.push(planCircle(bx + (w - 6) / cols - 5, by + (h - 6) / rows / 2, 1.4, c.line, c.line,
          { strokeWidth: 0 }));
      }
    }
    return objs;
  },
};

// Trezor v backoffice.
const VAULT_SYMBOL = {
  key: "vault", wm: 1.0, hm: 1.0, short: "Trezor",
  draw: (w, h) => [
    planRect(0, 0, w, h, "#4b5563", { stroke: "#22303f", strokeWidth: 2, rx: 3, ry: 3 }),
    planRect(5, 5, w - 10, h - 10, "#6b7280", { stroke: "#374151", strokeWidth: 1, rx: 2, ry: 2 }),
    planCircle(w * 0.5, h * 0.5, Math.min(w, h) * 0.16, "#cbd5e1", "#22303f", { strokeWidth: 1.2 }),
    planLine(w * 0.5, h * 0.5 - 6, w * 0.5, h * 0.5 + 6, "#22303f", 1),
    planLine(w * 0.5 - 6, h * 0.5, w * 0.5 + 6, h * 0.5, "#22303f", 1),
  ],
};

function extraSymbol(symbol) {
  if (symbol.w === undefined) { symbol.w = mpx(symbol.wm); symbol.h = mpx(symbol.hm); }
  return symbol;
}

// Z vybavení udělá „virtuální“ prvky, které se přidají do zón schématu.
// Nemají WPL, takže se kreslí vpravo za čerchovanou čárou.
function extrasPieces(extras) {
  const byZone = { service_zone: [], meeting_zone: [], backoffice_zone: [], office_room: [] };
  if (!extras) return byZone;
  const piece = (zone, furniture, symbol, pieces = 1) => {
    byZone[zone].push({ segment: "", furniture, pieces, wplPerPiece: 0, symbol, virtual: true });
  };
  // Bankomaty jdou do samoobslužné zóny — vlastní část servisní zóny oddělená zdí.
  ATM_TYPES.forEach((type) => {
    const n = Number((extras.atm || {})[type]) || 0;
    if (n > 0) {
      byZone.service_zone.push({ segment: "", furniture: `Bankomat — ${type}`, pieces: n,
        wplPerPiece: 0, symbol: atmSymbol(type), virtual: true, selfService: true });
    }
  });
  if (extras.frontmatic) piece("service_zone", "Frontmatic (vyvolávací systém)", extraSymbol(FRONTMATIC_SYMBOL));
  if (extras.lockers) piece("service_zone", "Bezpečnostní schránky (klientské)", extraSymbol(LOCKERS_SYMBOL));
  if (extras.dayRoom) piece("backoffice_zone", "Denní místnost", extraSymbol(DAY_ROOM_SYMBOL));
  const vaults = Number(extras.vaults) || 0;
  if (vaults > 0) piece("backoffice_zone", "Trezor", extraSymbol(VAULT_SYMBOL), vaults);
  return byZone;
}

/* ------------- Přiřazení pracovníků na konkrétní místa ---------------------- */
// Ke každému kusu nábytku lze přiřadit pracovníky z checklistu (pozice s FTE).
// Uloženo v tabulce `layout_staff` (kalkulace + klíč místa + pozice).

function getLayoutStaff(calculationKey) {
  const map = {};
  if (!db || !calculationKey) return map;
  try {
    dbAll("SELECT piece_key, segment, pozice FROM layout_staff WHERE calculation_key = ? ORDER BY id",
      [calculationKey]).forEach((r) => {
      (map[r.piece_key] = map[r.piece_key] || []).push({
        pozice: r.pozice, segment: r.segment, color: getSegmentMeta(r.segment).color,
      });
    });
  } catch (e) { /* starší databáze bez tabulky */ }
  return map;
}

function addLayoutStaff(calculationKey, pieceKey, segment, pozice) {
  if (!db || !calculationKey) return;
  dbRun("INSERT INTO layout_staff (calculation_key, piece_key, segment, pozice) VALUES (?, ?, ?, ?)",
    [calculationKey, pieceKey, segment, pozice]);
  persistDatabase();
}

function removeLayoutStaff(calculationKey, pieceKey, segment, pozice) {
  if (!db || !calculationKey) return;
  dbRun(`DELETE FROM layout_staff WHERE id = (SELECT MAX(id) FROM layout_staff
    WHERE calculation_key = ? AND piece_key = ? AND segment = ? AND pozice = ?)`,
    [calculationKey, pieceKey, segment, pozice]);
  persistDatabase();
}

// Kolik lidí je na pobočce podle checklistu (FTE se zaokrouhlí nahoru na osoby)
// a kolik z nich je už přiřazeno na místo.
function staffRoster(calcResult, staffMap) {
  const assigned = {};
  Object.entries(staffMap || {}).forEach(([key, people]) => {
    people.forEach((x) => {
      const k = `${x.segment}||${x.pozice}`;
      assigned[k] = (assigned[k] || 0) + 1;
    });
  });
  const rows = (calcResult && calcResult.inputRows ? calcResult.inputRows : [])
    .filter((r) => (Number(r.fte) || 0) > 0)
    .map((r) => {
      const k = `${r.segment}||${r.pozice}`;
      const people = Math.max(1, Math.round(Number(r.fte) || 0));
      return { segment: r.segment, pozice: r.pozice, fte: Number(r.fte) || 0,
        people, assigned: assigned[k] || 0, color: getSegmentMeta(r.segment).color };
    });
  return rows;
}

/* --- model schématu: co se má kreslit --- */

// Z řádků layoutu udělá seznam jednotlivých kusů po zónách.
function floorPlanModel(rows, extras) {
  const zones = [];
  const counts = {};
  const extraByZone = extrasPieces(extras);
  let pieces = 0;
  let area = 0;
  ZONES.forEach((zone) => {
    const items = (rows || [])
      .filter((r) => r.zone === zone && Math.round(Number(r.piece_count) || 0) > 0)
      .map((r) => ({
        segment: r.segment, furniture: r.furniture,
        pieces: Math.round(Number(r.piece_count) || 0),
        // WPL prvku na kus — z uloženého layoutu i z formuláře přichází součet
        // za všechny kusy, tady se hodí i podíl na kus.
        wplPerPiece: (Number(r.wpl_assigned) || 0) / Math.max(1, Math.round(Number(r.piece_count) || 0)),
        symbol: planSymbolFor(r.furniture),
      }));
    // Vybavení pobočky (bankomaty, denní místnost, …) se přidá jako další prvky
    // zóny — nemají WPL, takže se kreslí za čerchovanou čárou.
    (extraByZone[zone] || []).forEach((it) => items.push(it));
    if (!items.length) return;
    let zoneWpl = 0;
    items.forEach((it) => {
      pieces += it.pieces;
      zoneWpl += it.wplPerPiece * it.pieces;
      const key = `${it.furniture}||${it.segment}`;
      counts[key] = counts[key] || { furniture: it.furniture, segment: it.segment, zone, pieces: 0,
        wpl: 0, symbol: it.symbol };
      counts[key].pieces += it.pieces;
      counts[key].wpl += it.wplPerPiece * it.pieces;
    });
    // Potřebná plocha místnosti: 25 m² na jeden WPL. Prvky, které se jako WPL
    // nevykazují (fast tracky, čekací zóna, relax), do plochy nevstupují.
    const zoneArea = zoneWpl * PLAN_M2_PER_WPL;
    area += zoneArea;
    zones.push({ zone, items, wpl: zoneWpl, area: zoneArea });
  });
  return { zones, pieces, area, legend: Object.values(counts) };
}

// Formát plochy pro schéma: „62,5 m²“.
function fmtArea(m2) {
  const v = Math.round((Number(m2) || 0) * 10) / 10;
  return `${String(v).replace(".", ",")} m²`;
}

// Výška popisku pod prvkem (celý název prvku). Textbox se láme do šířky prvku,
// takže se výška musí zjistit dopředu — kvůli rozvržení. Výsledky se cachují.
const planLabelCache = {};

const PLAN_LABEL_MIN_W = 58;   // minimální šířka popisku pod prvkem

function planLabelBox(name, w) {
  const width = Math.max(w, PLAN_LABEL_MIN_W);
  return new fabric.Textbox(String(name), {
    width, fontSize: 6.8, lineHeight: 1.1, textAlign: "center",
    fontFamily: "Segoe UI, Arial, sans-serif", fill: "#3d4655",
    splitByGrapheme: false, editable: false,
  });
}

function planLabelHeight(name, w) {
  const key = `${name}|${w}`;
  if (planLabelCache[key] === undefined) planLabelCache[key] = planLabelBox(name, w).height + 3;
  return planLabelCache[key];
}

// Postavička pracovníka přiřazeného na místo.
function planPerson(cx, cy, color, size = 13) {
  const r = size * 0.28;
  return [
    planCircle(cx, cy - size * 0.3, r, color, "#ffffff", { strokeWidth: 1 }),
    planPath(`M ${cx - size * 0.34} ${cy + size * 0.5} A ${size * 0.34} ${size * 0.42} 0 0 1`
      + ` ${cx + size * 0.34} ${cy + size * 0.5} Z`, { fill: color, stroke: "#ffffff", strokeWidth: 1 }),
  ];
}

// Klíč jednoho konkrétního kusu nábytku — pod ním se drží přiřazení pracovníka.
function planPieceKey(zone, segment, furniture, index) {
  return `${zone}||${segment}||${furniture}||${index}`;
}

/* --- rozvržení a vykreslení --- */

const floorPlanState = {};   // suffix -> { canvas, model, width, staff, ... }

// Rozloží prvky do „místností“ (jedna zóna = jedna místnost pod sebou) a vrátí
// celkovou výšku schématu. Prvky s WPL tečou v levé části místnosti, prvky bez
// WPL (fast tracky, čekací zóna, samoobslužná zóna) jsou vpravo za čerchovanou
// čárou — tak je vidět, co se do potřebné plochy nepočítá.
function drawFloorPlanScene(canvas, model, width, options = {}) {
  const pad = 14;             // vnitřní odsazení místnosti
  const gap = 10;             // mezera mezi prvky
  const wall = 6;             // šířka vnější zdi
  const headerH = 22;         // pruh s názvem zóny
  const outerPad = 12;
  const entranceW = 58;       // volné místo u dveří v první místnosti
  const divGap = 20;          // mezera okolo čerchované čáry
  const contentW = width - 2 * (outerPad + wall + pad);
  const staff = options.staff || {};

  canvas.clear();
  canvas.setBackgroundColor(options.background || "#f7f9fc", () => {});

  // rozměr prvku včetně popisku pod ním (popisek může být širší než symbol)
  const pieceH = (item) => item.symbol.h + planLabelHeight(item.furniture, item.symbol.w);
  const pieceW = (item) => Math.max(item.symbol.w, PLAN_LABEL_MIN_W);

  // tok prvků zleva doprava se zalamováním
  const flow = (items, maxW, offsetX) => {
    let x = 0; let y = 0; let lineH = 0;
    const placed = [];
    items.forEach((item) => {
      for (let i = 0; i < item.pieces; i++) {
        const w = pieceW(item); const h = pieceH(item);
        if (x > 0 && x + w > maxW) { x = 0; y += lineH + gap; lineH = 0; }
        placed.push({ item, x: x + offsetX, y, w, h, index: i + 1 });
        x += w + gap;
        lineH = Math.max(lineH, h);
      }
    });
    return { placed, height: y + lineH };
  };

  // rozvržení nasucho — nejdřív se spočítají výšky místností.
  // Zóna se dělí až na tři části: prvky s WPL, prvky bez WPL (za čerchovanou
  // čárou) a samoobslužná zóna s bankomaty (oddělená zdí — černou čárou).
  // Když je samoobslužná zóna, dostane každá část třetinu šířky.
  const plan = model.zones.map((z, zi) => {
    const inset = zi === 0 ? entranceW : 0;   // u vstupu se nekreslí nábytek
    const roomW = contentW - inset;
    const wplItems = z.items.filter((it) => (it.wplPerPiece || 0) > 0);
    const freeItems = z.items.filter((it) => (it.wplPerPiece || 0) <= 0 && !it.selfService);
    const selfItems = z.items.filter((it) => it.selfService);

    let dashX = null;      // čerchovaná čára před prvky bez WPL
    let wallX = null;      // zeď před samoobslužnou zónou
    let cols = [];

    if (selfItems.length) {
      const third = (roomW - divGap * 2) / 3;
      cols = [flow(wplItems, third, inset)];
      if (freeItems.length) {
        cols.push(flow(freeItems, third, inset + third + divGap));
        dashX = inset + third + divGap / 2;
      }
      cols.push(flow(selfItems, third, inset + (third + divGap) * 2));
      wallX = inset + (third + divGap) * 2 - divGap / 2;
    } else if (freeItems.length && wplItems.length) {
      const maxFree = Math.max(...freeItems.map((it) => pieceW(it)));
      const rightW = Math.min(Math.max(maxFree + gap, roomW * 0.3), roomW * 0.5);
      const leftW = roomW - rightW - divGap;
      if (leftW >= 140) {
        cols = [flow(wplItems, leftW, inset), flow(freeItems, rightW, inset + leftW + divGap)];
        dashX = inset + leftW + divGap / 2;
      } else {
        cols = [flow([...wplItems, ...freeItems], roomW, inset)];
      }
    } else {
      cols = [flow(freeItems.length ? freeItems : wplItems, roomW, inset)];
    }

    const placed = cols.flatMap((c) => c.placed);
    return { zone: z.zone, placed, dashX, wallX,
      height: Math.max(...cols.map((c) => c.height), 0) };
  });

  const totalH = outerPad * 2 + wall * 2
    + plan.reduce((s, r) => s + headerH + r.height + pad * 2 + wall, 0);

  // vnější obvod pobočky
  canvas.add(new fabric.Rect({
    left: outerPad, top: outerPad, width: width - 2 * outerPad, height: totalH - 2 * outerPad,
    fill: "#ffffff", stroke: PLAN_WALL, strokeWidth: wall, rx: 4, ry: 4,
    selectable: false, evented: false,
  }));

  let top = outerPad + wall;
  plan.forEach((room, ri) => {
    const roomH = headerH + room.height + pad * 2;
    const color = ZONE_COLORS[room.zone] || "#6b7684";
    const left = outerPad + wall;
    const roomW = width - 2 * (outerPad + wall);

    canvas.add(new fabric.Rect({
      left, top, width: roomW, height: roomH, fill: `${color}0f`,
      stroke: color, strokeWidth: 1.2, selectable: false, evented: false,
    }));
    canvas.add(new fabric.Rect({
      left, top, width: roomW, height: headerH, fill: color,
      selectable: false, evented: false,
    }));
    canvas.add(new fabric.Text(`${ZONE_LABELS[room.zone]}`.toUpperCase(), {
      left: left + 10, top: top + 5, fontSize: 11, fontWeight: "bold",
      fontFamily: "Segoe UI, Arial, sans-serif", fill: "#ffffff",
      selectable: false, evented: false,
    }));
    const zoneModel = model.zones[ri] || {};
    const info = `${room.placed.length} ks · ${fmt1(zoneModel.wpl || 0)} WPL`
      + ` · potřeba ${fmtArea(zoneModel.area || 0)}`;
    const infoText = new fabric.Text(info, {
      left: left + roomW - 10, top: top + 5, fontSize: 11,
      fontFamily: "Segoe UI, Arial, sans-serif", fill: "#ffffff",
      selectable: false, evented: false,
    });
    infoText.set({ left: left + roomW - 10 - infoText.width });
    canvas.add(infoText);

    // čerchovaná čára oddělující prvky bez WPL
    if (room.dashX !== null) {
      canvas.add(new fabric.Line([left + pad + room.dashX, top + headerH + 4,
        left + pad + room.dashX, top + roomH - 4], {
        stroke: "#8a94a6", strokeWidth: 1.2, strokeDashArray: [8, 3, 2, 3],
        selectable: false, evented: false,
      }));
      canvas.add(new fabric.Text("PRVKY BEZ WPL (nepočítají se do plochy)", {
        left: left + pad + room.dashX + 6, top: top + headerH + 4, fontSize: 7,
        fontFamily: "Segoe UI, Arial, sans-serif", fill: "#8a94a6",
        selectable: false, evented: false,
      }));
    }
    // zeď oddělující samoobslužnou zónu (plná černá čára)
    if (room.wallX !== null) {
      canvas.add(new fabric.Line([left + pad + room.wallX, top + headerH,
        left + pad + room.wallX, top + roomH], {
        stroke: "#111820", strokeWidth: 3.4, selectable: false, evented: false,
      }));
      canvas.add(new fabric.Text("SAMOOBSLUŽNÁ SERVISNÍ ZÓNA (oddělená zdí)", {
        left: left + pad + room.wallX + 8, top: top + headerH + 4, fontSize: 7.4, fontWeight: "bold",
        fontFamily: "Segoe UI, Arial, sans-serif", fill: "#111820",
        selectable: false, evented: false,
      }));
    }

    // vstup do pobočky se kreslí u první místnosti (hala)
    if (ri === 0) {
      canvas.add(new fabric.Rect({
        left: outerPad - wall / 2, top: top + roomH / 2 - 26, width: wall * 2, height: 52,
        fill: "#ffffff", selectable: false, evented: false,
      }));
      canvas.add(new fabric.Path(`M ${outerPad + wall} ${top + roomH / 2 - 26}
        A 52 52 0 0 1 ${outerPad + wall + 52} ${top + roomH / 2 + 26}`, {
        fill: "", stroke: color, strokeWidth: 1.2, opacity: 0.65, selectable: false, evented: false,
      }));
      canvas.add(new fabric.Text("VSTUP", {
        left: outerPad + wall + 6, top: top + roomH / 2 + 30, fontSize: 10, fontWeight: "bold",
        fontFamily: "Segoe UI, Arial, sans-serif", fill: color, selectable: false, evented: false,
      }));
    }

    room.placed.forEach((pl) => {
      const meta = getSegmentMeta(pl.item.segment);
      const [tr, tg, tb] = segmentTintRgb(pl.item.segment, 0.55);
      const colors = { body: `rgb(${tr},${tg},${tb})`, line: meta.color };
      const objs = pl.item.symbol.draw(pl.item.symbol.w, pl.item.symbol.h, colors);

      // Barevné označení segmentu: u větších prvků i štítek s klíčem segmentu,
      // aby bylo poznat, komu pracoviště patří, i bez porovnávání odstínů.
      if (pl.w >= 62 && !pl.item.virtual) {
        const chipText = new fabric.Text(pl.item.segment, {
          left: 4, top: 1.5, fontSize: 7, fontWeight: "bold",
          fontFamily: "Segoe UI, Arial, sans-serif", fill: isDarkColor(meta.color) ? "#ffffff" : "#22282f",
        });
        objs.push(new fabric.Rect({
          left: 2, top: 0, width: chipText.width + 5, height: 10, rx: 3, ry: 3,
          fill: meta.color, opacity: 0.9, stroke: null,
        }), chipText);
      }

      // Celý název prvku pod symbolem — ať je hned jasné, o co jde.
      const label = planLabelBox(pl.item.furniture, pl.item.symbol.w);
      label.set({ left: (pl.item.symbol.w - label.width) / 2, top: pl.item.symbol.h + 2 });
      label.setCoords();
      objs.push(label);

      // Přiřazení pracovníků na místo (postavičky s iniciálou pozice).
      const key = planPieceKey(room.zone, pl.item.segment, pl.item.furniture, pl.index);
      const people = staff[key] || [];
      people.forEach((person, pi) => {
        const px = pl.item.symbol.w - 10 - pi * 15;
        const py = pl.item.symbol.h - 11;
        objs.push(...planPerson(px, py, person.color || "#1f6feb", 15));
      });
      if (people.length) {
        objs.push(planRect(0, 0, pl.item.symbol.w, pl.item.symbol.h, "", {
          stroke: "#1f6feb", strokeWidth: 1.2, dash: [4, 2], rx: 3, ry: 3,
        }));
      }

      const group = new fabric.Group(objs, {
        left: left + pad + pl.x, top: top + headerH + pad + pl.y,
        hasControls: false, hasBorders: true, lockRotation: true,
        borderColor: meta.color, cornerColor: meta.color,
        hoverCursor: options.assigning ? "crosshair" : "move",
        lockMovementX: !!options.assigning, lockMovementY: !!options.assigning,
      });
      group.planInfo = {
        furniture: pl.item.furniture, segment: pl.item.segment, zone: room.zone,
        index: pl.index, total: pl.item.pieces, color: meta.color, key,
        people: people.map((x) => x.pozice), virtual: !!pl.item.virtual,
      };
      canvas.add(group);
    });

    top += roomH + wall;
  });

  canvas.setDimensions({ width, height: totalH });
  canvas.requestRenderAll();
  return totalH;
}

// Vykreslí schéma do skrytého canvasu a vrátí PNG (pro PDF a pro export
// obrázku bez ohledu na zoom, ve kterém se uživatel právě dívá).
function floorPlanImage(rows, meta, width = 1120) {
  if (typeof fabric === "undefined") return null;
  const calcKey = (meta && meta.calculation_key) || null;
  const model = floorPlanModel(rows, getLayoutExtras(calcKey));
  if (!model.pieces) return null;
  const staff = getLayoutStaff(calcKey);
  const el = document.createElement("canvas");
  el.style.display = "none";
  document.body.appendChild(el);
  try {
    const canvas = new fabric.StaticCanvas(el, { backgroundColor: "#ffffff" });
    const height = drawFloorPlanScene(canvas, model, width, { staff, background: "#ffffff" });
    const url = canvas.toDataURL({ format: "png", multiplier: 2 });
    canvas.dispose();
    return { url, width, height, model };
  } catch (e) {
    console.error("Schéma pobočky se nepodařilo vykreslit:", e);
    return null;
  } finally {
    el.remove();
  }
}

// Malý náhled symbolu nábytku (PNG dataURL) — používá se jako legenda přímo
// v tabulce nábytku, aby bylo hned vidět, jak se prvek ve schématu kreslí.
// Cachuje se podle klíče symbolu, takže se každý druh kreslí jen jednou.
const planThumbCache = {};

function symbolThumbUrl(furniture, boxW = 140) {
  if (typeof fabric === "undefined") return null;
  const symbol = planSymbolFor(furniture);
  if (planThumbCache[symbol.key]) return planThumbCache[symbol.key];
  const el = document.createElement("canvas");
  el.style.display = "none";
  document.body.appendChild(el);
  try {
    const pad = 6;
    const canvas = new fabric.StaticCanvas(el, { backgroundColor: "#ffffff" });
    const objs = symbol.draw(symbol.w, symbol.h, { body: "#dbe6f5", line: "#2770f0" });
    const group = new fabric.Group(objs, { left: pad, top: pad });
    canvas.setDimensions({ width: symbol.w + pad * 2, height: symbol.h + pad * 2 });
    canvas.add(group);
    canvas.requestRenderAll();
    // Náhled se zvětší/zmenší na jednotnou šířku, ať tabulka nepodskakuje.
    const url = canvas.toDataURL({ format: "png", multiplier: boxW / (symbol.w + pad * 2) * 2 });
    canvas.dispose();
    planThumbCache[symbol.key] = url;
    return url;
  } catch (e) {
    console.warn("Náhled symbolu se nepodařilo vykreslit:", e);
    return null;
  } finally {
    el.remove();
  }
}

// Legenda všech použitých symbolů — rozbalovací blok pod tabulkou nábytku.
function furnitureLegendHtml(rows) {
  if (typeof fabric === "undefined") return "";
  const seen = {};
  (rows || []).forEach((r) => {
    const sym = planSymbolFor(r.furniture);
    if (!seen[sym.key]) seen[sym.key] = { sym, names: [] };
    if (!seen[sym.key].names.includes(r.furniture)) seen[sym.key].names.push(r.furniture);
  });
  const items = Object.values(seen).map((x) => `<figure>
    <img src="${symbolThumbUrl(x.names[0], 180)}" alt="${esc(x.names[0])}">
    <figcaption><strong>${esc(x.names.join(", "))}</strong>${x.sym.short
      ? `<br><span class="muted">${esc(x.sym.short)}</span>` : ""}</figcaption>
  </figure>`).join("");
  return `<details class="cmp-box" style="border-left-color:#2770f0;">
    <summary>Legenda nákresů — jak se prvky kreslí ve schématu pobočky (${Object.keys(seen).length} druhů)</summary>
    <p class="muted">Stejné symboly se používají v části „Schéma pobočky (půdorys)“ u kalkulace.
      Barva je tady jen ukázková — ve schématu má prvek barvu svého segmentu.</p>
    <div class="fn-legend">${items}</div>
  </details>`;
}

// Panel „Vybavení pobočky“ — zaškrtávátka a počty, které se hned promítnou
// do schématu i do uložení ke kalkulaci.
function layoutExtrasHtml(extras, suffix) {
  const atmRows = ATM_TYPES.map((t) => `<label class="ex-atm">
    <span>${esc(t)}</span>
    <input type="number" min="0" step="1" class="ex-atm-input" data-atm="${esc(t)}"
      value="${Number((extras.atm || {})[t]) || 0}">
  </label>`).join("");
  return `<div class="ex-box">
    <h4>Vybavení pobočky ${srcBadgeHtml("ref")}</h4>
    <p class="muted">Prvky, které nevyplývají z výpočtu WPL, ale na pobočce jsou. Co zaškrtnete
      (nebo zadáte počtem), <strong>přikreslí se do schématu</strong> — bankomaty jako samoobslužná
      servisní zóna, denní místnost a trezory do backoffice.</p>
    <div class="ex-grid">
      <div class="ex-card">
        <strong>Bankomaty</strong>
        <span class="muted">Při jednom a více se v service zone přikreslí
          <em>Samoobslužná servisní zóna</em>.</span>
        <div class="ex-atms" id="exAtms${suffix}">${atmRows}</div>
      </div>
      <div class="ex-card">
        <strong>Zaměstnanecké a servisní prvky</strong>
        <label class="ex-check"><input type="checkbox" id="exDayRoom${suffix}"
          ${extras.dayRoom ? "checked" : ""}>
          <span><strong>Denní místnost</strong> — kuchyňka, mikrovlnka, stůl se židlemi, televize,
          květina a koše (backoffice)</span></label>
        <label class="ex-check"><input type="checkbox" id="exFrontmatic${suffix}"
          ${extras.frontmatic ? "checked" : ""}>
          <span><strong>Frontmatic</strong> — vyvolávací systém s čísly (service zone)</span></label>
        <label class="ex-check"><input type="checkbox" id="exLockers${suffix}"
          ${extras.lockers ? "checked" : ""}>
          <span><strong>Bezpečnostní schránky pro klienty</strong> — schránky na úschovu věcí
          (service zone)</span></label>
        <label class="ex-num"><span><strong>Trezory</strong> v backoffice — počet</span>
          <input type="number" min="0" step="1" id="exVaults${suffix}"
            value="${Number(extras.vaults) || 0}"></label>
      </div>
    </div>
  </div>`;
}

// Panel „Lidé na místech“ — pracovníci z checklistu a jejich přiřazení k prvkům.
function layoutStaffHtml(roster, staffMap, suffix, armed) {
  if (!roster.length) {
    return `<div class="st-box"><h4>Lidé na místech</h4>
      <p class="muted">Pro tuto kalkulaci nejsou v checklistu žádné pozice s FTE.</p></div>`;
  }
  const chips = roster.map((r, i) => {
    const free = r.people - r.assigned;
    const isArmed = armed && armed.segment === r.segment && armed.pozice === r.pozice;
    return `<button class="st-chip${isArmed ? " armed" : ""}${free <= 0 ? " done" : ""}"
      data-idx="${i}" style="--seg:${r.color};" ${free <= 0 ? "disabled" : ""}
      title="${esc(r.pozice)} — ${esc(r.segment)}, ${fmt1(r.fte)} FTE">
      <span class="st-dot"></span>${esc(r.pozice)}
      <span class="st-count">${r.assigned}/${r.people}</span></button>`;
  }).join("");

  const assigned = Object.entries(staffMap || {}).flatMap(([key, people]) => people.map((x, i) => {
    const [zone, segment, furniture, index] = key.split("||");
    return `<li><span class="st-dot" style="--seg:${x.color};"></span>
      <strong>${esc(x.pozice)}</strong> → ${esc(furniture)} ${esc(index)}
      <span class="muted">(${ZONE_LABELS[zone] || zone}${segment ? `, ${esc(segment)}` : ""})</span>
      <button class="btn secondary small st-remove" data-key="${esc(key)}" data-pozice="${esc(x.pozice)}"
        data-segment="${esc(x.segment || "")}" title="Odebrat z místa">✕</button></li>`;
  })).join("");

  return `<div class="st-box">
    <h4>Lidé na místech ${srcBadgeHtml("calc")}</h4>
    <p class="muted">Klikněte na pozici a potom na prvek ve schématu — k místu se přiřadí
      postavička. Počet lidí vychází z FTE v checklistu (zaokrouhleno na osoby).</p>
    <div class="st-chips">${chips}</div>
    ${armed ? `<div class="msg">Vyberte ve schématu místo pro <strong>${esc(armed.pozice)}</strong>
      (${esc(armed.segment)}) — nebo klikněte na pozici znovu pro zrušení.</div>` : ""}
    ${assigned ? `<ul class="st-list">${assigned}</ul>`
      : `<p class="muted">Zatím nikdo není přiřazený na konkrétní místo.</p>`}
  </div>`;
}

// Hlavní vstupní bod: vykreslí (nebo překreslí) schéma do daného kontejneru.
// `rows` jsou řádky layoutu — buď uložené, nebo přečtené z formuláře.
function renderFloorPlan(containerId, rows, meta, suffix = "") {
  const container = document.getElementById(containerId);
  if (!container) return;
  const calcKey = (meta && meta.calculation_key) || null;
  const prev = floorPlanState[suffix] || {};
  const extras = getLayoutExtras(calcKey);
  const staffMap = getLayoutStaff(calcKey);
  const roster = staffRoster(meta && meta.calcResult, staffMap);
  const armed = prev.armed || null;
  const model = floorPlanModel(rows, extras);

  const emptyPlan = !model.pieces;
  if (typeof fabric === "undefined") {
    container.innerHTML = `<p class="msg err">Knihovna Fabric.js se nenačetla
      (<code>vendor/fabric.min.js</code>) — schéma nelze nakreslit.</p>`;
    return;
  }

  const cut = model.pieces > PLAN_MAX_PIECES;
  container.innerHTML = `
    ${layoutExtrasHtml(extras, suffix)}
    ${emptyPlan ? `<p class="muted">Zadejte počty nábytkových prvků (nebo vybavení výše) —
        schéma se nakreslí z uloženého layoutu i z rozpracovaného zadání.</p>` : `
    <div class="fp-toolbar">
      <button class="btn secondary small" id="fpRelayout${suffix}"
        title="Vrátí prvky do automatického rozvržení">↺ Přeskládat</button>
      <button class="btn secondary small" id="fpZoomOut${suffix}">−</button>
      <span class="muted fp-zoom" id="fpZoomLabel${suffix}">100 %</span>
      <button class="btn secondary small" id="fpZoomIn${suffix}">+</button>
      <button class="btn secondary small" id="fpPng${suffix}">📷 Uložit jako PNG</button>
      <span class="muted">Celkem <strong>${fmtPieces(model.pieces)}</strong> prvků ·
        potřebná plocha <strong>${fmtArea(model.area)}</strong>
        (${PLAN_M2_PER_WPL} m² na 1 WPL) · prvky lze chytit myší a přesunout.</span>
    </div>
    ${cut ? `<div class="msg warn">Layout obsahuje ${fmtPieces(model.pieces)} prvků — schéma kreslí
      prvních ${PLAN_MAX_PIECES}, aby zůstalo čitelné.</div>` : ""}
    <div class="fp-wrap" id="fpWrap${suffix}"><canvas id="fpCanvas${suffix}"></canvas>
      <div class="fp-tip" id="fpTip${suffix}"></div></div>
    ${layoutStaffHtml(roster, staffMap, suffix, armed)}
    <p class="muted">Schéma je <strong>návrh rozmístění</strong> — zóny jsou nakreslené jako místnosti
      pod sebou v pořadí service → meeting → backoffice → office room a v nich je přesný počet zadaných
      prvků s celým názvem pod symbolem. Prvky mají reálné proporce (měřítko 1 m = ${PLAN_PX_PER_M} px),
      skutečné rozvržení pobočky určuje projektant. <strong>Potřebná velikost místnosti</strong> se
      počítá jako <strong>${PLAN_M2_PER_WPL} m² na 1 WPL</strong>; prvky, které se jako WPL nevykazují
      (fast tracky, čekací zóna, relax zóna, vybavení), jsou <strong>vpravo za čerchovanou čárou</strong>
      a plochu nezvětšují. Barva výplně a obrysu prvku i štítek v jeho rohu ukazují
      <strong>segment</strong>, kterému pracoviště patří.</p>`}`;

  // ---- vybavení pobočky: změna se hned uloží a schéma se překreslí ----
  const redraw = () => renderFloorPlan(containerId, rows, meta, suffix);
  const collectExtras = () => {
    const atm = {};
    container.querySelectorAll(`#exAtms${suffix} .ex-atm-input`).forEach((inp) => {
      const n = parseInt(inp.value, 10) || 0;
      if (n > 0) atm[inp.dataset.atm] = n;
    });
    return {
      atm,
      dayRoom: container.querySelector(`#exDayRoom${suffix}`).checked,
      frontmatic: container.querySelector(`#exFrontmatic${suffix}`).checked,
      lockers: container.querySelector(`#exLockers${suffix}`).checked,
      vaults: parseInt(container.querySelector(`#exVaults${suffix}`).value, 10) || 0,
    };
  };
  const onExtrasChange = () => {
    if (!calcKey) { toast("Vybavení se ukládá až ke spočítané kalkulaci.", "warn"); return; }
    saveLayoutExtras(calcKey, collectExtras());
    redraw();
  };
  container.querySelectorAll(`.ex-box input`).forEach((inp) => {
    inp.addEventListener("change", onExtrasChange);
  });

  if (emptyPlan) return;

  const wrap = document.getElementById(`fpWrap${suffix}`);
  const width = Math.max(720, Math.min(1180, (wrap.clientWidth || 960) - 4));
  const canvas = new fabric.Canvas(`fpCanvas${suffix}`, {
    selection: false, preserveObjectStacking: true, backgroundColor: "#f7f9fc",
  });

  if (cut) {
    let left = PLAN_MAX_PIECES;
    model.zones.forEach((z) => z.items.forEach((it) => {
      const take = Math.max(0, Math.min(it.pieces, left));
      left -= take;
      it.pieces = take;
    }));
    model.zones.forEach((z) => { z.items = z.items.filter((it) => it.pieces > 0); });
    model.zones = model.zones.filter((z) => z.items.length);
  }

  const baseH = drawFloorPlanScene(canvas, model, width, { staff: staffMap, assigning: !!armed });
  floorPlanState[suffix] = { canvas, model, width, baseH, zoom: prev.zoom || 1, armed, staffMap, calcKey };

  // přichytávání k mřížce při posunu
  canvas.on("object:moving", (e) => {
    const o = e.target;
    o.set({ left: Math.round(o.left / PLAN_GRID) * PLAN_GRID, top: Math.round(o.top / PLAN_GRID) * PLAN_GRID });
  });

  // bublina s názvem prvku pod kurzorem
  const tip = document.getElementById(`fpTip${suffix}`);
  canvas.on("mouse:over", (e) => {
    const info = e.target && e.target.planInfo;
    if (!info) { tip.style.display = "none"; return; }
    tip.innerHTML = `<strong>${esc(info.furniture)}</strong> ${esc(info.index)}/${esc(info.total)}<br>`
      + `${info.segment ? `${esc(info.segment)} · ` : ""}${ZONE_LABELS[info.zone]}`
      + (info.people && info.people.length ? `<br>👤 ${info.people.map(esc).join(", ")}` : "")
      + (armed ? `<br><em>klikněte pro přiřazení</em>` : "");
    tip.style.borderColor = info.color;
    tip.style.display = "block";
  });
  canvas.on("mouse:move", (e) => {
    if (tip.style.display !== "block" || !e.pointer) return;
    tip.style.left = `${Math.min(e.pointer.x + 14, width - 200)}px`;
    tip.style.top = `${e.pointer.y + 14}px`;
  });
  canvas.on("mouse:out", () => { tip.style.display = "none"; });

  // ---- přiřazení pracovníka na místo ----
  canvas.on("mouse:down", (e) => {
    const st = floorPlanState[suffix];
    if (!st.armed || !e.target || !e.target.planInfo) return;
    addLayoutStaff(calcKey, e.target.planInfo.key, st.armed.segment, st.armed.pozice);
    st.armed = null;
    redraw();
  });
  container.querySelectorAll(".st-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const st = floorPlanState[suffix];
      const r = roster[Number(btn.dataset.idx)];
      const same = st.armed && st.armed.segment === r.segment && st.armed.pozice === r.pozice;
      st.armed = same ? null : { segment: r.segment, pozice: r.pozice };
      redraw();
    });
  });
  container.querySelectorAll(".st-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      removeLayoutStaff(calcKey, btn.dataset.key, btn.dataset.segment, btn.dataset.pozice);
      redraw();
    });
  });

  const applyZoom = (z) => {
    const st = floorPlanState[suffix];
    st.zoom = Math.max(0.5, Math.min(2, z));
    canvas.setZoom(st.zoom);
    canvas.setDimensions({ width: st.width * st.zoom, height: st.baseH * st.zoom });
    document.getElementById(`fpZoomLabel${suffix}`).textContent = `${Math.round(st.zoom * 100)} %`;
    canvas.requestRenderAll();
  };
  if ((prev.zoom || 1) !== 1) applyZoom(prev.zoom);
  document.getElementById(`fpZoomIn${suffix}`).addEventListener("click",
    () => applyZoom(floorPlanState[suffix].zoom + 0.15));
  document.getElementById(`fpZoomOut${suffix}`).addEventListener("click",
    () => applyZoom(floorPlanState[suffix].zoom - 0.15));
  document.getElementById(`fpRelayout${suffix}`).addEventListener("click", () => {
    const st = floorPlanState[suffix];
    st.baseH = drawFloorPlanScene(canvas, st.model, st.width, { staff: st.staffMap, assigning: !!st.armed });
    applyZoom(st.zoom);
  });
  document.getElementById(`fpPng${suffix}`).addEventListener("click", () => {
    const st = floorPlanState[suffix];
    const url = canvas.toDataURL({ format: "png", multiplier: 2 / (st.zoom || 1) });
    const a = document.createElement("a");
    a.href = url;
    a.download = `schema_pobocky_${meta && meta.pobocka_nazev ? deacc(meta.pobocka_nazev).replace(/\s+/g, "_") : "layout"}.png`;
    a.click();
    toast("Schéma bylo uloženo jako PNG.", "ok");
  });
}

function renderLayoutReadonly(container, rows, meta, segmentRows) {
  const bySegZone = {};
  const order = [];
  rows.forEach((r) => {
    const key = `${r.segment}||${r.zone}`;
    if (!bySegZone[key]) { bySegZone[key] = { segment: r.segment, zone: r.zone, calculated_wpl: r.calculated_wpl, items: [] }; order.push(key); }
    bySegZone[key].items.push(r);
  });
  const groupsHtml = order.map((key) => {
    const g = bySegZone[key];
    const itemsHtml = g.items.map((it) => `<li>${esc(it.furniture)} — ${fmt1(it.piece_count)} ks
      ${it.wpl_assigned > 0 ? `(WPL: ${fmt1(it.wpl_assigned)})` : '<span class="muted">(nepočítá se jako WPL)</span>'}</li>`).join("");
    return `<div class="layout-group">
      <h4>${segmentBadgeHtml(g.segment)} — ${ZONE_LABELS[g.zone] || g.zone} <span class="muted">(potřeba WPL: ${fmt1(g.calculated_wpl)})</span></h4>
      <ul>${itemsHtml}</ul>
    </div>`;
  }).join("");

  const overview = computeWplOverview(segmentRows, rows, meta.calcResult?.celkem);
  const suffix = meta.pdfOptionsSuffix || "";
  container.innerHTML = `
    <div class="layout-group">${renderWplOverviewHtml(overview)}</div>
    ${groupsHtml}
    ${renderZoneAnalysisHtml(overview, rows)}
    ${renderPositionFurnitureHtml(meta.calcResult, rows)}
    <div class="layout-actions saved">
      <button class="btn big secondary" id="btnEditLayout">✎ Upravit layout</button>
      <span class="muted">Layout je uložený ke kalkulaci. Úpravou se otevře formulář s počty kusů —
        po změně nezapomeňte znovu uložit.</span>
    </div>
    ${capacityCheckHtmlFor(meta, rows)}
    <div class="fp-panel">
      <h4>Schéma pobočky (půdorys) ${srcBadgeHtml("calc")}</h4>
      <p class="muted">Uložený layout nakreslený jako půdorys — zóny jsou místnosti a v nich je přesný
        počet zadaných nábytkových prvků.</p>
      <div id="floorPlanArea${suffix}"></div>
    </div>
    <p class="muted">Generování PDF, kopírování do schránky a potvrzení kalkulace najdete v části
      <strong>„Výstup a sestava“</strong> na konci.</p>`;
  renderFloorPlan(`floorPlanArea${suffix}`, rows, meta, suffix);
  // Hledání v rámci `container` — viz poznámka v renderLayoutForm().
  container.querySelector("#btnEditLayout").addEventListener("click", () => renderLayoutForm(container, segmentRows, meta, rows));
}

// Vykreslí kompletní přehled WPL po zónách a segmentech (stejná čísla jako
// tabulka v aplikaci) a vrátí novou souřadnici y.
function drawWplOverviewPdf(pdf, startY, overview, marginX, pageBottom, color) {
  let y = startY;
  const headers = ["Segment", "FTE", ...ZONES.map((z) => ZONE_LABELS_SHORT[z]), "WPL celkem", "WPL/FTE"];
  const colW = [30, 12, 19, 19, 22, 22, 21, 19];
  const rowH = 6.6;

  // setFillColor/setTextColor se volají znovu před každou buňkou — jsPDF si
  // barvy drží ve společné cache, takže prokládané rect()/text() by je jinak rozjelo.
  const drawHeader = () => {
    pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(7.6);
    let x = marginX;
    headers.forEach((h, i) => {
      pdf.setFillColor(39, 112, 240);
      pdf.rect(x, y, colW[i], rowH, "FD");
      pdf.setTextColor(255, 255, 255);
      pdf.text(h, x + 1.6, y + 4.5);
      x += colW[i];
    });
    y += rowH;
    pdf.setTextColor(0, 0, 0);
  };

  const drawRow = (r, isTotal) => {
    if (y + rowH > pageBottom) { pdf.addPage(); y = 18; drawHeader(); }
    pdf.setFont("DejaVuSans", isTotal ? "bold" : "normal"); pdf.setFontSize(7.6);
    const pctText = (r.wplPerFtePct === null || r.wplPerFtePct === undefined || Number.isNaN(r.wplPerFtePct))
      ? "—" : `${r.wplPerFtePct.toFixed(1)} %`;
    const vals = [
      r.segment, fmt1(r.fte),
      ...ZONES.map((z) => overview.hasLayout ? `${fmt1(r.zones[z])} / ${fmt1(r.assignedZones[z])}` : fmt1(r.zones[z])),
      overview.hasLayout ? `${fmt1(r.wplTotal)} / ${fmt1(r.assignedTotal)}` : fmt1(r.wplTotal),
      pctText,
    ];
    let x = marginX;
    vals.forEach((v, i) => {
      let cellFilled = isTotal;
      if (isTotal) pdf.setFillColor(200, 240, 210);
      else if (i === 0) { pdf.setFillColor(...segmentTintRgb(v)); cellFilled = true; }
      pdf.rect(x, y, colW[i], rowH, cellFilled ? "FD" : "D");
      pdf.setTextColor(0, 0, 0);
      let textX = x + 1.6;
      if (i === 0 && !isTotal) {
        const [cr, cg, cb] = hexToRgb(getSegmentMeta(v).color);
        pdf.setFillColor(cr, cg, cb);
        pdf.rect(x + 1.6, y + 1.9, 2.6, 2.6, "F");
        textX += 4;
      }
      pdf.text(String(v), textX, y + 4.5, { maxWidth: colW[i] - 3 });
      x += colW[i];
    });
    y += rowH;
  };

  y = drawPdfSectionTitle(pdf, y, "Kompletní přehled WPL po zónách a segmentech", color,
    { need: 40, marginX, pageBottom, space: 0 });
  drawHeader();
  overview.rows.forEach((r) => drawRow(r, false));
  drawRow(overview.total, true);
  y += 5;
  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(7.5);
  pdf.setTextColor(120, 120, 120);
  const legend = overview.hasLayout
    ? "U zón je uvedena potřeba WPL z kalkulace / skutečně přiřazené WPL ze sestaveného layoutu."
    : "Uvedena je potřeba WPL z kalkulace.";
  pdf.splitTextToSize(`${legend} Sloupec WPL/FTE udává, na kolik FTE dané WPL vychází — celkem i za každý segment zvlášť.`, 182)
    .forEach((l) => { pdf.text(l, marginX, y); y += 4.2; });
  pdf.setTextColor(0, 0, 0);
  return y + 5;
}

/* --------------------- 3. kapitola: Layout pobočky ------------------------- */
// Šedý blok s detaily → kompletní přehled WPL po zónách a segmentech →
// kompaktní výpis nábytku → analýza segmentů, zón a jejich prvků.
function drawLayoutChapterPdf(pdf, startY, rows, meta, segmentRows, opt, chapter) {
  const marginX = PDF_MARGIN_X;
  const pageBottom = PDF_PAGE_BOTTOM;
  const color = chapter.color;
  let y = startY;

  if (opt.layoutDetailBox) {
    y = drawPdfDetailBox(pdf, y, [
      `Název pobočky: ${meta.pobocka_nazev || ""}`,
      `ID pobočky: ${meta.pobocka_id || ""}`,
      `Calculation key: ${meta.calculation_key || ""}`,
      `Přiřazeno prvků: ${rows.length} · datum vytvoření: ${new Date().toLocaleString("cs-CZ")}`,
    ], marginX, pageBottom);
    y += 3;
  }

  if (opt.layoutOverview && segmentRows && segmentRows.length) {
    y = drawWplOverviewPdf(pdf, y, computeWplOverview(segmentRows, rows, meta.calcResult?.celkem),
      marginX, pageBottom, color);
  }

  if (opt.layoutFurniture) {
    const byZone = {};
    rows.forEach((r) => { (byZone[r.zone] = byZone[r.zone] || []).push(r); });
    const zonesWithRows = ZONES.filter((z) => (byZone[z] || []).length);
    if (zonesWithRows.length) {
      y = drawPdfSectionTitle(pdf, y, "Seznam nábytku po zónách a segmentech", color, { need: 30 });
      // Kompaktní výpis: každý segment je jeden zalomený odstavec, prvky
      // oddělené „·“ — dřív měl každý prvek vlastní řádek a výpis zabíral
      // několik stránek.
      zonesWithRows.forEach((zone) => {
        const zoneRows = byZone[zone];
        const totalPieces = zoneRows.reduce((sum, r) => sum + r.piece_count, 0);
        const totalWpl = zoneRows.reduce((sum, r) => sum + r.wpl_assigned, 0);
        if (y + 12 > pageBottom) { pdf.addPage(); y = 18; }
        y += 1.5;
        pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(9.4);
        pdf.text(`${ZONE_LABELS[zone]} — ${totalPieces} ks, WPL ${fmt1(totalWpl)}`, marginX, y);
        y += 4.8;

        const bySegment = {};
        const segOrder = [];
        zoneRows.forEach((r) => {
          if (!bySegment[r.segment]) { bySegment[r.segment] = []; segOrder.push(r.segment); }
          bySegment[r.segment].push(r);
        });
        segOrder.forEach((segment) => {
          const items = bySegment[segment].map((it) => `${it.furniture} ${fmtPieces(it.piece_count)} ks`
            + (it.wpl_assigned > 0 ? ` (${fmt1(it.wpl_assigned)} WPL)` : " (bez WPL)")).join(" · ");
          const label = `${segment}: `;
          pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(8);
          const labelW = pdf.getTextWidth(label);
          pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(8);
          const lines = pdf.splitTextToSize(items, PDF_CONTENT_W - labelW - 4);
          lines.forEach((line, i) => {
            if (y + 4.6 > pageBottom) { pdf.addPage(); y = 18; }
            if (i === 0) {
              const [sr, sg, sb] = hexToRgb(getSegmentMeta(segment).color);
              pdf.setFillColor(sr, sg, sb);
              pdf.rect(marginX, y - 2.4, 2.2, 2.2, "F");
              pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(8);
              pdf.text(label, marginX + 3.4, y);
            }
            pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(8);
            pdf.text(line, marginX + 3.4 + labelW, y);
            y += 4.4;
          });
        });
        y += 2;
      });
      y += 2;
    }
  }

  // Analýza segmentů, zón a jejich prvků — stejná tabulka jako v aplikaci.
  if (opt.layoutAnalysis && segmentRows && segmentRows.length) {
    y = drawZoneAnalysisPdf(pdf, y, computeWplOverview(segmentRows, rows, meta.calcResult?.celkem),
      rows, marginX, pageBottom, color);
  }

  // Schéma pobočky (půdorys) jako obrázek — vykreslí se do skrytého canvasu
  // Fabricem a vloží se na celou šířku stránky.
  if (opt.layoutFloorPlan) {
    y = drawFloorPlanPdf(pdf, y, rows, meta, marginX, pageBottom, color);
  }

  return y;
}

// Schéma pobočky do PDF. Obrázek se vejde na stránku vždy — když je vysoký,
// začne na nové stránce a případně se zmenší na dostupnou výšku.
function drawFloorPlanPdf(pdf, startY, rows, meta, marginX, pageBottom, color) {
  const img = floorPlanImage(rows, meta);
  if (!img) return startY;
  let y = drawPdfSectionTitle(pdf, startY, "Schéma pobočky (půdorys)", color, { need: 40 });

  const maxW = PDF_CONTENT_W;
  let w = maxW;
  let h = (img.height / img.width) * w;
  const roomOnPage = pageBottom - y;
  const fullPage = pageBottom - 18;
  if (h > roomOnPage) {
    if (h > fullPage || roomOnPage < fullPage * 0.6) { pdf.addPage(); y = 18; }
    const avail = pageBottom - y;
    if (h > avail) { const k = avail / h; h = avail; w = maxW * k; }
  }
  pdf.addImage(img.url, "PNG", marginX + (maxW - w) / 2, y, w, h);
  y += h + 3;

  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(7.6);
  pdf.setTextColor(107, 116, 130);
  const note = `Zóny jsou nakreslené jako místnosti, v nich je přesný počet prvků z layoutu.`
    + ` Potřebná plocha vychází z ${PLAN_M2_PER_WPL} m² na 1 WPL`
    + ` (prvky bez WPL — fast tracky, čekací zóna, relax — do plochy nevstupují).`
    + ` Celkem ${img.model.pieces} prvků, potřeba ${fmtArea(img.model.area)}.`;
  pdf.splitTextToSize(note, PDF_CONTENT_W).forEach((line) => {
    if (y + 4 > pageBottom) { pdf.addPage(); y = 18; }
    pdf.text(line, marginX, y); y += 3.6;
  });
  pdf.setTextColor(0, 0, 0);
  return y + 2;
}

// Analýza segmentů, zón a jejich prvků do PDF. jsPDF neumí sloučené buňky,
// takže se segment a zóna vypisují jen na prvním řádku skupiny — čte se to
// stejně jako sloučená tabulka v aplikaci.
function drawZoneAnalysisPdf(pdf, startY, overview, layoutRows, marginX, pageBottom, color) {
  const byKey = {};
  (layoutRows || []).forEach((r) => { (byKey[`${r.segment}||${r.zone}`] = byKey[`${r.segment}||${r.zone}`] || []).push(r); });

  const tableRows = [];
  overview.rows.forEach((segRow) => {
    const zones = ZONES.filter((z) => (byKey[`${segRow.segment}||${z}`] || []).length > 0 || segRow.zones[z] > 0);
    if (!zones.length) return;
    let segCell = `${segRow.segment}\nFTE ${fmt1(segRow.fte)} · WPL ${fmt1(segRow.wplTotal)}`;
    zones.forEach((z) => {
      const items = byKey[`${segRow.segment}||${z}`] || [];
      const list = items.length ? items : [null];
      list.forEach((it, i) => {
        const zoneCell = i === 0
          ? `${ZONE_LABELS[z]}\npotřeba ${fmt1(segRow.zones[z])} · přiřazeno ${fmt1(segRow.assignedZones[z])}`
          : "";
        const perPiece = it && it.piece_count > 0 ? it.wpl_assigned / it.piece_count : 0;
        tableRows.push({
          vals: it
            ? [segCell, zoneCell, it.furniture, fmtPieces(it.piece_count),
              perPiece > 0 ? fmt1(perPiece) : "—", fmt1(it.wpl_assigned)]
            : [segCell, zoneCell, "Do této zóny nebyl přiřazen žádný nábytek.", "—", "—", "0.0"],
          cellFills: segCell ? { 0: segmentTintRgb(segRow.segment) } : null,
        });
        segCell = "";
      });
    });
    tableRows.push({
      vals: [`Celkem ${segRow.segment}`, "", "", fmtPieces(segRow.piecesTotal), "", fmt1(segRow.assignedTotal)],
      variant: "subtotal", cellFills: { 0: segmentTintRgb(segRow.segment, 0.7) },
    });
  });
  if (!tableRows.length) return startY;

  tableRows.push({
    vals: ["Celkem za pobočku", "", "", fmtPieces(overview.total.piecesTotal), "", fmt1(overview.total.assignedTotal)],
    variant: "total",
  });

  let y = drawPdfSectionTitle(pdf, startY, "Analýza segmentů, zón a jejich prvků", color,
    { need: 40, marginX, pageBottom });
  y = drawPdfSimpleTable(pdf, {
    x: marginX, y,
    headers: ["Segment", "Zóna", "Nábytkový prvek", "Počet ks", "WPL / kus", "WPL přiřazeno"],
    colW: [30, 40, 54, 16, 18, 24],
    align: [null, null, null, "right", "right", "right"],
    rows: tableRows, fontSize: 7.2, pageBottom,
  });
  return y + 5;
}

/* ------------------------------ Historie ---------------------------------- */

function czechCalcCount(n) {
  if (n === 1) return "1 kalkulace";
  if (n >= 2 && n <= 4) return `${n} kalkulace`;
  return `${n} kalkulací`;
}

// Historie kalkulací je dvouúrovňová: nejprve přehled poboček (aby bylo hned
// vidět, kde už proběhlo víc kalkulací a co se s pobočkou v čase dělo), po
// kliknutí na pobočku se zobrazí seznam jejích kalkulací.
function renderHistoryList() {
  const branchListEl = document.getElementById("historyBranchList");
  const calcListEl = document.getElementById("historyCalcList");
  calcListEl.style.display = "none";
  branchListEl.style.display = "block";
  if (!db) { branchListEl.innerHTML = `<p class="muted">Nejprve připojte databázi.</p>`; return; }

  const branches = dbAll(`
    SELECT el.pobocka_id AS pobocka_id, el.pobocka_nazev AS pobocka_nazev,
           COUNT(DISTINCT c.calculation_key) AS pocet, MAX(c.created_at) AS posledni
    FROM calculations c
    JOIN excel_loads el ON el.load_key = c.load_key
    GROUP BY el.pobocka_id, el.pobocka_nazev
    ORDER BY posledni DESC`);
  if (!branches.length) { branchListEl.innerHTML = `<p class="muted">Zatím žádné uložené kalkulace.</p>`; return; }

  branchListEl.innerHTML = branches.map((b) => `
    <div class="branch-item" data-pobocka-id="${esc(b.pobocka_id)}" data-pobocka-nazev="${esc(b.pobocka_nazev)}">
      <div><strong>${esc(b.pobocka_nazev)}</strong> <span class="muted">(ID ${esc(b.pobocka_id)})</span><br>
        <span class="muted">${czechCalcCount(b.pocet)} · naposledy ${new Date(b.posledni).toLocaleString("cs-CZ")}</span></div>
      <div class="muted">▸</div>
    </div>`).join("");

  branchListEl.querySelectorAll(".branch-item").forEach((item) => {
    item.addEventListener("click", () => showBranchCalculations(item.dataset.pobockaId, item.dataset.pobockaNazev));
  });
}

function showBranchCalculations(pobockaId, pobockaNazev) {
  const calcs = dbAll(`
    SELECT c.calculation_key AS calculation_key, c.load_key AS load_key, MIN(c.created_at) AS created_at,
           MAX(c.status) AS status, MAX(c.duvod) AS duvod
    FROM calculations c
    JOIN excel_loads el ON el.load_key = c.load_key
    WHERE el.pobocka_id = ?
    GROUP BY c.calculation_key
    ORDER BY created_at DESC`, [pobockaId]);

  const el = document.getElementById("historyCalcList");
  el.innerHTML = `
    <button class="btn secondary small" id="btnBackToBranches">← Zpět na přehled poboček</button>
    <h3 style="margin-top:14px;">${esc(pobockaNazev)} (ID ${esc(pobockaId)}) — ${czechCalcCount(calcs.length)}</h3>
    ${calcs.map((c) => `<div class="history-item${c.status === "potvrzena" ? " confirmed" : ""}"
      data-calc="${esc(c.calculation_key)}" data-load="${esc(c.load_key)}">
      <div><span class="muted">${new Date(c.created_at).toLocaleString("cs-CZ")}</span>
        ${c.duvod ? `<span class="muted"> · ${esc(c.duvod)}</span>` : ""} ${statusBadgeHtml(c.status)}</div>
      <div class="key">${esc(c.calculation_key)}</div>
    </div>`).join("")}`;

  el.querySelectorAll(".history-item").forEach((item) => {
    item.addEventListener("click", () => showHistoryDetail(item.dataset.calc, item.dataset.load));
  });
  document.getElementById("btnBackToBranches").addEventListener("click", renderHistoryList);

  document.getElementById("historyBranchList").style.display = "none";
  el.style.display = "block";
}

// Smazání kalkulace z UI. Maže se všechno, co ke kalkulaci patří (výsledek,
// layout, uložené ukazatele i snapshot návštěvnosti). Vstupní data z checklistu
// (`excel_loads`) zůstávají, pokud je používá ještě jiná kalkulace — jinak se
// smažou také, aby v databázi nezůstávaly osiřelé nahrávky.
function deleteCalculation(calculationKey, loadKey) {
  if (!requireDb()) return false;
  const counts = {
    layout: dbAll("SELECT COUNT(*) AS n FROM layouts WHERE calculation_key = ?", [calculationKey])[0].n,
    rows: dbAll("SELECT COUNT(*) AS n FROM calculations WHERE calculation_key = ?", [calculationKey])[0].n,
  };
  const otherCalcs = loadKey
    ? dbAll("SELECT COUNT(DISTINCT calculation_key) AS n FROM calculations WHERE load_key = ? AND calculation_key <> ?",
      [loadKey, calculationKey])[0].n
    : 1;
  const msg = `Smazat kalkulaci ${calculationKey}?\n\n`
    + `Smaže se ${counts.rows} řádků výsledku, ${counts.layout} řádků layoutu, uložené ukazatele`
    + ` i snapshot návštěvnosti.`
    + (otherCalcs === 0 ? "\nSmažou se i vstupní data z checklistu — žádná jiná kalkulace je nepoužívá." : "")
    + "\n\nTuto akci nelze vzít zpět.";
  if (!confirm(msg)) return false;

  dbRun("DELETE FROM calculations WHERE calculation_key = ?", [calculationKey]);
  dbRun("DELETE FROM layouts WHERE calculation_key = ?", [calculationKey]);
  dbRun("DELETE FROM calculation_stats WHERE calculation_key = ?", [calculationKey]);
  dbRun("DELETE FROM calculation_visitor WHERE calculation_key = ?", [calculationKey]);
  dbRun("DELETE FROM layout_extras WHERE calculation_key = ?", [calculationKey]);
  dbRun("DELETE FROM layout_staff WHERE calculation_key = ?", [calculationKey]);
  if (loadKey && otherCalcs === 0) {
    dbRun("DELETE FROM excel_loads WHERE load_key = ?", [loadKey]);
    dbRun("DELETE FROM catchment_selection WHERE load_key = ?", [loadKey]);
  }
  persistDatabase(true);
  toast(`Kalkulace ${calculationKey} byla smazána.`, "ok");
  return true;
}

function showHistoryDetail(calculationKey, loadKey) {
  const panel = document.getElementById("historyDetailPanel");
  panel.style.display = "block";
  const inputRows = dbAll(`SELECT segment, pozice, fte, wpl_load, created_at, source_branch
    FROM excel_loads WHERE load_key = ? ORDER BY id`, [loadKey]);
  const resultRows = dbAll(`SELECT segment, total_positions, position_list, service_zone, meeting_zone,
    backoffice_zone, office_room, created_at, ref_version_id, duvod FROM calculations WHERE calculation_key = ?
    ORDER BY (segment = 'Celkem'), id`, [calculationKey]);
  const branch = dbAll("SELECT pobocka_id, pobocka_nazev, oteviraci_doba FROM excel_loads WHERE load_key = ? LIMIT 1", [loadKey])[0];
  const loadHours = (inputRows.find((r) => String(r.segment).trim().toUpperCase() !== "CESTOVNÍ") || {}).wpl_load
    ?? branch?.oteviraci_doba;
  const shiftMode = shiftModeOfLoad(loadKey, branch?.oteviraci_doba, loadHours);

  const refVersionIdForSplit = dbAll("SELECT ref_version_id FROM calculations WHERE calculation_key = ? LIMIT 1",
    [calculationKey])[0]?.ref_version_id;
  const inputSplits = dotaceSplitMap(refVersionIdForSplit);
  const inputHtml = inputRows.map((r) => `<tr${r.source_branch ? ' class="cm-taken-row"' : ""}>
    <td>${segmentBadgeHtml(r.segment)}</td>
    <td>${esc(r.pozice)}${r.source_branch
      ? ` <span class="src-badge src-catchment" title="Převzato ze spádové pobočky">${esc(r.source_branch)}</span>`
      : ""}</td>
    <td>${fmt1(r.fte)}</td><td>${fmt1(r.wpl_load)}</td>
    <td>${zoneSplitBarHtml(inputSplits[`${r.segment}||${r.pozice}`])}</td></tr>`).join("");
  const resultHtml = resultRows.map((r) => resultRowHtml(r, r.segment === "Celkem")).join("");
  const found = resultRows.find((r) => r.segment === "Celkem");
  const refVersionId = resultRows[0] ? resultRows[0].ref_version_id : null;
  const createdAt = resultRows[0] ? resultRows[0].created_at : nowIso();
  const rowsNoTotal = resultRows.filter((r) => r.segment !== "Celkem");
  const mappedInputRows = inputRows.map((r) => ({ segment: r.segment, pozice: r.pozice, fte: r.fte,
    wpl_load: r.wpl_load, source_branch: r.source_branch || null }));
  const stats = computeCalculationStats({ rows: rowsNoTotal, celkem: found || {}, inputRows: mappedInputRows });
  const status = getCalculationStatus(calculationKey);
  const visitor = getVisitorForCalculation(calculationKey, branch?.pobocka_id, branch?.pobocka_nazev);

  // Stejná data kalkulace se použijí pro kontrolní variantu bez nepřítomnosti,
  // pro samostatný PDF export i pro spojenou sestavu (kalkulace + layout).
  const calcResult = {
    calculation_key: calculationKey, load_key: loadKey,
    createdAt, rows: rowsNoTotal, celkem: found || {},
    inputRows: mappedInputRows,
    warnings: [], pobocka_id: branch?.pobocka_id, pobocka_nazev: branch?.pobocka_nazev,
    oteviraci_doba: branch?.oteviraci_doba, refVersionId,
    doba_vytezeni_wpl: loadHours, shiftMode,
    duvod: resultRows[0] ? resultRows[0].duvod : null,
  };

  document.getElementById("historyDetail").innerHTML = `
    ${srcLegendHtml()}
    <p class="muted">${branch ? `${esc(branch.pobocka_nazev)} (ID ${esc(branch.pobocka_id)}) · otevírací doba ${esc(branch.oteviraci_doba)} h/týden` : ""}</p>
    <p>Load key: <code>${esc(loadKey)}</code><br>Calculation key: <code>${esc(calculationKey)}</code></p>
    ${resultRows[0] && resultRows[0].duvod ? `<p class="muted">Důvod kalkulace: <strong>${esc(resultRows[0].duvod)}</strong></p>` : ""}
    <div class="status-row">${statusBadgeHtml(status)}${shiftBadgeHtml(shiftMode)}
      <span class="muted">stav se přepíná na konci, v části „Výstup a sestava“</span>
      <button class="btn danger small" id="btnDeleteCalc"
        title="Smaže kalkulaci včetně layoutu a uložených ukazatelů">🗑 Smazat kalkulaci</button></div>
    ${shiftInfoHtml(branch?.oteviraci_doba, loadHours, shiftMode)}
    ${branchProfileHtml(branchProfile(branch?.pobocka_id, branch?.pobocka_nazev), { quiet: true })}
    <h3>Vstupní data z checklistu ${srcBadgeHtml("calc")}</h3>
    ${zoneLegendHtml()}
    <div class="table-wrap"><table><thead><tr><th>Segment</th><th>Pozice</th><th>FTE</th><th>Vytížení WPL</th>
      <th>Vytížení zón</th></tr></thead>
    <tbody>${inputHtml}</tbody></table></div>
    ${renderFteComparisonHtml(compareFteWithSpecialists(
      mappedInputRows.filter((r) => !r.source_branch), branch?.pobocka_id, branch?.pobocka_nazev),
      { quiet: true })}
    ${catchmentSummaryHtml(loadKey, branch?.pobocka_id, branch?.pobocka_nazev)}
    <h3>Výsledek kalkulace ${srcBadgeHtml("calc")}${calcResultHelpHtml(calcResult)}</h3>
    <div class="table-wrap"><table><thead><tr><th>Segment</th><th>FTE celkem</th><th>Pozice (FTE)</th>
      <th>Service zone</th><th>Meeting zone</th><th>Backoffice zone</th><th>Office room</th></tr></thead>
      <tbody>${resultHtml}</tbody></table></div>
    ${refVersionDetailsHtml(refVersionId)}
    ${renderStatsSection(stats)}
    ${renderYearCapacityHtml(computeYearCapacity({ stats, visitor, calcResult }))}
    ${noAbsenceVariantHtml(calcResult)}
    ${visitor ? renderVisitorSectionHtml(visitor, { stats, inputRows: mappedInputRows })
      : renderVisitorMissingHtml(branch?.pobocka_nazev, branch?.pobocka_id)}
    <h3 style="margin-top:22px;">Sestavení layoutu ${srcBadgeHtml("calc")}${layoutRulesHelpHtml()}</h3>
    <div id="historyLayoutArea"></div>
    <h3 style="margin-top:22px;">Výstup a sestava</h3>
    <div id="historyOutputArea"></div>`;

  const historyMeta = {
    calculation_key: calculationKey, pobocka_id: branch?.pobocka_id, pobocka_nazev: branch?.pobocka_nazev, stats,
    calcResult, pdfOptionsSuffix: "History",
  };
  renderLayoutSection("historyLayoutArea", rowsNoTotal, historyMeta);

  renderOutputSection("historyOutputArea", "History", {
    result: calcResult, stats, visitor, meta: historyMeta, segmentRows: rowsNoTotal,
    onStatusChange: () => { showHistoryDetail(calculationKey, loadKey); renderHistoryList(); },
  });

  document.getElementById("btnDeleteCalc").addEventListener("click", () => {
    if (!deleteCalculation(calculationKey, loadKey)) return;
    document.getElementById("historyDetailPanel").style.display = "none";
    renderHistoryList();
  });

  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ------------------------ Verzování referenčních dat ----------------------- */

function snapshotRefData() {
  const absence = dbAll("SELECT segment, nepritomnost, homeoffice FROM absence ORDER BY segment")
    .map((r) => [r.segment, r.nepritomnost, r.homeoffice]);
  // Podíl fast tracku je sedmý prvek — starší verze ho nemají, čtecí kód s tím počítá.
  const dotace = dbAll(`SELECT segment, pozice, service_zone, meeting_zone, backoffice_zone, office_room,
    fasttrack_share FROM casove_dotace ORDER BY segment, pozice`)
    .map((r) => [r.segment, r.pozice, r.service_zone, r.meeting_zone, r.backoffice_zone, r.office_room,
      r.fasttrack_share || 0]);
  // Nábytkové prvky jsou také referenční data — určují, co lze v layoutu přiřadit
  // a kolik WPL jeden kus pokryje, takže se verzují stejně jako absence a dotace.
  const furniture = dbAll("SELECT segment, zone, furniture, wpl_counter FROM furniture_to_zone ORDER BY segment, zone, furniture")
    .map((r) => [r.segment, r.zone, r.furniture, r.wpl_counter]);
  return { absence, dotace, furniture };
}

// Zajistí, že poslední uložená verze referenčních dat odpovídá aktuálnímu stavu
// tabulek absence/casove_dotace — pokud se liší (nebo žádná verze ještě neexistuje),
// vytvoří novou. Vrací id verze, která je (nebo právě byla) aktuální — použije se
// při uložení kalkulace, aby bylo možné zpětně dohledat, s jakými referenčními
// daty byla spočítána.
function ensureRefVersionUpToDate(noteIfNew) {
  const snap = snapshotRefData();
  const absenceJson = JSON.stringify(snap.absence);
  const dotaceJson = JSON.stringify(snap.dotace);
  const furnitureJson = JSON.stringify(snap.furniture);
  const latest = dbAll("SELECT id, absence_json, dotace_json, furniture_json FROM ref_data_versions ORDER BY id DESC LIMIT 1")[0];
  if (latest && latest.absence_json === absenceJson && latest.dotace_json === dotaceJson
    && (latest.furniture_json || furnitureJson) === furnitureJson) {
    return latest.id;
  }
  db.run("INSERT INTO ref_data_versions (created_at, note, absence_json, dotace_json, furniture_json) VALUES (?, ?, ?, ?, ?)",
    [nowIso(), noteIfNew || "Změna referenčních dat", absenceJson, dotaceJson, furnitureJson]);
  return dbAll("SELECT last_insert_rowid() AS id")[0].id;
}

function listRefVersions() {
  return dbAll("SELECT id, created_at, note FROM ref_data_versions ORDER BY id DESC");
}

function getRefVersionById(id) {
  const row = dbAll("SELECT id, created_at, note, absence_json, dotace_json, furniture_json FROM ref_data_versions WHERE id = ?", [id])[0];
  if (!row) return null;
  return {
    id: row.id, created_at: row.created_at, note: row.note,
    absence: JSON.parse(row.absence_json), dotace: JSON.parse(row.dotace_json),
    // Verze uložené před zavedením verzování nábytku ho neobsahují.
    furniture: row.furniture_json ? JSON.parse(row.furniture_json) : null,
  };
}

function renderReadonlyAbsenceTable(rows) {
  const body = rows.map(([segment, nepritomnost, homeoffice]) => `<tr>
    <td>${esc(segment)}</td><td>${fmt1(nepritomnost)}</td><td>${fmt1(homeoffice)}</td>
  </tr>`).join("");
  return `<div class="table-wrap"><table>
    <thead><tr><th>Segment</th><th>Nepřítomnost (%)</th><th>Homeoffice (%)</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

function renderReadonlyDotaceTable(rows) {
  const body = rows.map(([segment, pozice, s, m, b, o, ft]) => `<tr>
    <td>${esc(segment)}</td><td>${esc(pozice)}</td><td>${fmt1(s)}</td><td>${fmt1(m)}</td><td>${fmt1(b)}</td><td>${fmt1(o)}</td>
    <td>${ft === undefined ? '<span class="muted">—</span>' : fmt1(ft)}</td>
  </tr>`).join("");
  return `<div class="table-wrap"><table>
    <thead><tr><th>Segment</th><th>Pozice</th><th>ServiceZ %</th><th>MeetingZ %</th><th>BackofficeZ %</th>
      <th>OfficeRoom %</th><th title="Podíl backoffice času na Fast tracku backoffice">Fast track %</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

// Nábytek je v detailu verze schovaný v rozbalovacím bloku — řádků je hodně
// (přes 100), takže by jinak přehled verze zahltil.
function renderReadonlyFurnitureTable(rows) {
  if (!rows) {
    return `<p class="muted">Tato verze vznikla ještě před zavedením verzování nábytkových prvků,
      proto jejich stav neobsahuje.</p>`;
  }
  const body = rows.map(([segment, zone, furniture, wpl]) => `<tr>
    <td>${segmentBadgeHtml(segment)}</td><td>${esc(ZONE_LABELS[zone] || zone)}</td>
    <td>${esc(furniture)}</td><td>${fmt1(wpl)}</td>
  </tr>`).join("");
  return `<details><summary style="cursor:pointer; color:var(--muted);">Nábytkové prvky
      (${rows.length}) — rozbalit</summary>
    <div class="table-wrap" style="margin-top:8px;"><table>
    <thead><tr><th>Segment</th><th>Zóna</th><th>Nábytek</th><th>WPL / kus</th></tr></thead>
    <tbody>${body}</tbody></table></div></details>`;
}

function renderRefVersionsList() {
  const el = document.getElementById("refVersionsList");
  if (!db) { el.innerHTML = `<p class="muted">Nejprve připojte databázi.</p>`; return; }
  const versions = listRefVersions();
  if (!versions.length) { el.innerHTML = `<p class="muted">Zatím žádné uložené verze.</p>`; return; }
  el.innerHTML = versions.map((v) => `<div class="history-item" data-ver="${v.id}">
      <div><strong>Verze #${v.id}</strong> — ${esc(v.note)}<br><span class="muted">${new Date(v.created_at).toLocaleString("cs-CZ")}</span></div>
    </div>`).join("");
  el.querySelectorAll(".history-item").forEach((item) => {
    item.addEventListener("click", () => showRefVersionDetail(Number(item.dataset.ver)));
  });
}

function showRefVersionDetail(id) {
  const version = getRefVersionById(id);
  const panel = document.getElementById("refVersionDetail");
  if (!version) { panel.style.display = "none"; return; }
  panel.style.display = "block";
  panel.innerHTML = `
    <h3>Verze #${version.id} — ${esc(version.note)} (${new Date(version.created_at).toLocaleString("cs-CZ")})</h3>
    <h3>Absence po segmentech</h3>
    ${renderReadonlyAbsenceTable(version.absence)}
    <h3>Časové dotace pozic</h3>
    ${renderReadonlyDotaceTable(version.dotace)}
    <h3>Nábytkové prvky</h3>
    ${renderReadonlyFurnitureTable(version.furniture)}`;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ------------- Přehled dat (segmenty, pozice, nábytek) v popupu ------------ */
// Textové shrnutí toho, co je v databázi — k rychlému nahlédnutí i k odeslání
// do MS Teams (formátovaná tabulka) nebo jako čistý text.

function dataOverviewModel() {
  const segments = dbAll("SELECT segment_key, nazev, sort_order, color, icon FROM segments ORDER BY sort_order, segment_key");
  const positions = dbAll(`SELECT segment, pozice, service_zone, meeting_zone, backoffice_zone, office_room
    FROM casove_dotace ORDER BY segment, id`);
  const furniture = dbAll("SELECT segment, zone, furniture, wpl_counter FROM furniture_to_zone ORDER BY segment, zone, id");
  const absence = dbAll("SELECT segment, nepritomnost, homeoffice FROM absence ORDER BY segment");
  const version = dbAll("SELECT MAX(id) AS id FROM ref_data_versions")[0];
  const bySeg = {};
  segments.forEach((sg) => { bySeg[sg.segment_key] = { positions: [], zones: {} }; });
  const ensure = (seg) => { if (!bySeg[seg]) bySeg[seg] = { positions: [], zones: {} }; return bySeg[seg]; };
  positions.forEach((r) => ensure(r.segment).positions.push(r));
  furniture.forEach((r) => {
    const z = ensure(r.segment).zones;
    (z[r.zone] = z[r.zone] || []).push(r);
  });
  return { segments, positions, furniture, absence, bySeg, versionId: version ? version.id : null };
}

function dataOverviewHtml(model) {
  const zoneList = (zones) => ZONES.filter((z) => (zones[z] || []).length).map((z) =>
    `<li><strong>${esc(ZONE_LABELS[z])}</strong> (${zones[z].length}): ${zones[z]
      .map((f) => `${esc(f.furniture)}${f.wpl_counter > 0 ? ` <span class="muted">${fmt1(f.wpl_counter)} WPL</span>`
        : ' <span class="muted">bez WPL</span>'}`).join(" · ")}</li>`).join("");

  const segBlocks = model.segments.map((sg) => {
    const d = model.bySeg[sg.segment_key] || { positions: [], zones: {} };
    const abs = model.absence.find((a) => a.segment === sg.segment_key);
    const poz = d.positions.length
      ? `<li><strong>Pozice</strong> (${d.positions.length}): ${d.positions.map((pz) => {
        const parts = ZONES.filter((z) => (pz[z] || 0) > 0)
          .map((z) => `${ZONE_LABELS_SHORT[z]} ${fmt1(pz[z])} %`).join(", ");
        return `${esc(pz.pozice)}${parts ? ` <span class="muted">(${esc(parts)})</span>` : ""}`;
      }).join(" · ")}</li>`
      : `<li class="muted">Žádné pozice.</li>`;
    const nab = zoneList(d.zones) || `<li class="muted">Žádný nábytek.</li>`;
    return `<div class="ovw-seg">
      <h4>${segmentBadgeHtml(sg.segment_key)} ${esc(sg.nazev || sg.segment_key)}
        <span class="muted">pořadí ${sg.sort_order ?? "—"}${abs
          ? ` · nepřítomnost ${fmt1(abs.nepritomnost)} % + homeoffice ${fmt1(abs.homeoffice)} %` : ""}</span></h4>
      <ul>${poz}${nab}</ul>
    </div>`;
  }).join("");

  return `<p class="muted">Stav databáze${model.versionId ? ` — referenční data verze #${model.versionId}` : ""}:
    <strong>${model.segments.length}</strong> segmentů, <strong>${model.positions.length}</strong> pozic,
    <strong>${model.furniture.length}</strong> nábytkových prvků.</p>${segBlocks}`;
}

// Text pro schránku (čistý text) — stejná struktura jako popup.
function dataOverviewText(model) {
  const lines = [`Přehled dat kalkulátoru FTE → WPL`
    + `${model.versionId ? ` (referenční data verze #${model.versionId})` : ""}`,
  `Segmentů: ${model.segments.length} · pozic: ${model.positions.length}`
    + ` · nábytkových prvků: ${model.furniture.length}`, ""];
  model.segments.forEach((sg) => {
    const d = model.bySeg[sg.segment_key] || { positions: [], zones: {} };
    const abs = model.absence.find((a) => a.segment === sg.segment_key);
    lines.push(`== ${sg.segment_key}${sg.nazev && sg.nazev !== sg.segment_key ? ` (${sg.nazev})` : ""}`
      + `${abs ? ` — nepřítomnost ${fmt1(abs.nepritomnost)} %, homeoffice ${fmt1(abs.homeoffice)} %` : ""}`);
    lines.push(`Pozice (${d.positions.length}):`);
    d.positions.forEach((pz) => {
      const parts = ZONES.filter((z) => (pz[z] || 0) > 0).map((z) => `${ZONE_LABELS_SHORT[z]} ${fmt1(pz[z])} %`).join(", ");
      lines.push(`  - ${pz.pozice}${parts ? ` (${parts})` : ""}`);
    });
    ZONES.filter((z) => (d.zones[z] || []).length).forEach((z) => {
      lines.push(`Nábytek — ${ZONE_LABELS[z]} (${d.zones[z].length}):`);
      d.zones[z].forEach((f) => lines.push(`  - ${f.furniture}`
        + `${f.wpl_counter > 0 ? ` (${fmt1(f.wpl_counter)} WPL/kus)` : " (bez WPL)"}`));
    });
    lines.push("");
  });
  return lines.join("\n");
}

// Formátovaná tabulka pro MS Teams / Word / Excel: jeden řádek = jeden prvek.
function dataOverviewClipboardHtml(model) {
  const T = "border:1px solid #c9ced6; padding:5px 8px;";
  const head = `<tr style="background:#eef2f7;">${["Segment", "Druh", "Název", "Detail"]
    .map((h) => `<th style="${T} text-align:left; font-weight:bold;">${esc(h)}</th>`).join("")}</tr>`;
  const rows = [];
  model.segments.forEach((sg) => {
    const d = model.bySeg[sg.segment_key] || { positions: [], zones: {} };
    const meta = getSegmentMeta(sg.segment_key);
    const abs = model.absence.find((a) => a.segment === sg.segment_key);
    const cell = (v, extra = "") => `<td style="${T}${extra}">${esc(v)}</td>`;
    rows.push(`<tr><td style="${T} background:${meta.color}22;"><strong>${esc(sg.segment_key)}</strong></td>`
      + cell("Segment") + cell(sg.nazev || sg.segment_key)
      + cell(abs ? `nepřítomnost ${fmt1(abs.nepritomnost)} %, homeoffice ${fmt1(abs.homeoffice)} %` : "") + "</tr>");
    d.positions.forEach((pz) => {
      const parts = ZONES.filter((z) => (pz[z] || 0) > 0).map((z) => `${ZONE_LABELS_SHORT[z]} ${fmt1(pz[z])} %`).join(", ");
      rows.push(`<tr>${cell(sg.segment_key)}${cell("Pozice")}${cell(pz.pozice)}${cell(parts)}</tr>`);
    });
    ZONES.forEach((z) => (d.zones[z] || []).forEach((f) => {
      rows.push(`<tr>${cell(sg.segment_key)}${cell(`Nábytek — ${ZONE_LABELS[z]}`)}${cell(f.furniture)}`
        + cell(f.wpl_counter > 0 ? `${fmt1(f.wpl_counter)} WPL/kus` : "bez WPL") + "</tr>");
    }));
  });
  return `<div style="font-family:Segoe UI,Arial,sans-serif; font-size:12px;">
    <p style="margin:0 0 6px;"><strong>Přehled dat kalkulátoru FTE → WPL</strong>`
    + `${model.versionId ? ` — referenční data verze #${model.versionId}` : ""}`
    + ` (${model.segments.length} segmentů, ${model.positions.length} pozic, ${model.furniture.length} prvků)</p>
    <table style="border-collapse:collapse;"><thead>${head}</thead><tbody>${rows.join("")}</tbody></table>
  </div>`;
}

function showDataOverview() {
  if (!requireDb()) return;
  const model = dataOverviewModel();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal">
    <div class="modal-head">
      <h3>Přehled dat v databázi</h3>
      <button class="btn secondary small" data-act="close">✕ Zavřít</button>
    </div>
    <div class="modal-body">${dataOverviewHtml(model)}</div>
    <div class="modal-foot">
      <button class="btn small" data-act="copy-table">📋 Kopírovat jako tabulku (MS Teams)</button>
      <button class="btn secondary small" data-act="copy-text">📋 Kopírovat jako text</button>
      <span class="muted">Tabulku lze vložit do MS Teams, Wordu i Excelu, text kamkoliv.</span>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) { close(); return; }
    const act = e.target.dataset ? e.target.dataset.act : null;
    if (act === "close") close();
    if (act === "copy-table") {
      copyToClipboardBoth(dataOverviewClipboardHtml(model), dataOverviewText(model),
        "Přehled dat zkopírován jako tabulka — vložte přes Ctrl+V.");
    }
    if (act === "copy-text") {
      const text = dataOverviewText(model);
      copyToClipboardBoth(`<pre style="font-family:Consolas,monospace; font-size:12px;">${esc(text)}</pre>`,
        text, "Přehled dat zkopírován jako text — vložte přes Ctrl+V.");
    }
  });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); }
  });
}

/* --------- Filtrování po sloupcích (jako autofiltr v Excelu) --------------- */
// Každá tabulka s daty má v hlavičce u vybraných sloupců tlačítko ▼, které
// otevře seznam hodnot se zaškrtávátky (plus hledání v hodnotách). Filtry
// z více sloupců se skládají jako AND, uvnitř sloupce jako OR — stejně jako
// v Excelu. Filtry jsou jen zobrazovací: uložení tabulky zapíše i skryté řádky.

const columnFilters = {};        // "tableKey" -> { field -> Set(hodnot jako string) }

function colFilterSet(tableKey, field) {
  return (columnFilters[tableKey] || {})[field] || null;
}

function colFilterAnyActive(tableKey) {
  return Object.values(columnFilters[tableKey] || {}).some((set) => set && set.size);
}

function colValue(row, field) {
  const v = row[field];
  if (v === null || v === undefined || v === "") return "(prázdné)";
  if (field === "zone") return ZONE_LABELS[v] || String(v);
  return String(v);
}

// Rozdělí řádky na zobrazené a skryté podle filtrů sloupců.
function splitByColumnFilters(tableKey, rows) {
  const active = Object.entries(columnFilters[tableKey] || {}).filter(([, set]) => set && set.size);
  if (!active.length) return { shown: rows, hidden: [] };
  const shown = []; const hidden = [];
  rows.forEach((r) => {
    (active.every(([field, set]) => set.has(colValue(r, field))) ? shown : hidden).push(r);
  });
  return { shown, hidden };
}

// Tlačítko filtru do hlavičky sloupce.
function colFilterButtonHtml(tableKey, field) {
  const set = colFilterSet(tableKey, field);
  const active = !!(set && set.size);
  return `<button type="button" class="colfilter-btn${active ? " active" : ""}"
    data-colfilter="${esc(field)}" title="${active ? `Filtr: ${[...set].join(", ")}` : "Filtrovat sloupec"}"
    >${active ? "▼" : "▽"}</button>`;
}

// Nabídne hodnoty sloupce a nechá uživatele zaškrtat, které chce vidět.
function openColFilterPopup(tableKey, field, allRows, button, rerender) {
  document.querySelectorAll(".colfilter-pop").forEach((el) => el.remove());
  const values = [...new Set(allRows.map((r) => colValue(r, field)))]
    .sort((a, b) => a.localeCompare(b, "cs", { numeric: true }));
  const set = colFilterSet(tableKey, field);
  const checked = (v) => !set || !set.size || set.has(v);

  const pop = document.createElement("div");
  pop.className = "colfilter-pop";
  pop.innerHTML = `
    <input type="text" class="colfilter-search" placeholder="Hledat v hodnotách…">
    <div class="colfilter-actions">
      <button type="button" class="btn secondary small" data-act="all">Vybrat vše</button>
      <button type="button" class="btn secondary small" data-act="none">Odebrat vše</button>
    </div>
    <div class="colfilter-list">${values.map((v, i) => `<label><input type="checkbox" value="${esc(v)}"
      ${checked(v) ? "checked" : ""} data-i="${i}"><span>${esc(v)}</span></label>`).join("")}</div>
    <div class="colfilter-foot">
      <button type="button" class="btn small" data-act="apply">Použít</button>
      <button type="button" class="btn secondary small" data-act="clear">Zrušit filtr</button>
    </div>`;
  document.body.appendChild(pop);
  const rect = button.getBoundingClientRect();
  pop.style.top = `${rect.bottom + window.scrollY + 4}px`;
  pop.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - pop.offsetWidth - 12)}px`;

  const boxes = () => [...pop.querySelectorAll('.colfilter-list input[type="checkbox"]')];
  pop.querySelector(".colfilter-search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    boxes().forEach((cb) => {
      cb.parentElement.style.display = !q || cb.value.toLowerCase().includes(q) ? "flex" : "none";
    });
  });
  const close = () => pop.remove();
  pop.addEventListener("click", (e) => {
    const act = e.target.dataset ? e.target.dataset.act : null;
    if (!act) return;
    if (act === "all") { boxes().forEach((cb) => { if (cb.parentElement.style.display !== "none") cb.checked = true; }); return; }
    if (act === "none") { boxes().forEach((cb) => { if (cb.parentElement.style.display !== "none") cb.checked = false; }); return; }
    if (act === "clear") {
      if (columnFilters[tableKey]) delete columnFilters[tableKey][field];
      close(); rerender(); return;
    }
    if (act === "apply") {
      const selected = boxes().filter((cb) => cb.checked).map((cb) => cb.value);
      columnFilters[tableKey] = columnFilters[tableKey] || {};
      // vybráno všechno = filtr se nepoužívá (stejně jako v Excelu)
      if (selected.length === values.length) delete columnFilters[tableKey][field];
      else columnFilters[tableKey][field] = new Set(selected);
      close(); rerender();
    }
  });
  // klik mimo popup ho zavře
  setTimeout(() => {
    const onDoc = (e) => {
      if (pop.contains(e.target) || e.target === button) return;
      document.removeEventListener("mousedown", onDoc);
      close();
    };
    document.addEventListener("mousedown", onDoc);
  }, 0);
}

// Naváže tlačítka filtrů v hlavičce tabulky.
function wireColFilters(containerEl, tableKey, allRows, rerender) {
  if (!containerEl) return;
  containerEl.querySelectorAll("[data-colfilter]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openColFilterPopup(tableKey, btn.dataset.colfilter, allRows, btn, rerender);
    });
  });
}

// Souhrn aktivních filtrů sloupců pod tabulkou (a tlačítko na jejich zrušení).
function colFilterSummaryHtml(tableKey) {
  const active = Object.entries(columnFilters[tableKey] || {}).filter(([, set]) => set && set.size);
  if (!active.length) return "";
  return `<p class="muted colfilter-summary">Filtry sloupců:
    ${active.map(([field, set]) => `<span class="colfilter-chip">${esc(field)}: ${esc([...set].slice(0, 4).join(", "))}`
      + `${set.size > 4 ? ` +${set.size - 4}` : ""}</span>`).join(" ")}
    <button type="button" class="btn secondary small" data-colfilter-reset="${esc(tableKey)}">Zrušit filtry sloupců</button></p>`;
}

function wireColFilterReset(containerEl, tableKey, rerender) {
  if (!containerEl) return;
  const btn = containerEl.querySelector(`[data-colfilter-reset="${tableKey}"]`);
  if (btn) btn.addEventListener("click", () => { columnFilters[tableKey] = {}; rerender(); });
}

/* ---------- Vyhledávání a filtrování nad editovatelnými tabulkami ---------- */
// Filtr je jen „prohlížecí“: řádky, které mu nevyhovují, se nezahazují — render
// si je uloží do datasetu kontejneru (`hiddenRows`) a uložení tabulky je zapíše
// zpět spolu s tím, co je vidět. Stav filtrů drží tableFilterState, takže
// překreslení tabulky (uložení, změna databáze) filtr neshodí.
const tableFilterState = {};

function tableFilterValue(key) { return tableFilterState[key] || ""; }

// Hledá se po slovech — „mmma theke“ najde řádek obsahující obojí, bez ohledu
// na pořadí a velikost písmen.
function splitByFilter(key, rows, textOf) {
  const terms = tableFilterValue(key).split(/\s+/).filter(Boolean);
  if (!terms.length) return { shown: rows, hidden: [] };
  const shown = []; const hidden = [];
  rows.forEach((r) => {
    const hay = String(textOf(r)).toLowerCase();
    (terms.every((t) => hay.includes(t)) ? shown : hidden).push(r);
  });
  return { shown, hidden };
}

function filterSummaryHtml(key, shown, total, word) {
  const active = !!tableFilterValue(key);
  return `<p class="muted filter-summary" style="margin-top:6px;">Zobrazeno <strong>${shown}</strong>
    z ${total} ${word}.${active ? " Uložení zapíše i řádky skryté filtrem — filtr slouží jen k prohlížení."
    : ""}${active && shown === 0 ? " <strong>Filtru nic neodpovídá.</strong>" : ""}</p>`;
}

function wireTableFilter(inputId, key, render) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.addEventListener("input", () => {
    tableFilterState[key] = el.value.trim().toLowerCase();
    render();
  });
}

// Řádky skryté filtrem, uložené při renderu do datasetu kontejneru tabulky.
function hiddenFilterRows(containerId) {
  const el = document.getElementById(containerId);
  return JSON.parse((el && el.dataset.hiddenRows) || "[]");
}

/* --------------------------- Referenční data ------------------------------ */

function renderAbsenceTable() {
  const el = document.getElementById("absenceTable");
  if (!db) { el.innerHTML = `<p class="muted">Nejprve připojte databázi.</p>`; return; }
  const rows = dbAll("SELECT segment, nepritomnost, homeoffice, ref_version_id FROM absence ORDER BY segment");
  const byText = splitByFilter("absence", rows, (r) => r.segment);
  const byCols = splitByColumnFilters("absence", byText.shown);
  const shown = byCols.shown;
  const hidden = [...byText.hidden, ...byCols.hidden];
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Segment ${colFilterButtonHtml("absence", "segment")}</th>
      <th>Nepřítomnost (%) ${colFilterButtonHtml("absence", "nepritomnost")}</th>
      <th>Homeoffice (%) ${colFilterButtonHtml("absence", "homeoffice")}</th>
      <th title="Verze referenčních dat, ve které řádek naposledy vznikl nebo se změnil">Verze
        ${colFilterButtonHtml("absence", "ref_version_id")}</th><th></th></tr></thead>
    <tbody id="absenceTbody">
      ${shown.map(absenceRowHtml).join("")}
    </tbody></table></div>
    ${colFilterSummaryHtml("absence")}
    ${filterSummaryHtml("absence", shown.length, rows.length, "segmentů")}`;
  wireDeleteButtons("absenceTbody");
  wireColFilters(el, "absence", rows, renderAbsenceTable);
  wireColFilterReset(el, "absence", renderAbsenceTable);
  el.dataset.hiddenRows = JSON.stringify(hidden);
}

// Sloupec „Verze“ je jen informativní (needitovatelný) — stamp se přepočítává
// při uložení podle toho, jestli se řádek skutečně změnil.
function refVersionCellHtml(refVersionId) {
  return `<td class="ref-version-cell">${refVersionId
    ? `<span class="badge ok">#${refVersionId}</span>`
    : '<span class="muted" title="Řádek je z doby před zavedením evidence verzí u jednotlivých řádků">—</span>'}</td>`;
}

function absenceRowHtml(r) {
  return `<tr data-ref-version="${r.ref_version_id ?? ""}">
    <td><input type="text" value="${esc(r.segment)}" data-field="segment"></td>
    <td><input type="number" step="0.1" value="${r.nepritomnost ?? ""}" data-field="nepritomnost"></td>
    <td><input type="number" step="0.1" value="${r.homeoffice ?? ""}" data-field="homeoffice"></td>
    ${refVersionCellHtml(r.ref_version_id)}
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
  hiddenFilterRows("absenceTable").forEach((r) => data.push([r.segment, r.nepritomnost, r.homeoffice]));

  // Pro evidenci verzí u jednotlivých řádků si nejdřív zapamatujeme původní stav:
  // nezměněné řádky si ponechají svůj původní stamp, změněné a nové dostanou až
  // po uložení číslo nově vzniklé verze.
  const old = {};
  dbAll("SELECT segment, nepritomnost, homeoffice, ref_version_id FROM absence")
    .forEach((r) => { old[r.segment] = r; });
  const changed = data.filter(([segment, nep, ho]) => {
    const o = old[segment];
    return !o || o.nepritomnost !== nep || o.homeoffice !== ho;
  }).map(([segment]) => segment);

  dbRun("DELETE FROM absence");
  const ins = db.prepare("INSERT INTO absence (segment, nepritomnost, homeoffice, ref_version_id) VALUES (?, ?, ?, ?)");
  data.forEach((r) => ins.run([...r, old[r[0]] ? old[r[0]].ref_version_id : null]));
  ins.free();

  const versionId = ensureRefVersionUpToDate("Úprava: absence po segmentech");
  changed.forEach((segment) => dbRun("UPDATE absence SET ref_version_id = ? WHERE segment = ?", [versionId, segment]));

  persistDatabase(true);
  renderAbsenceTable();
  renderRefVersionsList();
  toast("Tabulka absencí byla uložena a zaznamenána nová verze referenčních dat.", "ok");
}

// Heatmapa: čím vyšší procento, tím sytější podbarvení buňky barvou zóny.
// Odstín se míchá s bílou, aby text v poli zůstal čitelný i u 100 %.
function heatCellStyle(zone, value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return "";
  const [r, g, b] = hexToRgb(ZONE_COLORS[zone]);
  const strength = Math.min(1, v / 100) * 0.65;   // 100 % -> 65% sytosti
  const mix = (c) => Math.round(c + (255 - c) * (1 - strength));
  return ` style="background:rgb(${mix(r)},${mix(g)},${mix(b)});"`;
}

function dotaceRowHtml(r) {
  const f = (v) => v === null || v === undefined ? "" : v;
  const zoneCell = (zone) => `<td class="heat"${heatCellStyle(zone, r[zone])}>` +
    `<input type="number" step="1" value="${f(r[zone])}" data-field="${zone}"></td>`;
  const ft = Number(r.fasttrack_share) || 0;
  return `<tr data-order="${r.id ?? ""}" class="${ft > 0 ? "ft-row" : ""}">
    <td class="ft-flag" title="${ft > 0 ? `Pozice sedí ${fmtPieces(ft)} % backoffice času na fast tracku`
      : ""}"><i></i></td>
    <td><input type="text" value="${esc(r.segment)}" data-field="segment"></td>
    <td><input type="text" value="${esc(r.pozice)}" data-field="pozice"></td>
    ${ZONES.map(zoneCell).join("")}
    <td class="ft-cell${ft > 0 ? " ft-on" : ""}"><input type="number" step="1" min="0" max="100"
      value="${f(r.fasttrack_share)}" data-field="fasttrack_share"></td>
    <td class="zbar-cell">${zoneSplitBarHtml(r, { compact: true })}</td>
    ${refVersionCellHtml(r.ref_version_id)}
    <td><button class="btn secondary small btn-del">✕</button></td>
  </tr>`;
}

// Přepočítá heatmapu i pruh v jednom řádku po ruční změně hodnoty.
function refreshDotaceRow(tr) {
  const split = {};
  ZONES.forEach((z) => {
    const inp = tr.querySelector(`[data-field="${z}"]`);
    split[z] = toNumberOrNull(inp.value) ?? 0;
    const td = inp.closest("td");
    td.setAttribute("style", heatCellStyle(z, split[z]).replace(/^ style="|"$/g, ""));
  });
  const barCell = tr.querySelector(".zbar-cell");
  if (barCell) barCell.innerHTML = zoneSplitBarHtml(split, { compact: true });
  // Podíl fast tracku: podbarví se jen buňka s hodnotou a řádek dostane tečku.
  const ftInput = tr.querySelector('[data-field="fasttrack_share"]');
  if (ftInput) {
    const on = (toNumberOrNull(ftInput.value) ?? 0) > 0;
    ftInput.closest("td").classList.toggle("ft-on", on);
    tr.classList.toggle("ft-row", on);
  }
}

// Řazení tabulky časových dotací: text česky (localeCompare), čísla číselně,
// „celkem“ podle součtu všech čtyř dotací. Prázdná hodnota se bere jako 0.
function sortDotaceRows(rows, sortState) {
  if (!sortState || !sortState.field) return rows;
  const f = sortState.field;
  const num = (r) => (f === "celkem" ? zoneSplitTotal(r) : (Number(r[f]) || 0));
  rows.sort((a, b) => {
    const cmp = (f === "segment" || f === "pozice")
      ? String(a[f] || "").localeCompare(String(b[f] || ""), "cs")
      : num(a) - num(b);
    return (cmp || String(a.pozice || "").localeCompare(String(b.pozice || ""), "cs")) * sortState.dir;
  });
  return rows;
}

// Klíč identity řádku časové dotace (segment + pozice) pro porovnání změn.
function dotaceKey(segment, pozice) { return `${segment}||${pozice}`; }

// Tabulka časových dotací pozic se zobrazuje na dvou místech (záložka
// "Referenční data" a nový modul "Struktura checklistu") nad stejnou tabulkou
// `casove_dotace` — factory dovolí mít dvě samostatné DOM instance (vlastní
// filtr, vlastní tbody), aniž by se logika duplikovala.
function makeDotaceEditor(tableId, filterId, tbodyId) {
  const filterKey = tableId;
  // Řazení je jen zobrazovací — uložení zapisuje řádky zpět v původním pořadí
  // (podle `id`), aby se nerozhodilo pořadí pozic v generovaném checklistu.
  const sortState = { field: null, dir: 1 };

  function render() {
    const el = document.getElementById(tableId);
    if (!el) return;
    if (!db) { el.innerHTML = `<p class="muted">Nejprve připojte databázi.</p>`; return; }
    const rows = dbAll(`SELECT id, segment, pozice, service_zone, meeting_zone, backoffice_zone, office_room,
      fasttrack_share, ref_version_id FROM casove_dotace ORDER BY segment, pozice`);
    const byText = splitByFilter(filterKey, rows, (r) => `${r.segment} ${r.pozice}`);
    const byCols = splitByColumnFilters(filterKey, byText.shown);
    const shown = byCols.shown;
    const hidden = [...byText.hidden, ...byCols.hidden];
    sortDotaceRows(shown, sortState);
    const th = (field, label, title) => {
      const active = sortState.field === field;
      const filterBtn = field === "celkem" ? "" : colFilterButtonHtml(filterKey, field);
      return `<th class="sortable${active ? " sorted" : ""}" data-sort="${field}"`
        + `${title ? ` title="${esc(title)}"` : ""}>`
        + `<span class="th-label">${esc(label)}<span class="sort-ind">`
        + `${active ? (sortState.dir > 0 ? "▲" : "▼") : "↕"}</span></span>${filterBtn}</th>`;
    };
    el.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th class="ft-flag" title="Červená tečka = pozice má nastavený podíl fast tracku"></th>
        ${th("segment", "Segment")}${th("pozice", "Pozice")}
        ${ZONES.map((z, i) => th(z, ["ServiceZ %", "MeetingZ %", "BackofficeZ %", "OfficeRoom %"][i])).join("")}
        ${th("fasttrack_share", "Fast track %",
          "Kolik % backoffice času pozice odsedí na Fast tracku backoffice místo vlastního"
          + " kancelářského místa. Tato část potřeby WPL se v layoutu přesune z „Kancelářské místo“"
          + " na „Fast track backoffice“, který se nevykazuje jako WPL.")}
        ${th("celkem", "Vytížení zón", "Řadí podle součtu dotací")}
        <th title="Verze referenčních dat, ve které řádek naposledy vznikl nebo se změnil">Verze</th><th></th></tr></thead>
      <tbody id="${tbodyId}">
        ${shown.map(dotaceRowHtml).join("")}
      </tbody></table></div>
      ${zoneLegendHtml("Pruh a podbarvení buněk ukazují rozdělení času:")}
      ${colFilterSummaryHtml(filterKey)}
      ${filterSummaryHtml(filterKey, shown.length, rows.length, "pozic")}`;
    wireDeleteButtons(tbodyId);
    wireColFilters(el, filterKey, rows, render);
    wireColFilterReset(el, filterKey, render);
    // pro uložení potřebujeme i řádky skryté filtrem -> uchováme je v datasetu
    el.dataset.hiddenRows = JSON.stringify(hidden);

    // Řazení kliknutím na hlavičku (druhé kliknutí obrátí směr).
    el.querySelectorAll("th.sortable").forEach((h) => {
      h.addEventListener("click", (e) => {
        if (e.target.closest(".colfilter-btn")) return;   // klik na filtr neřadí
        const f = h.dataset.sort;
        if (sortState.field === f) sortState.dir = -sortState.dir;
        else { sortState.field = f; sortState.dir = 1; }
        render();
      });
    });
    // Heatmapa a pruh se překreslují průběžně, jak se hodnoty přepisují.
    el.querySelectorAll(`#${tbodyId} input[type="number"]`).forEach((inp) => {
      inp.addEventListener("input", () => refreshDotaceRow(inp.closest("tr")));
    });
  }

  function save() {
    if (!requireDb()) return;
    const trs = document.querySelectorAll(`#${tbodyId} tr`);
    const ordered = [];
    const BIG = 1e9; // nové řádky bez `id` jdou na konec
    for (const tr of trs) {
      const segment = tr.querySelector('[data-field="segment"]').value.trim();
      const pozice = tr.querySelector('[data-field="pozice"]').value.trim();
      if (!segment || !pozice) continue;
      ordered.push({ order: Number(tr.dataset.order) || BIG, row: [
        segment, pozice,
        toNumberOrNull(tr.querySelector('[data-field="service_zone"]').value),
        toNumberOrNull(tr.querySelector('[data-field="meeting_zone"]').value),
        toNumberOrNull(tr.querySelector('[data-field="backoffice_zone"]').value),
        toNumberOrNull(tr.querySelector('[data-field="office_room"]').value),
        toNumberOrNull(tr.querySelector('[data-field="fasttrack_share"]').value) ?? 0,
      ] });
    }
    hiddenFilterRows(tableId).forEach((r) => ordered.push({ order: r.id ?? BIG,
      row: [r.segment, r.pozice, r.service_zone, r.meeting_zone, r.backoffice_zone, r.office_room,
        r.fasttrack_share ?? 0] }));
    // Zpět do databáze se zapisuje v původním pořadí (podle id), ne v tom
    // zobrazeném — pořadí pozic v checklistu se řídí právě pořadím vložení.
    ordered.sort((a, b) => a.order - b.order);
    const data = ordered.map((o) => o.row);

    // Evidence verze u jednotlivých řádků — viz saveAbsenceTable(): nezměněné
    // řádky si ponechají původní stamp, změněné a nové dostanou číslo nové verze.
    const old = {};
    dbAll(`SELECT segment, pozice, service_zone, meeting_zone, backoffice_zone, office_room,
      fasttrack_share, ref_version_id FROM casove_dotace`)
      .forEach((r) => { old[dotaceKey(r.segment, r.pozice)] = r; });
    const changed = data.filter(([segment, pozice, s, m, b, o, ft]) => {
      const prev = old[dotaceKey(segment, pozice)];
      return !prev || prev.service_zone !== s || prev.meeting_zone !== m
        || prev.backoffice_zone !== b || prev.office_room !== o
        || (prev.fasttrack_share || 0) !== (ft || 0);
    }).map(([segment, pozice]) => [segment, pozice]);

    dbRun("DELETE FROM casove_dotace");
    const ins = db.prepare(`INSERT INTO casove_dotace
      (segment, pozice, service_zone, meeting_zone, backoffice_zone, office_room, fasttrack_share, ref_version_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    data.forEach((r) => {
      const prev = old[dotaceKey(r[0], r[1])];
      ins.run([...r, prev ? prev.ref_version_id : null]);
    });
    ins.free();

    const versionId = ensureRefVersionUpToDate("Úprava: časové dotace pozic");
    changed.forEach(([segment, pozice]) => dbRun(
      "UPDATE casove_dotace SET ref_version_id = ? WHERE segment = ? AND pozice = ?", [versionId, segment, pozice]));

    persistDatabase(true);
    tableFilterState[filterKey] = "";
    const filterInput = document.getElementById(filterId);
    if (filterInput) filterInput.value = "";
    dotaceEditorMain.render();
    renderRefVersionsList();
    renderLayoutRulesHelp();   // text pravidla o fast tracku vychází z nastavení pozic
    toast("Tabulka časových dotací byla uložena a zaznamenána nová verze referenčních dat.", "ok");
  }

  function addRow() {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.insertAdjacentHTML("beforeend", dotaceRowHtml({ segment: "", pozice: "", service_zone: null,
      meeting_zone: null, backoffice_zone: null, office_room: null, fasttrack_share: 0 }));
    wireDeleteButtons(tbodyId);
    const tr = tbody.lastElementChild;
    tr.querySelectorAll('input[type="number"]').forEach((inp) => {
      inp.addEventListener("input", () => refreshDotaceRow(tr));
    });
  }

  function setFilter(v) { tableFilterState[filterKey] = v.trim().toLowerCase(); render(); }

  return { render, save, addRow, setFilter, sortState };
}

// Tabulka pozic je po sloučení záložek jen jedna (dřív byla i v „Struktuře
// checklistu“ nad stejnými daty).
const dotaceEditorMain = makeDotaceEditor("dotaceTable", "dotaceFilter", "dotaceTbody");

/* ------------------- Struktura checklistu (segmenty/nábytek) --------------- */
// Modul "Struktura checklistu" (nová záložka v horní liště) umožňuje správu
// segmentů (barva/ikona/pořadí — zdroj pravdy pro getSegmentMeta) a nábytku
// (furniture_to_zone). Pozice se správují ve stejné tabulce `casove_dotace`
// jako v "Referenčních datech" (viz dotaceEditorAdmin výše) — nová pozice tak
// automaticky propíše i do generovaného Excel checklistu a do manuálního
// zadání pozic (obojí čte casove_dotace přímo).

function segmentRowHtml(r) {
  return `<tr>
    <td><input type="text" value="${esc(r.segment_key)}" data-field="segment_key"></td>
    <td><input type="text" value="${esc(r.nazev || "")}" data-field="nazev"></td>
    <td><input type="number" step="1" value="${r.sort_order ?? 0}" data-field="sort_order" style="width:60px;"></td>
    <td><input type="color" value="${r.color || "#6b7684"}" data-field="color"></td>
    <td><input type="text" value="${esc(r.icon || "")}" data-field="icon" maxlength="4" style="width:56px; text-align:center;"></td>
    <td><button class="btn secondary small btn-del">✕</button></td>
  </tr>`;
}

function renderSegmentsTable() {
  const el = document.getElementById("segmentsTable");
  if (!el) return;
  if (!db) { el.innerHTML = `<p class="muted">Nejprve připojte databázi.</p>`; return; }
  const rows = dbAll("SELECT segment_key, nazev, sort_order, color, icon FROM segments ORDER BY sort_order, segment_key");
  const byText = splitByFilter("segments", rows, (r) => `${r.segment_key} ${r.nazev || ""}`);
  const byCols = splitByColumnFilters("segments", byText.shown);
  const shown = byCols.shown;
  const hidden = [...byText.hidden, ...byCols.hidden];
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Klíč segmentu ${colFilterButtonHtml("segments", "segment_key")}</th>
      <th>Název ${colFilterButtonHtml("segments", "nazev")}</th>
      <th>Pořadí ${colFilterButtonHtml("segments", "sort_order")}</th>
      <th>Barva</th><th>Ikona</th><th></th></tr></thead>
    <tbody id="segmentsTbody">${shown.map(segmentRowHtml).join("")}</tbody></table></div>
    ${colFilterSummaryHtml("segments")}
    ${filterSummaryHtml("segments", shown.length, rows.length, "segmentů")}`;
  wireDeleteButtons("segmentsTbody");
  wireColFilters(el, "segments", rows, renderSegmentsTable);
  wireColFilterReset(el, "segments", renderSegmentsTable);
  el.dataset.hiddenRows = JSON.stringify(hidden);
}

function saveSegmentsTable() {
  if (!requireDb()) return;
  const trs = document.querySelectorAll("#segmentsTbody tr");
  const data = [];
  for (const tr of trs) {
    const key = tr.querySelector('[data-field="segment_key"]').value.trim();
    if (!key) continue;
    data.push([
      key,
      tr.querySelector('[data-field="nazev"]').value.trim() || key,
      parseInt(tr.querySelector('[data-field="sort_order"]').value, 10) || 0,
      tr.querySelector('[data-field="color"]').value || "#6b7684",
      tr.querySelector('[data-field="icon"]').value.trim() || "📋",
    ]);
  }
  hiddenFilterRows("segmentsTable").forEach((r) => data.push([r.segment_key, r.nazev, r.sort_order, r.color, r.icon]));
  dbRun("DELETE FROM segments");
  const ins = db.prepare("INSERT INTO segments (segment_key, nazev, sort_order, color, icon) VALUES (?, ?, ?, ?, ?)");
  data.forEach((r) => ins.run(r));
  ins.free();
  persistDatabase(true);
  refreshSegmentMetaCache();
  renderSegmentsTable();
  toast("Segmenty byly uloženy.", "ok");
}

function furnitureRowHtml(r) {
  const zoneOptions = ZONES.map((z) => `<option value="${z}" ${z === r.zone ? "selected" : ""}>${ZONE_LABELS[z]}</option>`).join("");
  const thumb = symbolThumbUrl(r.furniture);
  return `<tr data-order="${r.id ?? ""}">
    <td class="fn-thumb">${thumb
      ? `<img src="${thumb}" alt="${esc(r.furniture)}" title="Jak se „${esc(r.furniture)}“ kreslí ve schématu">`
      : ""}</td>
    <td><input type="text" value="${esc(r.segment)}" data-field="segment"></td>
    <td><select data-field="zone">${zoneOptions}</select></td>
    <td><input type="text" value="${esc(r.furniture)}" data-field="furniture"></td>
    <td><input type="number" step="0.5" value="${r.wpl_counter ?? 0}" data-field="wpl_counter"></td>
    ${refVersionCellHtml(r.ref_version_id)}
    <td><button class="btn secondary small btn-del">✕</button></td>
  </tr>`;
}

// Identita nábytkového prvku pro porovnání změn mezi uloženími (kvůli evidenci
// verze u jednotlivých řádků) — stejný princip jako dotaceKey().
function furnitureKey(segment, zone, furniture) { return `${segment}||${zone}||${furniture}`; }

// Řazení tabulky nábytku — stejný princip jako u časových dotací: jen
// zobrazovací, uložení zapisuje řádky zpět v původním pořadí podle `id`.
const furnitureSortState = { field: null, dir: 1 };

function sortFurnitureRows(rows) {
  const f = furnitureSortState.field;
  if (!f) return rows;
  const key = (r) => {
    if (f === "zone") return ZONE_LABELS[r.zone] || r.zone;
    if (f === "wpl_counter") return Number(r.wpl_counter) || 0;
    if (f === "ref_version_id") return Number(r.ref_version_id) || 0;
    return r[f] || "";
  };
  rows.sort((a, b) => {
    const ka = key(a); const kb = key(b);
    const cmp = typeof ka === "number" ? ka - kb : String(ka).localeCompare(String(kb), "cs");
    return (cmp || String(a.furniture || "").localeCompare(String(b.furniture || ""), "cs")) * furnitureSortState.dir;
  });
  return rows;
}

function renderFurnitureTable() {
  const el = document.getElementById("furnitureTable");
  if (!el) return;
  if (!db) { el.innerHTML = `<p class="muted">Nejprve připojte databázi.</p>`; return; }
  const all = dbAll(`SELECT id, segment, zone, furniture, wpl_counter, ref_version_id
    FROM furniture_to_zone ORDER BY segment, zone, id`);
  // Zóna se filtruje samostatným výběrem, text hledá v segmentu, názvu prvku
  // i v názvu zóny — obojí se skládá (jako AND).
  const zoneFilter = tableFilterState.furnitureZone || "";
  const rows = zoneFilter ? all.filter((r) => r.zone === zoneFilter) : all;
  const byText = splitByFilter("furniture", rows,
    (r) => `${r.segment} ${r.furniture} ${ZONE_LABELS[r.zone] || r.zone}`);
  const byCols = splitByColumnFilters("furniture", byText.shown);
  const shown = byCols.shown;
  const hidden = [...byText.hidden, ...byCols.hidden];
  sortFurnitureRows(shown);
  // Hlavička: řazení kliknutím na název + filtr hodnot pod tlačítkem ▽.
  const th = (field, label, title) => {
    const active = furnitureSortState.field === field;
    return `<th class="sortable${active ? " sorted" : ""}" data-sort="${field}"`
      + `${title ? ` title="${esc(title)}"` : ""}>`
      + `<span class="th-label">${esc(label)}<span class="sort-ind">`
      + `${active ? (furnitureSortState.dir > 0 ? "▲" : "▼") : "↕"}</span></span>`
      + `${colFilterButtonHtml("furniture", field)}</th>`;
  };
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th title="Nákres prvku ve schématu pobočky">Nákres</th>
      ${th("segment", "Segment")}${th("zone", "Zóna")}${th("furniture", "Nábytek")}
      ${th("wpl_counter", "WPL / kus")}
      ${th("ref_version_id", "Verze", "Verze referenčních dat, ve které řádek naposledy vznikl nebo se změnil")}
      <th></th></tr></thead>
    <tbody id="furnitureTbody">${shown.map(furnitureRowHtml).join("")}</tbody></table></div>
    ${colFilterSummaryHtml("furniture")}
    ${filterSummaryHtml("furniture", shown.length, all.length, "nábytkových prvků")}
    ${furnitureLegendHtml(all)}`;
  wireDeleteButtons("furnitureTbody");
  wireColFilters(el, "furniture", all, renderFurnitureTable);
  wireColFilterReset(el, "furniture", renderFurnitureTable);
  el.querySelectorAll("th.sortable").forEach((h) => {
    h.addEventListener("click", (e) => {
      if (e.target.closest(".colfilter-btn")) return;   // klik na filtr neřadí
      const f = h.dataset.sort;
      if (furnitureSortState.field === f) furnitureSortState.dir = -furnitureSortState.dir;
      else { furnitureSortState.field = f; furnitureSortState.dir = 1; }
      renderFurnitureTable();
    });
  });
  // Skryté řádky = jak ty odfiltrované textem, tak ty vyřazené výběrem zóny.
  el.dataset.hiddenRows = JSON.stringify([...hidden, ...all.filter((r) => !rows.includes(r))]);
}

function saveFurnitureTable() {
  if (!requireDb()) return;
  const trs = document.querySelectorAll("#furnitureTbody tr");
  const ordered = [];
  const BIG = 1e9; // nové řádky bez `id` jdou na konec
  for (const tr of trs) {
    const segment = tr.querySelector('[data-field="segment"]').value.trim();
    const furniture = tr.querySelector('[data-field="furniture"]').value.trim();
    if (!segment || !furniture) continue;
    ordered.push({ order: Number(tr.dataset.order) || BIG, row: [
      segment, furniture, tr.querySelector('[data-field="zone"]').value,
      toNumberOrNull(tr.querySelector('[data-field="wpl_counter"]').value) ?? 0,
    ] });
  }
  hiddenFilterRows("furnitureTable").forEach((r) => ordered.push({ order: r.id ?? BIG,
    row: [r.segment, r.furniture, r.zone, r.wpl_counter] }));
  // Seřazení v tabulce je jen zobrazovací — do databáze se zapisuje v původním
  // pořadí (podle id), protože podle něj se řadí nábytek v Excel šabloně.
  ordered.sort((a, b) => a.order - b.order);
  const data = ordered.map((o) => o.row);

  // Evidence verze u jednotlivých řádků — viz saveAbsenceTable(): nezměněné
  // řádky si ponechají původní stamp, změněné a nové dostanou číslo nové verze.
  const old = {};
  dbAll("SELECT segment, zone, furniture, wpl_counter, ref_version_id FROM furniture_to_zone")
    .forEach((r) => { old[furnitureKey(r.segment, r.zone, r.furniture)] = r; });
  const changed = data.filter(([segment, furniture, zone, wpl]) => {
    const prev = old[furnitureKey(segment, zone, furniture)];
    return !prev || prev.wpl_counter !== wpl;
  }).map(([segment, furniture, zone]) => [segment, zone, furniture]);

  dbRun("DELETE FROM furniture_to_zone");
  const ins = db.prepare(`INSERT INTO furniture_to_zone (segment, furniture, zone, wpl_counter, ref_version_id)
    VALUES (?, ?, ?, ?, ?)`);
  data.forEach((r) => {
    const prev = old[furnitureKey(r[0], r[2], r[1])];
    ins.run([...r, prev ? prev.ref_version_id : null]);
  });
  ins.free();

  const versionId = ensureRefVersionUpToDate("Úprava: nábytkové prvky");
  changed.forEach(([segment, zone, furniture]) => dbRun(
    `UPDATE furniture_to_zone SET ref_version_id = ?
     WHERE segment = ? AND zone = ? AND furniture = ?`, [versionId, segment, zone, furniture]));

  persistDatabase(true);
  renderFurnitureTable();
  renderRefVersionsList();
  toast("Tabulka nábytku byla uložena a zaznamenána nová verze referenčních dat.", "ok");
}

/* ---- Kopírování zobrazených (vyfiltrovaných) nábytkových prvků do schránky -- */
// Kopíruje se přesně to, co je v tabulce vidět — včetně rozepsaných, ještě
// neuložených úprav (hodnoty se čtou z formuláře, ne z databáze).
function visibleFurnitureRows() {
  return [...document.querySelectorAll("#furnitureTbody tr")].map((tr) => ({
    segment: tr.querySelector('[data-field="segment"]').value.trim(),
    zone: tr.querySelector('[data-field="zone"]').value,
    furniture: tr.querySelector('[data-field="furniture"]').value.trim(),
    wpl: toNumberOrNull(tr.querySelector('[data-field="wpl_counter"]').value) ?? 0,
    version: (tr.querySelector(".ref-version-cell") || {}).innerText || "",
  })).filter((r) => r.segment || r.furniture);
}

function furnitureFilterDescription() {
  const parts = [];
  const zone = tableFilterState.furnitureZone;
  if (zone) parts.push(`zóna ${ZONE_LABELS[zone] || zone}`);
  if (tableFilterValue("furniture")) parts.push(`hledaný text „${tableFilterValue("furniture")}“`);
  return parts.length ? `filtr: ${parts.join(", ")}` : "bez filtru — všechny prvky";
}

function buildFurnitureRefClipboardHtml(rows) {
  const T = "border:1px solid #c9ced6; padding:5px 8px;";
  const head = `<tr style="background:#eef2f7;">${["Segment", "Zóna", "Nábytek", "WPL / kus", "Verze"]
    .map((h) => `<th style="${T} text-align:left; font-weight:bold;">${esc(h)}</th>`).join("")}</tr>`;
  const body = rows.map((r) => {
    const meta = getSegmentMeta(r.segment);
    return `<tr>
      <td style="${T} background:${meta.color}22;"><strong>${esc(r.segment)}</strong></td>
      <td style="${T}">${esc(ZONE_LABELS[r.zone] || r.zone)}</td>
      <td style="${T}">${esc(r.furniture)}</td>
      <td style="${T} text-align:right;">${fmt1(r.wpl)}</td>
      <td style="${T} text-align:center;">${esc(r.version.trim())}</td>
    </tr>`;
  }).join("");
  return `<div style="font-family:Segoe UI,Arial,sans-serif; font-size:12px;">
    <p style="margin:0 0 6px;"><strong>Nábytkové prvky (referenční data)</strong> — ${esc(furnitureFilterDescription())},
      ${rows.length} ${rows.length === 1 ? "prvek" : "prvků"}</p>
    <table style="border-collapse:collapse;"><thead>${head}</thead><tbody>${body}</tbody></table>
  </div>`;
}

function buildFurnitureRefClipboardText(rows) {
  const lines = [`Nábytkové prvky (referenční data) — ${furnitureFilterDescription()}`,
    ["Segment", "Zóna", "Nábytek", "WPL / kus", "Verze"].join("\t")];
  rows.forEach((r) => lines.push([r.segment, ZONE_LABELS[r.zone] || r.zone, r.furniture,
    fmt1(r.wpl), r.version.trim()].join("\t")));
  return lines.join("\n");
}

function copyFurnitureRefToClipboard() {
  if (!requireDb()) return;
  const rows = visibleFurnitureRows();
  if (!rows.length) { toast("Tabulka nábytku je prázdná — není co kopírovat.", "warn"); return; }
  copyToClipboardBoth(buildFurnitureRefClipboardHtml(rows), buildFurnitureRefClipboardText(rows),
    `Zkopírováno ${rows.length} zobrazených nábytkových prvků — vložte přes Ctrl+V.`);
}
/* ------------- Nastavení Excel šablony (barvy a chování) ------------------ */
// Formulář se generuje z SETTINGS_DEFS, takže přidání dalšího nastavení
// znamená jen doplnit řádek v definici.

function settingFieldHtml(d) {
  const v = getSetting(d.key);
  const id = `set_${d.key}`;
  if (d.type === "bool") {
    return `<label class="set-row set-check"><input type="checkbox" id="${id}" data-key="${d.key}"
      ${v === "1" ? "checked" : ""}><span>${esc(d.label)}</span>
      ${d.help ? `<span class="muted set-help">${esc(d.help)}</span>` : ""}</label>`;
  }
  if (d.type === "color") {
    return `<label class="set-row"><span class="set-label">${esc(d.label)}</span>
      <input type="color" id="${id}" data-key="${d.key}" value="${esc(v)}">
      <code class="muted">${esc(v)}</code></label>`;
  }
  const step = d.type === "int" ? "1" : (d.type === "num" ? "0.01" : null);
  const attrs = d.type === "text" ? 'type="text"'
    : `type="number" step="${step}"${d.min !== undefined ? ` min="${d.min}"` : ""}${d.max !== undefined ? ` max="${d.max}"` : ""}`;
  return `<label class="set-row"><span class="set-label">${esc(d.label)}</span>
    <input ${attrs} id="${id}" data-key="${d.key}" value="${esc(v)}" style="width:120px;">
    ${d.help ? `<span class="muted set-help">${esc(d.help)}</span>` : ""}</label>`;
}

function renderSettingsPanel() {
  const el = document.getElementById("templateSettings");
  if (!el) return;
  if (!db) { el.innerHTML = `<p class="muted">Nejprve připojte databázi.</p>`; return; }
  const group = (g) => SETTINGS_DEFS.filter((d) => d.group === g).map(settingFieldHtml).join("");
  el.innerHTML = `
    <div class="set-grid">
      <div class="set-col"><h3>Barvy šablony</h3>${group("colors")}
        <p class="muted" style="margin-top:8px;">Na tmavém podbarvení (titulek, hlavičky sekcí) se použije
          „Písmo na tmavém podbarvení“, aby text zůstal čitelný.</p></div>
      <div class="set-col"><h3>Chování šablony</h3>${group("tpl")}</div>
    </div>
    <div class="set-preview"><h3>Náhled barev</h3>${settingsPreviewHtml()}</div>`;
  el.querySelectorAll('input[type="color"]').forEach((inp) => {
    inp.addEventListener("input", () => {
      const code = inp.parentElement.querySelector("code");
      if (code) code.textContent = inp.value;
      el.querySelector(".set-preview").innerHTML = `<h3>Náhled barev</h3>${settingsPreviewHtml(collectSettingsForm())}`;
    });
  });
}

// Náhled ukazuje, jak budou vypadat hlavní prvky listu CHL — bere buď hodnoty
// z databáze, nebo (při ladění barev) rozepsané hodnoty z formuláře.
function settingsPreviewHtml(pending) {
  const g = (k) => (pending && pending[k] !== undefined ? pending[k] : getSetting(k));
  const segColors = (pending ? pending.tpl_use_segment_colors : getSetting("tpl_use_segment_colors")) === "1";
  const segs = dbAll("SELECT segment_key, color FROM segments ORDER BY sort_order, segment_key").slice(0, 4);
  const cell = (bg, fg, text, bold) => `<td style="background:${bg}; color:${fg}; border:1px solid #b9bfc9;
    padding:4px 8px; ${bold ? "font-weight:700;" : ""}">${esc(text)}</td>`;
  return `<div class="table-wrap"><table style="border-collapse:collapse; font-size:12px;"><tbody>
    <tr>${cell(g("tpl_color_title"), g("tpl_color_ondark"), "CHECKLIST – Praha 6", true)}</tr>
    <tr>${cell(g("tpl_color_section"), g("tpl_color_ondark"), "OBSAZENOST POBOČKY", true)}</tr>
    <tr>${segs.map((sg) => {
      const bg = segColors ? sg.color : g("tpl_color_segment");
      return cell(bg, isDarkColor(bg) ? g("tpl_color_ondark") : "#1b2430", sg.segment_key, true);
    }).join("")}</tr>
    <tr>${cell(g("tpl_color_zone"), "#1b2430", "SERVICE ZONE")}
      ${cell(g("tpl_color_headercell"), g("tpl_color_input"), "vyplňovaná buňka", true)}
      ${cell(g("tpl_color_sum"), "#1b2430", "Suma FTE", true)}</tr>
  </tbody></table></div>`;
}

function collectSettingsForm() {
  const out = {};
  document.querySelectorAll("#templateSettings [data-key]").forEach((inp) => {
    out[inp.dataset.key] = inp.type === "checkbox" ? (inp.checked ? "1" : "0") : inp.value;
  });
  return out;
}

function saveSettingsPanel() {
  if (!requireDb()) return;
  setSettings(collectSettingsForm());
  persistDatabase(true);
  renderSettingsPanel();
  toast("Nastavení Excel šablony bylo uloženo.", "ok");
}

function resetSettingsPanel() {
  if (!requireDb()) return;
  const defaults = {};
  SETTINGS_DEFS.forEach((d) => { defaults[d.key] = d.def; });
  setSettings(defaults);
  persistDatabase(true);
  renderSettingsPanel();
  toast("Nastavení bylo vráceno na výchozí hodnoty.", "ok");
}

/* ------------- Generování .xlsx šablony checklistu (CHL + VSTUPY) ---------- */
// Šablona se sestavuje tak, aby vypadala i fungovala jako vzorový checklist:
//
// * **CHL** je list, do kterého vyplňuje pobočka — detaily pobočky, počty FTE
//   po pozicích (aktuálně / výhled), volný blok cestovních pozic, SAZO,
//   nábytek BUSINESS ZONE / BACK OFFICE, vybavení a poznámky. Obsah pozic
//   a nábytku pochází z databáze aplikace (tabulky `segments`, `casove_dotace`
//   a `furniture_to_zone`), takže nová pozice nebo nábytkový prvek se
//   automaticky objeví i tady.
// * **VSTUPY** je list, který si vyplněné hodnoty z CHL jen **stahuje vzorci**
//   (`=CHL!H10`, `=$C$4`, u cestovních `=IF(CHL!B80=0,"",…)`) do podoby, kterou
//   čte parseVstupySheet() — C1–C4 a od řádku 6 sloupce A–D. Aplikace parsuje
//   výhradně tento list, takže po vyplnění CHL a uložení v Excelu (kdy se
//   vzorce přepočítají) jde soubor bez úprav načíst zpět.
//
// Vendorovaná knihovna SheetJS (komunitní edice) při zápisu zahazuje veškeré
// formátování buněk (ověřeno přímým testem), proto se soubor sestavuje přes
// vlastní zapisovač `xlsx_writer.js`, který barvy, fonty, ohraničení, sloučené
// buňky, šířky sloupců i výšky řádků skutečně zapíše.

// Barvy šablony vycházejí ze vzorového checklistu, ale jsou přenastavitelné
// v „Struktuře checklistu“ → Nastavení Excel šablony (tabulka app_settings).
function chlColors() {
  return {
    title: hexToArgb(getSetting("tpl_color_title")),        // titulek, svislé popisky FRONT/BACK OFFICE
    section: hexToArgb(getSetting("tpl_color_section")),    // hlavičky sekcí
    segment: hexToArgb(getSetting("tpl_color_segment")),    // popisek segmentu, velká čísla hodin
    sum: hexToArgb(getSetting("tpl_color_sum")),            // hodnoty součtů
    zone: hexToArgb(getSetting("tpl_color_zone")),          // popisek zóny
    headerCell: hexToArgb(getSetting("tpl_color_headercell")), // vyplňované buňky v hlavičce (C:D a I, ř. 3–8)
    input: hexToArgb(getSetting("tpl_color_input")),        // barva písma vyplňovaných buněk
    onDark: hexToArgb(getSetting("tpl_color_ondark")),      // písmo na tmavém podbarvení (title, section)
  };
}
// Šířky sloupců; G a H jsou přenastavitelné (tpl_col_width_gh) a sbalení
// poznámkového sloupce K lze vypnout (pak zůstane rovnou vidět).
function chlColWidths() {
  const collapse = getSettingBool("tpl_collapse_notes");
  const widthGH = getSettingNum("tpl_col_width_gh");
  return CHL_COL_WIDTHS_BASE.map((c) => {
    if (c.index === 7 || c.index === 8) return { ...c, width: widthGH };
    if (!collapse && (c.index === 10 || c.index === 11)) return { index: c.index, width: c.width };
    return c;
  });
}
const CHL_COL_WIDTHS_BASE = [
  { index: 1, width: 11.7109375 }, { index: 2, width: 14.28515625 }, { index: 3, width: 14.42578125 },
  { index: 4, width: 9.28515625 }, { index: 5, width: 8.7109375 }, { index: 6, width: 19.42578125 },
  { index: 7, width: 19.86 }, { index: 8, width: 19.86 }, { index: 9, width: 25.140625 },
  // J je „souhrnný“ sloupec skupiny (nese tlačítko +/−), K jsou rozšířené
  // poznámky — seskupené a defaultně sbalené (skryté).
  { index: 10, width: 4.7109375, collapsed: true },
  { index: 11, width: 91.140625, outlineLevel: 1, hidden: true },
];
const VSTUPY_COL_WIDTHS = [
  { index: 1, width: 11.42578125 }, { index: 2, width: 57.140625 },
  { index: 3, width: 17.5703125 }, { index: 4, width: 14.5703125 },
];
// Volných řádků pro cestovní pozice — ve vzoru 9, přenastavitelné v Nastavení.

// Číselníky pro rozbalovací menu (ověření dat) v hlavičce listu CHL.
const CHL_FORMATY = ["small", "medium-economy", "medium", "flagship", "EPC"];
const CHL_TYPY_AKCE = [
  "Modernizace (nový formát)", "Relokace (nový formát)", "Nová pobočka", "Optimalizace plochy",
  "FHC (úprava nového formátu)", "Přechod na cashless", "Kontrolní přepočet FTE/WPL", "Ad-hoc", "Studie",
];
const CHL_REZIMY = ["cash", "cashless"];
// Název pomocného listu se seznamem poboček (zdroj pro rozbalovací menu v C3
// a pro VLOOKUP, kterým se do G1 doplní ID pobočky).
const POBOCKY_SHEET = "Pobočky";

// Statické bloky, které pobočka vyplňuje, ale nejsou v databázi aplikace —
// přebírají se ze vzoru, aby šablona byla kompletní.
const CHL_SAZO = ["Výběrový", "Vkladový", "Recyklační", "Transakční", "Příprava"];
const CHL_VYBAVENI = [
  ["BANKOVNÍ TECHNIKA", ["ARP", "TT", "Počítačka mincí", "Počítačka bankovek",
    "Bezpečnostní schránky", "Noční trezor", "Trezor"]],
  ["OSTATNÍ VYBAVENÍ", ["Směrová hudba", "Frontmatic (systém řízení fronty)"]],
  ["NÁHRADNÍ PROVOZ", ["Mobilní bankéř", "Přesun do okolních poboček",
    "Uzavření pobočky po dobu rekonstrukce", "Mobilní pobočka", "Pouze ATM", "Ostatní"]],
];

function generateChecklistTemplate() {
  if (!requireDb()) return;

  // Verze referenčních dat, ze kterých šablona vzniká — jde do názvu souboru
  // i do patičky listu CHL, aby bylo zpětně jasné, s jakým obsahem (pozice,
  // nábytek, absence) byl checklist vygenerován.
  const refVersionId = ensureRefVersionUpToDate("Stav při generování Excel šablony");

  // Vzhled a chování šablony podle nastavení v „Struktuře checklistu“.
  const CHL_C = chlColors();
  const FONT = getSetting("tpl_font") || "Arial";
  const CESTOVNI_ROWS = Math.max(0, Math.round(getSettingNum("tpl_cestovni_rows")));
  const NOTE_ROWS = Math.max(1, Math.round(getSettingNum("tpl_note_rows")));
  const DEFAULT_HOURS = getSettingNum("tpl_default_hours");
  const useSegmentColors = getSettingBool("tpl_use_segment_colors");

  const segments = dbAll("SELECT segment_key FROM segments ORDER BY sort_order, segment_key").map((r) => r.segment_key);
  const segOrder = {};
  segments.forEach((s, i) => { segOrder[s] = i; });
  const bySegOrder = (a, b) => {
    const oa = segOrder[a] ?? 999, ob = segOrder[b] ?? 999;
    return oa !== ob ? oa - ob : String(a).localeCompare(b);
  };
  const isCestovni = (s) => String(s).trim().toUpperCase().startsWith("CESTOVNÍ");

  // Pozice po segmentech; segment CESTOVNÍ má v CHL vlastní volný blok, takže
  // se do běžných bloků nezařazuje.
  // Pořadí uvnitř segmentu se drží podle `id`, tj. podle pořadí, v jakém byly
  // pozice zavedené — to odpovídá pořadí ve vzorovém checklistu (abecední
  // řazení by ho rozhodilo).
  const dotaceRows = dbAll("SELECT segment, pozice FROM casove_dotace ORDER BY id");
  const positionsBySegment = {};
  dotaceRows.forEach((r) => {
    if (isCestovni(r.segment)) return;
    (positionsBySegment[r.segment] = positionsBySegment[r.segment] || []).push(r.pozice);
  });
  const positionSegments = Object.keys(positionsBySegment).sort(bySegOrder);

  // Nábytek: FRONT OFFICE = service + meeting zone, BACK OFFICE = backoffice
  // zone + office room (stejné rozdělení jako ve vzorovém checklistu).
  const furnitureRows = dbAll("SELECT segment, zone, furniture, wpl_counter FROM furniture_to_zone ORDER BY segment, zone, id");
  const ZONE_TITLES = {
    service_zone: "SERVICE ZONE", meeting_zone: "MEETING ZONE",
    backoffice_zone: "BACKOFFICE ZONE", office_room: "OFFICE ROOM",
  };
  function furnitureSection(zoneList) {
    // -> [{ segment, zones: [{ zone, items: [furniture...] }] }]
    const bySeg = {};
    furnitureRows.forEach((r) => {
      if (!zoneList.includes(r.zone)) return;
      const seg = (bySeg[r.segment] = bySeg[r.segment] || {});
      (seg[r.zone] = seg[r.zone] || []).push(r.furniture);
    });
    return Object.keys(bySeg).sort(bySegOrder).map((segment) => ({
      segment,
      zones: zoneList.filter((z) => bySeg[segment][z] && bySeg[segment][z].length)
        .map((z) => ({ zone: z, items: bySeg[segment][z] })),
    }));
  }
  const frontOffice = furnitureSection(["service_zone", "meeting_zone"]);
  const backOffice = furnitureSection(["backoffice_zone", "office_room"]);

  // Seznam poboček pro rozbalovací menu v C3 a pro dopočet ID pobočky do G1.
  const pobockyRows = dbAll("SELECT id_pobocky, nazev, region FROM pobocky ORDER BY nazev");

  /* ------------------------------- styly ---------------------------------- */
  const sb = createStyleBook();
  const A = (size, bold, color) => ({ name: FONT, size, bold: !!bold, color: color || null });
  // Písmo na tmavém podbarvení (modrá `title`, tmavě modrá `section`) je bílé,
  // aby byl text čitelný; na světlých a tyrkysových výplních zůstává tmavé.
  const W = CHL_C.onDark;
  const st = {
    title: sb.style({ font: A(12, true, W), fill: CHL_C.title, border: "lrtb", alignment: { h: "left", v: "center" } }),
    titleCtr: sb.style({ font: A(12, true, W), fill: CHL_C.title, border: "lrtb", alignment: { h: "center", v: "center", wrap: true } }),
    titleCtrN: sb.style({ font: A(12, false, W), fill: CHL_C.title, border: "lrtb", alignment: { h: "center", v: "center" } }),
    // „Vygenerováno“ je ve vzoru Calibri a bez levého rámečku (navazuje na H1)
    genLabel: sb.style({ font: { name: "Calibri", size: 12, bold: true, color: W }, fill: CHL_C.title, border: "rtb", alignment: { h: "center", v: "center" } }),
    sectionCtrNW: sb.style({ font: A(9, false, W), fill: CHL_C.section, border: "lrtb", alignment: { h: "center", v: "center" } }),
    noteHead: sb.style({ font: { name: "Aptos Display", size: 18, color: W }, fill: CHL_C.title, border: "lrtb", alignment: { v: "center" } }),
    // Svislý popisek ve sloupci J nemá výplň — zůstává tmavý, jinak by zmizel.
    noteSide: sb.style({ font: { name: "Aptos Display", size: 10 }, border: "lr", alignment: { h: "center", v: "center", wrap: true } }),
    section: sb.style({ font: A(9, true, W), fill: CHL_C.section, border: "lrtb", alignment: { h: "left", v: "center" } }),
    sectionCtr: sb.style({ font: A(9, false, W), fill: CHL_C.section, border: "lrtb", alignment: { h: "center", v: "center", wrap: true } }),
    sectionCtrB: sb.style({ font: A(9, true, W), fill: CHL_C.section, border: "lrtb", alignment: { h: "center", v: "center", wrap: true } }),
    sumBlank: sb.style({ font: A(9, true, W), fill: CHL_C.section, border: "lrtb", alignment: { h: "center", v: "center" } }),
    label: sb.style({ font: A(9, true), border: "lrtb", alignment: { h: "left", v: "center" } }),
    value: sb.style({ font: A(9, true, CHL_C.title), border: "lrtb", alignment: { h: "center", v: "center" } }),
    // Vyplňované buňky v hlavičce (sloučené C:D a sloupec I, řádky 3–8)
    // mají světle šedé podbarvení, aby bylo vidět, kam se zapisuje.
    valueGrey: sb.style({ font: A(9, true, CHL_C.title), fill: CHL_C.headerCell, border: "lrtb",
      alignment: { h: "center", v: "center" }, unlocked: true }),
    bigNum: sb.style({ font: A(20, true, CHL_C.segment), border: "lrtb", alignment: { h: "center", v: "center" } }),
    bigNumGrey: sb.style({ font: A(20, true, CHL_C.segment), fill: CHL_C.headerCell, border: "lrtb",
      alignment: { h: "center", v: "center" }, unlocked: true }),
    segment: sb.style({ font: A(9, true), fill: CHL_C.segment, border: "lrtb", alignment: { h: "center", v: "center" } }),
    // Popisek segmentu může mít vlastní barvu podle tabulky Segmenty; na tmavé
    // barvě se písmo přepne na bílé, aby zůstal čitelný.
    segmentOf: (key) => {
      const color = useSegmentColors ? getSegmentMeta(key).color : null;
      return sb.style({
        font: A(9, true, color && isDarkColor(color) ? CHL_C.onDark : null),
        fill: color ? hexToArgb(color) : CHL_C.segment,
        border: "lrtb", alignment: { h: "center", v: "center" },
      });
    },
    zone: sb.style({ font: A(8, true), fill: CHL_C.zone, border: "lrtb", alignment: { h: "center", v: "center", wrap: true } }),
    sideLabel: sb.style({ font: A(9, true, W), fill: CHL_C.title, border: "lrtb", alignment: { h: "center", v: "center", wrap: true } }),
    subLabel: sb.style({ font: A(9, true), border: "lrtb", alignment: { h: "center", v: "center", wrap: true } }),
    item: sb.style({ font: A(9), border: "lrtb", alignment: { h: "left", v: "center" } }),
    // Volné řádky cestovních pozic vyplňuje pobočka -> zůstávají odemčené.
    itemInput: sb.style({ font: A(9), border: "lrtb", alignment: { h: "left", v: "center" }, unlocked: true }),
    // Vyplňovaná pole: sloupce G a H (počty FTE, kusy, WPL) mají světle šedé
    // podbarvení jako buňky v hlavičce, aby bylo vidět, kam se zapisuje;
    // sloupec I (poznámky) zůstává bílý.
    input: sb.style({ font: A(9, true, CHL_C.input), fill: CHL_C.headerCell, border: "lrtb",
      alignment: { h: "center", v: "center" }, unlocked: true }),
    inputNote: sb.style({ font: A(9, true, CHL_C.input), border: "lrtb",
      alignment: { h: "center", v: "center" }, unlocked: true }),
    sumVal: sb.style({ font: A(9, true), fill: CHL_C.sum, border: "lrtb", alignment: { h: "center", v: "center" } }),
    // Sloupec K (rozšířené poznámky) a blok doplňujících informací vyplňuje
    // pobočka, takže i ty zůstávají odemčené.
    plain: sb.style({ border: "lrtb", unlocked: true }),
    noteArea: sb.style({ font: A(9), border: "lrtb", alignment: { h: "left", v: "top", wrap: true }, unlocked: true }),
  };

  const chl = {};
  const merges = [];
  const rowHeights = {};
  const validations = [];
  const COLS = "ABCDEFGHIJK";
  const put = (col, row, cell) => { chl[`${col}${row}`] = cell; };
  const str = (v, s) => ({ t: "str", v: v ?? "", s });
  const num = (v, s) => ({ v: v === null || v === undefined ? "" : v, s });
  const fml = (f, s) => ({ f, v: "", s });
  const merge = (c1, r1, c2, r2) => { if (c1 !== c2 || r1 !== r2) merges.push(`${c1}${r1}:${c2}${r2}`); };
  // Sloučená buňka musí mít nastylované i zakryté buňky, jinak Excel nevykreslí
  // ohraničení a výplň přes celou šířku sloučení.
  const fillRange = (c1, c2, row, s, firstCell) => {
    const i1 = COLS.indexOf(c1), i2 = COLS.indexOf(c2);
    for (let i = i1; i <= i2; i++) put(COLS[i], row, i === i1 && firstCell ? firstCell : str("", s));
    merge(c1, row, c2, row);
  };

  /* ----------------------------- CHL: hlavička ----------------------------- */
  rowHeights[1] = 39.75;
  fillRange("A", "F", 1, st.title, str("CHECKLIST", st.title));
  // ID pobočky se dopočítá z názvu vybraného v C3 (stejně jako ve vzoru, jen
  // proti pomocnému listu se seznamem poboček z databáze aplikace).
  put("G", 1, { f: `IFERROR(VLOOKUP(C3,'${POBOCKY_SHEET}'!$A$2:$B$${pobockyRows.length + 1},2,0),"")`, v: "", t: "str", s: st.titleCtr });
  put("H", 1, str("WPL celkem:", st.titleCtrN));
  put("I", 1, str("Vygenerováno", st.genLabel));
  put("J", 1, str("ROZŠÍŘENÉ POZNÁMKY    ▼", st.noteSide));
  merge("J", 1, "J", 9);
  for (let r = 2; r <= 9; r++) put("J", r, str("", st.noteSide));
  put("K", 1, str("Rozšířené poznámky", st.noteHead));

  rowHeights[2] = 17.1;
  fillRange("A", "H", 2, st.section, str("DETAILY POBOČKY", st.section));
  put("I", 2, str("POČET HODIN ZA TÝDEN", st.sectionCtrNW));
  put("K", 2, str("", st.plain));

  for (let r = 3; r <= 8; r++) rowHeights[r] = 20.1;
  const detailRows = [
    ["Název pobočky:", 3], ["Datum zpracování:", 4], ["Cílový formát:", 5], ["Typ akce:", 6],
  ];
  detailRows.forEach(([label, r]) => {
    put("A", r, str(label, st.label)); put("B", r, str("", st.label)); merge("A", r, "B", r);
    put("C", r, str("", st.valueGrey)); put("D", r, str("", st.valueGrey)); merge("C", r, "D", r);
  });
  // "Režim obsluhy klientů:" je ve vzoru sloučený přes dva řádky (7-8)
  put("A", 7, str("Režim obsluhy klientů:", st.label)); put("B", 7, str("", st.label));
  put("A", 8, str("", st.label)); put("B", 8, str("", st.label));
  merges.push("A7:B8");
  put("C", 7, str("", st.valueGrey)); put("D", 7, str("", st.valueGrey));
  put("C", 8, str("", st.valueGrey)); put("D", 8, str("", st.valueGrey));
  merges.push("C7:D8");

  // Rozbalovací menu (ověření dat) v hlavičce. Seznam poboček je dlouhý, takže
  // se odkazuje na pomocný list — inline seznam v definici ověření má v Excelu
  // limit délky, který by 317 poboček přesáhlo.
  validations.push(
    { sqref: "C3:D3", formula: `'${POBOCKY_SHEET}'!$A$2:$A$${pobockyRows.length + 1}`,
      promptTitle: "Pobočka", prompt: "Vyberte pobočku ze seznamu — do buňky G1 se doplní její ID." },
    { sqref: "C5:D5", values: CHL_FORMATY },
    { sqref: "C6:D6", values: CHL_TYPY_AKCE },
    { sqref: "C7:D8", values: CHL_REZIMY },
  );

  // Otevírací doba (E3:H5 / I3:I5) a doba vytěžení WPL (E6:H8 / I6:I8)
  [["Otevírací doba pobočky:", 3, 5], ["Doba vytěžení WPL:", 6, 8]].forEach(([label, r1, r2]) => {
    for (let r = r1; r <= r2; r++) for (const c of "EFGH") put(c, r, str("", st.label));
    put("E", r1, str(label, st.label));
    merges.push(`E${r1}:H${r2}`);
    for (let r = r1; r <= r2; r++) put("I", r, num("", st.bigNumGrey));
    put("I", r1, num(DEFAULT_HOURS, st.bigNumGrey));
    merges.push(`I${r1}:I${r2}`);
  });
  for (let r = 3; r <= 9; r++) put("K", r, str("", st.plain));

  /* --------------------- CHL: obsazenost pobočky (pozice) ------------------ */
  rowHeights[9] = 17.1;
  fillRange("A", "F", 9, st.section, str("OBSAZENOST POBOČKY", st.section));
  put("G", 9, str("POČET FTE AKTUÁLNĚ", st.sectionCtr));
  put("H", 9, str("POČET FTE VÝHLED", st.sectionCtr));
  put("I", 9, str("POZNÁMKA", st.sectionCtr));

  let row = 10;
  const positionRowMap = {};      // "segment||pozice" -> řádek v CHL
  const segmentSumRows = [];      // řádky se součtem za segment (pro "Suma FTE bez CEST:")
  positionSegments.forEach((segment) => {
    const items = positionsBySegment[segment];
    const first = row;
    items.forEach((pozice) => {
      rowHeights[row] = 17.1;
      put("A", row, str(row === first ? segment : "", st.segmentOf(segment)));
      fillRange("B", "F", row, st.item, str(pozice, st.item));
      put("G", row, num("", st.input));
      put("H", row, num("", st.input));
      put("I", row, str("", st.inputNote));
      put("K", row, str("", st.plain));
      positionRowMap[`${segment}||${pozice}`] = row;
      row++;
    });
    merge("A", first, "A", row - 1);

    rowHeights[row] = 17.1;
    fillRange("A", "E", row, st.sumBlank);
    put("F", row, str("Suma FTE:", st.sectionCtrB));
    put("G", row, fml(`SUM(G${first}:G${row - 1})`, st.sumVal));
    put("H", row, fml(`SUM(H${first}:H${row - 1})`, st.sumVal));
    put("I", row, str("POZNÁMKA", st.sectionCtr));
    put("K", row, str("", st.plain));
    segmentSumRows.push(row);
    row++;
  });

  // Suma FTE bez cestovních
  rowHeights[row] = 17.1;
  fillRange("A", "E", row, st.sectionCtr);
  put("F", row, str("Suma FTE bez CEST:", st.sectionCtrB));
  const sumNoCest = segmentSumRows.length ? segmentSumRows.map((r) => `G${r}`).join("+") : "0";
  const sumNoCestH = segmentSumRows.length ? segmentSumRows.map((r) => `H${r}`).join("+") : "0";
  put("G", row, fml(sumNoCest, st.sumVal));
  put("H", row, fml(sumNoCestH, st.sumVal));
  put("I", row, str("", st.sectionCtr));
  put("K", row, str("", st.plain));
  const rowSumNoCest = row;
  row++;

  // Hlavička cestovních pozic
  rowHeights[row] = 30;
  fillRange("A", "F", row, st.sumBlank);
  put("G", row, str("DOBA VYUŽITÍ WPL V HODINÁCH TÝDNĚ", st.sectionCtr));
  put("H", row, str("POČET FTE", st.sectionCtr));
  put("I", row, str("POZNÁMKA", st.sectionCtr));
  put("K", row, str("", st.plain));
  row++;

  // Volný blok cestovních pozic — pobočka vypisuje pozici do B, hodiny do G, FTE do H
  const cestFirst = row;
  for (let i = 0; i < CESTOVNI_ROWS; i++) {
    rowHeights[row] = 17.1;
    put("A", row, str(row === cestFirst ? "CESTOVNÍ POZICE" : "", st.segmentOf("CESTOVNÍ POZICE")));
    fillRange("B", "F", row, st.itemInput);
    put("G", row, num("", st.input));
    put("H", row, num("", st.input));
    put("I", row, str("", st.inputNote));
    put("K", row, str("", st.plain));
    row++;
  }
  const cestLast = row - 1;
  merge("A", cestFirst, "A", cestLast);

  rowHeights[row] = 17.1;
  fillRange("A", "D", row, st.sumBlank);
  put("E", row, str("Suma FTE s CEST:", st.sectionCtrB));
  put("F", row, str("", st.sectionCtrB));
  merge("E", row, "F", row);
  put("G", row, str("", st.sectionCtrB));
  put("H", row, fml(`IFERROR(SUM(G${cestFirst}:G${cestLast})/I3+H${rowSumNoCest},"ŽÁDNÁ CESTOVNÍ POZICE")`, st.sumVal));
  put("I", row, str("", st.sectionCtr));
  put("K", row, str("", st.plain));
  row++;

  /* ------------------------------- CHL: SAZO ------------------------------- */
  rowHeights[row] = 17.1;
  fillRange("A", "F", row, st.section, str("SAZO", st.section));
  put("G", row, str("POČET", st.sectionCtr));
  put("H", row, str("POZNÁMKA", st.sectionCtr));
  put("I", row, str("", st.sectionCtr));
  merge("H", row, "I", row);
  put("K", row, str("", st.plain));
  row++;
  const sazoFirst = row;
  CHL_SAZO.forEach((name, i) => {
    rowHeights[row] = 17.1;
    put("A", row, str(i === 0 ? "SAZO" : "", st.subLabel));
    put("B", row, str(i === 0 ? "ATM" : "", st.subLabel));
    fillRange("C", "F", row, st.item, str(name, st.item));
    put("G", row, num("", st.input));
    put("H", row, str("", st.inputNote));
    put("I", row, str("", st.inputNote));
    merge("H", row, "I", row);
    put("K", row, str("", st.plain));
    row++;
  });
  merge("A", sazoFirst, "A", row - 1);
  merge("B", sazoFirst, "B", row - 1);
  const sazoLast = row - 1;

  /* -------------------- CHL: nábytek (BUSINESS ZONE / BACK OFFICE) --------- */
  // Vrátí { first, last } řádků s nábytkem dané sekce.
  //
  // `zoneLabel` kopíruje vzor: v BUSINESS ZONE má každá zóna segmentu vlastní
  // popisek ve sloupci C (SERVICE ZONE / MEETING ZONE), zatímco BACK OFFICE má
  // jediný popisek „BACKOFFICE ZONE“ sloučený přes celou sekci.
  function writeFurnitureSection(title, sideLabel, blocks, zoneLabel) {
    rowHeights[row] = 17.1;
    fillRange("A", "F", row, st.section, str(title, st.section));
    put("G", row, str("POČET", st.sectionCtr));
    put("H", row, str("WPL", st.sectionCtr));
    put("I", row, str("POZNÁMKA", st.sectionCtr));
    put("K", row, str("", st.plain));
    row++;

    const first = row;
    blocks.forEach((block) => {
      const segFirst = row;
      block.zones.forEach((zoneBlock) => {
        const zoneFirst = row;
        zoneBlock.items.forEach((furniture) => {
          rowHeights[row] = 17.1;
          put("A", row, str(row === first ? sideLabel : "", st.sideLabel));
          put("B", row, str(row === segFirst ? block.segment : "",
            useSegmentColors ? st.segmentOf(block.segment) : st.subLabel));
          put("C", row, str(zoneLabel
            ? (row === first ? zoneLabel : "")
            : (row === zoneFirst ? (ZONE_TITLES[zoneBlock.zone] || zoneBlock.zone) : ""), st.zone));
          fillRange("D", "F", row, st.item, str(furniture, st.item));
          put("G", row, num("", st.input));
          put("H", row, num("", st.input));
          put("I", row, str("", st.inputNote));
          put("K", row, str("", st.plain));
          row++;
        });
        if (!zoneLabel) merge("C", zoneFirst, "C", row - 1);
      });
      merge("B", segFirst, "B", row - 1);
    });
    const last = row - 1;
    if (last >= first) {
      merge("A", first, "A", last);
      if (zoneLabel) merge("C", first, "C", last);
    }
    return { first, last };
  }

  const bz = writeFurnitureSection("BUSINESS ZONE", "FRONT OFFICE", frontOffice, null);
  const bo = writeFurnitureSection("BACK OFFICE", "BACK OFFICE", backOffice, "BACKOFFICE ZONE");

  /* ----------------------------- CHL: SUMMARY ----------------------------- */
  rowHeights[row] = 17.1;
  fillRange("A", "F", row, st.section, str("SUMMARY", st.section));
  put("G", row, str("POČET", st.sectionCtr));
  put("H", row, str("", st.sectionCtr));
  put("I", row, str("", st.sectionCtr));
  merge("G", row, "I", row);
  put("K", row, str("", st.plain));
  row++;
  const summaryLines = [
    ["Počet strojů ATM:", `SUM(G${sazoFirst}:G${sazoLast})`],
    ["Celkem WPL BUSINESS ZONE:", `SUM(H${bz.first}:H${bz.last})`],
    ["Celkem WPL BACK OFFICE:", `SUM(H${bo.first}:H${bo.last})`],
  ];
  const summaryRows = [];
  summaryLines.forEach(([label, formula]) => {
    rowHeights[row] = 17.1;
    fillRange("A", "F", row, st.label, str(label, st.label));
    put("G", row, fml(formula, st.sumVal));
    put("H", row, str("", st.sumVal));
    put("I", row, str("", st.sumVal));
    merge("G", row, "I", row);
    put("K", row, str("", st.plain));
    summaryRows.push(row);
    row++;
  });
  rowHeights[row] = 17.1;
  fillRange("A", "F", row, st.label, str("Počet WPL celkem:", st.label));
  put("G", row, fml(`G${summaryRows[1]}+G${summaryRows[2]}`, st.sumVal));
  put("H", row, str("", st.sumVal));
  put("I", row, str("", st.sumVal));
  merge("G", row, "I", row);
  put("K", row, str("", st.plain));
  const rowWplTotal = row;
  row++;
  // Titulek v A1/H1 odkazuje na celkový počet WPL a název pobočky
  chl.A1 = { f: `_xlfn.CONCAT("CHECKLIST"," - ",C3)`, v: "CHECKLIST", t: "str", s: st.title };
  chl.H1 = { f: `CONCATENATE("WPL celkem: ",G${rowWplTotal})`, v: "WPL celkem: 0", t: "str", s: st.titleCtrN };

  /* ---------------------------- CHL: vybavení ----------------------------- */
  rowHeights[row] = 17.1;
  fillRange("A", "F", row, st.section, str("VYBAVENÍ", st.section));
  put("G", row, str("POČET", st.sectionCtr));
  put("H", row, str("POZNÁMKA", st.sectionCtr));
  put("I", row, str("", st.sectionCtr));
  merge("H", row, "I", row);
  put("K", row, str("", st.plain));
  row++;
  CHL_VYBAVENI.forEach(([groupName, items]) => {
    const groupFirst = row;
    items.forEach((item, i) => {
      rowHeights[row] = 17.1;
      put("A", row, str(i === 0 ? groupName : "", st.sideLabel));
      fillRange("B", "F", row, st.item, str(item, st.item));
      put("G", row, num("", st.input));
      put("H", row, str("", st.inputNote));
      put("I", row, str("", st.inputNote));
      merge("H", row, "I", row);
      put("K", row, str("", st.plain));
      row++;
    });
    merge("A", groupFirst, "A", row - 1);
  });

  /* -------------------- CHL: doplňující informace + klíče ----------------- */
  rowHeights[row] = 17.1;
  fillRange("A", "I", row, st.section, str("DOPLŇUJÍCÍ INFORMACE K CHECKLISTU  ▼", st.section));
  put("K", row, str("", st.plain));
  row++;
  const noteFirst = row;
  for (let i = 0; i < NOTE_ROWS; i++) {
    rowHeights[row] = 17.1;
    for (const c of "ABCDEFGHI") put(c, row, str("", st.noteArea));
    put("K", row, str("", st.plain));
    row++;
  }
  merges.push(`A${noteFirst}:I${row - 1}`);

  // Patička: čím byla šablona vygenerovaná. Kromě data a verze referenčních dat
  // se zvlášť vypisuje, z jakých dat vznikl seznam pozic a seznam nábytku —
  // včetně verze, ve které se naposledy měnily (stampy u jednotlivých řádků).
  const posCountTpl = positionSegments.reduce((n, sg) => n + positionsBySegment[sg].length, 0);
  const furnCountTpl = frontOffice.concat(backOffice)
    .reduce((n, b) => n + b.zones.reduce((m, z) => m + z.items.length, 0), 0);
  const posStamp = dbAll("SELECT MAX(ref_version_id) AS v FROM casove_dotace")[0];
  const furnStamp = dbAll("SELECT MAX(ref_version_id) AS v FROM furniture_to_zone")[0];
  const stampText = (v) => (v ? `naposledy změněno ve verzi #${v}` : "verze u řádků neevidována");
  const generatedAt = `${new Date().toLocaleString("cs-CZ")} · referenční data verze #${refVersionId}`;
  // [popisek, hodnota, odemčeno pro vyplnění]
  [["Load key:", "", true],
    ["Calculation key:", "", true],
    ["Vygenerováno:", generatedAt, false],
    ["Referenční data — pozice:", `verze #${refVersionId} · ${posCountTpl} pozic · ${stampText(posStamp.v)}`, false],
    ["Referenční data — nábytek:", `verze #${refVersionId} · ${furnCountTpl} prvků · ${stampText(furnStamp.v)}`, false],
    ["Odkaz na sharepoint item:", "", true]]
    .forEach(([label, value, editable]) => {
      rowHeights[row] = 17.1;
      put("A", row, str(label, st.label));
      put("B", row, str("", st.label));
      merge("A", row, "B", row);
      const cellStyle = editable ? st.itemInput : st.item;
      fillRange("C", "I", row, cellStyle, str(value, cellStyle));
      put("K", row, str("", st.plain));
      row++;
    });

  /* ------------------------------- VSTUPY --------------------------------- */
  // Hodnoty se stahují vzorci z CHL; parseVstupySheet() čte C1–C4 a od řádku 6
  // sloupce A–D, takže rozvržení tohoto listu musí zůstat přesně takto.
  const vs = {};
  const vstupyHeader = sb.style({ font: { name: FONT, size: 10, color: W }, fill: CHL_C.title, border: "lrtb", alignment: { h: "left", v: "center" } });
  const vstupyHeaderB = sb.style({ font: { name: FONT, size: 10, bold: true, color: W }, fill: CHL_C.title, border: "lrtb", alignment: { h: "left", v: "center" } });
  const vstupyCell = sb.style({ border: "lrtb", alignment: { h: "left", v: "center" } });

  [["ID pobočky", "CHL!G1"], ["Název pobočky", "CHL!C3"],
    ["Otevírací doba pobočky (hodin týdně)", "CHL!I3"], ["Doba vytěžení zaměstnanců (hodin týdně)", "CHL!I6"]]
    .forEach(([label, formula], i) => {
      const r = i + 1;
      vs[`A${r}`] = str(label, vstupyHeader);
      vs[`B${r}`] = str("", vstupyHeader);
      vs[`C${r}`] = { f: formula, v: "", s: vstupyCell };
      vs[`D${r}`] = str("", vstupyCell);
    });
  // Směnový režim: otevírací doba výrazně vyšší než doba vytížení pozice znamená,
  // že se zaměstnanci na pobočce střídají (typicky obchodní centrum otevřené 7 dní
  // v týdnu). Příznak se počítá vzorcem, aby ho vyplněný checklist nesl s sebou;
  // v aplikaci se pak dá u načteného checklistu přepnout zaškrtávátkem.
  vs.E1 = str("Směnový režim (otevírací doba > doba vytěžení)", vstupyHeader);
  vs.F1 = { f: `IF(CHL!I3-CHL!I6>${SHIFT_TOLERANCE_H},"ANO","NE")`, v: "", t: "str", s: vstupyCell };
  ["Segment", "Pozice", "Počet FTE", "Vytěžení WPL"].forEach((h, i) => {
    vs[`${"ABCD"[i]}5`] = str(h, vstupyHeaderB);
  });

  let vr = 6;
  positionSegments.forEach((segment) => {
    positionsBySegment[segment].forEach((pozice) => {
      const chlRow = positionRowMap[`${segment}||${pozice}`];
      vs[`A${vr}`] = str(segment, vstupyCell);
      vs[`B${vr}`] = str(pozice, vstupyCell);
      vs[`C${vr}`] = { f: `CHL!H${chlRow}`, v: "", s: vstupyCell };
      vs[`D${vr}`] = { f: "$C$4", v: "", s: vstupyCell };
      vr++;
    });
  });
  // Cestovní blok — pozice, FTE i vytížení se tahají z volných řádků CHL.
  for (let i = 0; i < CESTOVNI_ROWS; i++) {
    const cr = cestFirst + i;
    vs[`A${vr}`] = { f: `IF(CHL!B${cr}=0,"","CESTOVNÍ")`, v: "", t: "str", s: vstupyCell };
    vs[`B${vr}`] = { f: `IF(CHL!B${cr}=0,"",CHL!B${cr})`, v: "", t: "str", s: vstupyCell };
    vs[`C${vr}`] = { f: `IF(CHL!B${cr}=0,"",CHL!H${cr})`, v: "", t: "str", s: vstupyCell };
    vs[`D${vr}`] = { f: `IF(CHL!B${cr}=0,"",CHL!G${cr})`, v: "", t: "str", s: vstupyCell };
    vr++;
  }

  /* --------- Pomocný list se seznamem poboček (zdroj rozbalovacího menu) ---- */
  const pob = {};
  const pobHeader = sb.style({ font: { name: FONT, size: 10, bold: true, color: W }, fill: CHL_C.title, border: "lrtb", alignment: { h: "left", v: "center" } });
  const pobCell = sb.style({ font: { name: FONT, size: 9 }, border: "lrtb", alignment: { h: "left", v: "center" } });
  ["Název pobočky", "ID pobočky", "Region"].forEach((h, i) => { pob[`${"ABC"[i]}1`] = str(h, pobHeader); });
  pobockyRows.forEach((r, i) => {
    const rr = i + 2;
    pob[`A${rr}`] = str(r.nazev, pobCell);
    // ID se zapisuje jako číslo, pokud číslem je — aby G1 (a tedy VSTUPY!C1)
    // vypadalo stejně jako ve vzoru.
    const idNum = toNumberOrNull(r.id_pobocky);
    pob[`B${rr}`] = idNum !== null ? num(idNum, pobCell) : str(r.id_pobocky, pobCell);
    pob[`C${rr}`] = str(r.region || "", pobCell);
  });

  // Zámek listu: zamkne se všechno kromě buněk označených jako odemčené
  // (vyplňovaná pole hlavičky, počty FTE/kusů/WPL, poznámky, volné řádky
  // cestovních pozic a klíče v patičce). Vypnout ho lze v Nastavení.
  const sheetProtection = getSettingBool("tpl_protect_sheet")
    ? { password: getSetting("tpl_protect_password") || "" } : null;

  const chlSheet = {
    name: "CHL", cells: chl, cols: chlColWidths(), merges,
    rowHeights, defaultRowHeight: 15, freezeRows: getSettingBool("tpl_freeze_header") ? 9 : 0, validations,
    // tlačítko pro rozbalení skupiny (sloupec K) vlevo od ní, u popisku v J
    summaryRight: false,
    protect: sheetProtection,
  };
  // Pobočka vyplňuje jen CHL; VSTUPY (odkud aplikace čte) i pomocný seznam
  // poboček jsou skryté, aby ji nepletly. Skrytí neovlivní ani vzorce, ani
  // rozbalovací menu, ani zpětné načtení souboru do aplikace.
  const vstupySheet = {
    name: "VSTUPY", cells: vs, cols: VSTUPY_COL_WIDTHS, defaultRowHeight: 15, freezeRows: 5,
    hidden: getSettingBool("tpl_hide_helper_sheets"), protect: sheetProtection,
  };
  const pobockySheet = {
    name: POBOCKY_SHEET, cells: pob, defaultRowHeight: 15, freezeRows: 1,
    hidden: getSettingBool("tpl_hide_helper_sheets"), protect: sheetProtection,
    cols: [{ index: 1, width: 42 }, { index: 2, width: 14 }, { index: 3, width: 26 }],
  };

  const out = buildXlsxWorkbook([chlSheet, vstupySheet, pobockySheet], sb);
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `checklist_sablona_refdata-v${refVersionId}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  renderRefVersionsList();
  toast(`Excel šablona vygenerována z referenčních dat verze #${refVersionId} ` +
    `(${posCountTpl} pozic, ${furnCountTpl} nábytkových prvků)` +
    `${sheetProtection ? ", list je zamčený — editovat lze jen vyplňovaná pole" : ""}. ` +
    `Pobočka vyplňuje list CHL, ${getSettingBool("tpl_hide_helper_sheets") ? "skrytý " : ""}list VSTUPY ` +
    `si hodnoty stahuje automaticky.`, "ok");
}

/* --------------------------------- Tabs ------------------------------------ */

function refreshAllTabsAfterDbChange() {
  refreshSegmentMetaCache();
  refreshSettingsCache();
  renderSpecialistInfo();
  renderSettingsPanel();
  renderHistoryList();
  renderAbsenceTable();
  dotaceEditorMain.render();
  renderRefVersionsList();
  renderPobockyDatalist();
  renderSegmentsTable();
  renderFurnitureTable();
  renderLayoutRulesHelp();
  renderVisitorList();
  renderAnalyticsSources();
  renderBranchExportList();
  // Doplňkové soubory ve složce s aplikací se zkusí připojit samy — jen ty,
  // které v databázi ještě nejsou.
  autoAttachAnalytics({ silent: true });
  document.getElementById("refVersionDetail").style.display = "none";
  document.getElementById("historyDetailPanel").style.display = "none";
}

function setupTabs() {
  document.querySelectorAll(".tabbtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabbtn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll("section.tab").forEach((s) => s.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
      // Na záložce s dodatečnou analytikou se zkusí doplnit, co ve složce
      // přibylo (už načtené zdroje zůstanou nedotčené).
      if (btn.dataset.tab === "analytics") {
        renderAnalyticsSources();
        renderBranchExportList();
        autoAttachAnalytics({ silent: true });
      }
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

  document.getElementById("btnChooseExcel").addEventListener("click", () => chooseSource("excel"));
  document.getElementById("btnChooseManual").addEventListener("click", () => chooseSource("manual"));
  document.getElementById("btnChangeSource").addEventListener("click", (e) => { e.preventDefault(); goToWizardStep(1); });
  document.getElementById("btnNewCalculation").addEventListener("click", () => goToWizardStep(1));
  document.querySelectorAll("#stepper .step").forEach((el) => {
    const n = Number(el.dataset.step);
    if (n > 2) return;
    el.addEventListener("click", () => {
      if (n === 1 || wizardStep >= 2) goToWizardStep(n);
    });
  });

  document.getElementById("manualPobockaName").addEventListener("input", (e) => {
    const regionInfo = document.getElementById("manualRegionInfo");
    const idInput = document.getElementById("manualPobockaId");
    if (!db) return;
    const row = dbAll("SELECT id_pobocky, region FROM pobocky WHERE nazev = ?", [e.target.value])[0];
    if (row) {
      idInput.value = row.id_pobocky;
      regionInfo.textContent = `Region: ${row.region}`;
    } else {
      regionInfo.textContent = e.target.value ? "Pobočka nenalezena v seznamu — zadejte ID pobočky ručně." : "";
    }
  });
  document.getElementById("btnAddManualRow").addEventListener("click", addManualRow);
  // Směnový režim: info řádek se přepočítává při každé změně hodin a při rozdílu
  // se zaškrtávátko nabídne samo (uživatel ho může odškrtnout).
  const refreshShiftInfo = (autoCheck) => {
    const open = toNumberOrNull(document.getElementById("manualOtevDoba").value) ?? 0;
    const load = toNumberOrNull(document.getElementById("manualVytezeniWpl").value) ?? 0;
    const box = document.getElementById("manualShiftMode");
    if (autoCheck && isShiftMode(open, load)) box.checked = true;
    if (autoCheck && !isShiftMode(open, load)) box.checked = false;
    document.getElementById("manualShiftInfo").innerHTML = shiftInfoHtml(open, load, box.checked);
  };
  ["manualOtevDoba", "manualVytezeniWpl"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => refreshShiftInfo(true));
  });
  document.getElementById("manualShiftMode").addEventListener("change", () => refreshShiftInfo(false));
  const specialistInput = document.getElementById("specialistInput");
  document.getElementById("btnPickSpecialistFile").addEventListener("click", () => specialistInput.click());
  specialistInput.addEventListener("change", () => {
    if (specialistInput.files[0]) handleSpecialistExportFile(specialistInput.files[0]);
    specialistInput.value = "";
  });
  document.getElementById("btnLoadSpecialists").addEventListener("click", () => applySpecialistPositions());
  document.getElementById("btnCommitManual").addEventListener("click", handleCommitManual);

  document.getElementById("btnAddAbsenceRow").addEventListener("click", () => {
    document.getElementById("absenceTbody").insertAdjacentHTML("beforeend", absenceRowHtml({ segment: "", nepritomnost: 0, homeoffice: 0 }));
    wireDeleteButtons("absenceTbody");
  });
  document.getElementById("btnSaveAbsence").addEventListener("click", saveAbsenceTable);
  wireTableFilter("absenceFilter", "absence", renderAbsenceTable);
  document.getElementById("btnAddDotaceRow").addEventListener("click", dotaceEditorMain.addRow);
  document.getElementById("btnSaveDotace").addEventListener("click", dotaceEditorMain.save);
  document.getElementById("dotaceFilter").addEventListener("input", (e) => dotaceEditorMain.setFilter(e.target.value));

  document.getElementById("btnAddSegmentRow").addEventListener("click", () => {
    document.getElementById("segmentsTbody").insertAdjacentHTML("beforeend", segmentRowHtml({ segment_key: "", nazev: "", sort_order: 0, color: "#6b7684", icon: "" }));
    wireDeleteButtons("segmentsTbody");
  });
  document.getElementById("btnSaveSegments").addEventListener("click", saveSegmentsTable);
  wireTableFilter("segmentsFilter", "segments", renderSegmentsTable);
  document.getElementById("btnAddFurnitureRow").addEventListener("click", () => {
    document.getElementById("furnitureTbody").insertAdjacentHTML("beforeend", furnitureRowHtml({ segment: "", zone: ZONES[0], furniture: "", wpl_counter: 0 }));
    wireDeleteButtons("furnitureTbody");
  });
  document.getElementById("btnSaveFurniture").addEventListener("click", saveFurnitureTable);
  document.getElementById("btnCopyFurnitureRef").addEventListener("click", copyFurnitureRefToClipboard);
  wireTableFilter("furnitureFilter", "furniture", renderFurnitureTable);
  document.getElementById("furnitureZoneFilter").addEventListener("change", (e) => {
    tableFilterState.furnitureZone = e.target.value;
    renderFurnitureTable();
  });
  document.getElementById("btnDataOverview").addEventListener("click", showDataOverview);
  document.getElementById("btnSaveSettings").addEventListener("click", saveSettingsPanel);
  document.getElementById("btnResetSettings").addEventListener("click", resetSettingsPanel);
  document.getElementById("btnGenerateTemplate").addEventListener("click", generateChecklistTemplate);

  const visitorInput = document.getElementById("visitorReportInput");
  document.getElementById("btnPickVisitorReport").addEventListener("click", () => visitorInput.click());
  visitorInput.addEventListener("change", () => {
    if (visitorInput.files[0]) handleVisitorReportFile(visitorInput.files[0]);
    visitorInput.value = "";
  });
  document.getElementById("visitorFilter").addEventListener("input", (e) => {
    visitorFilterText = e.target.value;
    renderVisitorList();
  });

  // Dodatečná analytika: automatické hledání souborů, připojení složky
  // a ruční připojení jednotlivých souborů.
  document.getElementById("btnAutoAttach").addEventListener("click", () => autoAttachAnalytics({ force: true }));
  document.getElementById("btnPickDataDir").addEventListener("click", pickDataDirectory);
  const analyticsInput = document.getElementById("analyticsFileInput");
  analyticsInput.addEventListener("change", () => {
    const file = analyticsInput.files[0];
    const key = analyticsInput.dataset.source;
    analyticsInput.value = "";
    if (file) handleAnalyticsPickedFile(file, key);
  });
  document.getElementById("branchExportFilter").addEventListener("input", (e) => {
    branchExportFilter = e.target.value;
    renderBranchExportList();
  });
  renderAnalyticsSources();

  // Nápověda k pravidlům předvyplnění layoutu — obsah se generuje z LAYOUT_RULES.
  renderLayoutRulesHelp();

  updateStepper();

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
