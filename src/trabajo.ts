// Carpeta de trabajo de Atril e invariante de copias (PLAN.md §2.1):
// Atril solo modifica, guarda o cierra presentaciones que viven dentro de
// ATRIL_DIR o que aún no tienen archivo. Todo lo demás es del usuario: solo lectura.
import { existsSync, realpathSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";

export const DIR = resolve(process.env.ATRIL_DIR ?? join(homedir(), "Atril"));
export const COPIAS = join(DIR, "copias");
export const SALIDAS = join(DIR, "salidas");
export const VISTAS = join(DIR, "vistas");

export async function asegurarCarpetas() {
  for (const c of [COPIAS, SALIDAS, VISTAS]) await mkdir(c, { recursive: true });
}

/** Ruta real (sin enlaces simbólicos) aunque el archivo final aún no exista. */
function real(ruta: string): string {
  const r = resolve(ruta);
  if (existsSync(r)) return realpathSync(r);
  return join(real(dirname(r)), basename(r));
}

export function dentroDeTrabajo(ruta: string): boolean {
  return real(ruta).startsWith(real(DIR) + sep);
}

/** Si `ruta` ya existe, devuelve la primera variante libre: nombre_2.ext, nombre_3.ext… */
export function rutaLibre(ruta: string): string {
  if (!existsSync(ruta)) return ruta;
  const ext = extname(ruta);
  const base = ruta.slice(0, ruta.length - ext.length);
  for (let i = 2; ; i++) {
    const r = `${base}_${i}${ext}`;
    if (!existsSync(r)) return r;
  }
}

/** Copia `origen` a COPIAS (si no está ya dentro de la carpeta de trabajo) y devuelve la copia. */
export async function copiaDeTrabajo(origen: string): Promise<string> {
  const r = resolve(origen);
  if (!existsSync(r)) throw new Error(`No existe: ${r}`);
  if (dentroDeTrabajo(r)) return r;
  const ext = extname(r);
  const destino = rutaLibre(join(COPIAS, `${basename(r, ext)}_atril${ext}`));
  // Un .key puede ser un paquete (carpeta) en formatos viejos: copia recursiva.
  await cp(r, destino, { recursive: true, errorOnExist: true, force: false });
  return destino;
}
