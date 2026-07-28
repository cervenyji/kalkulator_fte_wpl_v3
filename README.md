# Kalkulátor FTE → WPL

Webová (HTML/JS) verze původní desktopové aplikace (`calculator.py` +
`inicializace_db.py`). Běží celá lokálně v prohlížeči — žádný server, žádná
instalace Pythonu. Přetáhnete do ní vyplněný Excel checklist (list „VSTUPY“)
a aplikace spočítá potřebný počet WPL po zónách (service / meeting /
backoffice / office room) přesně podle stejné logiky jako originální appka.

## Co je v této složce

```
index.html                  – aplikace, otevřete ji v prohlížeči
app.js                      – veškerá logika (parsování Excelu, výpočet, PDF, DB)
fte_wpl_calculator.db       – vzorová SQLite databáze s výchozími referenčními daty
vendor/                     – vendorované knihovny (sql.js, SheetJS, jsPDF, DejaVu font)
tools/gen_seed_db.py        – skript, kterým byla vygenerována fte_wpl_calculator.db
```

Celou složku je potřeba udržet spolu — `index.html` odkazuje na soubory ve
`vendor/` relativní cestou.

## Spuštění

1. Otevřete `index.html` v **Google Chrome nebo Microsoft Edge** (doporučeno
   — jen tyto prohlížeče umí ukládat změny přímo do souboru na disku).
2. Klikněte v pravém horním rohu na **„Otevřít databázi…“** a vyberte
   přiložený soubor `fte_wpl_calculator.db`. Tím se připojí databáze se
   všemi referenčními tabulkami (absence, časové dotace pozic).
3. Přetáhněte vyplněný Excel checklist do plochy „Nahrát checklist“ (nebo
   klikněte na „vybrat soubor…“).
4. Klikněte na „Spočítat kalkulaci WPL“ — výsledek se zobrazí v tabulce a
   zároveň se uloží do databáze (záložka „Historie kalkulací“), takže je
   kdykoliv zpětně dohledatelné, z jakých vstupních dat kalkulace vznikla.
5. Volitelně klikněte na „Exportovat PDF s přehledem WPL“ pro stažení PDF
   shrnutí — obsahuje i doporučený formát pobočky, počet fasttracků a počet
   židlí v čekací zóně (stejná logika jako v původní appce).

Databáze se po každé změně (nahrání checklistu, spočítání kalkulace, úprava
referenčních dat) automaticky ukládá zpět do stejného souboru
`fte_wpl_calculator.db` — nemusíte nic ručně stahovat.

### Poznámka k prvnímu spuštění / opětovnému otevření

Prohlížeč si vyžádá oprávnění k zápisu do vybraného souboru. Při dalším
otevření `index.html` aplikace nabídne obnovení přístupu k naposledy použité
databázi — stačí jedno kliknutí na „Otevřít databázi…“.

### Firefox / Safari

Tyto prohlížeče neumí zapisovat přímo do souboru na disku (chybí tzv. File
System Access API). Aplikace v nich funguje také, ale databázi je nutné po
každé změně stáhnout tlačítkem „Uložit databázi“ a přesunout stažený soubor
zpět do této složky (přepsat starý `fte_wpl_calculator.db`).

## Referenční data

V záložce „Referenční data“ lze přímo v prohlížeči upravovat:

- **Absence po segmentech** — % nepřítomnosti a homeoffice.
- **Časové dotace pozic** — rozdělení pracovní doby pozice mezi service /
  meeting / backoffice zónu a kancelář (v %).

Úpravy se uloží tlačítkem „Uložit tabulku…“ přímo do databáze.

### Historie referenčních dat (verzování)

Každé uložení výše vytvoří novou **verzi** referenčních dat (pokud se skutečně
něco změnilo — uložení beze změny žádnou duplicitní verzi nevytvoří). Verze se
ukládají do tabulky `ref_data_versions` a jsou k prohlédnutí v sekci „Historie
referenčních dat“ dole na záložce „Referenční data“.

Každá spočítaná kalkulace si zaznamená, se kterou verzí referenčních dat byla
spočítána (sloupec `ref_version_id` v tabulce `calculations`). U výsledku
kalkulace i v historii kalkulací tak najdete rozbalovací odkaz „Referenční
data použitá při této kalkulaci“, který ukáže přesné hodnoty absence a
časových dotací platné v okamžiku výpočtu — i zpětně, po dalších úpravách.

## Analýza segmentů

Pokud nahraný checklist obsahuje list **„ANALÝZA SEGMENTŮ“** (celkový přehled
FTE a WPL po místnostech/zónách v rámci segmentů), aplikace jej při načtení
checklistu uloží a zobrazí:

- v sekci „Analýza segmentů“ pod výsledkem nové kalkulace,
- v detailu každé historické kalkulace (záložka „Historie kalkulací“).

Tabulka se zobrazuje přesně tak, jak je vypočítána v Excelu (včetně sloučených
buněk), a lze ji exportovat do samostatného PDF tlačítkem „Exportovat PDF
analýzy segmentů“. Pokud checklist tento list neobsahuje, zobrazí se
informační poznámka a kalkulace proběhne normálně bez něj.

## Formát vstupního Excelu

Aplikace čte list **„VSTUPY“** stejně jako původní appka:

- `C1` – ID pobočky
- `C2` – název pobočky
- `C3` – otevírací doba pobočky (h/týden)
- `C4` – doba vytížení WPL (h/týden), použije se jako výchozí hodnota pro
  všechny segmenty kromě „CESTOVNÍ“
- od řádku 6 dolů: sloupce A–D = Segment / Pozice / Počet FTE / Vytížení WPL
  (sloupec D se využívá jen u segmentu „CESTOVNÍ“, jinak se použije `C4`)

Řádky s FTE ≤ 0 se ignorují. Pokud pro některou dvojici segment+pozice chybí
záznam v tabulce časových dotací, řádek se vynechá a zobrazí se upozornění.

## Technické detaily

- SQLite běží přímo v prohlížeči přes [sql.js](https://github.com/sql-js/sql.js)
  (WebAssembly). `.wasm` binárka je vložená jako base64 v
  `vendor/sql-wasm-binary.js`, aby fungovala i při otevření `index.html`
  přímo ze souborového systému (prohlížeče blokují `fetch()` na `file://`).
- Excel se čte/parsuje přes [SheetJS](https://sheetjs.com) (`vendor/xlsx.full.min.js`).
- PDF export přes [jsPDF](https://github.com/parallax/jsPDF) s vloženým
  fontem DejaVu Sans (`vendor/dejavu-fonts.js`), aby se správně zobrazovala
  česká diakritika.
