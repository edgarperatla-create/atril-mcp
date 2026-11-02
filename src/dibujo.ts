// Ecuaciones, figuras y componentes del formato (colores y tipografías del tema).
//
// Keynote no deja fijar por script el relleno, el borde ni el tipo de una figura, ni crear
// ecuaciones. Atril los genera como gráficos vectoriales y los inserta como imagen:
// - Ecuaciones: LaTeX real (pdflatex de TeX Live, sin shell-escape) → PDF vectorial.
// - Figuras: SVG con la paleta exacta; Keynote lo dibuja vectorial.
// - Componentes (cifras destacadas, tarjetas, agenda, video): figuras + textos con estilo.
// Keynote no expone la alineación de párrafo: el texto "centrado" es un cuadro que se ajusta a
// su contenido, centrado sobre la figura (una línea por cuadro).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { agregarConFormato, type Campos } from "./formato.ts";
import { editable } from "./herramientas.ts";
import { jxa } from "./keynote.ts";
import { TEMA, color, fuentePS } from "./tema.ts";
import { DIR } from "./trabajo.ts";
import { insertarMedio } from "./visuales.ts";

const ejecutar = promisify(execFile);
const PT = 72;
const W = 960, AREA = { x: 0.6 * PT, y: 1.85 * PT, ancho: 12.1 * PT, alto: 4.9 * PT };

export { PALETA, color } from "./tema.ts";
const num = (v: number, nombre: string) => { if (!Number.isFinite(v)) throw new Error(`${nombre} debe ser un número`); return v; };
const huella = (...partes: unknown[]) => createHash("sha1").update(JSON.stringify(partes)).digest("hex").slice(0, 12);

// ---------- texto con estilo ----------
// `fuente` es el papel de la tipografía en el tema: la de títulos o la de texto.
export interface EstiloTexto { fuente?: "titulo" | "texto"; tamano?: number; color?: string; negrita?: boolean; cursiva?: boolean }
export function nombreFuente(e: EstiloTexto) {
  return fuentePS(TEMA.fuentes[e.fuente ?? "texto"], !!e.negrita, !!e.cursiva);
}

/**
 * Cuadros de texto con estilo. `centro_x` centra cada cuadro (ajustado a su contenido) en esa
 * coordenada; `ancho` fija el ancho y el texto se ajusta en líneas (alineado a la izquierda).
 */
async function textos(id: string, n: number, cuadros: { texto: string; x: number; y: number; ancho?: number; centro_x?: boolean; estilo: EstiloTexto }[]) {
  return jxa<{ x: number; y: number; ancho: number; alto: number }[]>(`
const d = doc(p.id); fueraDeVista(d, p.n);
const s = diapositiva(d, p.n);
const hex = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) * 257);
const r = p.cuadros.map((c) => {
  const t = k.TextItem({ objectText: c.texto });
  s.textItems.push(t);
  t.objectText.font = c.fuente; t.objectText.size = c.tamano; t.objectText.color = hex(c.color);
  if (c.ancho) t.width = c.ancho;
  const x = c.centro_x ? c.x - t.width() / 2 : c.x;
  t.position = { x, y: c.y };
  return { x, y: c.y, ancho: t.width(), alto: t.height() };
});
aLaVista(d, p.n);
return r;`, { id, n, cuadros: cuadros.map((c) => ({ ...c, fuente: nombreFuente(c.estilo), tamano: c.estilo.tamano ?? 15, color: color(c.estilo.color ?? "texto") })) });
}

export async function estiloTexto(ref: string, n: number, tipo: "texto" | "figura", indice: number, e: EstiloTexto & { parrafo?: number }) {
  const d = await editable(ref);
  return jxa(`
const d = doc(p.id); fueraDeVista(d, p.n);
const s = diapositiva(d, p.n);
const c = p.tipo === "figura" ? s.shapes : s.textItems;
const m = c().length;
if (!(p.indice >= 1 && p.indice <= m)) throw new Error("No hay " + p.tipo + " " + p.indice + " en la diapositiva " + p.n + " (hay " + m + ")");
let t = c[p.indice - 1].objectText;
if (p.e.parrafo != null) {
  const np = t.paragraphs.length;
  if (!(p.e.parrafo >= 1 && p.e.parrafo <= np)) throw new Error("Ese texto tiene " + np + " párrafos");
  t = t.paragraphs[p.e.parrafo - 1];
}
const actual = String(t.font());
const papel = p.e.fuente || (p.titulo.includes(actual) ? "titulo" : "texto");
const negrita = p.e.negrita ?? /Bold|Black|Heavy|Demi/.test(actual), cursiva = p.e.cursiva ?? /Italic|Oblique/.test(actual);
t.font = p.ps[papel][(negrita ? 2 : 0) + (cursiva ? 1 : 0)];
if (p.e.tamano != null) t.size = p.e.tamano;
if (p.e.color != null) t.color = [0, 2, 4].map((i) => parseInt(p.e.color.slice(i, i + 2), 16) * 257);
aLaVista(d, p.n);
return { fuente: String(t.font()), tamano: t.size(), color: t.color() };`, {
    id: d.id, n, tipo, indice, e: { ...e, color: e.color === undefined ? undefined : color(e.color) },
    // Las cuatro variantes (normal, cursiva, negrita, negrita cursiva) de cada tipografía del tema.
    ps: Object.fromEntries((["titulo", "texto"] as const).map((k) => [k, [[0, 0], [0, 1], [1, 0], [1, 1]].map(([b, i]) => fuentePS(TEMA.fuentes[k], !!b, !!i))])),
    titulo: [[0, 0], [0, 1], [1, 0], [1, 1]].map(([b, i]) => fuentePS(TEMA.fuentes.titulo, !!b, !!i)),
  });
}

// ---------- ecuaciones ----------
function pdflatex() {
  for (const r of ["/Library/TeX/texbin/pdflatex", "/opt/homebrew/bin/pdflatex", "/usr/local/bin/pdflatex"]) if (existsSync(r)) return r;
  throw new Error("No encontré pdflatex (TeX Live o MacTeX)");
}

export interface OpcionesEcuacion { x?: number; y?: number; tamano?: number; color?: string; paquetes?: string[]; ancho?: number }

/**
 * Ecuación en LaTeX (modo display, sin los $) a PDF vectorial con el color del formato. Sin
 * `ancho`, se inserta a su tamaño natural: el texto queda del `tamano` pedido en puntos.
 * Sin `x`, se centra en la diapositiva.
 */
export async function ecuacion(ref: string, n: number, latex: string, o: OpcionesEcuacion = {}) {
  const d = await editable(ref);
  const tamano = num(o.tamano ?? 28, "tamano"), tinta = color(o.color ?? "titulo");
  for (const pq of o.paquetes ?? []) if (!/^[a-zA-Z0-9-]+$/.test(pq)) throw new Error(`Nombre de paquete no válido: ${pq}`);
  if (/\\(write18|immediate|openout|input|include)\b/.test(latex)) throw new Error("La ecuación no puede leer ni escribir archivos");
  const dir = join(DIR, "ecuaciones");
  await mkdir(dir, { recursive: true });
  const base = `ec_${huella(latex, tamano, tinta, o.paquetes)}`;
  const tex = [
    // fix-cm: sin él, Computer Modern no pasa de ~25 pt y una ecuación a 28 y a 56 pt mide
    // casi lo mismo.
    "\\RequirePackage{fix-cm}",
    "\\documentclass[border=2pt]{standalone}",
    "\\usepackage{amsmath,amssymb}", "\\usepackage{xcolor}",
    ...(o.paquetes ?? []).map((pq) => `\\usepackage{${pq}}`),
    `\\definecolor{tinta}{HTML}{${tinta}}`,
    "\\begin{document}",
    `\\color{tinta}\\fontsize{${tamano}}{${(tamano * 1.2).toFixed(1)}}\\selectfont`,
    `$\\displaystyle ${latex}$`,
    "\\end{document}", "",
  ].join("\n");
  await writeFile(join(dir, `${base}.tex`), tex);
  try {
    await ejecutar(pdflatex(), ["-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", `-output-directory=${dir}`, join(dir, `${base}.tex`)], { timeout: 60_000, cwd: dir });
  } catch {
    const log = await readFile(join(dir, `${base}.log`), "utf8").catch(() => "");
    const error = log.split("\n").map((l, i, a) => (l.startsWith("!") ? [l, a[i + 1], a[i + 2]].join(" ").trim() : null)).filter(Boolean).slice(0, 2).join(" | ");
    throw new Error(`LaTeX no compiló: ${error || "revisa la sintaxis"}`);
  }
  const pdf = join(dir, `${base}.pdf`);
  const r = await insertarMedio(d.id, n, pdf, o.ancho ? { ancho: o.ancho } : {});
  const [, , ancho] = String(r.geometria).split(", ").map(Number);
  const x = o.x ?? Math.round((W - ancho) / 2), y = o.y ?? Math.round(AREA.y + 10);
  const g = await jxa<{ x: number; y: number; ancho: number; alto: number }>(`
const i = diapositiva(doc(p.id), p.n).images; const o = i[i().length - 1];
o.position = { x: p.x, y: p.y };
return { x: p.x, y: p.y, ancho: o.width(), alto: o.height() };`, { id: d.id, n, x, y });
  return { documento: d.nombre, diapositiva: n, archivo: pdf, ...g };
}

// ---------- figuras ----------
export type TipoForma = "rectangulo" | "rectangulo_redondeado" | "elipse" | "triangulo" | "triangulo_rectangulo" | "rombo" | "poligono" | "estrella" | "bocadillo" | "linea" | "flecha" | "flecha_doble";
export interface Forma {
  tipo: TipoForma;
  x?: number; y?: number; ancho?: number; alto?: number;          // figuras cerradas
  x1?: number; y1?: number; x2?: number; y2?: number;             // líneas y flechas
  relleno?: string; borde?: string; grosor?: number; opacidad?: number; punteado?: boolean; radio?: number;
  lados?: number;    // polígono (≥ 3) o puntas de la estrella (≥ 3)
  cola?: "abajo" | "arriba" | "izquierda" | "derecha";  // bocadillo
  texto?: string; estilo_texto?: EstiloTexto;
}

/** Vértices de un polígono regular de `n` lados (o estrella si `interior` < 1), centrado, radio 1, con un vértice arriba. */
function regular(n: number, interior: number) {
  if (!(Number.isInteger(n) && n >= 3 && n <= 64)) throw new Error("lados debe ser un entero entre 3 y 64");
  const estrella = interior < 1;
  return Array.from({ length: n }, (_, i) => {
    const r = estrella && i % 2 ? interior : 1, a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

/** Rectángulo redondeado con una cola que sale del centro del lado indicado (la cola ocupa el 25 % del alto o ancho). */
function bocadillo(pad: number, w: number, h: number, r: number, cola: string) {
  const ct = Math.min(w, h) * 0.25, cw = Math.min(w, h) * 0.18;
  // Caja: deja sitio a la cola dentro del área.
  const x0 = pad + (cola === "izquierda" ? ct : 0), y0 = pad + (cola === "arriba" ? ct : 0);
  const x1 = pad + w - (cola === "derecha" ? ct : 0), y1 = pad + h - (cola === "abajo" ? ct : 0);
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const p = [`M${x0 + r},${y0}`];
  if (cola === "arriba") p.push(`L${mx - cw / 2},${y0} L${mx},${pad} L${mx + cw / 2},${y0}`);
  p.push(`L${x1 - r},${y0} Q${x1},${y0} ${x1},${y0 + r}`);
  if (cola === "derecha") p.push(`L${x1},${my - cw / 2} L${pad + w},${my} L${x1},${my + cw / 2}`);
  p.push(`L${x1},${y1 - r} Q${x1},${y1} ${x1 - r},${y1}`);
  if (cola === "abajo") p.push(`L${mx + cw / 2},${y1} L${mx - cw * 0.9},${pad + h} L${mx - cw / 2},${y1}`);
  p.push(`L${x0 + r},${y1} Q${x0},${y1} ${x0},${y1 - r}`);
  if (cola === "izquierda") p.push(`L${x0},${my + cw / 2} L${pad},${my} L${x0},${my - cw / 2}`);
  p.push(`L${x0},${y0 + r} Q${x0},${y0} ${x0 + r},${y0} Z`);
  return p.join(" ");
}

function svgForma(f: Forma) {
  const g = f.grosor ?? (f.tipo.startsWith("linea") || f.tipo.startsWith("flecha") ? 3 : 1);
  const relleno = f.relleno === "ninguno" ? "none" : `#${color(f.relleno ?? "tarjeta")}`;
  const borde = f.borde === "ninguno" ? "none" : `#${color(f.borde ?? (f.tipo.startsWith("linea") || f.tipo.startsWith("flecha") ? "acento" : "borde"))}`;
  const op = f.opacidad === undefined ? 1 : Math.max(0, Math.min(100, f.opacidad)) / 100;
  const raya = f.punteado ? ` stroke-dasharray="${g * 3} ${g * 2}"` : "";
  if (f.tipo === "linea" || f.tipo === "flecha" || f.tipo === "flecha_doble") {
    const [x1, y1, x2, y2] = [f.x1, f.y1, f.x2, f.y2].map((v, i) => num(v as number, ["x1", "y1", "x2", "y2"][i]));
    const punta = f.tipo === "linea" ? 0 : g * 4;
    const pad = Math.max(g, punta) + 2;
    const ox = Math.min(x1, x2) - pad, oy = Math.min(y1, y2) - pad;
    const w = Math.abs(x2 - x1) + 2 * pad, h = Math.abs(y2 - y1) + 2 * pad;
    // La línea se acorta bajo cada punta para que no asome.
    const largo = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / largo, uy = (y2 - y1) / largo;
    const fin = f.tipo === "linea" ? 0 : punta * 0.8, ini = f.tipo === "flecha_doble" ? punta * 0.8 : 0;
    const marcador = `<marker id="p" markerUnits="userSpaceOnUse" markerWidth="${punta}" markerHeight="${punta}" refX="${punta * 0.8}" refY="${punta / 2}" orient="auto-start-reverse"><path d="M0,0 L${punta},${punta / 2} L0,${punta} z" fill="${borde}"/></marker>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      (punta ? `<defs>${marcador}</defs>` : "") +
      `<line x1="${x1 - ox + ux * ini}" y1="${y1 - oy + uy * ini}" x2="${x2 - ox - ux * fin}" y2="${y2 - oy - uy * fin}" stroke="${borde}" stroke-width="${g}" stroke-opacity="${op}"${raya}` +
      `${punta ? ` marker-end="url(#p)"` : ""}${f.tipo === "flecha_doble" ? ` marker-start="url(#p)"` : ""}/></svg>`;
    return { svg, x: ox, y: oy, ancho: w, alto: h };
  }
  const [x, y, w, h] = [f.x, f.y, f.ancho, f.alto].map((v, i) => num(v as number, ["x", "y", "ancho", "alto"][i]));
  const pad = g / 2 + 1, W2 = w + 2 * pad, H2 = h + 2 * pad;
  const comun = `fill="${relleno}" fill-opacity="${op}" stroke="${borde}" stroke-width="${g}"${raya}`;
  const cuerpo = {
    rectangulo: `<rect x="${pad}" y="${pad}" width="${w}" height="${h}" ${comun}/>`,
    rectangulo_redondeado: `<rect x="${pad}" y="${pad}" width="${w}" height="${h}" rx="${f.radio ?? 8}" ${comun}/>`,
    elipse: `<ellipse cx="${pad + w / 2}" cy="${pad + h / 2}" rx="${w / 2}" ry="${h / 2}" ${comun}/>`,
    triangulo: `<polygon points="${pad + w / 2},${pad} ${pad + w},${pad + h} ${pad},${pad + h}" ${comun}/>`,
    triangulo_rectangulo: `<polygon points="${pad},${pad} ${pad + w},${pad + h} ${pad},${pad + h}" ${comun}/>`,
    rombo: `<polygon points="${pad + w / 2},${pad} ${pad + w},${pad + h / 2} ${pad + w / 2},${pad + h} ${pad},${pad + h / 2}" ${comun}/>`,
    poligono: `<polygon points="${regular(f.lados ?? 6, 1).map(([a, b]) => `${pad + w / 2 + a * w / 2},${pad + h / 2 + b * h / 2}`).join(" ")}" ${comun}/>`,
    estrella: `<polygon points="${regular((f.lados ?? 5) * 2, 0.45).map(([a, b]) => `${pad + w / 2 + a * w / 2},${pad + h / 2 + b * h / 2}`).join(" ")}" ${comun}/>`,
    bocadillo: `<path d="${bocadillo(pad, w, h, f.radio ?? 10, f.cola ?? "abajo")}" ${comun}/>`,
  }[f.tipo];
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W2}" height="${H2}" viewBox="0 0 ${W2} ${H2}">${cuerpo}</svg>`, x: x - pad, y: y - pad, ancho: W2, alto: H2 };
}

/** Figura vectorial con la paleta del formato, opcionalmente con texto centrado encima. */
export async function forma(ref: string, n: number, f: Forma) {
  const d = await editable(ref);
  const tipos: TipoForma[] = ["rectangulo", "rectangulo_redondeado", "elipse", "triangulo", "triangulo_rectangulo", "rombo", "poligono", "estrella", "bocadillo", "linea", "flecha", "flecha_doble"];
  if (!tipos.includes(f.tipo)) throw new Error(`Tipo de figura desconocido "${f.tipo}". Tipos: ${tipos.join(", ")}`);
  const s = svgForma(f);
  const dir = join(DIR, "formas");
  await mkdir(dir, { recursive: true });
  const archivo = join(dir, `forma_${huella(s.svg)}.svg`);
  await writeFile(archivo, s.svg);
  await insertarMedio(d.id, n, archivo, { x: Math.round(s.x), y: Math.round(s.y), ancho: Math.round(s.ancho) });
  let texto = null;
  if (f.texto && !f.tipo.startsWith("linea") && !f.tipo.startsWith("flecha")) {
    const est = { tamano: 16, color: "titulo", ...f.estilo_texto };
    const lineas = f.texto.split("\n"), alto = (est.tamano ?? 16) * 1.25;
    const ct = f.tipo === "bocadillo" ? Math.min(f.ancho as number, f.alto as number) * 0.25 : 0, cola = f.cola ?? "abajo";
    const cx = (f.x as number) + (f.ancho as number) / 2 + (cola === "izquierda" ? ct / 2 : cola === "derecha" ? -ct / 2 : 0) * (ct ? 1 : 0);
    const cy = (f.y as number) + (f.alto as number) / 2 + (cola === "arriba" ? ct / 2 : cola === "abajo" ? -ct / 2 : 0) * (ct ? 1 : 0);
    texto = await textos(d.id, n, lineas.map((l, i) => ({ texto: l, x: cx, y: Math.round(cy - (lineas.length * alto) / 2 + i * alto - 2), centro_x: true, estilo: est })));
  }
  return { documento: d.nombre, diapositiva: n, tipo: f.tipo, archivo, caja_pt: { x: Math.round(s.x), y: Math.round(s.y), ancho: Math.round(s.ancho), alto: Math.round(s.alto) }, texto };
}

// ---------- componentes del formato ----------
interface CajaArea { x?: number; y?: number; ancho?: number; alto?: number }

/** Cifras destacadas: tarjeta con borde; cifra en la tipografía de títulos a 30 pt; etiqueta a 11 pt. */
export async function cifrasDestacadas(ref: string, n: number, cifras: { valor: string; etiqueta: string; color?: string }[], caja: CajaArea = {}) {
  if (!(cifras.length >= 1 && cifras.length <= 4)) throw new Error("Entre 1 y 4 cifras por fila");
  const d = await editable(ref);
  const c = { x: caja.x ?? AREA.x, y: caja.y ?? AREA.y, ancho: caja.ancho ?? AREA.ancho, alto: caja.alto ?? 1.55 * PT };
  const sep = 0.25 * PT, w = (c.ancho - sep * (cifras.length - 1)) / cifras.length;
  for (const [i, k] of cifras.entries()) {
    const x = c.x + i * (w + sep);
    await forma(d.id, n, { tipo: "rectangulo_redondeado", x, y: c.y, ancho: w, alto: c.alto, relleno: "tarjeta", borde: "borde", grosor: 1, radio: 6 });
    const cx = x + w / 2;
    await textos(d.id, n, [
      { texto: k.valor, x: cx, y: c.y + c.alto * 0.18, centro_x: true, estilo: { fuente: "titulo", negrita: true, tamano: 30, color: k.color ?? "titulo" } },
      ...k.etiqueta.split("\n").map((l, j) => ({ texto: l, x: cx, y: c.y + c.alto * 0.62 + j * 14, centro_x: true, estilo: { tamano: 11, color: "apagado" } })),
    ]);
  }
  return { documento: d.nombre, diapositiva: n, cifras: cifras.length, caja_pt: c };
}

/** Tarjetas numeradas: 2–4 tarjetas separadas 0.3 in; encabezado en la tipografía de títulos y el color de acento. */
export async function tarjetasNumeradas(ref: string, n: number, tarjetas: { encabezado: string; texto: string }[], caja: CajaArea = {}) {
  if (!(tarjetas.length >= 2 && tarjetas.length <= 4)) throw new Error("Entre 2 y 4 tarjetas");
  const d = await editable(ref);
  const c = { x: caja.x ?? AREA.x, y: caja.y ?? AREA.y + 0.15 * PT, ancho: caja.ancho ?? AREA.ancho, alto: caja.alto ?? 2.3 * PT };
  const sep = 0.3 * PT, w = (c.ancho - sep * (tarjetas.length - 1)) / tarjetas.length;
  const tamTexto = tarjetas.length >= 4 ? 15 : 17;
  for (const [i, t] of tarjetas.entries()) {
    const x = c.x + i * (w + sep);
    await forma(d.id, n, { tipo: "rectangulo_redondeado", x, y: c.y, ancho: w, alto: c.alto, relleno: "tarjeta", borde: "borde", grosor: 1, radio: 8 });
    await textos(d.id, n, [
      { texto: t.encabezado, x: x + 16, y: c.y + 14, estilo: { fuente: "titulo", tamano: 24, color: "acento" } },
      { texto: t.texto, x: x + 16, y: c.y + 56, ancho: w - 32, estilo: { tamano: tamTexto, color: "texto" } },
    ]);
  }
  return { documento: d.nombre, diapositiva: n, tarjetas: tarjetas.length, caja_pt: c };
}

/** Agenda de build_deck_panorama.js: dos columnas, filas alternadas 1C1730 / 2A2247. */
export async function agenda(ref: string, n: number, puntos: { numero?: string; titulo: string; descripcion?: string }[]) {
  if (!(puntos.length >= 1 && puntos.length <= 8)) throw new Error("Entre 1 y 8 puntos");
  const d = await editable(ref);
  const colW = 5.85 * PT, h = 1.08 * PT;
  for (const [i, p] of puntos.entries()) {
    const fila = Math.floor(i / 2), col = i % 2;
    const x = 0.6 * PT + col * (colW + 0.35 * PT), y = 1.85 * PT + fila * 1.28 * PT;
    await forma(d.id, n, { tipo: "rectangulo_redondeado", x, y, ancho: colW, alto: h, relleno: fila % 2 ? "tarjeta2" : "tarjeta", borde: "ninguno", radio: 6 });
    await textos(d.id, n, [
      { texto: p.numero ?? String(i + 1).padStart(2, "0"), x: x + 12, y: y + h / 2 - 20, estilo: { fuente: "titulo", negrita: true, tamano: 26, color: "acento" } },
      { texto: p.titulo, x: x + 1.05 * PT, y: y + (p.descripcion ? 10 : h / 2 - 12), ancho: colW - 1.2 * PT, estilo: { negrita: true, tamano: 15, color: "titulo" } },
      ...(p.descripcion ? [{ texto: p.descripcion, x: x + 1.05 * PT, y: y + 0.58 * PT, ancho: colW - 1.2 * PT, estilo: { tamano: 11.5, color: "apagado" } }] : []),
    ]);
  }
  return { documento: d.nombre, diapositiva: n, puntos: puntos.length };
}

async function dimensionesVideo(ruta: string) {
  const { stdout } = await ejecutar("mdls", ["-name", "kMDItemPixelWidth", "-name", "kMDItemPixelHeight", ruta]);
  const w = Number(stdout.match(/kMDItemPixelWidth\s*=\s*(\d+)/)?.[1]), h = Number(stdout.match(/kMDItemPixelHeight\s*=\s*(\d+)/)?.[1]);
  return w && h ? w / h : 16 / 9;
}

/**
 * Diapositiva de video: antetítulo ("ANIMACIÓN" por omisión), video sobre tarjeta blanca a la
 * izquierda con su pie de origen, y a la derecha un encabezado ("QUÉ OBSERVAR") con 2–3 viñetas.
 */
export async function diapositivaVideo(ref: string, video: string, campos: Campos & { observar: string[]; repetir?: boolean; encabezado?: string }, despuesDe?: number) {
  const ruta = resolve(video.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
  if (!existsSync(ruta)) throw new Error(`No existe el video ${ruta}`);
  if (TEMA.origen_obligatorio && !campos.origen?.trim()) throw new Error("El video necesita su pie de origen (el tema lo exige)");
  if (!campos.observar.length) throw new Error("Hace falta al menos un punto en «qué observar»");
  const r = await agregarConFormato(ref, "tabla", { ...campos, antetitulo: campos.antetitulo ?? "Animación" }, despuesDe);
  const caja = { x: 0.6 * PT, y: 1.75 * PT, ancho: 8.53 * PT, alto: 4.8 * PT };
  const aspecto = await dimensionesVideo(ruta);
  const w = Math.min(caja.ancho, caja.alto * aspecto), h = w / aspecto;
  const x = caja.x + (caja.ancho - w) / 2, y = caja.y, borde = 0.08 * PT;
  await forma(r.id, r.diapositiva, { tipo: "rectangulo_redondeado", x: x - borde, y: y - borde, ancho: w + 2 * borde, alto: h + 2 * borde, relleno: "blanco", borde: "borde_figura", grosor: 1, radio: 5 });
  await insertarMedio(r.id, r.diapositiva, ruta, { x: Math.round(x), y: Math.round(y), ancho: Math.round(w), repetir: campos.repetir === false ? "none" : "loop", volumen: 0 });
  const col = 9.7 * PT;
  await textos(r.id, r.diapositiva, [
    ...(campos.origen?.trim() ? [{ texto: campos.origen, x: x + w / 2, y: y + h + 0.06 * PT + 2, centro_x: true, estilo: { cursiva: true, tamano: 11, color: "apagado" } }] : []),
    { texto: campos.encabezado ?? "QUÉ OBSERVAR", x: col, y: y + 4, estilo: { negrita: true, tamano: 13, color: "acento" } },
    { texto: campos.observar.map((t) => `▪ ${t}`).join("\n"), x: col, y: y + 34, ancho: 3.15 * PT, estilo: { tamano: 15, color: "texto" } },
  ]);
  return { ...r, video: ruta };
}
