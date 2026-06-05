// Craps PWA — Service Worker. Network-first for the app shell so redeploys
// reach returning visitors immediately; cache-first for static assets.
var CACHE = 'craps-v1';
var FILES = ['./', './index.html', './sw.js', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){
    return Promise.all(FILES.map(function(f){ return c.add(f).catch(function(){}); }));
  }));
  self.skipWaiting();
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));
  }));
  self.clients.claim();
});
function isShell(req){ return req.mode==='navigate' || (req.headers.get('accept')||'').indexOf('text/html')!==-1; }
self.addEventListener('fetch', function(e){
  var req=e.request; if(req.method!=='GET')return;
  if(isShell(req)){
    e.respondWith(fetch(req).then(function(res){
      if(res&&res.status===200&&res.type==='basic'){ var cl=res.clone(); caches.open(CACHE).then(function(c){c.put(req,cl);}); }
      return res;
    }).catch(function(){ return caches.match(req).then(function(c){ return c||caches.match('./index.html').then(function(i){return i||caches.match('./');}); }); }));
    return;
  }
  e.respondWith(caches.match(req).then(function(c){ return c||fetch(req).then(function(res){
    if(res&&res.status===200&&res.type==='basic'){ var cl=res.clone(); caches.open(CACHE).then(function(cc){cc.put(req,cl);}); }
    return res;
  }); }));
});
