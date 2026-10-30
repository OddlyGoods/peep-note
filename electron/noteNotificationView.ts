import { NOTE_NOTIFICATION_FADE_MS } from '../shared/noteNotification'

// Note text is delivered through the minimal preload and assigned with textContent.
// This document never embeds user content or loads external resources.
export const noteNotificationHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:transparent!important;overflow:hidden;color-scheme:normal}
body{padding:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;opacity:1;transition:opacity ${NOTE_NOTIFICATION_FADE_MS}ms ease}
body.leaving{opacity:0;pointer-events:none}
#card{position:relative;height:100%;border:1px solid rgba(99,102,241,.5);border-radius:18px;background:rgba(245,243,255,.98);box-shadow:0 6px 16px rgba(79,70,229,.13);color:#1e293b;overflow:hidden}
button{font:inherit;border:0;cursor:pointer}#open{display:flex;align-items:center;gap:12px;width:100%;height:100%;padding:16px 18px;background:transparent;text-align:left;color:inherit}
.icon{width:36px;height:36px;border-radius:12px;background:#e0e7ff;display:grid;place-items:center;flex:none;color:#6d28d9}
.icon svg{width:22px;height:22px}.text{min-width:0;flex:1}#metadata{padding-right:12px;font-size:10px;line-height:16px;color:#5b5fc7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#title{font-size:14px;font-weight:600;line-height:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#preview{font-size:11px;line-height:17px;color:#64748b;white-space:pre-line;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
#dismiss{position:absolute;top:7px;right:7px;width:22px;height:22px;display:grid;place-items:center;border-radius:7px;background:transparent;color:#64748b}#dismiss:hover{background:rgba(124,58,237,.12);color:#7c3aed}#dismiss svg{width:12px;height:12px}
body[data-theme=dark] #card{background:linear-gradient(120deg,#292d68,#2c2256);border-color:rgba(165,180,252,.65);color:#f8fafc;box-shadow:0 6px 16px rgba(0,0,0,.3)}
body[data-theme=dark] .icon{background:rgba(139,92,246,.18);color:#c4b5fd}body[data-theme=dark] #metadata{color:#a5b4fc}body[data-theme=dark] #preview,body[data-theme=dark] #dismiss{color:#aab3ca}
</style></head><body><div id="card" role="status">
<button id="open"><span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h8M8 9h2"/></svg></span>
<span class="text"><div id="metadata"></div><div id="title"></div><div id="preview"></div></span></button>
<button id="dismiss" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
<script>
const bridge=window.noteNotification;
document.getElementById('open').addEventListener('click',()=>bridge.open());
document.getElementById('dismiss').addEventListener('click',()=>bridge.dismiss());
bridge.onShow(value=>{
 document.documentElement.lang=value.language;
 document.body.dataset.theme=value.theme;
 document.body.classList.remove('leaving');
 for(const key of ['metadata','title','preview']) document.getElementById(key).textContent=value[key];
 document.getElementById('dismiss').setAttribute('aria-label',value.close);
});
bridge.onFade(()=>document.body.classList.add('leaving'));
</script></body></html>`
