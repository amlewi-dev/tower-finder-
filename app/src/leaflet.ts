import { OP_COLOR } from "./config";

// Leaflet + OpenStreetMap tiles inside a WebView: no Google Maps API key needed.
// RN -> map:  window.setTowers(list, targetId), window.setUser(fix), window.setTarget(tower|null), window.flyTo(lat, lon, zoom)
// map -> RN:  {type:'ready'} {type:'bounds',s,w,n,e,zoom} {type:'target',id} {type:'nav',id}
export const MAP_HTML = `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  html,body,#map{height:100%;margin:0;background:#09090b;font-family:-apple-system,Roboto,sans-serif}
  .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.95) contrast(.9) saturate(.8)}
  .leaflet-popup-content-wrapper{background:#18181b;color:#fafafa;border-radius:14px;border:1px solid #27272a}
  .leaflet-popup-tip{background:#18181b}
  .leaflet-container a{color:#60a5fa}
  .leaflet-control-attribution{background:rgba(9,9,11,.8)!important;color:#a1a1aa!important;font-size:10px}
  .leaflet-control-attribution a{color:#d4d4d8!important}
  .t{font-size:14px;line-height:1.5;min-width:200px} .t b{font-size:15px} .muted{color:#a1a1aa;font-size:12px}
  .tag{display:inline-block;border-radius:999px;padding:1px 8px;font-size:11px;margin:4px 4px 0 0;border:1px solid #3f3f46}
  .btns{display:flex;gap:8px;margin-top:10px}
  .btns button{flex:1;border:0;border-radius:10px;padding:10px 6px;font-weight:600;font-size:13px}
  .go{background:#22c55e;color:#052e16} .nav{background:#27272a;color:#fafafa}
  #locate{position:absolute;right:12px;bottom:110px;z-index:1000;width:48px;height:48px;border-radius:24px;border:1px solid #3f3f46;background:#18181b;color:#fafafa;font-size:22px}
</style></head><body>
<div id="map"></div><button id="locate" aria-label="Center on my location">&#9678;</button>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var COLORS = ${JSON.stringify(OP_COLOR)};
  var DAY = 86400, NOW = Date.now()/1000;
  function post(o){ window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  var map = L.map('map',{preferCanvas:true,zoomControl:false}).setView([-1.286,36.817],14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
  map.attributionControl.addAttribution('Towers: <a href="https://opencellid.org">OpenCelliD</a> CC BY-SA 4.0');
  var layer = L.layerGroup().addTo(map);
  var userMarker = null, userAcc = null, targetLayer = L.layerGroup().addTo(map), last = null, centered = false, target = null;

  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function month(u){ if(!u) return null; var d=new Date(u*1000); return d.toLocaleString('en',{month:'short'})+' '+d.getFullYear(); }

  function popup(t){
    var d = document.createElement('div'); d.className='t';
    var trust = t.source==='community' ? 'Community photo' : t.source==='osm' ? 'Mapped mast (OSM)' : (t.osm ? 'OSM mast + OpenCelliD' : 'Estimated from cell data');
    var tags = '<span class="tag">'+esc(trust)+'</span>';
    if (t.first && NOW-t.first < 540*DAY) tags += '<span class="tag" style="color:#60a5fa;border-color:#1d4ed8">New</span>';
    else if (t.last && NOW-t.last > 365*DAY) tags += '<span class="tag" style="color:#f87171;border-color:#991b1b">Not seen 12+ months</span>';
    var seen = [month(t.first)&&('first '+month(t.first)), month(t.last)&&('last '+month(t.last))].filter(Boolean).join(' &middot; ');
    d.innerHTML = '<b>'+esc(t.op)+'</b>'+(t.name?' &middot; '+esc(t.name):'')+'<br>'+tags
      + '<br><span class="muted">'+(t.radios&&t.radios.length?esc(t.radios.join(' / '))+' &middot; ':'')+(t.cells?t.cells+' cells &middot; ':'')+'&plusmn;'+(t.acc_m||'?')+' m</span>'
      + (seen?'<br><span class="muted">Seen '+seen+'</span>':'')
      + (t.note?'<br>'+esc(t.note):'')
      + '<div class="btns"><button class="go">Point to it</button><button class="nav">Directions</button></div>';
    d.querySelector('.go').onclick=function(){ map.closePopup(); post({type:'target',id:t.id}); };
    d.querySelector('.nav').onclick=function(){ post({type:'nav',id:t.id}); };
    return d;
  }

  function sendBounds(){
    var b = map.getBounds();
    post({type:'bounds', s:b.getSouth(), w:b.getWest(), n:b.getNorth(), e:b.getEast(), zoom:map.getZoom()});
  }
  map.on('moveend', sendBounds);

  window.setTowers = function(list, targetId){
    layer.clearLayers();
    list.forEach(function(t){
      var isT = t.id===targetId, comm = t.source==='community', mast = t.osm || t.source==='osm';
      L.circleMarker([t.lat,t.lon],{
        radius: isT?11:(mast||comm?7:5),
        color: comm?'#fbbf24':(mast?'#fafafa':'#18181b'),
        weight: isT?3:(mast||comm?2:1),
        fillColor: COLORS[t.op]||'#a1a1aa', fillOpacity: .9
      }).bindPopup(function(){ return popup(t); }).addTo(layer);
    });
  };

  function drawTarget(){
    targetLayer.clearLayers();
    if (!target) return;
    L.circle([target.lat,target.lon],{radius:Math.max(target.acc_m||15,15),color:COLORS[target.op]||'#a1a1aa',weight:1,dashArray:'4 4',fillOpacity:.08}).addTo(targetLayer);
    if (last) L.polyline([[last.lat,last.lon],[target.lat,target.lon]],{color:'#fafafa',weight:2,dashArray:'6 6',opacity:.8}).addTo(targetLayer);
  }
  window.setTarget = function(t){ target = t; drawTarget(); };

  window.setUser = function(u){
    if (!u) return;
    last = u;
    var ll = [u.lat,u.lon];
    if (!userMarker) {
      userAcc = L.circle(ll,{radius:u.accuracy||0,color:'#60a5fa',weight:1,fillOpacity:.12,interactive:false}).addTo(map);
      userMarker = L.circleMarker(ll,{radius:8,color:'#fff',weight:3,fillColor:'#3b82f6',fillOpacity:1,interactive:false}).addTo(map);
    } else { userMarker.setLatLng(ll); userAcc.setLatLng(ll).setRadius(u.accuracy||0); }
    if (!centered) { centered = true; map.setView(ll, 15); }
    drawTarget();
  };

  window.flyTo = function(lat, lon, zoom){ map.flyTo([lat,lon], zoom || Math.max(map.getZoom(),15), {duration:.6}); };
  document.getElementById('locate').onclick = function(){ if(last) map.flyTo([last.lat,last.lon],16,{duration:.6}); };
  post({type:'ready'});
  sendBounds();
</script></body></html>`;
