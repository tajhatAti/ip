import sqlite3
import random
import smtplib
import os
import bcrypt
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

# গুগল সিকিউরিটি বাইপাস ও দ্রুত কানেকশন ফাংশন
def send_otp_email(receiver_email: str, otp: str):
    sender_email = "editsupra93@gmail.com"
    app_password = os.getenv("EMAIL_PASS")

    if not app_password:
        raise HTTPException(status_code=500, detail="সার্ভার সমস্যা: ইমেইল পাসওয়ার্ড সেট করা নেই।")

    msg = MIMEText(f"আপনার ভেরিফিকেশন কোড (OTP) হলো: {otp}", 'plain', 'utf-8')
    msg['Subject'] = 'Account Verification OTP'
    msg['From'] = sender_email
    msg['To'] = receiver_email

    try:
        # TLS (Port 587) ব্যবহার করা হচ্ছে যা ক্লাউড সার্ভারের জন্য বেশি নির্ভরযোগ্য
        server = smtplib.SMTP('smtp.gmail.com', 587, timeout=10)
        server.starttls() 
        server.login(sender_email, app_password)
        server.send_message(msg)
        server.quit()
    except Exception as e:
        print("SMTP Error logs:", str(e))
        # আটকে না রেখে সরাসরি এররটি স্ক্রিনে পাঠানো
        raise HTTPException(
            status_code=500, 
            detail=f"ইমেইল সার্ভার রেসপন্স করছে না। অনুগ্রহ করে Render-এর Environment Variables-এ EMAIL_PASS (১৬ অক্ষরের কোড স্পেস ছাড়া) ঠিক আছে কিনা পুনরায় যাচাই করুন।"
        )

@app.post("/signup")
def signup(user: UserSignup):
    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?", 
                   (user.username.lower(), user.email.lower()))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="এই ইউজারনেম বা ইমেইল আগে থেকেই আছে।")

    otp = str(random.randint(100000, 999999))
    hashed_pw = hash_password(user.password)
    
    cursor.execute("INSERT INTO users (username, email, password, otp) VALUES (?, ?, ?, ?)",
                   (user.username, user.email, hashed_pw, otp))
    conn.commit()
    conn.close()

    # মেইল পাঠানোর চেষ্টা
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
    
