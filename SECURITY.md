# Seguridad de ControlDeck

Una tablet emparejada puede escribir y usar atajos como si fuera el teclado de la computadora. Con eso se puede hacer cualquier cosa que haría una persona sentada frente a ella. Por eso la protección principal es **quién puede emparejarse** y que **nadie más pueda hablar con el agente**.

## Qué protege

| Amenaza | Protección | Dónde |
| --- | --- | --- |
| Alguien en la red espía el tráfico | Cada mensaje va cifrado y autenticado (XSalsa20-Poly1305) con llaves distintas por dirección | `shared/protocol.js` |
| Alguien graba y repite un mensaje | Número de secuencia estricto y llaves nuevas en cada conexión; un mensaje repetido cierra la conexión | `createChannel` |
| Alguien roba llaves después | Secreto hacia adelante: cada sesión mezcla llaves efímeras con las de identidad | `deriveSessionKeys` |
| Una tablet desconocida se conecta | Solo entran tablets aprobadas en la computadora | `agent/session.js` |
| Solicitudes de emparejamiento no deseadas | Solo se aceptan mientras el panel está abierto en la computadora (90 s desde la última vez que se vio). Con el panel cerrado, se rechazan sin llegar a mostrarse | `pairingOpen` |
| Atacante en medio durante el emparejamiento | Compromiso + revelación + código de 6 dígitos comparado por la persona. El atacante no puede elegir llaves para que los códigos coincidan | `pairCommit`, `pairSas` |
| Alguien suplanta a la computadora después | La tablet fija la llave de la computadora y se niega a conectar si cambia. Un error falso no la borra; solo la persona puede volver a emparejar | `shared/client.js`, `web/connections.js` |
| Un sitio web usa el navegador de la tablet para atacar | El WebSocket solo acepta orígenes de red local | `isLocalOrigin` |
| Un sitio web ataca el panel (CSRF, DNS rebinding) | El panel solo escucha en 127.0.0.1, exige el nombre exacto en `Host`, revisa `Origin` y pide un token en cabecera propia | `agent/index.js` |
| Inyección de comandos | Nada se ejecuta a través de un shell. Lo que manda la tablet viaja como argumento separado (`execFile`, `argv` de AppleScript, JSON al ayudante de Windows) | `agent/drivers/` |
| Ejecución de scripts arbitrarios | La tablet solo puede pedir un script por nombre simple. El archivo debe estar en la carpeta de scripts, sin enlaces que salgan de ella. Desactivado por defecto | `resolveScript` |
| Esquemas peligrosos al abrir | Solo URLs `http`, `https` y `mailto`, sin rutas con `..` ni argumentos que empiecen con `-` | `classifyOpenTarget` |
| XSS en la tablet o el panel | Nada se inserta como HTML. CSP estricta sin scripts en línea. Las imágenes solo pueden ser png, jpeg, gif o webp en base64 (nunca SVG) | `web/ui.js`, cabeceras |
| Acceso por Tailscale | `tailscale serve` solo dentro de la tailnet (nunca Funnel), HTTPS con certificado de *.ts.net, en su propio puerto (4443). Se aceptan orígenes solo de la tailnet propia. La IP real detrás del proxy se toma de X-Forwarded-For únicamente si la conexión viene de 127.0.0.1 | `agent/tailscale.js` |
| Asistente de IA | La dirección del servidor solo se configura en el panel de la computadora, nunca desde la tablet. La respuesta del modelo se valida como cualquier tecla. Máximo 8 peticiones por minuto por tablet | `agent/ai.js` |
| Automatizaciones | Se validan al guardarse; no admiten energía, scripts ni acciones de la tablet. El panel puede apagarlas todas | `validateAutomations` |
| Saturación | Límite de conexiones (32 en total, 8 por IP), 60 mensajes por segundo, 20 acciones por segundo, 6 intentos de emparejamiento por IP cada 10 minutos, máximo 3 solicitudes pendientes, mensajes de 8 KB antes de autenticar | varios |
| Robo de datos del agente por otro usuario del equipo | Carpeta 0700 y archivos 0600, escritos de forma atómica | `agent/store.js` |
| Acciones peligrosas por accidente | Energía y scripts piden confirmación, y el agente la vuelve a exigir aunque la tablet no la pida | `executor.js` |

## Riesgos que quedan (conocidos)

1. **En la red local, la app de tablet se entrega por HTTP.** Con Tailscale activado en el panel, se entrega por HTTPS con certificado válido y este riesgo desaparece: es la forma recomendada de usarla. El navegador no puede verificar quién le sirve la página. Un atacante *activo* en la misma WiFi podría modificar el JavaScript la primera vez que se carga y robar la llave de la tablet. El cifrado sí protege contra quien solo escucha.
   - Mitigación hoy: usar redes de confianza o Tailscale, y `--bind` con la IP de la red local.
   - Solución planeada: apps de tienda con Capacitor (el código va dentro de la app) o HTTPS con certificado fijado.
2. **La llave de la tablet vive en el almacenamiento del navegador.** Quien tenga la tablet desbloqueada puede usarla. Si pierdes la tablet, quítale el acceso desde el panel.
3. **Los datos del agente no están cifrados en disco.** Están protegidos por permisos de archivo, no por el llavero del sistema. Planeado: guardar la llave en Keychain o en el Administrador de credenciales de Windows.
4. **El token del panel puede quedar en el historial del navegador** de la computadora durante esa sesión del agente. Cambia cada vez que el agente arranca.
5. **Una tablet emparejada puede abrir cualquier app o archivo** y escribir cualquier texto. Es el propósito del producto. Empareja solo tablets tuyas y quita el acceso a las que ya no uses.
6. **Portapapeles entre computadoras.** Una tablet emparejada puede leer lo copiado en una computadora para pasarlo a otra. Se puede apagar en el panel de cada computadora ("Enviar y recibir lo copiado"). El texto viaja cifrado y no se guarda.
7. **Encender a distancia** usa paquetes de difusión sin cifrar en la red local, como todo Wake-on-LAN. Solo pueden despertar la computadora, no controlarla. Las direcciones MAC se comparten únicamente con tablets ya autenticadas.
8. **Descubrimiento en red sin autenticar.** Otra máquina puede anunciarse con un nombre falso. Solo se confía en una computadora después de aprobar el código en su propia pantalla.

## Revisión antes de publicar el código (4 de noviembre de 2026)

Se revisaron el protocolo, el emparejamiento, los dos servidores, el ejecutor, los controladores de Mac y Windows, el instalador de Windows y la interfaz. No se encontraron brechas.

- `npm audit`: 0 vulnerabilidades. Dependencias de ejecución con versión exacta: `ws` 8.22.1, `tweetnacl` 1.0.3 y `qrcode` 1.5.4. `esbuild` solo se usa para compilar.
- No se usa `eval`, `new Function`, `innerHTML`, `exec` con shell ni `shell: true`. Lo que viene de la red (títulos de ventanas, notificaciones, nombres) se muestra siempre como texto.
- El teclado de la tablet manda el texto "tal cual" (sin variables como `{portapapeles}`) y respeta los mismos permisos y límites que cualquier tecla.
- Las teclas que abren un sitio solo reutilizan una pestaña de la misma página; la ruta de las pestañas no sale de la computadora (a la tablet solo le llega el dominio).
- El instalador de Windows no pide permisos de administrador: instala en la carpeta del usuario y se registra en Configuración → Aplicaciones de ese usuario.
- La app compilada lleva los archivos dentro del ejecutable y no lee archivos sueltos del disco. El único que escribe es el ayudante de PowerShell en Windows, en la carpeta temporal privada del usuario.
- Riesgo menor conocido: al abrir el panel, el enlace con el token se pasa un instante como argumento al programa que abre el navegador (`open` en Mac, `rundll32` en Windows). En una computadora con varias cuentas, otro usuario con sesión podría alcanzar a verlo. El token cambia cada vez que arranca el agente.
- Para distribuir: la app de Mac debe firmarse con Developer ID y notarizarse (`npm run release:mac`). El .exe de Windows sin firma de código muestra el aviso de SmartScreen.

## Reportar un problema

Si encuentras un problema de seguridad, avisa en privado: en GitHub usa **Security → Report a vulnerability** del repositorio, con los pasos para reproducirlo. No lo publiques hasta que esté corregido.
