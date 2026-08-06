'use strict';

/* =========================================================================
   Minimální, na závislostech nezávislý zapisovač .xlsx (OOXML).

   Důvod existence: vendorovaná knihovna SheetJS (vendor/xlsx.full.min.js,
   komunitní edice) umí formátování buněk při čtení přečíst, ale při zápisu
   (XLSX.write) ho vždy zahodí — ověřeno přímým testem (zápis buňky se
   zadaným fill/font a zpětné přečtení vždy vrátí "bez formátování", i pro
   nově vytvořený sešit). Modul „Struktura checklistu“ přitom potřebuje
   vygenerovat šablonu, která vypadá stejně jako vzorový checklist, proto se
   .xlsx sestavuje přímo: je to ZIP archiv s XML soubory (OOXML
   SpreadsheetML), takže stačí vlastní jednoduchý ZIP writer (bez komprese —
   metoda „stored“ je pro ZIP plně validní) a ručně sestavené XML.

   Podporuje: řetězce (inline), čísla, vzorce, pojmenované styly (font
   name/size/bold/barva, výplň, ohraničení po jednotlivých stranách,
   zarovnání + zalamování), šířky sloupců, výšky řádků, sloučené buňky,
   zamrznuté řádky, seskupení (outline) a skrytí sloupců i skrytí celých
   listů.
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
    lv.setUint32(0, 0x04034b50, true); // local file header
    lv.setUint16(4, 20, true);         // version needed
    lv.setUint16(6, 0, true);          // flags
    lv.setUint16(8, 0, true);          // compression: stored
    lv.setUint16(10, 0, true);         // mod time
    lv.setUint16(12, 0x21, true);      // mod date (1980-01-01)
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    localChunks.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
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

  const out = new Uint8Array(offset + centralSize + eocd.length);
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

// Spravuje deduplikované fonty/výplně/ohraničení a vydává indexy do cellXfs,
// které se pak používají jako atribut `s` na jednotlivých buňkách.
//
// style({ font: { name, size, bold, color }, fill: "FFRRGGBB",
//         border: "lrtb" | "lr" | "b" | ... (+ borderStyle, borderColor),
//         alignment: { h, v, wrap } })
function createStyleBook() {
  const DEFAULT_FONT = { name: "Calibri", size: 11, bold: false, color: null };
  const fonts = [{ ...DEFAULT_FONT }];
  const fills = [{ pattern: "none" }, { pattern: "gray125" }]; // 0 a 1 jsou v OOXML vyhrazené
  const borders = [{ sides: "", style: "thin", color: null }];
  const xfs = [{ fontId: 0, fillId: 0, borderId: 0, alignment: null }];

  function dedupe(arr, item) {
    const key = JSON.stringify(item);
    const idx = arr.findIndex((x) => JSON.stringify(x) === key);
    if (idx !== -1) return idx;
    arr.push(item);
    return arr.length - 1;
  }

  function style(spec = {}) {
    const f = spec.font || {};
    const fontId = dedupe(fonts, {
      name: f.name || DEFAULT_FONT.name,
      size: f.size || DEFAULT_FONT.size,
      bold: !!f.bold,
      color: f.color || null,
    });
    const fillId = spec.fill ? dedupe(fills, { pattern: "solid", fg: spec.fill }) : 0;
    const borderId = spec.border
      ? dedupe(borders, { sides: spec.border, style: spec.borderStyle || "thin", color: spec.borderColor || null })
      : 0;
    const a = spec.alignment;
    const alignment = a ? { h: a.h || null, v: a.v || null, wrap: !!a.wrap } : null;
    return dedupe(xfs, { fontId, fillId, borderId, alignment });
  }

  function toXml() {
    const fontsXml = fonts.map((f) =>
      `<font><sz val="${f.size}"/>${f.bold ? "<b/>" : ""}` +
      `${f.color ? `<color rgb="${f.color}"/>` : `<color theme="1"/>`}` +
      `<name val="${xmlEsc(f.name)}"/><family val="2"/><charset val="238"/></font>`).join("");

    const fillsXml = fills.map((f) => f.pattern === "solid"
      ? `<fill><patternFill patternType="solid"><fgColor rgb="${f.fg}"/><bgColor indexed="64"/></patternFill></fill>`
      : `<fill><patternFill patternType="${f.pattern}"/></fill>`).join("");

    const SIDES = { l: "left", r: "right", t: "top", b: "bottom" };
    const bordersXml = borders.map((b) => {
      // Strany se musí vypsat v pořadí left, right, top, bottom (schéma OOXML).
      const parts = ["l", "r", "t", "b"].map((k) => {
        const tag = SIDES[k];
        if (!b.sides.includes(k)) return `<${tag}/>`;
        const col = b.color ? `<color rgb="${b.color}"/>` : `<color indexed="64"/>`;
        return `<${tag} style="${b.style}">${col}</${tag}>`;
      }).join("");
      return `<border>${parts}<diagonal/></border>`;
    }).join("");

    const xfsXml = xfs.map((xf) => {
      const a = xf.alignment;
      const alignXml = a
        ? `<alignment${a.h ? ` horizontal="${a.h}"` : ""}${a.v ? ` vertical="${a.v}"` : ""}${a.wrap ? ` wrapText="1"` : ""}/>`
        : "";
      return `<xf numFmtId="0" fontId="${xf.fontId}" fillId="${xf.fillId}" borderId="${xf.borderId}" xfId="0"` +
        `${xf.fontId ? ' applyFont="1"' : ""}${xf.fillId ? ' applyFill="1"' : ""}` +
        `${xf.borderId ? ' applyBorder="1"' : ""}${alignXml ? ' applyAlignment="1"' : ""}>` +
        `${alignXml}</xf>`;
    }).join("");

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="${fonts.length}">${fontsXml}</fonts>` +
      `<fills count="${fills.length}">${fillsXml}</fills>` +
      `<borders count="${borders.length}">${bordersXml}</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${xfs.length}">${xfsXml}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`;
  }

  return { style, toXml };
}

/* --------------------------------- Sheet XML -------------------------------- */

// cells:  { "A1": { v, t: "str"|undefined, f: "vzorec bez =", s: styleIndex } }
// cols:   [{ index (1-based), width, outlineLevel, hidden, collapsed }]
//         outlineLevel + hidden = seskupený (sbalitelný) a defaultně sbalený
//         sloupec; `collapsed` patří na sousední „souhrnný“ sloupec, u kterého
//         Excel vykreslí tlačítko +/−
// merges: ["A1:F1", ...]
// rowHeights: { 1: 39.75, ... }
// freezeRows: počet zamrznutých řádků odshora
// validations: [{ sqref, values: ["a","b"] }] nebo [{ sqref, formula: "'List'!$A$2:$A$9" }]
//              -> ověření dat typu "seznam" (rozbalovací menu v buňce)
function sheetXml(sheet) {
  const { cells, cols, merges, rowHeights, freezeRows, defaultRowHeight, validations, summaryRight } = sheet;
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
        const vXml = (cell.v !== undefined && cell.v !== "") ? `<v>${xmlEsc(cell.v)}</v>` : "";
        return `<c r="${addr}"${sAttr}${tAttr}><f>${xmlEsc(cell.f)}</f>${vXml}</c>`;
      }
      if (cell.t === "str") {
        if (cell.v === "" || cell.v === undefined || cell.v === null) return `<c r="${addr}"${sAttr}/>`;
        return `<c r="${addr}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(cell.v)}</t></is></c>`;
      }
      if (cell.v === undefined || cell.v === null || cell.v === "") return `<c r="${addr}"${sAttr}/>`;
      return `<c r="${addr}"${sAttr}><v>${cell.v}</v></c>`;
    }).join("");
    const h = rowHeights && rowHeights[r];
    const hAttr = h ? ` ht="${h}" customHeight="1"` : "";
    return `<row r="${r}"${hAttr}>${cellsXml}</row>`;
  }).join("");

  const colsXml = (cols && cols.length)
    ? `<cols>${cols.map((c) => `<col min="${c.index}" max="${c.index}" width="${c.width}" customWidth="1"` +
      `${c.outlineLevel ? ` outlineLevel="${c.outlineLevel}"` : ""}${c.hidden ? ' hidden="1"' : ""}` +
      `${c.collapsed ? ' collapsed="1"' : ""}/>`).join("")}</cols>`
    : "";
  const mergesXml = (merges && merges.length)
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";
  const paneXml = freezeRows
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  const outlineLevelCol = (cols || []).reduce((m, c) => Math.max(m, c.outlineLevel || 0), 0);
  const fmtXml = `<sheetFormatPr defaultRowHeight="${defaultRowHeight || 15}"` +
    `${outlineLevelCol ? ` outlineLevelCol="${outlineLevelCol}"` : ""}/>`;
  // sheetPr musí být první element listu (schéma CT_Worksheet). summaryRight
  // říká, na které straně skupiny Excel vykreslí tlačítko pro sbalení.
  const sheetPrXml = outlineLevelCol
    ? `<sheetPr><outlinePr summaryBelow="1" summaryRight="${summaryRight === false ? 0 : 1}"/></sheetPr>`
    : "";

  // Pořadí prvků v CT_Worksheet je dané schématem — dataValidations musí být
  // až za mergeCells, jinak Excel soubor odmítne jako poškozený.
  const validationsXml = (validations && validations.length)
    ? `<dataValidations count="${validations.length}">${validations.map((v) => {
      const f1 = v.formula !== undefined ? xmlEsc(v.formula) : `"${xmlEsc(v.values.join(","))}"`;
      return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"` +
        `${v.prompt ? ` promptTitle="${xmlEsc(v.promptTitle || "")}" prompt="${xmlEsc(v.prompt)}"` : ""}` +
        ` sqref="${v.sqref}"><formula1>${f1}</formula1></dataValidation>`;
    }).join("")}</dataValidations>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    sheetPrXml +
    `<dimension ref="A1:${colLetters(maxCol)}${maxRow}"/>` +
    paneXml + fmtXml + colsXml +
    `<sheetData>${rowsXml}</sheetData>` +
    mergesXml + validationsXml +
    `</worksheet>`;
}

/* -------------------------------- Workbook ---------------------------------- */

// sheets: [{ name, cells, cols, merges, rowHeights, freezeRows, defaultRowHeight, hidden }]
// hidden: list se v sešitu nezobrazí (jde odkrýt přes pravé tlačítko na oušku)
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
    `<sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}"` +
      `${s.hidden ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`).join("")}</sheets>` +
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
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: encoder.encode(sheetXml(s)) })),
  ];
  return buildZip(files);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildXlsxWorkbook, createStyleBook, colLetters };
}
