import os
import sys
import random
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

import bcrypt
import requests
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

# --------------------------------------------
# Database Path (Render Disk)
# --------------------------------------------
DB_DIR = "/data"

if os.path.exists(DB_DIR) and os.path.isdir(DB_DIR):
    DB_PATH = os.path.join(DB_DIR, "database.db")
    print(f"[DB] Using persistent disk: {DB_PATH}", flush=True)
else:
    DB_PATH = "database.db"
    print(f"[DB] Using local database: {DB_PATH}", flush=True)


# --------------------------------------------
# Initialize Database
# --------------------------------------------
def init_db():
    print("[DB] Initializing database...", flush=True)

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                otp TEXT NOT NULL,
                is_verified INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        conn.commit()
        conn.close()

        print("[DB] Database initialized successfully!", flush=True)

    except Exception as e:
        print(f"[DB] Error: {str(e)}", flush=True)
        sys.exit(1)


# --------------------------------------------
# Password Hashing
# --------------------------------------------
def hash_password(password: str) -> str:
    pwd_bytes = password.encode("utf-8")
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8"),
        )
    except Exception:
        return False


# --------------------------------------------
# Send OTP Email (Brevo API)
# --------------------------------------------
def send_otp_email(receiver_email: str, otp: str):
    """
    Sends OTP email using Brevo API
    Your own email will be the sender
    """
    api_key = os.getenv("BREVO_API_KEY")

    if not api_key:
        print("[BREVO] BREVO_API_KEY is missing!", flush=True)
        raise HTTPException(
            status_code=500,
            detail="API Key পাওয়া যায়নি।"
        )

    url = "https://api.brevo.com/v3/smtp/email"

    headers = {
        "accept": "application/json",
        "api-key": api_key,
        "content-type": "application/json",
    }

    # এখানে তোমার Confirm করা ইমেইলটি দিবে
    sender_email = "trulove551@gmail.com"
    sender_name = "Login System"

    data = {
        "sender": {
            "name": sender_name,
            "email": sender_email,
        },
        "to": [
            {
                "email": receiver_email,
            }
        ],
        "subject": "OTP Verification Code",
        "htmlContent": f"""
        <div style="font-family: Arial, sans-serif; padding: 40px; background-color: #f4f4f9;">
            <div style="max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; text-align: center;">
                <h2 style="color: #667eea;">অ্যাকাউন্ট ভেরিফিকেশন</h2>
                
                <p style="color: #333; font-size: 16px; margin: 30px 0;">
                    আপনার OTP কোড হলো:
                </p>
                
                <div style="display: inline-block; padding: 25px 60px; background: #f8f9fa; border: 2px dashed #667eea; border-radius: 10px; font-size: 42px; font-weight: bold; color: #667eea; letter-spacing: 15px;">
                    {otp}
                </div>
                
                <p style="color: #666; margin-top: 30px;">
                    এই কোডটি ১০ মিনিটের জন্য কার্যকর।
                </p>
            </div>
        </div>
        """,
    }

    try:
        response = requests.post(
            url,
            json=data,
            headers=headers,
            timeout=30,
        )

        print(f"[BREVO] Status Code: {response.status_code}", flush=True)

        if response.status_code == 201 or response.status_code == 202:
            print("[BREVO] Email sent successfully!", flush=True)
            return

        else:
            print(f"[BREVO] Error: {response.text}", flush=True)
            raise HTTPException(
                status_code=500,
                detail="ইমেইল পাঠানো যায়নি।"
            )

    except Exception as e:
        print(f"[BREVO] Error: {str(e)}", flush=True)
        raise HTTPException(
            status_code=500,
            detail="ইমেইল পাঠানো যায়নি।"
        )


# --------------------------------------------
# Models
# --------------------------------------------
class UserSignup(BaseModel):
    username: str
    email: str
    password: str


class UserVerify(BaseModel):
    username: str
    otp: str


class UserLogin(BaseModel):
    username: str
    password: str


# --------------------------------------------
# Lifespan
# --------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[APP] Starting...", flush=True)
    print(f"[APP] BREVO_API_KEY exists: {'Yes' if os.getenv('BREVO_API_KEY') else 'No'}", flush=True)
    
    init_db()
    
    yield


# --------------------------------------------
# FastAPI App
# --------------------------------------------
app = FastAPI(lifespan=lifespan)


@app.get("/")
def index():
    return FileResponse("index.html")


@app.post("/signup")
def signup(user: UserSignup):
    username = user.username.strip()
    email = user.email.strip().lower()
    password = user.password

    if len(username) < 3:
        raise HTTPException(status_code=400, detail="ইউজারনেম ৩ অক্ষরের বেশি হতে হবে")

    if len(password) < 6:
        raise HTTPException(status_code=400, detail="পাসওয়ার্ড ৬ অক্ষরের বেশি হতে হবে")

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute(
        "SELECT * FROM users WHERE LOWER(username)=? OR LOWER(email)=?",
        (username.lower(), email),
    )

    if cursor.fetchone():
        conn.close()
        raise HTTPException(
            status_code=400, detail="ইউজারনেম বা ইমেইল আগেই আছে"
        )

    otp = str(random.randint(100000, 999999))

    hashed_pw = hash_password(password)

    cursor.execute(
        "INSERT INTO users (username, email, password, otp, is_verified) VALUES (?, ?, ?, ?, 0)",
        (username, email, hashed_pw, otp),
    )

    conn.commit()
    conn.close()

    # OTP পাঠাও
    send_otp_email(email, otp)

    return {"message": "সাইনআপ সফল! ইমেইলে OTP পাঠানো হয়েছে"}


@app.post("/verify")
def verify(user: UserVerify):
    username = user.username.strip()
    otp = user.otp.strip()

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute(
        "SELECT otp, is_verified FROM users WHERE LOWER(username)=?",
        (username.lower(),),
    )

    row = cursor.fetchone()

    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="ইউজার পাওয়া যায়নি")

    db_otp, is_verified = row

    if is_verified == 1:
        conn.close()
        return {"message": "ইতিমধ্যে ভেরিফাই করা হয়েছে"}

    if db_otp == otp:
        cursor.execute(
            "UPDATE users SET is_verified=1 WHERE LOWER(username)=?",
            (username.lower(),),
        )
        conn.commit()
        conn.close()
        return {"message": "ভেরিফিকেশন সফল!"}

    conn.close()
    raise HTTPException(status_code=400, detail="ভুল OTP!")


@app.post("/login")
def login(user: UserLogin):
    username = user.username.strip()
    password = user.password

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute(
        "SELECT password, is_verified FROM users WHERE LOWER(username)=?",
        (username.lower(),),
    )

    row = cursor.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=400, detail="ইউজারনেম বা পাসওয়ার্ড ভুল")

    hashed_pw, is_verified = row

    if not verify_password(password, hashed_pw):
        raise HTTPException(status_code=400, detail="ইউজারনেম বা পাসওয়ার্ড ভুল")

    if is_verified == 0:
        raise HTTPException(status_code=400, detail="ভেরিফাই করা হয়নি")

    return {"message": "লগইন সফল!", "username": username}
