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
5. V kroku 4 „Sestavení layoutu“ přiřaďte konkrétní nábytek do každé zóny
   s vypočítaným požadavkem WPL a uložte layout.
6. Na konci kalkulace je blok **„Výstup a sestava“** — zvolte rozsah (celá
   sestava / jen kalkulace / jen návštěvnost / jen layout), co všechno se má
   vytisknout, a klikněte na „Vygenerovat PDF“. Sestava obsahuje přehled všech
   pozic z checklistu, referenční data (verzi) a nepřítomnost po segmentech,
   se kterými se počítalo, souhrnnou tabulku, doporučený formát pobočky, počet
   fasttracků a počet židlí v čekací zóně (stejná logika jako v původní appce)
   a podle rozsahu i layout a analýzu návštěvnosti. Ve stejném bloku jsou
   i tlačítka pro kopírování do schránky a „Potvrdit / uzavřít kalkulaci“.

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

### Nápověda „?“ u výsledku kalkulace

U nadpisu **„Výsledek kalkulace“** je ikona **„?“**, která vysvětlí vzorec a rozepíše ho na dvou
konkrétních pozicích (`osobní bankéř - medior` a `bankéř klientské péče - medior`) —
s **koeficientem nepřítomnosti** a s reálnými čísly té konkrétní kalkulace:

```
WPL = FTE × doba vytížení × (1 − nepřítomnost − homeoffice) × dotace zóny % ÷ otevírací doba
```

Například pro 8 FTE „osobní bankéř - medior“ v MMMA při otevírací době 40 h/týden:

1. koeficient přítomnosti: 1 − 22,9 % − 0,7 % = **0,764**,
2. efektivně odpracováno: 8 × 40 × 0,764 = **244,5 h/týden**,
3. Meeting zone: 244,5 h × 80 % ÷ 40 h = **4,89 WPL**, Backoffice zone: 244,5 × 20 % ÷ 40 = **1,22 WPL**.

Pokud pozice v kalkulaci není, ukáže nápověda modelový výpočet pro 1 FTE. Hodnoty se berou ze
snapshotu verze referenčních dat, se kterou kalkulace vznikla.

### Vytížení zón u soupisu zaměstnanců (progress bar)

Všude, kde je vidět **soupis zaměstnanců pobočky** — náhled checklistu před
výpočtem, „Vstupní data z checklistu“ v detailu kalkulace a kapitola **„Přehled
pozic z checklistu“ v PDF** — má každá pozice navíc **vodorovný pruh
s rozdělením jejího času po zónách** podle časových dotací v referenčních datech
(ServiceZ / MeetingZ / BackofficeZ / OfficeRoom).

- Barvy jsou jednotné: 🟦 Service zone, 🟩 Meeting zone, 🟧 Backoffice zone,
  🟪 Office room, šedá = nezařazený zbytek do 100 %.
- V PDF je pruh vykreslený stejně, kapitola je nově **tabulka** (segment, pozice,
  FTE, WPL, pruh) a buňka segmentu má **podbarvení jeho barvou** z nastavení
  segmentů.
- Pokud kalkulace zná svou **verzi referenčních dat**, bere se rozdělení ze
  snapshotu té verze — pruh tedy ukazuje stav, se kterým se počítalo, ne dnešní.

### Vyhledávání a filtrování v tabulkách

Nad každou editovatelnou tabulkou v záložkách **„Referenční data“**
a **„Struktura checklistu“** je vyhledávací pole (absence, časové dotace pozic,
segmenty, nábytek); u nábytku je navíc **výběr zóny**, který se s hledaným
textem kombinuje. Hledá se **po slovech** a nezávisle na velikosti písmen —
„bankéř medior“ najde řádky obsahující obojí bez ohledu na pořadí. U nábytku
text prohledává segment, název prvku i název zóny.

Pod tabulkou je vždy vidět, kolik řádků je zobrazeno z celkového počtu. Filtr
slouží **jen k prohlížení**: řádky, které mu nevyhovují, se nezahazují —
**uložení tabulky zapíše i je**, takže filtrovat lze bez rizika ztráty dat.

### Barevné označení zdroje dat

Čísla v aplikaci pocházejí ze dvou nezávislých zdrojů a u každého bloku je proto
**barevný štítek a stejně barevný levý pruh**, takže je hned vidět, na čem stojí:

| Štítek | Barva | Co to znamená | Kde |
| --- | --- | --- | --- |
| **z kalkulace FTE → WPL** | modrá | počítá se ze zadaných FTE a referenčních dat | výsledek kalkulace, vstupní data z checklistu, klíčové ukazatele, sestavení layoutu, kompletní přehled WPL |
| **z návštěvních dat** | zelená | počítá se ze skutečných návštěv v reportu | návštěvnost a doporučení prostor, doporučený počet míst, Monte Carlo |
| **kalkulace + návštěvní data** | fialová | kombinuje kapacitu z kalkulace se skutečnou návštěvností | roční kapacita, kapacitní shrnutí, tři kontroly schůzek, srovnání s kalkulací, návštěvy na bankéře |

Nad výsledkem kalkulace (i v detailu v historii) je legenda těchto tří barev.
Stejné rozdělení má i PDF — kapitola 1 je modrá (kalkulace), kapitola 2 zelená
(kapacita a návštěvnost), kapitola 3 fialová (layout).

### Řazení, heatmapa a pruhy v časových dotacích

Tabulky **Časové dotace pozic** (v „Referenčních datech“ i ve „Struktuře
checklistu“) a **Nábytek** navíc umí:

- **Řazení kliknutím na hlavičku** kteréhokoli sloupce — u časových dotací
  segment, pozice, čtyři zóny i souhrnný sloupec „Vytížení zón“, u nábytku
  segment, zóna, název prvku, WPL na kus i verze. Druhé kliknutí obrátí směr,
  šipka v hlavičce ukazuje aktuální řazení. Řazení je **jen zobrazovací** —
  uložení zapíše řádky zpět v původním pořadí (podle `id`), takže se nerozhodí
  pořadí pozic ani nábytku v generovaném checklistu.
- **Heatmapu**: buňka s procentem je podbarvená barvou své zóny, tím sytěji, čím
  vyšší je hodnota (100 % = nejsytější odstín). Prázdná nebo nulová hodnota
  zůstává bílá.
- **Pruh „Vytížení zón“** v každém řádku časových dotací — stejný jako u soupisu
  zaměstnanců, takže je na první pohled vidět, jestli dotace dávají dohromady 100 %.
  (Heatmapa a pruh jsou jen u časových dotací; tabulka nábytku má řazení.)

Heatmapa i pruh se přepočítávají **živě při psaní**, ještě před uložením.

### Kopírování vyfiltrovaného nábytku do schránky

V záložce „Struktura checklistu“ v části **Nábytek** je tlačítko
**„📋 Kopírovat zobrazené prvky“**, které zkopíruje **právě zobrazené
(vyfiltrované) řádky** jako formátovanou tabulku (segment, zóna, nábytek,
WPL na kus, verze) — vložením přes Ctrl+V do Wordu, Teams nebo Excelu se vloží
včetně formátování, v Excelu se rozpadne do sloupců. V hlavičce je popsaný
použitý filtr a počet prvků. Kopírují se hodnoty tak, jak jsou ve formuláři —
tedy i rozepsané, ještě neuložené úpravy.

### Historie referenčních dat (verzování)

Verzují se **tři** sady referenčních dat:

| Data | Kde se upravují | Snapshot ve verzi |
| --- | --- | --- |
| **Absence po segmentech** | Referenční data | `absence_json` |
| **Časové dotace pozic** | Referenční data / Struktura checklistu | `dotace_json` |
| **Nábytkové prvky** (`furniture_to_zone`) | Struktura checklistu → Nábytek | `furniture_json` |

Každé uložení kterékoli z nich vytvoří novou **verzi** referenčních dat (pokud
se skutečně něco změnilo — uložení beze změny žádnou duplicitní verzi
nevytvoří). Verze se ukládají do tabulky `ref_data_versions` a jsou
k prohlédnutí v sekci „Historie referenčních dat“ dole na záložce „Referenční
data“; nábytek je tam kvůli počtu řádků v rozbalovacím bloku.

Každá spočítaná kalkulace si zaznamená, se kterou verzí referenčních dat byla
spočítána (sloupec `ref_version_id` v tabulce `calculations`). U výsledku
kalkulace i v historii kalkulací tak najdete rozbalovací odkaz „Referenční
data použitá při této kalkulaci“, který ukáže přesné hodnoty absence, časových
dotací i nábytkových prvků platné v okamžiku výpočtu — i zpětně, po dalších
úpravách.

#### Sloupec „Verze“ u jednotlivých řádků

Všechny tři tabulky (absence, časové dotace, nábytek) mají navíc informativní
(needitovatelný) sloupec **„Verze“**, který u každého řádku ukazuje, ve **které
verzi referenčních dat řádek naposledy vznikl nebo se změnil** (sloupec
`ref_version_id` v tabulkách `absence`, `casove_dotace` a `furniture_to_zone`).
Při uložení se stamp posune jen u řádků, které se skutečně změnily — nedotčené
řádky si ponechají svou původní verzi, takže je hned vidět, co se v které verzi
měnilo. Uložení beze změny nevytvoří novou verzi ani neposune žádný stamp.
U nábytku se řádek považuje za změněný, když se u něj změní **WPL na kus**;
nový prvek nebo prvek s přepsaným názvem, segmentem či zónou je novým řádkem
(a dostane tedy aktuální verzi).

U databází uložených starší verzí aplikace se řádky při připojení označí verzí
platnou v tom okamžiku (její snapshot tyto hodnoty skutečně obsahuje) —
u nábytku se do této verze zároveň doplní jeho snapshot, aby byl detail verze
úplný.

## Historie kalkulací

Záložka „Historie kalkulací“ je dvouúrovňová: nejprve uvidíte přehled poboček,
pro které existuje alespoň jedna spočítaná kalkulace (s počtem kalkulací a
datem té poslední), takže je hned vidět, kde už kalkulace proběhla vícekrát.
Kliknutím na pobočku se zobrazí seznam všech jejích kalkulací v čase; kliknutím
na konkrétní kalkulaci pak její detail (vstupní data, výsledek, referenční
data i sestavený layout).

**Potvrzené (uzavřené) kalkulace mají v seznamu zelený svislý proužek** vlevo
a světle zelené podbarvení, takže je hned vidět, které jsou hotové a které jsou
ještě rozpracované (viz „Stav kalkulace“ níže).

### Smazání kalkulace

V detailu kalkulace je tlačítko **„🗑 Smazat kalkulaci“**. Po potvrzení dialogu
(ukáže, kolik řádků výsledku a layoutu se smaže) zmizí všechno, co ke kalkulaci
patří: výsledek, sestavený layout, uložené klíčové ukazatele i snapshot
návštěvnosti. **Vstupní data z checklistu** (`excel_loads`) se smažou jen tehdy,
když je nepoužívá žádná další kalkulace — jinak zůstanou. Naimportovaný report
návštěvnosti se nemaže nikdy, ten je společný pro všechny pobočky.

## Vertikální timeline u kalkulace

Vedle výsledku kalkulace je vlevo **svislá osa postupu**, která ukazuje, kde se
zpracování zrovna nachází a co ještě čeká:

1. **Kalkulace a výsledek** — s celkovým FTE → WPL,
2. **Klíčové ukazatele a kapacita** — formát pobočky, benchmark, roční kapacita,
3. **Analýza návštěvnosti** — doporučení prostor a Monte Carlo (nedostupné,
   pokud pro pobočku není report),
4. **Sestavení layoutu** — dokud není uložený, je označený jako aktuální krok,
5. **Kapacitní shrnutí** — stačí to na špičku?,
6. **Výstup a nastavení PDF** — co se vygeneruje do sestavy.

Body mají tři stavy (hotovo zeleně, aktuální modře, čeká šedě), kliknutím se
odroluje na příslušnou část a bod, který je zrovna vidět, se sám zvýrazní.
Po uložení layoutu se stavy překlopí (layout hotový → aktuálním krokem je
výstup).

## Klíčové ukazatele a benchmark

Pod výsledkem kalkulace se zobrazí:

- **Stanovený formát pobočky** (small / medium economy / medium / flagship) —
  stejná logika jako v původní appce.
- **Doporučený počet fasttracků a židlí v čekací zóně** — počítá se ze špičky
  na hale podle reálné návštěvnosti, viz
  [Špička na bankovní hale](#špička-na-bankovní-hale-židle-v-čekací-zóně-a-fast-tracky).
  U každého čísla je uvedeno, z čeho vzniklo.
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

Jestli se tato sekce dostane do PDF, se řídí volbou „Klíčové ukazatele
a benchmark“ v boxu [„Výstup a sestava“](#výstup-a-sestava-všechno-generování-na-jednom-místě).

## Kopírování výsledku do schránky (MS Teams, Outlook, Word)

V boxu **„Výstup a sestava“** na konci kalkulace (i v detailu v historii) jsou
dvě kopírovací tlačítka:

- **„📋 Kopírovat kalkulaci“** — výsledek kalkulace jako **formátovaná tabulka**
  (rámečky, barevné záhlaví, barvy segmentů, zvýrazněný řádek „Celkem“) plus
  tabulka klíčových ukazatelů.
- **„📋 Kopírovat nábytek po segmentech“** — přehled nábytku z uloženého layoutu
  po segmentech a zónách (prvek, počet kusů, WPL) včetně součtů za segment
  a za celou pobočku. Dokud není layout uložený, je tlačítko nedostupné.

Vložením přes Ctrl+V do MS Teams, Outlooku, Wordu nebo Excelu se obojí vloží
včetně formátování.

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

## Návštěvnost a doporučení prostor (report návštěvnosti)

Záložka **„Návštěvnost“** umí naimportovat HTML report návštěvnosti („Analýza
návštěvnosti“) a data z něj napojit na zpracovávanou kalkulaci. Report má
všechna čísla vložená přímo v sobě (objekt `const DATA` klíčovaný ID pobočky
a konstanty modelu `const C`), takže se načte celý v prohlížeči — nikam se
neodesílá.

Z reportu si aplikace pro každou pobočku ukládá jen to, co kalkulace používá:
doporučení prostor, návštěvy po hodinách, Monte Carlo model (základní varianta
i varianta +20 %) a kontext pobočky (počet návštěv, počet dnů, formát dle
reportu, počet bankéřů OB, servisní zóna). Ostatní části reportu (heatmapy,
měsíční a denní řady, prodeje, benchmark) se neukládají.

### Co se zobrazí u kalkulace

U výsledku kalkulace (a v detailu v historii) je sekce **„Návštěvnost
a doporučení prostor“**:

- **Doporučený počet míst ve třech variantách** — zasedací místnosti i servisní
  místa vždy zvlášť:

  | Varianta | Z čeho vychází |
  | --- | --- |
  | **Reálná data** (skutečné návštěvy a kapacita) | špička: `λ` = průměrné příchody v nejfrekventovanější hodině, `P95 = λ + 1.645·√λ`, počet míst = `⌈P95 × minuty obsluhy ÷ 60⌉` (schůzka 45 min, walk-in 15 min); v detailu je i průměrný den (počet schůzek a walk-inů za den proti otevírací době) |
  | **Monte Carlo — varianta a)** | špičková P95 poptávka ze simulace reportu: `⌈P95 souběžných schůzek⌉` a `⌈P95 souběžných obsluh⌉` |
  | **Monte Carlo — varianta b)** | stejná simulace s návštěvností vyšší o 20 % |

  U každé varianty je zároveň vidět, **jak by byl doporučený počet míst
  využitý**: kolik návštěv je dnes (u varianty b) i s čím model počítá, tedy
  +20 %), jaké je vytížení ve špičce v procentech a **kolik návštěv denně by
  muselo přijít, aby byla místa využitá na 90 %** (v závorce rozdíl proti
  dnešku). Např. u Strakonic: Monte Carlo a) doporučuje 9 zasedacích místností,
  ty jsou dnes ve špičce využité z 92 % a na 90 % by odpovídalo 22.0 schůzek
  denně (dnes 22.4).

  **Ve zbytku aplikace i sestavy (karty nahoře, srovnání s kalkulací, kapacitní
  shrnutí, graf) se pracuje s variantou Monte Carlo a)** — v tabulce je
  zvýrazněná. Pokud report pro pobočku Monte Carlo nemá (a tedy zbývá jen první
  varianta), použije se varianta podle reálných dat; u poboček, kde report
  neuvádí ani doporučení ze špičky, se dopočítá v aplikaci stejným vzorcem
  z návštěv po hodinách (v seznamu poboček je taková hodnota s hvězdičkou).
- **Srovnání s kalkulací** — potřeba WPL pro meeting zone a service zone
  z kalkulace (z časových dotací pozic) proti doporučení z reálné návštěvnosti.
  Kladný rozdíl znamená, že špička návštěvnosti potřebuje víc míst, než vychází
  z FTE. Doporučení kalkulaci **nepřepisuje** — je to druhý pohled při
  sestavování layoutu.
- **Detail návštěv po hodinách** (rozbalovací) — pro hodiny 6–21 průměrný počet
  návštěv na otevírací den po typech (fyzická / online schůzka, bezhotovostní
  a hotovostní obsluha), součty za schůzky a walk-in a celkem, s vyznačenou
  nejsilnější hodinou, ze které doporučení vychází.
- **Otevírací doba a návštěvy na bankéře** — otevírací doba pobočky **z reportu**
  (hodin/týden, počet otevíracích dnů v týdnu i v roce, a jestli je pobočka
  víkendová — bere se z rozpisu po dnech, kde je vidět, které dny jsou zavřené),
  a hlavní ukazatel **denní návštěvy na bankéře**:

  ```
  denní návštěvy na bankéře = (návštěvy celkem ÷ dnů s návštěvami v datech) ÷ FTE bankéřů z kalkulace
  ```

  Bankéři se berou **ze zadaných FTE v kalkulaci** — všechny pozice s „bankéř“
  (mimo „podpora …“). Vede se zvlášť varianta jen za obchodní bankéře (bez BKP)
  a pro srovnání i přepočet na stav bankéřů OB uvedený v reportu; tabulka pod
  kartami ukazuje, které pozice se do součtu vzaly. V rozbalovacím detailu je
  otevírací doba po dnech (dopoledne / odpoledne / celkem, zavřené dny) a
  návštěvnost po dnech týdne — u každého dne se průměr na den počítá z počtu
  dnů, které jsou pro daný den v datech reportu (u víkendu je jich méně), plus
  přepočet na bankéře.
- **Monte Carlo model průměrného dne** (rozbalovací) — pravděpodobné hodiny
  přetížení za den, pokrytí poptávky, počet bankéřů OB pro 95% pokrytí,
  špičková P95 poptávka a kapacita (denní i hodinová) a **stejné dva grafy jako
  v PDF**: *P95 FTE poptávka po hodinách (6h–21h)* s kapacitou vykreslenou
  přerušovanou čárou a *Distribuce celkové denní FTE poptávky* (histogram
  simulovaných dnů, šedá čára = kapacita, zelená = P95 poptávky, zvlášť pro OB
  tým a servisní zónu). Přesná čísla po hodinách zůstávají v tabulce schované
  pod grafy.

### Co jde do PDF

Obsah PDF se řídí boxem **„Výstup a sestava“** (viz níže) — skupina
*Návštěvnost a doporučení prostor* má tři volby:

- **Doporučení prostor a srovnání s kalkulací** — tabulka všech tří variant
  (reálná data, Monte Carlo a), Monte Carlo b) +20 %) se zvýrazněnou variantou,
  se kterou pracuje zbytek sestavy, a srovnávací tabulka s kalkulací.
- **Grafy Monte Carla** — souhrnné hodnoty a místo hodinové tabulky **dva grafy**:
  *P95 FTE poptávka po hodinách (6h–21h)* (křivka poptávky OB a servisní zóny
  proti kapacitě vykreslené přerušovanou čárou) a *Distribuce celkové denní FTE
  poptávky (bankéř-hodiny/den)* (histogram simulovaných dnů se šedou čárou
  kapacity a zelenou čárou P95 poptávky, zvlášť pro OB tým a servisní zónu).
- **Otevírací doba pobočky a denní návštěvy na bankéře** — ve výchozím stavu
  vypnuté, po zapnutí se do PDF přidá souhrn otevírací doby, přepočty na
  bankéře a tabulka po dnech týdne.

**Detail návštěv po hodinách** zůstává jen v aplikaci, do PDF se netiskne nikdy.

Doporučené zasedací místnosti a servisní místa se přidávají i do tabulky
ukazatelů při kopírování výsledku do schránky.

### Snapshot ke kalkulaci

Při spočítání kalkulace se data návštěvnosti dané pobočky uloží jako snapshot
ke kalkulaci (tabulka `calculation_visitor`), aby kalkulace zůstala zpětně
reprodukovatelná i po importu novějšího reportu. U starších kalkulací (bez
snapshotu) se zobrazí aktuálně naimportovaná data pobočky — v hlavičce sekce
je vždy uvedeno, o který z obou případů jde.

Pobočka se v reportu hledá podle **ID pobočky**, jako záloha podle názvu.
Pokud report danou pobočku neobsahuje (nebo ještě není naimportovaný žádný),
sekce jen upozorní, že doporučení prostor chybí, a kalkulace proběhne beze
změny.

## Výstup a sestava (všechno generování na jednom místě)

**Poslední blok kalkulace** (a stejně tak detailu v historii) se jmenuje
**„Výstup a sestava“** a je v něm pohromadě všechno, čím se z kalkulace něco
dostane „venku“ — nikde jinde v aplikaci už žádné exportní tlačítko není:

| Prvek | K čemu je |
| --- | --- |
| **Rozsah PDF** (4 přepínače) | co se má vygenerovat — viz tabulka níže |
| **Zaškrtávátka po skupinách** | jednotlivé kapitoly v rámci zvoleného rozsahu |
| **Poznámka do PDF** | volný text, který se vytiskne na konec sestavy |
| **„Vygenerovat PDF“** | vytvoří PDF podle zvoleného rozsahu a zaškrtávátek |
| **„📋 Kopírovat kalkulaci“** | výsledek do schránky (Teams, Word, Excel) |
| **„📋 Kopírovat nábytek po segmentech“** | přehled nábytku z layoutu do schránky |
| **„Potvrdit / uzavřít kalkulaci“** | přepnutí stavu + štítek se stavem |

Rozsahy PDF:

| Rozsah | Které kapitoly | Název souboru |
| --- | --- | --- |
| **Celá sestava** | 1 + 2 + 3 | `sestava_<calculation_key>.pdf` |
| **Jen kalkulace** | 1 — Kalkulace FTE → WPL | `kalkulace_<…>.pdf` |
| **Jen kapacita pobočky** | 2 — Kapacita pobočky | `navstevnost_<…>.pdf` |
| **Jen layout pobočky** | 3 — Layout pobočky | `layout_<…>.pdf` |

Rozsah, pro který nejsou data (návštěvnost bez naimportovaného reportu, layout
bez uložení), je nedostupný a nelze ho zvolit. Skupiny zaškrtávátek, které do
zvoleného rozsahu nepatří, se při exportu ignorují — není tedy potřeba nic
odškrtávat. Nastavení i poznámku si aplikace pamatuje, takže zůstanou i po
překreslení výsledku nebo po uložení layoutu.

**Bloky v aplikaci jdou ve stejném pořadí jako body levé timeline:** kalkulace
a výsledek → ukazatele a analýzy → sestavení layoutu → kapacitní shrnutí →
výstup a sestava.

PDF má **tři kapitoly**, každá začíná na nové stránce **barevným pruhem** s číslem a názvem;
sekce uvnitř kapitoly mají praporek v barvě kapitoly. Zaškrtávátka v boxu jsou seskupená po
kapitolách a **očíslovaná v tom pořadí, v jakém se části tisknou** — box tak zároveň slouží jako
obsah budoucího PDF. Vypnutí kterékoli části pořadí ostatních nezmění.

| # | Kapitola (barva) | Části v pořadí |
| --- | --- | --- |
| 1 | **Kalkulace FTE → WPL** (modrá) | šedý blok s detaily · informace o referenčních datech · přehled pozic z checklistu · souhrnná tabulka (WPL po zónách) · klíčové ukazatele a benchmark · upozornění z výpočtu |
| 2 | **Kapacita pobočky** (zelená) | roční kapacita · návštěvnost a doporučení prostor (+ srovnání s kalkulací) · otevírací doba a návštěvy na bankéře · Monte Carlo model průměrného dne · distribuce celkové denní FTE poptávky · kapacitní shrnutí · tři kontroly míst pro schůzky |
| 3 | **Layout pobočky** (fialová) | šedý blok s detaily · kompletní přehled WPL po zónách a segmentech · seznam nábytku po zónách (kompaktní výpis) · analýza segmentů, zón a jejich prvků |

Výchozí stav: zapnuto je všechno kromě „Otevírací doba a návštěvy na bankéře“. Části, které vycházejí
z reportu návštěvnosti, jsou bez naimportovaných dat nedostupné (zbytek kapitoly 2 se tiskne dál).
Poznámka uživatele se tiskne na konci celé sestavy.

Seznam nábytku v kapitole 3 je **kompaktní** — každý segment je jeden zalomený odstavec s prvky
oddělenými „·“ (`MMMA: Theke - nízká 2 ks (2.0 WPL) · Lenka 1 ks (1.0 WPL) · …`), takže se výpis
vejde na několik řádků místo několika stránek.

## Roční kapacita — kolik času je a co ho spotřebuje

Pod klíčovými ukazateli (a v PDF hned za nimi) je barevný pruhový přehled, ze
kterého je na první pohled vidět hrubá kapacita pobočky. Všechno je přepočítané
na **bankéř-hodiny za rok** a všechny tři pruhy mají stejné měřítko
(100 % = otevírací doba × počet bankéřů):

1. **Otevřeno × bankéři** — `otevírací dny v roce × hodin denně × FTE bankéřů`.
   Otevírací doba se bere z reportu návštěvnosti (zná i víkendové pobočky),
   jinak z otevírací doby zadané v kalkulaci (÷ 5 dnů).
2. **Fakticky přítomni** — kolik z toho zbude po odečtení nepřítomnosti
   a homeoffice. Procento se bere ze **stejné verze referenčních dat**, se
   kterou kalkulace vznikla, vážené podle FTE bankéřů v jednotlivých segmentech.
   Zbytek pruhu je šedá „nepřítomnost“.
3. **Spotřebují klienti** — kolik z přítomného času padne na obsluhu podle
   **reálných návštěv z reportu**: schůzky × 60 min (45 + 15 min příprava)
   + návštěvy bez objednání × 15 min. Zbytek pruhu je volná kapacita na porady,
   školení a administrativu.

Pod pruhy je jednou větou verdikt (např. *„Obsluha klientů spotřebuje 66.7 %
času, který jsou bankéři na pobočce — zbývá 4 410 h na porady, školení
a administrativu.“*), barevně odlišený podle toho, jestli je rezerva dostatečná
(zeleně), malá (oranžově), nebo kapacita nestačí (červeně).

Bez naimportovaného reportu se vykreslí první dva pruhy a u třetího je uvedeno,
že bez reportu ho spočítat nelze. Do PDF jde volbou „Roční kapacita — otevírací
doba, přítomnost, návštěvy“.

## Kapacitní shrnutí

Tabulky s P95, λ a Monte Carlem jsou přesné, ale ne každý je čte rád. Nad
layoutem (v aplikaci) a na začátku PDF kalkulace je proto **srozumitelné
shrnutí**, které stejná data řekne běžnou řečí a hlavně odpoví na otázku
„stačí to, co jsem přiřadil?“:

1. **Verdikt** jednou větou v barevném pruhu — *Layout na špičku stačí* /
   *zvládne to jen těsně* / *ve špičce to nevyjde: chybí 3× místo na schůzku…*
2. **Graf „Kapacita proti špičce — jedním pohledem“** — jeden pruhový řádek pro
   každý druh místa i pro bankéře. Všechny řádky mají **stejné měřítko: 100 % =
   potřeba na silný den**, takže svislá plná čára je u všech na stejném místě
   a stačí se podívat, jestli za ni barevný pruh (kapacita) dosáhne:

   | Pruh | Význam |
   | --- | --- |
   | zelený, přes plnou čáru | kapacita stačí i na silný den |
   | oranžový, mezi tečkovanou a plnou čarou | běžný den v pohodě, silný den těsný |
   | červený, před tečkovanou čarou | nestačí ani běžná špička |

   Tečkovaná čára je potřeba v běžné špičce, plná potřeba v silný den (jeden den
   z dvaceti), vpravo je vždy „kolik je / kolik je potřeba“ a pokrytí v %.
   U bankéřů je pruh počet lidí reálně na place (FTE mínus dovolené, nemoci
   a homeoffice) a čáry jsou špičková poptávka z Monte Carla.
3. **Vysvětlení špičky** bez zkratek — která hodina je nejrušnější, kolik v ní
   průměrně přijde klientů, s kolika se počítá v silný den („zhruba jeden den
   z dvaceti“), kolik z nich jde bez objednání a kolik na sjednanou schůzku,
   a jak z toho vychází počet židlí a fast tracků.
4. **Tabulka potřeba vs. layout** pro každý druh prvku: kolik je potřeba ve
   špičce (a jestli to číslo přišlo z kalkulace FTE, nebo z návštěvnosti —
   platí vyšší z obou), kolik je v layoutu a verdikt „stačí / těsné / chybí N“.
   Do kapacity **servisních míst se počítají i fast tracky** — obsluhují klienty
   na hale stejně jako Lenka a Theke. U řádku je vidět rozpad
   (*přepážky 6 + fast tracky 2*) a fast tracky mají zároveň vlastní řádek
   s vlastní potřebou na rychlé bezhotovostní operace.
5. **A vyjdou na to lidé?** — špičková potřeba bankéřů z Monte Carla proti tomu,
   kolik jich je v kalkulaci reálně na place (zadané FTE mínus dovolené, nemoci
   a homeoffice).
6. **Tři kontroly míst pro schůzky (meeting zone)** — tři nezávislé pohledy na
   stejnou otázku, každý ve vlastním barevně odlišeném boxu. Schůzka se počítá
   jako 45 min + 15 min příprava (60 min na jedno místo) a dělí se otevírací
   dobou pobočky za den (z reportu, jinak z otevírací doby v kalkulaci):

   | Kontrola | Předpoklad | Potřeba míst |
   | --- | --- | --- |
   | 1 — kapacita bankéřů | každý bankéř z kalkulace odbaví 5 schůzek denně | `bankéři × 5 × 60 min ÷ otevřeno` |
   | 2 — klientský model | každý klient pobočky přijde 1× ročně na schůzku | `klienti ÷ otevírací dny × 60 min ÷ otevřeno` |
   | 3 — reálné návštěvy | skutečné schůzky z reportu návštěvnosti | `schůzky/den × 60 min ÷ otevřeno` (+ potřeba ve špičce) |

   Proti potřebě stojí počet míst v layoutu (nebo WPL meeting zone z kalkulace,
   pokud layout ještě není sestavený) a každá kontrola má vlastní verdikt.
7. **Co s tím** — seznam konkrétních kroků („Místa na sjednanou schůzku:
   doplnit 3“).

V aplikaci se shrnutí **přepočítává rovnou při zadávání počtů kusů** do
layoutu, takže je hned vidět, jestli zadané množství stačí. Do PDF jde volbou
„Kapacitní shrnutí“ a tiskne se hned za hlavičku kalkulace;
layout k němu se dohledá v databázi, takže funguje i v samostatném PDF
kalkulace.

## Špička na bankovní hale (židle v čekací zóně a fast tracky)

Doporučený počet židlí v čekací zóně a fast tracků se počítá **ze skutečné
špičky na hale**, ne poměrem z WPL. Vychází z reportu návštěvnosti:

1. Vezme se **nejrušnější hodina dne** (průměrné příchody λ) — zvlášť všechny
   návštěvy a zvlášť ty bez objednání (walk-in).
2. Přidá se **rezerva na silný den**: `P95 = λ + 1.645·√λ` — den, jaký přijde
   zhruba 1× za 20 otevíracích dní.
3. Přes Littleho pravidlo (*počet lidí v místě = příchody za hodinu × doba
   strávená v místě ÷ 60*) se dopočítá:

   ```
   židle       = ⌈P95 všech příchodů × 1.2 (doprovod) × 10 min čekání ÷ 60⌉   (min. 2)
   fast tracky = ⌈P95 příchodů bez objednání × 0.5 × 10 min obsluhy ÷ 60⌉     (min. 1)
   ```

Konstanty (rezerva, doba čekání, faktor doprovodu, podíl klientů na fast track
a doba obsluhy) jsou pohromadě v `PEAK_MODEL` v `app.js`, aby šly upravit podle
zkušeností z provozu. U klíčových ukazatelů je vždy uvedeno, z čeho číslo
vzniklo (např. *špička 21 klientů za hodinu × 10 min čekání × doprovod 1.2*).

Pokud pro pobočku není naimportovaný report návštěvnosti, použije se původní
odhad z WPL (15 % pro fast tracky a 50 % pro židle ze součtu service + meeting
zóny) a je to u ukazatele napsané.

Obě čísla zároveň vstupují do [pravidel pro předvyplnění layoutu](#automatické-předvyplnění-podle-pravidel),
takže se špičkou počítá i návrh layoutu.

## Kontrolní varianta bez uplatnění nepřítomnosti

Pod klíčovými ukazateli je **rozbalovací (výchozím stavem zavřená)** sekce
**„Kontrolní varianta bez uplatnění nepřítomnosti“**. Je to stejný výpočet jako
kalkulace, jen s koeficientem 1 místo `(1 − nepřítomnost − homeoffice)` — tedy
kolik WPL by vyšlo, kdyby byli všichni vždy na pobočce. Ukazuje WPL po zónách
a segmentech, celkový WPL a rozdíl proti kalkulaci (absolutně i v procentech).

Časové dotace se pro variantu berou ze **stejné verze referenčních dat**, se
kterou kalkulace vznikla, aby odpovídala právě jí.

Varianta je jen informativní: **neukládá se do databáze a nikam se netiskne** —
nedostane se do PDF kalkulace, do spojené sestavy ani do schránky. Závazný je
vždy výsledek kalkulace.

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
| Service zone | Čekací zóna (obývák) | medium, flagship | **jeden obývák = 3 židle**, takže celé trojice z doporučeného počtu židlí (5 židlí → 1 obývák) |
| Service zone | Čekací zóna (židle) | všechny | doporučený počet židlí; tam, kde je i obývák, **jen zbytek do trojice** (5 židlí → 1 obývák + 2 židle) |
| Service zone | Pokladní ostrov typu C (1:1,TT+TT,1WPL) | všechny | **1 ks, je-li na pobočce pokladník** (pozice „bankéř klientské péče - junior“) |
| Service zone | Lenka vítací (vítací pracoviště) | small, medium economy | vždy **právě 1 ks** |
| Service zone | Theke - nízká (vítací pracoviště) | medium | vždy **právě 1 ks** |
| Service zone | Theke - vysoká (vítací pracoviště) | flagship | vždy **právě 1 ks** |
| Service zone | Lenka | všechny | zbytek potřeby WPL nad vítací pracoviště, zaokrouhlený nahoru (3,4 → 3 ks) |
| Backoffice zone | Interní zasedací místnost - malá | medium economy | 1 ks |
| Backoffice zone | Interní zasedací místnost - velká | medium, flagship | 1 ks |
| Meeting zone | Jednací místnost | všechny | celá potřeba WPL (5 → 5 ks) |
| Backoffice zone | Kancelářské místo | všechny | potřeba WPL **snížená o přesun na fast track** a zaokrouhlená dolů |
| Backoffice zone | Fast track backoffice | všechny | ⌈přesunutá část potřeby⌉ + 1 ks, je-li desetinná část zbylé potřeby > 0,5 |
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
- **Přesun backoffice času na fast track:** část backoffice času vybraných pozic se odsedí na fast
  tracku, ne na vlastním kancelářském místě — **osobní bankéř - medior 20 %**, **osobní bankéř -
  senior 10 %**. Tato část potřeby WPL se odečte od „Kancelářské místo“ a přiřadí se jako fast
  tracky (zaokrouhleno nahoru). Fast track se nevykazuje jako WPL, takže se šetří plocha i náklady.
  Příklad: potřeba backoffice 2,10 WPL, z toho 0,31 WPL na fast track → dřív 2 kancelářská místa
  + 0 fast tracků, nově **1 kancelářské místo + 2 fast tracky**. Přesun se počítá ze stejných
  vstupů jako kalkulace (FTE × doba vytížení × koeficient přítomnosti × dotace backoffice %),
  takže u segmentu bez těchto pozic (např. PROVOZ) je nulový a pravidlo se chová jako dřív.
- Segmenty **SBC a HC** mají v Meeting zone prvek **„Jednací místnost“** (1 WPL/kus) — dříve
  chyběl, takže se u nich místo počtu kusů psalo jen „pro tento segment a zónu nejsou v databázi
  definované žádné nábytkové prvky“. Teď se počet doporučí z kalkulace stejně jako u ostatních
  segmentů (potřeba 0,6 WPL → 1 ks). Do už existujících databází se prvek doplní automaticky při
  jejich připojení.
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

*(jen v aplikaci — do PDF se místo něj tiskne analýza segmentů, zón a prvků)*

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

### Export layoutu do PDF

Layout nemá vlastní exportní tlačítko — vytiskne se z boxu **„Výstup a sestava“**
na konci kalkulace, buď samostatně (rozsah „Jen sestavení layoutu“), nebo jako
součást celé sestavy společně s kalkulací a návštěvností. Podrobně viz
„Výstup a sestava“ výše.

## Barevné schéma a ikony segmentů

Každý segment (MMMA, SBC, HC, EPC, EPB, PROVOZ, RKC, CESTOVNÍ, CESTOVNÍ POZICE, OSTATNÍ) má
přiřazenou barvu a ikonu — používají se jednotně v tabulce výsledků a v sestavení layoutu i v PDF
exportech (barevný čtvereček před názvem segmentu; ikony jako emoji se v PDF nevykreslují, protože
je vložený font DejaVu Sans neobsahuje). Barvy, ikony i pořadí segmentů lze upravit v novém modulu
„Struktura checklistu“ (viz níže).

## Stav kalkulace: rozpracovaná / potvrzená

Každá spočítaná kalkulace má stav — nově vytvořená je vždy **„Rozpracovaná“**. Tlačítko
**„Potvrdit / uzavřít kalkulaci“** je **na samém konci**, v boxu „Výstup a sestava“ (v aplikaci
i v detailu v historii) — tedy až za nastavením generování, jako poslední krok. Stejným tlačítkem
lze kalkulaci vrátit zpět do rozpracované.

Stav se zobrazuje jako štítek u výsledku, v boxu „Výstup a sestava“, v detailu kalkulace i v přehledu
kalkulací dané pobočky v historii — a **potvrzené kalkulace mají v historii navíc zelený svislý
proužek** vlevo u položky, takže jsou v seznamu vidět na první pohled.

## Kdo dělá co: role podle názvů pozic

Všechna čísla „na bankéře“ (schůzky, servisní operace, pokladna) se počítají
podle **konkrétních názvů pozic z checklistu**, ne podle segmentu:

| Role | Pozice | Kde se používá |
| --- | --- | --- |
| **Schůzky (osobní bankéři)** | `osobní bankéř - junior`, `osobní bankéř - medior`, `osobní bankéř - senior`, `osobní bankéř - master` | denní návštěvy a schůzky na bankéře, tři kontroly kapacity jednaček, řádek „bankéři na schůzky“ v kapacitním shrnutí |
| **Servisní operace** | hlavně `bankéř klientské péče - medior`, dále `osobní bankéř - junior` | obsluha na hale (Lenka / Theke), servisní místa a fast tracky |
| **Pokladna** | `bankéř klientské péče - junior` | jen tam, kde je pokladna a pobočka **není** cashless |

`osobní bankéř - junior` se tak objevuje ve dvou rolích (schůzky i servis), ale
do celkového počtu lidí na hale se počítá **jen jednou**. Pozice, které nejsou
v tabulce (například `pobočkový specialista - provoz`), se do výpočtů na bankéře
nepočítají vůbec.

## Struktura checklistu (segmenty, pozice, nábytek, Excel šablona)

Nová záložka **„Struktura checklistu“** v horní liště slouží ke správě dat, ze kterých vychází
Excel checklist i celá kalkulace:

- **Segmenty** — pořadí, barva a ikona (viz výše).
- **Pozice** — stejná data a stejný editor jako v „Referenčních datech“ (tabulka `casove_dotace`);
  nová/upravená pozice se okamžitě promítne i tam a naopak.
- **Nábytek** — nábytkové prvky pro sestavení layoutu po segmentech a zónách (tabulka
  `furniture_to_zone`), přímo editovatelné. Prvky se **verzují** jako ostatní referenční data
  (sloupec „Verze“, viz „Historie referenčních dat“), jdou **filtrovat** textem i podle zóny
  a zobrazené (vyfiltrované) prvky lze tlačítkem **„📋 Kopírovat zobrazené prvky“** vzít
  do schránky jako tabulku.

Všechny tři tabulky mají nad sebou vyhledávací pole — viz „Vyhledávání a filtrování v tabulkách“.

#### Nastavení Excel šablony

Panel **„Nastavení Excel šablony“** (ukládá se do tabulky `app_settings`) řídí vzhled i chování
generovaného souboru. Součástí je **živý náhled barev**, který ukazuje, jak budou vypadat hlavní
prvky listu CHL.

| Skupina | Nastavení |
| --- | --- |
| **Barvy šablony** | titulek a boční popisky, hlavičky sekcí, popisek segmentu, součtové buňky, popisek zóny, vyplňované buňky v hlavičce, písmo vyplňovaných buněk, písmo na tmavém podbarvení |
| **Chování šablony** | barvit segmenty podle tabulky Segmenty, písmo šablony, počet volných řádků pro cestovní pozice, počet řádků pro doplňující informace, předvyplněná otevírací doba, šířka sloupců G a H, skrýt listy VSTUPY a Pobočky, sbalit sloupec K s poznámkami, ukotvit hlavičku CHL, **zamknout list** a nepovinné **heslo pro odemčení** |

Tlačítko **„Vrátit výchozí“** vrátí všechny hodnoty na původní podobu vzorového checklistu.

#### Barvy segmentů v PDF a v Excel šabloně

Barvy zadané v tabulce **Segmenty** se propisují do všech výstupů:

- v **Excel šabloně** dostane popisek segmentu (v obsazenosti pobočky i u nábytku) přímo barvu
  svého segmentu — písmo se automaticky přepne na bílé, pokud je barva tmavá. Vypnout to lze
  volbou „Barvit segmenty podle tabulky Segmenty“ (pak platí jednotná barva „Popisek segmentu“),
- v **PDF exportech** má buňka se segmentem světlý odstín své barvy (souhrnná tabulka WPL po
  zónách, kompletní přehled WPL, analýza segmentů a zón, přehled pozic z checklistu) — vedle
  dosavadního barevného čtverečku u názvu segmentu.

Tlačítkem **„Generovat Excel šablonu“** se z aktuálního obsahu těchto tří tabulek vygeneruje
`.xlsx`, který **vypadá i funguje stejně jako vzorový checklist**. Soubor se jmenuje
**`checklist_sablona_refdata-v<číslo verze>.xlsx`** — číslo je verze referenčních dat, ze kterých
byla šablona vygenerována, takže je z názvu hned poznat, jaký obsah (pozice, nábytek, absence)
v ní je. Stejná informace je i v patičce listu CHL v řádku „Vygenerováno:“ (datum, čas a verze).

Šablona má tři listy, ale **vidět je jen `CHL`** — `VSTUPY` i pomocný list `Pobočky` jsou skryté,
aby pobočku nepletly. Skrytí nijak neovlivňuje vzorce, rozbalovací menu ani zpětné načtení souboru
do aplikace; případné odkrytí je v Excelu na pravé tlačítko na oušku listu.

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
    vybavení, náhradní provoz), blok doplňujících informací a řádky Load key / Calculation key /
    Vygenerováno (datum + verze referenčních dat),
  - sloupec **`K` s rozšířenými poznámkami je seskupený a defaultně sbalený (skrytý)** —
    rozbalí se tlačítkem `+` nad sloupcem `J`, kde je i svislý popisek „ROZŠÍŘENÉ POZNÁMKY ▼“.

Patička listu CHL navíc vypisuje, **z jakých referenčních dat šablona vznikla** — kromě řádku
„Vygenerováno:“ (datum, čas, verze) jsou tam dva samostatné řádky:

| Řádek | Obsah |
| --- | --- |
| `Referenční data — pozice:` | verze při generování, počet pozic v šabloně a verze, ve které se pozice naposledy měnily |
| `Referenční data — nábytek:` | totéž pro nábytkové prvky |

Díky tomu je u každého vyplněného checklistu zpětně vidět, jaký seznam pozic a nábytku obsahuje —
i když se referenční data od té doby změnila.
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
tyrkysová čísla u hodin, sloučené buňky, šířky sloupců i výšky řádků. Navíc oproti vzoru:

- **na tmavém podbarvení je písmo bílé** (modrý titulkový řádek 1 i tmavě modré hlavičky sekcí),
  aby byl text čitelný; na světlých a tyrkysových výplních zůstává tmavé,
- **vyplňované buňky mají světle šedé podbarvení** — v hlavičce sloučené `C:D` a sloupec `I`
  (řádky 3–8) a dál všechna pole ve sloupcích `G` a `H`, do kterých se zadávají hodnoty
  (POČET FTE AKTUÁLNĚ / VÝHLED, počty kusů, WPL). Záhlaví sekcí a součtové řádky si ponechávají
  svou barvu, poznámkový sloupec `I` zůstává bílý,
- **sloupce `G` a `H` jsou širší** (19,86), aby se do nich vešly popisky „POČET FTE AKTUÁLNĚ“
  a „POČET FTE VÝHLED“. Vendorovaná knihovna SheetJS
(komunitní edice) umí formátování buněk sice přečíst, ale při zápisu (`XLSX.write`) ho vždy zahazuje
(ověřeno přímým testem) — proto se šablona nesestavuje přes SheetJS, ale přes vlastní minimalistický
zapisovač `.xlsx` (`xlsx_writer.js`), který .xlsx (ZIP + OOXML XML) sestaví přímo. Shoda se vzorem je
ověřená porovnáním obou souborů knihovnou `openpyxl` (výplně, fonty, ohraničení po stranách,
zarovnání, sloučené buňky, šířky sloupců, výšky řádků) i zpětným načtením vyplněné šablony do
aplikace.

#### Zámek listu — ochrana proti rozbití šablony

Volbou **„Zamknout list — editovat jen vyplňovaná pole“** (výchozí stav: zapnuto) se všechny tři
listy zamknou a **odemčené zůstanou jen buňky k zadávání**:

| Odemčeno (lze vyplnit) | Zamčeno (nelze změnit) |
| --- | --- |
| hlavička `C:D` (název, datum, formát, typ akce, režim) a velká pole `I` (otevírací doba, vytěžení) | titulek, hlavičky sekcí, popisky segmentů a zón |
| sloupce `G` a `H` — počty FTE, kusů a WPL | názvy pozic a nábytkových prvků |
| sloupec `I` s poznámkami a celý sloupec `K` (rozšířené poznámky) | součtové řádky a všechny vzorce (Suma FTE, SUMMARY, WPL celkem) |
| volné řádky bloku CESTOVNÍ POZICE (`B:F`) | patička s verzemi referenčních dat |
| Load key, Calculation key a odkaz na sharepoint v patičce | listy VSTUPY a Pobočky (celé) |

Formátování sloupců zůstává povolené, takže **sbalený sloupec `K` jde i v zamčeném listu rozbalit**.
Do pole **„Heslo pro odemčení listu“** lze zadat heslo (nepovinné) — bez něj stačí v Excelu
Revize → Odemknout list. Nejde o bezpečnostní prvek, ale o zábranu proti nechtěné úpravě; zamčenou
šablonu lze po vyplnění beze změny načíst zpět do aplikace (ověřeno testem).

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
- HTML report návštěvnosti se parsuje bez knihovny: v textu se najde deklarace
  `const DATA = {` (resp. `const C = {`), objektový literál se odřízne párováním
  složených závorek s ohledem na řetězce a předá `JSON.parse`. Data se ukládají
  do tabulek `visitor_data` (per pobočka) a `calculation_visitor` (snapshot ke
  kalkulaci).
- Generovaná Excel šablona (záložka „Struktura checklistu“) se naopak zapisuje
  vlastním minimalistickým zapisovačem `.xlsx` (`xlsx_writer.js`) — vendorovaná
  SheetJS (komunitní edice) při zápisu zahazuje veškeré formátování buněk, což
  by pro šablonu, která má vypadat jako vzorový checklist, nešlo použít.
- PDF export přes [jsPDF](https://github.com/parallax/jsPDF) s vloženým
  fontem DejaVu Sans (`vendor/dejavu-fonts.js`), aby se správně zobrazovala
  česká diakritika. Grafy Monte Carla v PDF se kreslí přímo z čar a obdélníků
  (jsPDF grafy neumí) podle stejných dat a stejného vzhledu jako SVG grafy
  v HTML reportu.
