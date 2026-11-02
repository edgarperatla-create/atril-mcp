// El formato: las presentaciones nacen de la plantilla del tema (<tema>/plantilla.key), que
// trae los diseños maestros (Portada, Divisor, Contenido, Figura, Tabla, Cierre) y una
// diapositiva prototipo oculta por tipo. Cada herramienta duplica el prototipo y cambia
// sus textos: así conserva lo que el script no sabe fijar (espaciado de letras,
// rellenos, la tarjeta de figura). Ver tema/construir_plantilla.cjs y src/tema.ts.
import { execFile } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { abrir, editable } from "./herramientas.ts";
import { applescript, jxa } from "./keynote.ts";
import { TEMA } from "./tema.ts";
import { COPIAS, rutaLibre } from "./trabajo.ts";

const SIN_ORIGEN = "atril:sin-origen";

const ejecutar = promisify(execFile);
export const PLANTILLA = TEMA.plantilla;
const PT = 72; // puntos por pulgada: la plantilla mide en pulgadas, Keynote en puntos

export type Tipo = "portada" | "divisor" | "contenido" | "figura" | "tabla" | "cierre" | "contenido_vinetas" | "figura_vinetas";

// Texto de muestra de cada prototipo → campo que lo reemplaza (tema/construir_plantilla.cjs).
const MUESTRAS: Record<Tipo, Record<string, string>> = {
  portada: { "ANTETÍTULO DE PORTADA": "antetitulo", "Autor  ·  Institución  ·  Año": "autor" },
  divisor: { "01": "numero" },
  contenido: { "ANTETÍTULO": "antetitulo", "Sección": "pie" },
  figura: { "ANTETÍTULO": "antetitulo", "Sección": "pie", "Elaboración propia": "origen" },
  // Mismos textos de muestra; el cuerpo trae las viñetas animadas (una por clic).
  contenido_vinetas: { "ANTETÍTULO": "antetitulo", "Sección": "pie" },
  figura_vinetas: { "ANTETÍTULO": "antetitulo", "Sección": "pie", "Elaboración propia": "origen" },
  tabla: { "ANTETÍTULO": "antetitulo", "Sección": "pie" },
  cierre: { "Autor · Institución": "autor" },
};

export interface Campos {
  antetitulo?: string; titulo?: string; subtitulo?: string; cuerpo?: string;
  pie?: string; autor?: string; numero?: string; origen?: string; notas?: string;
}

export async function crearConFormato(nombre?: string) {
  if (!existsSync(PLANTILLA)) throw new Error(`No existe la plantilla ${PLANTILLA}; genérala con npm run plantilla -- ${TEMA.dir}`);
  const base = (nombre ?? `presentacion_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}`)
    .replace(/\.key$/i, "").replace(/[/:]/g, "_");
  await mkdir(COPIAS, { recursive: true });
  const destino = rutaLibre(join(COPIAS, `${base}.key`));
  await copyFile(PLANTILLA, destino);
  return abrir(destino);
}

/** Duplica el prototipo `tipo`, lo coloca y llena sus textos. Devuelve el número de diapositiva. */
export async function agregarConFormato(ref: string, tipo: Tipo, campos: Campos, despuesDe?: number) {
  const d = await editable(ref);
  const { proto, reales } = await jxa<{ proto: number; reales: number }>(`
const notas = doc(p.id).slides.presenterNotes();
const proto = notas.indexOf("atril:prototipo:" + p.tipo) + 1;
const primero = notas.findIndex((n) => n.startsWith("atril:prototipo:"));
return { proto, reales: primero < 0 ? notas.length : primero };`, { id: d.id, tipo });
  if (!proto) throw new Error(`"${d.nombre}" no tiene el prototipo "${tipo}": créala con crear_con_formato`);
  const despues = despuesDe ?? reales;
  if (!(despues >= 0 && despues <= reales)) throw new Error(`despues_de debe estar entre 0 y ${reales} (las diapositivas reales)`);

  await applescript(`set d to document id (item 1 of argv)
duplicate slide ((item 2 of argv) as integer) of d to end of slides of d
set destino to (item 3 of argv) as integer
if destino is 0 then
  move last slide of d to before slide 1 of d
else
  move last slide of d to after slide destino of d
end if`, [d.id, String(proto), String(despues)]);
  const n = despues + 1;

  const reemplazos = Object.entries(MUESTRAS[tipo]).map(([muestra, campo]) => {
    const valor = campos[campo as keyof Campos] ?? "";
    return [muestra, campo === "antetitulo" ? valor.toUpperCase() : valor];
  });
  // Portada, divisor y cierre usan el cuerpo del diseño como subtítulo.
  const cuerpo = ["portada", "divisor", "cierre"].includes(tipo) ? campos.subtitulo : campos.cuerpo;
  await jxa(`
const d = doc(p.id);
const s = diapositiva(d, p.n);
fueraDeVista(d, p.n);
s.skipped = false;
s.presenterNotes = p.notas || "";
const textos = s.textItems.objectText();
for (const [muestra, valor] of p.reemplazos) {
  const j = textos.indexOf(muestra);
  if (j < 0) throw new Error("El prototipo no tiene el texto de muestra " + muestra);
  s.textItems[j].objectText = valor;
}
if (p.titulo != null) s.defaultTitleItem.objectText = p.titulo;
if (s.bodyShowing()) {
  if (p.cuerpo == null) s.bodyShowing = false;
  else s.defaultBodyItem.objectText = p.cuerpo;
}
aLaVista(d, p.n);`, { id: d.id, n, reemplazos, titulo: campos.titulo, cuerpo, notas: campos.notas });
  return { documento: d.nombre, id: d.id, diapositiva: n, tipo };
}

/**
 * Figura sobre tarjeta blanca: la imagen se ajusta a la caja conservando su proporción; la
 * tarjeta sobresale 0.08 in y el pie de origen va 0.06 in debajo. Con cuerpo, la figura va a la
 * izquierda; sin cuerpo, a todo el ancho. Sin origen (si el tema no lo exige), no lleva pie.
 */
export async function agregarFigura(ref: string, imagen: string, campos: Campos, despuesDe?: number, animarVinetas = false) {
  const ruta = resolve(imagen.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
  if (!existsSync(ruta)) throw new Error(`No existe la imagen ${ruta}`);
  if (TEMA.origen_obligatorio && !campos.origen?.trim()) throw new Error("La figura necesita su pie de origen (p. ej. \"Elaboración propia\"; el tema lo exige)");
  // Sin origen, el pie de muestra se marca y se borra al final.
  const origen = campos.origen?.trim() ? campos.origen : SIN_ORIGEN;
  const { stdout } = await ejecutar("sips", ["-g", "pixelWidth", "-g", "pixelHeight", ruta]);
  const iw = Number(stdout.match(/pixelWidth: (\d+)/)?.[1]);
  const ih = Number(stdout.match(/pixelHeight: (\d+)/)?.[1]);
  if (!iw || !ih) throw new Error(`No pude leer el tamaño de ${ruta}: ¿es una imagen?`);

  if (animarVinetas && campos.cuerpo == null) throw new Error("animar_vinetas necesita un cuerpo con viñetas");
  const r = await agregarConFormato(ref, animarVinetas ? "figura_vinetas" : "figura", { ...campos, origen }, despuesDe);
  const caja = campos.cuerpo != null ? { x: 0.6, y: 1.85, w: 6.55, h: 4.47 } : { x: 0.6, y: 1.85, w: 12.1, h: 4.6 };
  const escala = Math.min(caja.w / iw, caja.h / ih);
  const w = iw * escala, h = ih * escala;
  const x = caja.x + (caja.w - w) / 2, y = caja.y;
  const pt = (v: number) => Math.round(v * PT);

  await applescript(`tell slide ((item 2 of argv) as integer) of document id (item 1 of argv)
  make new image with properties {file:(POSIX file (item 3 of argv)), position:{(item 4 of argv) as integer, (item 5 of argv) as integer}, width:(item 6 of argv) as integer}
end tell`, [r.id, String(r.diapositiva), ruta, String(pt(x)), String(pt(y)), String(pt(w))]);
  await jxa(`
const s = diapositiva(doc(p.id), p.n);
// La tarjeta es la figura sin texto más grande del prototipo.
const textos = s.shapes.objectText(), anchos = s.shapes.width(), altos = s.shapes.height();
let t = -1;
for (let j = 0; j < textos.length; j++) if (!textos[j] && (t < 0 || anchos[j] * altos[j] > anchos[t] * altos[t])) t = j;
if (t < 0) throw new Error("El prototipo de figura no tiene tarjeta");
const tarjeta = s.shapes[t];
tarjeta.width = p.w + 2 * p.borde; tarjeta.height = p.h + 2 * p.borde;
tarjeta.position = { x: p.x - p.borde, y: p.y - p.borde };
const pie = s.textItems[s.textItems.objectText().indexOf(p.origen)];
pie.width = p.w;
pie.position = { x: p.x, y: p.y + p.h + p.sep };`, {
    id: r.id, n: r.diapositiva, x: pt(x), y: pt(y), w: pt(w), h: pt(h), borde: 0.08 * PT, sep: 0.06 * PT, origen,
  });
  if (origen === SIN_ORIGEN) {
    await applescript(`tell slide ((item 2 of argv) as integer) of document id (item 1 of argv)
  delete (first text item whose object text is (item 3 of argv))
end tell`, [r.id, String(r.diapositiva), SIN_ORIGEN]);
  }
  return { ...r, imagen: ruta, caja_pt: { x: pt(x), y: pt(y), ancho: pt(w), alto: pt(h) } };
}
