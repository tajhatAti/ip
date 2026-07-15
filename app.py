import os
import re
import sqlite3
import secrets
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

import bcrypt
import requests
from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr

# ----------------------------
# Logging
# ----------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger("brevo-otp-app")

# ----------------------------
# App
# ----------------------------
app = FastAPI(title="Brevo OTP Login System")

# ----------------------------
# Paths / Config
# ----------------------------
BASE_DIR = Path(__file__).resolve().parent
INDEX_FILE = BASE_DIR / "index.html"

DB_PATH = Path(os.getenv("DB_PATH", str(BASE_DIR / "database.db")))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

OTP_EXPIRY_MINUTES = int(os.getenv("OTP_EXPIRY_MINUTES", "10"))

BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"

USERNAME_REGEX = re.compile(r"^[A-Za-z0-9_.-]{3,30}$")


# ----------------------------
# Models
# ----------------------------
class UserSignup(BaseModel):
    username: str
    email: EmailStr
    password: str


class UserVerify(BaseModel):
    username: str
    otp: str


class UserLogin(BaseModel):
    username: str
    password: str


class ResendOTP(BaseModel):
    username: str


# ----------------------------
# Helpers
# ----------------------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_utc_str() -> str:
    return now_utc().isoformat()


def get_db_connection():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password TEXT NOT NULL,
            otp TEXT,
            otp_created_at TEXT,
            is_verified INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)

    conn.commit()
    conn.close()
    logger.info("Database initialized at: %s", DB_PATH)


init_db()


def validate_username(username: str) -> str:
    username = username.strip()
    if not USERNAME_REGEX.fullmatch(username):
        raise HTTPException(
            status_code=400,
            detail="ইউজারনেম ৩-৩০ অক্ষরের হতে হবে এবং শুধু letters, numbers, _, ., - ব্যবহার করা যাবে।"
        )
    return username


def validate_password(password: str) -> str:
    password = password.strip()
    if len(password) < 6:
        raise HTTPException(
            status_code=400,
            detail="পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।"
        )
    return password


def generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8")
        )
    except Exception:
        return False


def send_otp_email(receiver_email: str, otp: str, username: str):
    brevo_api_key = os.getenv("BREVO_API_KEY", "").strip()
    sender_email = os.getenv("SENDER_EMAIL", "").strip()
    sender_name = os.getenv("SENDER_NAME", "OTP App").strip()

    logger.info("=== BREVO EMAIL DEBUG START ===")
    logger.info("Receiver: %s", receiver_email)
    logger.info("BREVO_API_KEY exists: %s", bool(brevo_api_key))
    logger.info("SENDER_EMAIL exists: %s", bool(sender_email))
    logger.info("SENDER_NAME: %s", sender_name)

    if not brevo_api_key:
        logger.error("BREVO_API_KEY is missing.")
        raise HTTPException(status_code=500, detail="BREVO_API_KEY সেট করা নেই।")

    if not sender_email:
        logger.error("SENDER_EMAIL is missing.")
        raise HTTPException(status_code=500, detail="SENDER_EMAIL সেট করা নেই।")

    headers = {
        "accept": "application/json",
        "api-key": brevo_api_key,
        "content-type": "application/json"
    }

    html_content = f"""
    <html>
      <body style="font-family: Arial, sans-serif; line-height:1.6;">
        <h2>OTP Verification</h2>
        <p>Hello <b>{username}</b>,</p>
        <p>Your verification code is:</p>
        <div style="font-size:28px;font-weight:bold;letter-spacing:4px;color:#2563eb;">
          {otp}
        </div>
        <p>This OTP will expire in <b>{OTP_EXPIRY_MINUTES} minutes</b>.</p>
        <p>If you did not request this, please ignore this email.</p>
      </body>
    </html>
    """

    payload = {
        "sender": {
            "name": sender_name,
            "email": sender_email
        },
        "to": [
            {
                "email": receiver_email
            }
        ],
        "subject": "Your Verification OTP",
        "textContent": (
            f"Hello {username},\n\n"
            f"Your OTP code is: {otp}\n\n"
            f"This code will expire in {OTP_EXPIRY_MINUTES} minutes.\n\n"
            f"If you did not request this email, please ignore it."
        ),
        "htmlContent": html_content
    }

    try:
        response = requests.post(
            BREVO_API_URL,
            json=payload,
            headers=headers,
            timeout=20
        )

        logger.info("Brevo status code: %s", response.status_code)
        logger.info("Brevo response text: %s", response.text)

        if response.status_code not in (200, 201, 202):
            raise HTTPException(
                status_code=500,
                detail=f"Brevo email failed: {response.text}"
            )

        logger.info("✅ OTP email sent successfully with Brevo API.")

    except requests.RequestException as e:
        logger.exception("❌ Network/Request error while calling Brevo API.")
        raise HTTPException(
            status_code=500,
            detail=f"Brevo API request failed: {str(e)}"
        )


# ----------------------------
# Routes
# ----------------------------
@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
def read_index():
    if not INDEX_FILE.exists():
        raise HTTPException(status_code=404, detail="index.html file পাওয়া যায়নি।")

    # HEAD request এ শুধু 200 return
    return FileResponse(INDEX_FILE) if INDEX_FILE.exists() else Response(status_code=404)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "db_path": str(DB_PATH),
        "brevo_api_key_set": bool(os.getenv("BREVO_API_KEY", "").strip()),
        "sender_email_set": bool(os.getenv("SENDER_EMAIL", "").strip()),
        "sender_name": os.getenv("SENDER_NAME", "OTP App"),
        "otp_expiry_minutes": OTP_EXPIRY_MINUTES
    }


@app.post("/signup")
def signup(user: UserSignup):
    username = validate_username(user.username)
    email = str(user.email).strip().lower()
    password = validate_password(user.password)

    otp = generate_otp()
    hashed_pw = hash_password(password)
    current_time = now_utc_str()

    logger.info("Signup requested | username=%s | email=%s", username, email)

    conn = get_db_connection()
    cursor = conn.cursor()
    inserted_user_id = None

    try:
        existing = cursor.execute(
            "SELECT id FROM users WHERE username = ? OR email = ?",
            (username, email)
        ).fetchone()

        if existing:
            raise HTTPException(
                status_code=400,
                detail="এই ইউজারনেম বা ইমেইল আগে থেকেই আছে।"
            )

        cursor.execute("""
            INSERT INTO users (
                username, email, password, otp, otp_created_at,
                is_verified, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)
        """, (
            username,
            email,
            hashed_pw,
            otp,
            current_time,
            current_time,
            current_time
        ))
        conn.commit()
        inserted_user_id = cursor.lastrowid

        logger.info("User inserted in DB | id=%s | username=%s | otp=%s", inserted_user_id, username, otp)

        send_otp_email(email, otp, username)

        logger.info("Signup success | username=%s", username)
        return {
            "message": "সাইনআপ সফল! আপনার ইমেইলে OTP পাঠানো হয়েছে।"
        }

    except HTTPException:
        if inserted_user_id:
            cursor.execute("DELETE FROM users WHERE id = ?", (inserted_user_id,))
            conn.commit()
            logger.warning("Rolled back inserted user because email sending failed | username=%s", username)
        raise

    except sqlite3.IntegrityError:
        logger.exception("SQLite integrity error during signup.")
        raise HTTPException(
            status_code=400,
            detail="এই ইউজারনেম বা ইমেইল আগে থেকেই আছে।"
        )

    except Exception:
        logger.exception("Unexpected signup error.")
        if inserted_user_id:
            cursor.execute("DELETE FROM users WHERE id = ?", (inserted_user_id,))
            conn.commit()
        raise HTTPException(
            status_code=500,
            detail="সার্ভারে সমস্যা হয়েছে। পরে আবার চেষ্টা করুন।"
        )

    finally:
        conn.close()


@app.post("/resend-otp")
def resend_otp(payload: ResendOTP):
    username = validate_username(payload.username)
    logger.info("Resend OTP requested | username=%s", username)

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        row = cursor.execute(
            "SELECT id, email, otp, otp_created_at, is_verified FROM users WHERE username = ?",
            (username,)
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="ইউজারনেম পাওয়া যায়নি।")

        if row["is_verified"] == 1:
            return {"message": "অ্যাকাউন্ট ইতিমধ্যেই ভেরিফাইড।"}

        old_otp = row["otp"]
        old_otp_created_at = row["otp_created_at"]

        new_otp = generate_otp()
        current_time = now_utc_str()

        cursor.execute("""
            UPDATE users
            SET otp = ?, otp_created_at = ?, updated_at = ?
            WHERE id = ?
        """, (
            new_otp,
            current_time,
            current_time,
            row["id"]
        ))
        conn.commit()

        try:
            send_otp_email(row["email"], new_otp, username)
        except Exception:
            # email fail করলে আগের OTP restore
            cursor.execute("""
                UPDATE users
                SET otp = ?, otp_created_at = ?, updated_at = ?
                WHERE id = ?
            """, (
                old_otp,
                old_otp_created_at,
                now_utc_str(),
                row["id"]
            ))
            conn.commit()
            raise

        logger.info("Resend OTP success | username=%s | otp=%s", username, new_otp)
        return {"message": "নতুন OTP আপনার ইমেইলে পাঠানো হয়েছে।"}

    finally:
        conn.close()


@app.post("/verify")
def verify_otp(user: UserVerify):
    username = validate_username(user.username)
    otp = user.otp.strip()

    if not otp.isdigit() or len(otp) != 6:
        raise HTTPException(status_code=400, detail="OTP অবশ্যই ৬ সংখ্যার হতে হবে।")

    logger.info("Verify requested | username=%s | otp=%s", username, otp)

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        row = cursor.execute("""
            SELECT id, otp, otp_created_at, is_verified
            FROM users
            WHERE username = ?
        """, (username,)).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="ইউজারনেম পাওয়া যায়নি।")

        if row["is_verified"] == 1:
            return {"message": "অ্যাকাউন্ট ইতিমধ্যেই ভেরিফাইড।"}

        db_otp = row["otp"]
        otp_created_at = row["otp_created_at"]

        if not db_otp or not otp_created_at:
            raise HTTPException(
                status_code=400,
                detail="OTP পাওয়া যায়নি। নতুন OTP রিকোয়েস্ট করুন।"
            )

        created_time = datetime.fromisoformat(otp_created_at)
        expires_at = created_time + timedelta(minutes=OTP_EXPIRY_MINUTES)

        if now_utc() > expires_at:
            raise HTTPException(
                status_code=400,
                detail="OTP মেয়াদ শেষ হয়ে গেছে। নতুন OTP নিন।"
            )

        if db_otp != otp:
            raise HTTPException(status_code=400, detail="ভুল OTP কোড!")

        current_time = now_utc_str()

        cursor.execute("""
            UPDATE users
            SET is_verified = 1,
                otp = NULL,
                otp_created_at = NULL,
                updated_at = ?
            WHERE id = ?
        """, (current_time, row["id"]))
        conn.commit()

        logger.info("Account verified | username=%s", username)

        return {"message": "ভেরিফিকেশন সফল!"}

    finally:
        conn.close()


@app.post("/login")
def login(user: UserLogin):
    username = validate_username(user.username)
    password = user.password

    logger.info("Login requested | username=%s", username)

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        row = cursor.execute("""
            SELECT username, password, is_verified
            FROM users
            WHERE username = ?
        """, (username,)).fetchone()

        if not row:
            raise HTTPException(
                status_code=400,
                detail="ভুল ইউজারনেম বা পাসওয়ার্ড।"
            )

        if not verify_password(password, row["password"]):
            raise HTTPException(
                status_code=400,
                detail="ভুল ইউজারনেম বা পাসওয়ার্ড।"
            )

        if row["is_verified"] == 0:
            raise HTTPException(
                status_code=400,
                detail="অ্যাকাউন্ট ভেরিফাই করা হয়নি।"
            )

        logger.info("Login success | username=%s", username)

        return {
            "message": "লগইন সফল!",
            "username": row["username"]
        }

    finally:
        conn.close()
