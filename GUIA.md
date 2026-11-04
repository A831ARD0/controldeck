# Guía rápida

Convierte tu tablet (iPad, Android o cualquier navegador moderno) en un panel de botones para tus computadoras Mac y Windows. Toma unos 5 minutos.

## 1. Instala ControlDeck en la computadora

- **Mac (Apple Silicon, M1 o posterior):** abre `ControlDeck-<versión>.dmg` (o descomprime `ControlDeck-<versión>-mac.zip`), pon **ControlDeck** en **Aplicaciones** y ábrelo. No aparece en el Dock: se abre su panel en el navegador. Si macOS dice que no puede comprobar la app, ve a **Configuración del Sistema → Privacidad y seguridad** y elige **Abrir de todos modos**.
- **Windows:** abre `ControlDeck-Setup-<versión>.exe`. Se instala solo y abre su panel en el navegador. Si Windows muestra "Windows protegió tu PC", elige **Más información → Ejecutar de todas formas**.

Si la computadora pregunta si ControlDeck puede **recibir conexiones entrantes**, permítelo en redes privadas (la de tu casa u oficina).

## 2. Sigue la configuración guiada

El panel te guía en tres pasos:

1. **Nombre** de la computadora, como la verás en la tablet.
2. **Permisos.** En Mac, toca **Dar permiso** y activa ControlDeck en Configuración del Sistema → Privacidad y seguridad → Accesibilidad. La primera vez que mandes un atajo, macOS también pide que ControlDeck pueda controlar **System Events**: elige **Permitir**.
3. **Conectar la tablet:**
   1. Con la tablet en la **misma red WiFi**, escanea el QR del panel o escribe la dirección `http://…:4455/` en su navegador.
   2. La tablet y el panel muestran un código de 6 dígitos. Si son iguales, toca **Sí, aprobar** en la computadora.
   3. En la tablet, agrega ControlDeck a la pantalla de inicio (en Safari: **Compartir → Agregar a pantalla de inicio**) para abrirlo como app.

## 3. Úsalo

- **Agregar botones:** toca **Editar** y luego **+**. Hay plantillas de atajos, apps, multimedia, ventanas, touchpad y teclado.
- **Touchpad y teclado:** la tecla **Touchpad** convierte la tablet en mouse; **Teclado** te deja escribir en la computadora con el teclado de la tablet.
- **Varias computadoras:** instala ControlDeck en cada una y conecta la misma tablet. Cada botón puede ir a la computadora que estés usando o a una fija.
- **Volver al panel:** en Mac, abre la app ControlDeck otra vez; en Windows, menú Inicio → ControlDeck.

## Opcional

- **Usar fuera de casa:** con [Tailscale](https://tailscale.com) en la computadora y en la tablet, activa **Opcional → Usar fuera de casa con Tailscale** en el panel.
- **Asistente de IA:** si tienes un servidor [Ollama](https://ollama.com) en tu red, configúralo en **Opcional → Asistente de IA** y describe teclas con palabras.

ControlDeck funciona completo sin ninguna de las dos.

## Problemas comunes

| Lo que pasa | Qué hacer |
| --- | --- |
| La tablet no carga la página | Revisa que estén en la misma WiFi y prueba la otra dirección que muestra el panel. Revisa que el firewall no bloquee las conexiones entrantes. |
| Las teclas no hacen nada (Mac) | Falta el permiso de Accesibilidad o el de System Events. Revisa la tarjeta de revisión del panel. |
| La tablet dice "Abre el panel en esa computadora" | Por seguridad, solo se emparejan tablets mientras el panel está abierto. Ábrelo y espera unos segundos. |
| Quieres cerrar ControlDeck | En el panel: **Esta computadora → Cerrar ControlDeck**. |
| Quieres desinstalarlo | Mac: borra la app de Aplicaciones. Windows: Configuración → Aplicaciones → ControlDeck → Desinstalar. |

El registro está en `~/Library/Application Support/ControlDeck/agente.log` (Mac) o `%APPDATA%\ControlDeck\agente.log` (Windows).
