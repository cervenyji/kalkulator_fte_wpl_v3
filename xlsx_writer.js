'use strict';

/* =========================================================================
   Minimal, závislostí prostý zapisovač .xlsx (OOXML) souborů.

   Důvod existence: vendorovaná knihovna SheetJS (vendor/xlsx.full.min.js,
   komunitní edice) umí formátování buněk při čtení přečíst, ale při zápisu
   (XLSX.write) ho vždy zahodí — ověřeno přímým testem (zápis buňky se
   zadaným fill/font a zpětné přečtení vždy vrátí "bez formátování", i pro
   nově vytvořený sešit). Pro modul "Struktura checklistu", kde má být
   vygenerovaná šablona formátovaná stejně jako vzorový checklist, proto
   tento soubor sestavuje .xlsx přímo — .xlsx je jen ZIP archiv s XML
   soubory (OOXML SpreadsheetML), takže stačí vlastní jednoduchý ZIP writer
   (bez komprese — metoda "stored" je pro ZIP formát plně validní) a ručně
   sestavené XML pro list/styly/workbook.

   Podporuje jen to, co šablona checklistu skutečně potřebuje: řetězce
   (inline, bez sdílené tabulky řetězců), čísla, jednoduché vzorce
   s přímým odkazem na buňku, sloupcová šířka, sloučené buňky a sadu
   pojmenovaných stylů (výplň, tučné písmo, barva textu, ohraničení,
   zarovnání).
   ========================================================================= */

/* ------------------------------- ZIP (stored) ------------------------------ */

function crc32(bytes) {
  if (!crc32.table) {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = crc32.table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildZip(files) {
  // files: [{ name: string, data: Uint8Array }]
  const encoder = new TextEncoder();
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  files.forEach(({ name, data }) => {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const size = data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(4, 20, true);         // version needed to extract
    lv.setUint16(6, 0, true);          // flags
    lv.setUint16(8, 0, true);          // compression: stored
    lv.setUint16(10, 0, true);         // mod time
    lv.setUint16(12, 0x21, true);      // mod date (1980-01-01)
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);      // compressed size
    lv.setUint32(22, size, true);      // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);         // extra field length
    local.set(nameBytes, 30);
    localChunks.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory signature
    cv.setUint16(4, 20, true);         // version made by
    cv.setUint16(6, 20, true);         // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra length
    cv.setUint16(32, 0, true); // comment length
    cv.setUint16(34, 0, true); // disk number start
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true); // local header offset
    central.set(nameBytes, 46);
    centralChunks.push(central);

    offset += local.length + data.length;
  });

  const centralStart = offset;
  const centralSize = centralChunks.reduce((s, c) => s + c.length, 0);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  ev.setUint16(20, 0, true);

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  [...localChunks, ...centralChunks, eocd].forEach((chunk) => { out.set(chunk, p); p += chunk.length; });
  return out;
}

/* --------------------------------- XML tools -------------------------------- */

function xmlEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  }[c]));
}

function colLetters(n) {
  // 1-based column index -> "A", "B", ..., "Z", "AA", ...
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function parseCellAddr(addr) {
  const m = /^([A-Z]+)(\d+)$/.exec(addr);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: parseInt(m[2], 10) };
}

/* -------------------------------- Style book -------------------------------- */

// Spravuje deduplikované fonty/výplně/ohraničení/formáty a vydává indexy do
// cellXfs, které se pak používají jako atribut `s` na jednotlivých buňkách.
function createStyleBook() {
  const fonts = [{ sz: 11, name: "Calibri" }]; // index 0 = výchozí
  const fills = [{ patternType: "none" }, { patternType: "gray125" }]; // 0,1 vyhrazené OOXML výchozí hodnoty
  const borders = [{}]; // index 0 = bez ohraničení
  const cellXfs = [{ fontId: 0, fillId: 0, borderId: 0, align: null }]; // index 0 = výchozí

  function dedupe(arr, item) {
    const key = JSON.stringify(item);
    const idx = arr.findIndex((x) => JSON.stringify(x) === key);
    if (idx !== -1) return idx;
    arr.push(item);
    return arr.length - 1;
  }

  function addStyle({ bold, size, color, fill, border, align } = {}) {
    const fontId = dedupe(fonts, { sz: size || 11, name: "Calibri", bold: !!bold, color: color || null });
    const fillId = fill ? dedupe(fills, { patternType: "solid", fgColor: fill }) : 0;
    const borderId = border ? dedupe(borders, { thin: true }) : 0;
    return dedupe(cellXfs, { fontId, fillId, borderId, align: align || null });
  }

  function toXml() {
    const fontsXml = fonts.map((f) => `<font><sz val="${f.sz}"/>${f.bold ? "<b/>" : ""}${f.color ? `<color rgb="${f.color}"/>` : ""}<name val="${f.name}"/></font>`).join("");
    const fillsXml = fills.map((f) => f.patternType === "solid"
      ? `<fill><patternFill patternType="solid"><fgColor rgb="${f.fgColor}"/><bgColor indexed="64"/></patternFill></fill>`
      : `<fill><patternFill patternType="${f.patternType}"/></fill>`).join("");
    const borderSide = () => `<left style="thin"><color rgb="FFB0B0B0"/></left><right style="thin"><color rgb="FFB0B0B0"/></right><top style="thin"><color rgb="FFB0B0B0"/></top><bottom style="thin"><color rgb="FFB0B0B0"/></bottom>`;
    const bordersXml = borders.map((b) => b.thin ? `<border>${borderSide()}</border>` : `<border><left/><right/><top/><bottom/></border>`).join("");
    const xfsXml = cellXfs.map((xf) => {
      const alignXml = xf.align ? `<alignment horizontal="${xf.align}" vertical="center" wrapText="1"/>` : "";
      return `<xf numFmtId="0" fontId="${xf.fontId}" fillId="${xf.fillId}" borderId="${xf.borderId}" xfId="0"` +
        `${xf.fillId ? ' applyFill="1"' : ""}${xf.borderId ? ' applyBorder="1"' : ""}${xf.fontId ? ' applyFont="1"' : ""}${alignXml ? ' applyAlignment="1"' : ""}>${alignXml}</xf>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="${fonts.length}">${fontsXml}</fonts>` +
      `<fills count="${fills.length}">${fillsXml}</fills>` +
      `<borders count="${borders.length}">${bordersXml}</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${cellXfs.length}">${xfsXml}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`;
  }

  return { addStyle, toXml };
}

/* --------------------------------- Sheet XML -------------------------------- */

// cells: { "A1": { v, t: 'str'|'n'|undefined, f: 'formula, no leading =', s: styleIndex } }
// cols: [{ index (1-based), width }]
// merges: ["A1:B1", ...]
function sheetXml(cells, { cols, merges, freeze } = {}) {
  const byRow = {};
  Object.keys(cells).forEach((addr) => {
    const { row } = parseCellAddr(addr);
    (byRow[row] = byRow[row] || []).push(addr);
  });
  const rowNums = Object.keys(byRow).map(Number).sort((a, b) => a - b);
  const maxRow = rowNums.length ? rowNums[rowNums.length - 1] : 1;
  let maxCol = 1;

  const rowsXml = rowNums.map((r) => {
    const addrs = byRow[r].sort((a, b) => parseCellAddr(a).col - parseCellAddr(b).col);
    const cellsXml = addrs.map((addr) => {
      const { col } = parseCellAddr(addr);
      if (col > maxCol) maxCol = col;
      const cell = cells[addr];
      const sAttr = cell.s ? ` s="${cell.s}"` : "";
      if (cell.f !== undefined) {
        const tAttr = cell.t === "str" ? ' t="str"' : "";
        const vXml = cell.v !== undefined && cell.v !== "" ? `<v>${xmlEsc(cell.v)}</v>` : "";
        return `<c r="${addr}"${sAttr}${tAttr}><f>${xmlEsc(cell.f)}</f>${vXml}</c>`;
      }
      if (cell.t === "str") {
        return `<c r="${addr}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(cell.v)}</t></is></c>`;
      }
      return `<c r="${addr}"${sAttr}><v>${cell.v === undefined || cell.v === "" ? 0 : cell.v}</v></c>`;
    }).join("");
    return `<row r="${r}">${cellsXml}</row>`;
  }).join("");

  const colsXml = (cols && cols.length)
    ? `<cols>${cols.map((c) => `<col min="${c.index}" max="${c.index}" width="${c.width}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const mergesXml = (merges && merges.length)
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";
  const paneXml = freeze
    ? `<sheetViews><sheetView workbookViewId="0"><pane ${freeze}/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${colLetters(maxCol)}${maxRow}"/>` +
    paneXml +
    colsXml +
    `<sheetData>${rowsXml}</sheetData>` +
    mergesXml +
    `</worksheet>`;
}

/* -------------------------------- Workbook ---------------------------------- */

// sheets: [{ name, cells, cols, merges, freeze }]
// Vrátí Uint8Array s obsahem hotového .xlsx souboru.
function buildXlsxWorkbook(sheets, styleBook) {
  const encoder = new TextEncoder();
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    `</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
    `</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const files = [
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { name: "_rels/.rels", data: encoder.encode(rootRels) },
    { name: "xl/workbook.xml", data: encoder.encode(workbookXml) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRels) },
    { name: "xl/styles.xml", data: encoder.encode(styleBook.toXml()) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: encoder.encode(sheetXml(s.cells, s)) })),
  ];
  return buildZip(files);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildXlsxWorkbook, createStyleBook, colLetters };
}
