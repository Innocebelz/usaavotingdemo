import os
import random
import secrets
import hmac
import hashlib
import base64
import json
import time
import httpx
import re
from datetime import datetime, timedelta
from typing import Dict, Optional

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

# ---------------------------------------------------------------------------
# Password hashing — PBKDF2-SHA256 via Python stdlib.
# No external dependency, no version conflicts, no 72-byte limit.
# OWASP recommends 260,000 iterations for SHA-256 as of 2023.
# ---------------------------------------------------------------------------

_PBKDF2_ITERATIONS = 260_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    key  = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _PBKDF2_ITERATIONS)
    return f"pbkdf2:sha256:{_PBKDF2_ITERATIONS}:{salt}:{key.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        _, algorithm, iterations, salt, stored_key = stored_hash.split(":", 4)
        key = hashlib.pbkdf2_hmac(algorithm, password.encode(), salt.encode(), int(iterations))
        return hmac.compare_digest(key.hex(), stored_key)
    except Exception:
        return False

# ---------------------------------------------------------------------------
# App Setup
# ---------------------------------------------------------------------------

app = FastAPI(title="USAA Voting API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://usaavotingdemo.vercel.app",
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Auth — signed session tokens (HMAC-SHA256, stdlib only, no JWT library)
#
# Used for two things:
#   1. Admin sessions  -> issued by POST /api/admin/login
#   2. Vote sessions   -> issued by POST /api/verify-otp, required by
#                          POST /api/vote so a ballot can only be cast after
#                          OTP verification, not by guessing a matric number.
# ---------------------------------------------------------------------------

APP_SECRET_KEY = os.getenv("APP_SECRET_KEY")
if not APP_SECRET_KEY:
    # Falls back to a random key so the app still boots, but this means
    # every restart invalidates existing sessions. Set APP_SECRET_KEY in
    # your environment (Render dashboard + local .env) for real use.
    APP_SECRET_KEY = secrets.token_hex(32)
    print("[WARNING] APP_SECRET_KEY is not set. Using a temporary random key — "
          "all admin/vote sessions will be invalidated on restart. "
          "Set APP_SECRET_KEY in your environment for production.")

ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")


def normalize_matric_number(matric_number: str) -> str:
    """
    Canonicalize USAA matric numbers so year-prefixed entries still match.

    Examples:
      20258UGA28109 -> 8UGA28109
      25258UGA27961 -> 8UGA27961
      8UGA28572     -> 8UGA28572
    """
    cleaned = re.sub(r"[\s\-_/]+", "", (matric_number or "").strip().upper())
    match = re.search(r"8UGA[A-Z0-9]+$", cleaned)
    return match.group(0) if match else cleaned


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _b64decode(data: str) -> bytes:
    padded = data + "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(padded)


def _sign(payload_b64: str) -> str:
    sig = hmac.new(APP_SECRET_KEY.encode(), payload_b64.encode(), hashlib.sha256).digest()
    return _b64encode(sig)


def create_token(data: dict, expires_in_seconds: int) -> str:
    payload = {**data, "exp": int(time.time()) + expires_in_seconds}
    payload_b64 = _b64encode(json.dumps(payload).encode())
    return f"{payload_b64}.{_sign(payload_b64)}"


def verify_token(token: str) -> Optional[dict]:
    try:
        payload_b64, signature = token.split(".", 1)
        if not hmac.compare_digest(signature, _sign(payload_b64)):
            return None
        payload = json.loads(_b64decode(payload_b64))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None


def _extract_bearer_token(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
    return authorization[len("Bearer "):].strip()


def require_admin(authorization: Optional[str] = Header(None)):
    """FastAPI dependency: protects admin-only routes with a Bearer token.
    Returns the full token payload so routes can access the admin's username."""
    token   = _extract_bearer_token(authorization)
    payload = verify_token(token)
    if not payload or payload.get("role") != "admin":
        raise HTTPException(status_code=401, detail="Invalid or expired admin session. Please log in again.")
    return payload


def require_vote_session(matric_number: str, authorization: Optional[str] = Header(None)):
    """FastAPI dependency: ensures /api/vote can only be called with a token
    issued by a successful /api/verify-otp call for this exact voter."""
    token = _extract_bearer_token(authorization)
    payload = verify_token(token)
    if not payload or payload.get("purpose") != "vote":
        raise HTTPException(
            status_code=401,
            detail="Voting session is missing or expired. Please verify your OTP again."
        )
    if payload.get("matric_number") != matric_number:
        raise HTTPException(
            status_code=401,
            detail="Voting session does not match this voter."
        )
    return payload


# ---------------------------------------------------------------------------
# Rate limiting — in-memory, process-local. Good enough for a single-dyno
# student election; resets on restart, which only makes limits looser, never
# a security hole. Two things are limited:
#   1. How often a matric_number can request a new OTP (stops inbox spam).
#   2. How many wrong codes a matric_number can try before a code is burned
#      (stops brute-forcing the 6-digit OTP within its 5-minute window).
# ---------------------------------------------------------------------------

OTP_RESEND_COOLDOWN_SECONDS = 55
MAX_OTP_ATTEMPTS = 5

_last_otp_request_at: Dict[str, float] = {}
_otp_attempt_counts: Dict[str, int] = {}


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

DB_URL = os.getenv("DATABASE_URL")

# ---------------------------------------------------------------------------
# Demo mode — set DEMO_MODE=true in this deployment's environment variables
# ONLY on a separate demo instance, never on the real election backend.
#
# When on:
#   • OTPs are returned directly in the API response instead of emailed
#     (no Brevo dependency, no waiting on a real inbox for portfolio
#     visitors).
#   • Logging in with a matric number that doesn't exist auto-creates a
#     fresh demo voter on the spot, instead of 404ing — so every visitor
#     gets their own "voter" to try the flow with, instead of only the
#     first person ever being able to vote.
#   • A reset endpoint (/api/admin/demo/reset) becomes available to wipe
#     all demo votes/state back to a clean slate. This endpoint refuses
#     to run at all unless DEMO_MODE is on, so it can never be hit by
#     accident on the real system.
# ---------------------------------------------------------------------------
DEMO_MODE      = os.getenv("DEMO_MODE", "false").lower() == "true"
DEMO_RESET_KEY = os.getenv("DEMO_RESET_KEY", "")

# ---------------------------------------------------------------------------
# EC contact address — used as Reply-To on every outbound email (OTP,
# confirmation, registration) so that if a voter hits "Reply" in their mail
# client, it goes to a real monitored inbox instead of the Brevo sending
# address (which either doesn't exist as a mailbox, or isn't checked).
# Change this in ONE place if the EC's monitored address ever changes.
# ---------------------------------------------------------------------------
EC_REPLY_TO_EMAIL = "electoralcommissiom231@gmail.com"


def get_db():
    conn = psycopg2.connect(DB_URL)
    try:
        yield conn
    finally:
        conn.close()


def get_election_phase(conn) -> str:
    """
    Single source of truth for what the frontend should currently show:
      - "runoff"  -> runoff voting is open right now
      - "general" -> first-round voting is open right now
      - "closed"  -> nothing is open
    Note: general and runoff never accept votes at the same time in this
    workflow (the EC closes the general election before opening a runoff),
    but if runoff_open is ever TRUE, it always takes priority.
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT election_open, runoff_open FROM System_Settings WHERE id = 1")
        settings = cur.fetchone()

    if not settings:
        return "closed"
    if bool(settings.get("runoff_open")):
        return "runoff"
    if bool(settings.get("election_open")):
        return "general"
    return "closed"


def init_db():
    conn = psycopg2.connect(DB_URL)
    try:
        with conn.cursor() as cur:
            cur.execute("""
                        CREATE TABLE IF NOT EXISTS Voters (
                                                              matric_number    TEXT PRIMARY KEY,
                                                              name             TEXT NOT NULL,
                                                              email            TEXT NOT NULL,
                                                              has_voted        BOOLEAN NOT NULL DEFAULT FALSE
                        )""")

            cur.execute("""
                        CREATE TABLE IF NOT EXISTS OTP_Sessions (
                                                                    matric_number TEXT REFERENCES Voters(matric_number),
                            otp_code      TEXT NOT NULL,
                            expires_at    TIMESTAMP NOT NULL
                            )""")

            cur.execute("""
                        CREATE TABLE IF NOT EXISTS Ballots (
                                                               ballot_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                            president               TEXT,
                            male_vice_president     TEXT,
                            female_vice_president   TEXT,
                            minister_of_finance     TEXT,
                            minister_of_education   TEXT,
                            minister_of_information TEXT,
                            general_secretary       TEXT,
                            cast_at                 TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                            )""")

            cur.execute("""
                        CREATE TABLE IF NOT EXISTS System_Settings (
                                                                       id            INTEGER PRIMARY KEY,
                                                                       election_open BOOLEAN NOT NULL DEFAULT TRUE
                        )""")

            # ── Runoff election support ─────────────────────────────────────
            # Added when the first-round general election produced no 50%+
            # winner for one or more positions. Mirrors the general-election
            # pattern (own "has voted" flag, own anonymous ballots table, own
            # open/close switch) so the original Ballots data stays untouched
            # and fully auditable as the permanent first-round record.
            cur.execute("ALTER TABLE Voters ADD COLUMN IF NOT EXISTS has_voted_runoff BOOLEAN NOT NULL DEFAULT FALSE")
            cur.execute("ALTER TABLE System_Settings ADD COLUMN IF NOT EXISTS runoff_open BOOLEAN NOT NULL DEFAULT FALSE")
            cur.execute("ALTER TABLE System_Settings ADD COLUMN IF NOT EXISTS runoff_started BOOLEAN NOT NULL DEFAULT FALSE")
            # Publishing is a SEPARATE, manual step from closing the runoff —
            # closing just stops accepting votes. Results (tally + winner)
            # only appear on the public results page once the EC explicitly
            # publishes them, so there's no gap between "voting closed" and
            # "official communication sent" where the public link could leak
            # the outcome first.
            cur.execute("ALTER TABLE System_Settings ADD COLUMN IF NOT EXISTS runoff_results_published BOOLEAN NOT NULL DEFAULT FALSE")

            cur.execute("""
                        CREATE TABLE IF NOT EXISTS Runoff_Ballots (
                                                                      ballot_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                                      president             TEXT,
                            minister_of_education TEXT,
                            cast_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                            )""")

            # Per-EC-member admin accounts (replaces shared ADMIN_PASSWORD)
            cur.execute("""
                        CREATE TABLE IF NOT EXISTS Admin_Users (
                                                                   id            SERIAL PRIMARY KEY,
                                                                   username      TEXT UNIQUE NOT NULL,
                                                                   password_hash TEXT NOT NULL,
                                                                   full_name     TEXT NOT NULL,
                                                                   role          TEXT NOT NULL DEFAULT 'ec_member',
                                                                   is_active     BOOLEAN NOT NULL DEFAULT TRUE,
                                                                   created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )""")

            # Audit trail — every sensitive action gets a row
            cur.execute("""
                        CREATE TABLE IF NOT EXISTS Audit_Log (
                                                                 id             SERIAL PRIMARY KEY,
                                                                 admin_username TEXT,
                                                                 action         TEXT NOT NULL,
                                                                 detail         TEXT,
                                                                 ip_address     TEXT,
                                                                 logged_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )""")

            cur.execute("SELECT COUNT(*) FROM System_Settings")
            if cur.fetchone()[0] == 0:
                cur.execute("INSERT INTO System_Settings (id, election_open) VALUES (1, TRUE)")

        conn.commit()

        # Seed a super_admin from ADMIN_PASSWORD env var if no admins exist yet.
        # This preserves backward compatibility — existing deployments get an
        # "admin" account with their current password. Create proper named
        # accounts via the dashboard, then deactivate this one.
        seed_password = os.getenv("ADMIN_PASSWORD")
        if seed_password:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT COUNT(*) as c FROM Admin_Users")
                if cur.fetchone()["c"] == 0:
                    hashed = hash_password(seed_password)
                    cur.execute(
                        """INSERT INTO Admin_Users (username, password_hash, full_name, role)
                           VALUES ('admin', %s, 'System Administrator', 'super_admin')
                               ON CONFLICT (username) DO NOTHING""",
                        (hashed,)
                    )
                    conn.commit()
                    print("[Init] Default super_admin 'admin' seeded from ADMIN_PASSWORD.")

    except Exception as e:
        conn.rollback()
        print(f"[DB Init Error] {e}")
    finally:
        conn.close()


@app.on_event("startup")
def startup_event():
    init_db()


# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------

class OTPRequest(BaseModel):
    matric_number: str    # WhatsApp number is looked up from the DB, never accepted from the request


class OTPVerify(BaseModel):
    matric_number: str
    otp_code: str


class VotePayload(BaseModel):
    matric_number: str
    choices: Dict[str, str]   # keys are dbKey values from constants.ts
    # Individual fields extracted from choices for clarity — all optional
    president:               str = ''
    male_vice_president:     str = ''
    female_vice_president:   str = ''
    minister_of_finance:     str = ''
    minister_of_education:   str = ''
    minister_of_information: str = ''
    general_secretary:       str = ''


class StatusUpdate(BaseModel):
    election_open: bool


# ── Runoff election ──────────────────────────────────────────────────────
# Only President and Minister of Education failed to reach the 50% Vote of
# Confidence threshold in the first round, so the runoff only ever covers
# these two positions. If a future election needs a runoff on a different
# position, add its dbKey to RUNOFF_POSITIONS below and to the
# Runoff_Ballots table (see README "Adding a New Position").
RUNOFF_POSITIONS = ["president", "minister_of_education"]


class RunoffVotePayload(BaseModel):
    matric_number: str
    choices: Dict[str, str] = {}
    president:             str = ''
    minister_of_education: str = ''


class RunoffStatusUpdate(BaseModel):
    runoff_open: bool


class RunoffPublishUpdate(BaseModel):
    publish: bool


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class CreateAdminUserRequest(BaseModel):
    username:  str
    password:  str
    full_name: str
    role:      str = "ec_member"   # "ec_member" or "super_admin"

class ChatMessage(BaseModel):
    message: str = Field(..., min_length=1, max_length=500)


# ---------------------------------------------------------------------------
# Audit log helper
# ---------------------------------------------------------------------------

def log_audit(
        conn,
        action:         str,
        admin_username: str  = "system",
        detail:         str  = None,
        ip_address:     str  = None,
):
    """Insert one row into Audit_Log. Non-fatal — logs to stdout if it fails."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO Audit_Log (admin_username, action, detail, ip_address)
                   VALUES (%s, %s, %s, %s)""",
                (admin_username, action, detail, ip_address),
            )
        conn.commit()
    except Exception as e:
        print(f"[Audit] Failed to write log entry: {e}")


# ---------------------------------------------------------------------------
# Email — Brevo HTTP API (Render free tier blocks outbound SMTP entirely,
# so we use Brevo's HTTPS API instead of smtplib)
# ---------------------------------------------------------------------------

def _otp_html(otp_code: str, voter_name: str = "") -> str:
    LOGO_URL = "https://res.cloudinary.com/dbdgbj4qz/image/upload/v1785014193/logo_lebtcw.png"

    greeting = f"Hello <strong>{voter_name}</strong>," if voter_name else "Hello,"

    return f"""
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;
                    border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;
                    background:#ffffff;">

            <div style="background:#eab308;height:6px;width:100%;"></div>

            <div style="padding:32px 32px 24px;">

                <div style="text-align:center;margin-bottom:28px;">
                    <img
                        src="{LOGO_URL}"
                        alt="NS Logo"
                        width="72"
                        height="72"
                        style="border-radius:50%;border:3px solid #eab308;
                               display:block;margin:0 auto 14px;
                               object-fit:cover;"
                        onerror="this.style.display='none'"
                    />
                    <h2 style="margin:0;color:#18181b;font-size:18px;
                               letter-spacing:2px;text-transform:uppercase;
                               font-weight:900;">
                        U.S.A.A Electoral Commission
                    </h2>
                    <p style="margin:4px 0 0;color:#eab308;font-size:10px;
                              font-weight:bold;letter-spacing:3px;
                              text-transform:uppercase;">
                        'Unitè Triomphe Tout'
                    </p>
                </div>

                <p style="color:#3f3f46;font-size:14px;margin:0 0 6px;">
                    {greeting}
                </p>
                <p style="color:#3f3f46;font-size:14px;margin:0 0 24px;line-height:1.6;">
                    Your one-time verification code for the
                    <strong>U.S.A.A General Election</strong> is:
                </p>

                <div style="background:#18181b;border-radius:12px;
                            padding:24px 16px;margin-bottom:24px;text-align:center;">
                    <p style="margin:0 0 8px;font-size:10px;font-weight:bold;
                              color:#a1a1aa;text-transform:uppercase;letter-spacing:3px;">
                        Verification Code
                    </p>
                    <div style="font-size:42px;font-weight:900;letter-spacing:12px;
                                color:#eab308;font-family:'Courier New',monospace;
                                line-height:1.1;">
                        {otp_code}
                    </div>
                    <p style="margin:10px 0 0;font-size:11px;color:#71717a;
                              font-weight:bold;letter-spacing:1px;">
                        Expires in 5 minutes
                    </p>
                </div>

                <p style="color:#71717a;font-size:12px;
                          margin:0 0 4px;line-height:1.6;">
                    Enter this code on the verification page to access your ballot.
                    Do not share this code with anyone.
                </p>

                <hr style="border:none;border-top:1px solid #f0f0f0;margin:20px 0;">

                <p style="color:#a1a1aa;font-size:11px;
                          text-align:center;margin:0 0 10px;line-height:1.6;">
                    If you did not request this code, someone may have entered
                    your matric number by mistake. You can safely ignore this email.
                </p>
                <p style="color:#a1a1aa;font-size:10px;
                          text-align:center;margin:0;line-height:1.6;font-style:italic;">
                    This is an automated message. Replying to this email will
                    reach the Electoral Commission directly.
                </p>
            </div>

            <div style="background:#18181b;padding:16px 32px;text-align:center;">
                <p style="margin:0;color:#71717a;font-size:11px;">
                    © 2026 U.S.A.A Electoral Committee · Algeria
                </p>
            </div>
        </div>
    """


def _confirmation_html(voter_name: str, ballot_id: str) -> str:
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
                        ✓ &nbsp; Your vote has been recorded
                    </span>
                </div>

                <p style="color:#3f3f46;font-size:14px;margin:0 0 8px;">
                    Hello <strong>{voter_name}</strong>,
                </p>
                <p style="color:#3f3f46;font-size:14px;margin:0 0 20px;line-height:1.6;">
                    Your ballot has been successfully submitted for the
                    <strong>U.S.A.A General Elections</strong>.
                    Your vote is anonymous it cannot be linked back to you by
                    anyone, including the Electoral Commission.
                </p>

                <div style="background:#fafafa;border:2px solid #e4e4e7;border-radius:8px;
                            padding:16px;margin-bottom:24px;">
                    <p style="margin:0 0 6px;font-size:11px;font-weight:bold;
                              color:#71717a;text-transform:uppercase;letter-spacing:1px;">
                        Your Ballot Receipt
                    </p>
                    <p style="margin:0;font-family:monospace;font-size:13px;
                              color:#18181b;word-break:break-all;font-weight:bold;">
                        {ballot_id}
                    </p>
                    <p style="margin:10px 0 0;font-size:12px;color:#71717a;line-height:1.5;">
                        Save this code. After the election closes, you can use it
                        on the public verification page to confirm your ballot was
                        included in the count.
                    </p>
                </div>

                <hr style="border:none;border-top:1px solid #f0f0f0;margin:0 0 20px;">

                <p style="color:#a1a1aa;font-size:12px;text-align:center;margin:0 0 8px;">
                    If you did not vote in this election, contact the Electoral Commission
                    immediately by replying to this email.
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


def send_confirmation_email(receiver_email: str, voter_name: str, ballot_id: str):
    """Send a voting confirmation email with ballot receipt. Non-fatal — logs on failure."""
    api_key      = os.getenv("BREVO_API_KEY")
    sender_email = os.getenv("BREVO_SENDER_EMAIL")

    if not api_key or not sender_email:
        print("[Brevo] Skipping confirmation email — API key not configured.")
        return

    try:
        response = httpx.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={
                "accept":       "application/json",
                "api-key":      api_key,
                "content-type": "application/json",
            },
            json={
                "sender": {
                    "name":  "North Setif Electoral Commission",
                    "email": sender_email,
                },
                "replyTo": {
                    "name":  "North Setif Electoral Commission",
                    "email": EC_REPLY_TO_EMAIL,
                },
                "to":          [{"email": receiver_email, "name": voter_name}],
                "subject":     "✓ Your NS ballot has been received",
                "htmlContent": _confirmation_html(voter_name, ballot_id),
            },
            timeout=10,
        )
        response.raise_for_status()
        print(f"[Brevo] Confirmation sent to {receiver_email}")
    except Exception as e:
        # Non-fatal — the vote is already in the DB. Just log and move on.
        print(f"[Brevo] Confirmation email failed (non-fatal): {e}")


def send_otp_email(receiver_email: str, otp_code: str, voter_name: str = ""):
    """Send OTP via Brevo HTTP API. Raises HTTPException on failure."""
    api_key      = os.getenv("BREVO_API_KEY")
    sender_email = os.getenv("BREVO_SENDER_EMAIL")

    if not api_key or not sender_email:
        print("[Brevo Error] BREVO_API_KEY or BREVO_SENDER_EMAIL not set.")
        raise HTTPException(
            status_code=500,
            detail="Email service is not configured. Contact the administrator."
        )

    try:
        response = httpx.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={
                "accept":       "application/json",
                "api-key":      api_key,
                "content-type": "application/json",
            },
            json={
                "sender": {
                    "name":  "North Setif Electoral Commission",
                    "email": sender_email,
                },
                "replyTo": {
                    "name":  "North Setif Electoral Commission",
                    "email": EC_REPLY_TO_EMAIL,
                },
                "to":          [{"email": receiver_email, "name": voter_name}],
                "subject":     "NS Election — Your Verification Code",
                "htmlContent": _otp_html(otp_code, voter_name),
            },
            timeout=10,
        )
        response.raise_for_status()
        print(f"[Brevo API] OTP sent to {receiver_email}")
    except Exception as e:
        print(f"[Brevo API Error] {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to send OTP email. Please try again."
        )


# ---------------------------------------------------------------------------

def mask_email(email: str) -> str:
    parts = email.split("@")
    local = parts[0]
    if len(local) > 2:
        return f"{local[0]}{'*' * (len(local) - 2)}{local[-1]}@{parts[1]}"
    return email


def demo_provision_voter(conn, matric_number: str):
    """DEMO_MODE only. Auto-creates a voter row on first login attempt for
    a matric number that doesn't exist yet, so every portfolio visitor gets
    their own fresh demo voter instead of only the first-ever visitor being
    able to vote. No-op (returns silently) if the voter already exists."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO Voters (matric_number, name, email, has_voted)
            VALUES (%s, %s, %s, FALSE)
            ON CONFLICT (matric_number) DO NOTHING
            """,
            (
                matric_number,
                f"Demo Voter {matric_number[-4:]}",
                f"{matric_number.lower()}@demo.invalid",
            ),
        )
    conn.commit()


# ---------------------------------------------------------------------------
# Routes — OTP
# ---------------------------------------------------------------------------

@app.post("/api/request-otp")
def request_otp(payload: OTPRequest, conn=Depends(get_db)):
    # Block at the very first step — nobody should be able to log in,
    # let alone reach the voting booth, while the election isn't open.
    # Previously only cast_vote checked this, meaning a voter could log in,
    # verify OTP, and sit in the voting booth before voting officially
    # started — only to be blocked at the final submit step. This closes
    # that gap at the source.
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT election_open, runoff_open FROM System_Settings WHERE id = 1")
        settings = cur.fetchone()

    if not settings or not bool(settings["election_open"]) or bool(settings.get("runoff_open")):
        raise HTTPException(
            status_code=403,
            detail="Voting is closed. The link to the results page will be sent to the NS group"
        )

    matric_number = normalize_matric_number(payload.matric_number)
    now = time.time()
    last_request = _last_otp_request_at.get(matric_number)
    if last_request and (now - last_request) < OTP_RESEND_COOLDOWN_SECONDS:
        wait = int(OTP_RESEND_COOLDOWN_SECONDS - (now - last_request))
        raise HTTPException(
            status_code=429,
            detail=f"Please wait {wait}s before requesting another code."
        )

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT name, email FROM Voters WHERE matric_number = %s",
            (matric_number,)
        )
        voter = cur.fetchone()

    if not voter:
        if DEMO_MODE:
            demo_provision_voter(conn, matric_number)
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "SELECT name, email FROM Voters WHERE matric_number = %s",
                    (matric_number,)
                )
                voter = cur.fetchone()
        if not voter:
            raise HTTPException(status_code=404, detail="Matriculation number not found.")

    email       = voter["email"]
    voter_name  = voter["name"]
    otp_code = str(random.SystemRandom().randint(100000, 999999))
    expires_at = datetime.now() + timedelta(minutes=5)

    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM OTP_Sessions WHERE matric_number = %s",
            (matric_number,)
        )
        cur.execute(
            "INSERT INTO OTP_Sessions (matric_number, otp_code, expires_at) VALUES (%s, %s, %s)",
            (matric_number, otp_code, expires_at),
        )
    conn.commit()

    if DEMO_MODE:
        # No real inbox to deliver to — hand the code straight back so the
        # demo login page can show/auto-fill it.
        _last_otp_request_at[matric_number] = now
        _otp_attempt_counts[matric_number] = 0
        return {
            "status":   "success",
            "message":  "OTP generated (demo mode).",
            "email":    mask_email(email),
            "demo_otp": otp_code,
        }

    # Send email OTP — raises HTTPException if it fails
    send_otp_email(email, otp_code, voter_name)

    # Only mark the cooldown / reset attempts once the email actually sent.
    _last_otp_request_at[matric_number] = now
    _otp_attempt_counts[matric_number] = 0

    return {
        "status":  "success",
        "message": "OTP sent successfully.",
        "email":   mask_email(email),
    }


@app.post("/api/verify-otp")
def verify_otp(payload: OTPVerify, conn=Depends(get_db)):
    # Same guard as request_otp — covers the edge case where an OTP was
    # issued right as the election opened/closed, so a voter can't complete
    # login and reach the voting booth in that narrow window either.
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT election_open, runoff_open FROM System_Settings WHERE id = 1")
        settings = cur.fetchone()

    if not settings or not bool(settings["election_open"]) or bool(settings.get("runoff_open")):
        raise HTTPException(
            status_code=403,
            detail="Voting is not currently open. Please check back when the Electoral Commission opens the election."
        )

    matric_number = normalize_matric_number(payload.matric_number)
    attempts = _otp_attempt_counts.get(matric_number, 0)
    if attempts >= MAX_OTP_ATTEMPTS:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM OTP_Sessions WHERE matric_number = %s",
                (matric_number,)
            )
        conn.commit()
        raise HTTPException(
            status_code=429,
            detail="Too many incorrect attempts. Please request a new code."
        )

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT expires_at FROM OTP_Sessions WHERE matric_number = %s AND otp_code = %s",
            (matric_number, payload.otp_code),
        )
        session = cur.fetchone()

    if not session:
        _otp_attempt_counts[matric_number] = attempts + 1
        raise HTTPException(status_code=401, detail="Invalid OTP code.")

    if datetime.now() > session["expires_at"]:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM OTP_Sessions WHERE matric_number = %s",
                (matric_number,)
            )
        conn.commit()
        raise HTTPException(status_code=401, detail="OTP code has expired.")

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "DELETE FROM OTP_Sessions WHERE matric_number = %s",
            (matric_number,)
        )
        cur.execute(
            "SELECT name, matric_number, has_voted FROM Voters WHERE matric_number = %s",
            (matric_number,),
        )
        voter = cur.fetchone()

    conn.commit()

    _otp_attempt_counts.pop(matric_number, None)

    has_voted = bool(voter["has_voted"])
    response = {
        "status": "success",
        "user": {"name": voter["name"], "matric": voter["matric_number"]},
        "hasVoted": has_voted,
    }

    if not has_voted:
        # Proof that OTP verification actually happened.
        # POST /api/vote requires this token — a ballot cannot be cast
        # just by knowing or guessing a matric number.
        response["voteToken"] = create_token(
            {"matric_number": voter["matric_number"], "purpose": "vote"},
            expires_in_seconds=30 * 60,  # 30 minutes to complete the ballot
        )

    # Ballot choices are no longer returned here.
    # Since ballots are now anonymous UUIDs (no matric_number in the Ballots
    # table), we cannot look up what a specific voter chose — by design.
    # The frontend shows the user's choices from its own in-memory state
    # set at the time of voting (stored in localStorage as userBallot).

    return response


# ---------------------------------------------------------------------------
# Routes — Voting
# ---------------------------------------------------------------------------

@app.post("/api/vote")
def cast_vote(payload: VotePayload, authorization: Optional[str] = Header(None), conn=Depends(get_db)):
    matric_number = normalize_matric_number(payload.matric_number)
    require_vote_session(matric_number, authorization)

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT election_open, runoff_open FROM System_Settings WHERE id = 1")
        settings = cur.fetchone()

    if not settings or not bool(settings["election_open"]) or bool(settings.get("runoff_open")):
        raise HTTPException(status_code=403, detail="The election is currently closed.")

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT has_voted FROM Voters WHERE matric_number = %s",
            (matric_number,)
        )
        voter = cur.fetchone()

    if not voter:
        raise HTTPException(status_code=404, detail="Voter not found.")

    if bool(voter["has_voted"]):
        raise HTTPException(status_code=403, detail="You have already cast your ballot.")

    c = payload.choices
    try:
        with conn.cursor() as cur:
            # Insert the ballot with NO matric_number — a new UUID is generated
            # by Postgres automatically. This makes ballots fully anonymous:
            # even someone with direct DB access cannot connect a voter to
            # their choices because there is no shared key between the two tables.
            cur.execute(
                """
                INSERT INTO Ballots (
                    president,
                    male_vice_president,
                    female_vice_president,
                    minister_of_finance,
                    minister_of_education,
                    minister_of_information,
                    general_secretary
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING ballot_id
                """,
                (
                    c.get("president"),
                    c.get("male_vice_president"),
                    c.get("female_vice_president"),
                    c.get("minister_of_finance"),
                    c.get("minister_of_education"),
                    c.get("minister_of_information"),
                    c.get("general_secretary"),
                ),
            )
            ballot_id = str(cur.fetchone()[0])

            # Mark the voter as having voted — this is the ONLY record that
            # links a matric_number to "a ballot was cast". There is no way
            # to go from this record to the actual ballot choices.
            cur.execute(
                "UPDATE Voters SET has_voted = TRUE WHERE matric_number = %s",
                (matric_number,),
            )
        conn.commit()

        # Audit: records ballot_id only — not matric_number, not choices
        log_audit(conn, "vote_cast", admin_username="voter",
                  detail=f"ballot_id={ballot_id}")

    except Exception as e:
        conn.rollback()
        print(f"[Vote Error] {e}")
        raise HTTPException(status_code=500, detail="Failed to record vote. Please try again.")

    # Fetch voter details for the confirmation email.
    # This runs AFTER the commit so the vote is safe regardless of what happens next.
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT name, email FROM Voters WHERE matric_number = %s",
                (matric_number,)
            )
            voter_details = cur.fetchone()

        if voter_details and not DEMO_MODE:
            send_confirmation_email(
                receiver_email=voter_details["email"],
                voter_name=voter_details["name"],
                ballot_id=ballot_id,
            )
    except Exception as e:
        # Non-fatal — vote is already committed
        print(f"[Confirmation Email] Lookup failed (non-fatal): {e}")

    # Return the ballot_id as the voter's receipt — they can use this to
    # verify their ballot appears in the count after the election closes.
    return {
        "status":    "success",
        "message":   "Vote successfully cast.",
        "ballot_id": ballot_id,
    }


# ---------------------------------------------------------------------------
# Routes — Runoff Election
#
# Separate endpoints, not a "phase" parameter bolted onto the general ones —
# this way the tried-and-tested general-election endpoints above are never
# touched or risked. The frontend asks GET /api/election/phase once to know
# which set of endpoints to call; the pages, routes, and OTP/ballot UX are
# 100% identical either way.
# ---------------------------------------------------------------------------

@app.get("/api/election/phase")
def get_election_phase_route(conn=Depends(get_db)):
    """Public. Tells the frontend whether to talk to the general-election
    or runoff-election endpoints right now."""
    return {"status": "success", "phase": get_election_phase(conn)}


@app.get("/api/demo/status")
def get_demo_status():
    """Public. Lets the frontend know whether this deployment is running in
    demo mode, so it can show the demo banner / auto-fill OTPs / generate a
    random matric number on the login page instead of asking for a real one."""
    return {"status": "success", "demo_mode": DEMO_MODE}


@app.post("/api/admin/demo/reset")
def reset_demo_data(x_demo_reset_key: Optional[str] = Header(None), conn=Depends(get_db)):
    """DEMO MODE ONLY. Wipes all votes and returns the system to a clean,
    freshly-seeded state: every ballot deleted, every voter's has_voted /
    has_voted_runoff cleared, and the election reopened for round one.
    Protected by a shared secret (DEMO_RESET_KEY env var) rather than an
    admin login, so it can be triggered by an external scheduler (cron job,
    GitHub Action, etc.) without storing an admin password anywhere. Refuses
    to run at all unless DEMO_MODE=true — this can never touch the real
    election data even if someone learns the reset key."""
    if not DEMO_MODE:
        raise HTTPException(status_code=403, detail="Demo reset is not available on this deployment.")
    if not DEMO_RESET_KEY or x_demo_reset_key != DEMO_RESET_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing reset key.")

    with conn.cursor() as cur:
        cur.execute("DELETE FROM Ballots")
        cur.execute("DELETE FROM Runoff_Ballots")
        cur.execute("DELETE FROM OTP_Sessions")
        cur.execute("UPDATE Voters SET has_voted = FALSE, has_voted_runoff = FALSE")
        cur.execute("""
            UPDATE System_Settings SET
                election_open             = TRUE,
                runoff_open               = FALSE,
                runoff_started            = FALSE,
                runoff_results_published  = FALSE
            WHERE id = 1
        """)
    conn.commit()

    log_audit(conn, "demo_reset", admin_username="system", detail="Demo data wiped and reset to round-one-open state.")

    return {"status": "success", "message": "Demo data reset."}


@app.post("/api/runoff/request-otp")
def runoff_request_otp(payload: OTPRequest, conn=Depends(get_db)):
    if get_election_phase(conn) != "runoff":
        raise HTTPException(
            status_code=403,
            detail="The runoff election is not currently open."
        )

    matric_number = normalize_matric_number(payload.matric_number)
    now = time.time()
    last_request = _last_otp_request_at.get(matric_number)
    if last_request and (now - last_request) < OTP_RESEND_COOLDOWN_SECONDS:
        wait = int(OTP_RESEND_COOLDOWN_SECONDS - (now - last_request))
        raise HTTPException(
            status_code=429,
            detail=f"Please wait {wait}s before requesting another code."
        )

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT name, email FROM Voters WHERE matric_number = %s",
            (matric_number,)
        )
        voter = cur.fetchone()

    if not voter:
        if DEMO_MODE:
            demo_provision_voter(conn, matric_number)
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "SELECT name, email FROM Voters WHERE matric_number = %s",
                    (matric_number,)
                )
                voter = cur.fetchone()
        if not voter:
            raise HTTPException(status_code=404, detail="Matriculation number not found.")

    email      = voter["email"]
    voter_name = voter["name"]
    otp_code   = str(random.SystemRandom().randint(100000, 999999))
    expires_at = datetime.now() + timedelta(minutes=5)

    with conn.cursor() as cur:
        cur.execute("DELETE FROM OTP_Sessions WHERE matric_number = %s", (matric_number,))
        cur.execute(
            "INSERT INTO OTP_Sessions (matric_number, otp_code, expires_at) VALUES (%s, %s, %s)",
            (matric_number, otp_code, expires_at),
        )
    conn.commit()

    _last_otp_request_at[matric_number] = now
    _otp_attempt_counts[matric_number] = 0

    if DEMO_MODE:
        return {
            "status":   "success",
            "message":  "OTP generated (demo mode).",
            "email":    mask_email(email),
            "demo_otp": otp_code,
        }

    send_otp_email(email, otp_code, voter_name)

    return {"status": "success", "message": "OTP sent successfully.", "email": mask_email(email)}


@app.post("/api/runoff/verify-otp")
def runoff_verify_otp(payload: OTPVerify, conn=Depends(get_db)):
    if get_election_phase(conn) != "runoff":
        raise HTTPException(
            status_code=403,
            detail="The runoff election is not currently open."
        )

    matric_number = normalize_matric_number(payload.matric_number)
    attempts = _otp_attempt_counts.get(matric_number, 0)
    if attempts >= MAX_OTP_ATTEMPTS:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM OTP_Sessions WHERE matric_number = %s", (matric_number,))
        conn.commit()
        raise HTTPException(status_code=429, detail="Too many incorrect attempts. Please request a new code.")

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT expires_at FROM OTP_Sessions WHERE matric_number = %s AND otp_code = %s",
            (matric_number, payload.otp_code),
        )
        session = cur.fetchone()

    if not session:
        _otp_attempt_counts[matric_number] = attempts + 1
        raise HTTPException(status_code=401, detail="Invalid OTP code.")

    if datetime.now() > session["expires_at"]:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM OTP_Sessions WHERE matric_number = %s", (matric_number,))
        conn.commit()
        raise HTTPException(status_code=401, detail="OTP code has expired.")

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("DELETE FROM OTP_Sessions WHERE matric_number = %s", (matric_number,))
        cur.execute(
            "SELECT name, matric_number, has_voted_runoff FROM Voters WHERE matric_number = %s",
            (matric_number,),
        )
        voter = cur.fetchone()
    conn.commit()

    _otp_attempt_counts.pop(matric_number, None)

    has_voted = bool(voter["has_voted_runoff"])
    response = {
        "status": "success",
        "user":   {"name": voter["name"], "matric": voter["matric_number"]},
        "hasVoted": has_voted,
    }

    if not has_voted:
        response["voteToken"] = create_token(
            {"matric_number": voter["matric_number"], "purpose": "vote_runoff"},
            expires_in_seconds=30 * 60,
        )

    return response


def require_runoff_vote_session(matric_number: str, authorization: Optional[str] = Header(None)):
    token = _extract_bearer_token(authorization)
    payload = verify_token(token)
    if not payload or payload.get("purpose") != "vote_runoff":
        raise HTTPException(
            status_code=401,
            detail="Runoff voting session is missing or expired. Please verify your OTP again."
        )
    if payload.get("matric_number") != matric_number:
        raise HTTPException(status_code=401, detail="Voting session does not match this voter.")
    return payload


@app.post("/api/runoff/vote")
def cast_runoff_vote(payload: RunoffVotePayload, authorization: Optional[str] = Header(None), conn=Depends(get_db)):
    matric_number = normalize_matric_number(payload.matric_number)
    require_runoff_vote_session(matric_number, authorization)

    if get_election_phase(conn) != "runoff":
        raise HTTPException(status_code=403, detail="The runoff election is currently closed.")

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT has_voted_runoff FROM Voters WHERE matric_number = %s", (matric_number,))
        voter = cur.fetchone()

    if not voter:
        raise HTTPException(status_code=404, detail="Voter not found.")
    if bool(voter["has_voted_runoff"]):
        raise HTTPException(status_code=403, detail="You have already cast your runoff ballot.")

    c = payload.choices or {}
    president             = c.get("president", payload.president)
    minister_of_education = c.get("minister_of_education", payload.minister_of_education)

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO Runoff_Ballots (president, minister_of_education)
                VALUES (%s, %s)
                RETURNING ballot_id
                """,
                (president, minister_of_education),
            )
            ballot_id = str(cur.fetchone()[0])

            cur.execute(
                "UPDATE Voters SET has_voted_runoff = TRUE WHERE matric_number = %s",
                (matric_number,),
            )
        conn.commit()

        log_audit(conn, "runoff_vote_cast", admin_username="voter", detail=f"ballot_id={ballot_id}")

    except Exception as e:
        conn.rollback()
        print(f"[Runoff Vote Error] {e}")
        raise HTTPException(status_code=500, detail="Failed to record vote. Please try again.")

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT name, email FROM Voters WHERE matric_number = %s", (matric_number,))
            voter_details = cur.fetchone()
        if voter_details and not DEMO_MODE:
            send_confirmation_email(
                receiver_email=voter_details["email"],
                voter_name=voter_details["name"],
                ballot_id=ballot_id,
            )
    except Exception as e:
        print(f"[Runoff Confirmation Email] Lookup failed (non-fatal): {e}")

    return {"status": "success", "message": "Runoff vote successfully cast.", "ballot_id": ballot_id}


# ---------------------------------------------------------------------------
# Routes — Results & Admin
# ---------------------------------------------------------------------------

@app.get("/api/results/turnout")
def get_turnout(conn=Depends(get_db)):
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT COUNT(*) as count FROM Voters")
        total = cur.fetchone()["count"]

        cur.execute("SELECT COUNT(*) as count FROM Voters WHERE has_voted = TRUE")
        voted = cur.fetchone()["count"]

        # total_ballots_cast is counted directly from the Ballots table — the
        # same source every position's tally comes from. Using this instead
        # of `voted` (from Voters.has_voted) avoids the two numbers silently
        # diverging, which previously caused impossible percentages (e.g.
        # 250%) and a mismatched "votes cast" stat on the admin dashboard.
        cur.execute("SELECT COUNT(*) as ballot_count FROM Ballots")
        total_ballots_cast = cur.fetchone()["ballot_count"]

    percentage = round((voted / total) * 100) if total > 0 else 0
    return {
        "status": "success",
        "total_eligible": total,
        "votes_cast": voted,
        "total_ballots_cast": total_ballots_cast,
        "turnout_percentage": percentage,
    }


@app.get("/api/results/runoff-turnout")
def get_runoff_turnout_public(conn=Depends(get_db)):
    """Public, live runoff turnout numbers — same visibility rule as the
    general election's /api/results/turnout: turnout counts are never
    secret, only candidate-level tallies are held back until closed."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT runoff_started FROM System_Settings WHERE id = 1")
        settings = cur.fetchone() or {}

    if not bool(settings.get("runoff_started")):
        return {"status": "success", "started": False}

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT COUNT(*) as count FROM Voters")
        total = cur.fetchone()["count"]
        cur.execute("SELECT COUNT(*) as count FROM Voters WHERE has_voted_runoff = TRUE")
        voted = cur.fetchone()["count"]
        cur.execute("SELECT COUNT(*) as ballot_count FROM Runoff_Ballots")
        total_ballots_cast = cur.fetchone()["ballot_count"]

    percentage = round((voted / total) * 100) if total > 0 else 0
    return {
        "status": "success",
        "started": True,
        "total_eligible": total,
        "votes_cast": voted,
        "total_ballots_cast": total_ballots_cast,
        "turnout_percentage": percentage,
    }


@app.get("/api/admin/integrity-check")
def pre_election_integrity_check(conn=Depends(get_db), admin=Depends(require_admin)):
    """
    Runs a set of database integrity checks to catch registration fraud
    before the election opens. Returns flagged issues the EC should
    investigate. Safe to run multiple times.
    """
    issues = []

    with conn.cursor(cursor_factory=RealDictCursor) as cur:

        # ── Check 1: Duplicate emails ──────────────────────────────────────
        cur.execute("""
                    SELECT LOWER(email) as email,
                           COUNT(*) as count,
                   array_agg(matric_number ORDER BY matric_number) as matric_numbers,
                   array_agg(name ORDER BY matric_number) as names
                    FROM Voters
                    GROUP BY LOWER(email)
                    HAVING COUNT(*) > 1
                    ORDER BY count DESC
                    """)
        dup_emails = cur.fetchall()
        for row in dup_emails:
            issues.append({
                "type":    "duplicate_email",
                "severity": "high",
                "detail":  f"Email '{row['email']}' is registered under "
                           f"{row['count']} matric numbers: "
                           f"{', '.join(row['matric_numbers'])} "
                           f"({', '.join(row['names'])})",
                "matric_numbers": list(row['matric_numbers']),
                "email":   row['email'],
            })

        # ── Check 2: Duplicate names ───────────────────────────────────────
        cur.execute("""
                    SELECT LOWER(TRIM(name)) as norm_name,
                           COUNT(*) as count,
                   array_agg(matric_number ORDER BY matric_number) as matric_numbers,
                   array_agg(email ORDER BY matric_number) as emails
                    FROM Voters
                    GROUP BY LOWER(TRIM(name))
                    HAVING COUNT(*) > 1
                    ORDER BY count DESC
                        LIMIT 50
                    """)
        dup_names = cur.fetchall()
        for row in dup_names:
            issues.append({
                "type":    "duplicate_name",
                "severity": "medium",
                "detail":  f"Name '{row['norm_name']}' appears {row['count']} times: "
                           f"{', '.join(row['matric_numbers'])} "
                           f"({', '.join(row['emails'])})",
                "matric_numbers": list(row['matric_numbers']),
            })

        # ── Check 3: has_voted summary ─────────────────────────────────────
        cur.execute("SELECT COUNT(*) as total FROM Voters")
        total = cur.fetchone()["total"]

        cur.execute("SELECT COUNT(*) as voted FROM Voters WHERE has_voted = TRUE")
        voted = cur.fetchone()["voted"]

        # ── Check 4: Orphaned ballot UUIDs (ballots with no matching voter) ─
        cur.execute("SELECT COUNT(*) as ballot_count FROM Ballots")
        ballot_count = cur.fetchone()["ballot_count"]

    log_audit(conn, "integrity_check_run",
              admin_username=admin.get("username", "unknown"),
              detail=f"{len(issues)} issues found, {total} voters, {ballot_count} ballots")

    return {
        "status":       "success",
        "total_voters": total,
        "voted_count":  voted,
        "ballot_count": ballot_count,
        "issue_count":  len(issues),
        "issues":       issues,
        "safe_to_open": len([i for i in issues if i["severity"] == "high"]) == 0,
    }

@app.get("/api/public/results")
def get_public_results(conn=Depends(get_db)):
    """
    Returns the full tally + turnout ONLY after the election is closed.
    While open, returns a status of 'in_progress' with no vote data.
    This endpoint requires no authentication — it is intentionally public.
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT election_open FROM System_Settings WHERE id = 1")
        settings = cur.fetchone()

    election_open = bool(settings["election_open"]) if settings else True

    if election_open:
        return {
            "status":  "in_progress",
            "message": "The election is still in progress. Results will be published once voting closes.",
        }

    # Turnout — total_eligible and votes_cast come from Voters, used for the
    # public "turnout %" display only.
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT COUNT(*) as total FROM Voters")
        total = cur.fetchone()["total"]
        cur.execute("SELECT COUNT(*) as cast FROM Voters WHERE has_voted = TRUE")
        cast = cur.fetchone()["cast"]

        # total_ballots_cast is the SAME table every position's tally below
        # is computed from. This is the number the frontend must use for
        # any per-position percentage or 50% threshold — using `cast` above
        # (sourced from Voters.has_voted) instead can silently diverge from
        # the real ballot count (e.g. test data, manual DB edits), producing
        # impossible percentages like 250%. Ballots is the single source of
        # truth for actual votes cast.
        cur.execute("SELECT COUNT(*) as ballot_count FROM Ballots")
        total_ballots_cast = cur.fetchone()["ballot_count"]

    # Full tally per position
    positions = [
        "president", "male_vice_president", "female_vice_president",
        "minister_of_finance", "minister_of_education",
        "minister_of_information", "general_secretary",
    ]
    tally = {}
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        for pos in positions:
            cur.execute(
                f"SELECT {pos} as candidate_id, COUNT(*) as votes "
                f"FROM Ballots WHERE {pos} IS NOT NULL AND {pos} != '' "
                f"GROUP BY {pos} ORDER BY votes DESC",
            )
            tally[pos] = [
                {"candidate_id": row["candidate_id"], "votes": row["votes"]}
                for row in cur.fetchall()
            ]

    # ── Runoff — only ever populated for President & Minister of Education ──
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT runoff_open, runoff_started, runoff_results_published FROM System_Settings WHERE id = 1")
        rsettings = cur.fetchone() or {}

    runoff_open      = bool(rsettings.get("runoff_open"))
    runoff_started   = bool(rsettings.get("runoff_started"))
    runoff_published = bool(rsettings.get("runoff_results_published"))

    runoff_payload = {
        "active":    runoff_started,
        "open":      runoff_open,
        "published": runoff_published,
        "positions": RUNOFF_POSITIONS,
        "results":   None,
        "turnout":   None,
    }

    # Turnout is live/public the moment a runoff starts — same as the general
    # election's turnout being visible while voting is still open. Only the
    # candidate-level tally is held back until the EC explicitly publishes it.
    if runoff_started:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT COUNT(*) as voted FROM Voters WHERE has_voted_runoff = TRUE")
            runoff_voted = cur.fetchone()["voted"]
            cur.execute("SELECT COUNT(*) as ballot_count FROM Runoff_Ballots")
            runoff_ballot_count = cur.fetchone()["ballot_count"]

        runoff_payload["turnout"] = {
            "total_eligible":     total,
            "votes_cast":         runoff_voted,
            "total_ballots_cast": runoff_ballot_count,
            "turnout_percentage": round((runoff_voted / total * 100)) if total > 0 else 0,
        }

    # Only reveal the runoff TALLY once the EC has explicitly PUBLISHED it —
    # closing the runoff (runoff_open = False) on its own reveals nothing.
    # This is deliberately a manual, separate step so there's never a gap
    # where the public link shows the outcome before official communication
    # goes out.
    if runoff_started and not runoff_open and runoff_published:
        runoff_tally = {}
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            for pos in RUNOFF_POSITIONS:
                cur.execute(
                    f"SELECT {pos} as candidate_id, COUNT(*) as votes "
                    f"FROM Runoff_Ballots WHERE {pos} IS NOT NULL AND {pos} != '' "
                    f"GROUP BY {pos} ORDER BY votes DESC",
                )
                runoff_tally[pos] = [
                    {"candidate_id": row["candidate_id"], "votes": row["votes"]}
                    for row in cur.fetchall()
                ]

        runoff_payload["results"] = runoff_tally

    return {
        "status": "closed",
        "turnout": {
            "total_eligible":     total,
            "votes_cast":         cast,
            "total_ballots_cast": total_ballots_cast,
            "turnout_percentage": round((cast / total * 100)) if total > 0 else 0,
        },
        "results": tally,
        "runoff":  runoff_payload,
    }


@app.get("/api/verify-ballot/{ballot_id}")
def verify_ballot(ballot_id: str, conn=Depends(get_db)):
    """
    Checks whether a ballot with this UUID was recorded, in EITHER the
    general-election or runoff-election ballots table — a voter's receipt
    from either round works in the same verification box.
    Returns ONLY a boolean — never reveals vote choices.
    Anonymity is preserved: neither ballots table has a matric_number column.
    """
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT ballot_id FROM Ballots WHERE ballot_id = %s::uuid",
                (ballot_id.strip(),)
            )
            found = cur.fetchone()
            if not found:
                cur.execute(
                    "SELECT ballot_id FROM Runoff_Ballots WHERE ballot_id = %s::uuid",
                    (ballot_id.strip(),)
                )
                found = cur.fetchone()
        return {"status": "success", "counted": found is not None}
    except Exception:
        # Invalid UUID format — treat as not found
        return {"status": "success", "counted": False}


@app.post("/api/admin/login")
def admin_login(payload: AdminLoginRequest, request: Request, conn=Depends(get_db)):
    ip = request.client.host if request.client else None

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT * FROM Admin_Users WHERE username = %s AND is_active = TRUE",
            (payload.username.strip(),)
        )
        admin = cur.fetchone()

    if not admin or not verify_password(payload.password, admin["password_hash"]):
        # Log failed attempt (non-fatal)
        try:
            log_audit(conn, "admin_login_failed",
                      admin_username=payload.username,
                      detail="Incorrect username or password",
                      ip_address=ip)
        except Exception:
            pass
        raise HTTPException(status_code=401, detail="Incorrect username or password.")

    token = create_token(
        {
            "role":      "admin",
            "username":  admin["username"],
            "full_name": admin["full_name"],
            "user_role": admin["role"],          # "super_admin" or "ec_member"
        },
        expires_in_seconds=8 * 3600,
    )

    log_audit(conn, "admin_login",
              admin_username=admin["username"],
              detail=f"Role: {admin['role']}",
              ip_address=ip)

    return {
        "status":    "success",
        "token":     token,
        "username":  admin["username"],
        "full_name": admin["full_name"],
        "user_role": admin["role"],
    }


@app.get("/api/admin/tally")
def get_vote_tally(conn=Depends(get_db), _admin=Depends(require_admin)):
    positions = [
        "president",
        "male_vice_president",
        "female_vice_president",
        "minister_of_finance",
        "minister_of_education",
        "minister_of_information",
        "general_secretary",
    ]
    results = {}

    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        for pos in positions:
            cur.execute(
                f"SELECT {pos}, COUNT(*) as votes FROM Ballots "
                f"WHERE {pos} IS NOT NULL AND {pos} != '' GROUP BY {pos}",
            )
            results[pos] = [
                {"candidate_id": row[pos], "votes": row["votes"]}
                for row in cur.fetchall()
            ]

    return {"status": "success", "data": results}


@app.get("/api/admin/status")
def get_status(conn=Depends(get_db), _admin=Depends(require_admin)):
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT election_open FROM System_Settings WHERE id = 1")
        settings = cur.fetchone()

    return {
        "status": "success",
        "election_open": bool(settings["election_open"]) if settings else True,
    }


@app.post("/api/admin/status")
def update_status(payload: StatusUpdate, request: Request, conn=Depends(get_db), admin=Depends(require_admin)):
    # General and runoff voting are never allowed open at the same time —
    # a voter's login/vote could otherwise land on either ballot depending
    # on timing, and one could vote in both. Closing is always allowed;
    # only OPENING is blocked while the other is open.
    if payload.election_open:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT runoff_open FROM System_Settings WHERE id = 1")
            settings = cur.fetchone() or {}
        if bool(settings.get("runoff_open")):
            raise HTTPException(
                status_code=409,
                detail="The runoff election is currently open. Close the runoff before reopening the general election."
            )

    with conn.cursor() as cur:
        cur.execute(
            "UPDATE System_Settings SET election_open = %s WHERE id = 1",
            (payload.election_open,),
        )
    conn.commit()

    action = "election_opened" if payload.election_open else "election_closed"
    log_audit(conn, action,
              admin_username=admin.get("username", "unknown"),
              ip_address=request.client.host if request.client else None)

    return {"status": "success", "election_open": payload.election_open}


def require_super_admin(admin=Depends(require_admin)):
    if admin.get("user_role") != "super_admin":
        raise HTTPException(
            status_code=403,
            detail="Only super admins can manage EC member accounts."
        )
    return admin


# ---------------------------------------------------------------------------
# Runoff Election — Admin controls
# ---------------------------------------------------------------------------

@app.get("/api/admin/runoff/status")
def get_runoff_status(conn=Depends(get_db), _admin=Depends(require_admin)):
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT runoff_open, runoff_started, runoff_results_published FROM System_Settings WHERE id = 1")
        settings = cur.fetchone() or {}
    return {
        "status":                   "success",
        "runoff_open":              bool(settings.get("runoff_open")),
        "runoff_started":           bool(settings.get("runoff_started")),
        "runoff_results_published": bool(settings.get("runoff_results_published")),
        "positions":                RUNOFF_POSITIONS,
    }


@app.post("/api/admin/runoff/status")
def update_runoff_status(payload: RunoffStatusUpdate, request: Request, conn=Depends(get_db), admin=Depends(require_super_admin)):
    """Open or close the runoff election. Super admin only — same authority
    level as opening/closing the general election. Opening the runoff for
    the first time also permanently flips runoff_started to TRUE, which is
    what unlocks the runoff results/tally being shown at all."""
    # Same mutual-exclusion rule as update_status above, checked from the
    # other side: don't allow opening the runoff while general voting is
    # still open.
    if payload.runoff_open:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT election_open FROM System_Settings WHERE id = 1")
            settings = cur.fetchone() or {}
        if bool(settings.get("election_open")):
            raise HTTPException(
                status_code=409,
                detail="The general election is currently open. Close it before opening the runoff."
            )

    with conn.cursor() as cur:
        # Re-opening the runoff (e.g. to fix a mistake) automatically
        # un-publishes any previously published results — they'd otherwise
        # be stale/wrong the moment a new vote comes in.
        cur.execute(
            "UPDATE System_Settings SET runoff_open = %s, "
            "runoff_started = runoff_started OR %s, "
            "runoff_results_published = CASE WHEN %s THEN FALSE ELSE runoff_results_published END "
            "WHERE id = 1",
            (payload.runoff_open, payload.runoff_open, payload.runoff_open),
        )
    conn.commit()

    action = "runoff_opened" if payload.runoff_open else "runoff_closed"
    log_audit(conn, action,
              admin_username=admin.get("username", "unknown"),
              ip_address=request.client.host if request.client else None)

    return {"status": "success", "runoff_open": payload.runoff_open}


@app.post("/api/admin/runoff/publish")
def publish_runoff_results(payload: RunoffPublishUpdate, request: Request, conn=Depends(get_db), admin=Depends(require_super_admin)):
    """Show/hide the runoff tally and winner on the PUBLIC results page.
    Deliberately separate from opening/closing the runoff: closing just
    stops accepting votes — it does NOT reveal anything publicly. Results
    only appear once this is explicitly flipped on, so the EC can close
    voting, review the tally privately (via /api/admin/runoff/tally), send
    out official communication, and only then make it public — with no
    window where the public link could show the outcome first."""
    if payload.publish:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT runoff_open FROM System_Settings WHERE id = 1")
            settings = cur.fetchone() or {}
        if bool(settings.get("runoff_open")):
            raise HTTPException(
                status_code=409,
                detail="Close the runoff before publishing its results."
            )

    with conn.cursor() as cur:
        cur.execute(
            "UPDATE System_Settings SET runoff_results_published = %s WHERE id = 1",
            (payload.publish,),
        )
    conn.commit()

    action = "runoff_results_published" if payload.publish else "runoff_results_unpublished"
    log_audit(conn, action,
              admin_username=admin.get("username", "unknown"),
              ip_address=request.client.host if request.client else None)

    return {"status": "success", "runoff_results_published": payload.publish}


@app.get("/api/admin/runoff/tally")
def get_runoff_tally(conn=Depends(get_db), _admin=Depends(require_admin)):
    results = {}
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        for pos in RUNOFF_POSITIONS:
            cur.execute(
                f"SELECT {pos}, COUNT(*) as votes FROM Runoff_Ballots "
                f"WHERE {pos} IS NOT NULL AND {pos} != '' GROUP BY {pos}",
            )
            results[pos] = [
                {"candidate_id": row[pos], "votes": row["votes"]}
                for row in cur.fetchall()
            ]
    return {"status": "success", "data": results}


@app.get("/api/admin/runoff/turnout")
def get_runoff_turnout(conn=Depends(get_db), _admin=Depends(require_admin)):
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT COUNT(*) as count FROM Voters")
        total = cur.fetchone()["count"]
        cur.execute("SELECT COUNT(*) as count FROM Voters WHERE has_voted_runoff = TRUE")
        voted = cur.fetchone()["count"]
        cur.execute("SELECT COUNT(*) as ballot_count FROM Runoff_Ballots")
        total_ballots_cast = cur.fetchone()["ballot_count"]

    percentage = round((voted / total) * 100) if total > 0 else 0
    return {
        "status": "success",
        "total_eligible": total,
        "votes_cast": voted,
        "total_ballots_cast": total_ballots_cast,
        "turnout_percentage": percentage,
    }


# ---------------------------------------------------------------------------
# EC Member management  (super_admin only)
# ---------------------------------------------------------------------------

@app.get("/api/admin/users")
def list_admin_users(conn=Depends(get_db), _admin=Depends(require_admin)):
    """List all EC member accounts. Available to all admins."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT id, username, full_name, role, is_active, created_at "
            "FROM Admin_Users ORDER BY created_at ASC"
        )
        users = cur.fetchall()
    return {"status": "success", "users": [dict(u) for u in users]}


@app.post("/api/admin/users")
def create_admin_user(
        payload: CreateAdminUserRequest,
        request: Request,
        conn=Depends(get_db),
        admin=Depends(require_super_admin),
):
    """Create a new EC member account. Super admin only."""
    if payload.role not in ("ec_member", "super_admin"):
        raise HTTPException(status_code=400, detail="Role must be 'ec_member' or 'super_admin'.")

    hashed = hash_password(payload.password)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """INSERT INTO Admin_Users (username, password_hash, full_name, role)
                   VALUES (%s, %s, %s, %s) RETURNING id""",
                (payload.username.strip(), hashed, payload.full_name.strip(), payload.role)
            )
            new_id = cur.fetchone()["id"]
        conn.commit()
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise HTTPException(status_code=409, detail=f"Username '{payload.username}' already exists.")

    log_audit(conn, "admin_user_created",
              admin_username=admin["username"],
              detail=f"Created {payload.role} '{payload.username}' ({payload.full_name})",
              ip_address=request.client.host if request.client else None)

    return {"status": "success", "id": new_id, "message": f"Account '{payload.username}' created."}


@app.patch("/api/admin/users/{user_id}")
def toggle_admin_user(
        user_id: int,
        request: Request,
        conn=Depends(get_db),
        admin=Depends(require_super_admin),
):
    """Activate or deactivate an EC member account. Super admin only.
    A super_admin cannot deactivate their own account."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM Admin_Users WHERE id = %s", (user_id,))
        target = cur.fetchone()

    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    if target["username"] == admin["username"]:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account.")

    new_status = not target["is_active"]
    with conn.cursor() as cur:
        cur.execute("UPDATE Admin_Users SET is_active = %s WHERE id = %s", (new_status, user_id))
    conn.commit()

    action = "admin_user_activated" if new_status else "admin_user_deactivated"
    log_audit(conn, action,
              admin_username=admin["username"],
              detail=f"User '{target['username']}' ({target['full_name']})",
              ip_address=request.client.host if request.client else None)

    return {
        "status":    "success",
        "is_active": new_status,
        "message":   f"Account '{target['username']}' {'activated' if new_status else 'deactivated'}."
    }


# ---------------------------------------------------------------------------
# Audit log viewer
# ---------------------------------------------------------------------------

@app.get("/api/admin/audit-log")
def get_audit_log(conn=Depends(get_db), _admin=Depends(require_admin)):
    """Return the last 200 audit log entries, newest first."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT id, admin_username, action, detail, ip_address, logged_at "
            "FROM Audit_Log ORDER BY logged_at DESC LIMIT 200"
        )
        rows = cur.fetchall()
    return {"status": "success", "log": [dict(r) for r in rows]}

# ---------------------------------------------------------------------------
# Election Assistant Bot
# ---------------------------------------------------------------------------
@app.post("/api/chat")
def chat_assistant(payload: ChatMessage):
    """
    Rule-based Election Assistant. Matches on keywords in priority order —
    more specific / escalation-worthy patterns are checked first so they
    aren't accidentally caught by a more generic rule below them.
    """
    msg = payload.message.lower().strip()

    EC_EMAIL = EC_REPLY_TO_EMAIL

    def contains_any(words):
        return any(w in msg for w in words)

    reply = None

    # ── 1. ESCALATION: persistent OTP issues ────────────────────────────────
    if contains_any(["otp", "code", "email", "spam"]) and \
            contains_any(["still", "already", "can't", "cant", "tried", "nothing", "not working", "not received"]):
        reply = (
            f"Since you've already checked spam and tried resending, there may be a typo in your "
            f"registered email address. Please contact the Electoral Commission directly at "
            f"{EC_EMAIL} with your matriculation number so they can verify and correct it."
        )

    # ── 2. Standard OTP / login help ────────────────────────────────────────
    elif contains_any(["otp", "verification code", "code", "spam", "resend"]):
        reply = (
            "If you haven't received your 6-digit OTP, first check your spam or junk folder. "
            "If it's not there, wait 55 seconds and tap 'Resend Code'. The code expires after "
            "5 minutes, and you get up to 5 attempts to enter it correctly before needing a new one."
        )

    # ── 3. Invalid / wrong OTP entered ──────────────────────────────────────
    elif contains_any(["invalid", "wrong code", "incorrect code", "doesn't work", "does not work"]) and "otp" in msg or \
            contains_any(["invalid otp", "wrong otp", "incorrect otp"]):
        reply = (
            "Make sure you're entering the MOST RECENT code, if you requested more than one, "
            "only the last one is valid. Double-check all 6 digits. If it's been more than 5 "
            "minutes since you received it, it has expired tap 'Resend Code' for a fresh one."
        )

    # ── 4. Matric number not found / login issues ───────────────────────────
    elif contains_any(["matric", "matriculation", "not found", "doesn't recognize", "not registered"]):
        reply = (
            "If your matriculation number isn't being recognized, double-check for typos it's "
            "not case-sensitive but spacing matters (e.g. no extra spaces before/after). If you're "
            "sure it's correct and it still says 'not found', you may not be on the registered "
            f"voter list yet. Contact the Electoral Commission at {EC_EMAIL} to confirm your registration."
        )

    # ── 5. Already voted (potential integrity concern — take seriously) ────
    elif contains_any(["already voted", "already cast", "says i voted", "haven't voted", "havent voted"]):
        reply = (
            "If the system says you've already voted but you're certain you haven't, this needs "
            f"immediate attention. Please contact the Electoral Commission at {EC_EMAIL} right away "
            "with your matriculation number. Every vote is logged with a timestamp, so the EC can "
            "investigate exactly what happened."
        )

    # ── 6. Anonymity / privacy concerns ──────────────────────────────────────
    elif contains_any(["anonymous", "anonymity", "privacy", "who i voted", "see my vote", "trace my vote", "linked to me"]):
        reply = (
            "Your vote is fully anonymous. When you vote, your ballot is stored with a random, "
            "unique code not your matriculation number. There is no record anywhere in the system "
            "that links your identity to your specific choices, so nobody even the Electoral "
            "Commission, can see who you voted for."
        )

    # ── 7. Ballot receipt / verification ──────────────────────────────────────
    elif contains_any(["receipt", "verify", "uuid", "confirm my vote", "was my vote counted", "counted"]):
        reply = (
            "After voting, you receive a unique receipt code (a long string like "
            "'c8a428a8-aba5-...'). Once the Electoral Commission closes the election, go to the "
            "public results page and paste that code into the 'Verify Your Ballot' box. It will "
            "confirm whether your ballot was counted  without revealing your actual choices. "
            "Keep your receipt code safe (screenshot it) right after you vote, since it's only "
            "shown once."
        )

    # ── 8. Results, tally, winners ──────────────────────────────────────────
    elif contains_any(["result", "tally", "winner", "close", "publish", "when will", "announce"]):
        reply = (
            "Results are strictly confidential while voting is open — this protects the election "
            "from being influenced mid-vote. Once the Electoral Commission officially closes the "
            "polls, the full tally, turnout, and winners for all 7 positions automatically appear at: "
            "https://usaavoting.com/election-results — no login needed to view it."
        )

    # ── 9. Unopposed candidates / abstention / blank votes ──────────────────
    elif contains_any(["unopposed", "blank", "skip", "abstain", "abstention", "one candidate"]):
        reply = (
            "For any position, you can leave your selection blank if you don't wish to vote for a "
            "particular candidate this counts as an abstention, not an error. Note that even an "
            "unopposed candidate must still secure enough of the vote to be confirmed, based on the "
            "Electoral Commission's rules for that position."
        )

    # ── 10. Session expired / logged out ────────────────────────────────────
    elif contains_any(["session expired", "logged out", "signed out", "keeps logging", "session ended"]):
        reply = (
            "Voter sessions automatically expire after 12 hours for security — this protects your "
            "vote if you ever leave your phone unattended. Simply log in again with your "
            "matriculation number and you'll get a fresh OTP code."
        )

    # ── 11. Changing / editing a submitted vote ─────────────────────────────
    elif contains_any(["change my vote", "edit my vote", "made a mistake", "wrong candidate", "undo"]):
        reply = (
            "Once you confirm and submit your ballot, it cannot be changed or undone — this is by "
            "design, to protect the integrity of the election. Before you submit, a confirmation "
            "screen shows all 7 of your selections so you can review them carefully first. Take "
            "your time on that screen before tapping 'Yes, Submit My Ballot'."
        )

    # ── 12. Voting from abroad / outside Algeria ────────────────────────────
    elif contains_any(["abroad", "outside algeria", "travel", "different country", "from home"]):
        reply = (
            "Yes, you can vote from anywhere in the world as long as you have internet access and "
            "can receive your OTP code at your registered email address."
        )

    # ── 13. Page errors / technical issues ──────────────────────────────────
    elif contains_any(["error", "not loading", "won't load", "wont load", "broken", "crash", "stuck", "frozen"]):
        reply = (
            "Sorry you're running into that. Try: (1) refreshing the page, (2) checking your "
            "internet connection, (3) trying a different browser like Chrome or Safari. The system "
            "can take 30-60 seconds to wake up if it's the first visit of the day. If the problem "
            f"continues, contact the Electoral Commission at {EC_EMAIL}."
        )

    # ── 14. EC / admin dashboard questions ──────────────────────────────────
    elif contains_any(["ec dashboard", "admin dashboard", "electoral commission access", "how do i open", "how do i close"]):
        reply = (
            "That's a question for an Electoral Commission member with dashboard access, not for "
            f"voters here. If you're an EC member needing help, please reach out at {EC_EMAIL}."
        )

    # ── 15. Greeting / small talk ────────────────────────────────────────────
    elif contains_any(["hi", "hello", "hey", "good morning", "good afternoon", "good evening"]) and len(msg) < 25:
        reply = (
            "Hello! 👋 I'm the U.S.A.A Election Assistant. Ask me about OTP codes, unopposed "
            "candidates, ballot verification, or when results will be published or use one of "
            "the quick action buttons above."
        )

    # ── 16. Thanks / closing ─────────────────────────────────────────────────
    elif contains_any(["thank", "thanks", "appreciate", "cheers"]):
        reply = "You're welcome! Good luck with your vote — every ballot matters. 🗳️"

    # ── 17. Default fallback ──────────────────────────────────────────────────
    else:
        reply = (
            "I'm the U.S.A.A Election Assistant 🤖. I can help with: getting your OTP, unopposed "
            "candidates, verifying your ballot receipt, when results are published, and general "
            "voting questions. Could you rephrase your question, or try one of the quick action "
            f"buttons above? For anything I can't help with, reach the EC at {EC_EMAIL}."
        )

    # Simulate a slight "typing" delay so it feels natural on the frontend
    time.sleep(0.8)

    return {"status": "success", "reply": reply}
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)