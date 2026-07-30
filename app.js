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
  ref_version_id INTEGER
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
  dotace_json TEXT
);
CREATE TABLE IF NOT EXISTS furniture_to_zone (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment TEXT,
  furniture TEXT,
  zone TEXT,
  wpl_counter REAL
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
`;

// Doplní chybějící tabulky/sloupce v databázích vytvořených starší verzí aplikace.
function migrateSchema(dbi) {
  dbi.run(SCHEMA_SQL);
  try { dbi.run("ALTER TABLE calculations ADD COLUMN ref_version_id INTEGER"); } catch (e) { /* sloupec už existuje */ }
  try { dbi.run("ALTER TABLE calculations ADD COLUMN status TEXT"); } catch (e) { /* sloupec už existuje */ }
  dbi.run("UPDATE calculations SET status = 'rozpracovana' WHERE status IS NULL");
  try { dbi.run("ALTER TABLE calculations ADD COLUMN duvod TEXT"); } catch (e) { /* sloupec už existuje */ }
  // Verze referenčních dat, ve které daný řádek naposledy vznikl nebo se změnil.
  try { dbi.run("ALTER TABLE absence ADD COLUMN ref_version_id INTEGER"); } catch (e) { /* sloupec už existuje */ }
  try { dbi.run("ALTER TABLE casove_dotace ADD COLUMN ref_version_id INTEGER"); } catch (e) { /* sloupec už existuje */ }
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
  const pobockyCount = dbAll("SELECT COUNT(*) AS n FROM pobocky", [], dbi)[0].n;
  if (pobockyCount === 0) {
    const ins = dbi.prepare("INSERT INTO pobocky (id_pobocky, nazev, region) VALUES (?, ?, ?)");
    SEED_POBOCKY.forEach((r) => { ins.run(r); });
    ins.free();
  }
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

function hexToRgb(hex) {
  const h = String(hex || "#6b7684").replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16) || 0, parseInt(n.slice(2, 4), 16) || 0, parseInt(n.slice(4, 6), 16) || 0];
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
  const insFurniture = db.prepare("INSERT INTO furniture_to_zone (segment, furniture, zone, wpl_counter) VALUES (?, ?, ?, ?)");
  SEED_FURNITURE.forEach((r) => { insFurniture.run(r); });
  insFurniture.free();
  const insPobocky = db.prepare("INSERT INTO pobocky (id_pobocky, nazev, region) VALUES (?, ?, ?)");
  SEED_POBOCKY.forEach((r) => { insPobocky.run(r); });
  insPobocky.free();
  const insSegments = db.prepare("INSERT INTO segments (segment_key, nazev, sort_order, color, icon) VALUES (?, ?, ?, ?, ?)");
  SEED_SEGMENTS.forEach((r) => { insSegments.run(r); });
  insSegments.free();
  const versionId = ensureRefVersionUpToDate("Založení nové databáze");
  // Výchozí referenční data patří do první verze.
  dbRun("UPDATE absence SET ref_version_id = ?", [versionId]);
  dbRun("UPDATE casove_dotace SET ref_version_id = ?", [versionId]);
  refreshSegmentMetaCache();
}

function loadDatabaseFromBytes(bytes) {
  const candidate = new SQL.Database(new Uint8Array(bytes));
  migrateSchema(candidate); // doplní chybějící tabulky/sloupce ze starších verzí aplikace, zbytek dat zachová
  db = candidate;
  const versionId = ensureRefVersionUpToDate("Stav při připojení databáze");
  // Řádky referenčních dat z databází uložených před zavedením evidence verzí
  // u jednotlivých řádků dostanou verzi platnou při připojení — její snapshot
  // tyto hodnoty skutečně obsahuje, takže je zařazení správné. Další úpravy už
  // stamp posunou jen u řádků, které se opravdu změní.
  dbRun("UPDATE absence SET ref_version_id = ? WHERE ref_version_id IS NULL", [versionId]);
  dbRun("UPDATE casove_dotace SET ref_version_id = ? WHERE ref_version_id IS NULL", [versionId]);
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
    rows,
  };
}

// Uloží řádky pozic pro pobočku do excel_loads (ať už pochází z nahraného Excelu,
// nebo z manuálního zadání) a nastaví je jako aktuálně rozpracovaný checklist
// (pendingLoad), ze kterého se pak spočítá kalkulace — od tohoto bodu je průběh
// pro obě cesty zadání naprosto shodný.
async function commitLoad(pobocka_id, pobocka_nazev, oteviraci_doba, rows) {
  const load_key = `load_${pobocka_id}-${pobocka_nazev}-${nowStamp()}`;
  const createdAt = nowIso();

  const ins = db.prepare(`INSERT INTO excel_loads
    (load_key, pobocka_id, pobocka_nazev, oteviraci_doba, segment, pozice, fte, wpl_load, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  rows.forEach((r) => {
    ins.run([load_key, pobocka_id, pobocka_nazev, oteviraci_doba, r.segment, r.pozice, r.fte, r.wpl_load, createdAt]);
  });
  ins.free();

  await persistDatabase();

  const committed = { load_key, pobocka_id, pobocka_nazev, oteviraci_doba, rows };
  pendingLoad = committed;
  return committed;
}

async function handleExcelFile(file) {
  const msgsEl = document.getElementById("excelMsgs");
  msgsEl.innerHTML = "";
  document.getElementById("excelPreview").innerHTML = "";
  document.getElementById("resultsPanel").style.display = "none";
  document.getElementById("layoutPanel").style.display = "none";
  if (!requireDb()) return;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const parsed = parseVstupySheet(wb);
    if (!parsed.rows.length) {
      msgsEl.innerHTML = `<div class="msg err">V listu „VSTUPY“ nebyl nalezen žádný řádek s FTE &gt; 0.</div>`;
      return;
    }
    const committed = await commitLoad(parsed.pobocka_id, parsed.pobocka_nazev, parsed.oteviraci_doba, parsed.rows);
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
  }
  updateStepper();
}

function chooseSource(mode) {
  document.getElementById("sourceSummaryText").textContent = mode === "excel" ? "Excel checklist" : "Manuální zadání";
  document.getElementById("modeExcel").style.display = mode === "excel" ? "block" : "none";
  document.getElementById("modeManual").style.display = mode === "manual" ? "block" : "none";
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

  const committed = await commitLoad(pobocka_id, pobocka_nazev, oteviraci_doba, rows);
  msgsEl.innerHTML = `<div class="msg ok">Kalkulace vytvořena manuálně: <strong>${esc(pobocka_nazev)}</strong>
    (ID ${esc(pobocka_id)}), ${rows.length} pozic s FTE &gt; 0.</div>`;
  renderExcelPreview(committed);
}

/* ------------------------------- Kalkulace -------------------------------- */

function runCalculation() {
  if (!pendingLoad) return;
  const { load_key, oteviraci_doba } = pendingLoad;

  const duvod = document.getElementById("calcReason").value;
  if (!duvod) { toast("Vyberte důvod kalkulace.", "err"); return; }

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

  const inputRows = rows.map((r) => ({ segment: r.segment, pozice: r.pozice, fte: r.fte, wpl_load: r.wpl_load }));
  const stats = computeCalculationStats({ rows: resultRows, celkem: celkemRow, inputRows });
  persistCalculationStats(calculation_key, load_key, stats, createdAt);

  persistDatabase();

  renderResults({ calculation_key, load_key, createdAt, rows: resultRows, celkem: celkemRow, warnings, inputRows,
    refVersionId, pobocka_id: pendingLoad.pobocka_id, pobocka_nazev: pendingLoad.pobocka_nazev, oteviraci_doba, duvod });
  goToWizardStep(4);
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
  const stats = computeCalculationStats(result);
  const status = getCalculationStatus(result.calculation_key);

  document.getElementById("resultsArea").innerHTML = `
    ${warnHtml}
    <p class="muted">Calculation key: <code>${esc(result.calculation_key)}</code> · Load key: <code>${esc(result.load_key)}</code></p>
    ${result.duvod ? `<p class="muted">Důvod kalkulace: <strong>${esc(result.duvod)}</strong></p>` : ""}
    <div class="status-row">${statusBadgeHtml(status)} ${statusToggleButtonHtml(status)}</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Segment</th><th>FTE celkem</th><th>Pozice (FTE)</th>
          <th>Service zone</th><th>Meeting zone</th><th>Backoffice zone</th><th>Office room</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    ${refVersionDetailsHtml(result.refVersionId)}
    ${renderStatsSection(stats, "pdfIncludeStats")}
    <div class="row" style="margin-top:14px;">
      <button class="btn secondary" id="btnExportPdf">Exportovat PDF s přehledem WPL</button>
      <button class="btn secondary" id="btnCopyResult">📋 Kopírovat výsledek do schránky</button>
    </div>
    <p class="muted" style="margin-top:6px;">Zkopíruje se jako formátovaná tabulka — vložením (Ctrl+V) do MS Teams,
      Outlooku nebo Wordu se vloží včetně formátování.</p>
    <div style="margin-top:10px; max-width:480px;">
      <label class="muted" for="pdfNote">Poznámka do PDF (nepovinné):</label>
      <textarea id="pdfNote" rows="2"></textarea>
    </div>`;
  document.getElementById("btnExportPdf").addEventListener("click", () => {
    const note = document.getElementById("pdfNote").value.trim();
    const includeStats = document.getElementById("pdfIncludeStats").checked;
    exportCalculationPdf(result, { note, includeStats });
  });
  document.getElementById("btnCopyResult").addEventListener("click", () => copyResultToClipboard(result, stats));
  document.getElementById("btnToggleStatus").addEventListener("click", () => {
    setCalculationStatus(result.calculation_key, status === "potvrzena" ? "rozpracovana" : "potvrzena");
    renderResults(result);
    renderHistoryList();
  });

  document.getElementById("layoutPanel").style.display = "block";
  renderLayoutSection("layoutArea", result.rows, {
    calculation_key: result.calculation_key, pobocka_id: result.pobocka_id, pobocka_nazev: result.pobocka_nazev, stats,
    // Data kalkulace pro "Generovat celou sestavu" (kalkulace + layout v jednom PDF)
    calcResult: result, pdfNoteId: "pdfNote", pdfStatsId: "pdfIncludeStats",
  });
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

  const kpi = [
    ["Stanovený formát pobočky", esc(stats.formatTyp)],
    ["Doporučený počet fasttracků na hale", String(stats.recommendedFasttracks)],
    ["Doporučený počet židlí v čekací zóně", String(stats.recommendedChairs)],
    ["Potřebná plocha (WPL × 25 m²)", `${stats.requiredAreaM2.toFixed(1)} m²`],
    ["Poměr WPL / FTE", stats.wplFteRatio === null ? "—" : `${stats.wplFteRatio.toFixed(1)} %`],
    ["Podíl Backoffice zóny", stats.backofficePct === null ? "—" : `${stats.backofficePct.toFixed(1)} %`],
    ["Podíl míst pro jednání s klientem", stats.meetingPct === null ? "—" : `${stats.meetingPct.toFixed(1)} %`],
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

async function copyResultToClipboard(result, stats) {
  const html = buildResultClipboardHtml(result, stats);
  const text = buildResultClipboardText(result, stats);

  // Preferovaná cesta: asynchronní Clipboard API s oběma formáty současně.
  try {
    if (navigator.clipboard && typeof window.ClipboardItem === "function") {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
      toast("Výsledek zkopírován — vložte do Teams přes Ctrl+V.", "ok");
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
    if (ok) { toast("Výsledek zkopírován — vložte do Teams přes Ctrl+V.", "ok"); return true; }
    throw new Error("execCommand('copy') vrátil false");
  } catch (e) {
    console.error(e);
    toast("Kopírování do schránky se nezdařilo: " + e.message, "err");
    return false;
  }
}

// Zobrazí formát pobočky, doporučení pro layout a poměrové ukazatele (WPL/FTE,
// podíl backoffice a míst pro jednání s klientem) včetně srovnání s benchmarkem
// ostatních kalkulací se stejným formátem pobočky. checkboxId řídí, jestli se
// tato sekce zahrne i do PDF exportu.
function renderStatsSection(stats, checkboxId) {
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
      <h3>Klíčové ukazatele</h3>
      <div class="table-wrap"><table class="kpi-table">
        <tr><td>Stanovený formát pobočky</td><td><strong>${esc(stats.formatTyp)}</strong>
          <span class="muted">(dle ${stats.obchodniFteSumDisplay} obchodních FTE)</span></td></tr>
        <tr><td>Doporučený počet fasttracků na hale</td><td>${stats.recommendedFasttracks}</td></tr>
        <tr><td>Doporučený počet židlí v čekací zóně</td><td>${stats.recommendedChairs}</td></tr>
        <tr><td>Potřebná plocha</td><td>${stats.requiredAreaM2.toFixed(1)} m² <span class="muted">(WPL × 25 m²)</span></td></tr>
        <tr><td>Poměr WPL / FTE</td><td>${fmtPct(stats.wplFteRatio)}${deltaHtml(stats.wplFteRatio, benchmark?.avg_ratio)}</td></tr>
        <tr><td>Podíl Backoffice zóny</td><td>${fmtPct(stats.backofficePct)}${deltaHtml(stats.backofficePct, benchmark?.avg_backoffice)}</td></tr>
        <tr><td>Podíl míst pro jednání s klientem (meeting zone)</td><td>${fmtPct(stats.meetingPct)}${deltaHtml(stats.meetingPct, benchmark?.avg_meeting)}</td></tr>
      </table></div>
      <p class="muted">${benchmarkNote}</p>
      <label class="muted"><input type="checkbox" id="${checkboxId}" checked> Zahrnout klíčové ukazatele a benchmark do PDF</label>
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
    recommendedFasttracks: Math.ceil(combinedTotal * 0.15),
    recommendedChairs: Math.ceil(combinedTotal * 0.50),
    celkemFte,
    celkemWpl,
    requiredAreaM2: celkemWpl * 25,
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

function statusToggleButtonHtml(status) {
  const confirmed = status === "potvrzena";
  return `<button class="btn secondary small" id="btnToggleStatus">${confirmed ? "Vrátit do rozpracované" : "Potvrdit / uzavřít kalkulaci"}</button>`;
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

function exportCalculationPdf(result, options) {
  const pdf = newPdfDoc();
  drawCalculationPdf(pdf, 18, result, options);
  pdf.save(`export_${result.calculation_key}.pdf`);
}

// Vykreslí část "Kalkulace FTE → WPL" do už existujícího PDF dokumentu od
// zadané souřadnice y a vrátí y za poslední vykreslenou částí. Díky tomu jde
// stejný obsah použít jak pro samostatný export kalkulace, tak pro spojenou
// sestavu (kalkulace + layout v jednom PDF).
function drawCalculationPdf(pdf, startY, result, options) {
  const { note = "", includeStats = true } = options || {};
  const marginX = 14;
  let y = startY;
  const pageBottom = 280;

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

  const version = result.refVersionId ? getRefVersionById(result.refVersionId) : null;
  const presentSegments = [...new Set((result.inputRows || []).map((r) => r.segment))];
  if (version) {
    pdf.text(`Referenční data: verze #${version.id} — ${version.note} (${new Date(version.created_at).toLocaleString("cs-CZ")})`, marginX, y);
    y += 6;
    const absenceParts = presentSegments.map((seg) => {
      const [nepritomnost, homeoffice] = absenceFromSnapshot(version.absence, seg);
      return `${seg} ${(nepritomnost + homeoffice).toFixed(1)} %`;
    });
    const absenceLines = pdf.splitTextToSize(`Celková nepřítomnost dle segmentů: ${absenceParts.join(", ")}`, 182);
    absenceLines.forEach((line) => { pdf.text(line, marginX, y); y += 6; });
  } else {
    pdf.text("Referenční data: verze neznámá (kalkulace vytvořena před zavedením verzování).", marginX, y);
    y += 6;
  }
  y += 4;

  if ((result.inputRows || []).length) {
    pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(12);
    pdf.text("Přehled pozic z checklistu", marginX, y); y += 7;
    pdf.setFontSize(9);
    let lastSegment = null;
    result.inputRows.forEach((r) => {
      if (y > pageBottom) { pdf.addPage(); y = 18; }
      if (r.segment !== lastSegment) {
        pdf.setFont("DejaVuSans", "bold");
        const [sr, sg, sb] = hexToRgb(getSegmentMeta(r.segment).color);
        pdf.setFillColor(sr, sg, sb);
        pdf.rect(marginX, y - 2.6, 3, 3, "F");
        pdf.text(`Segment: ${r.segment}`, marginX + 4.5, y); y += 5.5;
        lastSegment = r.segment;
      }
      const wplDisplay = r.wpl_load ?? result.oteviraci_doba;
      pdf.setFont("DejaVuSans", "normal");
      pdf.text(`- ${r.pozice}, FTE: ${fmt1(r.fte)}, WPL: ${fmt1(wplDisplay)}`, marginX + 4, y); y += 5.5;
    });
    y += 4;
  }

  pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(12);
  pdf.text("Souhrnná tabulka (WPL po zónách)", marginX, y); y += 7;

  const headers = ["Segment", "FTE", "ServiceZ", "MeetingZ", "BackofficeZ", "OfficeRoom"];
  const colW = [46, 20, 26, 26, 30, 26];
  const rowH = 7;

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
  }

  drawHeader();
  result.rows.forEach((r) => drawRow([r.segment, fmt1(r.total_positions), fmt1(r.service_zone),
    fmt1(r.meeting_zone), fmt1(r.backoffice_zone), fmt1(r.office_room)]));
  drawRow(["Celkem", fmt1(result.celkem.total_positions), fmt1(result.celkem.service_zone),
    fmt1(result.celkem.meeting_zone), fmt1(result.celkem.backoffice_zone), fmt1(result.celkem.office_room)], true);

  y += 8;
  const celkemSum = (result.celkem.service_zone || 0) + (result.celkem.meeting_zone || 0) +
                     (result.celkem.backoffice_zone || 0) + (result.celkem.office_room || 0);
  const stats = computeCalculationStats(result);
  pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(9);
  pdf.text(`Celkový součet (ServiceZ + MeetingZ + BackofficeZ + OfficeRoom) z řádku 'Celkem': ${celkemSum.toFixed(2)}`, marginX, y);
  y += 9;
  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(9);
  const statLines = [
    `Součet meeting_zone pro segmenty MMMA, SBC, HC: ${stats.meetingZoneSum.toFixed(2)}`,
    `Stanovený formát dle počtu (${stats.obchodniFteSumDisplay}) obchodních FTE: ${stats.formatTyp}`,
    `Doporučený počet fasttracků na hale: ${stats.recommendedFasttracks}`,
    `Doporučený počet židlí v čekací zóně: ${stats.recommendedChairs}`,
    `Potřebná plocha (WPL × 25 m²): ${stats.requiredAreaM2.toFixed(1)} m²`,
  ];
  statLines.forEach((line) => { pdf.text(line, marginX, y); y += 6; });
  y += 4;

  if (includeStats) {
    if (y > pageBottom - 30) { pdf.addPage(); y = 18; }
    pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(12);
    pdf.text("Klíčové ukazatele a benchmark", marginX, y); y += 7;
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
      pdf.splitTextToSize(line, 182).forEach((l) => { if (y > pageBottom) { pdf.addPage(); y = 18; } pdf.text(l, marginX, y); y += 5.5; });
    });
    pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(8);
    pdf.setTextColor(120, 120, 120);
    pdf.text(benchmark ? `Benchmark vychází z ${czechCalcCount(benchmark.n)} s formátem „${stats.formatTyp}“.`
      : `Zatím není dostatek kalkulací pro benchmark formátu „${stats.formatTyp}“.`, marginX, y);
    pdf.setTextColor(0, 0, 0);
    y += 8;
  }

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
const LAYOUT_RULES = [
  {
    zone: "service_zone", furniture: "Fast track (stolek a židle)", formats: null,
    qty: ({ stats }) => stats.recommendedFasttracks,
    text: "<strong>Fast track (stolek a židle)</strong> = doporučený počet fasttracků na hale.",
  },
  {
    zone: "service_zone", furniture: "Čekací zóna (židle)", formats: ["small", "medium economy"],
    qty: ({ stats }) => stats.recommendedChairs,
    text: "<strong>Čekací zóna (židle)</strong> = doporučený počet židlí v čekací zóně.",
  },
  {
    zone: "service_zone", furniture: "Čekací zóna (obývák)", formats: ["medium", "flagship"],
    qty: ({ stats }) => stats.recommendedChairs,
    text: "<strong>Čekací zóna (obývák)</strong> = doporučený počet židlí v čekací zóně.",
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
    qty: ({ required }) => Math.floor(required),
    text: "Potřeba WPL v Backoffice zone se přiřadí na <strong>Kancelářské místo</strong> " +
      "(potřeba WPL 5 → 5 ks; desetinná část se zaokrouhluje dolů).",
  },
  {
    zone: "backoffice_zone", furniture: "Fast track backoffice", formats: null,
    qty: ({ required }) => (required - Math.floor(required) > 0.5 ? 1 : 0),
    text: "Je-li desetinná část potřeby WPL v Backoffice zone větší než 0,5, přidá se navíc " +
      "1 ks <strong>Fast track backoffice</strong>.",
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
function computeLayoutSuggestions(segmentRows, stats) {
  if (!stats) return {};
  const formatKey = normalizeFormatKey(stats.formatTyp);
  const out = {};
  segmentRows.forEach((seg) => {
    ZONES.forEach((zone) => {
      const required = seg[zone] || 0;
      const names = new Set(getFurnitureOptions(seg.segment, zone).map((o) => o.furniture));
      if (!names.size) return;
      LAYOUT_RULES.forEach((rule) => {
        if (rule.zone !== zone) return;
        if (rule.formats && !rule.formats.includes(formatKey)) return;
        if (!names.has(rule.furniture)) return;
        const qty = Math.max(0, Math.round(rule.qty({ required, stats }) || 0));
        if (qty > 0) out[`${seg.segment}||${zone}||${rule.furniture}`] = qty;
      });
    });
  });
  return out;
}

// Ikona nápovědy s výpisem všech platných pravidel — obsah se generuje
// z LAYOUT_RULES, aby odpovídal tomu, co aplikace skutečně dělá.
function layoutRulesHelpHtml() {
  const formatLabel = (formats) => formats ? `pro formát ${formats.join(", ")}` : "pro všechny formáty";
  const items = LAYOUT_RULES.map((r) =>
    `<li>${r.text} <span style="opacity:.7">(${ZONE_LABELS[r.zone]}, ${formatLabel(r.formats)})</span></li>`).join("");
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
  const suggestions = isEdit ? {} : computeLayoutSuggestions(segmentRows, meta.stats);

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
  container.innerHTML = `${groupsHtml}
    <div class="row" style="margin-top:14px;">
      <button class="btn" id="btnSaveLayout">Uložit layout</button>
    </div>`;
  wireLayoutFormListeners(container);
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
  return `<h4 style="margin-top:0;">Kompletní přehled WPL po zónách a segmentech</h4>
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
  container.innerHTML = `
    <div class="layout-group">${renderWplOverviewHtml(overview)}</div>
    ${groupsHtml}
    ${renderZoneAnalysisHtml(overview, rows)}
    ${renderPositionFurnitureHtml(meta.calcResult, rows)}
    <div class="row" style="margin-top:14px;">
      <button class="btn" id="btnExportFullReport">Generovat celou sestavu (kalkulace + layout)</button>
      <button class="btn secondary" id="btnExportLayoutPdf">Exportovat PDF layoutu</button>
      <button class="btn secondary" id="btnEditLayout">Upravit layout</button>
    </div>`;
  // Hledání v rámci `container` — viz poznámka v renderLayoutForm().
  container.querySelector("#btnExportLayoutPdf").addEventListener("click", () => exportLayoutPdf(rows, meta, segmentRows));
  container.querySelector("#btnEditLayout").addEventListener("click", () => renderLayoutForm(container, segmentRows, meta, rows));

  const btnFull = container.querySelector("#btnExportFullReport");
  if (meta.calcResult) {
    btnFull.addEventListener("click", () => {
      const noteEl = document.getElementById(meta.pdfNoteId);
      const statsEl = document.getElementById(meta.pdfStatsId);
      exportFullReportPdf(meta.calcResult, rows, meta, segmentRows, {
        note: noteEl ? noteEl.value.trim() : "",
        includeStats: statsEl ? statsEl.checked : true,
      });
    });
  } else {
    // Bez dat kalkulace (neočekávaný stav) nelze spojenou sestavu sestavit.
    btnFull.disabled = true;
    btnFull.title = "Spojenou sestavu lze vygenerovat jen z detailu kalkulace.";
  }
}

function exportLayoutPdf(rows, meta, segmentRows) {
  const pdf = newPdfDoc();
  drawLayoutPdf(pdf, 18, rows, meta, segmentRows);
  pdf.save(`layout_${meta.calculation_key || "export"}.pdf`);
}

// Spojená sestava — kalkulace i layout v jednom PDF dokumentu.
function exportFullReportPdf(result, layoutRows, meta, segmentRows, options) {
  const pdf = newPdfDoc();
  drawCalculationPdf(pdf, 18, result, options);
  pdf.addPage();
  drawLayoutPdf(pdf, 18, layoutRows, meta, segmentRows);
  pdf.save(`sestava_${meta.calculation_key || result.calculation_key || "export"}.pdf`);
  toast("Celá sestava (kalkulace + layout) byla vygenerována.", "ok");
}

// Vykreslí kompletní přehled WPL po zónách a segmentech (stejná čísla jako
// tabulka v aplikaci) a vrátí novou souřadnici y.
function drawWplOverviewPdf(pdf, startY, overview, marginX, pageBottom) {
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
      if (isTotal) pdf.setFillColor(200, 240, 210);
      pdf.rect(x, y, colW[i], rowH, isTotal ? "FD" : "D");
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

  if (y > pageBottom - 30) { pdf.addPage(); y = 18; }
  pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(12);
  pdf.text("Kompletní přehled WPL po zónách a segmentech", marginX, y); y += 7;
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

// Vykreslí část "Sestavení layoutu" do už existujícího PDF dokumentu.
function drawLayoutPdf(pdf, startY, rows, meta, segmentRows) {
  const marginX = 14;
  const pageBottom = 280;
  let y = startY;

  pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(16);
  pdf.text("Sestavení layoutu", marginX, y); y += 9;

  pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(10);
  [`Název pobočky: ${meta.pobocka_nazev || ""}`, `ID pobočky: ${meta.pobocka_id || ""}`,
    `Calculation key: ${meta.calculation_key || ""}`, `Datum vytvoření: ${new Date().toLocaleString("cs-CZ")}`]
    .forEach((line) => { pdf.text(line, marginX, y); y += 6; });
  y += 4;

  if (segmentRows && segmentRows.length) {
    y = drawWplOverviewPdf(pdf, y, computeWplOverview(segmentRows, rows, meta.calcResult?.celkem), marginX, pageBottom);
  }

  const byZone = {};
  rows.forEach((r) => { (byZone[r.zone] = byZone[r.zone] || []).push(r); });

  ZONES.forEach((zone) => {
    const zoneRows = byZone[zone];
    if (!zoneRows || !zoneRows.length) return;
    const totalPieces = zoneRows.reduce((s, r) => s + r.piece_count, 0);
    const totalWpl = zoneRows.reduce((s, r) => s + r.wpl_assigned, 0);
    if (y > pageBottom - 14) { pdf.addPage(); y = 18; }
    pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(12);
    pdf.text(`${ZONE_LABELS[zone]} — celkem: ${totalPieces} ks, WPL: ${fmt1(totalWpl)}`, marginX, y); y += 8;

    const bySegment = {};
    const segOrder = [];
    zoneRows.forEach((r) => {
      if (!bySegment[r.segment]) { bySegment[r.segment] = []; segOrder.push(r.segment); }
      bySegment[r.segment].push(r);
    });
    segOrder.forEach((segment) => {
      if (y > pageBottom - 10) { pdf.addPage(); y = 18; }
      pdf.setFont("DejaVuSans", "bold"); pdf.setFontSize(10);
      const [sr, sg, sb] = hexToRgb(getSegmentMeta(segment).color);
      pdf.setFillColor(sr, sg, sb);
      pdf.rect(marginX, y - 2.8, 3, 3, "F");
      pdf.text(segment, marginX + 7, y); y += 6;
      pdf.setFont("DejaVuSans", "normal"); pdf.setFontSize(9);
      bySegment[segment].forEach((it) => {
        if (y > pageBottom) { pdf.addPage(); y = 18; }
        const line = `- ${it.furniture} (${it.piece_count} ks)` +
          (it.wpl_assigned > 0 ? ` — WPL: ${fmt1(it.wpl_assigned)}` : " — nepočítá se jako WPL");
        pdf.text(line, marginX + 6, y); y += 5.5;
      });
      y += 2;
    });
    y += 3;
  });

  return y;
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
    ${calcs.map((c) => `<div class="history-item" data-calc="${esc(c.calculation_key)}" data-load="${esc(c.load_key)}">
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

function showHistoryDetail(calculationKey, loadKey) {
  const panel = document.getElementById("historyDetailPanel");
  panel.style.display = "block";
  const inputRows = dbAll("SELECT segment, pozice, fte, wpl_load, created_at FROM excel_loads WHERE load_key = ? ORDER BY id", [loadKey]);
  const resultRows = dbAll(`SELECT segment, total_positions, position_list, service_zone, meeting_zone,
    backoffice_zone, office_room, created_at, ref_version_id, duvod FROM calculations WHERE calculation_key = ?
    ORDER BY (segment = 'Celkem'), id`, [calculationKey]);
  const branch = dbAll("SELECT pobocka_id, pobocka_nazev, oteviraci_doba FROM excel_loads WHERE load_key = ? LIMIT 1", [loadKey])[0];

  const inputHtml = inputRows.map((r) => `<tr><td>${esc(r.segment)}</td><td>${esc(r.pozice)}</td>
    <td>${fmt1(r.fte)}</td><td>${fmt1(r.wpl_load)}</td></tr>`).join("");
  const resultHtml = resultRows.map((r) => resultRowHtml(r, r.segment === "Celkem")).join("");
  const found = resultRows.find((r) => r.segment === "Celkem");
  const refVersionId = resultRows[0] ? resultRows[0].ref_version_id : null;
  const createdAt = resultRows[0] ? resultRows[0].created_at : nowIso();
  const rowsNoTotal = resultRows.filter((r) => r.segment !== "Celkem");
  const mappedInputRows = inputRows.map((r) => ({ segment: r.segment, pozice: r.pozice, fte: r.fte, wpl_load: r.wpl_load }));
  const stats = computeCalculationStats({ rows: rowsNoTotal, celkem: found || {}, inputRows: mappedInputRows });
  const status = getCalculationStatus(calculationKey);

  document.getElementById("historyDetail").innerHTML = `
    <p class="muted">${branch ? `${esc(branch.pobocka_nazev)} (ID ${esc(branch.pobocka_id)}) · otevírací doba ${esc(branch.oteviraci_doba)} h/týden` : ""}</p>
    <p>Load key: <code>${esc(loadKey)}</code><br>Calculation key: <code>${esc(calculationKey)}</code></p>
    ${resultRows[0] && resultRows[0].duvod ? `<p class="muted">Důvod kalkulace: <strong>${esc(resultRows[0].duvod)}</strong></p>` : ""}
    <div class="status-row">${statusBadgeHtml(status)} ${statusToggleButtonHtml(status)}</div>
    <h3>Vstupní data z checklistu</h3>
    <div class="table-wrap"><table><thead><tr><th>Segment</th><th>Pozice</th><th>FTE</th><th>Vytížení WPL</th></tr></thead>
    <tbody>${inputHtml}</tbody></table></div>
    <h3>Výsledek kalkulace</h3>
    <div class="table-wrap"><table><thead><tr><th>Segment</th><th>FTE celkem</th><th>Pozice (FTE)</th>
      <th>Service zone</th><th>Meeting zone</th><th>Backoffice zone</th><th>Office room</th></tr></thead>
      <tbody>${resultHtml}</tbody></table></div>
    ${refVersionDetailsHtml(refVersionId)}
    ${renderStatsSection(stats, "pdfIncludeStatsHistory")}
    <div class="row" style="margin-top:12px;">
      <button class="btn secondary" id="btnExportPdfHistory">Exportovat PDF s přehledem WPL</button>
      <button class="btn secondary" id="btnCopyResultHistory">📋 Kopírovat výsledek do schránky</button>
    </div>
    <div style="margin-top:10px; max-width:480px;">
      <label class="muted" for="pdfNoteHistory">Poznámka do PDF (nepovinné):</label>
      <textarea id="pdfNoteHistory" rows="2"></textarea>
    </div>
    <h3 style="margin-top:22px;">Sestavení layoutu${layoutRulesHelpHtml()}</h3>
    <div id="historyLayoutArea"></div>`;

  // Stejná data kalkulace se použijí pro samostatný PDF export i pro spojenou
  // sestavu (kalkulace + layout), kterou nabízí sekce sestavení layoutu.
  const calcResult = {
    calculation_key: calculationKey, load_key: loadKey,
    createdAt, rows: rowsNoTotal, celkem: found || {},
    inputRows: mappedInputRows,
    warnings: [], pobocka_id: branch?.pobocka_id, pobocka_nazev: branch?.pobocka_nazev,
    oteviraci_doba: branch?.oteviraci_doba, refVersionId,
    duvod: resultRows[0] ? resultRows[0].duvod : null,
  };

  document.getElementById("btnExportPdfHistory").addEventListener("click", () => {
    const note = document.getElementById("pdfNoteHistory").value.trim();
    const includeStats = document.getElementById("pdfIncludeStatsHistory").checked;
    exportCalculationPdf(calcResult, { note, includeStats });
  });
  document.getElementById("btnCopyResultHistory").addEventListener("click", () => copyResultToClipboard(calcResult, stats));
  document.getElementById("btnToggleStatus").addEventListener("click", () => {
    setCalculationStatus(calculationKey, status === "potvrzena" ? "rozpracovana" : "potvrzena");
    showHistoryDetail(calculationKey, loadKey);
  });

  renderLayoutSection("historyLayoutArea", rowsNoTotal, {
    calculation_key: calculationKey, pobocka_id: branch?.pobocka_id, pobocka_nazev: branch?.pobocka_nazev, stats,
    calcResult, pdfNoteId: "pdfNoteHistory", pdfStatsId: "pdfIncludeStatsHistory",
  });

  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ------------------------ Verzování referenčních dat ----------------------- */

function snapshotRefData() {
  const absence = dbAll("SELECT segment, nepritomnost, homeoffice FROM absence ORDER BY segment")
    .map((r) => [r.segment, r.nepritomnost, r.homeoffice]);
  const dotace = dbAll(`SELECT segment, pozice, service_zone, meeting_zone, backoffice_zone, office_room
    FROM casove_dotace ORDER BY segment, pozice`)
    .map((r) => [r.segment, r.pozice, r.service_zone, r.meeting_zone, r.backoffice_zone, r.office_room]);
  return { absence, dotace };
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
  const latest = dbAll("SELECT id, absence_json, dotace_json FROM ref_data_versions ORDER BY id DESC LIMIT 1")[0];
  if (latest && latest.absence_json === absenceJson && latest.dotace_json === dotaceJson) {
    return latest.id;
  }
  db.run("INSERT INTO ref_data_versions (created_at, note, absence_json, dotace_json) VALUES (?, ?, ?, ?)",
    [nowIso(), noteIfNew || "Změna referenčních dat", absenceJson, dotaceJson]);
  return dbAll("SELECT last_insert_rowid() AS id")[0].id;
}

function listRefVersions() {
  return dbAll("SELECT id, created_at, note FROM ref_data_versions ORDER BY id DESC");
}

function getRefVersionById(id) {
  const row = dbAll("SELECT id, created_at, note, absence_json, dotace_json FROM ref_data_versions WHERE id = ?", [id])[0];
  if (!row) return null;
  return {
    id: row.id, created_at: row.created_at, note: row.note,
    absence: JSON.parse(row.absence_json), dotace: JSON.parse(row.dotace_json),
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
  const body = rows.map(([segment, pozice, s, m, b, o]) => `<tr>
    <td>${esc(segment)}</td><td>${esc(pozice)}</td><td>${fmt1(s)}</td><td>${fmt1(m)}</td><td>${fmt1(b)}</td><td>${fmt1(o)}</td>
  </tr>`).join("");
  return `<div class="table-wrap"><table>
    <thead><tr><th>Segment</th><th>Pozice</th><th>ServiceZ %</th><th>MeetingZ %</th><th>BackofficeZ %</th><th>OfficeRoom %</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
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
    ${renderReadonlyDotaceTable(version.dotace)}`;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* --------------------------- Referenční data ------------------------------ */

function renderAbsenceTable() {
  const el = document.getElementById("absenceTable");
  if (!db) { el.innerHTML = `<p class="muted">Nejprve připojte databázi.</p>`; return; }
  const rows = dbAll("SELECT segment, nepritomnost, homeoffice, ref_version_id FROM absence ORDER BY segment");
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Segment</th><th>Nepřítomnost (%)</th><th>Homeoffice (%)</th>
      <th title="Verze referenčních dat, ve které řádek naposledy vznikl nebo se změnil">Verze</th><th></th></tr></thead>
    <tbody id="absenceTbody">
      ${rows.map(absenceRowHtml).join("")}
    </tbody></table></div>`;
  wireDeleteButtons("absenceTbody");
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

function dotaceRowHtml(r) {
  const f = (v) => v === null || v === undefined ? "" : v;
  return `<tr>
    <td><input type="text" value="${esc(r.segment)}" data-field="segment"></td>
    <td><input type="text" value="${esc(r.pozice)}" data-field="pozice"></td>
    <td><input type="number" step="1" value="${f(r.service_zone)}" data-field="service_zone"></td>
    <td><input type="number" step="1" value="${f(r.meeting_zone)}" data-field="meeting_zone"></td>
    <td><input type="number" step="1" value="${f(r.backoffice_zone)}" data-field="backoffice_zone"></td>
    <td><input type="number" step="1" value="${f(r.office_room)}" data-field="office_room"></td>
    ${refVersionCellHtml(r.ref_version_id)}
    <td><button class="btn secondary small btn-del">✕</button></td>
  </tr>`;
}

// Klíč identity řádku časové dotace (segment + pozice) pro porovnání změn.
function dotaceKey(segment, pozice) { return `${segment}||${pozice}`; }

// Tabulka časových dotací pozic se zobrazuje na dvou místech (záložka
// "Referenční data" a nový modul "Struktura checklistu") nad stejnou tabulkou
// `casove_dotace` — factory dovolí mít dvě samostatné DOM instance (vlastní
// filtr, vlastní tbody), aniž by se logika duplikovala.
function makeDotaceEditor(tableId, filterId, tbodyId) {
  let filterText = "";

  function render() {
    const el = document.getElementById(tableId);
    if (!el) return;
    if (!db) { el.innerHTML = `<p class="muted">Nejprve připojte databázi.</p>`; return; }
    const rows = dbAll("SELECT id, segment, pozice, service_zone, meeting_zone, backoffice_zone, office_room, ref_version_id FROM casove_dotace ORDER BY segment, pozice");
    const filtered = filterText
      ? rows.filter((r) => `${r.segment} ${r.pozice}`.toLowerCase().includes(filterText))
      : rows;
    el.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Segment</th><th>Pozice</th><th>ServiceZ %</th><th>MeetingZ %</th><th>BackofficeZ %</th><th>OfficeRoom %</th>
        <th title="Verze referenčních dat, ve které řádek naposledy vznikl nebo se změnil">Verze</th><th></th></tr></thead>
      <tbody id="${tbodyId}">
        ${filtered.map(dotaceRowHtml).join("")}
      </tbody></table></div>
      <p class="muted" style="margin-top:6px;">Zobrazeno ${filtered.length} z ${rows.length} pozic.
        ${filterText ? "Uložení uloží pouze zobrazené (filtrované) řádky spolu se skrytými — filtr slouží jen k prohlížení." : ""}</p>`;
    wireDeleteButtons(tbodyId);
    // pro uložení potřebujeme i skryté (filtrované) řádky -> uchováme je v dataset
    el.dataset.hiddenRows = JSON.stringify(filterText ? rows.filter((r) => !filtered.includes(r)) : []);
  }

  function save() {
    if (!requireDb()) return;
    const trs = document.querySelectorAll(`#${tbodyId} tr`);
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
    const hidden = JSON.parse(document.getElementById(tableId).dataset.hiddenRows || "[]");
    hidden.forEach((r) => data.push([r.segment, r.pozice, r.service_zone, r.meeting_zone, r.backoffice_zone, r.office_room]));

    // Evidence verze u jednotlivých řádků — viz saveAbsenceTable(): nezměněné
    // řádky si ponechají původní stamp, změněné a nové dostanou číslo nové verze.
    const old = {};
    dbAll(`SELECT segment, pozice, service_zone, meeting_zone, backoffice_zone, office_room, ref_version_id
      FROM casove_dotace`).forEach((r) => { old[dotaceKey(r.segment, r.pozice)] = r; });
    const changed = data.filter(([segment, pozice, s, m, b, o]) => {
      const prev = old[dotaceKey(segment, pozice)];
      return !prev || prev.service_zone !== s || prev.meeting_zone !== m
        || prev.backoffice_zone !== b || prev.office_room !== o;
    }).map(([segment, pozice]) => [segment, pozice]);

    dbRun("DELETE FROM casove_dotace");
    const ins = db.prepare(`INSERT INTO casove_dotace
      (segment, pozice, service_zone, meeting_zone, backoffice_zone, office_room, ref_version_id) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    data.forEach((r) => {
      const prev = old[dotaceKey(r[0], r[1])];
      ins.run([...r, prev ? prev.ref_version_id : null]);
    });
    ins.free();

    const versionId = ensureRefVersionUpToDate("Úprava: časové dotace pozic");
    changed.forEach(([segment, pozice]) => dbRun(
      "UPDATE casove_dotace SET ref_version_id = ? WHERE segment = ? AND pozice = ?", [versionId, segment, pozice]));

    persistDatabase(true);
    filterText = "";
    const filterInput = document.getElementById(filterId);
    if (filterInput) filterInput.value = "";
    dotaceEditorMain.render();
    dotaceEditorAdmin.render();
    renderRefVersionsList();
    toast("Tabulka časových dotací byla uložena a zaznamenána nová verze referenčních dat.", "ok");
  }

  function addRow() {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.insertAdjacentHTML("beforeend", dotaceRowHtml({ segment: "", pozice: "", service_zone: null, meeting_zone: null, backoffice_zone: null, office_room: null }));
    wireDeleteButtons(tbodyId);
  }

  function setFilter(v) { filterText = v.trim().toLowerCase(); render(); }

  return { render, save, addRow, setFilter };
}

const dotaceEditorMain = makeDotaceEditor("dotaceTable", "dotaceFilter", "dotaceTbody");
const dotaceEditorAdmin = makeDotaceEditor("adminDotaceTable", "adminDotaceFilter", "adminDotaceTbody");

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
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Klíč segmentu</th><th>Název</th><th>Pořadí</th><th>Barva</th><th>Ikona</th><th></th></tr></thead>
    <tbody id="segmentsTbody">${rows.map(segmentRowHtml).join("")}</tbody></table></div>`;
  wireDeleteButtons("segmentsTbody");
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
  return `<tr>
    <td><input type="text" value="${esc(r.segment)}" data-field="segment"></td>
    <td><select data-field="zone">${zoneOptions}</select></td>
    <td><input type="text" value="${esc(r.furniture)}" data-field="furniture"></td>
    <td><input type="number" step="0.5" value="${r.wpl_counter ?? 0}" data-field="wpl_counter"></td>
    <td><button class="btn secondary small btn-del">✕</button></td>
  </tr>`;
}

function renderFurnitureTable() {
  const el = document.getElementById("furnitureTable");
  if (!el) return;
  if (!db) { el.innerHTML = `<p class="muted">Nejprve připojte databázi.</p>`; return; }
  const rows = dbAll("SELECT id, segment, zone, furniture, wpl_counter FROM furniture_to_zone ORDER BY segment, zone, id");
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Segment</th><th>Zóna</th><th>Nábytek</th><th>WPL / kus</th><th></th></tr></thead>
    <tbody id="furnitureTbody">${rows.map(furnitureRowHtml).join("")}</tbody></table></div>`;
  wireDeleteButtons("furnitureTbody");
}

function saveFurnitureTable() {
  if (!requireDb()) return;
  const trs = document.querySelectorAll("#furnitureTbody tr");
  const data = [];
  for (const tr of trs) {
    const segment = tr.querySelector('[data-field="segment"]').value.trim();
    const furniture = tr.querySelector('[data-field="furniture"]').value.trim();
    if (!segment || !furniture) continue;
    data.push([
      segment, furniture, tr.querySelector('[data-field="zone"]').value,
      toNumberOrNull(tr.querySelector('[data-field="wpl_counter"]').value) ?? 0,
    ]);
  }
  dbRun("DELETE FROM furniture_to_zone");
  const ins = db.prepare("INSERT INTO furniture_to_zone (segment, furniture, zone, wpl_counter) VALUES (?, ?, ?, ?)");
  data.forEach((r) => ins.run(r));
  ins.free();
  persistDatabase(true);
  renderFurnitureTable();
  toast("Tabulka nábytku byla uložena.", "ok");
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

// Barvy a rozměry odečtené ze vzorového checklistu.
const CHL_C = {
  title: "FF2770F1",     // modrá — titulek, svislé popisky FRONT/BACK OFFICE
  section: "FF235377",   // tmavě modrá — hlavičky sekcí
  segment: "FF00A4A2",   // tyrkysová — popisek segmentu, velká čísla hodin
  sum: "FF00A4A3",       // tyrkysová — hodnoty součtů
  zone: "FFE7E6E6",      // světle šedá — popisek zóny
  input: "FF0070C0",     // barva písma vyplňovaných buněk
};
const CHL_COL_WIDTHS = [
  { index: 1, width: 11.7109375 }, { index: 2, width: 14.28515625 }, { index: 3, width: 14.42578125 },
  { index: 4, width: 9.28515625 }, { index: 5, width: 8.7109375 }, { index: 6, width: 19.42578125 },
  { index: 7, width: 20.5703125 }, { index: 9, width: 25.140625 }, { index: 10, width: 4.7109375 },
  { index: 11, width: 91.140625 },
];
const VSTUPY_COL_WIDTHS = [
  { index: 1, width: 11.42578125 }, { index: 2, width: 57.140625 },
  { index: 3, width: 17.5703125 }, { index: 4, width: 14.5703125 },
];
const CHL_CESTOVNI_ROWS = 9; // volných řádků pro cestovní pozice (jako ve vzoru)

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

  /* ------------------------------- styly ---------------------------------- */
  const sb = createStyleBook();
  const A = (size, bold, color) => ({ name: "Arial", size, bold: !!bold, color: color || null });
  const st = {
    title: sb.style({ font: A(12, true), fill: CHL_C.title, border: "lrtb", alignment: { h: "left", v: "center" } }),
    titleCtr: sb.style({ font: A(12, true), fill: CHL_C.title, border: "lrtb", alignment: { h: "center", v: "center", wrap: true } }),
    titleCtrN: sb.style({ font: A(12), fill: CHL_C.title, border: "lrtb", alignment: { h: "center", v: "center" } }),
    // „Vygenerováno“ je ve vzoru Calibri a bez levého rámečku (navazuje na H1)
    genLabel: sb.style({ font: { name: "Calibri", size: 12, bold: true }, fill: CHL_C.title, border: "rtb", alignment: { h: "center", v: "center" } }),
    sectionCtrNW: sb.style({ font: A(9), fill: CHL_C.section, border: "lrtb", alignment: { h: "center", v: "center" } }),
    noteHead: sb.style({ font: { name: "Aptos Display", size: 18 }, fill: CHL_C.title, border: "lrtb", alignment: { v: "center" } }),
    noteSide: sb.style({ font: { name: "Aptos Display", size: 10 }, border: "lr", alignment: { h: "center", v: "center", wrap: true } }),
    section: sb.style({ font: A(9, true), fill: CHL_C.section, border: "lrtb", alignment: { h: "left", v: "center" } }),
    sectionCtr: sb.style({ font: A(9), fill: CHL_C.section, border: "lrtb", alignment: { h: "center", v: "center", wrap: true } }),
    sectionCtrB: sb.style({ font: A(9, true), fill: CHL_C.section, border: "lrtb", alignment: { h: "center", v: "center", wrap: true } }),
    sumBlank: sb.style({ font: A(9, true), fill: CHL_C.section, border: "lrtb", alignment: { h: "center", v: "center" } }),
    label: sb.style({ font: A(9, true), border: "lrtb", alignment: { h: "left", v: "center" } }),
    value: sb.style({ font: A(9, true, CHL_C.title), border: "lrtb", alignment: { h: "center", v: "center" } }),
    bigNum: sb.style({ font: A(20, true, CHL_C.segment), border: "lrtb", alignment: { h: "center", v: "center" } }),
    segment: sb.style({ font: A(9, true), fill: CHL_C.segment, border: "lrtb", alignment: { h: "center", v: "center" } }),
    zone: sb.style({ font: A(8, true), fill: CHL_C.zone, border: "lrtb", alignment: { h: "center", v: "center", wrap: true } }),
    sideLabel: sb.style({ font: A(9, true), fill: CHL_C.title, border: "lrtb", alignment: { h: "center", v: "center", wrap: true } }),
    subLabel: sb.style({ font: A(9, true), border: "lrtb", alignment: { h: "center", v: "center", wrap: true } }),
    item: sb.style({ font: A(9), border: "lrtb", alignment: { h: "left", v: "center" } }),
    input: sb.style({ font: A(9, true, CHL_C.input), border: "lrtb", alignment: { h: "center", v: "center" } }),
    sumVal: sb.style({ font: A(9, true), fill: CHL_C.sum, border: "lrtb", alignment: { h: "center", v: "center" } }),
    plain: sb.style({ border: "lrtb" }),
    noteArea: sb.style({ font: A(9), border: "lrtb", alignment: { h: "left", v: "top", wrap: true } }),
  };

  const chl = {};
  const merges = [];
  const rowHeights = {};
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
  put("G", 1, str("", st.titleCtr));
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
    put("C", r, str("", st.value)); put("D", r, str("", st.value)); merge("C", r, "D", r);
  });
  // "Režim obsluhy klientů:" je ve vzoru sloučený přes dva řádky (7-8)
  put("A", 7, str("Režim obsluhy klientů:", st.label)); put("B", 7, str("", st.label));
  put("A", 8, str("", st.label)); put("B", 8, str("", st.label));
  merges.push("A7:B8");
  put("C", 7, str("", st.value)); put("D", 7, str("", st.value));
  put("C", 8, str("", st.value)); put("D", 8, str("", st.value));
  merges.push("C7:D8");
  // Otevírací doba (E3:H5 / I3:I5) a doba vytěžení WPL (E6:H8 / I6:I8)
  [["Otevírací doba pobočky:", 3, 5], ["Doba vytěžení WPL:", 6, 8]].forEach(([label, r1, r2]) => {
    for (let r = r1; r <= r2; r++) for (const c of "EFGH") put(c, r, str("", st.label));
    put("E", r1, str(label, st.label));
    merges.push(`E${r1}:H${r2}`);
    for (let r = r1; r <= r2; r++) put("I", r, num("", st.bigNum));
    put("I", r1, num(40, st.bigNum));
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
      put("A", row, str(row === first ? segment : "", st.segment));
      fillRange("B", "F", row, st.item, str(pozice, st.item));
      put("G", row, num("", st.input));
      put("H", row, num("", st.input));
      put("I", row, str("", st.input));
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
  for (let i = 0; i < CHL_CESTOVNI_ROWS; i++) {
    rowHeights[row] = 17.1;
    put("A", row, str(row === cestFirst ? "CESTOVNÍ POZICE" : "", st.segment));
    fillRange("B", "F", row, st.item);
    put("G", row, num("", st.input));
    put("H", row, num("", st.input));
    put("I", row, str("", st.input));
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
    put("H", row, str("", st.input));
    put("I", row, str("", st.input));
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
          put("B", row, str(row === segFirst ? block.segment : "", st.subLabel));
          put("C", row, str(zoneLabel
            ? (row === first ? zoneLabel : "")
            : (row === zoneFirst ? (ZONE_TITLES[zoneBlock.zone] || zoneBlock.zone) : ""), st.zone));
          fillRange("D", "F", row, st.item, str(furniture, st.item));
          put("G", row, num("", st.input));
          put("H", row, num("", st.input));
          put("I", row, str("", st.input));
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
      put("H", row, str("", st.input));
      put("I", row, str("", st.input));
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
  for (let i = 0; i < 8; i++) {
    rowHeights[row] = 17.1;
    for (const c of "ABCDEFGHI") put(c, row, str("", st.noteArea));
    put("K", row, str("", st.plain));
    row++;
  }
  merges.push(`A${noteFirst}:I${row - 1}`);

  [["Load key:", ""], ["Calculation key:", ""], ["Vygenerováno:", ""], ["Odkaz na sharepoint item:", ""]]
    .forEach(([label, value]) => {
      rowHeights[row] = 17.1;
      put("A", row, str(label, st.label));
      put("B", row, str("", st.label));
      merge("A", row, "B", row);
      fillRange("C", "I", row, st.item, str(value, st.item));
      put("K", row, str("", st.plain));
      row++;
    });

  /* ------------------------------- VSTUPY --------------------------------- */
  // Hodnoty se stahují vzorci z CHL; parseVstupySheet() čte C1–C4 a od řádku 6
  // sloupce A–D, takže rozvržení tohoto listu musí zůstat přesně takto.
  const vs = {};
  const vstupyHeader = sb.style({ font: { name: "Arial", size: 10 }, fill: CHL_C.title, border: "lrtb", alignment: { h: "left", v: "center" } });
  const vstupyHeaderB = sb.style({ font: { name: "Arial", size: 10, bold: true }, fill: CHL_C.title, border: "lrtb", alignment: { h: "left", v: "center" } });
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
  for (let i = 0; i < CHL_CESTOVNI_ROWS; i++) {
    const cr = cestFirst + i;
    vs[`A${vr}`] = { f: `IF(CHL!B${cr}=0,"","CESTOVNÍ")`, v: "", t: "str", s: vstupyCell };
    vs[`B${vr}`] = { f: `IF(CHL!B${cr}=0,"",CHL!B${cr})`, v: "", t: "str", s: vstupyCell };
    vs[`C${vr}`] = { f: `IF(CHL!B${cr}=0,"",CHL!H${cr})`, v: "", t: "str", s: vstupyCell };
    vs[`D${vr}`] = { f: `IF(CHL!B${cr}=0,"",CHL!G${cr})`, v: "", t: "str", s: vstupyCell };
    vr++;
  }

  const chlSheet = {
    name: "CHL", cells: chl, cols: CHL_COL_WIDTHS, merges,
    rowHeights, defaultRowHeight: 15, freezeRows: 9,
  };
  const vstupySheet = {
    name: "VSTUPY", cells: vs, cols: VSTUPY_COL_WIDTHS, defaultRowHeight: 15, freezeRows: 5,
  };

  const out = buildXlsxWorkbook([chlSheet, vstupySheet], sb);
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "checklist_sablona.xlsx";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  const positionCount = positionSegments.reduce((n, s) => n + positionsBySegment[s].length, 0);
  const furnitureCount = frontOffice.concat(backOffice)
    .reduce((n, b) => n + b.zones.reduce((m, z) => m + z.items.length, 0), 0);
  toast(`Excel šablona vygenerována (${positionCount} pozic, ${furnitureCount} nábytkových prvků). ` +
    `Pobočka vyplňuje list CHL, do listu VSTUPY se hodnoty stahují automaticky.`, "ok");
}

/* --------------------------------- Tabs ------------------------------------ */

function refreshAllTabsAfterDbChange() {
  refreshSegmentMetaCache();
  renderHistoryList();
  renderAbsenceTable();
  dotaceEditorMain.render();
  dotaceEditorAdmin.render();
  renderRefVersionsList();
  renderPobockyDatalist();
  renderSegmentsTable();
  renderFurnitureTable();
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
  document.getElementById("btnCommitManual").addEventListener("click", handleCommitManual);

  document.getElementById("btnAddAbsenceRow").addEventListener("click", () => {
    document.getElementById("absenceTbody").insertAdjacentHTML("beforeend", absenceRowHtml({ segment: "", nepritomnost: 0, homeoffice: 0 }));
    wireDeleteButtons("absenceTbody");
  });
  document.getElementById("btnSaveAbsence").addEventListener("click", saveAbsenceTable);
  document.getElementById("btnAddDotaceRow").addEventListener("click", dotaceEditorMain.addRow);
  document.getElementById("btnSaveDotace").addEventListener("click", dotaceEditorMain.save);
  document.getElementById("dotaceFilter").addEventListener("input", (e) => dotaceEditorMain.setFilter(e.target.value));
  document.getElementById("btnAdminAddDotaceRow").addEventListener("click", dotaceEditorAdmin.addRow);
  document.getElementById("btnAdminSaveDotace").addEventListener("click", dotaceEditorAdmin.save);
  document.getElementById("adminDotaceFilter").addEventListener("input", (e) => dotaceEditorAdmin.setFilter(e.target.value));

  document.getElementById("btnAddSegmentRow").addEventListener("click", () => {
    document.getElementById("segmentsTbody").insertAdjacentHTML("beforeend", segmentRowHtml({ segment_key: "", nazev: "", sort_order: 0, color: "#6b7684", icon: "" }));
    wireDeleteButtons("segmentsTbody");
  });
  document.getElementById("btnSaveSegments").addEventListener("click", saveSegmentsTable);
  document.getElementById("btnAddFurnitureRow").addEventListener("click", () => {
    document.getElementById("furnitureTbody").insertAdjacentHTML("beforeend", furnitureRowHtml({ segment: "", zone: ZONES[0], furniture: "", wpl_counter: 0 }));
    wireDeleteButtons("furnitureTbody");
  });
  document.getElementById("btnSaveFurniture").addEventListener("click", saveFurnitureTable);
  document.getElementById("btnGenerateTemplate").addEventListener("click", generateChecklistTemplate);

  // Nápověda k pravidlům předvyplnění layoutu — obsah se generuje z LAYOUT_RULES.
  document.getElementById("layoutRulesHelp").innerHTML = layoutRulesHelpHtml();

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
