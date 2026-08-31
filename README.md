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
xlsx_writer.js              – vlastní zapisovač .xlsx s formátováním (viz "Data a Excel šablona")
fte_wpl_calculator.db       – vzorová SQLite databáze s výchozími referenčními daty
data/export_specialiste.xlsx – obsazenost pozic po pobočkách (viz „Dodatečná analytika“)
vendor/                     – vendorované knihovny (sql.js, SheetJS, jsPDF, DejaVu font, Fabric.js)
tools/gen_seed_db.py        – skript, kterým byla vygenerována fte_wpl_calculator.db
```

Volitelně se sem dají přidat další datové soubory, které si aplikace najde sama
(záložka **„Dodatečná analytika“**):

```
report_navstevnost.html     – HTML report návštěvnosti
pobocky-export.xlsx         – rating, výnosy a prodeje poboček
top_3_related_branches15.csv – spádové pobočky (odkud přijdou klienti)
```

Soubory se hledají ve složce s aplikací i v podsložkách `data`, `zdroje`
a `sources`.

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

## Načtení obsazenosti pobočky z exportu specialistů

V manuálním zadání je blok **„Načíst pozice z exportu specialistů“**, který
předvyplní pozice a jejich počty pro vybranou pobočku ze souboru
**`data/export_specialiste.xlsx`** (dodává se ve složce s aplikací):

- první řádek je hlavička: ve sloupci `A` je `branch_id` (kód pobočky), ve `B`
  název pobočky, další sloupce jsou **názvy pozic** a v řádcích jsou jejich počty,
- tlačítkem **„Nahrát export_specialiste.xlsx“** se soubor jednou naimportuje do
  databáze (tabulka `specialist_export`, 327 poboček) — pak už stačí u každé
  další pobočky jediné kliknutí na **„⤓ Načíst pozice z exportu specialistů“**;
  export se dá připojit i na záložce **„Dodatečná analytika“** a ve složce
  s aplikací si ho aplikace najde sama,
- pobočka se hledá podle **ID**, a když ID nesedí, podle názvu,
- pozice se zařadí do segmentu podle referenčních dat (`casove_dotace`); protože
  je každá pozice vedená i pod segmentem CESTOVNÍ, bere se vždy **domovský
  segment** (ten, který CESTOVNÍ není),
- sloupce s pozicemi, které v referenčních datech nejsou, se vypíšou jako
  nerozpoznané a přeskočí se (v dodaném exportu jsou 3),
- předvyplněné hodnoty jde před spočítáním libovolně upravit.

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

## Pobočka se směnovým režimem (otevírací doba > doba vytížení)

V obchodních centrech je otevřeno i sedm dní v týdnu, typicky ~70 hodin, ale
jedna pozice odpracuje 40 hodin. Zaměstnanci se tedy **střídají na směny** a na
pobočce nejsou všichni naráz — na jedno pracovní místo obsazené po celou
otevírací dobu je pak potřeba více FTE.

Kalkulace to zvládá už svým vzorcem, protože se dělí otevírací dobou:

```
WPL = FTE × doba vytížení × (1 − nepřítomnost − homeoffice) × dotace zóny % ÷ otevírací doba
```

Při 6 FTE, době vytížení 40 h a nepřítomnosti 23,6 % vyjde ve service zone při
otevírací době **70 h** hodnota **2,5 WPL**, zatímco při otevírací době 40 h by to
bylo **4,4 WPL** — směnový provoz tedy sám o sobě znamená **méně pracovních míst
na stejný počet lidí**.

Aplikace tuto situaci navíc **pojmenuje**, aby nevypadala jako chyba zadání:

- **Zaškrtávátko „Pobočka se směnovým režimem“** je v manuálním zadání i u načteného
  checklistu (příznak se ukládá k nahrávce, sloupec `excel_loads.shift_mode`).
  Zaškrtne se samo, když je otevírací doba o více než 2 hodiny vyšší než doba
  vytížení; kdykoli se dá přepnout ručně.
- **Excel šablona** nese příznak s sebou: na listu VSTUPY je v `F1` vzorec
  `IF(CHL!I3-CHL!I6>2;"ANO";"NE")` (s popiskem v `E1`), takže se vyplněný checklist
  načte do aplikace už se správně zaškrtnutým režimem. Starší šablony bez tohoto
  pole se poznají z rozdílu hodin.
- **Odznak „🔁 Směnový režim“** je u náhledu checklistu, u výsledku kalkulace
  i v detailu v historii; pod ním je řádek s tím, jakou část otevírací doby
  pokryje jedna pozice (`doba vytížení ÷ otevírací doba`) a kolik FTE je potřeba
  na plné pokrytí jednoho místa (`otevírací doba ÷ doba vytížení`).
- Není-li režim zaškrtnutý, ale hodiny na směny ukazují, je řádek **žlutý
  s upozorněním**; při shodných hodinách jen konstatuje, že jsou všichni na
  pobočce ve stejnou dobu.
- Do PDF (šedý blok kapitoly 1) se tiskne **doba vytížení WPL** a u směnového
  režimu i věta, jakou část otevírací doby jedna pozice pokryje a kolik FTE je
  potřeba na jedno místo. Nápověda „?“ u „Výsledku kalkulace“ to vysvětluje také.

## Data a Excel šablona (jedna záložka)

Záložka **„Data a Excel šablona“** spojuje dřívější „Referenční data“
a „Strukturu checklistu“. Nejdřív jsou v blocích **data uložená v databázi**,
teprve pod nimi export šablony, která z nich vychází:

1. **Segmenty** — pořadí, barva a ikona (`segments`),
2. **Pozice a jejich časové dotace** — rozdělení pracovní doby mezi service /
   meeting / backoffice zónu a kancelář v % (`casove_dotace`),
3. **Nábytek** — prvky po segmentech a zónách včetně WPL na kus (`furniture_to_zone`),
4. **Absence po segmentech** — % nepřítomnosti a homeoffice (`absence`),
5. **Historie referenčních dat** — verze všech tří sad (viz níže),
6. **Export Excel šablony checklistu** — nastavení vzhledu a chování + generování.

Úpravy se uloží tlačítkem „Uložit tabulku…“ přímo do databáze; tabulka pozic je
teď jen jedna (dřív byla ve dvou záložkách nad stejnými daty).

### Filtrování po sloupcích jako v Excelu

Každá tabulka s daty má v hlavičce u sloupců tlačítko **▽**, které otevře seznam
hodnot se zaškrtávátky — jako autofiltr v Excelu. Uvnitř sloupce se hodnoty
kombinují jako OR, filtry z různých sloupců jako AND (např. *Zóna = Meeting zone*
**a** *Segment = MMMA*). V popupu je hledání v hodnotách a tlačítka „Vybrat vše“ /
„Odebrat vše“; aktivní filtry se vypíšou pod tabulkou jako štítky s tlačítkem
„Zrušit filtry sloupců“. Vedle toho zůstává celotabulkové hledání textem.

Filtry jsou **jen zobrazovací** — uložení tabulky zapíše i řádky skryté filtrem.

### Přehled dat pro MS Teams

Tlačítko **„📋 Přehled dat (segmenty, pozice, nábytek)“** otevře popup s textovým
shrnutím celé databáze: každý segment, jeho absence, všechny jeho pozice
s časovými dotacemi a všechen nábytek po zónách včetně WPL na kus. Z popupu se dá
obsah zkopírovat dvěma způsoby:

- **📋 Kopírovat jako tabulku (MS Teams)** — formátovaná tabulka
  (segment / druh / název / detail), vložitelná do MS Teams, Wordu i Excelu,
- **📋 Kopírovat jako text** — čistý text se stejnou strukturou.

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

Nad každou editovatelnou tabulkou v záložce **„Data a Excel šablona“** je
vyhledávací pole (segmenty, pozice, nábytek, absence); u nábytku je navíc
**výběr zóny**, který se s hledaným textem kombinuje. Vedle toho má každý
sloupec **autofiltr hodnot jako v Excelu** — viz „Filtrování po sloupcích“ výše. Hledá se **po slovech** a nezávisle na velikosti písmen —
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

### Sloupec „Fast track %“ u pozice

V tabulce **Pozice a jejich časové dotace** je sloupec **„Fast track %“**:
kolik procent svého backoffice času daná pozice odsedí na **Fast tracku
backoffice** místo vlastního kancelářského místa.

- Hodnota je **nastavení u každé pozice** (a u každého segmentu zvlášť) —
  dřív byla zadrátovaná v kódu.
- Výchozí stav odpovídá dosavadnímu chování: `osobní bankéř - medior` **20 %**,
  `osobní bankéř - senior` **10 %**, ostatní pozice **0 %**. Do existujících
  databází se sloupec doplní automaticky při připojení (a výchozí hodnoty se
  nastaví jen tehdy, když v databázi ještě žádná nejsou — vynulované hodnoty se
  nepřepisují).
- Podíl vstupuje do **předvyplnění layoutu**: potřeba WPL se sníží u „Kancelářské
  místo“ a přesune na „Fast track backoffice“ (viz „Automatické předvyplnění
  podle pravidel“). Text pravidla v nápovědě „?“ se generuje z nastavení, takže
  vždy odpovídá tomu, co je v referenčních datech.
- Sloupec se **verzuje** společně s časovými dotacemi (je i ve snapshotu verze),
  takže kalkulace zůstává reprodukovatelná — starší kalkulace se dopočítají
  podílem z verze, se kterou vznikly.
- **Vizuální označení:** podbarvená je jen buňka, kde je nějaká hodnota (nula
  zůstává bílá), a řádek s nastaveným podílem má **na začátku červenou tečku** —
  pozice s fast trackem se tak dají najít i bez filtrování.
- Tabulka je **kompaktní** (menší písmo a odsazení, pevná šířka číselných polí),
  takže se vejde na šířku panelu a není potřeba s ní vodorovně posouvat.

### Nákres prvku přímo v tabulce nábytku

Tabulka **Nábytek** má první sloupec **„Nákres“** — malý obrázek toho, jak se
prvek kreslí ve schématu pobočky. Nákres se vygeneruje přímo v prohlížeči
(Fabric.js do skrytého canvasu) a cachuje se podle druhu symbolu, takže se každý
druh kreslí jen jednou. Pod tabulkou je rozbalovací blok **„Legenda nákresů“**
se všemi druhy pohromadě, včetně popisu, z čeho je symbol složený.

### Kopírování vyfiltrovaného nábytku do schránky

V záložce „Data a Excel šablona“ v části **Nábytek** je tlačítko
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
| **Absence po segmentech** | Data a Excel šablona → Absence | `absence_json` |
| **Časové dotace pozic** | Data a Excel šablona → Pozice | `dotace_json` |
| **Nábytkové prvky** (`furniture_to_zone`) | Data a Excel šablona → Nábytek | `furniture_json` |

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

## Dodatečná analytika (report návštěvnosti, export specialistů, export poboček)

Záložka **„Dodatečná analytika“** sdružuje všechna doplňková data, která umí
aplikace použít vedle vlastní kalkulace:

| Soubor | Co z něj aplikace bere | Kde se to projeví |
| --- | --- | --- |
| `report_navstevnost.html` | návštěvy po hodinách, doporučení prostor, Monte Carlo model | kapitola „Kapacita pobočky“ |
| `export_specialiste.xlsx` | aktuální obsazenost pozic po pobočkách | předvyplnění manuálního zadání, porovnání zadaných FTE se skutečností |
| `pobocky-export.xlsx` | rating pobočky 23–25 a jeho trend, výnosy a nové výnosy, prodeje po produktech, **strategie BNS** (keep / close, rok uzavření, dopočet dle IR 25, simulace 250 a 280) | hlavička titulní stránky PDF, karta pobočky v aplikaci, návrh spádových poboček ke zavření |
| `top_3_related_branches15.csv` | ke každé pobočce tři nejsouvisejícejší (spádové) pobočky — návštěvy, podíl, vzdálenost a odhadovaný přesun klientů, plus **souřadnice pobočky** (`branch_geom`) | našeptávání spádových poboček u checklistu (viz „Spádové pobočky“) |

Každý zdroj má na záložce **kartu se stavem** (připojeno / nepřipojeno, kolik
poboček, z jakého souboru a kdy se importoval) a tlačítko pro připojení souboru.

**Automatické připojení.** Soubory se hledají samy ve složce s aplikací
(a v podsložce `data`) — vždy při otevření záložky se doplní jen to, co
v databázi ještě není, takže se už načtená data nepřepisují. Jak se hledání
chová, závisí na tom, jak je aplikace otevřená:

- **přes http(s)** (např. z interního webu) se soubory načtou samy hned,
- **přes `file://`** (dvojklik na `index.html`) prohlížeč čtení okolních souborů
  z bezpečnostních důvodů zakazuje. Klikněte proto jednou na **„📁 Připojit
  složku s daty…“** a vyberte složku s aplikací — povolení si prohlížeč
  zapamatuje (handle složky v IndexedDB) a příště už aplikace soubory najde sama.
  Alternativa je připojit každý soubor tlačítkem na jeho kartě.

Tlačítko **„🔄 Najít soubory ve složce“** hledání spustí znovu a **přepíše**
i to, co už je naimportované (hodí se po výměně souborů za novější).

### Report návštěvnosti

Report má všechna čísla vložená přímo v sobě (objekt `const DATA` klíčovaný ID
pobočky a konstanty modelu `const C`), takže se načte celý v prohlížeči — nikam
se neodesílá.

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

### Export poboček (`pobocky-export.xlsx`)

Datový slovník o pobočkách — 50+ sloupců: zařazení a adresa (region, oblast,
město, obvod, ulice, č. popisné/orientační, RUIAN, ORP), **rating pobočky za roky
23–25** včetně trendu, kvintilu, změny 25/24 a příznaku „⚠️ Nebezpečná zóna“,
**výnosy 21–25** a **nové výnosy** s kvintilem a trendem a **prodeje po produktech**
(Účty, Hypotéky, Poj. život, Poj. neživot, Inv. pravid., Inv. jednor., Revol.
úvěry, Úvěry, Penze) — u každého počet prodejů a kvintil.

- Import (tabulka `branch_export`) si uloží **všechny sloupce beze změny**; co
  aplikace neumí zobrazit, zůstane dostupné v kartě pobočky v části „Všechny
  sloupce z exportu“.
- Sloupce se poznávají podle **normalizovaného názvu** (bez diakritiky
  a interpunkce), takže drobné odchylky v hlavičce (velká písmena, tečky, emoji
  u „Nebezpečné zóny“) import nerozhodí. První sloupec musí být `ID Pobočky`.
- Na záložce je **seznam poboček** s filtrem (ID, název, region, oblast, rating,
  výnosy, prodeje celkem); kliknutím na řádek se otevře **karta pobočky** —
  stejná data, jaká jdou do hlavičky PDF, plus výnosy po letech a tabulka prodejů.
- Pobočka se hledá podle **ID**, jako záloha podle názvu.
- Kvintily jsou barevné podle stupnice **1 = nejlepší pětina poboček … 5 = nejslabší**.

Karta pobočky se zobrazuje i **u výsledku kalkulace** a v detailu v historii, aby
bylo hned vidět, o jakou pobočku jde. Je označená štítkem „z exportu poboček“
(tmavě modrozelená barva zdroje dat). Pilulky na kartě i v hlavičce PDF jsou:
**Rating 25**, **Změna ratingu 25/24** (ze stejnojmenného sloupce, v závorce
procentní změna ze sloupce `Změna ratingu perc 25/24`), **Trend ratingu 23–25**
a **Nové výnosy kvintil**.

### Porovnání zadaných FTE se skutečným stavem

Kdekoli je vidět zadaný checklist, je pod ním rozbalovací blok **„Porovnání
zadaných FTE se skutečným stavem“** (žlutooranžový pruh = zdroj „z exportu
specialistů“):

- **v okně s načteným checklistem** (po nahrání Excelu i po manuálním zadání) je
  rozbalený, aby si uživatel rozdíl všiml ještě před spočítáním,
- **u výsledku kalkulace** a v detailu v historii je sbalený.

Tabulka má pro každou pozici *Zadáno (FTE)* / *Aktuální stav* / *Rozdíl*
(zeleně plus, červeně minus), řádky s rozdílem jsou podbarvené a nahoře je slovní
verdikt (souhlasí / kalkulace počítá s více nebo méně lidmi než je dnes na
pobočce). Pod tabulkou je počet pozic s rozdílem, počet pozic jen v kalkulaci
a jen v aktuálním stavu.

**Do PDF exportu se toto porovnání záměrně netiskne** — je to kontrola vstupu,
ne výstup sestavy.

## Spádové pobočky — klienti a zaměstnanci z jiných poboček

Pobočka může přebírat klienty (a s nimi i zaměstnance) z jiných poboček, typicky
když se některá zavírá nebo se slučuje síť. U **načteného checklistu** je proto
blok **„Spádové pobočky — přebírá tato pobočka klienty a zaměstnance odjinud?“**
(fialový pruh = zdroj „ze spádových poboček“).

### Odkud se berou návrhy

Ze souboru **`top_3_related_branches15.csv`** (viz „Dodatečná analytika“; hledá
se i ve složce `zdroje`). Jeden řádek = **jedna pobočka** a k ní její tři
nejsouvisejícejší („top“) pobočky:

| Sloupce | Význam |
| --- | --- |
| `branch_id`, `branch_nazev` | pobočka, pro kterou se kalkulace dělá |
| `branch_geom` | souřadnice pobočky — z nich se hledají **pobočky ke zavření v okolí** |
| `navstevnost_v_pobocce_celkem` | celková návštěvnost té pobočky (základ pro „o kolik víc“; u spádové pobočky mimo *top 3* i základ převzatých návštěv) |
| `home_zsj_visits(_pct)`, `home_district_visits(_pct)` | návštěvy z domovské ZSJ / okresu |
| `top_pobocka_id_1..3`, `top_pobocka_nazev_1..3` | spádová pobočka 1–3 |
| `top_pobocka_visits_1..3` | návštěvy té spádové pobočky |
| `top_pobocka_visits_1..3_pct` | jaký podíl návštěv to je |
| `top_pobocka_distance_km_1..3` | vzdálenost |
| `odhadovany_presun_pct_1..3` | **odhad, kolik % klientů přejde** na počítanou pobočku |

Pobočka z checklistu (nebo z manuálního zadání) se v souboru najde podle
**`branch_id`**, jako záloha podle **`branch_nazev`**, a nabídnou se její tři
spádové pobočky — řazené podle odhadu přesunu. **Odhad přesunu se dá u každé
přepsat**, převzaté návštěvy se hned přepočítají. Přidat lze i **jakoukoli další
pobočku z číselníku** (našeptávač nad tabulkou `pobocky`), i když ji soubor
neuvádí.

Soubor se čte jako CSV (oddělovač se pozná sám — `;`, `,` nebo tabulátor;
zvládne i BOM), stejně dobře ale projde i stejně pojmenovaný `.xlsx`. Hodnoty
jako `35 420`, `3,5`, `12.4` i prázdné buňky se přečtou správně; chybějící odhad
přesunu se doplní ručně. Pobočka, která v souboru nemá ani jednu *top* vazbu, se
uloží taky — kvůli souřadnicím, aby se dala najít jako blízká pobočka.

### Pobočky ke zavření (Strategie BNS)

Export poboček (`pobocky-export.xlsx`) nese kromě ratingu i to, co se má
s pobočkou stát. Pobočka označená jako `close` své klienty a zaměstnance někam
přesune — proto se **nabízí přednostně** ve spádových pobočkách:

| Sloupec | Význam |
| --- | --- |
| `Strategie BNS` | `keep` / `close` tak, jak to vyšlo **z workshopů** |
| `Rok uzavření` | rok, od kterého `close` platí |
| `Strategie BNS dle IR 25` | `keep` / `close` **dopočítané z interního ratingu** |
| `Simulace 250` | varianta sítě o 250 pobočkách |
| `Simulace 280` | varianta sítě o 280 pobočkách |

Hodnoty se čtou tolerantně — `CLOSE`, `Close 2027`, `zavřít` i `ponechat`
aplikace pochopí; co nerozpozná, vypíše, ale nebarví.

**Kdy se pobočka ke zavření navrhne.** Ve dvou případech:

1. **je mezi spádovými pobočkami** ze souboru `top_3_related_branches15.csv` —
   pak se v nabídce posune **nahoru**, před pobočky, které zůstávají;
2. **je blízko sousedící** — do **15 km** vzdušnou čarou, spočítáno ze souřadnic
   ve sloupci `branch_geom` (podporované podoby: WKT `POINT(…)` i s prefixem
   `SRID=…`, GeoJSON, hex EWKB z PostGIS, i pouhá dvojice čísel; zeměpisná šířka
   a délka se poznají podle hodnot, takže se nemohou zaměnit). Když souřadnice
   chybí, bere se **stejné ORP** z exportu poboček, případně stejné město
   a oblast. Tyhle pobočky jsou v panelu ve vlastní skupině
   **„Pobočky ke zavření v okolí“** — pobočky, které už jsou mezi *top 3*, se
   nedublují.

U každé nabízené i vybrané pobočky je vidět **Strategie BNS** (s rokem
uzavření), **Strategie BNS dle IR 25** a **Simulace 250** i **280** — u pobočky
ke zavření navíc červený štítek `KE ZAVŘENÍ <rok>`. Do souhrnu u výsledku
kalkulace a do historie se strategie tiskne jako samostatný sloupec, do PDF jde
na řádek s převzatými pobočkami.

**Odhad přesunu u pobočky z okolí** soubor neuvádí (není v *top 3*), takže
zůstane **prázdný a oranžově zvýrazněný** s poznámkou „zdroj odhad neuvádí —
zadejte ho“. Návštěvy se u ní počítají z **její vlastní celkové návštěvnosti**
(`navstevnost_v_pobocce_celkem`), případně z reportu návštěvnosti, pokud je pro
ni načtený.

### Co se u vybrané pobočky nastavuje

- **Odhad přesunu klientů (%)** — předplní se ze souboru, dá se přepsat.
- **FTE z databáze** — obsazenost pobočky z **exportu specialistů**; když v něm
  pobočka není, zkusí se **poslední načtený checklist** té pobočky. U každé
  pozice je vidět segment, název a FTE a dá se ještě upravit. Hledá se nejdřív
  podle **názvu** pobočky a teprve pak podle ID — kdyby v exportu bylo pod
  stejným ID něco jiného, je u zdroje napsané „pozor, v exportu je pod ID …
  jiný název“, aby se nepřevzali lidé z cizí pobočky.
- **Zadat zaměstnance ručně** — vlastní řádky (segment, pozice, FTE), když
  v databázi data nejsou nebo se přebírá jen část lidí.
- **Převzaté návštěvy** se počítají jako *návštěvy spádové pobočky × odhad
  přesunu*. Návštěvy se berou v tomto pořadí: sloupec `top_pobocka_visits_N`
  → **report návštěvnosti** té pobočky → její vlastní
  `navstevnost_v_pobocce_celkem` ze zdrojového souboru (to je případ pobočky,
  která není v *top 3* — typicky pobočky ke zavření z okolí). V UI je vždy
  napsané, z čeho se počítá.

### Co to udělá s kalkulací

Tlačítkem **„✓ Použít do kalkulace“** se:

1. **převzaté pozice přidají do vstupních dat checklistu** (sloupec
   `excel_loads.source_branch`), takže se z nich počítá WPL úplně stejně jako
   z vlastních FTE pobočky — v přehledu pozic jsou označené štítkem s názvem
   pobočky, odkud přišly, a podbarveným řádkem;
2. **návštěvnost se navýší** poměrem převzatých návštěv
   (`1 + převzaté ÷ navstevnost_v_pobocce_celkem`)
   — přiškálují se návštěvy celkem, po hodinách, po dnech i vstupy Monte Carla,
   takže s vyšším provozem počítá roční kapacita, špička, kapacitní shrnutí
   i doporučení míst. Doporučení prostor z reportu se zahodí a dopočítá se
   z navýšených návštěv (aby si čísla neodporovala); **pravděpodobnost přetížení
   z reportu se nepřepočítává** — není lineární;
3. u výsledku kalkulace i v detailu v historii se zobrazí blok **„Spádové
   pobočky — převzaté FTE a návštěvy“** s tabulkou (pobočka, odhad přesunu,
   převzaté FTE, návštěvy/den, návštěvy/rok, zdroj FTE) a s větou, **o kolik**
   návštěvnost roste (z X na Y návštěv/den, tedy o Z %);
4. do PDF (šedý blok kapitoly 1) se vytisknou vybrané pobočky s odhadem přesunu
   a celkové navýšení FTE i návštěv.

**Porovnání zadaných FTE se skutečným stavem** se počítá jen z **vlastních**
pozic pobočky — převzaté FTE ho nezkreslují.

Výběr se ukládá ke checklistu (tabulka `catchment_selection`), takže se
kalkulace i její PDF dají zpětně reprodukovat; „Zrušit všechny“ + „Použít do
kalkulace“ převzetí zruší.

## Výstup a sestava (všechno generování na jednom místě)

**Poslední blok kalkulace** (a stejně tak detailu v historii) se jmenuje
**„Výstup a sestava“** a je v něm pohromadě všechno, čím se z kalkulace něco
dostane „venku“ — nikde jinde v aplikaci už žádné exportní tlačítko není:

| Prvek | K čemu je |
| --- | --- |
| **Rozsah PDF** (4 přepínače) | co se má vygenerovat — viz tabulka níže |
| **Zaškrtávátka po skupinách** | jednotlivé kapitoly v rámci zvoleného rozsahu |
| **Poznámka do PDF** | volný text, který se vytiskne **do záhlaví první stránky** — žlutě podbarvený rámeček s vykřičníkem, aby ho čtenář nepřehlédl |
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
| 3 | **Layout pobočky** (fialová) | šedý blok s detaily · kompletní přehled WPL po zónách a segmentech · seznam nábytku po zónách (kompaktní výpis) · analýza segmentů, zón a jejich prvků · schéma pobočky (půdorys — volitelně, viz níže) |

### Záhlaví titulní stránky

Nad první kapitolou se tisknou dvě věci — v tomto pořadí:

1. **Poznámka uživatele** z boxu „Co se má vygenerovat“: žlutě podbarvený rámeček
   s vykřičníkem v jantarovém kolečku. Když je pole prázdné, netiskne se nic.
2. **Profil pobočky z exportu poboček** (`pobocky-export.xlsx`), pokud je pobočka
   v exportu:
   - barevné pilulky v tomto pořadí: **Rating 25** (barva podle kvintilu ratingu:
     1 = zelená nejlepší pětina … 5 = červená), **Rating kvintil**, **Změna ratingu
     25/24** ze sloupce `Změna ratingu 25/24` (v závorce procentní změna ze sloupce
     `Změna ratingu perc 25/24`; zelená při zlepšení, červená při zhoršení),
     **Trend ratingu 23–25** a **Nové výnosy kvintil**. Pilulky se zalamují na další
     řádek, když se do šířky stránky nevejdou,
   - pod pilulkami rámeček s **Regionem a Oblastí**, **adresou**, **novými výnosy**
     (včetně kvintilu a změny 25/24), **výnosy** (včetně trendu 21–25) a
     **čtyřmi nejlepšími obchody pobočky** — kategorie s nejvyšším počtem prodejů,
     u každé počet prodejů a kvintil.

Objem v korunách je v exportu jen jako **výnosy / nové výnosy** — u jednotlivých
prodejních kategorií jsou počty a kvintily. Kdyby export někdy sloupec s objemem
u kategorie obsahoval (hlavička obsahující „objem“), aplikace ho pozná sama
a k počtu prodejů ho dopíše.

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
   U židlí v čekací zóně se **obývák počítá jako 3 místa k sezení** (u řádku je
   pak vidět i „z čeho se to skládá“, např. `2 ks = 6 míst`), takže se kapacita
   nepočítá po kusech nábytku, ale po skutečných místech.
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

Tlačítka **„💾 Uložit layout“** a **„✎ Upravit layout“** jsou ve zvýrazněné akční
liště (odsazené od tabulek, s rámečkem v barvě akce — modrá u ukládání, zelená
u uloženého layoutu) a doplněné vysvětlením, co uložení znamená. Nedají se tak
přehlédnout mezi tabulkami s počty kusů.

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
| Service zone | Čekací zóna (obývák) | medium, flagship | **jeden obývák = 3 židle**, do doporučení **nejvýš 1 ks** (víc lze přidat ručně) |
| Service zone | Čekací zóna (židle) | všechny | doporučený počet židlí; tam, kde je i obývák, **zbytek nad obývák** (8 židlí → 1 obývák + 5 židlí) |
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
- **Přesun backoffice času na fast track:** část backoffice času pozice se odsedí na fast tracku,
  ne na vlastním kancelářském místě. Podíl je **nastavení u každé pozice** — sloupec
  **„Fast track %“** v tabulce „Pozice a jejich časové dotace“ (viz níže). Výchozí hodnoty
  odpovídají dosavadnímu chování: **osobní bankéř - medior 20 %**, **osobní bankéř - senior 10 %**,
  ostatní pozice 0 %. Tato část potřeby WPL se odečte od „Kancelářské místo“ a přiřadí se jako fast
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

### Schéma pobočky (půdorys kreslený z layoutu)

Pod formulářem layoutu (a stejně tak pod uloženým layoutem, i v detailu
v historii) je sekce **„Schéma pobočky (půdorys)“**: z počtů kusů se nakreslí
půdorysné schéma pobočky přes **Fabric.js** (`vendor/fabric.min.js`).

- Zóny jsou nakreslené jako **místnosti pod sebou** v pořadí service → meeting →
  backoffice → office room, každá s pruhem v barvě zóny, názvem, počtem kusů,
  součtem WPL a **potřebnou velikostí místnosti v m²**. U první místnosti (hala)
  je vyznačený **vstup** včetně otevírání dveří a volné místo, aby na něm nestál
  nábytek.
- **Potřebná velikost místnosti = 25 m² na 1 WPL.** Do plochy vstupují jen prvky,
  které se vykazují jako WPL — **fast tracky, čekací zóna a relax zóna plochu
  nezvětšují** (mají `wpl_counter = 0`). Nad schématem i v legendě je vidět
  celková potřeba plochy; je to stejné pravidlo jako u ukazatele „Potřebná plocha
  (WPL × 25 m²)“ v klíčových ukazatelích.
- V místnostech je **přesný počet zadaných prvků** — každý kus je samostatný
  kreslený symbol v reálných proporcích (měřítko **1 m = 40 px**), takže je
  poznat, že stůl 160 cm je větší než stůl 120 cm.

  | Prvek v layoutu | Jak je nakreslený |
  | --- | --- |
  | **Theke - nízká** | kulatý pult na kulatém koberci, uprostřed **1 židle bankéře**, klientské židle žádné (klient stojí) |
  | **Theke - vysoká** | totéž větší (2,6 m) a uprostřed **2 židle bankéřů** |
  | **Fast track (stolek a židle)** | kulatý stolek se **třemi zaoblenými přísedy** okolo |
  | **Lenka** | stůl s počítačem, židle bankéře a **dvě židle klienta** |
  | **Lenka vítací**, **Recepce** | **půlkruhový pult s přísedem a půlkruhovým paravánem** za ním |
  | **Martička** | hranatý stůl s počítačem, dvě židle klienta a jedna bankéře |
  | **Martička s TT** | totéž s **pokladnou (TT)** na stole |
  | **Pokladna s bezpečnostní nástavbou** | **uzavřená budka** s prosklenou přepážkou, pokladnou, trezorkem a židlí |
  | **Pokladní ostrov typu C (…2WPL)** | jediná varianta se **dvěma** židlemi bankéřů (dvě pracoviště s TT), klientská židle žádná |
  | **ostatní pokladní ostrovy C a 1/2C** | hranatý pult s TT, **jedna** židle bankéře, klientská židle žádná |
  | **Remote room** | skleněná budka se židlí, malým stolkem a televizí s **AI avatarem** |
  | **Čekací zóna (židle)** | obyčejná židle u stěny |
  | **Čekací zóna (obývák)** | tři židle a stoleček na **dřevěné podlaze 2 × 2 m** |
  | **Čekací zóna (lounge)** | pohovka, dvě křesla a stolek na dřevěné podlaze |
  | **Semidescreete room** | menší jednací místnost, **malý půlkruhový stůl**, dvě židle klienta, jedna bankéře |
  | **Jednací místnost** | větší místnost, **velký půlkruhový stůl**, dvě židle klienta, jedna bankéře, **televize, počítač a nabíječky** |
  | **Flex box** | **skleněná budka** (přerušovaný obrys), stoleček uprostřed a dvě židle proti sobě |
  | **Záliv** | polouzavřené místo s paravány, stůl s počítačem, bankéř + dva klienti |
  | **Kancelářské místo** | stůl **160 cm** s počítačem a židlí |
  | **Fast track backoffice** | stůl do **120 cm** **bez počítače**, se židlí |
  | **Interní zasedací místnost - malá** | místnost s velkým hranatým stolem, **12 židlí** |
  | **Interní zasedací místnost - velká** | místnost s velkým hranatým stolem, **16 židlí** |
  | **Kancelář** | místnost s pracovním stolem, počítačem a jednou židlí |
  | **Relax zóna** | místnost s pohovkou, stolkem, **květinou a tapetou** |
  | cokoli dalšího | obecný obdélník v barvě segmentu |

- **Pod každým prvkem je jeho celý název** (láme se do dvou i více řádků), takže
  je bez legendy jasné, o co jde.
- **Prvky bez WPL** (fast tracky, čekací zóna, relax zóna, vybavení pobočky) jsou
  v každé místnosti **za čerchovanou čárou** s poznámkou „PRVKY BEZ WPL
  (nepočítají se do plochy)“ — na první pohled je vidět, co plochu místnosti
  nezvětšuje.
- Když jsou zadané **bankomaty**, dělí se service zone **na třetiny**: vlevo prvky
  s WPL, uprostřed prvky bez WPL za čerchovanou čárou a vpravo **samoobslužná
  servisní zóna oddělená zdí** (plná černá čára) s nakreslenými bankomaty.
- **Barevné označení segmentů:** výplň prvku je světlý odstín barvy segmentu,
  obrys jeho plná barva a u větších prvků je v levém horním rohu ještě **štítek
  s klíčem segmentu** (MMMA, PROVOZ, …). Židle a přísedy jsou neutrálně šedé,
  aby barva segmentu vynikla.
- **Prvky lze chytit myší a přesunout** (přichytávají se na mřížku 5 px),
  tlačítkem **„↺ Přeskládat“** se schéma vrátí do automatického rozvržení.
  Dále je v liště **zoom** (50–200 %) a **„📷 Uložit jako PNG“**.
- Po přejetí kurzorem se zobrazí bublina s názvem prvku, jeho pořadím
  (např. „2/4“), segmentem a zónou.
- Ve formuláři se schéma **překresluje průběžně** (s krátkým zpožděním po
  poslední změně počtu), takže je hned vidět, co přidání dalšího kusu znamená.
- Jde o **návrh rozmístění**, ne o projektovou dokumentaci — skutečné rozvržení
  určuje projektant. Při více než 320 prvcích schéma nakreslí prvních 320
  a upozorní na to, aby zůstalo čitelné.

#### Vybavení pobočky (bankomaty, denní místnost, Frontmatic, schránky, trezory)

Nad schématem je blok **„Vybavení pobočky“** — prvky, které nevyplývají z výpočtu
WPL, ale na pobočce jsou. Co se zaškrtne (nebo zadá počtem), se hned přikreslí do
schématu a uloží ke kalkulaci (tabulka `layout_extras`):

| Nastavení | Co se nakreslí a kam |
| --- | --- |
| **Bankomaty** — počet po typech (Výběrový, Vkladový, Recyklační, Transakční, Příprava) | při **jednom a více** vznikne v service zone **Samoobslužná servisní zóna oddělená zdí** (pravá třetina boxu servisní zóny) a v ní tolik bankomatů, kolik je zadáno; každý má u sebe zkratku typu a celý název |
| **Denní místnost** (zaškrtávátko) | do backoffice **místnost s kuchyňkou, mikrovlnkou, jídelním stolem se čtyřmi židlemi, televizí, květinou a koši** |
| **Frontmatic** (zaškrtávátko) | do service zone **vyvolávací systém** — kiosek s výdejem lístků a tabule s čísly |
| **Bezpečnostní schránky pro klienty** (zaškrtávátko) | do service zone **stěna schránek**, kam si klienti ukládají věci |
| **Trezory** — počet | do backoffice zadaný **počet trezorů** |

Vybavení nemá WPL, takže se kreslí vpravo za čerchovanou čárou a **nezvětšuje
potřebnou plochu** místnosti. Nastavení se ukládá okamžitě (nezávisle na tlačítku
„Uložit layout“) a v detailu v historii je stejné, včetně schématu.

#### Lidé na místech (postavičky ve schématu)

Pod schématem je blok **„Lidé na místech“**: nabídne pozice z checklistu (počet
lidí = FTE zaokrouhlené na osoby) a umožní je **alokovat na konkrétní místo**:

1. klikněte na pozici (chip se zvýrazní),
2. klikněte ve schématu na prvek — k místu se přikreslí **postavička** v barvě
   segmentu a prvek se orámuje modrou přerušovanou čárou,
3. přiřazení se objeví v seznamu pod schématem, kde se dá tlačítkem **✕** zrušit.

Na jedno místo lze přiřadit i více lidí (např. dva bankéře k vysoké thece).
U pozice je vidět počítadlo **přiřazeno/celkem**; jakmile jsou přiřazení všichni,
chip se zneaktivní. Přiřazení se ukládá ke kalkulaci (tabulka `layout_staff`),
takže přežije uložení layoutu, znovuotevření aplikace i zobrazení v historii,
a tiskne se i do schématu v PDF.

#### Schéma v PDF sestavě

V boxu **„Co se má vygenerovat“** je v kapitole *3 Layout pobočky* volba
**„Schéma pobočky (půdorys s nakresleným nábytkem)“**. Ve výchozím stavu je
**vypnutá** (schéma je obrázek na celou šířku stránky) — po zaškrtnutí se vytiskne
na konec kapitoly layoutu:

- schéma se vykreslí do skrytého canvasu (nezávisle na tom, jak je uživatel
  právě odzoomovaný nebo jak si prvky poposunul) a vloží se jako **PNG
  v dvojnásobném rozlišení**,
- když se na zbytek stránky nevejde, začne na nové stránce a případně se zmenší
  tak, aby se na stránku vešlo celé,
- pod obrázkem je poznámka s pravidlem 25 m²/WPL a součtem prvků a plochy.

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
„Data a Excel šablona“ (viz níže).

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

## Export Excel šablony checklistu

Poslední blok záložky **„Data a Excel šablona“** vychází z dat popsaných výše — segmenty, pozice
i nábytek se do checklistu propíšou přesně v tom pořadí a s tím obsahem, jak jsou v databázi:

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
- Generovaná Excel šablona (záložka „Data a Excel šablona“) se naopak zapisuje
  vlastním minimalistickým zapisovačem `.xlsx` (`xlsx_writer.js`) — vendorovaná
  SheetJS (komunitní edice) při zápisu zahazuje veškeré formátování buněk, což
  by pro šablonu, která má vypadat jako vzorový checklist, nešlo použít.
- PDF export přes [jsPDF](https://github.com/parallax/jsPDF) s vloženým
  fontem DejaVu Sans (`vendor/dejavu-fonts.js`), aby se správně zobrazovala
  česká diakritika. Grafy Monte Carla v PDF se kreslí přímo z čar a obdélníků
  (jsPDF grafy neumí) podle stejných dat a stejného vzhledu jako SVG grafy
  v HTML reportu.
- Schéma pobočky (půdorys) kreslí **Fabric.js 5.3** (`vendor/fabric.min.js`,
  MIT licence v `vendor/fabric-LICENSE.txt`) do HTML canvasu. Symboly nábytku jsou
  skládané z primitiv (obdélníky, kružnice, oblouky dveří, cesty půlkruhových stolů)
  a seskupené do `fabric.Group`, takže se každý kus chová jako jeden posuvný objekt.
  Rozměry symbolů jsou zadané **v metrech** a přepočítávají se konstantou
  `PLAN_PX_PER_M` (40 px = 1 m). Vybavení pobočky a přiřazení lidí se ukládá do
  tabulek `layout_extras` (JSON u kalkulace) a `layout_staff` (kalkulace + klíč
  místa `zóna||segment||prvek||pořadí` + pozice); mazání kalkulace maže i je. Každá instance sekce (kalkulace / historie) má
  vlastní canvas i stav (`floorPlanState`). Pro PDF se stejná scéna vykreslí do
  odloženého `fabric.StaticCanvas` a exportuje jako PNG, takže tisk nezávisí na
  aktuálním zoomu ani na ručně posunutých prvcích.
- Spádové pobočky žijí v tabulkách `catchment` (jeden řádek = pobočka a jedna
  její top spádová pobočka ze zdrojového CSV; pobočka bez vazby má řádek
  s prázdným `rel_*` jen kvůli souřadnicím `branch_lon`/`branch_lat`)
  a `catchment_selection` (výběr ke konkrétnímu checklistu
  včetně odhadu přesunu, režimu FTE a spočítaných návštěv). Navýšení návštěvnosti
  se aplikuje na jednom místě — v `getVisitorForCalculation()` — takže s ním
  počítají všechny sekce i PDF.
- Strategie BNS se čte z payloadu exportu poboček (`bnsFromPayload()`), stavy se
  normalizují na `keep` / `close` / neznámé (`bnsState()`) a celá mapa poboček se
  cachuje podle času importu (`branchBnsMap()`), aby hledání blízkých poboček
  nemuselo pokaždé parsovat všechny řádky. Souřadnice ze `branch_geom` řeší
  `parseBranchGeom()` (WKT, GeoJSON, hex EWKB, dvojice čísel), vzdálenost
  `geoDistanceKm()` (haversine, vzdušná čára — ne dojezd po silnici); dosah je
  konstanta `CATCHMENT_NEARBY_KM`.
- Doplňkové datové soubory („Dodatečná analytika“) se hledají dvěma cestami:
  přes `fetch()` (funguje jen při běhu na http/https) a přes **File System Access
  API** — handle složky s daty se ukládá do IndexedDB (`dataDir`) vedle handle
  databáze (`dbFile`), takže povolení platí i po zavření prohlížeče. Importy
  končí v tabulkách `visitor_data`, `specialist_export` a `branch_export`
  (payload = celý řádek exportu jako JSON, aby se ze slovníku nic neztratilo).
