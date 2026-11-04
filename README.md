# ControlDeck

Convierte una tablet o un celular en un panel de botones que controla **varias computadoras Windows y macOS a la vez**. Un mismo botón funciona en las dos: `mod+c` se convierte en `Ctrl+C` en Windows y en `Cmd+C` en Mac.

Es **software libre** (licencia [MIT](LICENSE)): úsalo, cópialo, modifícalo y compártelo sin restricciones. Para empezar en 5 minutos, sigue la [guía rápida](GUIA.md).

- Sin cuentas, sin nube y sin anuncios: la tablet habla directo con tus computadoras, cifrado de punta a punta.
- Mac y Windows, varias computadoras a la vez, desde cualquier tablet o celular con navegador.
- Tailscale (para usarlo fuera de casa) y la IA con Ollama son **opcionales**: todo funciona sin ellas en tu red local.

## Cómo funciona

```
 Tablet / celular (navegador)          Computadora 1                 Computadora 2
 ┌──────────────────────┐   WiFi   ┌──────────────────┐        ┌──────────────────┐
 │ App web de botones   │◀────────▶│ Agente ControlDeck│        │ Agente ControlDeck│
 │ (sin instalar nada)  │◀─────────┼──────────────────┼───────▶│                  │
 └──────────────────────┘ cifrado  └──────────────────┘        └──────────────────┘
```

- **Agente** (`bin/controldeck.js`): corre en cada computadora. Sirve la app de la tablet, ejecuta las acciones y guarda los botones.
- **App de tablet** (`web/`): se abre en el navegador de cualquier tablet o celular. Se conecta directo a cada computadora, todas al mismo tiempo.
- **Panel de administración** (`admin-web/`): solo se abre en la propia computadora. Ahí se aprueban tablets, se quitan accesos y se decide qué se permite.

## Instalar (para quien lo usa)

- **Mac (Apple Silicon, M1 o posterior):** abre `ControlDeck-<versión>.dmg` y arrastra ControlDeck a Aplicaciones (o descomprime `ControlDeck-<versión>-mac.zip` y mueve ControlDeck.app a Aplicaciones). Ábrelo: se abre el panel con la configuración guiada. Mientras la versión no esté notarizada por Apple, macOS dice que no puede comprobarla: ve a Configuración del Sistema → Privacidad y seguridad y elige "Abrir de todos modos".
- **Windows:** abre `ControlDeck-Setup-<versión>.exe`. Se instala solo, sin permisos de administrador (en `%LOCALAPPDATA%\Programs\ControlDeck`), crea "ControlDeck" en el menú Inicio, queda abriéndose al iniciar sesión y abre el panel con la configuración guiada. Se desinstala desde Configuración → Aplicaciones. Mientras el .exe no tenga firma de código, Windows muestra "Windows protegió tu PC": "Más información" → "Ejecutar de todas formas".

La **configuración guiada** aparece la primera vez: nombre de la computadora, permisos (Accesibilidad en Mac), conectar la tablet con el QR y aprobar su código, y abrir al iniciar sesión. Se puede saltar y volver a ver desde el panel → "Esta computadora".

Ni Mac ni Windows necesitan tener Node instalado: va incluido.

## Requisitos para desarrollar

- Node.js 22 o superior.
- La tablet y las computadoras en la misma red (o en la misma red de Tailscale).
- **macOS:** permiso de Accesibilidad para la app que ejecuta el agente (Terminal, iTerm o la que uses), en Configuración del Sistema → Privacidad y seguridad → Accesibilidad.
- **Windows:** PowerShell 5.1 (viene con Windows 10 y 11). Acepta el aviso del Firewall la primera vez.

## Correr desde el código

```bash
npm install
npm start
```

El agente muestra dos direcciones:

1. **En la tablet abre:** `http://<ip-de-la-computadora>:4455/`. Ábrela en el navegador de la tablet o escanea el QR del panel.
2. **Panel de administración:** se abre solo en el navegador de la computadora. Incluye un código de acceso que cambia cada vez que arranca el agente.

### Emparejar una tablet

1. Abre la dirección en la tablet. Aparece un código de 6 dígitos.
2. En el panel de la computadora aparece una solicitud con un código.
3. Si los dos códigos son iguales, toca **Sí, aprobar**. Si no coinciden, rechaza: alguien podría estar en medio.

Desde ese momento la tablet recuerda la identidad de la computadora y se reconecta sola.

### Agregar otra computadora

1. Arranca el agente también en la otra computadora.
2. En la tablet: ⚙️ Ajustes → **Buscar en la red**, o **Agregar por dirección** (`192.168.1.20:4455`).
3. Aprueba el código en el panel de esa computadora.

Cada botón elige dónde se ejecuta:

| Destino | Qué hace |
| --- | --- |
| La computadora donde estoy trabajando | La que tuvo actividad de teclado o mouse más reciente. Se marca con borde azul arriba. |
| Todas las computadoras | Se ejecuta en todas las conectadas, por ejemplo Bloquear todas. |
| Solo una computadora | Siempre en esa. |

### Opcional: usarlo con Tailscale (fuera de casa y con HTTPS)

Si la computadora y la tablet tienen Tailscale, en el panel abre **Opcional → Usar fuera de casa con Tailscale → Activar**. ControlDeck queda publicado en `https://<computadora>.<tailnet>.ts.net:4443/`:

- Funciona en casa o fuera, mientras la tablet tenga Tailscale encendido.
- Carga por **HTTPS con certificado válido**, así que la app no puede ser alterada en el camino.
- Solo la ven los dispositivos de tu tailnet. No se usa Funnel: nunca queda en internet.
- Usa su propio puerto (4443) y no toca otros servicios que ya publiques con `tailscale serve`.
- Requiere tener activados los certificados HTTPS de la tailnet (consola de Tailscale → DNS → HTTPS Certificates).

Desde la app abierta por HTTPS, las demás computadoras también se agregan por Tailscale. Ajustes → **Buscar en la red** encuentra las que tengan ControlDeck publicado, o escribe su nombre, por ejemplo `pc-oficina.tailnet.ts.net`.

### Que se abra solo al iniciar sesión

```bash
node bin/controldeck.js --instalar
```

- **macOS:** crea un LaunchAgent del usuario (`~/Library/LaunchAgents/com.controldeck.agent.plist`) que se reinicia solo si se cierra. Da permiso de Accesibilidad a `node`.
- **Windows:** deja un lanzador oculto en la carpeta de Inicio del usuario, sin ventana de consola ni permisos de administrador.
- Para abrir el panel del agente que ya corre: en Mac abre la app ControlDeck otra vez (Spotlight o Aplicaciones); en Windows usa "ControlDeck" del menú Inicio, o `node bin/controldeck.js --panel`. Para quitarlo: `--desinstalar`.
- Con los instaladores no hace falta: la configuración guiada lo ofrece.

### Opciones del agente

```
--port <n>         Puerto para las tablets (4455)
--admin-port <n>   Puerto del panel, solo en esta computadora (4456)
--bind <ip>        Dónde escuchar. Usa la IP de tu red local para no exponerlo en otras redes
--home <carpeta>   Carpeta de datos
--dry-run          Simula las acciones sin tocar la computadora (para probar)
--no-discovery     No anunciarse en la red
--no-open          No abrir el panel automáticamente
--instalar         Abrirse solo al iniciar sesión
--desinstalar      Dejar de abrirse al iniciar sesión
--panel            Abrir el panel del agente que ya está corriendo
--diagnostico      Revisar permiso de Accesibilidad, firewall y red
```

Datos guardados en `~/Library/Application Support/ControlDeck` (Mac) o `%APPDATA%\ControlDeck` (Windows).

## Usar la tablet

| Gesto | Qué hace |
| --- | --- |
| Tocar una tecla | La ejecuta. Se hunde, vibra y muestra una marca verde (o roja si falló). |
| Mantener presionada una tecla | Abre su editor directamente. |
| Deslizar a los lados | Cambia de página. Las páginas también están en la barra de abajo. |
| ✎ Editar | Muestra el modo edición: toca una tecla para cambiarla o arrástrala para moverla. Para pasarla a otra página, suéltala sobre el nombre de esa página en la barra de abajo, o usa **Mover a otra página** en su editor. Los nombres de las páginas en la barra de abajo también se arrastran para cambiar el orden. |
| + Agregar | Abre más de 40 plantillas (General, Navegador, Reuniones, Excel, Multimedia, Sistema) o crea una desde cero. |

- Debajo del nombre, cada tecla muestra el atajo real según la computadora en uso: ⌘ C en Mac y Ctrl C en Windows.
- La barra de arriba muestra cada computadora, su estado y la app que tiene al frente. La que estás usando se marca en azul.
- En el editor, el atajo se arma tocando los modificadores. Con un teclado físico conectado, toca **Grabar** y presiona la combinación.
- En Ajustes eliges tema (automático, claro u oscuro), tamaño de las teclas y si se muestran los atajos.
- **Comandos de voz** (abriendo la app por Tailscale/HTTPS): toca 🎤 y di el nombre de una tecla ("copiar") o "página multimedia".
- **Pantalla encendida:** mientras ControlDeck está abierto y a la vista, la tablet no se apaga sola (Ajustes). Usa el bloqueo de pantalla del navegador y, donde no existe (HTTP en la red local o iPad con iPadOS anterior a 18.4), un video negro diminuto y sin sonido que empieza con el primer toque.
- **Páginas automáticas:** en modo edición toca el nombre de una página y asóciale apps (por ejemplo “Excel”). Cuando esa app pase al frente en la computadora en uso, la tablet abre esa página sola.

## Asistente de IA (opcional)

Si no lo configuras, simplemente no aparece. En **+ Agregar → Crear con IA** describes la tecla ("silenciar el micrófono en Teams") y el asistente la arma con el atajo correcto para Mac y Windows. Antes de agregarla puedes verla o editarla.

- Usa un servidor **Ollama** de tu red o tailnet; se configura en el panel → **Opcional → Asistente de IA con Ollama**. Nada sale a internet.
- Lo que responde el modelo se valida igual que cualquier tecla. No puede crear acciones de energía ni scripts, ni abrir rutas de archivos raras.
- La primera petición del día puede tardar hasta un minuto mientras el modelo se carga. Después tarda 2 a 5 s.

## Automatizaciones

En **Ajustes → Administrar automatizaciones**, cada computadora puede hacer cosas sola, aunque la tablet esté apagada:

- **Cuando una app pase al frente**, por ejemplo silenciar el micrófono al abrir Zoom.
- **A una hora**, por ejemplo abrir el correo a las 9:00 de lunes a viernes.

Por seguridad, una automatización no puede apagar, suspender ni ejecutar scripts. Se pueden apagar todas desde el panel (permiso "Automatizaciones"). Todo lo que hacen queda en el registro con el nombre "Automatización: …".

## Ventanas abiertas

La pestaña **Ventanas**, al final de la barra de páginas de abajo (también se llega deslizando), muestra lo que está abierto en la computadora, agrupado por app y con buscador. Mientras la ves, la computadora manda la lista en vivo (la relee cada segundo y solo envía cambios), y lo que tocas se marca al instante:

- **Toca una ventana** para traerla al frente, aunque esté minimizada.
- **Sus botones** la acomodan: mitad izquierda, mitad derecha, al centro, maximizar o minimizar.
- **Arriba de la lista** están los mismos botones para la ventana activa.
- **Pestañas del navegador:** debajo de cada ventana de Safari, Chrome, Brave, Edge, Chromium o Vivaldi (en Windows también Firefox y Opera) aparece "N pestañas". Tócalo para verlas y toca una para mostrarla. El buscador también busca en las pestañas.

Mientras estás en esta pestaña, las páginas automáticas no te sacan de ella.

También hay teclas listas en **+ Agregar → Ventanas** ("A la izquierda", "Maximizar", etc.), que actúan sobre la ventana activa. Se apagan con el permiso "Ver y acomodar ventanas" del panel.

En Mac necesita el permiso de Accesibilidad. Para las pestañas, la primera vez macOS pregunta si ControlDeck puede controlar cada navegador. Hay que aceptar en la Mac; mientras no se acepta, las ventanas salen sin pestañas. Con la pantalla bloqueada la lista sale vacía. Las ventanas de otros escritorios (Spaces) pueden no aparecer.

## Notificaciones

La campana de arriba muestra las notificaciones que llegan a tus computadoras mientras la tablet está conectada:

- **Aviso discreto:** una línea pequeña arriba, sin sonido, que se va sola a los 4 segundos. Al tocarla se abre la lista.
- **Lista:** al tocar la campana. Tocar una notificación trae al frente esa app en la computadora. Si viene de un sitio (por ejemplo WhatsApp Web), busca la app web instalada o la pestaña de ese sitio; nunca abre una ventana nueva del navegador. Las notificaciones del iPhone que llegan a la Mac (Duplicación del iPhone) abren la duplicación del iPhone, igual que al tocarlas en la Mac.
- **Pendientes en tus apps** (Mac): los números rojos del Dock, como Slack 43 o WhatsApp 20. Tócalos para abrir la app.
- En **Ajustes → Notificaciones de las computadoras** eliges entre aviso discreto, solo el contador o apagadas.
- Se pueden apagar por computadora en el panel con el permiso "Mostrar en la tablet las notificaciones de esta computadora".

En Mac se leen los avisos en pantalla con el permiso de Accesibilidad; el nombre de la app sale de la descripción del aviso. Si el aviso desaparece antes de 2.5 segundos, o si no se muestran avisos (No molestar), no llega. En Windows se lee el historial de notificaciones del sistema; los contadores no están disponibles.

## Acciones disponibles

| Tipo | Ejemplo | Notas |
| --- | --- | --- |
| Atajo | `mod+shift+s`, `alt+f4`, `f13` | `mod` = Ctrl en Windows y Cmd en Mac. Se puede definir un atajo distinto por sistema. |
| Escribir texto | `Saludos, {fecha}` | Variables `{fecha}`, `{hora}`, `{portapapeles}`. |
| Abrir | `https://…`, `Microsoft Excel`, `/ruta/archivo` | Solo URLs `http`, `https` y `mailto`. Si la página ya está abierta en el navegador, se muestra esa pestaña en vez de abrir otra (se puede desactivar en la tecla: "Abrir siempre una pestaña nueva"). |
| Multimedia | reproducir/pausa, siguiente, anterior, volumen, silencio | |
| Energía | bloquear, suspender, reiniciar, apagar | Siempre pide confirmación. |
| Script | `respaldo` | Solo archivos de la carpeta `scripts` del agente. Desactivado por defecto. |
| Secuencia | varios pasos con pausas | Hasta 32 pasos. |
| Pasar lo copiado | de la computadora en uso a las demás | Opción de pegarlo al llegar. Máximo 1 MB de texto. |
| Encender otra | despierta una computadora dormida | Necesita Wake-on-LAN activado en esa computadora y otra encendida en la misma red. |
| Varios estados | Presentación: Iniciar → Terminar | Cada toque ejecuta el siguiente estado; la tecla muestra en cuál va. Hasta 8. |
| Dato en vivo | procesador, memoria, batería, app al frente, hora, música sonando | Se actualiza cada pocos segundos. |
| Deslizador de volumen | volumen exacto de 0 a 100 | En Windows se ajusta en pasos de 2 %. |
| Touchpad | la tablet como mouse | Un dedo mueve, tocar hace clic, dos dedos hacen clic derecho o desplazan. Permiso "Mover el mouse" en el panel. |
| Teclado | escribir con el teclado de la tablet | Dentro del touchpad (botón ⌨️ Teclado) o como tecla propia. Manda lo escrito como texto, y borrar, Enter, Tab, flechas y Esc como teclas. Permisos "Escribir texto" y "Atajos". |
| Acomodar ventana | mitad izquierda/derecha/arriba/abajo, centro, maximizar, minimizar | Sobre la ventana activa. |
| Lista de ventanas | abre el panel de ventanas | |

**Scripts:** pon el archivo en la carpeta `scripts` que muestra el panel (`.sh`, `.command`, `.applescript` o `.scpt` en Mac; `.ps1`, `.bat` o `.cmd` en Windows) y activa "Scripts" en el panel. La tablet solo puede pedir el script por nombre: no puede mandar comandos.

**Respaldo de botones:** ⚙️ Ajustes → Exportar / Importar.

## Compilar

```bash
npm run build
```

Genera en `dist/`:

| Archivo | Qué es |
| --- | --- |
| `ControlDeck.app` | App de macOS con Node incluido. Sin ícono en el Dock: se maneja desde el panel. |
| `ControlDeck-macOS.zip` | La misma app comprimida, para copiarla a otra Mac. |
| `ControlDeck-Windows.zip` | Versión de Windows como carpeta, para desarrollo. Necesita Node.js instalado. |

La app de macOS es un ejecutable único de Node. Homebrew compila Node sin el soporte para esto, así que la primera vez el build descarga el Node oficial de nodejs.org de la misma versión, verifica su SHA-256 y lo guarda en `.build-cache/`. Se firma con tu certificado de Apple si hay uno en el llavero, para que macOS conserve el permiso de Accesibilidad entre compilaciones.

## Crear los instaladores

```bash
npm run release:mac                              # dist/ControlDeck-<versión>.dmg, firmado y notarizado por Apple
CONTROLDECK_WIN_HOST=mi-pc npm run release:win   # dist/ControlDeck-Setup-<versión>.exe
```

**Mac.** Firma con el certificado "Developer ID Application" y el modo reforzado (hardened runtime) que pide Apple, arma el .dmg, lo manda a revisión a Apple y le pega la aprobación. Antes, una sola vez:

1. Crea el certificado: Xcode → Ajustes → Cuentas → tu equipo → Administrar certificados → + → **Developer ID Application**. Solo el titular de la cuenta de Apple Developer puede crearlo.
2. Crea una contraseña de app en [appleid.apple.com](https://appleid.apple.com) (Inicio de sesión y seguridad → Contraseñas de apps) y guárdala:
   ```bash
   xcrun notarytool store-credentials controldeck --apple-id TU_CORREO --team-id TU_EQUIPO
   ```

`npm run release:mac -- --sin-notarizar` arma el .dmg firmado sin mandarlo a Apple, para probar.

**Windows.** Node solo arma ejecutables para el sistema donde corre, así que el .exe se arma por SSH en una PC con Windows (`CONTROLDECK_WIN_HOST`: su nombre en `~/.ssh/config` o `usuario@equipo`). Esa PC solo necesita PowerShell. Ahí se usa el Node oficial de nodejs.org de la misma versión, verificado con su SHA-256. Para que Windows no muestre el aviso de SmartScreen hace falta firmarlo con un certificado de firma de código.

## Pruebas

```bash
npm test
```

Son 94 pruebas: protocolo criptográfico, validación de acciones, controladores de Mac y Windows (con procesos simulados), ventanas, pestañas, notificaciones y pruebas de punta a punta con el agente real.

## Estado y límites conocidos

- **Probado en equipos reales:** Mac (macOS 26) y una PC con Windows 11, con un iPad: emparejamiento, teclas, texto, multimedia, mouse, ventanas y pestañas, notificaciones, varias computadoras a la vez, Tailscale, el instalador de Windows (instalar y desinstalar) y la app de Mac firmada con modo reforzado.
- **Música en Mac:** reproducir, anterior y siguiente controlan directo Música o Spotify (la que esté sonando, si no la que esté en pausa). La primera vez macOS pregunta si ControlDeck puede controlarla. Con otra app (por ejemplo YouTube en el navegador) se usa la tecla multimedia del sistema.
- **macOS:** escribir texto con caracteres no ingleses depende de la distribución del teclado. Las teclas F21 a F24 y Print Screen no existen en Mac.
- **Windows:** si la ventana activa corre como administrador, Windows ignora las teclas salvo que el agente también corra como administrador. Las pestañas del navegador se reconocen por su título (Windows no da la dirección de cada pestaña).
- La app de tablet se sirve por HTTP en la red local. Lee [SECURITY.md](SECURITY.md) para saber qué protege el cifrado y qué no.

## Estructura

```
bin/controldeck.js      Arranque del agente
agent/                  Servidores, sesiones, emparejamiento, ejecutor, descubrimiento
agent/drivers/          macOS (osascript), Windows (ayudante PowerShell + SendInput), simulado
shared/                 Protocolo cifrado, validación de acciones y cliente (tablet y pruebas)
web/                    App de tablet (app.js, editor.js, keyview.js, presets.js, icons.js)
admin-web/              Panel de administración
scripts/                Compilación e instaladores
test/                   Pruebas
```

## Contribuir

Los reportes de errores, ideas y mejoras son bienvenidos: abre un *issue* o un *pull request*. Antes de mandar cambios corre `npm test`. Para reportar un problema de seguridad, lee [SECURITY.md](SECURITY.md).

## Apoya el proyecto

ControlDeck es libre y gratis. Si te sirve y quieres invitar un café:

| | Nivel | Aporte sugerido |
| --- | --- | --- |
| ☕ | Un café | 3 USD |
| 🫖 | Una cafetera | 25 USD |
| 📅 | Un año de café | 100 USD |

Se puede apoyar por **GitHub Sponsors** (botón "Sponsor" del repositorio) o **Ko-fi**. Los enlaces se configuran en [`shared/project.js`](shared/project.js) y [`.github/FUNDING.yml`](.github/FUNDING.yml); el panel y la tablet muestran "Apoya ControlDeck" solo cuando hay alguno.

## Licencia

[MIT](LICENSE). Las librerías incluidas y sus licencias están en [THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt).
