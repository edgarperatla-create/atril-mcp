// revisar_presentacion — exporta las diapositivas visibles y busca problemas comunes.
//
// Lo que se mide y cómo:
// - Fuera de la diapositiva: posición y tamaño contra los bordes. Un cuadro de texto libre
//   crece con su texto (uno de 25 líneas llegó a 1107 pt de alto), así que esto también
//   detecta texto que se sale.
// - Pisa el pie: en diapositivas con pie, objetos que bajan de y = 7.0 in.
// - Cuerpo encogido: Keynote encoge el texto del cuerpo para que quepa pero sigue reportando
//   el tamaño nominal (25 viñetas a "15 pt" se ven de ~7 pt). Se estima la altura que pide el
//   texto y de ahí el tamaño efectivo. Es una estimación (ancho_caracter del tema, ~0.5 em por carácter).
// - Contraste: color del texto contra el fondo, ambos muestreados en la imagen exportada
//   (fondo: anillo alrededor del cuadro; texto: sus píxeles más alejados del fondo). WCAG:
//   4.5:1, o 3:1 para texto ≥ 18 pt.
// - Figura sin pie de origen (si el tema lo exige; no aplica a las figuras y ecuaciones que dibuja
//   Atril), textos de muestra sobrantes, letra < 10 pt y diapositivas sin notas.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { TEMA } from "./tema.ts";
import { documento } from "./herramientas.ts";
import { applescript, jxa } from "./keynote.ts";
import { VISTAS } from "./trabajo.ts";

const ejecutar = promisify(execFile);
const FFMPEG = "/opt/homebrew/bin/ffmpeg";
const MUESTRAS = ["ANTETÍTULO", "ANTETÍTULO DE PORTADA", "Título", "Título de la presentación", "Título de sección",
  "Subtítulo", "Subtítulo de sección", "Viñeta", "Sección", "Autor · Institución", "Autor  ·  Institución  ·  Año"];
const CON_PIE = ["Contenido", "Figura", "Tabla"];

type Gravedad = "alta" | "media" | "baja";
export interface Problema { diapositiva: number; gravedad: Gravedad; tipo: string; detalle: string }

interface Obj { tipo: string; indice: number; x: number; y: number; ancho: number; alto: number; texto?: string; tam?: number; color?: number[]; archivo?: string | null }
interface Diap { n: number; saltada: boolean; diseno: string | null; notas: string; objetos: Obj[];
  cuerpo: { x: number; y: number; ancho: number; alto: number; parrafos: string[]; tam: number } | null }

/** Píxeles RGB de un PNG, vía `sips` → BMP de 32 bits (viene con macOS; sin dependencias). */
async function pixeles(png: string, tmp: string) {
  const bmp = join(tmp, "p.bmp");
  await ejecutar("sips", ["-s", "format", "bmp", png, "--out", bmp]);
  const b = await readFile(bmp);
  const off = b.readUInt32LE(10), w = b.readInt32LE(18), hRaw = b.readInt32LE(22), bpp = b.readUInt16LE(28);
  if (bpp !== 32) throw new Error(`BMP de ${bpp} bits no soportado`);
  const h = Math.abs(hRaw), arribaAbajo = hRaw < 0;
  const masc = [b.readUInt32LE(54), b.readUInt32LE(58), b.readUInt32LE(62)];
  const corrimiento = masc.map((m) => Math.log2(m & -m));
  const at = (x: number, y: number) => {
    const fila = arribaAbajo ? y : h - 1 - y;
    const v = b.readUInt32LE(off + (fila * w + x) * 4);
    return masc.map((m, i) => (v & m) >>> corrimiento[i]);
  };
  return { w, h, at };
}

const lineal = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminancia = (rgb: number[]) => 0.2126 * lineal(rgb[0]) + 0.7152 * lineal(rgb[1]) + 0.0722 * lineal(rgb[2]);
const contraste = (a: number[], b: number[]) => { const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** Altura que pide un cuerpo con viñetas a su tamaño nominal (estimación con el ancho de carácter del tema). */
function alturaNecesaria(parrafos: string[], tam: number, ancho: number) {
  const util = ancho - 25; // sangría de la viñeta y márgenes
  const lineas = parrafos.map((p) => Math.max(1, Math.ceil((p.length * (TEMA.ancho_caracter ?? 0.5) * tam) / util)));
  return lineas.reduce((s, l) => s + l * tam * 1.2, 0) + Math.max(0, parrafos.length - 1) * 10;
}

export async function revisarPresentacion(ref: string) {
  const d = await documento(ref);
  const datos = await jxa<Diap[]>(`
const d = doc(p.id);
const W = d.width(), H = d.height();
const clases = [["texto", "textItems", true], ["figura", "shapes", true], ["imagen", "images", false], ["video", "movies", false],
  ["tabla", "tables", false], ["grafica", "charts", false], ["linea", "lines", false], ["grupo", "groups", false]];
return d.slides().map((s, i) => {
  const r = { n: i + 1, saltada: s.skipped(), diseno: intento(() => s.baseLayout.name()), notas: intento(() => s.presenterNotes(), ""), objetos: [], cuerpo: null };
  if (r.saltada) return r;
  for (const [tipo, col, conTexto] of clases) {
    const c = s[col]; const m = intento(() => c().length, 0);
    for (let j = 0; j < m; j++) {
      const o = c[j];
      const q = intento(() => o.position(), { x: 0, y: 0 });
      const x = { tipo, indice: j + 1, x: q.x, y: q.y, ancho: intento(() => o.width(), 0), alto: intento(() => o.height(), 0) };
      if (conTexto) { x.texto = intento(() => o.objectText(), ""); x.tam = intento(() => o.objectText.size(), null); x.color = intento(() => o.objectText.color(), null); }
      if (tipo === "imagen" || tipo === "video") x.archivo = intento(() => o.fileName(), null);
      r.objetos.push(x);
    }
  }
  if (intento(() => s.bodyShowing(), false)) {
    const b = s.defaultBodyItem; const q = b.position();
    r.cuerpo = { x: q.x, y: q.y, ancho: b.width(), alto: b.height(), parrafos: intento(() => b.objectText().split("\\n"), []), tam: intento(() => b.objectText.size(), 15) };
  }
  return r;
});`, { id: d.id });

  // Exportar las visibles una vez; la k-ésima imagen es la k-ésima diapositiva visible.
  await mkdir(VISTAS, { recursive: true });
  const tmp = join(VISTAS, `revision_${d.id}_${Date.now()}`);
  await applescript(`export document id (item 1 of argv) to my archivo(item 2 of argv) as slide images with properties {image format:PNG}`, [d.id, tmp]);
  const pngs = (await readdir(tmp)).filter((f) => f.endsWith(".png")).sort().map((f) => join(tmp, f));
  const visibles = datos.filter((s) => !s.saltada);
  if (pngs.length !== visibles.length) throw new Error(`Se esperaban ${visibles.length} imágenes y Keynote exportó ${pngs.length}`);

  const W = d.ancho, H = d.alto, PIE = 7.0 * 72 * (W / 960);
  const problemas: Problema[] = [];
  const agregar = (n: number, gravedad: Gravedad, tipo: string, detalle: string) => problemas.push({ diapositiva: n, gravedad, tipo, detalle });
  const nombre = (o: Obj) => `${o.tipo} ${o.indice}${o.texto ? ` («${o.texto.replace(/\s+/g, " ").slice(0, 40)}»)` : ""}`;

  for (const [k, s] of visibles.entries()) {
    const img = await pixeles(pngs[k], tmp);
    const escala = img.w / W;
    // Objetos reales: los marcadores ocultos aparecen con tamaño 0 o sin texto.
    const objs = s.objetos.filter((o) => o.ancho > 0 && o.alto > 0 && !(["texto", "figura"].includes(o.tipo) && !o.texto?.trim() && o.tipo === "texto"));
    const esPie = (o: Obj) => o.tipo === "texto" && o.y >= PIE - 10;

    for (const o of objs) {
      if (o.x < -1 || o.y < -1 || o.x + o.ancho > W + 1 || o.y + o.alto > H + 1) {
        agregar(s.n, "alta", "fuera de la diapositiva", `${nombre(o)} ocupa x ${o.x}–${o.x + o.ancho}, y ${o.y}–${o.y + o.alto} (la diapositiva mide ${W}×${H})`);
      } else if (CON_PIE.includes(s.diseno ?? "") && !esPie(o) && o.y + o.alto > PIE) {
        agregar(s.n, "media", "pisa el pie", `${nombre(o)} baja hasta y = ${o.y + o.alto} (el pie empieza en ${Math.round(PIE)})`);
      }
      if (o.texto?.trim() && MUESTRAS.includes(o.texto.trim())) agregar(s.n, "alta", "texto de muestra", `quedó el texto de muestra «${o.texto.trim()}»`);
      if (o.texto?.trim() && o.tam && o.tam < 10 && !esPie(o)) agregar(s.n, "baja", "letra pequeña", `${nombre(o)} está a ${o.tam} pt`);
      // Contraste contra el fondo muestreado en un anillo alrededor del cuadro.
      // "￼" (U+FFFC) es un campo, como el número de página: no es texto que revisar.
      if (o.texto?.replace(/\uFFFC/g, "").trim() && o.color && o.color.length === 3) {
        const anillo: number[][] = [];
        const x0 = Math.max(0, Math.floor((o.x - 4) * escala)), x1 = Math.min(img.w - 1, Math.ceil((o.x + o.ancho + 4) * escala));
        const y0 = Math.max(0, Math.floor((o.y - 4) * escala)), y1 = Math.min(img.h - 1, Math.ceil((o.y + o.alto + 4) * escala));
        for (let x = x0; x <= x1; x += 3) { anillo.push(img.at(x, y0), img.at(x, y1)); }
        for (let y = y0; y <= y1; y += 3) { anillo.push(img.at(x0, y), img.at(x1, y)); }
        const fondo = [0, 1, 2].map((c) => anillo.map((p) => p[c]).sort((a, b) => a - b)[Math.floor(anillo.length / 2)] / 255);
        // Color del texto: también de la imagen (los píxeles del cuadro más alejados del fondo).
        // El que devuelve Keynote viene en otro espacio de color (un lavanda claro vuelve como 0.80
        // en vez de 0.84) y subestima el contraste.
        const dentro: number[][] = [];
        for (let x = x0 + 4; x < x1 - 4; x += 2) for (let y = y0 + 4; y < y1 - 4; y += 2) dentro.push(img.at(x, y).map((v) => v / 255));
        const dist = (p: number[]) => Math.hypot(p[0] - fondo[0], p[1] - fondo[1], p[2] - fondo[2]);
        // El núcleo de los trazos: a ≥ 80 % de la distancia máxima (los bordes están suavizados,
        // y en un cuadro grande con poco texto un porcentaje fijo se llena de borde).
        const maxima = dentro.reduce((m, p) => Math.max(m, dist(p)), 0);
        const lejanos = dentro.filter((p) => dist(p) >= 0.8 * maxima);
        const tinta = lejanos.length && maxima > 0.02
          ? [0, 1, 2].map((c) => lejanos.map((p) => p[c]).sort((a, b) => a - b)[Math.floor(lejanos.length / 2)])
          : o.color;
        const ratio = contraste(tinta, fondo);
        const minimo = (o.tam ?? 0) >= 18 ? 3 : 4.5;
        // Margen de 0.3: medir sobre píxeles suavizados subestima unas décimas en letra chica
        // (un gris apagado sobre una tarjeta puede medir 4.5 con contraste real de ~4.6).
        if (ratio < minimo - 0.3) agregar(s.n, ratio < 2 ? "alta" : "media", "contraste bajo", `${nombre(o)}: contraste ${ratio.toFixed(1)}:1 (mínimo ${minimo}:1)`);
      }
    }
    // Figura o video sin pie de origen justo debajo.
    // Las figuras, ecuaciones y gráficas que dibuja Atril (forma_*.svg, ec_*.pdf, graf_*.pdf) no son figuras con origen.
    const generada = (o: Obj) => /^(forma_|ec_|graf_)/.test(o.archivo ?? "");
    for (const f of objs.filter((o) => TEMA.origen_obligatorio && (o.tipo === "imagen" || o.tipo === "video") && !generada(o))) {
      const abajo = f.y + f.alto;
      const pie = objs.some((t) => t.tipo === "texto" && t.texto?.trim() && t.y >= abajo - 4 && t.y <= abajo + 36 && t.x < f.x + f.ancho && t.x + t.ancho > f.x);
      if (!pie) agregar(s.n, "alta", "figura sin pie de origen", `${nombre(f)} no tiene pie de origen debajo ("Elaboración propia", "Datos: …")`);
    }
    if (s.cuerpo && s.cuerpo.parrafos.join("").trim()) {
      const necesaria = alturaNecesaria(s.cuerpo.parrafos, s.cuerpo.tam, s.cuerpo.ancho);
      if (necesaria > s.cuerpo.alto) {
        const efectivo = s.cuerpo.tam * (s.cuerpo.alto / necesaria);
        agregar(s.n, efectivo < 12 ? "media" : "baja", "cuerpo encogido",
          `el cuerpo pide ~${Math.round(necesaria)} pt de alto y tiene ${s.cuerpo.alto}; Keynote lo encoge a ~${efectivo.toFixed(1)} pt (estimado). Divide en dos diapositivas o recorta`);
      }
    }
    if (!s.notas.trim()) agregar(s.n, "baja", "sin notas", "no tiene notas del presentador");
  }

  // Hoja de contacto con todas las visibles (si hay ffmpeg).
  let hoja: string | null = null;
  if (existsSync(FFMPEG)) {
    const columnas = Math.min(4, pngs.length), filas = Math.ceil(pngs.length / columnas);
    hoja = join(VISTAS, `${d.nombre.replace(/\.(key|pptx?)$/i, "").replace(/[^\p{L}\p{N}_-]+/gu, "_")}_revision.png`);
    await ejecutar(FFMPEG, ["-loglevel", "error", "-y", "-pattern_type", "glob", "-i", join(tmp, "*.png"),
      "-vf", `scale=400:-1,tile=${columnas}x${filas}:padding=4:color=gray`, "-frames:v", "1", hoja]);
  }
  await rm(tmp, { recursive: true, force: true });
  const orden: Record<Gravedad, number> = { alta: 0, media: 1, baja: 2 };
  problemas.sort((a, b) => orden[a.gravedad] - orden[b.gravedad] || a.diapositiva - b.diapositiva);
  const cuenta = (g: Gravedad) => problemas.filter((p) => p.gravedad === g).length;
  return {
    documento: d.nombre, diapositivas_revisadas: visibles.length,
    resumen: { alta: cuenta("alta"), media: cuenta("media"), baja: cuenta("baja") },
    problemas, hoja,
  };
}
