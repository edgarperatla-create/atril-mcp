// edición de conjunto — buscar y reemplazar, alinear, distribuir y bloquear objetos,
// y diapositivas a partir de una serie de imágenes.
import { existsSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { agregarFigura } from "./formato.ts";
import { documento, editable } from "./herramientas.ts";
import { applescript, jxa } from "./keynote.ts";
import { TEMA } from "./tema.ts";
import { editarCeldas } from "./visuales.ts";

const COLECCIONES: Record<string, string> = { texto: "textItems", figura: "shapes", imagen: "images", video: "movies", tabla: "tables", grafica: "charts", linea: "lines", grupo: "groups" };

interface Encontrado { diapositiva: number; donde: string; antes: string; despues: string }

/**
 * Busca (y si se da `reemplazar`, reemplaza) texto en toda la presentación: cuadros de texto,
 * figuras con texto, notas y celdas de tablas. Escribir un texto completo le aplica el estilo de
 * su primer carácter, así que un texto con formato mixto (p. ej. un énfasis en negrita de color) no
 * se reescribe salvo con `forzar`: se reporta para cambiarlo a mano o con poner_texto.
 */
export async function buscarReemplazar(ref: string, buscar: string, o: { reemplazar?: string; mayusculas?: boolean; notas?: boolean; tablas?: boolean; forzar?: boolean } = {}) {
  if (!buscar) throw new Error("Hace falta el texto a buscar");
  const d = o.reemplazar === undefined ? await documento(ref) : await editable(ref);
  const r = await jxa<{ hallazgos: Encontrado[]; mixtos: Encontrado[]; celdas: { n: number; tabla: number; fila: number; columna: number; valor: string; antes: string }[] }>(`
const d = doc(p.id);
const esc = p.buscar.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&");
const re = () => new RegExp(esc, p.mayusculas ? "g" : "gi");
const cambia = p.reemplazar != null;
const hallazgos = [], mixtos = [], celdas = [];
const uniforme = (t) => ["font", "size", "color"].every((prop) => {
  const v = intento(() => t.words[prop](), []).map((x) => JSON.stringify(x));
  return new Set(v).size <= 1;
});
d.slides().forEach((s, i) => {
  const n = i + 1;
  if (String(intento(() => s.presenterNotes(), "")).startsWith("atril:prototipo:")) return;
  let fuera = false;
  for (const [tipo, col] of [["texto", "textItems"], ["figura", "shapes"]]) {
    const c = s[col]; const m = intento(() => c().length, 0);
    for (let j = 0; j < m; j++) {
      const t = c[j]; const txt = String(intento(() => t.objectText(), ""));
      if (!re().test(txt)) continue;
      const nuevo = cambia ? txt.replace(re(), p.reemplazar) : txt;
      const h = { diapositiva: n, donde: tipo + " " + (j + 1), antes: txt.slice(0, 80), despues: nuevo.slice(0, 80) };
      if (cambia && !p.forzar && !uniforme(t.objectText)) { mixtos.push(h); continue; }
      if (cambia) { if (!fuera) { fueraDeVista(d, n); fuera = true; } t.objectText = nuevo; }
      hallazgos.push(h);
    }
  }
  if (p.notas) {
    const nt = String(intento(() => s.presenterNotes(), ""));
    if (re().test(nt)) {
      const nuevo = cambia ? nt.replace(re(), p.reemplazar) : nt;
      if (cambia) s.presenterNotes = nuevo;
      hallazgos.push({ diapositiva: n, donde: "notas", antes: nt.slice(0, 80), despues: nuevo.slice(0, 80) });
    }
  }
  if (p.tablas) {
    const ts = s.tables; const m = intento(() => ts().length, 0);
    for (let j = 0; j < m; j++) {
      const nc = ts[j].columnCount(), v = intento(() => ts[j].cellRange.cells.formattedValue(), []);
      v.forEach((x, k) => {
        const txt = x == null ? "" : String(x);
        if (!re().test(txt)) return;
        const nuevo = cambia ? txt.replace(re(), p.reemplazar) : txt;
        celdas.push({ n, tabla: j + 1, fila: Math.floor(k / nc) + 1, columna: (k % nc) + 1, valor: nuevo, antes: txt });
      });
    }
  }
  if (fuera) aLaVista(d, n);
});
return { hallazgos, mixtos, celdas };`, { id: d.id, buscar, reemplazar: o.reemplazar, mayusculas: !!o.mayusculas, notas: o.notas ?? true, tablas: o.tablas ?? true, forzar: !!o.forzar });
  // Celdas: con editar_celdas, que conserva el formato de texto (signos y guiones).
  if (o.reemplazar !== undefined) {
    const porTabla = new Map<string, typeof r.celdas>();
    for (const c of r.celdas) { const k = `${c.n}:${c.tabla}`; porTabla.set(k, [...(porTabla.get(k) ?? []), c]); }
    for (const cs of porTabla.values()) await editarCeldas(d.id, cs[0].n, cs[0].tabla, cs.map((c) => ({ fila: c.fila, columna: c.columna, valor: c.valor })));
  }
  const celdas = r.celdas.map((c) => ({ diapositiva: c.n, donde: `tabla ${c.tabla}, celda (${c.fila}, ${c.columna})`, antes: c.antes, despues: c.valor }));
  return {
    documento: d.nombre, buscar, reemplazado: o.reemplazar !== undefined,
    total: r.hallazgos.length + celdas.length, coincidencias: [...r.hallazgos, ...celdas],
    sin_cambiar_por_formato_mixto: r.mixtos,
  };
}

interface Ref { tipo: string; indice: number }
async function geometrias(id: string, n: number, objetos: Ref[]) {
  for (const o of objetos) if (!COLECCIONES[o.tipo]) throw new Error(`Tipo desconocido "${o.tipo}". Tipos: ${Object.keys(COLECCIONES).join(", ")}`);
  return jxa<{ x: number; y: number; ancho: number; alto: number }[]>(`
const s = diapositiva(doc(p.id), p.n);
return p.objetos.map((o) => {
  const c = s[p.cols[o.tipo]]; const m = c().length;
  if (!(o.indice >= 1 && o.indice <= m)) throw new Error("No hay " + o.tipo + " " + o.indice + " en la diapositiva " + p.n + " (hay " + m + ")");
  const x = c[o.indice - 1], q = x.position();
  return { x: q.x, y: q.y, ancho: x.width(), alto: x.height() };
});`, { id, n, objetos, cols: COLECCIONES });
}
async function mover(id: string, n: number, objetos: Ref[], posiciones: { x: number; y: number }[]) {
  await jxa(`
const s = diapositiva(doc(p.id), p.n);
p.objetos.forEach((o, i) => { s[p.cols[o.tipo]][o.indice - 1].position = { x: Math.round(p.pos[i].x), y: Math.round(p.pos[i].y) }; });`, { id, n, objetos, pos: posiciones, cols: COLECCIONES });
}

export type Alineacion = "izquierda" | "centro" | "derecha" | "arriba" | "medio" | "abajo";

/** Alinea objetos entre sí, o con la diapositiva (`respecto: "diapositiva"`). */
export async function alinearObjetos(ref: string, n: number, objetos: Ref[], modo: Alineacion, respecto: "objetos" | "diapositiva" = "objetos") {
  const d = await editable(ref);
  if (respecto === "objetos" && objetos.length < 2) throw new Error("Para alinear entre sí hacen falta al menos dos objetos");
  const g = await geometrias(d.id, n, objetos);
  const caja = respecto === "diapositiva"
    ? { x0: 0, y0: 0, x1: d.ancho, y1: d.alto }
    : { x0: Math.min(...g.map((o) => o.x)), y0: Math.min(...g.map((o) => o.y)), x1: Math.max(...g.map((o) => o.x + o.ancho)), y1: Math.max(...g.map((o) => o.y + o.alto)) };
  const pos = g.map((o) => ({
    x: modo === "izquierda" ? caja.x0 : modo === "derecha" ? caja.x1 - o.ancho : modo === "centro" ? (caja.x0 + caja.x1 - o.ancho) / 2 : o.x,
    y: modo === "arriba" ? caja.y0 : modo === "abajo" ? caja.y1 - o.alto : modo === "medio" ? (caja.y0 + caja.y1 - o.alto) / 2 : o.y,
  }));
  await mover(d.id, n, objetos, pos);
  return { documento: d.nombre, diapositiva: n, modo, respecto, posiciones: pos.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) };
}

/** Reparte objetos con el mismo espacio entre ellos, entre el primero y el último. */
export async function distribuirObjetos(ref: string, n: number, objetos: Ref[], eje: "horizontal" | "vertical") {
  const d = await editable(ref);
  if (objetos.length < 3) throw new Error("Para distribuir hacen falta al menos tres objetos");
  const g = await geometrias(d.id, n, objetos);
  const orden = g.map((o, i) => ({ ...o, i })).sort((a, b) => (eje === "horizontal" ? a.x - b.x : a.y - b.y));
  const tam = (o: typeof orden[0]) => (eje === "horizontal" ? o.ancho : o.alto);
  const ini = eje === "horizontal" ? orden[0].x : orden[0].y;
  const fin = eje === "horizontal" ? orden.at(-1)!.x + orden.at(-1)!.ancho : orden.at(-1)!.y + orden.at(-1)!.alto;
  const hueco = (fin - ini - orden.reduce((s, o) => s + tam(o), 0)) / (orden.length - 1);
  const pos = g.map((o) => ({ x: o.x, y: o.y }));
  let cursor = ini;
  for (const o of orden) {
    if (eje === "horizontal") pos[o.i].x = cursor; else pos[o.i].y = cursor;
    cursor += tam(o) + hueco;
  }
  await mover(d.id, n, objetos, pos);
  return { documento: d.nombre, diapositiva: n, eje, espacio_pt: Math.round(hueco * 10) / 10 };
}

export async function bloquearObjeto(ref: string, n: number, objeto: Ref, bloquear = true) {
  const d = await editable(ref);
  await geometrias(d.id, n, [objeto]);
  await jxa(`diapositiva(doc(p.id), p.n)[p.col][p.indice - 1].locked = p.bloquear;`, { id: d.id, n, col: COLECCIONES[objeto.tipo], indice: objeto.indice, bloquear });
  return { documento: d.nombre, diapositiva: n, objeto, bloqueado: bloquear };
}

/**
 * Una diapositiva por imagen. Con el formato, cada una es una diapositiva_figura
 * (tarjeta blanca y pie de origen, obligatorio si el tema lo exige); en otras presentaciones, el comando
 * `make image slides` de Keynote, que las pone después de la diapositiva actual.
 */
export async function diapositivasDesdeImagenes(ref: string, imagenes: string[], o: { origen?: string; titulos?: string[]; antetitulo?: string; pie?: string; despues_de?: number } = {}) {
  const d = await editable(ref);
  if (!imagenes.length) throw new Error("Hace falta al menos una imagen");
  const rutas = imagenes.map((i) => resolve(i.replace(/^~(?=\/)/, process.env.HOME ?? "~")));
  for (const r of rutas) if (!existsSync(r)) throw new Error(`No existe ${r}`);
  if (o.titulos && o.titulos.length !== rutas.length) throw new Error(`Hay ${rutas.length} imágenes y ${o.titulos.length} títulos`);
  const conFormato = (await jxa<boolean>(`return doc(p.id).slides.presenterNotes().some((x) => String(x).startsWith("atril:prototipo:"));`, { id: d.id }));
  const titulo = (i: number) => o.titulos?.[i] ?? basename(rutas[i], extname(rutas[i])).replace(/[_-]+/g, " ");
  if (conFormato) {
    if (TEMA.origen_obligatorio && !o.origen?.trim()) throw new Error("Con el formato, cada figura necesita su pie de origen (origen; el tema lo exige)");
    const hechas: number[] = [];
    for (const [i, r] of rutas.entries()) {
      const despues = o.despues_de === undefined ? undefined : o.despues_de + i;
      const f = await agregarFigura(d.id, r, { antetitulo: o.antetitulo ?? "", titulo: titulo(i), origen: o.origen, pie: o.pie }, despues);
      hechas.push(f.diapositiva);
    }
    return { documento: d.nombre, con_formato: true, diapositivas: hechas };
  }
  await applescript(`set d to document id (item 1 of argv)
set archivos to {}
repeat with i from 2 to count of argv
  set end of archivos to my archivo(item i of argv)
end repeat
make image slides d files archivos with set titles`, [d.id, ...rutas]);
  return { documento: d.nombre, con_formato: false, imagenes: rutas.length };
}
