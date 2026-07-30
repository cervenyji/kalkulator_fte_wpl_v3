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
xlsx_writer.js              – vlastní zapisovač .xlsx s formátováním (viz "Struktura checklistu")
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
3. Záložka „Nový výpočet“ vede čtyřkrokovým průvodcem (nahoře je vidět
   orientační timeline): 1) zdroj dat, 2) zadání pozic, 3) výsledek,
   4) sestavení layoutu. V kroku 1 zvolíte buď „Nahrát Excel checklist“,
   nebo „Vytvořit manuálně“ — jakmile zvolíte, zobrazí se jen odpovídající
   formulář (žádné rušivé přepínání mezi oběma možnostmi). Tlačítkem
   „změnit“ u shrnutí zdroje dat nebo kliknutím na krok 1/2 v timeline se
   lze kdykoliv vrátit a zadat kalkulaci znovu.
4. V kroku 2 vyberte **„Důvod kalkulace“** (Přechod na cashless / Modernizace /
   Ad-hoc kalkulace / Optimalizace) a klikněte na „Spočítat kalkulaci WPL“ —
   výsledek (krok 3) se zobrazí v tabulce a zároveň se uloží do databáze
   (záložka „Historie kalkulací“), takže je kdykoliv zpětně dohledatelné,
   z jakých vstupních dat a z jakého důvodu kalkulace vznikla. Formulář pro
   zadání zmizí, aby nepletl — pro další kalkulaci klikněte na „+ Založit
   další kalkulaci“.
5. Volitelně klikněte na „Exportovat PDF s přehledem WPL“ pro stažení PDF
   shrnutí — obsahuje přehled všech pozic z checklistu, referenční data (verzi)
   a nepřítomnost po segmentech, se kterými se počítalo, souhrnnou tabulku a
   doporučený formát pobočky, počet fasttracků a počet židlí v čekací zóně
   (stejná logika jako v původní appce).
6. V kroku 4 „Sestavení layoutu“ přiřaďte konkrétní nábytek do každé zóny
   s vypočítaným požadavkem WPL a uložte layout — poté lze vyexportovat PDF
   se sestavou nábytku po zónách a segmentech.

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

## Vytvoření kalkulace bez Excelu (manuálně)

V kroku 1 průvodce lze místo „Nahrát Excel checklist“ zvolit „Vytvořit manuálně“:

1. Do pole „Pobočka“ začněte psát název — nabídne se ze seznamu poboček
   (tabulka `pobocky`, 317 poboček) a po výběru se automaticky doplní ID a
   region. Pokud pobočka v seznamu není, zadejte ID ručně.
2. Vyplňte otevírací dobu pobočky a dobu vytížení WPL (výchozí 40 h/týden).
3. Tlačítkem „+ Přidat pozici“ přidejte řádky s Segmentem, Pozicí (nabídka se
   omezí na pozice definované pro vybraný segment v tabulce `casove_dotace`)
   a počtem FTE. U segmentu **CESTOVNÍ** se navíc odemkne pole „Vytížení WPL“
   pro zadání individuálního vytížení té pozice (tzv. model cestovních —
   stejné jako sloupec D u Excelu).
4. Tlačítkem „Vytvořit a spočítat“ se vytvoří checklist a odtud pokračuje
   úplně stejný postup jako po nahrání Excelu — náhled pozic, spočítání
   kalkulace, PDF export, sestavení layoutu i uložení do historie.

Seznam poboček je uložen v databázi, takže jej lze v budoucnu upravit přímo
v SQLite (tabulka `pobocky`, sloupce `id_pobocky`, `nazev`, `region`).

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

#### Sloupec „Verze“ u jednotlivých řádků

Obě tabulky referenčních dat mají navíc informativní (needitovatelný) sloupec
**„Verze“**, který u každého řádku ukazuje, ve **které verzi referenčních dat
řádek naposledy vznikl nebo se změnil** (sloupec `ref_version_id` v tabulkách
`absence` a `casove_dotace`). Při uložení se stamp posune jen u řádků, které se
skutečně změnily — nedotčené řádky si ponechají svou původní verzi, takže je
hned vidět, co se v které verzi měnilo. Uložení beze změny nevytvoří novou verzi
ani neposune žádný stamp.

U databází uložených starší verzí aplikace se řádky při připojení označí verzí
platnou v tom okamžiku (její snapshot tyto hodnoty skutečně obsahuje).

## Historie kalkulací

Záložka „Historie kalkulací“ je dvouúrovňová: nejprve uvidíte přehled poboček,
pro které existuje alespoň jedna spočítaná kalkulace (s počtem kalkulací a
datem té poslední), takže je hned vidět, kde už kalkulace proběhla vícekrát.
Kliknutím na pobočku se zobrazí seznam všech jejích kalkulací v čase; kliknutím
na konkrétní kalkulaci pak její detail (vstupní data, výsledek, referenční
data i sestavený layout).

## Klíčové ukazatele a benchmark

Pod výsledkem kalkulace se zobrazí:

- **Stanovený formát pobočky** (small / medium economy / medium / flagship),
  doporučený počet fasttracků a doporučený počet židlí v čekací zóně — stejná
  logika jako v původní appce.
- **Potřebná plocha** — spočítaná jako celkové WPL × 25 m².
- **Poměr WPL / FTE** — kolik WPL připadá na jedno FTE (v %).
- **Podíl Backoffice zóny** a **podíl míst pro jednání s klientem (meeting
  zone)** — jaký podíl z celkového spočítaného WPL tvoří tyto zóny.

Každá z těchto tří poměrových hodnot se porovnává s **benchmarkem** — průměrem
přes všechny dosud spočítané kalkulace se stejným formátem pobočky (tabulka
`calculation_stats`). Jak postupně přibývají kalkulace, benchmark se zpřesňuje
a je vidět, o kolik procentních bodů se aktuální pobočka od průměru liší.
Kalkulace uložené ještě před zavedením této funkce se při připojení databáze
automaticky dopočítají, takže se do benchmarku započítá i starší historie.

Zaškrtávacím políčkem „Zahrnout klíčové ukazatele a benchmark do PDF“ (nad
tlačítkem exportu) lze tuto sekci do PDF přidat, nebo z něj vynechat —
souhrnná tabulka a doporučení formátu/fasttracků/židlí v PDF zůstávají vždy.

## Kopírování výsledku do schránky (MS Teams, Outlook, Word)

Tlačítkem **„📋 Kopírovat výsledek do schránky“** (u výsledku kalkulace i
v detailu v historii) se výsledek zkopíruje jako **formátovaná tabulka**.
Vložením přes Ctrl+V do MS Teams, Outlooku, Wordu nebo Excelu se vloží včetně
formátování — rámečků, barevného záhlaví, barev segmentů a zvýrazněného řádku
„Celkem“ — plus tabulka klíčových ukazatelů.

Do schránky se zapisují dva formáty současně:

- **`text/html`** — formátovaná tabulka. Styly jsou napsané **inline v atributu
  `style`**, protože Teams (a Outlook/Word) při vložení zahodí CSS ze stránky
  a nechá si jen inline styly.
- **`text/plain`** — tabulátory oddělená varianta jako záloha pro aplikace,
  které HTML nepřijímají (vložením do Excelu se rozpadne do sloupců).

Použije se asynchronní Clipboard API; pokud ho prohlížeč v daném kontextu
nepovoluje, aplikace se automaticky přepne na záložní cestu přes
`document.execCommand("copy")` s dočasným výběrem, která formátování zachová
také.

## Sestavení layoutu

Pro každý segment a zónu, kde kalkulace vyžaduje WPL > 0, aplikace nabídne
nábytek definovaný v tabulce `furniture_to_zone` (shodná data jako v původní
appce) a umožní zadat počet kusů. Živě se zobrazuje, kolik WPL je již
přiřazeno vůči požadavku. Tlačítkem „Uložit layout“ se přiřazení uloží k dané
kalkulaci (tabulka `layouts`) a lze ho poté exportovat do PDF se sestavou
nábytku po zónách a segmentech — stejné rozdělení jako v původní appce
(`export_layout_to_pdf`). Layout je vidět i v historii kalkulací.

Zóny bez vypočítané potřeby WPL se zobrazí sbalené („bez výpočtu WPL — ruční
přiřazení“) — jde o pojistku, díky které lze do libovolné zóny doplnit nábytek
i nad rámec výpočtu (např. ruční rezervu), pokud je potřeba kalkulaci přebít.

Uložený layout lze kdykoliv upravit tlačítkem „Upravit layout“ — formulář se
znovu otevře s předvyplněnými počty kusů a uložení přepíše původní přiřazení.

Pokud pro nějaký segment/zónu není v databázi definovaný žádný nábytek,
zobrazí se u dané zóny informační poznámka místo formuláře.

### Automatické předvyplnění podle pravidel

Nový layout se podle **stanoveného formátu pobočky** a spočítaných potřeb WPL
částečně předvyplní sám. Předvyplněné hodnoty jsou barevně zvýrazněné (modře)
a označené štítkem „doporučeno“ — jde o návrh, který lze libovolně přepsat.
U nadpisu „Sestavení layoutu“ je ikona **„?“**, po najetí myší se rozbalí
bublina s výpisem všech platných pravidel.

Platná pravidla:

| Zóna | Nábytek | Formát | Počet |
| --- | --- | --- | --- |
| Service zone | Fast track (stolek a židle) | všechny | doporučený počet fasttracků na hale |
| Service zone | Čekací zóna (židle) | small, medium economy | doporučený počet židlí v čekací zóně |
| Service zone | Čekací zóna (obývák) | medium, flagship | doporučený počet židlí v čekací zóně |
| Service zone | Lenka vítací (vítací pracoviště) | small, medium economy | vždy **právě 1 ks** |
| Service zone | Theke - nízká (vítací pracoviště) | medium | vždy **právě 1 ks** |
| Service zone | Theke - vysoká (vítací pracoviště) | flagship | vždy **právě 1 ks** |
| Service zone | Lenka | všechny | zbytek potřeby WPL nad vítací pracoviště, zaokrouhlený nahoru (3,4 → 3 ks) |
| Backoffice zone | Interní zasedací místnost - malá | medium economy | 1 ks |
| Backoffice zone | Interní zasedací místnost - velká | medium, flagship | 1 ks |
| Meeting zone | Jednací místnost | všechny | celá potřeba WPL (5 → 5 ks) |
| Backoffice zone | Kancelářské místo | všechny | potřeba WPL zaokrouhlená dolů (5 → 5 ks) |
| Backoffice zone | Fast track backoffice | všechny | 1 ks, je-li desetinná část potřeby WPL > 0,5 |
| Office room | Kancelář | všechny | je-li v zóně jakákoliv potřeba WPL |

Poznámky k chování:

- Pravidlo se použije jen u segmentů, které daný nábytkový prvek v dané zóně
  skutečně mají (dle tabulky `furniture_to_zone`) — např. servisní místa nebo
  interní zasedací místnosti jsou definované jen pro segment MMMA, takže se
  předvyplní jen tam. Naopak „Kancelářské místo“, „Jednací místnost“ nebo
  „Kancelář“ existují u více segmentů, a tam se pravidlo použije pro každý
  segment zvlášť s jeho vlastní potřebou WPL.
- **Při úpravě už uloženého layoutu se předvyplnění neprovádí**, aby nepřepsalo
  hodnoty, které uživatel dříve zadal.
- Definice pravidel je v `app.js` v konstantě `LAYOUT_RULES` — ze stejné
  definice se generuje i text nápovědy, takže se popis nemůže rozejít se
  skutečným chováním.

Prvek **„Interní zasedací místnost - malá“** se počítá jako 1 WPL / kus (dříve
byl vedený jako prvek nepřispívající k WPL). U databází vytvořených starší verzí
aplikace se hodnota při připojení automaticky opraví.

### Kompletní přehled WPL po zónách a segmentech

Po uložení layoutu se nad seznamem nábytku zobrazí souhrnná matice
**segment × zóna** s těmito sloupci:

| Segment | FTE | Service zone | Meeting zone | Backoffice zone | Office room | WPL celkem | WPL / FTE |

- U každé zóny je uvedena **potřeba WPL z kalkulace** a za lomítkem **skutečně
  přiřazené WPL** ze sestaveného layoutu; barevně se odlišuje shoda (zeleně),
  méně (oranžově) a více (modře), než je potřeba.
- Sloupec **WPL / FTE** je metrika, na kolik FTE dané WPL vychází — jak
  **celkem**, tak **za každý segment zvlášť**.
- Součtový řádek „Celkem“ přebírá potřebu WPL a FTE z řádku „Celkem“ kalkulace,
  ne ze součtu zobrazených hodnot za segmenty. Hodnoty za segmenty jsou totiž
  zaokrouhlené na jedno desetinné místo, takže jejich součet se může o desetinu
  lišit (např. segmenty 2,3 + 0,0, ale Celkem 2,4). Díky tomu přehled ukazuje
  stejná čísla jako tabulka výsledku kalkulace a klíčové ukazatele.

Stejná tabulka je i v PDF exportu layoutu (a tedy i ve spojené sestavě).

### Analýza segmentů, zón a jejich prvků

Pod seznamem nábytku je **rozbalovací analýza**, která se po rozbalení zobrazí
jako **jedna jednotná tabulka**:

| Segment | Zóna | Nábytkový prvek | Počet ks | WPL / kus | WPL přiřazeno |

- Každý nábytkový prvek má vlastní řádek. Buňky se segmentem a zónou jsou
  vertikálně sloučené (`rowspan`) přes všechny své řádky, takže se celá analýza
  čte jako jedna tabulka, ne jako vnořené bloky.
- U segmentu je uvedeno FTE a celková potřeba WPL, u zóny potřeba a přiřazené WPL.
- Za každým segmentem je součtový řádek („Celkem <segment>“) a na konci celkový
  součet za pobočku.
- Prvky, které nepřispívají k WPL, mají ve sloupci „WPL / kus“ pomlčku.

### Nábytek připadající na druh zaměstnance

Pod analýzou je další rozbalovací tabulka, která ukazuje, **kolik kterého nábytku
připadá na jeden druh zaměstnance** (pozici z checklistu — např. „osobní bankéř
- medior“):

| Segment | Pozice (druh zaměstnance) | Zóna | Nábytkový prvek | Připadá ks | z toho na 1 FTE |

Výpočet: pro každou pozici se spočítá její WPL po zónách úplně stejným postupem
jako v samotné kalkulaci (FTE × vytížení × (1 − absence − homeoffice), rozdělené
procenty časové dotace) a nábytek přiřazený do dané zóny se pak rozdělí mezi
pozice **podle jejich podílu na potřebě WPL té zóny**. Počty kusů jsou proto
zlomkové — jde o podíl, který na danou pozici připadá (např. 2 jednací místnosti
se mezi dvě pozice rozdělí jako 1,47 a 0,53). Sloupec „z toho na 1 FTE“ dělí
podíl počtem FTE dané pozice.

Referenční data se berou ze **snapshotu verze, se kterou byla kalkulace
spočítána**, takže pozdější úpravy referenčních dat rozpočet zpětně nezkreslí.

Řádky **„Nerozpočítáno“** obsahují nábytek v zónách, kde kalkulace nevyžaduje
žádné WPL (typicky vítací pracoviště, fasttracky nebo čekací zóna doplněné podle
pravidel či ručně). Na pozice je rozdělit nelze — v takové zóně žádná pozice WPL
negeneruje, takže neexistuje podíl, kterým by se dělil. Vykazují se proto zvlášť,
aby součty odpovídaly skutečnému obsahu layoutu a žádný prvek „nezmizel“.

### Generovat celou sestavu (kalkulace + layout v jednom PDF)

Tlačítkem **„Generovat celou sestavu (kalkulace + layout)“** se vyexportuje
jeden PDF dokument, který obsahuje obojí — nejprve celou kalkulaci FTE → WPL
(stejný obsah jako „Exportovat PDF s přehledem WPL“, včetně zaškrtnuté volby
klíčových ukazatelů a poznámky) a na další stránce sestavení layoutu (včetně
kompletního přehledu WPL po zónách a segmentech). Soubor se jmenuje
`sestava_<calculation_key>.pdf`. Samostatné exporty kalkulace i layoutu zůstávají
zachované.

## Barevné schéma a ikony segmentů

Každý segment (MMMA, SBC, HC, EPC, EPB, PROVOZ, RKC, CESTOVNÍ, CESTOVNÍ POZICE, OSTATNÍ) má
přiřazenou barvu a ikonu — používají se jednotně v tabulce výsledků a v sestavení layoutu i v PDF
exportech (barevný čtvereček před názvem segmentu; ikony jako emoji se v PDF nevykreslují, protože
je vložený font DejaVu Sans neobsahuje). Barvy, ikony i pořadí segmentů lze upravit v novém modulu
„Struktura checklistu“ (viz níže).

## Stav kalkulace: rozpracovaná / potvrzená

Každá spočítaná kalkulace má stav — nově vytvořená je vždy **„Rozpracovaná“**. U výsledku kalkulace
i v detailu v historii je tlačítko, kterým lze kalkulaci **potvrdit / uzavřít** (nebo naopak vrátit
zpět do rozpracované). Stav se zobrazuje jako štítek u výsledku, v detailu kalkulace i v přehledu
kalkulací dané pobočky v historii.

## Struktura checklistu (segmenty, pozice, nábytek, Excel šablona)

Nová záložka **„Struktura checklistu“** v horní liště slouží ke správě dat, ze kterých vychází
Excel checklist i celá kalkulace:

- **Segmenty** — pořadí, barva a ikona (viz výše).
- **Pozice** — stejná data a stejný editor jako v „Referenčních datech“ (tabulka `casove_dotace`);
  nová/upravená pozice se okamžitě promítne i tam a naopak.
- **Nábytek** — nábytkové prvky pro sestavení layoutu po segmentech a zónách (tabulka
  `furniture_to_zone`), nyní přímo editovatelné (dosud jen needitovatelná seedovaná data).

Tlačítkem **„Generovat Excel šablonu“** se z aktuálního obsahu těchto tří tabulek vygeneruje
`.xlsx`, který **vypadá i funguje stejně jako vzorový checklist** — se dvěma listy:

- **`CHL`** — list, do kterého vyplňuje pobočka. Obsahuje kompletní rozvržení vzoru:
  - hlavičku s titulkem (`=_xlfn.CONCAT("CHECKLIST"," - ",C3)`) a polem pro celkový počet WPL,
  - sekci **DETAILY POBOČKY** (název, datum zpracování, cílový formát, typ akce, režim obsluhy
    klientů) a vpravo velká pole **otevírací doby** a **doby vytěžení WPL**; vybírané položky
    mají **rozbalovací menu** (ověření dat) — viz níže,
  - sekci **OBSAZENOST POBOČKY** — pozice po segmentech se sloupci „POČET FTE AKTUÁLNĚ“,
    „POČET FTE VÝHLED“ a „POZNÁMKA“, s součtovým řádkem „Suma FTE:“ za každým segmentem
    a řádkem „Suma FTE bez CEST:“,
  - volný blok **CESTOVNÍ POZICE** (9 řádků) se sloupcem „DOBA VYUŽITÍ WPL V HODINÁCH TÝDNĚ“
    a řádkem „Suma FTE s CEST:“,
  - sekce **SAZO**, **BUSINESS ZONE** (FRONT OFFICE — service a meeting zone) a **BACK OFFICE**
    s nábytkem po segmentech a zónách, sloupci „POČET“ / „WPL“ / „POZNÁMKA“,
  - **SUMMARY** s dopočtem počtu ATM a WPL, sekci **VYBAVENÍ** (bankovní technika, ostatní
    vybavení, náhradní provoz), blok doplňujících informací a řádky Load key / Calculation key.
- **`VSTUPY`** — list, který si hodnoty z CHL jen **stahuje vzorci** (`=CHL!G1`, `=CHL!C3`,
  `=CHL!I3`, `=CHL!H10`, `=$C$4`, u cestovních `=IF(CHL!B80=0,"",…)`) do přesně té podoby, kterou
  čte `parseVstupySheet()` (C1–C4 + řádky od 6, sloupce A–D). Aplikace parsuje výhradně tento list
  — mechanismus je stejný jako u originální šablony, takže po vyplnění CHL a uložení souboru
  v Excelu (kdy se vzorce přepočítají) obsahuje VSTUPY aktuální hodnoty.

Obsah pozic a nábytku pochází z databáze aplikace, takže nově přidaná pozice nebo nábytkový prvek se
při dalším vygenerování šablony automaticky objeví v obou listech se správně provázanými vzorci.
Pořadí uvnitř segmentu se drží podle pořadí zavedení (sloupec `id`), což odpovídá pořadí ve vzoru;
pořadí segmentů řídí sloupec „Pořadí“ v tabulce segmentů. Takto vygenerovaný a vyplněný soubor lze
bez úprav znovu načíst zpět do aplikace (záložka „Nový výpočet“ → „Nahrát Excel checklist“).

Šablona je **skutečně naformátovaná** podle vzoru — barevné nadpisy sekcí (tmavě modrá `#235377`),
tyrkysové popisky segmentů a součtů, šedé popisky zón, modré písmo vyplňovaných buněk, velká
tyrkysová čísla u hodin, sloučené buňky, šířky sloupců i výšky řádků. Vendorovaná knihovna SheetJS
(komunitní edice) umí formátování buněk sice přečíst, ale při zápisu (`XLSX.write`) ho vždy zahazuje
(ověřeno přímým testem) — proto se šablona nesestavuje přes SheetJS, ale přes vlastní minimalistický
zapisovač `.xlsx` (`xlsx_writer.js`), který .xlsx (ZIP + OOXML XML) sestaví přímo. Shoda se vzorem je
ověřená porovnáním obou souborů knihovnou `openpyxl` (výplně, fonty, ohraničení po stranách,
zarovnání, sloučené buňky, šířky sloupců, výšky řádků) i zpětným načtením vyplněné šablony do
aplikace.

#### Rozbalovací menu v hlavičce CHL

Vybírané položky v sekci DETAILY POBOČKY mají v šabloně **ověření dat typu „seznam“**, takže se
v buňce nabídne rozbalovací menu a nejde napsat nic mimo číselník:

| Buňka | Obsah | Nabídka |
| --- | --- | --- |
| `C3` | Název pobočky | všech 317 poboček z tabulky `pobocky` (list **Pobočky**) |
| `C5` | Cílový formát | small, medium-economy, medium, flagship, EPC |
| `C6` | Typ akce | Modernizace (nový formát), Relokace (nový formát), Nová pobočka, Optimalizace plochy, FHC (úprava nového formátu), Přechod na cashless, Kontrolní přepočet FTE/WPL, Ad-hoc, Studie |
| `C7` | Režim obsluhy klientů | cash, cashless |

**ID pobočky (`G1`) se dopočítá samo** z názvu vybraného v `C3` vzorcem
`=IFERROR(VLOOKUP(C3,'Pobočky'!$A$2:$B$318,2,0),"")` — a protože `VSTUPY!C1` je `=CHL!G1`, dostane
aplikace ID pobočky bez dalšího zadávání.

Šablona proto obsahuje ještě třetí, pomocný list **Pobočky** se seznamem poboček (název, ID, region)
z databáze aplikace. Slouží jako zdroj rozbalovacího menu pro `C3` a jako vyhledávací tabulka pro
`VLOOKUP` — seznam 317 poboček by se do definice ověření dat vepsat nedal (Excel má u seznamu
zadaného přímo v ověření limit 255 znaků). Kratší číselníky (`C5`, `C6`, `C7`) jsou proto zapsané
přímo v ověření dat.

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
- Nahraný Excel checklist se čte/parsuje přes [SheetJS](https://sheetjs.com)
  (`vendor/xlsx.full.min.js`).
- Generovaná Excel šablona (záložka „Struktura checklistu“) se naopak zapisuje
  vlastním minimalistickým zapisovačem `.xlsx` (`xlsx_writer.js`) — vendorovaná
  SheetJS (komunitní edice) při zápisu zahazuje veškeré formátování buněk, což
  by pro šablonu, která má vypadat jako vzorový checklist, nešlo použít.
- PDF export přes [jsPDF](https://github.com/parallax/jsPDF) s vloženým
  fontem DejaVu Sans (`vendor/dejavu-fonts.js`), aby se správně zobrazovala
  česká diakritika.
