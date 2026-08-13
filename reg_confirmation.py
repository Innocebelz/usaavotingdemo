"""
Sends a "You are registered to vote" confirmation email to any voter
who hasn't received one yet. Safe to re-run daily after each import
batch — only emails voters where registration_email_sent = FALSE,
then marks them as sent so they're never emailed twice.

Usage:
    python send_registration_confirmations.py
"""

import os
import httpx
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

DB_URL             = os.getenv("DATABASE_URL")
BREVO_API_KEY      = os.getenv("BREVO_API_KEY")
BREVO_SENDER_EMAIL = os.getenv("BREVO_SENDER_EMAIL")

# EC contact address — used as Reply-To so a voter hitting "Reply" reaches
# a real monitored inbox instead of the Brevo sending address. Keep this in
# sync with EC_REPLY_TO_EMAIL in main.py — same address, one source of truth
# conceptually even though it's duplicated across these two standalone files.
EC_REPLY_TO_EMAIL = "electoralcommissiom231@gmail.com"

# Safety cap — stop after sending this many in one run, so a huge unsent
# backlog can never blow through your daily Brevo limit by accident.
MAX_EMAILS_PER_RUN = 280


def _registration_html(voter_name: str, matric_number: str, email: str) -> str:
    return f"""
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;
                    border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">

            <div style="background:#eab308;height:6px;width:100%;"></div>

            <div style="padding:32px 32px 24px;">

                <div style="text-align:center;margin-bottom:24px;">
                    <h2 style="margin:0;color:#18181b;font-size:20px;
                               letter-spacing:1px;text-transform:uppercase;">
                        U.S.A.A Electoral Commission
                    </h2>
                    <p style="margin:4px 0 0;color:#eab308;font-size:11px;
                              font-weight:bold;letter-spacing:2px;text-transform:uppercase;">
                        'Unitè Triomphe Tout'
                    </p>
                </div>

                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;
                            padding:12px 16px;margin-bottom:24px;text-align:center;">
                    <span style="color:#15803d;font-weight:bold;font-size:13px;">
                        ✓ &nbsp; You are registered to vote
                    </span>
                </div>

                <p style="color:#3f3f46;font-size:14px;margin:0 0 8px;">
                    Hello <strong>{voter_name}</strong>,
                </p>
                <p style="color:#3f3f46;font-size:14px;margin:0 0 20px;line-height:1.6;">
                    You have been successfully registered as an eligible voter for the
                    upcoming <strong>U.S.A.A General Elections</strong>.
                </p>

                <div style="background:#fafafa;border:2px solid #e4e4e7;border-radius:8px;
                            padding:16px;margin-bottom:24px;">
                    <p style="margin:0 0 6px;font-size:11px;font-weight:bold;
                              color:#71717a;text-transform:uppercase;letter-spacing:1px;">
                        Registered Matriculation Number
                    </p>
                    <p style="margin:0;font-family:monospace;font-size:15px;
                              color:#18181b;font-weight:bold;">
                        {matric_number}
                    </p>
                </div>

                <p style="color:#3f3f46;font-size:13px;margin:0 0 16px;line-height:1.6;">
                    When voting opens, you will receive a separate one-time verification
                    code by email to <strong>{email}</strong>. You will not need a password, just your matriculation number and the code we send you at that time.
                </p>

                <hr style="border:none;border-top:1px solid #f0f0f0;margin:0 0 20px;">

                <p style="color:#a1a1aa;font-size:12px;text-align:center;margin:0 0 8px;line-height:1.6;">
                    If any of these details are incorrect, or if you did not register
                    yourself, please contact the Electoral Commission immediately by
                    replying to this email.
                </p>
                <p style="color:#a1a1aa;font-size:10px;text-align:center;margin:0;font-style:italic;">
                    This is an automated message. Replying will reach the Electoral Commission directly.
                </p>
            </div>

            <div style="background:#18181b;padding:16px 32px;text-align:center;">
                <p style="margin:0;color:#71717a;font-size:11px;">
                    © 2026 U.S.A.A Electoral Committee · Algeria
                </p>
            </div>
        </div>
    """


def send_registration_email(receiver_email: str, voter_name: str, matric_number: str) -> bool:
    """Returns True if sent successfully, False otherwise. Never raises."""
    if not BREVO_API_KEY or not BREVO_SENDER_EMAIL:
        print("  ERROR: BREVO_API_KEY or BREVO_SENDER_EMAIL not set in .env")
        return False

    try:
        response = httpx.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={
                "accept":       "application/json",
                "api-key":      BREVO_API_KEY,
                "content-type": "application/json",
            },
            json={
                "sender": {
                    "name":  "Northsetif Electoral Commission",
                    "email": BREVO_SENDER_EMAIL,
                },
                "replyTo": {
                    "name":  "NorthSetif Electoral Commission",
                    "email": EC_REPLY_TO_EMAIL,
                },
                "to":          [{"email": receiver_email, "name": voter_name}],
                "subject":     "✓ You are registered to vote — NorthSetif General Election",
                "htmlContent": _registration_html(voter_name, matric_number, receiver_email),
            },
            timeout=10,
        )
        response.raise_for_status()
        return True
    except Exception as e:
        print(f"  ERROR sending to {receiver_email}: {e}")
        return False


def main():
    if not DB_URL:
        print("Error: DATABASE_URL not found in .env")
        return

    conn = psycopg2.connect(DB_URL)

    # Make sure the tracking column exists — safe to run every time
    with conn.cursor() as cur:
        cur.execute("""
                    ALTER TABLE Voters
                        ADD COLUMN IF NOT EXISTS registration_email_sent BOOLEAN NOT NULL DEFAULT FALSE
                    """)
    conn.commit()

    # Pull everyone who hasn't been emailed yet
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
                    SELECT matric_number, name, email
                    FROM Voters
                    WHERE registration_email_sent = FALSE
                    ORDER BY matric_number
                        LIMIT %s
                    """, (MAX_EMAILS_PER_RUN,))
        pending = cur.fetchall()

    if not pending:
        print("No new voters to email. Everyone already has a confirmation.")
        conn.close()
        return

    print(f"Found {len(pending)} voter(s) awaiting registration confirmation.\n")

    sent    = 0
    failed  = 0

    for voter in pending:
        ok = send_registration_email(voter["email"], voter["name"], voter["matric_number"])
        if ok:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE Voters SET registration_email_sent = TRUE WHERE matric_number = %s",
                    (voter["matric_number"],)
                )
            conn.commit()
            print(f"  SENT    {voter['matric_number']}  {voter['name']}  <{voter['email']}>")
            sent += 1
        else:
            print(f"  FAILED  {voter['matric_number']}  {voter['name']}  <{voter['email']}>")
            failed += 1

    print(f"\n── Summary ───────────────────────────────")
    print(f"   Sent   : {sent}")
    print(f"   Failed : {failed}")
    if len(pending) == MAX_EMAILS_PER_RUN:
        print(f"\n   Note: hit the {MAX_EMAILS_PER_RUN}/run safety cap.")
        print(f"   Run this script again to send the next batch.")

    conn.close()


if __name__ == "__main__":
    main()