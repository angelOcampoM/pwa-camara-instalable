# 📷 PWA Cámara Instalable — Acceso Ético a Cámara Frontal/Trasera

**Alumno:** Angel Daniel Ocampo Martinez
**Asignatura:** Desarrollo de Aplicaciones Web Progresivas (PWA) — Tema 6.1 y 6.2
**Demo:** https://angelocampom.github.io/pwa-camara-instalable/

PWA instalable en la pantalla de inicio del teléfono que accede a la cámara frontal y trasera con un flujo de **consentimiento consciente (Pre-Permiso UX)**.

- 100 % JavaScript Vanilla, sin librerías externas.
- Toda la asincronía con Promesas: `.then()`, `.catch()` y `.finally()`.
- Desplegada en GitHub Pages (HTTPS).

## Estructura

```
pwa-camara-instalable/
├── index.html      # Interfaz: visor, aviso ético, botones y etiquetas para iOS
├── styles.css      # Diseño mobile-first
├── app.js          # Instalación + Pre-Permiso + control de cámara
├── sw.js           # Service Worker con estrategia Cache First
├── manifest.json   # Identidad, modo standalone e iconos (rutas relativas)
└── icons/
    ├── icon-192.png  # 192x192 exactos
    └── icon-512.png  # 512x512 exactos
```

## 1. Instalabilidad

El navegador exige **tres requisitos al mismo tiempo**:

| Requisito | Cómo se cumple |
| --- | --- |
| HTTPS | GitHub Pages sirve el sitio con HTTPS |
| Service Worker activo | `sw.js` registrado con `register('./sw.js')`; Cache First |
| `manifest.json` válido | `name`, `short_name`, `start_url`, `scope`, `display: standalone`, colores e iconos 192 y 512 |

- **Rutas relativas (`./`):** GitHub Pages publica en `usuario.github.io/pwa-camara-instalable/`. Con `/` el navegador buscaría los archivos en la raíz del dominio → 404.
- **`display: "standalone"`:** la app abre en su propia ventana, sin barra de direcciones.
- **Iconos:** Chrome/Android rechaza la instalación si los PNG no existen con las medidas exactas declaradas.

### Botón propio de instalación (Chrome / Android)

1. El navegador dispara `beforeinstallprompt` cuando la app es instalable.
2. `evento.preventDefault()` evita el mini-banner automático y se guarda el evento en `eventoInstalacionDiferido`.
3. Se muestra `#btn-instalar`. Al tocarlo: `prompt()` → `userChoice.then((resultado) => ...)`.
4. Si `resultado.outcome === 'accepted'` se oculta el botón. En `.finally()` se limpia el evento porque **solo se puede usar una vez**.
5. El evento `appinstalled` confirma la instalación.

### iPhone / iPad (iOS / WebKit)

| Problema en iOS | Solución implementada |
| --- | --- |
| Safari **nunca** dispara `beforeinstallprompt` | `esIOS()` + `!window.navigator.standalone` → se muestra `#aviso-ios` con los pasos: **Compartir → Agregar a pantalla de inicio** |
| No usa los iconos del manifest | `<link rel="apple-touch-icon" href="./icons/icon-192.png">` |
| Abrir sin barra de Safari | `<meta name="apple-mobile-web-app-capable" content="yes">` |
| El video se abre en pantalla completa | Atributo `playsinline` en `<video>` |
| iPad moderno se identifica como Mac | Se detecta con `platform === 'MacIntel' && maxTouchPoints > 1` |

## 2. Pre-Permiso UX (ética de permisos)

**El problema:** si el diálogo nativo aparece sin contexto y el usuario pulsa **Bloquear**, el navegador guarda esa decisión. JavaScript **ya no puede volver a mostrar el diálogo**: la cámara falla siempre y el usuario tendría que desbloquearla a mano en la configuración.

**La solución (dos clics):**

1. `#btn-preparar-camara` → **no toca el hardware**, solo muestra `#aviso-permiso`. El aviso explica para qué se usa la cámara, cuál se enciende y que el video es local.
2. `#btn-confirmar-permiso` → consentimiento consciente → `iniciarCamara()` → `getUserMedia()` → aparece el diálogo nativo.

Extras:
- `#btn-cancelar-permiso` permite decir "Ahora no" sin pedir permiso.
- Con la Permissions API se detecta si el permiso ya estaba bloqueado (`denied`) y se explica cómo desbloquearlo.

## 3. Control de la cámara

```
iniciarCamara(modo)
  ├── detenerCamaraActiva()          → track.stop() en todas las pistas (libera el sensor)
  ├── getUserMedia({ video: { facingMode: { exact: modo } }, audio: false })
  │     └── si no existe ese lente → reintenta con cualquier cámara (laptops)
  ├── .then  → visorVideo.srcObject = stream → visorVideo.play()
  ├── .catch → diagnóstico por error.name
  └── .finally → habilita/deshabilita los controles
```

- **`facingMode`:** `'environment'` = trasera, `'user'` = frontal.
- **¿Por qué `track.stop()` antes de cambiar?** En el móvil no se puede abrir la frontal mientras la trasera transmite; el sistema bloquea el sensor y rechaza la promesa.
- **Alternar:** invierte `modoCamaraActual` y vuelve a llamar a `iniciarCamara(modoCamaraActual)`.
- **Apagar:** `detenerCamaraActiva()` + `visorVideo.srcObject = null` + mensaje de estado.
- **Al salir de la app** (`visibilitychange`) la cámara se apaga para no dejar el sensor encendido.

### Diagnóstico de errores

| `error.name` | Significado | Mensaje al usuario |
| --- | --- | --- |
| `NotAllowedError` | El usuario bloqueó el permiso | Cómo habilitarlo en la configuración del sitio |
| `NotFoundError` / `OverconstrainedError` | No existe ese lente / ninguna cámara | Usa la cámara disponible o avisa que no hay cámara |
| `NotReadableError` | Otra app está usando el sensor | Cerrar la otra app |

## 4. Service Worker (Cache First)

- **install:** guarda el App Shell (`index.html`, `styles.css`, `app.js`, `manifest.json` e iconos).
- **activate:** borra cachés de versiones anteriores.
- **fetch:** responde desde la caché; si no está, va a la red. Solo maneja `GET`.
- Si se cambia un archivo, hay que subir `CACHE_NAME` (`camara-static-v2`…) para que el SW se reinstale.

## 5. Pruebas

1. **Escritorio:** DevTools → Application → **Manifest** sin errores de iconos ni de instalabilidad; **Service Workers** activo con scope `/pwa-camara-instalable/`.
2. **Teléfono (Android/Chrome):** abrir la URL → **Instalar App** → se abre en ventana independiente sin barra de direcciones.
3. **Consentimiento:** "Preparar cámara" → aparece el aviso **antes** del diálogo nativo → Permitir → cambiar entre trasera y frontal → Apagar.
