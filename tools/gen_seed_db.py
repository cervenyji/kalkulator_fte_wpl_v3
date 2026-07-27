#!/usr/bin/env python3
"""Vygeneruje počáteční SQLite databázi (fte_wpl_calculator.db) se schématem
a výchozími referenčními daty (absence, časové dotace pozic).

Referenční data jsou převzata z původní aplikace (inicializace_db.py).
Spusťte znovu pouze pokud chcete resetovat vzorovou databázi do výchozího stavu:
    python3 tools/gen_seed_db.py
"""
import os
import sqlite3

DB_NAME = "fte_wpl_calculator.db"


def main():
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    db_path = os.path.join(repo_root, DB_NAME)
    if os.path.exists(db_path):
        os.remove(db_path)

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("""
    CREATE TABLE absence (
        segment TEXT PRIMARY KEY,
        nepritomnost REAL,
        homeoffice REAL
    )
    """)

    cur.execute("""
    CREATE TABLE casove_dotace (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        segment TEXT,
        pozice TEXT,
        service_zone REAL,
        meeting_zone REAL,
        backoffice_zone REAL,
        office_room REAL
    )
    """)

    cur.execute("""
    CREATE TABLE excel_loads (
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
    )
    """)

    cur.execute("""
    CREATE TABLE calculations (
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
    )
    """)

    absence_data = [
        ("MMMA", 22.9, 0.7),
        ("EPC", 19.7, 2.5),
        ("HC", 19.8, 5.6),
        ("PROVOZ", 21, 0.5),
        ("EPB", 18.6, 1.5),
        ("SBC", 19.5, 5.5),
        ("RKC", 17.1, 7),
        ("CESTOVNÍ", 0, 0),
        ("OSTATNÍ", 20.1, 2.3),
    ]
    cur.executemany("INSERT INTO absence (segment, nepritomnost, homeoffice) VALUES (?, ?, ?)", absence_data)

    casove_dotace_data = [
        # (segment, pozice, service_zone, meeting_zone, backoffice_zone, office_room)
        # SBC
        ("SBC", "firemní bankéř - medior", None, 20, 80, None),
        ("SBC", "podpora firemních bankéřů", None, 10, 90, None),
        ("SBC", "firemní bankéř - senior", None, 20, 80, None),
        ("SBC", "firemní bankéř - master", None, 20, 80, None),
        ("SBC", "manažer segmentu SB - regionální ředitel", None, None, None, 100),
        ("SBC", "manažer segmentu SB - team leader", None, None, 100, None),
        ("SBC", "spec. pro firemní pojištění - senior", None, 20, 80, None),
        # RKC
        ("RKC", "Ředitel regionálního korporátního centra", None, None, None, 100),
        ("RKC", "korporátní finanční analytik - senior", None, None, 100, None),
        ("RKC", "korporátní finanční analytik - master", None, None, 100, None),
        ("RKC", "spec. korporátní klientely - asistent", None, None, 100, None),
        ("RKC", "korporátní úvěrový specialista - medior", None, None, 100, None),
        ("RKC", "korporátní úvěrový specialista - senior", None, None, 100, None),
        # PROVOZ
        ("PROVOZ", "regionální manažer provozu", None, None, 100, None),
        ("PROVOZ", "manažer provozu pob. sítě - team leader", None, None, 100, None),
        ("PROVOZ", "pobočkový specialista - provoz", None, None, 100, None),
        ("PROVOZ", "spec. provozu pobočkové sítě - medior", None, None, 100, None),
        ("PROVOZ", "spec. provozu pobočkové sítě - senior", None, None, 100, None),
        # OSTATNÍ
        ("OSTATNÍ", "remote firemní bankéř - medior", None, None, 100, None),
        ("OSTATNÍ", "remote MMA bankéř - junior", None, None, 100, None),
        ("OSTATNÍ", "remote MMA bankéř - team leader", None, None, 100, None),
        ("OSTATNÍ", "remote premier bankéř - medior", None, None, 100, None),
        ("OSTATNÍ", "area leader virtuálního centra bydlení", None, None, 100, None),
        ("OSTATNÍ", "hypoteční specialista VCB - medior", None, None, 100, None),
        ("OSTATNÍ", "hypoteční specialista VCB - senior", None, None, 100, None),
        ("OSTATNÍ", "specialista podpory VCB - medior", None, None, 100, None),
        ("OSTATNÍ", "nedefinovaná pozice - 100 pct back office", None, None, 100, None),
        ("OSTATNÍ", "nedefinovaná pozice - 50 pct back office a 50 pct meeting zone", None, 50, 50, None),
        # MMMA
        ("MMMA", "bankéř klientské péče - junior", 95, None, 5, None),
        ("MMMA", "bankéř klientské péče - medior", 95, None, 5, None),
        ("MMMA", "manažer segm. investice - reg. ředitel", None, None, 100, None),
        ("MMMA", "manažer segmentu investice - zástupce", None, None, 100, None),
        ("MMMA", "investiční specialista - medior", None, 60, 40, None),
        ("MMMA", "Retail Lead - area lead", None, None, None, 100),
        ("MMMA", "Retail Lead - regional lead", None, None, None, 100),
        ("MMMA", "Retail Lead - team lead", None, 60, 40, None),
        ("MMMA", "osobní bankéř - junior", 10, 70, 20, None),
        ("MMMA", "osobní bankéř - medior", None, 80, 20, None),
        ("MMMA", "osobní bankéř - senior", None, 80, 20, None),
        ("MMMA", "osobní bankéř - master", None, 80, 20, None),
        ("MMMA", "regionální manažer strategie - medior", None, None, 100, None),
        ("MMMA", "manažer segm. pojištění - reg. ředitel", None, None, 100, None),
        ("MMMA", "pojišťovací specialista - medior", None, 60, 40, None),
        # HC
        ("HC", "hypoteční specialista - medior", None, 40, 60, None),
        ("HC", "hypoteční specialista - senior", None, 40, 60, None),
        ("HC", "manažer segm. hypo - regionální ředitel", None, None, 100, None),
        ("HC", "manažer segmentu hypo - zástupce", None, None, 100, None),
        ("HC", "pobočkový specialista - hypo", None, 40, 60, None),
        # EPC
        ("EPC", "Premier Bus. and Digi Assistant - senior", 100, None, None, None),
        ("EPC", "manaž. segm. Erste Premier - area leader", None, None, None, 100),
        ("EPC", "manaž. segm. Erste Premier - team leader bez portfolia", None, None, 100, None),
        ("EPC", "manaž. segm. Erste Premier - team leader s portfoliem", None, 30, 70, None),
        ("EPC", "premier bankéř - medior", None, 50, 50, None),
        ("EPC", "premier bankéř - master", None, 50, 50, None),
        ("EPC", "premier bankéř - senior", None, 50, 50, None),
        # EPB
        ("EPB", "asistentka EPB - medior", None, None, 100, None),
        ("EPB", "asistentka EPB - master", None, None, 100, None),
        ("EPB", "privátní bankéř - medior", None, 50, 100, None),
        ("EPB", "privátní bankéř - senior", None, 50, 100, None),
        ("EPB", "privátní bankéř - wealth management", None, 50, 100, None),
        ("EPB", "manažer segmentu EPB - regionál. ředitel", None, None, None, 100),
        ("EPB", "manažer segmentu EPB - zástupce", None, None, 100, None),
        # CESTOVNÍ
        ("CESTOVNÍ", "bankéř klientské péče - junior", None, 20, 80, None),
        ("CESTOVNÍ", "bankéř klientské péče - medior", None, 10, 90, None),
        ("CESTOVNÍ", "manažer segm. investice - reg. ředitel", None, 20, 80, None),
        ("CESTOVNÍ", "manažer segmentu investice - zástupce", None, None, 100, None),
        ("CESTOVNÍ", "investiční specialista - medior", None, None, 100, None),
        ("CESTOVNÍ", "Retail Lead - area lead", None, 20, 80, None),
        ("CESTOVNÍ", "Retail Lead - regional lead", None, None, 100, None),
        ("CESTOVNÍ", "Retail Lead - team lead", None, None, 100, None),
        ("CESTOVNÍ", "osobní bankéř - junior", None, None, 100, None),
        ("CESTOVNÍ", "osobní bankéř - medior", None, None, 100, None),
        ("CESTOVNÍ", "osobní bankéř - senior", None, None, 100, None),
        ("CESTOVNÍ", "regionální manažer strategie - medior", None, None, 100, None),
        ("CESTOVNÍ", "manažer segm. pojištění - reg. ředitel", None, None, 100, None),
        ("CESTOVNÍ", "pojišťovací specialista - medior", None, None, 100, None),
        ("CESTOVNÍ", "firemní bankéř - medior", None, None, 100, None),
        ("CESTOVNÍ", "podpora firemních bankéřů", None, None, 100, None),
        ("CESTOVNÍ", "firemní bankéř - senior", None, None, 100, None),
        ("CESTOVNÍ", "manažer segmentu SB - regionální ředitel", None, None, 100, None),
        ("CESTOVNÍ", "manažer segmentu SB - team leader", None, None, 100, None),
        ("CESTOVNÍ", "spec. pro firemní pojištění - senior", None, None, 100, None),
        ("CESTOVNÍ", "hypoteční specialista - medior", None, None, 100, None),
        ("CESTOVNÍ", "hypoteční specialista - senior", None, None, 100, None),
        ("CESTOVNÍ", "manažer segm. hypo - regionální ředitel", None, None, 100, None),
        ("CESTOVNÍ", "manažer segmentu hypo - zástupce", None, None, 100, None),
        ("CESTOVNÍ", "pobočkový specialista - hypo", None, None, 100, None),
        ("CESTOVNÍ", "Premier Bus. and Digi Assistant - senior", None, None, 100, None),
        ("CESTOVNÍ", "manaž. segm. Erste Premier - area leader", None, 50, 50, None),
        ("CESTOVNÍ", "manaž. segm. Erste Premier - team leader bez portfolia", 95, None, 5, None),
        ("CESTOVNÍ", "manaž. segm. Erste Premier - team leader s portfoliem", 95, None, 5, None),
        ("CESTOVNÍ", "premier bankéř - medior", None, None, 100, None),
        ("CESTOVNÍ", "premier bankéř - master", None, None, 100, None),
        ("CESTOVNÍ", "premier bankéř - senior", None, 60, 40, None),
        ("CESTOVNÍ", "asistentka EPB - medior", None, None, 100, None),
        ("CESTOVNÍ", "privátní bankéř - medior", None, None, 100, None),
        ("CESTOVNÍ", "privátní bankéř - senior", None, 60, 40, None),
        ("CESTOVNÍ", "privátní bankéř - wealth management", 10, 70, 20, None),
        ("CESTOVNÍ", "manažer segmentu EPB - regionál. ředitel", None, 80, 20, None),
        ("CESTOVNÍ", "manažer segmentu EPB - zástupce", None, 80, 20, None),
        ("CESTOVNÍ", "regionální manažer provozu", None, None, 100, None),
        ("CESTOVNÍ", "manažer provozu pob. sítě - team leader", None, None, 100, None),
        ("CESTOVNÍ", "pobočkový specialista - provoz", None, 60, 40, None),
        ("CESTOVNÍ", "spec. provozu pobočkové sítě - medior", None, 40, 60, None),
        ("CESTOVNÍ", "spec. provozu pobočkové sítě - senior", None, 40, 60, None),
        ("CESTOVNÍ", "Ředitel regionálního korporátního centra", None, None, 100, None),
        ("CESTOVNÍ", "korporátní finanční analytik - senior", None, None, 100, None),
        ("CESTOVNÍ", "korporátní finanční analytik - master", None, 40, 60, None),
        ("CESTOVNÍ", "spec. korporátní klientely - asistent", None, None, 100, None),
        ("CESTOVNÍ", "korporátní úvěrový specialista - medior", None, None, 100, None),
        ("CESTOVNÍ", "korporátní úvěrový specialista - senior", None, None, 100, None),
        ("CESTOVNÍ", "remote firemní bankéř - medior", None, 30, 70, None),
        ("CESTOVNÍ", "remote premier bankéř - medior", None, 50, 50, None),
        ("CESTOVNÍ", "area leader virtuálního centra bydlení", None, None, 100, None),
        ("CESTOVNÍ", "hypoteční specialista VCB - medior", None, 50, 100, None),
        ("CESTOVNÍ", "hypoteční specialista VCB - senior", None, 50, 100, None),
        ("CESTOVNÍ", "specialista podpory VCB - medior", None, 50, 100, None),
        ("CESTOVNÍ", "nedefinovaná pozice - 100 pct back office", None, None, 100, None),
        ("CESTOVNÍ", "nedefinovaná pozice - 50 pct back office a 50 pct meeting zone", None, None, 100, None),
        ("CESTOVNÍ", "asistentka EPB - master", None, None, 100, None),
        ("CESTOVNÍ", "osobní bankéř - master", None, 80, 20, None),
        ("CESTOVNÍ", "firemní bankéř - master", None, 20, 80, None),
    ]
    cur.executemany("""
        INSERT INTO casove_dotace (segment, pozice, service_zone, meeting_zone, backoffice_zone, office_room)
        VALUES (?, ?, ?, ?, ?, ?)
    """, casove_dotace_data)

    conn.commit()
    conn.close()
    print(f"Vytvořena vzorová databáze: {db_path}")


if __name__ == "__main__":
    main()
