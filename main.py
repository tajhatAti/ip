import sqlite3
import random
import smtplib
import os
import bcrypt
import sys
from email.mime.text import MIMEText
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI()

# ডাটাবেস সেটআপ
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

def hash_password(password: str):
    pwd_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str):
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False

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

@app.get("/")
def read_index():
    return FileResponse("index.html")

# 🔍 ফুল ডিব্যাগ ইমেইল ফাংশন
def send_otp_email(receiver_email: str, otp: str):
    sender_email = "trulove551@gmail.com"
    app_password = os.getenv("EMAIL_PASS")

    print("\n=== DEBUG START: EMAIL CONFIGURATION ===", flush=True)
    print(f"Sender Email: {sender_email}", flush=True)
    if not app_password:
        print("❌ CRITICAL ERROR: EMAIL_PASS environment variable is completely missing or empty!", flush=True)
        raise HTTPException(status_code=500, detail="সার্ভার সমস্যা: EMAIL_PASS সেট করা নেই।")
    else:
        print(f"EMAIL_PASS found (Length: {len(app_password)} characters)", flush=True)

    msg = MIMEText(f"আপনার ভেরিফিকেশন কোড (OTP) হলো: {otp}", 'plain', 'utf-8')
    msg['Subject'] = 'Account Verification OTP'
    msg['From'] = sender_email
    msg['To'] = receiver_email

    # ১. প্রথমে Port 587 (TLS) দিয়ে চেষ্টা করবে
    try:
        print("🔄 Attempting SMTP connection via Port 587 (TLS)...", flush=True)
        server = smtplib.SMTP('smtp.gmail.com', 587, timeout=10)
        server.set_debuglevel(1) # এই লাইনটি Render লগে গুগলের সাথে কথপোকথন প্রিন্ট করবে
        print("➡️ Connected. Sending STARTTLS...", flush=True)
        server.starttls()
        print("➡️ Logging in to Gmail SMTP...", flush=True)
        server.login(sender_email, app_password)
        print("➡️ Login successful! Sending message...", flush=True)
        server.send_message(msg)
        server.quit()
        print("✅ EMAIL SENT SUCCESSFULLY VIA PORT 587!", flush=True)
        print("=== DEBUG END: SUCCESS ===\n", flush=True)
        return
    except Exception as e587:
        print(f"⚠️ Port 587 Failed. Specific Error: {str(e587)}", flush=True)
        print(f"Exception Type: {type(e587).__name__}", flush=True)

    # ২. যদি ৫৭৮ ফেইল করে, তবে ব্যাকআপ হিসেবে Port 465 (SSL) দিয়ে চেষ্টা করবে
    try:
        print("🔄 Attempting Backup SMTP connection via Port 465 (SSL)...", flush=True)
        server = smtplib.SMTP_SSL('smtp.gmail.com', 465, timeout=10)
        server.set_debuglevel(1)
        print("➡️ Connected. Logging in...", flush=True)
        server.login(sender_email, app_password)
        print("➡️ Login successful! Sending message...", flush=True)
        server.send_message(msg)
        server.quit()
        print("✅ EMAIL SENT SUCCESSFULLY VIA PORT 465!", flush=True)
        print("=== DEBUG END: SUCCESS ===\n", flush=True)
        return
    except Exception as e465:
        print(f"❌ CRITICAL: Both SMTP Ports Failed!", flush=True)
        print(f"⚠️ Port 465 Specific Error: {str(e465)}", flush=True)
        print("=== DEBUG END: CRITICAL FAILURE ===\n", flush=True)
        
        # স্ক্রিনে ডিটেইলড এরর দেখাবে যাতে বুঝতে পারো আসল ঝামেলা কী
        raise HTTPException(
            status_code=500, 
            detail=f"মেইল পাঠানো যায়নি। পোর্ট ৫৮৭ এরর: {str(e587)} | পোর্ট ৪৬৫ এরর: {str(e465)}"
        )

@app.post("/signup")
def signup(user: UserSignup):
    print(f"\n📢 Signup Triggered for User: {user.username}, Email: {user.email}", flush=True)
    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?", 
                   (user.username.lower(), user.email.lower()))
    if cursor.fetchone():
        print("⚠️ Signup aborted: Username or Email already exists in DB.", flush=True)
        conn.close()
        raise HTTPException(status_code=400, detail="এই ইউজারনেম বা ইমেইল আগে থেকেই আছে।")

    otp = str(random.randint(100000, 999999))
    hashed_pw = hash_password(user.password)
    
    cursor.execute("INSERT INTO users (username, email, password, otp) VALUES (?, ?, ?, ?)",
                   (user.username, user.email, hashed_pw, otp))
    conn.commit()
    conn.close()
    print("💾 User saved to database. Now calling send_otp_email()...", flush=True)

    send_otp_email(user.email, otp)
    return {"message": "সাইনআপ সফল! ইমেইলে ওটিপি পাঠানো হয়েছে।"}

@app.post("/verify")
def verify_otp(user: UserVerify):
    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()
    cursor.execute("SELECT otp, is_verified FROM users WHERE LOWER(username) = ?", (user.username.lower(),))
    row = cursor.fetchone()
    
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="ইউজারনেম পাওয়া যায়নি।")
        
    db_otp, is_verified = row
    if is_verified == 1:
        conn.close()
        return {"message": "অ্যাকাউন্ট ইতিমধ্যেই ভেরিফাইড!"}
        
    if db_otp == user.otp:
        cursor.execute("UPDATE users SET is_verified = 1 WHERE LOWER(username) = ?", (user.username.lower(),))
        conn.commit()
        conn.close()
        return {"message": "ভেরিফিকেশন সফল!"}
    else:
        conn.close()
        raise HTTPException(status_code=400, detail="ভুল OTP কোড!")

@app.post("/login")
def login(user: UserLogin):
    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()
    cursor.execute("SELECT password, is_verified FROM users WHERE LOWER(username) = ?", (user.username.lower(),))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        raise HTTPException(status_code=400, detail="ভুল ইউজারনেম বা পাসওয়ার্ড।")
        
    hashed_pw, is_verified = row
    if not verify_password(user.password, hashed_pw):
        raise HTTPException(status_code=400, detail="ভুল ইউজারনেম বা পাসওয়ার্ড।")
        
    if is_verified == 0:
        raise HTTPException(status_code=400, detail="অ্যাকাউন্ট ভেরিফাই করা হয়নি।")
        
    return {"message": "লগইন সফল!", "token": f"token-for-{user.username}"}
    
