// Gráficas científicas: barras de error, escalas logarítmicas, ejes a la medida,
// bandas, cotas superiores, histogramas, segundo eje y. Las nativas de Keynote (`grafica`)
// no tienen nada de eso. Se dibujan con matplotlib (src/grafica_cientifica.py) en la paleta
// del tema y se insertan como PDF vectorial, como las ecuaciones.
//
// Dos destinos:
// - Sin `diapositiva`: una diapositiva_figura nueva (tarjeta blanca, tinta oscura).
// - Con `diapositiva`: sobre una diapositiva que ya existe (fondo transparente, con los colores
//   de texto del tema), por omisión en el área de contenido.
// La figura se genera al tamaño exacto con que se inserta: `tamano_texto` son puntos reales.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PALETA, SERIES, TEMA, color } from "./tema.ts";
import { agregarFigura, type Campos } from "./formato.ts";
import { editable } from "./herramientas.ts";
import { DIR } from "./trabajo.ts";
import { insertarMedio } from "./visuales.ts";

const PT = 72;
const AREA = { x: 0.6 * PT, y: 1.85 * PT, ancho: 12.1 * PT, alto: 4.6 * PT };
const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "grafica_cientifica.py");

export type TipoSerie = "linea" | "puntos" | "linea_puntos" | "barras" | "area" | "escalon" | "banda" | "histograma";
type Error = number[] | { inf: number[]; sup: number[] };
export interface Serie {
  nombre?: string; tipo?: TipoSerie; color?: string;
  x?: number[]; y?: number[]; error_y?: Error; error_x?: Error; limite_superior?: boolean[];
  y_inf?: number[]; y_sup?: number[];             // banda
  valores?: number[]; bins?: number | number[];   // histograma
  relleno?: boolean;
  estilo_linea?: "continua" | "discontinua" | "punteada" | "raya_punto";
  marcador?: "circulo" | "cuadrado" | "triangulo" | "rombo" | "estrella" | "cruz" | "mas" | "ninguno";
  tamano_marcador?: number; grosor?: number; opacidad?: number; ancho_barra?: number;
  eje?: "izquierdo" | "derecho";
}
export interface Eje {
  titulo?: string; escala?: "lineal" | "log" | "symlog"; umbral_lineal?: number;
  min?: number; max?: number; invertir?: boolean; marcas?: number[]; etiquetas_marcas?: string[];
}
export interface EspecGrafica {
  series: Serie[];
  eje_x?: Eje; eje_y?: Eje; eje_y2?: Eje;
  lineas_ref?: { eje: "x" | "y"; valor: number; etiqueta?: string; color?: string; estilo_linea?: Serie["estilo_linea"] }[];
  anotaciones?: { x: number; y: number; texto: string; dx?: number; dy?: number; flecha?: boolean; color?: string; tamano?: number }[];
  leyenda?: "auto" | "ninguna" | "arriba_derecha" | "arriba_izquierda" | "abajo_derecha" | "abajo_izquierda";
  rejilla?: boolean;
  tamano_texto?: number;
}

function python() {
  for (const r of [process.env.ATRIL_PYTHON, `${process.env.HOME}/miniconda3/bin/python3`, "/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"])
    if (r && existsSync(r)) return r;
  throw new Error("No encontré python3 con matplotlib (define ATRIL_PYTHON)");
}

const finitos = (v: unknown, nombre: string) => {
  if (!Array.isArray(v) || !v.length || !v.every((x) => typeof x === "number" && Number.isFinite(x))) throw new Error(`${nombre} debe ser una lista de números`);
  return v as number[];
};

/** Valida la especificación (los colores pasan por la paleta y los arreglos deben cuadrar). */
function validar(e: EspecGrafica) {
  if (!e.series?.length) throw new Error("La gráfica necesita al menos una serie");
  e.series.forEach((s, i) => {
    const q = `serie ${i + 1}${s.nombre ? ` (${s.nombre})` : ""}`;
    if (s.color) color(s.color);
    if (s.tipo === "histograma") {
      finitos(s.valores, `${q}: valores`);
      if (Array.isArray(s.bins)) finitos(s.bins, `${q}: bins`);
      return;
    }
    const x = finitos(s.x, `${q}: x`);
    const largo = (v: unknown, nombre: string) => { if (finitos(v, `${q}: ${nombre}`).length !== x.length) throw new Error(`${q}: ${nombre} debe tener ${x.length} valores, como x`); };
    if (s.tipo === "banda") { largo(s.y_inf, "y_inf"); largo(s.y_sup, "y_sup"); return; }
    largo(s.y, "y");
    for (const k of ["error_y", "error_x"] as const) {
      const v = s[k];
      if (v === undefined) continue;
      if (Array.isArray(v)) largo(v, k);
      else { largo(v.inf, `${k}.inf`); largo(v.sup, `${k}.sup`); }
    }
    if (s.limite_superior && s.limite_superior.length !== x.length) throw new Error(`${q}: limite_superior debe tener ${x.length} valores`);
  });
  for (const [nombre, eje] of [["eje_x", e.eje_x], ["eje_y", e.eje_y], ["eje_y2", e.eje_y2]] as const) {
    if (eje?.marcas) finitos(eje.marcas, `${nombre}.marcas`);
    if (eje?.etiquetas_marcas && eje.etiquetas_marcas.length !== eje.marcas?.length) throw new Error(`${nombre}: etiquetas_marcas debe tener tantas etiquetas como marcas`);
  }
  for (const r of e.lineas_ref ?? []) if (r.color) color(r.color);
  for (const a of e.anotaciones ?? []) if (a.color) color(a.color);
}

// Contraste WCAG entre dos hex: para no usar en la tarjeta blanca una serie que no se ve.
const lum = (hex: string) => {
  const l = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
};
const contraste = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

function coloresEstilo(estilo: "tarjeta" | "diapositiva") {
  const h = (k: string) => `#${PALETA[k]}`;
  if (estilo === "diapositiva") return { fondo: null, tinta: h("texto"), suave: h("apagado"), rejilla: h("tarjeta2"), ciclo: SERIES.map((c) => `#${c}`) };
  const ciclo = SERIES.filter((c) => contraste(c, "FFFFFF") >= 2);
  return { fondo: "#FFFFFF", tinta: h("oscuro"), suave: "#5B6472", rejilla: h("borde_figura"), ciclo: (ciclo.length ? ciclo : [PALETA.oscuro]).map((c) => `#${c}`) };
}

async function dibujar(e: EspecGrafica, estilo: "tarjeta" | "diapositiva", ancho: number, alto: number) {
  validar(e);
  // El script recibe los colores por nombre; un hex suelto entra a la paleta con su propio nombre.
  const paleta: Record<string, string> = Object.fromEntries(Object.entries(PALETA).map(([k, v]) => [k, `#${v}`]));
  const nombre = (c?: string) => {
    if (c === undefined) return undefined;
    const hex = color(c), k = Object.keys(PALETA).find((n) => PALETA[n] === hex) ?? `hex_${hex}`;
    paleta[k] = `#${hex}`;
    return k;
  };
  const espec = {
    ...e, paleta, colores_estilo: coloresEstilo(estilo), fuente: TEMA.fuentes.texto, ancho, alto,
    series: e.series.map((s) => ({ ...s, color: nombre(s.color) })),
    lineas_ref: e.lineas_ref?.map((r) => ({ ...r, color: nombre(r.color) })),
    anotaciones: e.anotaciones?.map((a) => ({ ...a, color: nombre(a.color) })),
  };
  const json = JSON.stringify(espec);
  const dir = join(DIR, "graficas");
  await mkdir(dir, { recursive: true });
  const archivo = join(dir, `graf_${createHash("sha1").update(json).digest("hex").slice(0, 12)}.pdf`);
  await new Promise<void>((ok, mal) => {
    const p = execFile(python(), ["-I", SCRIPT, archivo], { timeout: 60_000, env: { ...process.env, MPLBACKEND: "pdf" } }, (err, _out, stderr) => {
      if (!err) return ok();
      const ultima = String(stderr).trim().split("\n").filter((l) => !/timestamp seems very low/.test(l)).pop();
      mal(new Error(`matplotlib no pudo dibujar la gráfica: ${ultima ?? err.message}`));
    });
    p.stdin?.end(json);
  });
  return archivo;
}

/** Gráfica científica en una diapositiva_figura nueva (tarjeta blanca). */
export async function graficaCientificaFigura(ref: string, e: EspecGrafica, campos: Campos, despuesDe?: number) {
  const caja = campos.cuerpo != null ? { w: 6.55, h: 4.47 } : { w: 12.1, h: 4.6 };
  const archivo = await dibujar(e, "tarjeta", Math.round(caja.w * PT), Math.round(caja.h * PT));
  return { ...(await agregarFigura(ref, archivo, campos, despuesDe)), grafica: archivo };
}

/** Gráfica científica sobre una diapositiva que ya existe (fondo transparente, colores de texto del tema). */
export async function graficaCientificaEn(ref: string, n: number, e: EspecGrafica, c: { x?: number; y?: number; ancho?: number; alto?: number } = {}) {
  const d = await editable(ref);
  const ancho = Math.round(c.ancho ?? AREA.ancho), alto = Math.round(c.alto ?? AREA.alto);
  const archivo = await dibujar(e, "diapositiva", ancho, alto);
  const r = await insertarMedio(d.id, n, archivo, { x: Math.round(c.x ?? AREA.x), y: Math.round(c.y ?? AREA.y), ancho });
  return { documento: d.nombre, diapositiva: n, grafica: archivo, geometria: r.geometria };
}
