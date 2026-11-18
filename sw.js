// =====================================================================
// sw.js - Service Worker con estrategia Cache First
// Autor: Angel Daniel Ocampo Martinez
//
// Es uno de los 3 requisitos de instalabilidad:
//   1. HTTPS (GitHub Pages)
//   2. Service Worker activo que controle el scope   <-- este archivo
//   3. manifest.json válido
// =====================================================================

// Si cambias cualquier archivo del App Shell, sube esta versión (v2, v3...)
// para que el navegador reinstale el SW y no siga sirviendo los archivos viejos.
const CACHE_NAME = 'camara-static-v1';

// App Shell: archivos necesarios para que la app abra sin internet.
// Todas las rutas son RELATIVAS (./) por el subdirectorio de GitHub Pages.
const ARCHIVOS_APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// ---------------------------------------------------------------------
// INSTALL: se ejecuta una vez cuando el navegador detecta un SW nuevo.
// Guardamos (precache) el App Shell.
// ---------------------------------------------------------------------
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando y guardando App Shell...');
  // waitUntil mantiene la instalación "abierta" hasta que la promesa termine
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ARCHIVOS_APP_SHELL))
      .then(() => self.skipWaiting()) // activa el SW nuevo sin esperar a cerrar pestañas
  );
});

// ---------------------------------------------------------------------
// ACTIVATE: borra las cachés de versiones anteriores.
// ---------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  console.log('[SW] Activado');
  event.waitUntil(
    caches.keys()
      .then((nombres) => {
        const viejas = nombres.filter((nombre) => nombre !== CACHE_NAME);
        return Promise.all(viejas.map((nombre) => caches.delete(nombre)));
      })
      .then(() => self.clients.claim()) // toma control de las pestañas abiertas
  );
});

// ---------------------------------------------------------------------
// FETCH: estrategia Cache First
//   1. Busca la petición en la caché.
//   2. Si está, la responde desde ahí (rápido y funciona offline).
//   3. Si no está, va a la red.
// ---------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  // Solo manejamos peticiones GET (la Cache API no guarda POST)
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then((respuestaCache) => {
        return respuestaCache || fetch(event.request);
      })
  );
});
