import os
import re
import json
import sqlite3
import secrets
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

import bcrypt
import requests
from fastapi import FastAPI, HTTPException, Response, Header
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr
from typing import Optional, List

# ----------------------------
# Logging
# ----------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger("ahad-co-app")

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
# App
# ----------------------------
app = FastAPI(title="Ahad Co Auth System")

app.mount("/static", StaticFiles(directory=BASE_DIR), name="static")


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


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class VerifyResetOTP(BaseModel):
    email: EmailStr
    otp: str


class ResetPassword(BaseModel):
    email: EmailStr
    otp: str
    new_password: str


class LinkItem(BaseModel):
    label: str
    url: str


class ProfileUpdate(BaseModel):
    phone: Optional[str] = None
    custom_code: Optional[str] = None
    links: Optional[List[LinkItem]] = None


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
            reset_otp TEXT,
            reset_otp_created_at TEXT,
            reset_verified INTEGER NOT NULL DEFAULT 0,
            token TEXT,
            phone TEXT,
            custom_code TEXT,
            links TEXT,
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
            detail="পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।"
        )
    return password


def generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def generate_token() -> str:
    return secrets.token_hex(32)


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


def send_email(receiver_email: str, subject: str, otp: str, username: str, purpose: str):
    brevo_api_key = os.getenv("BREVO_API_KEY", "").strip()
    sender_email = os.getenv("SENDER_EMAIL", "").strip()
    sender_name = os.getenv("SENDER_NAME", "Ahad Co").strip()

    if not brevo_api_key or not sender_email:
        logger.error("BREVO_API_KEY or SENDER_EMAIL missing.")
        raise HTTPException(status_code=500, detail="BREVO_API_KEY / SENDER_EMAIL সেট করা নেই।")

    headers = {
        "accept": "application/json",
        "api-key": brevo_api_key,
        "content-type": "application/json"
    }

    html_content = f"""
    <html>
      <body style="font-family: Arial, sans-serif; line-height:1.6;">
        <h2>{purpose}</h2>
        <p>Hello <b>{username}</b>,</p>
        <p>Your code is:</p>
        <div style="font-size:28px;font-weight:bold;letter-spacing:4px;color:#7C6CF6;">
          {otp}
        </div>
        <p>This code will expire in <b>{OTP_EXPIRY_MINUTES} minutes</b>.</p>
        <p>If you did not request this, please ignore this email.</p>
      </body>
    </html>
    """

    payload = {
        "sender": {"name": sender_name, "email": sender_email},
        "to": [{"email": receiver_email}],
        "subject": subject,
        "textContent": f"Hello {username},\n\nYour code is: {otp}\n\nExpires in {OTP_EXPIRY_MINUTES} minutes.",
        "htmlContent": html_content
    }

    try:
        response = requests.post(BREVO_API_URL, json=payload, headers=headers, timeout=20)
        logger.info("Brevo status: %s | %s", response.status_code, response.text)
        if response.status_code not in (200, 201, 202):
            raise HTTPException(status_code=500, detail=f"Email failed: {response.text}")
    except requests.RequestException as e:
        logger.exception("Brevo request failed")
        raise HTTPException(status_code=500, detail=f"Email request failed: {str(e)}")


def get_current_user(authorization: Optional[str] = Header(None)) -> sqlite3.Row:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="লগইন করা নেই। আবার লগইন করুন।")

    token = authorization.split(" ", 1)[1].strip()

    conn = get_db_connection()
    try:
        row = conn.execute("SELECT * FROM users WHERE token = ?", (token,)).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="সেশন মেয়াদ শেষ। আবার লগইন করুন।")
        return row
    finally:
        conn.close()


# ----------------------------
# Static / Health
# ----------------------------
@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
def read_index():
    if not INDEX_FILE.exists():
        raise HTTPException(status_code=404, detail="index.html file পাওয়া যায়নি।")
    return FileResponse(INDEX_FILE)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "db_path": str(DB_PATH),
        "brevo_api_key_set": bool(os.getenv("BREVO_API_KEY", "").strip()),
        "sender_email_set": bool(os.getenv("SENDER_EMAIL", "").strip()),
    }


# ----------------------------
# Signup / Verify / Resend
# ----------------------------
@app.post("/signup")
def signup(user: UserSignup):
    username = validate_username(user.username)
    email = str(user.email).strip().lower()
    password = validate_password(user.password)

    otp = generate_otp()
    hashed_pw = hash_password(password)
    current_time = now_utc_str()

    conn = get_db_connection()
    cursor = conn.cursor()
    inserted_user_id = None

    try:
        existing = cursor.execute(
            "SELECT id FROM users WHERE username = ? OR email = ?",
            (username, email)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="এই ইউজারনেম বা ইমেইল আগে থেকেই আছে।")

        cursor.execute("""
            INSERT INTO users (username, email, password, otp, otp_created_at,
                is_verified, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)
        """, (username, email, hashed_pw, otp, current_time, current_time, current_time))
        conn.commit()
        inserted_user_id = cursor.lastrowid

        send_email(email, "Your Verification OTP", otp, username, "Email Verification")

        return {"message": "সাইনআপ সফল! আপনার ইমেইলে OTP পাঠানো হয়েছে।"}

    except HTTPException:
        if inserted_user_id:
            cursor.execute("DELETE FROM users WHERE id = ?", (inserted_user_id,))
            conn.commit()
        raise
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="এই ইউজারনেম বা ইমেইল আগে থেকেই আছে।")
    finally:
        conn.close()


@app.post("/resend-otp")
def resend_otp(payload: ResendOTP):
    username = validate_username(payload.username)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        row = cursor.execute(
            "SELECT id, email, is_verified FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="ইউজারনেম পাওয়া যায়নি।")
        if row["is_verified"] == 1:
            return {"message": "অ্যাকাউন্ট ইতিমধ্যেই ভেরিফাইড।"}

        new_otp = generate_otp()
        current_time = now_utc_str()
        cursor.execute("UPDATE users SET otp=?, otp_created_at=?, updated_at=? WHERE id=?",
                        (new_otp, current_time, current_time, row["id"]))
        conn.commit()

        send_email(row["email"], "Your Verification OTP", new_otp, username, "Email Verification")
        return {"message": "নতুন OTP আপনার ইমেইলে পাঠানো হয়েছে।"}
    finally:
        conn.close()


@app.post("/verify")
def verify_otp(user: UserVerify):
    username = validate_username(user.username)
    otp = user.otp.strip()
    if not otp.isdigit() or len(otp) != 6:
        raise HTTPException(status_code=400, detail="OTP অবশ্যই ৬ সংখ্যার হতে হবে।")

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        row = cursor.execute(
            "SELECT id, otp, otp_created_at, is_verified FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="ইউজারনেম পাওয়া যায়নি।")
        if row["is_verified"] == 1:
            return {"message": "অ্যাকাউন্ট ইতিমধ্যেই ভেরিফাইড।"}

        db_otp = row["otp"]
        otp_created_at = row["otp_created_at"]
        if not db_otp or not otp_created_at:
            raise HTTPException(status_code=400, detail="OTP পাওয়া যায়নি। নতুন OTP রিকোয়েস্ট করুন।")

        created_time = datetime.fromisoformat(otp_created_at)
        if now_utc() > created_time + timedelta(minutes=OTP_EXPIRY_MINUTES):
            raise HTTPException(status_code=400, detail="OTP মেয়াদ শেষ হয়ে গেছে। নতুন OTP নিন।")
        if db_otp != otp:
            raise HTTPException(status_code=400, detail="ভুল OTP কোড!")

        cursor.execute("""
            UPDATE users SET is_verified=1, otp=NULL, otp_created_at=NULL, updated_at=?
            WHERE id=?
        """, (now_utc_str(), row["id"]))
        conn.commit()
        return {"message": "ভেরিফিকেশন সফল!"}
    finally:
        conn.close()


# ----------------------------
# Login / Logout
# ----------------------------
@app.post("/login")
def login(user: UserLogin):
    username = validate_username(user.username)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        row = cursor.execute(
            "SELECT id, username, password, is_verified FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not row or not verify_password(user.password, row["password"]):
            raise HTTPException(status_code=400, detail="ভুল ইউজারনেম বা পাসওয়ার্ড।")
        if row["is_verified"] == 0:
            raise HTTPException(status_code=400, detail="অ্যাকাউন্ট ভেরিফাই করা হয়নি।")

        token = generate_token()
        cursor.execute("UPDATE users SET token=?, updated_at=? WHERE id=?",
                        (token, now_utc_str(), row["id"]))
        conn.commit()

        return {"message": "লগইন সফল!", "username": row["username"], "token": token}
    finally:
        conn.close()


@app.post("/logout")
def logout(authorization: Optional[str] = Header(None)):
    current_user = get_current_user(authorization)
    conn = get_db_connection()
    try:
        conn.execute("UPDATE users SET token=NULL, updated_at=? WHERE id=?",
                      (now_utc_str(), current_user["id"]))
        conn.commit()
        return {"message": "লগআউট সফল!"}
    finally:
        conn.close()


# ----------------------------
# Forgot Password
# ----------------------------
@app.post("/forgot-password")
def forgot_password(payload: ForgotPasswordRequest):
    email = str(payload.email).strip().lower()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        row = cursor.execute("SELECT id, username FROM users WHERE email = ?", (email,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="এই ইমেইলে কোনো অ্যাকাউন্ট নেই।")

        otp = generate_otp()
        current_time = now_utc_str()
        cursor.execute("""
            UPDATE users SET reset_otp=?, reset_otp_created_at=?, reset_verified=0, updated_at=?
            WHERE id=?
        """, (otp, current_time, current_time, row["id"]))
        conn.commit()

        send_email(email, "Password Reset Code", otp, row["username"], "Password Reset")
        return {"message": "রিসেট কোড আপনার ইমেইলে পাঠানো হয়েছে।"}
    finally:
        conn.close()


@app.post("/verify-reset-otp")
def verify_reset_otp(payload: VerifyResetOTP):
    email = str(payload.email).strip().lower()
    otp = payload.otp.strip()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        row = cursor.execute(
            "SELECT id, reset_otp, reset_otp_created_at FROM users WHERE email = ?", (email,)
        ).fetchone()
        if not row or not row["reset_otp"]:
            raise HTTPException(status_code=400, detail="আগে রিসেট কোড রিকোয়েস্ট করুন।")

        created_time = datetime.fromisoformat(row["reset_otp_created_at"])
        if now_utc() > created_time + timedelta(minutes=OTP_EXPIRY_MINUTES):
            raise HTTPException(status_code=400, detail="কোডের মেয়াদ শেষ। আবার রিকোয়েস্ট করুন।")
        if row["reset_otp"] != otp:
            raise HTTPException(status_code=400, detail="ভুল কোড।")

        cursor.execute("UPDATE users SET reset_verified=1, updated_at=? WHERE id=?",
                        (now_utc_str(), row["id"]))
        conn.commit()
        return {"message": "কোড সঠিক। এখন নতুন পাসওয়ার্ড দিন।"}
    finally:
        conn.close()


@app.post("/reset-password")
def reset_password(payload: ResetPassword):
    email = str(payload.email).strip().lower()
    new_password = validate_password(payload.new_password)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        row = cursor.execute(
            "SELECT id, reset_otp, reset_verified FROM users WHERE email = ?", (email,)
        ).fetchone()
        if not row or row["reset_verified"] != 1 or row["reset_otp"] != payload.otp.strip():
            raise HTTPException(status_code=400, detail="আগে কোড ভেরিফাই করুন।")

        hashed_pw = hash_password(new_password)
        cursor.execute("""
            UPDATE users SET password=?, reset_otp=NULL, reset_otp_created_at=NULL,
                reset_verified=0, token=NULL, updated_at=?
            WHERE id=?
        """, (hashed_pw, now_utc_str(), row["id"]))
        conn.commit()
        return {"message": "পাসওয়ার্ড পরিবর্তন সফল!"}
    finally:
        conn.close()


# ----------------------------
# Profile (protected)
# ----------------------------
@app.get("/profile")
def get_profile(authorization: Optional[str] = Header(None)):
    user = get_current_user(authorization)
    links = json.loads(user["links"]) if user["links"] else []
    return {
        "username": user["username"],
        "email": user["email"],
        "phone": user["phone"],
        "custom_code": user["custom_code"],
        "links": links,
        "created_at": user["created_at"],
    }


@app.post("/profile/update")
def update_profile(payload: ProfileUpdate, authorization: Optional[str] = Header(None)):
    user = get_current_user(authorization)
    conn = get_db_connection()
    try:
        phone = payload.phone if payload.phone is not None else user["phone"]
        custom_code = payload.custom_code if payload.custom_code is not None else user["custom_code"]
        links_json = json.dumps([l.dict() for l in payload.links]) if payload.links is not None else user["links"]

        conn.execute("""
            UPDATE users SET phone=?, custom_code=?, links=?, updated_at=?
            WHERE id=?
        """, (phone, custom_code, links_json, now_utc_str(), user["id"]))
        conn.commit()
        return {"message": "প্রোফাইল আপডেট হয়েছে।"}
    finally:
        conn.close()
