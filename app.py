import os
import re
import smtplib
import sqlite3
import secrets
import logging
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path

import bcrypt
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger("gmail-otp-app")

app = FastAPI(title="Gmail OTP Login System")

BASE_DIR = Path(__file__).resolve().parent
INDEX_FILE = BASE_DIR / "index.html"
DB_PATH = Path(os.getenv("DB_PATH", str(BASE_DIR / "database.db")))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

OTP_EXPIRY_MINUTES = 10
USERNAME_REGEX = re.compile(r"^[A-Za-z0-9_.-]{3,30}$")


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


def now_utc():
    return datetime.now(timezone.utc)


def now_utc_str():
    return now_utc().isoformat()


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
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
    logger.info("Database initialized: %s", DB_PATH)


init_db()


def validate_username(username: str):
    username = username.strip()
    if not USERNAME_REGEX.fullmatch(username):
        raise HTTPException(
            status_code=400,
            detail="ইউজারনেম ৩-৩০ অক্ষরের হতে হবে এবং শুধু letters, numbers, _, ., - ব্যবহার করা যাবে।"
        )
    return username


def validate_password(password: str):
    password = password.strip()
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।")
    return password


def generate_otp():
    return f"{secrets.randbelow(1000000):06d}"


def hash_password(password: str):
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str):
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False


def send_otp_email(receiver_email: str, otp: str, username: str):
    sender_email = os.getenv("SENDER_EMAIL", "").strip()
    email_pass = os.getenv("EMAIL_PASS", "").strip().replace(" ", "")

    logger.info("=== GMAIL EMAIL DEBUG START ===")
    logger.info("Receiver: %s", receiver_email)
    logger.info("SENDER_EMAIL exists: %s", bool(sender_email))
    logger.info("EMAIL_PASS exists: %s", bool(email_pass))
    logger.info("EMAIL_PASS length: %s", len(email_pass) if email_pass else 0)

    if not sender_email:
        raise HTTPException(status_code=500, detail="SENDER_EMAIL সেট করা নেই।")
    if not email_pass:
        raise HTTPException(status_code=500, detail="EMAIL_PASS সেট করা নেই।")

    msg = EmailMessage()
    msg["Subject"] = "Your Verification OTP"
    msg["From"] = sender_email
    msg["To"] = receiver_email
    msg.set_content(
        f"""Hello {username},

Your OTP code is: {otp}

This code will expire in {OTP_EXPIRY_MINUTES} minutes.

If you did not request this email, please ignore it.
"""
    )

    try:
        logger.info("Trying Gmail SMTP on port 587...")
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=20) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(sender_email, email_pass)
            server.send_message(msg)
        logger.info("✅ Gmail email sent successfully.")
    except Exception as e:
        logger.exception("❌ Gmail send failed")
        raise HTTPException(
            status_code=500,
            detail=f"OTP email পাঠানো যায়নি। Gmail App Password / sender email check করুন। Error: {str(e)}"
        )


@app.get("/", include_in_schema=False)
def root():
    if not INDEX_FILE.exists():
        raise HTTPException(status_code=404, detail="index.html পাওয়া যায়নি।")
    return FileResponse(INDEX_FILE)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "db_path": str(DB_PATH),
        "sender_email_set": bool(os.getenv("SENDER_EMAIL", "").strip()),
        "email_pass_set": bool(os.getenv("EMAIL_PASS", "").strip())
    }


@app.post("/signup")
def signup(user: UserSignup):
    username = validate_username(user.username)
    email = str(user.email).strip().lower()
    password = validate_password(user.password)

    conn = get_db()
    cur = conn.cursor()
    inserted_id = None

    try:
        exists = cur.execute(
            "SELECT id FROM users WHERE username = ? OR email = ?",
            (username, email)
        ).fetchone()

        if exists:
            raise HTTPException(status_code=400, detail="এই ইউজারনেম বা ইমেইল আগে থেকেই আছে।")

        otp = generate_otp()
        hashed_pw = hash_password(password)
        now = now_utc_str()

        cur.execute("""
            INSERT INTO users (username, email, password, otp, otp_created_at, is_verified, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)
        """, (username, email, hashed_pw, otp, now, now, now))
        conn.commit()
        inserted_id = cur.lastrowid

        logger.info("User saved | username=%s | otp=%s", username, otp)

        send_otp_email(email, otp, username)

        return {"message": "সাইনআপ সফল! ইমেইলে OTP পাঠানো হয়েছে।"}

    except HTTPException:
        if inserted_id:
            cur.execute("DELETE FROM users WHERE id = ?", (inserted_id,))
            conn.commit()
        raise
    except Exception:
        logger.exception("Signup failed")
        if inserted_id:
            cur.execute("DELETE FROM users WHERE id = ?", (inserted_id,))
            conn.commit()
        raise HTTPException(status_code=500, detail="সার্ভারে সমস্যা হয়েছে। পরে আবার চেষ্টা করুন।")
    finally:
        conn.close()


@app.post("/resend-otp")
def resend_otp(payload: ResendOTP):
    username = validate_username(payload.username)

    conn = get_db()
    cur = conn.cursor()

    try:
        row = cur.execute(
            "SELECT id, email, is_verified FROM users WHERE username = ?",
            (username,)
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="ইউজারনেম পাওয়া যায়নি।")

        if row["is_verified"] == 1:
            return {"message": "অ্যাকাউন্ট ইতিমধ্যেই ভেরিফাইড।"}

        otp = generate_otp()
        now = now_utc_str()

        cur.execute("""
            UPDATE users
            SET otp = ?, otp_created_at = ?, updated_at = ?
            WHERE id = ?
        """, (otp, now, now, row["id"]))
        conn.commit()

        logger.info("Resend OTP | username=%s | otp=%s", username, otp)

        send_otp_email(row["email"], otp, username)

        return {"message": "নতুন OTP ইমেইলে পাঠানো হয়েছে।"}
    finally:
        conn.close()


@app.post("/verify")
def verify_otp(user: UserVerify):
    username = validate_username(user.username)
    otp = user.otp.strip()

    if not otp.isdigit() or len(otp) != 6:
        raise HTTPException(status_code=400, detail="OTP অবশ্যই ৬ সংখ্যার হতে হবে।")

    conn = get_db()
    cur = conn.cursor()

    try:
        row = cur.execute("""
            SELECT id, otp, otp_created_at, is_verified
            FROM users
            WHERE username = ?
        """, (username,)).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="ইউজারনেম পাওয়া যায়নি।")

        if row["is_verified"] == 1:
            return {"message": "অ্যাকাউন্ট ইতিমধ্যেই ভেরিফাইড।"}

        if not row["otp"] or not row["otp_created_at"]:
            raise HTTPException(status_code=400, detail="OTP পাওয়া যায়নি। নতুন OTP নিন।")

        created_at = datetime.fromisoformat(row["otp_created_at"])
        expires_at = created_at + timedelta(minutes=OTP_EXPIRY_MINUTES)

        if now_utc() > expires_at:
            raise HTTPException(status_code=400, detail="OTP মেয়াদ শেষ। নতুন OTP নিন।")

        if row["otp"] != otp:
            raise HTTPException(status_code=400, detail="ভুল OTP কোড!")

        now = now_utc_str()
        cur.execute("""
            UPDATE users
            SET is_verified = 1, otp = NULL, otp_created_at = NULL, updated_at = ?
            WHERE id = ?
        """, (now, row["id"]))
        conn.commit()

        return {"message": "ভেরিফিকেশন সফল!"}
    finally:
        conn.close()


@app.post("/login")
def login(user: UserLogin):
    username = validate_username(user.username)
    password = user.password

    conn = get_db()
    cur = conn.cursor()

    try:
        row = cur.execute(
            "SELECT username, password, is_verified FROM users WHERE username = ?",
            (username,)
        ).fetchone()

        if not row:
            raise HTTPException(status_code=400, detail="ভুল ইউজারনেম বা পাসওয়ার্ড।")

        if not verify_password(password, row["password"]):
            raise HTTPException(status_code=400, detail="ভুল ইউজারনেম বা পাসওয়ার্ড।")

        if row["is_verified"] == 0:
            raise HTTPException(status_code=400, detail="অ্যাকাউন্ট ভেরিফাই করা হয়নি।")

        return {"message": "লগইন সফল!", "username": row["username"]}
    finally:
        conn.close()
