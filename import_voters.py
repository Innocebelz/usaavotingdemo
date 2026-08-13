import psycopg2
import psycopg2.errors
import csv
import os
import re
from collections import defaultdict
from dotenv import load_dotenv

load_dotenv()

CSV_FILE = "voters.csv"
DB_URL   = os.getenv("DATABASE_URL")

# ── Column header names from your Google Form CSV ────────────────────────────
COL_NAME   = "Full Name"
COL_EMAIL  = "Email Address"
COL_MATRIC = "Matriculation Number"
# ─────────────────────────────────────────────────────────────────────────────


def normalize_matric_number(matric_number: str) -> str:
    cleaned = re.sub(r"[\s\-_/]+", "", (matric_number or "").strip().upper())
    match = re.search(r"8UGA[A-Z0-9]+$", cleaned)
    return match.group(0) if match else cleaned


def import_voters():
    if not os.path.exists(CSV_FILE):
        print(f"Error: {CSV_FILE} not found. Place it in the project root.")
        return

    if not DB_URL:
        print("Error: DATABASE_URL not found in .env")
        return

    print("Connecting to database...")
    try:
        conn   = psycopg2.connect(DB_URL)
        cursor = conn.cursor()
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    # ── STEP 1: Pre-import integrity scan ─────────────────────────────────
    # Detect duplicate matric numbers and duplicate emails IN THE CSV itself
    # before touching the database. Flag them all so the EC can investigate.
    print("\n── Pre-import integrity scan ────────────────────────────────")

    matric_seen = defaultdict(list)   # matric → [row indices]
    email_seen  = defaultdict(list)   # email  → [matric numbers]
    all_rows    = []

    try:
        with open(CSV_FILE, mode='r', encoding='latin-1') as f:
            reader = csv.DictReader(f)
            for i, row in enumerate(reader, start=2):  # row 1 = header
                name   = row.get(COL_NAME,   '').strip()
                email  = row.get(COL_EMAIL,  '').strip().lower()
                raw_matric = row.get(COL_MATRIC, '').strip().upper()
                matric = normalize_matric_number(raw_matric)
                all_rows.append((i, name, email, matric, raw_matric))
                if matric:
                    matric_seen[matric].append(i)
                if email:
                    email_seen[email].append(matric or '?')
    except Exception as e:
        print(f"Error reading CSV: {e}")
        conn.close()
        return

    duplicate_matrics = {m: rows for m, rows in matric_seen.items() if len(rows) > 1}
    duplicate_emails  = {e: mats for e, mats in email_seen.items()  if len(mats) > 1}

    integrity_ok = True

    if duplicate_matrics:
        integrity_ok = False
        print(f"\n   DUPLICATE MATRIC NUMBERS IN CSV ({len(duplicate_matrics)} found):")
        for matric, rows in duplicate_matrics.items():
            print(f"      {matric}  →  appears on CSV rows: {rows}")
        print("      ACTION REQUIRED: Investigate before import. Only the last")
        print("      occurrence will be kept (ON CONFLICT overwrites previous).")

    if duplicate_emails:
        integrity_ok = False
        print(f"\n    DUPLICATE EMAILS IN CSV ({len(duplicate_emails)} found):")
        for email, mats in duplicate_emails.items():
            print(f"      {email}  →  used by matric numbers: {mats}")
        print("      ACTION REQUIRED: One person may have registered multiple times.")
        print("      The import will REJECT the second registration for the same email.")

    if integrity_ok:
        print("    No duplicate matric numbers or emails detected in CSV.")
    else:
        print("\n  These issues have been logged. Import will continue but")
        print("  duplicates will be handled as described above.")

    # ── STEP 2: Ensure email uniqueness constraint exists in the DB ────────
    try:
        cursor.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'voters_email_unique'
                ) THEN
                    ALTER TABLE Voters ADD CONSTRAINT voters_email_unique UNIQUE (email);
                END IF;
            END $$;
        """)
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"\n  Warning: Could not ensure email uniqueness constraint: {e}")

    # ── STEP 3: Import rows ────────────────────────────────────────────────
    print("\n── Importing rows ───────────────────────────────────────────")

    added          = 0
    updated        = 0
    skipped        = 0
    dup_email_rows = []

    for row_num, name, email, matric, raw_matric in all_rows:
        if not matric:
            print(f"  REJECTED   row {row_num}: {name or '?'} — missing matric number")
            skipped += 1
            continue
        if not email:
            print(f"  REJECTED   row {row_num}: {matric} — missing email")
            skipped += 1
            continue

        try:
            if raw_matric and raw_matric != matric:
                print(f"  NORMALIZED row {row_num}: {raw_matric} → {matric}")

            # Check if this is a new or existing record
            cursor.execute("SELECT email FROM Voters WHERE matric_number = %s", (matric,))
            existing = cursor.fetchone()

            cursor.execute(
                """
                INSERT INTO Voters (matric_number, name, email, has_voted)
                VALUES (%s, %s, %s, FALSE)
                    ON CONFLICT (matric_number) DO UPDATE
                                                       SET name  = EXCLUDED.name,
                                                       email = EXCLUDED.email
                """,
                (matric, name, email)
            )
            conn.commit()

            if existing:
                if existing[0].lower() != email.lower():
                    print(f"  UPDATED    {matric}  {name}  (email changed: {existing[0]} → {email})")
                else:
                    print(f"  OK         {matric}  {name}  {email}")
                updated += 1
            else:
                print(f"  ADDED      {matric}  {name}  {email}")
                added += 1

        except psycopg2.errors.UniqueViolation:
            # Email already exists under a different matric number
            conn.rollback()
            cursor.execute("SELECT matric_number, name FROM Voters WHERE email = %s", (email,))
            conflict = cursor.fetchone()
            conflict_info = f"{conflict[0]} ({conflict[1]})" if conflict else "unknown"
            msg = (f"    DUP EMAIL  row {row_num}: {matric} {name} — "
                   f"email '{email}' already registered to {conflict_info}")
            print(msg)
            dup_email_rows.append({
                "row": row_num, "matric": matric, "name": name,
                "email": email, "conflict_with": conflict_info
            })
            skipped += 1

        except Exception as e:
            conn.rollback()
            print(f"  ERROR      row {row_num}: {matric} — {e}")
            skipped += 1

    # ── STEP 4: Summary ───────────────────────────────────────────────────
    print(f"\n── Import summary ───────────────────────────────────────────")
    print(f"   New records added    : {added}")
    print(f"   Existing updated     : {updated}")
    print(f"   Skipped / Errors     : {skipped}")

    if dup_email_rows:
        print(f"\n──   Duplicate email conflicts ({len(dup_email_rows)}) — EC action required:")
        for r in dup_email_rows:
            print(f"   Row {r['row']}: {r['matric']} {r['name']} <{r['email']}>")
            print(f"            conflicts with voter: {r['conflict_with']}")
        print("\n   These records were NOT imported. Investigate each case:")
        print("   Is this the same person who registered twice?")
        print("   Or did two different people use the same email?")
        print("   Resolve manually in Supabase after confirming with the student.")

    cursor.close()
    conn.close()


if __name__ == "__main__":
    import_voters()
