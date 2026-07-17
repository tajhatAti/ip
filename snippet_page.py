"""
snippet_page.py — Builds the standalone "running" static page for a shared
code snippet (the /s/<token> view), GitHub-style.

Why a separate module: the page is large and mixes CSS/JS with no Python
interpolation. Keeping it here keeps app.py readable.

Security model
--------------
The snippet's raw content is NEVER interpolated into HTML or JavaScript.
Instead it is JSON-encoded into a <script type="application/json"> block and
the page's own JS reads it and renders it (highlight, or run inside a
sandboxed iframe). That makes the view safe against arbitrary user code while
still letting HTML/CSS/JS/markdown actually run/preview.

Runnable languages (rendered live in a sandboxed iframe, like GitHub):
    html, css, javascript (js), markdown (md)
All other languages are shown with syntax highlighting only.
"""
import json
from datetime import datetime


# Languages we can render live in the preview pane.
RUNNABLE = {"html", "css", "javascript", "js", "markdown", "md"}


_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>__TITLE__ — Ahad</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  :root{--bg:#0b0d14;--card:rgba(255,255,255,.03);--border:rgba(255,255,255,.08);--border2:rgba(255,255,255,.16);--text:#ecedf3;--muted:#9499ad;--muted2:#626779;--brand:#a5b4fc;--grad:linear-gradient(120deg,#6366f1,#a855f7);--ok:#22d3ee;}
  html,body{height:100%;}
  body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;display:flex;flex-direction:column;
    background-image:radial-gradient(900px 600px at 10% -10%,rgba(99,102,241,.18),transparent 60%),radial-gradient(760px 480px at 95% 0%,rgba(168,85,247,.12),transparent 55%);background-attachment:fixed;}
  .topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 20px;border-bottom:1px solid var(--border);background:rgba(11,13,20,.7);backdrop-filter:blur(14px);flex-wrap:wrap;position:sticky;top:0;z-index:10;}
  .brand{display:flex;align-items:center;gap:10px;cursor:pointer;}
  .mark{width:32px;height:32px;border-radius:9px;background:var(--grad);display:grid;place-items:center;font-weight:800;font-size:12px;color:#fff;}
  .brand span{font-weight:700;font-size:15px;}
  .actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
  .btn{padding:8px 14px;border:none;border-radius:9px;font-family:inherit;font-weight:600;font-size:12.5px;cursor:pointer;color:#fff;transition:transform .15s;display:inline-flex;align-items:center;gap:6px;}
  .btn:hover{transform:translateY(-1px);}
  .btn-grad{background:var(--grad);}
  .btn-ghost{background:rgba(255,255,255,.06);border:1px solid var(--border2);}
  .btn-ghost:hover{background:rgba(255,255,255,.12);}
  .title-row{display:flex;align-items:center;gap:12px;padding:18px 20px 6px;flex-wrap:wrap;max-width:100%;}
  h1{font-size:19px;font-weight:700;word-break:break-word;}
  .lang{font-family:'JetBrains Mono',monospace;font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;padding:4px 10px;background:rgba(99,102,241,.15);color:var(--brand);border-radius:20px;}
  .views{font-size:12px;color:var(--muted2);margin-left:auto;}
  .tabs{display:flex;gap:4px;padding:0 20px;margin-top:10px;}
  .tab{padding:8px 16px;background:none;border:none;border-bottom:2px solid transparent;color:var(--muted);font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer;transition:color .2s,border-color .2s;}
  .tab:hover{color:var(--text);}
  .tab.active{color:var(--text);border-bottom-color:#6366f1;}
  .stage{flex:1;padding:14px 20px 24px;display:flex;min-height:0;}
  .pane{display:none;flex:1;background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;min-height:60vh;}
  .pane.active{display:flex;flex-direction:column;}
  .code-scroll{flex:1;overflow:auto;border-radius:0!important;}
  pre{margin:0!important;border-radius:0!important;min-height:100%;}
  pre code{font-family:'JetBrains Mono',monospace!important;font-size:13.5px!important;line-height:1.75!important;padding:22px!important;display:block;}
  iframe.preview{flex:1;width:100%;border:none;background:#fff;border-radius:0;}
  .no-preview{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--muted2);padding:60px 20px;text-align:center;}
  .no-preview .big{font-size:40px;opacity:.5;}
  .console{flex:1;overflow:auto;background:#0a0c12;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.7;padding:16px;color:#aeb4c8;display:flex;flex-direction:column;}
  .console .ln{white-space:pre-wrap;word-break:break-word;}
  .console .err{color:#f87171;}
  .console .info{color:var(--ok);}
  .console .dim{color:var(--muted2);}
  .foot{text-align:center;padding:18px;font-size:11.5px;color:var(--muted2);}
  .foot a{color:var(--brand);text-decoration:none;}
  .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--ok);color:#062a28;padding:11px 22px;border-radius:30px;font-weight:600;font-size:13px;opacity:0;transition:opacity .25s,transform .25s;pointer-events:none;z-index:50;}
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
  .fs-btn .fs-exit{display:none;}
  body.fullscreen .topbar,body.fullscreen .title-row,body.fullscreen .tabs,body.fullscreen .foot{display:none;}
  body.fullscreen .stage{padding:0;}
  body.fullscreen .pane{border:none;border-radius:0;}
  body.fullscreen .fs-btn .fs-go{display:none;}
  body.fullscreen .fs-btn .fs-exit{display:inline;}
  @media(max-width:640px){.topbar{padding:11px 14px;}.title-row,.tabs,.stage{padding-left:14px;padding-right:14px;}.stage{padding-top:10px;}h1{font-size:16px;}.views{width:100%;margin-left:0;}pre code{font-size:12.5px!important;padding:16px!important;}}
</style>
</head>
<body>
<script type="application/json" id="data">__DATA__</script>
<div class="topbar">
  <div class="brand" onclick="location.href='/'"><div class="mark">AC</div><span>Ahad Co</span></div>
  <div class="actions">
    <button class="btn btn-ghost fs-btn" id="fsBtn"><span class="fs-go">⛶ Fullscreen</span><span class="fs-exit">⛶ Exit</span></button>
    <button class="btn btn-ghost" id="dlBtn">⬇ Download</button>
    <button class="btn btn-grad" id="copyBtn">📋 Copy code</button>
  </div>
</div>
<div class="title-row">
  <h1 id="title">…</h1>
  <span class="lang" id="langBadge">text</span>
  <span class="views" id="views"></span>
</div>
<div class="tabs" id="tabs"></div>
<div class="stage">
  <div class="pane active" id="paneCode"><div class="code-scroll"><pre><code id="code"></code></pre></div></div>
  <div class="pane" id="panePreview"></div>
  <div class="pane" id="paneConsole"><div class="console" id="consoleBox"><div class="dim">Console output will appear here when the code runs.</div></div></div>
</div>
<div class="foot">Rendered live via <a href="/">Ahad Co</a> · private share link</div>
<div class="toast" id="toast">Copied!</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-core.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script>
(function(){
  var DATA = JSON.parse(document.getElementById('data').textContent);
  var body = DATA.content || '';
  var lang = (DATA.language || 'text').toLowerCase();
  var isMd = lang === 'markdown' || lang === 'md';
  var isHtml = lang === 'html';
  var isCss = lang === 'css';
  var isJs = lang === 'javascript' || lang === 'js';
  var runnable = !!DATA.runnable;

  document.getElementById('title').textContent = DATA.title;
  document.getElementById('langBadge').textContent = lang;
  document.getElementById('views').textContent = DATA.views + ' views' + (DATA.created ? (' · ' + DATA.created) : '');

  var codeEl = document.getElementById('code');
  codeEl.textContent = body;
  codeEl.className = 'language-' + (lang === 'js' ? 'javascript' : (lang === 'md' ? 'markdown' : lang));
  if (window.Prism) Prism.highlightElement(codeEl);

  var tabs = document.getElementById('tabs');
  function addTab(id, label){ var b=document.createElement('button'); b.className='tab'; b.dataset.pane=id; b.textContent=label; tabs.appendChild(b); return b; }
  addTab('paneCode', '</> Code');
  if (runnable) addTab('panePreview', '▶ Preview');
  if (isJs) addTab('paneConsole', '≣ Console');

  function previewSrcdoc(){
    if (isHtml) return body;
    if (isCss){
      return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + body + '</style></head>' +
        '<body style="font-family:system-ui,sans-serif;padding:24px;color:#111;background:#fff">' +
        '<h1>Heading</h1><p>Paragraph text to show your <strong>CSS</strong>. <a href="#">A link</a>.</p>' +
        '<button>Button</button><ul><li>Item one</li><li>Item two</li></ul><input placeholder="Input"></body></html>';
    }
    if (isMd){
      var rendered = window.marked ? marked.parse(body) : ('<pre>' + body + '</pre>');
      return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
        'body{font-family:system-ui,-apple-system,sans-serif;padding:32px;max-width:760px;margin:0 auto;color:#1a1a2e;line-height:1.7;background:#fff}' +
        'h1,h2,h3{margin:1.2em 0 .5em;}code{background:#f1f1f4;padding:2px 6px;border-radius:4px;font-size:.9em}pre{background:#f4f4f8;padding:14px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}a{color:#6366f1}blockquote{border-left:3px solid #ddd;margin:0;padding-left:14px;color:#555}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px}' +
        '</style></head><body>' + rendered + '</body></html>';
    }
    if (isJs){
      // Run user JS in the iframe; pipe console.* back to the parent via postMessage.
      var safe = body.split('<\\/script>').join('<\\\\/script>');
      return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
        '<scr' + 'ipt>(function(){var P=function(t,a){parent.postMessage({__jsConsole:true,type:t,msg:Array.prototype.map.call(a,function(x){try{return typeof x==="object"?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(" ")},'*")};' +
        '["log","info","warn","error"].forEach(function(m){console[m]=function(){P(m==="error"?"err":(m==="warn"?"warn":"info"),arguments)}});' +
        'window.onerror=function(msg,src,line,col){P("err",[msg+" (line "+line+")"])};try{\\n' + safe + '\\n}catch(e){P("err",[e.message])}})();<' + '/scr' + 'ipt></body></html>';
    }
    return '';
  }

  var panePreview = document.getElementById('panePreview');
  if (runnable){
    var frame = document.createElement('iframe');
    frame.className = 'preview';
    frame.setAttribute('sandbox','allow-scripts allow-modals');
    panePreview.appendChild(frame);
    window.addEventListener('message', function(ev){
      var d = ev.data;
      if (d && d.__jsConsole) appendConsole(d.type, d.msg);
    });
    window.__runPreview = function(){ frame.srcdoc = previewSrcdoc(); };
    window.__runPreview();
  } else {
    panePreview.innerHTML = '<div class="no-preview"><div class="big">👁️</div><p>Live preview is available for HTML, CSS, JavaScript and Markdown.</p><p>This ' + lang + ' snippet is shown as code only.</p></div>';
  }

  function appendConsole(type, msg){
    var box = document.getElementById('consoleBox');
    if (box.querySelector('.dim')) box.innerHTML = '';
    var ln = document.createElement('div');
    ln.className = 'ln ' + (type === 'err' ? 'err' : (type === 'info' ? 'info' : ''));
    ln.textContent = (type === 'err' ? '✕ ' : (type === 'warn' ? '⚠ ' : '› ')) + msg;
    box.appendChild(ln);
    box.scrollTop = box.scrollHeight;
  }

  tabs.addEventListener('click', function(e){
    var t = e.target.closest('.tab'); if (!t) return;
    document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('active');});
    t.classList.add('active');
    document.querySelectorAll('.pane').forEach(function(p){p.classList.remove('active');});
    var pane = document.getElementById(t.dataset.pane);
    if (pane) pane.classList.add('active');
    if (t.dataset.pane === 'panePreview' && window.__runPreview) window.__runPreview();
  });

  function showToast(msg, ok){
    var t=document.getElementById('toast'); t.textContent=msg;
    t.style.background = ok ? 'var(--ok)' : '#f87171';
    t.style.color = ok ? '#062a28' : '#fff';
    t.classList.add('show'); setTimeout(function(){t.classList.remove('show');},1800);
  }
  document.getElementById('copyBtn').addEventListener('click', function(){
    navigator.clipboard.writeText(body).then(function(){showToast('Copied! ✓',true);}).catch(function(){showToast('Copy failed',false);});
  });
  document.getElementById('dlBtn').addEventListener('click', function(){
    var ext = ({python:'py',javascript:'js',typescript:'ts',html:'html',css:'css',json:'json',bash:'sh',sql:'sql',java:'java',cpp:'cpp',go:'go',php:'php',ruby:'rb',markdown:'md',md:'md',text:'txt'})[lang] || 'txt';
    var blob = new Blob([body], {type:'text/plain'});
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (DATA.title || 'snippet').replace(/[^a-z0-9_-]+/gi,'_') + '.' + ext; a.click();
    URL.revokeObjectURL(a.href);
    showToast('Downloaded ⬇', true);
  });
  document.getElementById('fsBtn').addEventListener('click', function(){
    document.body.classList.toggle('fullscreen');
    if (window.__runPreview) setTimeout(window.__runPreview, 50);
  });
})();
</script>
</body>
</html>"""


def build_share_page(row) -> str:
    """Build the full standalone HTML for a shared snippet.

    `row` is a dict-like with keys: title, language, content, created_at, views.
    Returns a complete HTML document string.
    """
    lang = (row["language"] or "text").lower()
    title = row["title"] or "Shared snippet"
    created = ""
    try:
        created = datetime.fromisoformat(row["created_at"]).strftime("%b %d, %Y")
    except Exception:
        created = ""

    data = json.dumps({
        "title": title,
        "language": lang,
        "content": row["content"] or "",
        "views": row["views"],
        "created": created,
        "runnable": lang in RUNNABLE,
    })

    page = _PAGE.replace("__TITLE__", title)
    page = page.replace("__DATA__", data)
    return page
