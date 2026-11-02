// Animaciones dentro de la diapositiva con Magic Move. Keynote no expone los
// builds a scripts, pero sí las transiciones: se duplica la diapositiva, se cambia la copia
// y Magic Move anima la diferencia. Verificado con video:
// aparecer/desaparecer (fundido), mover, escalar, girar, atenuar y cambiar color de texto.
import { editable } from "./herramientas.ts";
import { applescript, jxa } from "./keynote.ts";
import { duplicarDiapositiva, grafica, transicion, type Caja } from "./visuales.ts";

const CLASES = {
  texto: ["text item", "textItems"], figura: ["shape", "shapes"], imagen: ["image", "images"],
  video: ["movie", "movies"], audio: ["audio clip", "audioClips"], tabla: ["table", "tables"],
  grafica: ["chart", "charts"], linea: ["line", "lines"], grupo: ["group", "groups"],
} as const;
export type TipoObjeto = keyof typeof CLASES;
export const TIPOS_OBJETO = Object.keys(CLASES) as TipoObjeto[];
export interface RefObjeto { tipo: TipoObjeto; indice: number }

async function conteos(id: string, n: number) {
  return jxa<Record<string, number>>(`
const s = diapositiva(doc(p.id), p.n);
const r = {};
for (const [tipo, col] of Object.entries(p.cols)) r[tipo] = intento(() => s[col]().length, 0);
return r;`, { id, n, cols: Object.fromEntries(TIPOS_OBJETO.map((t) => [t, CLASES[t][1]])) });
}

function validar(refs: RefObjeto[], c: Record<string, number>, n: number) {
  for (const r of refs) {
    if (!CLASES[r.tipo]) throw new Error(`Tipo desconocido "${r.tipo}". Tipos: ${TIPOS_OBJETO.join(", ")}`);
    if (!(r.indice >= 1 && r.indice <= c[r.tipo])) throw new Error(`No hay ${r.tipo} ${r.indice} en la diapositiva ${n} (hay ${c[r.tipo]})`);
  }
}

/** Borra objetos de una diapositiva; de mayor a menor índice para que no se corran. */
async function borrar(id: string, n: number, refs: RefObjeto[]) {
  const orden = [...refs].sort((a, b) => a.tipo === b.tipo ? b.indice - a.indice : a.tipo.localeCompare(b.tipo));
  for (const r of orden) {
    // El delete() de JXA falla con -10000; el de AppleScript no.
    await applescript(`tell slide ((item 2 of argv) as integer) of document id (item 1 of argv)
delete ${CLASES[r.tipo][0]} ((item 3 of argv) as integer)
end tell`, [id, String(n), String(r.indice)]);
  }
}

export async function borrarObjeto(ref: string, n: number, tipo: TipoObjeto, indice: number) {
  const d = await editable(ref);
  validar([{ tipo, indice }], await conteos(d.id, n), n);
  await borrar(d.id, n, [{ tipo, indice }]);
  return { documento: d.nombre, diapositiva: n, borrado: { tipo, indice }, quedan: await conteos(d.id, n) };
}

/**
 * Los objetos aparecen en el orden de `pasos` (cada paso, uno o varios objetos a la vez).
 * La diapositiva n queda como la versión final y se insertan antes sus versiones parciales:
 * de n a n + pasos.length, todas unidas por Magic Move.
 */
export async function revelarPorPasos(ref: string, n: number, pasos: RefObjeto[][], duracion = 1) {
  const d = await editable(ref);
  if (!pasos.length || pasos.some((p) => !p.length)) throw new Error("Cada paso necesita al menos un objeto");
  const todos = pasos.flat();
  validar(todos, await conteos(d.id, n), n);
  const clave = (r: RefObjeto) => `${r.tipo}:${r.indice}`;
  if (new Set(todos.map(clave)).size !== todos.length) throw new Error("Un objeto aparece en más de un paso");
  const k = pasos.length;
  // Copias idénticas: n, n+1, …, n+k. La n+j muestra solo los pasos anteriores a j.
  for (let j = 0; j < k; j++) await duplicarDiapositiva(d.id, n);
  for (let j = 0; j < k; j++) await borrar(d.id, n + j, pasos.slice(j).flat());
  for (let j = 0; j < k; j++) await transicion(d.id, n + j, "magic move", duracion);
  return { documento: d.nombre, diapositivas: Array.from({ length: k + 1 }, (_, j) => n + j), pasos: k };
}

export interface Cambio extends RefObjeto, Caja { rotacion?: number; opacidad?: number; color_texto?: string }

/**
 * Anima cambios de un objeto: duplica la diapositiva n, aplica los cambios en la copia (n+1)
 * y pone Magic Move de n a n+1. Mover y escalar (x, y, ancho, alto), girar (rotacion en
 * grados), atenuar (opacidad 0–100) y resaltar (color_texto, hex, en textos).
 */
export async function animarCambio(ref: string, n: number, cambios: Cambio[], duracion = 1) {
  const d = await editable(ref);
  if (!cambios.length) throw new Error("Hace falta al menos un cambio");
  validar(cambios, await conteos(d.id, n), n);
  for (const c of cambios) {
    if (c.color_texto !== undefined && !/^[0-9a-f]{6}$/i.test(c.color_texto)) throw new Error(`color_texto debe ser hex de 6 dígitos (recibí "${c.color_texto}")`);
    if (c.color_texto !== undefined && !["texto", "figura"].includes(c.tipo)) throw new Error("color_texto solo aplica a texto o figura");
    if (c.opacidad !== undefined && !(c.opacidad >= 0 && c.opacidad <= 100)) throw new Error("opacidad va de 0 a 100");
  }
  const { copia } = await duplicarDiapositiva(d.id, n);
  const resultado = await jxa(`
const d = doc(p.id); fueraDeVista(d, p.n);
const s = diapositiva(d, p.n);
const hex = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) * 257);
const r = p.cambios.map((c) => {
  const o = s[p.cols[c.tipo]][c.indice - 1];
  if (c.ancho != null) o.width = c.ancho;
  if (c.alto != null) o.height = c.alto;
  if (c.x != null || c.y != null) { const q = o.position(); o.position = { x: c.x ?? q.x, y: c.y ?? q.y }; }
  if (c.rotacion != null) o.rotation = Math.round(((c.rotacion % 360) + 360) % 360);
  if (c.opacidad != null) o.opacity = Math.round(c.opacidad);
  if (c.color_texto != null) o.objectText.color = hex(c.color_texto);
  const q = o.position();
  return { tipo: c.tipo, indice: c.indice, x: q.x, y: q.y, ancho: o.width(), alto: o.height() };
});
aLaVista(d, p.n);
return r;`, { id: d.id, n: copia, cambios, cols: Object.fromEntries(TIPOS_OBJETO.map((t) => [t, CLASES[t][1]])) });
  await transicion(d.id, n, "magic move", duracion);
  return { documento: d.nombre, de: n, a: copia, cambios: resultado };
}

/**
 * Gráfica cuyas series entran una por una: la diapositiva n lleva la primera serie y cada
 * copia agrega la siguiente, con Magic Move entre ellas. Por script no se puede fijar el
 * máximo del eje, así que el eje se reescala entre pasos.
 */
export async function revelarSeries(ref: string, n: number, tipo: string, categorias: string[], series: { nombre: string; valores: number[] }[], caja: Caja = {}, duracion = 1) {
  const d = await editable(ref);
  if (tipo.startsWith("pastel") || tipo === "dispersion") throw new Error("revelar_series es para barras, líneas o áreas");
  if (series.length < 2) throw new Error("revelar_series necesita al menos dos series");
  await grafica(d.id, n, tipo, categorias, series.slice(0, 1), caja);
  const diapositivas = [n];
  for (let k = 2; k <= series.length; k++) {
    const { copia } = await duplicarDiapositiva(d.id, diapositivas[diapositivas.length - 1]);
    // Fuera la gráfica y la leyenda anterior (textos "■ …"); entra la de k series.
    await applescript(`tell slide ((item 2 of argv) as integer) of document id (item 1 of argv)
delete every chart
repeat with i from (count of text items) to 1 by -1
  if (object text of text item i) starts with "■ " then delete text item i
end repeat
end tell`, [d.id, String(copia)]);
    await grafica(d.id, copia, tipo, categorias, series.slice(0, k), caja);
    await transicion(d.id, diapositivas[diapositivas.length - 1], "magic move", duracion);
    diapositivas.push(copia);
  }
  return { documento: d.nombre, diapositivas, series: series.map((s) => s.nombre) };
}
