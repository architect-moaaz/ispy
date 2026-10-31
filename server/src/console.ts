/**
 * The owner's monitoring console: one static page served at /console that polls the admin API.
 * Satellite map (Esri World Imagery, same tiles as the app) with sectors, targets and operatives;
 * Director status, operatives, live missions, chief traffic and the event feed. Vanilla JS, Leaflet
 * from cdnjs. If ADMIN_TOKEN is set on the server the page asks for it once and keeps it locally.
 */
export const CONSOLE_HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>iSpy Console</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
:root{--bg:#06090d;--panel:#0b1218;--line:#143040;--cyan:#38e1ff;--dim:#7fa6b3;--text:#d7e6ec;--amber:#ffb347;--red:#ff5d6c;--green:#5dffb0}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:13px/1.4 ui-monospace,Menlo,Consolas,monospace}
header{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--panel)}
header h1{font-size:14px;letter-spacing:.2em;margin:0;color:var(--cyan)}header .pill{padding:2px 8px;border:1px solid var(--line);border-radius:3px;color:var(--dim)}
header .pill b{color:var(--text)}header button{margin-left:auto}
button{background:transparent;color:var(--cyan);border:1px solid var(--cyan);padding:4px 10px;font:inherit;letter-spacing:.08em;cursor:pointer}button:hover{background:#38e1ff22}
button.warn{color:var(--amber);border-color:var(--amber)}
main{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);grid-template-rows:auto;gap:10px;padding:10px}
#map{height:52vh;border:1px solid var(--line)}
section{background:var(--panel);border:1px solid var(--line);padding:10px;min-height:120px}
section h2{margin:0 0 8px;font-size:11px;letter-spacing:.2em;color:var(--dim);text-transform:uppercase}
table{width:100%;border-collapse:collapse}td,th{padding:3px 6px;text-align:left;border-bottom:1px solid #0f1f29;vertical-align:top}th{color:var(--dim);font-weight:normal;font-size:11px}
.feed{max-height:40vh;overflow:auto}.feed div{padding:3px 0;border-bottom:1px solid #0f1f29}.feed .t{color:var(--dim);margin-right:8px}
.k{color:var(--cyan)}.a{color:var(--amber)}.r{color:var(--red)}.g{color:var(--green)}.muted{color:var(--dim)}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.thought{white-space:pre-wrap;color:var(--text);background:#07151c;border-left:2px solid var(--cyan);padding:6px 8px;margin:6px 0}
.leaflet-container{background:#000}.op-ico{width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 8px #000}
@media(max-width:900px){main{grid-template-columns:1fr}#map{height:40vh}}
</style></head><body>
<header><h1>iSPY CONSOLE</h1>
<span class="pill">world <b id="h-paused">…</b></span><span class="pill">brain <b id="h-brain">…</b></span><span class="pill">llm <b id="h-llm">…</b></span>
<span class="pill">operatives <b id="h-ops">0</b></span><span class="pill">stream <b id="h-stream">0</b></span><span class="pill">push <b id="h-push">0</b></span>
<span class="pill muted" id="h-updated"></span>
<button id="b-pause" class="warn">PAUSE</button><button id="b-tick">FORCE TICK</button><button id="b-dispatch">DISPATCH</button><button id="b-key">KEY</button></header>
<main>
<div style="display:grid;gap:10px"><div id="map"></div>
<section><h2>World Director</h2><div class="row" id="balance"></div><div class="thought" id="thought">…</div><div class="feed" id="decisions" style="max-height:40vh"></div></section>
<section><h2>Chaos · crises and back-channel talks</h2><div id="crises" class="feed" style="max-height:60vh"></div></section>
<section><h2>Funnel</h2><div class="row" id="funnel"></div></section>
<section><h2>Parameters</h2><table id="params"></table></section></div>
<div style="display:grid;gap:10px">
<section><h2>Sectors</h2><table id="sectors"></table><div class="muted" style="margin-top:6px">Click the map to open a sector there (owner action).</div></section>
<section><h2>Operatives</h2><table id="ops"></table></section>
<section><h2>Operations</h2><table id="operations"></table></section>
<section><h2>Live missions</h2><table id="missions"></table></section>
<section><h2>Chief traffic</h2><div class="feed" id="chat" style="max-height:24vh"></div></section>
<section><h2>Event feed</h2><div class="feed" id="events"></div></section>
</div></main>
<script>
const $=(id)=>document.getElementById(id);
const key=()=>localStorage.getItem('ispy-admin-key')||'';
const hdr=()=>key()?{'x-admin-key':key()}:{};
async function api(path,opts={}){const r=await fetch(path,{...opts,headers:{'content-type':'application/json',...hdr(),...(opts.headers||{})}});
 if(r.status===401){const k=prompt('Admin key (ADMIN_TOKEN on the server):');if(k){localStorage.setItem('ispy-admin-key',k);return api(path,opts)}throw new Error('unauthorised')}
 if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||r.statusText);return r.json()}
const map=L.map('map',{zoomControl:true}).setView([12.9757,77.5952],14);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Esri'}).addTo(map);
const layers={sectors:L.layerGroup().addTo(map),targets:L.layerGroup().addTo(map),ops:L.layerGroup().addTo(map)};
const FCOL={raven:'#38e1ff',phantom:'#c77dff',cipher:'#5dffb0'};
let fitted=false;
const esc=(s)=>String(s??'').replace(/[&<>]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const t=(iso)=>iso?new Date(iso).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'';
const ago=(iso)=>{const m=Math.round((Date.now()-Date.parse(iso))/60000);return m<1?'now':m<60?m+'m':Math.round(m/60)+'h'};
function render(o){
 $('h-paused').textContent=o.world.paused?'PAUSED':'live';$('h-paused').className=o.world.paused?'r':'g';
 $('h-brain').textContent=o.director.brain.mode;$('h-llm').textContent=o.world.llm?'on':'off';
 $('h-ops').textContent=o.operatives.length;$('h-stream').textContent=o.push.streamClients;$('h-push').textContent=o.push.tokens??o.push.registered??'-';
 $('h-updated').textContent='updated '+t(new Date().toISOString());$('b-pause').textContent=o.world.paused?'RESUME':'PAUSE';
 // map
 layers.sectors.clearLayers();layers.targets.clearLayers();layers.ops.clearLayers();
 const pts=[];
 for(const a of o.sectors){L.circle([a.lat,a.lng],{radius:a.radius_m,color:'#38e1ff',weight:1,fillOpacity:.05}).bindTooltip(a.name).addTo(layers.sectors);pts.push([a.lat,a.lng])}
 for(const tg of o.targets){L.circleMarker([tg.lat,tg.lng],{radius:4,color:tg.inPlay?'#ffb347':'#38e1ff',weight:1,fillOpacity:.8}).bindTooltip(esc(tg.name)+' · '+esc(tg.kind)+(tg.inPlay?' · in play':'')).addTo(layers.targets)}
 for(const p of o.operatives){if(p.lat==null)continue;const ic=L.divIcon({className:'',html:'<div class="op-ico" style="background:'+(FCOL[p.factionId]||'#fff')+'"></div>',iconSize:[14,14]});
  L.marker([p.lat,p.lng],{icon:ic}).bindTooltip(esc(p.codename)+' · '+esc(p.faction)+' · '+esc(p.mode)).addTo(layers.ops);pts.push([p.lat,p.lng])}
 if(!fitted&&pts.length){map.fitBounds(L.latLngBounds(pts).pad(.2));fitted=true}
 // director
 const d=o.director;$('thought').textContent=d.brain.lastThought||(d.brain.mode==='rules'?'Rules mode: no model configured.':'No thought yet. The brain thinks when operatives act.');
 $('balance').innerHTML=d.balance?d.balance.factions.map(f=>'<span class="pill">'+esc(f.name)+' <b>'+f.power+'</b> · '+f.fragments+' frag · '+f.verifiedHour+'/h</span>').join('')+'<span class="pill">leader <b>'+esc(d.balance.leader)+'</b> gap '+d.balance.gap+'</span>':'<span class="muted">no assessment yet</span>';
 $('decisions').innerHTML=d.recent.map(r=>{const det=r.detail;let body='';
  if(det&&typeof det==='object'&&det.assessment){body='<div class="muted" style="margin:2px 0 2px 8px">'+esc(det.assessment)+'</div>'+((det.applied||[]).length?'<div style="margin-left:8px">'+det.applied.map(a=>'<div>→ '+esc(a)+'</div>').join('')+'</div>':'<div class="muted" style="margin-left:8px">→ no action</div>')}
  else if(det){body=' <span class="muted">'+esc(typeof det==='string'?det:JSON.stringify(det)).slice(0,240)+'</span>'}
  return '<div><span class="t">'+t(r.at)+'</span><span class="k">'+esc(r.what)+'</span>'+body+'</div>'}).join('');
 // crises with stances, pacts, sites, verdict and the chiefs' back-channel transcript
 const FN={raven:'RAVEN',phantom:'PHANTOM',cipher:'CIPHER'};
 $('crises').innerHTML=(o.crises||[]).map(c=>'<div style="padding:8px 0"><div><span class="a">'+esc(c.name)+'</span> <span class="muted">· '+esc(c.kind)+' · '+esc(c.area||'')+' · '+(c.state==='active'?'<span class="g">live, ends '+t(c.endsAt)+'</span>':esc(c.state)+(c.outcome?' · <b>'+esc(c.outcome.verdict)+'</b>':''))+' · '+esc(c.source)+'</span></div>'
  +'<div class="muted" style="margin:2px 0 4px">'+esc(c.premise||'')+'</div>'
  +'<div>'+Object.entries(c.stances||{}).map(([f,st])=>'<span class="pill" style="color:'+(FCOL[f]||'#fff')+'">'+FN[f]+' · '+esc(st)+'</span>').join(' ')+(c.pacts&&c.pacts.length?' <span class="pill a">pact: '+esc(c.pacts.map(p=>p.map(f=>FN[f]).join('+')).join(', '))+'</span>':'')+'</div>'
  +'<div style="margin-top:4px">'+(c.sites||[]).map(s=>'<span class="pill">'+esc(s.name)+' · <span style="color:'+(s.claimedBy?FCOL[s.claimedBy]:'var(--dim)')+'">'+(s.claimedBy?FN[s.claimedBy]:'open')+'</span></span>').join(' ')+'</div>'
  +(c.outcome&&c.outcome.epilogue?'<div class="thought" style="margin:6px 0">'+esc(c.outcome.epilogue)+'</div>':'')
  +((c.talks&&c.talks.length)?'<div style="margin-top:6px;border-left:2px solid #1d3a4a;padding-left:8px">'+c.talks.map(k=>'<div><span class="t">'+t(k.at)+'</span><span style="color:'+(FCOL[k.fromId]||'#fff')+'">'+esc(k.from)+'</span>'+(k.to?' <span class="muted">→ '+esc(k.to)+'</span>':'')+' <span class="muted">['+esc(k.kind)+']</span> '+esc(k.text)+'</div>').join('')+'</div>':'')
  +'</div>').join('')||'<div class="muted">no crisis yet; the Director brews one when operatives are in the field</div>';
 const fu=o.funnel||{};
 $('funnel').innerHTML=[['registered',fu.registered],['assessed',fu.assessed],['recruited',fu.recruited],['first desk win',fu.firstDesk],['first field win',fu.firstField],['returned (2+ days)',fu.returned],['active today',fu.activeToday],['sector-hours today',fu.sectorHoursToday]].map(([k,v])=>'<span class="pill">'+k+' <b>'+(v??0)+'</b></span>').join('');
 $('operations').innerHTML='<tr><th>operation</th><th>operative</th><th>agency</th><th>link</th><th>state</th><th>age</th></tr>'+((o.operations||[]).map(c=>'<tr><td>'+esc(c.name)+'</td><td>'+esc(c.codename)+'</td><td>'+esc(c.faction)+'</td><td>'+c.step+'/'+c.of+'</td><td>'+esc(c.state)+' <span class="muted">'+esc(c.source)+'</span></td><td class="muted">'+ago(c.createdAt)+'</td></tr>').join('')||'<tr><td class="muted" colspan="6">none yet</td></tr>');
 $('params').innerHTML=Object.entries(d.params).map(([k,v])=>'<tr><td class="muted">'+esc(k)+'</td><td>'+esc(v)+'</td></tr>').join('');
 $('sectors').innerHTML='<tr><th>sector</th><th>city</th><th>targets</th><th>pool</th><th>ops</th></tr>'+o.sectors.map(a=>'<tr><td>'+esc(a.name)+'</td><td class="muted">'+esc(a.city)+'</td><td>'+a.targets+'</td><td>'+a.pool+'</td><td>'+a.operatives+'</td></tr>').join('');
 $('ops').innerHTML='<tr><th>codename</th><th>agency</th><th>mode</th><th>sector</th><th>deployed</th><th>fix</th><th>work</th></tr>'+(o.operatives.map(p=>'<tr><td style="color:'+(FCOL[p.factionId]||'#fff')+'">'+esc(p.codename)+'</td><td>'+esc(p.faction)+'</td><td>'+esc(p.mode)+'</td><td>'+esc(p.area||'—')+'</td><td>'+ago(p.checkedInAt)+'</td><td class="muted">'+(p.lastFixAt?ago(p.lastFixAt):'—')+'</td><td>'+(p.activeMission?'<span class="a">'+esc(p.activeMission)+'</span>':p.openOffers?p.openOffers+' offers':'<span class="muted">idle</span>')+'</td></tr>').join('')||'<tr><td class="muted" colspan="7">nobody deployed</td></tr>');
 $('missions').innerHTML='<tr><th>mission</th><th>agency</th><th>operative</th><th>target</th><th>state</th><th>age</th></tr>'+(o.missions.map(m=>'<tr><td>'+esc(m.title)+(m.contested?' <span class="a">⚔</span>':'')+'</td><td style="color:'+(FCOL[m.factionId]||'#fff')+'">'+esc(m.faction)+'</td><td>'+esc(m.assignee||'—')+'</td><td class="muted">'+esc(m.target||'desk')+'</td><td>'+esc(m.state)+'</td><td class="muted">'+ago(m.createdAt)+'</td></tr>').join('')||'<tr><td class="muted" colspan="6">nothing live</td></tr>');
 $('chat').innerHTML=o.chat.map(c=>'<div><span class="t">'+t(c.at)+'</span><span style="color:'+(FCOL[c.factionId]||'#fff')+'">'+esc(c.role==='chief'?c.chief:c.codename)+'</span> → <span class="muted">'+esc(c.role==='chief'?c.codename:c.chief)+'</span>: '+esc(c.text)+'</div>').join('')||'<div class="muted">no traffic yet</div>';
 $('events').innerHTML=o.events.map(e=>{const cls=/flagged|rejected|failed|paused/.test(e.type)?'r':/verified|confirmed|completed|opened|settled/.test(e.type)?'g':/director|sector|world_param/.test(e.type)?'k':'';
  return '<div><span class="t">'+t(e.at)+'</span><span class="'+cls+'">'+esc(e.type)+'</span> <span class="muted">'+esc(e.actor)+(e.codename?' · '+e.codename:'')+'</span> '+esc(JSON.stringify(e.payload)).slice(0,160)+'</div>'}).join('');
}
async function refresh(){try{render(await api('/v1/admin/overview'))}catch(e){$('h-updated').textContent=String(e.message||e)}}
$('b-pause').onclick=async()=>{const o=await api('/v1/admin/overview');await api('/v1/admin/pause',{method:'POST',body:JSON.stringify({paused:!o.world.paused})});refresh()};
$('b-tick').onclick=async()=>{await api('/v1/admin/tick',{method:'POST'});refresh()};
$('b-dispatch').onclick=async()=>{await api('/v1/admin/dispatch',{method:'POST'});refresh()};
$('b-key').onclick=()=>{const k=prompt('Admin key (blank to clear):',key());if(k===null)return;k?localStorage.setItem('ispy-admin-key',k):localStorage.removeItem('ispy-admin-key');refresh()};
map.on('click',async(e)=>{if(!confirm('Open a sector at '+e.latlng.lat.toFixed(5)+', '+e.latlng.lng.toFixed(5)+'?'))return;
 await api('/v1/admin/areas/open',{method:'POST',body:JSON.stringify({lat:e.latlng.lat,lng:e.latlng.lng})});fitted=false;refresh()});
refresh();setInterval(refresh,5000);
</script></body></html>`;
