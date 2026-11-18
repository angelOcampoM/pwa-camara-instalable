// =====================================================================
// app.js - Instalabilidad + acceso ético a la cámara (Pre-Permiso UX)
// Autor: Angel Daniel Ocampo Martinez
//
// Regla del curso: toda la asincronía se maneja únicamente con Promesas
// encadenadas: .then(), .catch() y .finally().
//
// Índice:
//   1. Referencias al DOM y estado global
//   2. Registro del Service Worker
//   3. Instalación: beforeinstallprompt (Chrome / Android)
//   4. Instalación: instrucciones manuales para iOS
//   5. Cámara: liberar el hardware (detenerCamaraActiva)
//   6. Cámara: encender con getUserMedia (iniciarCamara)
//   7. Pre-Permiso: aviso ético antes del diálogo nativo
//   8. Controles: alternar y apagar
//   9. Liberar la cámara al salir de la app
// =====================================================================


// =====================================================================
// 1. REFERENCIAS AL DOM Y ESTADO GLOBAL
// =====================================================================
const btnInstalar = document.getElementById('btn-instalar');
const avisoIos = document.getElementById('aviso-ios');

const visorVideo = document.getElementById('visor-camara');
const visorVacio = document.getElementById('visor-vacio');
const hud = document.getElementById('hud');               // indicadores sobre el video
const hudLente = document.getElementById('hud-lente');
const estadoCamara = document.getElementById('estado-camara');

const btnPrepararCamara = document.getElementById('btn-preparar-camara');
const avisoPermiso = document.getElementById('aviso-permiso');
const btnConfirmarPermiso = document.getElementById('btn-confirmar-permiso');
const btnCancelarPermiso = document.getElementById('btn-cancelar-permiso');

const btnAlternarCamara = document.getElementById('btn-alternar-camara');
const btnApagarCamara = document.getElementById('btn-apagar-camara');

// Guarda el evento beforeinstallprompt para lanzarlo después con nuestro botón
let eventoInstalacionDiferido = null;

// 'environment' = cámara trasera | 'user' = cámara frontal (selfie)
let modoCamaraActual = 'environment';

// Flujo de video activo (MediaStream). Lo guardamos para poder apagarlo después.
let streamActivo = null;

// true cuando el dispositivo no tiene el lente pedido y usamos la cámara que sí existe
let usandoCamaraAlternativa = false;

// Muestra u oculta el visor "apagado" y el HUD según si hay cámara encendida
function actualizarVisor(encendida, texto) {
  visorVacio.hidden = encendida;
  hud.hidden = !encendida;
  if (texto) hudLente.textContent = texto;
}

// Muestra un mensaje en pantalla. tipo: '' | 'ok' | 'error'
function mostrarEstado(mensaje, tipo) {
  estadoCamara.textContent = mensaje;
  estadoCamara.className = 'estado ' + (tipo || '');
}


// =====================================================================
// 2. REGISTRO DEL SERVICE WORKER
// Requisito de instalabilidad. Ruta relativa './sw.js' para que el scope
// sea /pwa-camara-instalable/ en GitHub Pages (con '/sw.js' daría 404).
// =====================================================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then((registro) => {
      console.log('[SW] Registrado con scope:', registro.scope);
    })
    .catch((error) => {
      console.error('[SW] Error al registrar:', error);
    });
}


// =====================================================================
// 3. INSTALACIÓN EN CHROME / ANDROID (beforeinstallprompt)
// El navegador dispara este evento cuando la app cumple los criterios
// (HTTPS + SW activo + manifest válido). Lo interceptamos para mostrar
// nuestro propio botón en lugar de depender solo del icono de la barra.
// =====================================================================

// ¿La app ya está abierta como app instalada?
//  - display-mode: standalone -> Chrome / Android / escritorio
//  - navigator.standalone      -> propiedad exclusiva de Safari en iOS
function estaInstalada() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}

window.addEventListener('beforeinstallprompt', (evento) => {
  // Evita que Chrome muestre su mini-banner automático
  evento.preventDefault();
  // Guardamos el evento para usarlo cuando el usuario toque NUESTRO botón
  eventoInstalacionDiferido = evento;
  btnInstalar.hidden = false;
  console.log('[Instalación] La app es instalable, se muestra el botón.');
});

btnInstalar.addEventListener('click', () => {
  if (!eventoInstalacionDiferido) return;

  // Muestra el diálogo nativo de instalación
  eventoInstalacionDiferido.prompt();

  // userChoice es una PROMESA que se resuelve cuando el usuario elige
  eventoInstalacionDiferido.userChoice
    .then((resultado) => {
      if (resultado.outcome === 'accepted') {
        console.log('[Instalación] El usuario aceptó instalar la app.');
        btnInstalar.hidden = true;
      } else {
        console.log('[Instalación] El usuario canceló la instalación.');
      }
    })
    .catch((error) => {
      console.error('[Instalación] Error en el diálogo:', error);
    })
    .finally(() => {
      // El evento solo se puede usar UNA vez: lo limpiamos y ocultamos el botón.
      // Si el usuario canceló, Chrome puede volver a disparar beforeinstallprompt
      // más adelante y el botón reaparecerá solo.
      eventoInstalacionDiferido = null;
      btnInstalar.hidden = true;
    });
});

// Se dispara cuando la app terminó de instalarse (por nuestro botón o por el menú del navegador)
window.addEventListener('appinstalled', () => {
  console.log('[Instalación] App instalada correctamente.');
  btnInstalar.hidden = true;
  eventoInstalacionDiferido = null;
});


// =====================================================================
// 4. INSTALACIÓN EN iOS (iPhone / iPad)
// Safari NUNCA dispara beforeinstallprompt, así que #btn-instalar se
// queda oculto. Si es iOS y aún no está instalada, mostramos los pasos
// manuales: Compartir -> Agregar a pantalla de inicio.
// =====================================================================
function esIOS() {
  const ua = window.navigator.userAgent;
  // iPadOS 13+ se identifica como "Macintosh", pero a diferencia de una Mac tiene pantalla táctil
  const esIpadModerno = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iphone|ipad|ipod/i.test(ua) || esIpadModerno;
}

if (esIOS() && !window.navigator.standalone) {
  avisoIos.hidden = false;
}


// =====================================================================
// 5. LIBERAR EL HARDWARE (Fragmento C)
// En el móvil no se puede abrir la cámara frontal mientras la trasera
// sigue transmitiendo: el sistema bloquea el sensor y getUserMedia falla.
// Por eso, antes de pedir un nuevo flujo, detenemos TODAS las pistas.
// =====================================================================
function detenerCamaraActiva() {
  if (streamActivo) {
    // Un MediaStream puede tener varias pistas (video, audio).
    // track.stop() apaga el sensor y la luz indicadora de la cámara.
    streamActivo.getTracks().forEach((track) => {
      track.stop();
      console.log('[Cámara] Pista detenida:', track.kind, track.label);
    });
    streamActivo = null;
  }
}


// =====================================================================
// 6. ENCENDER LA CÁMARA (Fragmento D)
// getUserMedia() solo existe en contextos seguros (HTTPS o localhost)
// y devuelve una PROMESA con el MediaStream.
// =====================================================================

// Pide el video con la restricción facingMode.
// - Primero se pide con { exact: modo }: si el dispositivo no tiene ese lente
//   la promesa se rechaza con OverconstrainedError / NotFoundError.
// - En ese caso (por ejemplo, una laptop con una sola webcam) se reintenta con
//   cualquier cámara disponible para no dejar al usuario sin vista previa.
function solicitarVideo(modo) {
  const restricciones = {
    video: { facingMode: { exact: modo } },
    audio: false // solo necesitamos imagen; nunca pedimos el micrófono
  };

  usandoCamaraAlternativa = false;

  return navigator.mediaDevices.getUserMedia(restricciones)
    .catch((error) => {
      if (error.name === 'OverconstrainedError' || error.name === 'NotFoundError') {
        console.warn('[Cámara] No existe el lente "' + modo + '". Se usa la cámara disponible.');
        mostrarEstado('Este dispositivo no tiene cámara ' + nombreCamara(modo) + '. Usando la cámara disponible...');
        usandoCamaraAlternativa = true;
        return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      // Cualquier otro error (por ejemplo, permiso denegado) se pasa al .catch de iniciarCamara
      throw error;
    });
}

function nombreCamara(modo) {
  return modo === 'user' ? 'frontal' : 'trasera';
}

function iniciarCamara(modo) {
  // Validación: la API no existe si la página no está en HTTPS o el navegador es muy viejo
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    mostrarEstado('Tu navegador no permite usar la cámara. Abre la app desde HTTPS (GitHub Pages).', 'error');
    return Promise.resolve(false);
  }

  // 1. Liberar el sensor anterior ANTES de pedir el nuevo
  detenerCamaraActiva();

  // Bloqueamos los botones mientras se enciende para evitar doble clic
  btnAlternarCamara.disabled = true;
  btnApagarCamara.disabled = true;
  mostrarEstado('Encendiendo cámara ' + nombreCamara(modo) + '...');

  // 2. Pedir el nuevo flujo
  return solicitarVideo(modo)
    .then((stream) => {
      streamActivo = stream;
      // 3. Conectar el flujo al <video>. srcObject recibe un MediaStream (no una URL)
      visorVideo.srcObject = stream;
      // La cámara frontal se muestra como espejo (más natural para una selfie)
      visorVideo.classList.toggle('espejo', modo === 'user');
      // play() devuelve una promesa en navegadores modernos (en iOS es necesario llamarlo)
      return visorVideo.play();
    })
    .then(() => {
      actualizarVisor(true, usandoCamaraAlternativa ? 'ÚNICA CÁMARA' : nombreCamara(modo).toUpperCase());
      btnPrepararCamara.hidden = true;
      if (usandoCamaraAlternativa) {
        mostrarEstado('No hay cámara ' + nombreCamara(modo) + '; se muestra la única cámara disponible. El video solo se ve en tu dispositivo.', 'ok');
      } else {
        mostrarEstado('Cámara ' + nombreCamara(modo) + ' activa. El video solo se ve en tu dispositivo.', 'ok');
      }
      return true;
    })
    .catch((error) => {
      // Diagnóstico de errores según error.name
      console.error('[Cámara] Error:', error.name, error.message);
      detenerCamaraActiva();
      visorVideo.srcObject = null;
      actualizarVisor(false);
      btnPrepararCamara.hidden = false;

      if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
        // El usuario pulsó "Bloquear" (o el permiso ya estaba bloqueado)
        mostrarEstado('Permiso denegado. Para usar la cámara, habilítala en la configuración del sitio de tu navegador (icono 🔒 junto a la URL).', 'error');
      } else if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
        // El dispositivo no tiene ninguna cámara
        mostrarEstado('No se encontró ninguna cámara en este dispositivo.', 'error');
      } else if (error.name === 'NotReadableError') {
        // El sensor está ocupado (otra app o pestaña lo está usando)
        mostrarEstado('La cámara está siendo usada por otra aplicación. Ciérrala e inténtalo de nuevo.', 'error');
      } else {
        mostrarEstado('No se pudo encender la cámara (' + error.name + ').', 'error');
      }
      return false;
    })
    .finally(() => {
      // Pase lo que pase, los controles se reactivan solo si hay un flujo activo
      const hayCamara = streamActivo !== null;
      btnAlternarCamara.disabled = !hayCamara;
      btnApagarCamara.disabled = !hayCamara;
    });
}


// =====================================================================
// 7. PRE-PERMISO UX (Fragmento E)
// Separamos la INTENCIÓN del usuario de la llamada real al hardware:
//   Clic 1 (#btn-preparar-camara): solo muestra el aviso explicativo.
//   Clic 2 (#btn-confirmar-permiso): consentimiento consciente -> getUserMedia.
// Así el usuario entiende para qué es el permiso y no lo bloquea por
// sorpresa. Si lo bloquea, JS ya no puede volver a mostrar el diálogo.
// =====================================================================
btnPrepararCamara.addEventListener('click', () => {
  // Mejora opcional: si el navegador soporta la Permissions API, revisamos
  // si el permiso ya estaba bloqueado para explicar cómo desbloquearlo
  // (mostrar el aviso no serviría: el diálogo nativo ya no aparecería).
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'camera' })
      .then((permiso) => {
        if (permiso.state === 'denied') {
          mostrarEstado('El permiso de cámara está bloqueado. Actívalo en la configuración del sitio (icono 🔒 junto a la URL) y recarga la página.', 'error');
        } else {
          mostrarAvisoPermiso();
        }
      })
      .catch(() => {
        // Algunos navegadores (Firefox, Safari antiguo) no aceptan { name: 'camera' }
        mostrarAvisoPermiso();
      });
  } else {
    mostrarAvisoPermiso();
  }
});

function mostrarAvisoPermiso() {
  avisoPermiso.hidden = false;
  btnPrepararCamara.hidden = true;
  mostrarEstado('Lee el aviso antes de activar la cámara.');
  avisoPermiso.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Segundo clic: el usuario ya leyó el aviso y confirma conscientemente
btnConfirmarPermiso.addEventListener('click', () => {
  avisoPermiso.hidden = true;
  iniciarCamara(modoCamaraActual);
});

// El usuario decide no activarla: no se pide ningún permiso
btnCancelarPermiso.addEventListener('click', () => {
  avisoPermiso.hidden = true;
  btnPrepararCamara.hidden = false;
  mostrarEstado('No se activó la cámara. Puedes hacerlo cuando quieras.');
});


// =====================================================================
// 8. CONTROLES DE LA CÁMARA
// =====================================================================

// Alternar entre trasera (environment) y frontal (user)
btnAlternarCamara.addEventListener('click', () => {
  modoCamaraActual = modoCamaraActual === 'environment' ? 'user' : 'environment';
  // iniciarCamara se encarga de detener la cámara anterior antes de abrir la nueva
  iniciarCamara(modoCamaraActual);
});

// Apagar: liberar el sensor y limpiar el visor
btnApagarCamara.addEventListener('click', () => {
  detenerCamaraActiva();
  visorVideo.srcObject = null;
  actualizarVisor(false);
  btnPrepararCamara.hidden = false;
  btnAlternarCamara.disabled = true;
  btnApagarCamara.disabled = true;
  mostrarEstado('Cámara apagada. El sensor fue liberado.');
});


// =====================================================================
// 9. LIBERAR LA CÁMARA AL SALIR DE LA APP (buena práctica ética)
// Si el usuario cambia de app o bloquea el teléfono, apagamos la cámara
// para no dejar el sensor encendido sin que lo esté viendo.
// =====================================================================
document.addEventListener('visibilitychange', () => {
  if (document.hidden && streamActivo) {
    detenerCamaraActiva();
    visorVideo.srcObject = null;
    actualizarVisor(false);
    btnPrepararCamara.hidden = false;
    btnAlternarCamara.disabled = true;
    btnApagarCamara.disabled = true;
    mostrarEstado('La cámara se apagó al salir de la app. Tócala para volver a encenderla.');
  }
});

// Estado inicial: si ya está instalada, no tiene sentido mostrar el botón de instalar
if (estaInstalada()) {
  btnInstalar.hidden = true;
  console.log('[Instalación] La app se está ejecutando en modo standalone.');
}
