import sqlite3
import random
import smtplib
import os
from email.mime.text import MIMEText
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from passlib.context import CryptContext

app = FastAPI()

# ডাটাবেস তৈরি
def init_db():
    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            email TEXT UNIQUE,
            password TEXT,
            otp TEXT,
            is_verified INTEGER DEFAULT 0
        )
    ''')
    conn.commit()
    conn.close()

init_db()

# পাসওয়ার্ড হ্যাশিং টুল
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str):
    return pwd_context.hash(password)

class UserSignup(BaseModel):
    username: str
    email: str
    password: str

# ইমেইল পাঠানো
def send_otp_email(receiver_email: str, otp: str):
    sender_email = "editsupra93@gmail.com"
    # Render-এর গোপন সেটিংস থেকে পাসওয়ার্ড নেবে
    app_password = os.getenv("EMAIL_PASS")

    if not app_password:
        raise HTTPException(status_code=500, detail="সার্ভার সমস্যা: ইমেইল পাসওয়ার্ড সেট করা নেই।")

    msg = MIMEText(f"আপনার ভেরিফিকেশন কোড (OTP) হলো: {otp}")
    msg['Subject'] = 'Account Verification OTP'
    msg['From'] = sender_email
    msg['To'] = receiver_email

    try:
        server = smtplib.SMTP_SSL('smtp.gmail.com', 465)
        server.login(sender_email, app_password)
        server.send_message(msg)
        server.quit()
    except Exception as e:
        print("Email error:", e)
        raise HTTPException(status_code=500, detail="ইমেইল পাঠানো যায়নি।")

# সাইনআপ রাউট
@app.post("/signup")
def signup(user: UserSignup):
    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM users WHERE username = ? OR email = ?", (user.username, user.email))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="এই ইউজারনেম বা ইমেইল আগে থেকেই আছে।")

    otp = str(random.randint(100000, 999999))
    hashed_pw = hash_password(user.password)

    cursor.execute("INSERT INTO users (username, email, password, otp) VALUES (?, ?, ?, ?)",
                   (user.username, user.email, hashed_pw, otp))
    conn.commit()
    conn.close()

    send_otp_email(user.email, otp)

    return {"message": "সাইনআপ সফল! ইমেইলে একটি ৬-সংখ্যার OTP পাঠানো হয়েছে।"}
