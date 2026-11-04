// Autorrevisión: ¿puede este agente mandar teclas, lo verán las tablets y hay red?
// Cada revisión devuelve { id, ok, title, detail, fix? } para mostrarla en el panel o en la terminal.

import { execFile as nodeExecFile } from 'node:child_process';
import { lanAddresses } from './net.js';

const AX_CHECK = "ObjC.import('ApplicationServices'); $.AXIsProcessTrusted()";
const AX_PROMPT = "ObjC.import('ApplicationServices'); $.AXIsProcessTrustedWithOptions($({ AXTrustedCheckOptionPrompt: true }))";
const AX_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';

export function createDiagnostics({ platform = process.platform, execFile = nodeExecFile, lanPort, addresses = lanAddresses } = {}) {
  const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') })));

  async function accessibility() {
    if (platform !== 'darwin') return null;
    const r = await run('osascript', ['-l', 'JavaScript', '-e', AX_CHECK]);
    const ok = r.out.trim() === 'true';
    return {
      id: 'accessibility', ok,
      title: ok ? 'Permiso de Accesibilidad concedido' : 'Falta el permiso de Accesibilidad',
      detail: ok ? 'Este agente puede mandar teclas y atajos.' : 'Sin este permiso, macOS bloquea las teclas que manda la tablet. Actívalo para ControlDeck en Configuración del Sistema → Privacidad y seguridad → Accesibilidad.',
      fix: ok ? null : 'accessibility',
    };
  }

  async function firewall() {
    if (platform !== 'darwin') return null;
    const [state, blockAll] = await Promise.all([
      run('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getglobalstate']),
      run('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getblockall']),
    ]);
    const on = /enabled|activad/i.test(state.out) && !/disabled|desactivad/i.test(state.out);
    const blocking = /enabled|activad/i.test(blockAll.out) && !/disabled|desactivad/i.test(blockAll.out);
    if (blocking) return { id: 'firewall', ok: false, title: 'El firewall bloquea todas las conexiones', detail: 'Las tablets no podrán conectarse. En Configuración del Sistema → Red → Firewall → Opciones, desactiva "Bloquear todas las conexiones entrantes".' };
    return { id: 'firewall', ok: true, title: on ? 'Firewall activo' : 'Firewall desactivado', detail: on ? 'Si macOS pregunta si ControlDeck puede recibir conexiones, elige Permitir.' : 'Las tablets de tu red pueden llegar al agente.' };
  }

  function network() {
    const ips = addresses();
    return ips.length
      ? { id: 'network', ok: true, title: 'Conectado a la red', detail: `Las tablets pueden abrir ${ips.map((ip) => `http://${ip}:${lanPort}/`).join(' o ')}` }
      : { id: 'network', ok: false, title: 'Sin red local', detail: 'Conecta esta computadora a la misma WiFi que la tablet.' };
  }

  return {
    async run() {
      return (await Promise.all([accessibility(), firewall(), network()])).filter(Boolean);
    },
    // Pide el permiso: macOS muestra su aviso y se abre la pantalla de Accesibilidad.
    async fix(id) {
      if (id !== 'accessibility' || platform !== 'darwin') return false;
      await run('osascript', ['-l', 'JavaScript', '-e', AX_PROMPT]);
      await run('open', [AX_SETTINGS]);
      return true;
    },
  };
}
