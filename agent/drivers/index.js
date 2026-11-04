import { createMacDriver } from './mac.js';
import { createWindowsDriver } from './windows.js';
import { createMockDriver } from './mock.js';

export function createDriver(kind = process.platform) {
  if (kind === 'mock') return createMockDriver();
  if (kind === 'darwin' || kind === 'mac') return createMacDriver();
  if (kind === 'win32' || kind === 'win') return createWindowsDriver();
  throw new Error(`Sistema no soportado: ${kind}. ControlDeck funciona en Windows y macOS.`);
}
