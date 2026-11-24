#!/usr/bin/env node
// Atril: servidor MCP para Keynote (stdio).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import * as a from "./animaciones.ts";
import * as ci from "./cientifica.ts";
import * as dib from "./dibujo.ts";
import * as ed from "./edicion.ts";
import * as es from "./estructura.ts";
import * as f from "./formato.ts";
import * as h from "./herramientas.ts";
import * as rv from "./revision.ts";
import * as v from "./visuales.ts";
import { PALETA, TEMA } from "./tema.ts";
import { DIR, asegurarCarpetas } from "./trabajo.ts";

// What any Claude session using Atril reads, from any project: workflow, active theme and rules.
// Details in README.md.
const colores = Object.keys(PALETA).join(", ");
const origen = TEMA.origen_obligatorio
  ? 'the source line is REQUIRED in this theme: "Own work", "Own schematic, illustrative" or "Data: …; own plot" (in the language of the deck)'
  : "the source line is optional (recommended when the figure is not your own)";
const INSTRUCCIONES = `Atril drives Keynote to create, edit, animate, review and export presentations with a consistent theme. Tool names are in Spanish; descriptions are in English.

Active theme: ${TEMA.nombre}${TEMA.descripcion ? ` (${TEMA.descripcion})` : ""}. Titles in ${TEMA.fuentes.titulo}, body text in ${TEMA.fuentes.texto}. Colors by name: ${colores}; 6-digit hex also works.

Workflow for a new themed deck:
1. crear_con_formato (it brings hidden prototype slides at the end: do not delete them).
2. One tool per slide: diapositiva_portada (title), diapositiva_divisor (section number), diapositiva_contenido (short kicker, title, bullets one per line, section footer), diapositiva_figura (image on a white card; ${origen}), diapositiva_tabla followed by tabla, and diapositiva_cierre (closing). Put the script in notas (speaker notes).
3. Charts: grafica (native, editable: bars, lines, pie) or grafica_cientifica (error bars, log scales, bands, upper limits, histograms; on a new figure slide or over an existing one).
4. On a diapositiva_tabla (free area): ecuacion (real LaTeX), forma (palette shapes), cifras_destacadas, tarjetas_numeradas, agenda, grafica or tabla. For video: diapositiva_video.
5. Animations: animar_vinetas in contenido or figura (one bullet per click); revelar_por_pasos, animar_cambio and revelar_series (Magic Move); transicion between slides.
6. To fix things: poner_texto, estilo_texto, buscar_reemplazar, editar_celdas, tabla_estructura, mover_objeto (also rotates), alinear_objetos, distribuir_objetos, bloquear_objeto, borrar_objeto, borrar/mover/ocultar_diapositiva. For a series of figures: diapositivas_desde_imagenes.
7. Look at each slide with ver_diapositiva after creating or changing it, and before finishing run revisar_presentacion and fix the high and medium severity items.
8. exportar (pdf, pptx, png, video, html, keynote09 or gif; pdf with con_notas to share with the script) and guardar. Use presentar only if the user asks (it takes over their screen).

Rules:
- The user's presentations are never modified: abrir makes a copy in ${DIR}. Atril only modifies, saves or closes what lives in that folder.
- Write slide text in the language of the presentation, in measured sentences; no internal jargon on slides.
- Few bullets per slide: if revisar_presentacion reports a shrunken body ("cuerpo encogido"), split the slide.
- Greek letters, subscripts and superscripts (δ₃D, σ_z, M⊙, 10⁴): use ecuacion. Scripted Keynote text has no subscripts, and Unicode has none for D, z or most letters. In scientific charts, use $…$ in titles, axes and legends.
- Never duplicate or move slides between two documents: Keynote crashes (-609).
- Units are points; the theme's slide is 960×540 (13.333×7.5 in at 72 pt/in). Keynote numbers slides by position.
- Keynote scripting limits: the color of each series of a native chart comes from the theme and cannot be chosen; scatter shares one x list; table borders cannot be set; shapes and equations are vector images (not editable Keynote shapes); paragraph alignment cannot be set; the axis rescales in revelar_series.`;

const servidor = new McpServer({ name: "atril", version: "0.1.0" }, { instructions: INSTRUCCIONES });

type Resultado = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: boolean };

async function responder(fn: () => Promise<unknown>): Promise<Resultado> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn(), null, 2) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
  }
}

const documento = z.string().describe("presentation id (from listar_presentaciones_abiertas, abrir or crear) or its exact name");
const numero = z.number().int().min(1).describe("slide number, starting at 1");

servidor.registerTool("listar_presentaciones_abiertas", {
  description: "Lists the presentations open in Keynote: id, name, file, slide count, theme, size, and whether Atril may edit it (editable=false: it belongs to the user, read-only).",
  annotations: { readOnlyHint: true },
}, () => responder(() => h.listarPresentaciones()));

servidor.registerTool("abrir", {
  description: "Opens a presentation (.key, .pptx or .ppt) after first making a COPY in Atril's working folder; the original is never touched. If the path is already in the working folder, opens that copy directly.",
  inputSchema: { ruta: z.string().describe("absolute path (or with ~) of the presentation") },
}, ({ ruta }) => responder(() => h.abrir(ruta)));

servidor.registerTool("crear", {
  description: "Creates a new presentation with a built-in Keynote theme and immediately saves it as .key in Atril's copies folder. If the theme does not exist, the error lists the available ones.",
  inputSchema: {
    tema: z.string().default("Basic White"),
    ancho: z.number().int().positive().default(1920),
    alto: z.number().int().positive().default(1080),
    nombre: z.string().optional().describe("file name, without extension"),
  },
}, ({ tema, ancho, alto, nombre }) => responder(() => h.crear(tema, ancho, alto, nombre)));

servidor.registerTool("leer_presentacion", {
  description: "Reads a presentation: per slide, layout, whether it is skipped, title, body, speaker notes, transition, object counts by type and their texts. With detalle=true returns every object with type, index, text, file and position/size (the indexes are what poner_texto uses).",
  inputSchema: {
    documento,
    desde: numero.optional(),
    hasta: numero.optional(),
    detalle: z.boolean().default(false),
  },
  annotations: { readOnlyHint: true },
}, ({ documento, desde, hasta, detalle }) => responder(() => h.leerPresentacion(documento, desde, hasta, detalle)));

servidor.registerTool("agregar_diapositiva", {
  description: "Adds a slide with a master layout (by name) at the end, or after the given slide (0 = at the start). If the layout does not exist, the error lists the available ones.",
  inputSchema: {
    documento,
    diseno: z.string().optional().describe('master layout name, e.g. "Title & Bullets"'),
    despues_de: z.number().int().min(0).optional(),
  },
}, ({ documento, diseno, despues_de }) => responder(() => h.agregarDiapositiva(documento, diseno, despues_de)));

servidor.registerTool("poner_texto", {
  description: "Writes text on a slide: the layout's title and body, replaces the text of existing objects (type and index from leer_presentacion with detalle) and/or adds a new text box at a position (points). In the body, each line is a bullet.",
  inputSchema: {
    documento,
    diapositiva: numero,
    titulo: z.string().optional(),
    cuerpo: z.string().optional(),
    reemplazar: z.array(z.object({
      tipo: z.enum(["texto", "figura"]).default("texto"),
      indice: z.number().int().min(1),
      texto: z.string(),
    })).optional(),
    nuevo_cuadro: z.object({
      texto: z.string(),
      x: z.number(), y: z.number(),
      ancho: z.number().positive().optional(), alto: z.number().positive().optional(),
    }).optional(),
  },
}, ({ documento, diapositiva, ...cambios }) => responder(() => h.ponerTexto(documento, diapositiva, cambios)));

servidor.registerTool("notas", {
  description: "Reads a slide's speaker notes or, if texto is given, replaces them.",
  inputSchema: { documento, diapositiva: numero, texto: z.string().optional() },
}, ({ documento, diapositiva, texto }) => responder(() => h.notas(documento, diapositiva, texto)));

servidor.registerTool("exportar", {
  description: "Exports the presentation to PDF, PowerPoint, PNG/JPEG images (one per visible slide, in a folder), 1080p video (with transitions), HTML (folder), Keynote '09 or animated GIF (from the video; needs ffmpeg). Goes to Atril's outputs folder by default; never overwrites: if the destination exists, appends _2, _3…",
  inputSchema: {
    documento,
    formato: z.enum(["pdf", "pptx", "png", "jpeg", "video", "html", "keynote09", "gif"]),
    destino: z.string().optional().describe("absolute path of the file (pdf/pptx) or folder (png/jpeg)"),
    etapas: z.boolean().default(false).describe("pdf/png/jpeg: one page or image per animation step"),
    con_notas: z.boolean().default(false).describe("pdf: each page shows the slide with its speaker notes below (to share the script)"),
  },
}, ({ documento, formato, destino, etapas, con_notas }) => responder(() => h.exportar(documento, formato, destino, etapas, con_notas)));

servidor.registerTool("ver_diapositiva", {
  description: "Returns the PNG image of a slide as Keynote renders it, to check the result.",
  inputSchema: { documento, diapositiva: numero, ancho_max: z.number().int().min(320).max(3840).default(1600) },
  annotations: { readOnlyHint: true },
}, async ({ documento, diapositiva, ancho_max }) => {
  try {
    const v = await h.verDiapositiva(documento, diapositiva, ancho_max);
    return { content: [
      { type: "image", data: v.png.toString("base64"), mimeType: "image/png" },
      { type: "text", text: `${v.documento}, slide ${v.diapositiva} → ${v.ruta}` },
    ] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
  }
});

servidor.registerTool("guardar", {
  description: "Saves an Atril presentation as .key in the copies folder (new or PowerPoint-imported ones get a new file). Never saves the user's own presentations.",
  inputSchema: { documento, nombre: z.string().optional().describe("file name, without extension") },
}, ({ documento, nombre }) => responder(() => h.guardar(documento, nombre)));

servidor.registerTool("cerrar", {
  description: "Closes an Atril presentation; does not save by default. Never closes the user's own presentations.",
  inputSchema: { documento, guardar: z.boolean().default(false) },
}, ({ documento, guardar }) => responder(() => h.cerrar(documento, guardar)));

// ---------- theme format (template) ----------
const despues_de = z.number().int().min(0).optional().describe("insert after this slide (0 = at the start); default: at the end");
const notasOrador = z.string().optional().describe("speaker notes (the script)");
const antetitulo = z.string().describe("short kicker line; written in UPPERCASE");
const pie = z.string().optional().describe('section footer, e.g. "04 · Results — Case A"');
const cuerpo = z.string().optional().describe("bullets, one per line (▪ added automatically)");

servidor.registerTool("crear_con_formato", {
  description: "Creates a presentation with the active theme's format (its template: backgrounds, fonts and palette). It brings 6 hidden prototype slides at the end: do not delete them, the diapositiva_* tools use them.",
  inputSchema: { nombre: z.string().optional().describe("file name, without extension") },
}, ({ nombre }) => responder(() => f.crearConFormato(nombre)));

servidor.registerTool("diapositiva_portada", {
  description: "Title slide: kicker in the accent color, large title, italic subtitle and author.",
  inputSchema: { documento, antetitulo, titulo: z.string(), subtitulo: z.string().optional(), autor: z.string().optional(), notas: notasOrador, despues_de },
}, ({ documento, despues_de, ...c }) => responder(() => f.agregarConFormato(documento, "portada", c, despues_de)));

servidor.registerTool("diapositiva_divisor", {
  description: "Section divider: large number in the accent color, title and subtitle.",
  inputSchema: { documento, numero: z.string().describe('e.g. "03"'), titulo: z.string(), subtitulo: z.string().optional(), notas: notasOrador, despues_de },
}, ({ documento, despues_de, ...c }) => responder(() => f.agregarConFormato(documento, "divisor", c, despues_de)));

const animar_vinetas = z.boolean().default(false).describe("bullets fade in one per click");

servidor.registerTool("diapositiva_contenido", {
  description: "Content slide: kicker, title, full-width bullets, section footer and page number. With animar_vinetas, each bullet enters on a click.",
  inputSchema: { documento, antetitulo, titulo: z.string(), cuerpo, pie, animar_vinetas, notas: notasOrador, despues_de },
}, ({ documento, despues_de, animar_vinetas, ...c }) => responder(async () => {
  if (animar_vinetas && c.cuerpo == null) throw new Error("animar_vinetas necesita un cuerpo con viñetas");
  return f.agregarConFormato(documento, animar_vinetas ? "contenido_vinetas" : "contenido", c, despues_de);
}));

servidor.registerTool("diapositiva_figura", {
  description: "Figure on a white card with a source line (required if the theme demands it). With cuerpo: figure on the left and bullets on the right; without: full-width figure. The image keeps its aspect ratio.",
  inputSchema: {
    documento, antetitulo, titulo: z.string(),
    imagen: z.string().describe("image path (PNG/JPEG); read-only"),
    origen: z.string().optional().describe('source line: "Own work", "Own schematic, illustrative", "Data: …; own plot"'),
    cuerpo, pie, animar_vinetas, notas: notasOrador, despues_de,
  },
}, ({ documento, imagen, despues_de, animar_vinetas, ...c }) => responder(() => f.agregarFigura(documento, imagen, c, despues_de, animar_vinetas)));

servidor.registerTool("diapositiva_tabla", {
  description: "Slide for a table: kicker, title, section footer; the content area is left free (for tabla, ecuacion, forma, charts or components).",
  inputSchema: { documento, antetitulo, titulo: z.string(), pie, notas: notasOrador, despues_de },
}, ({ documento, despues_de, ...c }) => responder(() => f.agregarConFormato(documento, "tabla", c, despues_de)));

servidor.registerTool("diapositiva_cierre", {
  description: "Closing slide: title (default \"Gracias\"; set titulo for another language), subtitle in the accent color and author.",
  inputSchema: { documento, titulo: z.string().default("Gracias"), subtitulo: z.string().optional(), autor: z.string().optional(), notas: notasOrador, despues_de },
}, ({ documento, despues_de, ...c }) => responder(() => f.agregarConFormato(documento, "cierre", c, despues_de)));

// ---------- charts, tables, transitions, media ----------
const diapositiva = numero;
const caja = {
  x: z.number().optional().describe("points from the left (the theme's slide is 960×540)"),
  y: z.number().optional(), ancho: z.number().positive().optional(), alto: z.number().positive().optional(),
};

servidor.registerTool("grafica", {
  description: `Native Keynote chart with the theme's series colors and a legend. Bar/line/area: each series has one value per category. Pie: a single series, one slice per category. Scatter: shared valores_x and, per series, one y value per x (no categories). Fills the content area by default. Types: ${Object.keys(v.TIPOS_GRAFICA).join(", ")}.`,
  inputSchema: {
    documento, diapositiva,
    tipo: z.enum(Object.keys(v.TIPOS_GRAFICA) as [string, ...string[]]),
    categorias: z.array(z.string()).min(1).optional().describe("required except for scatter"),
    series: z.array(z.object({ nombre: z.string(), valores: z.array(z.number()) })).min(1),
    ...caja,
    valores_x: z.array(z.number()).min(1).optional().describe("scatter only: shared x values"),
  },
}, ({ documento, diapositiva, tipo, categorias, series, valores_x, ...c }) => responder(() => v.grafica(documento, diapositiva, tipo, categorias, series, c, valores_x)));

servidor.registerTool("tabla", {
  description: "Table in the theme's style: header row (header color) with bold title-font text, cells (card color) in the body font, first column left-aligned and the rest centered. Values are stored as text (signs and dashes are preserved).",
  inputSchema: {
    documento, diapositiva,
    filas: z.array(z.array(z.string())).min(1).describe("rows of cells; the first is the header if encabezado=true"),
    encabezado: z.boolean().default(true),
    tamano: z.number().min(8).max(32).default(16).describe("font size in pt"),
    ...caja,
  },
}, ({ documento, diapositiva, filas, encabezado, tamano, ...c }) => responder(() => v.tabla(documento, diapositiva, filas, { encabezado, tamano, ...c })));

servidor.registerTool("transicion", {
  description: 'Transition when moving from this slide to the next. "magic move" animates objects that change position, size or rotation between two similar slides (use duplicar_diapositiva and mover_objeto). With automatica=true it advances by itself after the delay.',
  inputSchema: {
    documento, diapositiva,
    efecto: z.enum(v.EFECTOS),
    duracion: z.number().min(0.1).max(10).default(1).describe("seconds"),
    retraso: z.number().min(0).max(60).default(0).describe("seconds"),
    automatica: z.boolean().default(false),
  },
}, ({ documento, diapositiva, efecto, duracion, retraso, automatica }) => responder(() => v.transicion(documento, diapositiva, efecto, duracion, retraso, automatica)));

servidor.registerTool("insertar_medio", {
  description: "Inserts an image, a video (.mp4/.mov/.m4v) or audio on a slide, without a card (for figures with a card and source line use diapositiva_figura). Height follows the file's aspect ratio.",
  inputSchema: {
    documento, diapositiva,
    archivo: z.string().describe("file path; read-only"),
    x: z.number().optional(), y: z.number().optional(), ancho: z.number().positive().optional(),
    repetir: z.enum(["none", "loop", "loop back and forth"]).optional().describe("video/audio"),
    volumen: z.number().min(0).max(100).optional().describe("video/audio, 0–100"),
  },
}, ({ documento, diapositiva, archivo, ...o }) => responder(() => v.insertarMedio(documento, diapositiva, archivo, o)));

servidor.registerTool("linea", {
  description: "Straight line between two points (in points). Color and weight come from the theme; they cannot be set by script.",
  inputSchema: { documento, diapositiva, x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() },
}, ({ documento, diapositiva, x1, y1, x2, y2 }) => responder(() => v.linea(documento, diapositiva, x1, y1, x2, y2)));

servidor.registerTool("duplicar_diapositiva", {
  description: "Duplicates a slide and puts the copy right after it. Basis of Magic Move: duplicate, move or scale objects in the copy with mover_objeto, and set a magic move transition on the original.",
  inputSchema: { documento, diapositiva },
}, ({ documento, diapositiva }) => responder(() => v.duplicarDiapositiva(documento, diapositiva)));

servidor.registerTool("mover_objeto", {
  description: "Moves, resizes and/or rotates an object, identified by type and index as in leer_presentacion with detalle.",
  inputSchema: {
    documento, diapositiva,
    tipo: z.enum(["texto", "figura", "imagen", "video", "tabla", "grafica", "linea", "grupo"]),
    indice: z.number().int().min(1),
    ...caja,
    rotacion: z.number().optional().describe("degrees, clockwise"),
  },
}, ({ documento, diapositiva, tipo, indice, ...c }) => responder(() => v.moverObjeto(documento, diapositiva, tipo, indice, c)));

// ---------- Magic Move animations ----------
const objeto = { tipo: z.enum(a.TIPOS_OBJETO as [a.TipoObjeto, ...a.TipoObjeto[]]), indice: z.number().int().min(1) };
const duracionMM = z.number().min(0.2).max(5).default(1).describe("seconds per Magic Move");

servidor.registerTool("borrar_objeto", {
  description: "Deletes an object from a slide (type and index as in leer_presentacion with detalle).",
  inputSchema: { documento, diapositiva, ...objeto },
}, ({ documento, diapositiva, tipo, indice }) => responder(() => a.borrarObjeto(documento, diapositiva, tipo, indice)));

servidor.registerTool("revelar_por_pasos", {
  description: "Appear animation with Magic Move: the slide's objects appear in the order of `pasos` (each step: one or more objects). Partial versions of the slide are inserted before it; the original stays as the final one. Indexes come from leer_presentacion with detalle on the complete slide.",
  inputSchema: { documento, diapositiva, pasos: z.array(z.array(z.object(objeto)).min(1)).min(1), duracion: duracionMM },
}, ({ documento, diapositiva, pasos, duracion }) => responder(() => a.revelarPorPasos(documento, diapositiva, pasos, duracion)));

servidor.registerTool("animar_cambio", {
  description: "Magic Move animation: duplicates the slide and, in the copy, moves/scales (x, y, ancho, alto in points), rotates (rotacion, degrees), fades (opacidad 0–100) or highlights (color_texto hex, on text) objects; the transition animates the change.",
  inputSchema: {
    documento, diapositiva,
    cambios: z.array(z.object({
      ...objeto, ...caja,
      rotacion: z.number().optional(), opacidad: z.number().min(0).max(100).optional(),
      color_texto: z.string().regex(/^[0-9a-fA-F]{6}$/).optional().describe('hex, e.g. "E3A35B"'),
    })).min(1),
    duracion: duracionMM,
  },
}, ({ documento, diapositiva, cambios, duracion }) => responder(() => a.animarCambio(documento, diapositiva, cambios, duracion)));

servidor.registerTool("revelar_series", {
  description: "Chart whose series enter one at a time (Magic Move between copies of the slide). For bars, lines or areas; the axis rescales between steps because its maximum cannot be set by script.",
  inputSchema: {
    documento, diapositiva,
    tipo: z.enum(Object.keys(v.TIPOS_GRAFICA).filter((t) => !t.startsWith("pastel") && t !== "dispersion") as [string, ...string[]]),
    categorias: z.array(z.string()).min(1),
    series: z.array(z.object({ nombre: z.string(), valores: z.array(z.number()) })).min(2),
    ...caja, duracion: duracionMM,
  },
}, ({ documento, diapositiva, tipo, categorias, series, duracion, ...c }) => responder(() => a.revelarSeries(documento, diapositiva, tipo, categorias, series, c, duracion)));

// ---------- slides, equations, shapes, components, style, present ----------
const colorP = z.string().describe(`color: 6-digit hex or a palette name (${Object.keys(dib.PALETA).join(", ")})`);
const estiloTexto = {
  fuente: z.enum(["titulo", "texto"]).optional().describe("theme title font or body font"), tamano: z.number().min(6).max(120).optional(),
  color: colorP.optional(), negrita: z.boolean().optional(), cursiva: z.boolean().optional(),
};

servidor.registerTool("borrar_diapositiva", {
  description: "Deletes a slide. The template's hidden prototype slides are protected.",
  inputSchema: { documento, diapositiva },
}, ({ documento, diapositiva }) => responder(() => es.borrarDiapositiva(documento, diapositiva)));

servidor.registerTool("mover_diapositiva", {
  description: "Moves a slide to sit after another (0 = at the start). Returns its new number.",
  inputSchema: { documento, diapositiva, despues_de: z.number().int().min(0) },
}, ({ documento, diapositiva, despues_de }) => responder(() => es.moverDiapositiva(documento, diapositiva, despues_de)));

servidor.registerTool("ocultar_diapositiva", {
  description: "Hides (skips) or unhides a slide. Hidden slides are neither presented nor exported.",
  inputSchema: { documento, diapositiva, ocultar: z.boolean().default(true) },
}, ({ documento, diapositiva, ocultar }) => responder(() => es.ocultarDiapositiva(documento, diapositiva, ocultar)));

servidor.registerTool("presentar", {
  description: "Keynote slideshow mode: iniciar (from a slide), siguiente, anterior, detener. TAKES OVER THE USER'S SCREEN: use only if they asked.",
  inputSchema: { accion: z.enum(["iniciar", "siguiente", "anterior", "detener"]), documento: documento.optional(), desde: numero.optional() },
}, ({ accion, documento, desde }) => responder(() => es.presentar(documento, accion, desde)));

servidor.registerTool("ecuacion", {
  description: "Equation in real LaTeX (amsmath; display mode, no $) as a vector image, in the title color by default. Without ancho it keeps the requested font size; without x it is centered. For several lines use \\begin{aligned}…\\end{aligned}.",
  inputSchema: {
    documento, diapositiva, latex: z.string().min(1),
    tamano: z.number().min(8).max(96).default(28).describe("font size in pt"),
    color: colorP.default("titulo"),
    paquetes: z.array(z.string()).optional().describe('extra packages, e.g. ["siunitx", "bm"]'),
    x: z.number().optional(), y: z.number().optional(), ancho: z.number().positive().optional(),
  },
}, ({ documento, diapositiva, latex, ...o }) => responder(() => dib.ecuacion(documento, diapositiva, latex, o)));

// ---------- scientific charts (matplotlib) ----------
const numeros = z.array(z.number());
const errorBarras = z.union([numeros, z.object({ inf: numeros, sup: numeros })]).optional().describe("symmetric (one list) or asymmetric ({inf, sup})");
const ejeCientifico = z.object({
  titulo: z.string().optional().describe("accepts formulas between $…$, e.g. \"$\\sigma_{\\mathrm{3D}}$ (Mpc)\""),
  escala: z.enum(["lineal", "log", "symlog"]).optional(), umbral_lineal: z.number().positive().optional().describe("symlog: linear range around 0"),
  min: z.number().optional(), max: z.number().optional(), invertir: z.boolean().optional().describe("e.g. magnitudes"),
  marcas: numeros.optional(), etiquetas_marcas: z.array(z.string()).optional(),
}).optional();
const estiloLinea = z.enum(["continua", "discontinua", "punteada", "raya_punto"]);

servidor.registerTool("grafica_cientifica", {
  description: "Scientific chart with the theme palette (matplotlib → vector PDF): error bars (symmetric or asymmetric, in x and y), upper limits, log/symlog scales, inverted axes, custom ticks, confidence bands, histograms, secondary y axis, reference lines and annotations. Text accepts formulas between $…$ (Computer Modern, like ecuacion). Without diapositiva: creates a new diapositiva_figura (white card, with source line). With diapositiva: draws over it, using the theme's text colors and a transparent background (by default in the content area). For what Keynote draws well (bars, pie) use grafica, which is editable.",
  inputSchema: {
    documento,
    series: z.array(z.object({
      nombre: z.string().optional().describe("in the legend; accepts $…$"),
      tipo: z.enum(["linea", "puntos", "linea_puntos", "barras", "area", "escalon", "banda", "histograma"]).optional().describe("default: line, or points with line if it has errors. banda: y_inf/y_sup; histograma: valores and bins"),
      x: numeros.optional(), y: numeros.optional(), error_y: errorBarras, error_x: errorBarras,
      limite_superior: z.array(z.boolean()).optional().describe("points that are upper limits (downward arrow)"),
      y_inf: numeros.optional(), y_sup: numeros.optional(),
      valores: numeros.optional(), bins: z.union([z.number().int().positive(), numeros]).optional(), relleno: z.boolean().optional(),
      color: colorP.optional().describe("default: the theme's series cycle"),
      estilo_linea: estiloLinea.optional(),
      marcador: z.enum(["circulo", "cuadrado", "triangulo", "rombo", "estrella", "cruz", "mas", "ninguno"]).optional(),
      tamano_marcador: z.number().positive().optional(), grosor: z.number().positive().optional(),
      opacidad: z.number().min(0).max(100).optional(), ancho_barra: z.number().positive().optional(),
      eje: z.enum(["izquierdo", "derecho"]).optional().describe("derecho: uses the second y axis (eje_y2)"),
    })).min(1),
    eje_x: ejeCientifico, eje_y: ejeCientifico, eje_y2: ejeCientifico,
    lineas_ref: z.array(z.object({ eje: z.enum(["x", "y"]), valor: z.number(), etiqueta: z.string().optional(), color: colorP.optional(), estilo_linea: estiloLinea.optional() })).optional(),
    anotaciones: z.array(z.object({ x: z.number(), y: z.number(), texto: z.string(), dx: z.number().optional(), dy: z.number().optional(), flecha: z.boolean().optional(), color: colorP.optional(), tamano: z.number().positive().optional() })).optional(),
    leyenda: z.enum(["auto", "ninguna", "arriba_derecha", "arriba_izquierda", "abajo_derecha", "abajo_izquierda"]).optional(),
    rejilla: z.boolean().optional(),
    tamano_texto: z.number().min(8).max(32).optional().describe("real pt on the slide (default 14)"),
    diapositiva: numero.optional().describe("if given, draws over that slide instead of creating a figure slide"),
    ...caja,
    antetitulo: antetitulo.optional(), titulo: z.string().optional(),
    origen: z.string().optional().describe('new slide: source line, e.g. "Data: …; own plot"'),
    cuerpo, pie, notas: notasOrador, despues_de,
  },
}, ({ documento, diapositiva, x, y, ancho, alto, antetitulo, titulo, origen, cuerpo, pie, notas, despues_de, ...espec }) => responder(() => {
  if (diapositiva !== undefined) return ci.graficaCientificaEn(documento, diapositiva, espec, { x, y, ancho, alto });
  if (!antetitulo || !titulo) throw new Error("A new slide needs antetitulo and titulo (or give diapositiva to draw over an existing one)");
  return ci.graficaCientificaFigura(documento, espec, { antetitulo, titulo, origen, cuerpo, pie, notas }, despues_de);
}));

servidor.registerTool("forma", {
  description: "Vector shape in the theme palette: rectangulo, rectangulo_redondeado, elipse (circle if ancho = alto), triangulo, triangulo_rectangulo, rombo, poligono (lados), estrella (lados = points), bocadillo (speech bubble; cola) (with x, y, ancho, alto) or linea, flecha, flecha_doble (with x1, y1, x2, y2). Fill, border, weight, opacity 0–100, dashed; optional centered text on top. Default: card fill with border; lines in the accent color.",
  inputSchema: {
    documento, diapositiva,
    tipo: z.enum(["rectangulo", "rectangulo_redondeado", "elipse", "triangulo", "triangulo_rectangulo", "rombo", "poligono", "estrella", "bocadillo", "linea", "flecha", "flecha_doble"]),
    x: z.number().optional(), y: z.number().optional(), ancho: z.number().positive().optional(), alto: z.number().positive().optional(),
    x1: z.number().optional(), y1: z.number().optional(), x2: z.number().optional(), y2: z.number().optional(),
    relleno: colorP.optional().describe('or "ninguno" (none)'), borde: colorP.optional().describe('or "ninguno" (none)'),
    grosor: z.number().min(0.25).max(30).optional(), opacidad: z.number().min(0).max(100).optional(),
    punteado: z.boolean().optional(), radio: z.number().min(0).optional(),
    lados: z.number().int().min(3).max(64).optional().describe("polygon: number of sides (default 6); star: points (default 5)"),
    cola: z.enum(["abajo", "arriba", "izquierda", "derecha"]).optional().describe("bocadillo: side the tail comes out of"),
    texto: z.string().optional(), estilo_texto: z.object(estiloTexto).optional(),
  },
}, ({ documento, diapositiva, ...f }) => responder(() => dib.forma(documento, diapositiva, f)));

servidor.registerTool("estilo_texto", {
  description: "Changes the style of existing text (type and index from leer_presentacion with detalle): theme title or body font, size, color, bold, italic; the whole text or one paragraph.",
  inputSchema: { documento, diapositiva, tipo: z.enum(["texto", "figura"]).default("texto"), indice: z.number().int().min(1), parrafo: z.number().int().min(1).optional(), ...estiloTexto },
}, ({ documento, diapositiva, tipo, indice, ...e }) => responder(() => dib.estiloTexto(documento, diapositiva, tipo, indice, e)));

servidor.registerTool("cifras_destacadas", {
  description: "Row of 1–4 highlighted figures: bordered card, large number in the title font and a small label. Number color: any theme color (default titulo).",
  inputSchema: { documento, diapositiva, cifras: z.array(z.object({ valor: z.string(), etiqueta: z.string().describe("one or several lines"), color: colorP.optional() })).min(1).max(4), ...caja },
}, ({ documento, diapositiva, cifras, ...c }) => responder(() => dib.cifrasDestacadas(documento, diapositiva, cifras, c)));

servidor.registerTool("tarjetas_numeradas", {
  description: "Row of 2–4 theme cards (summaries, questions, messages): short heading in the title font and accent color (a number, a figure or a phrase) and text below.",
  inputSchema: { documento, diapositiva, tarjetas: z.array(z.object({ encabezado: z.string(), texto: z.string() })).min(2).max(4), ...caja },
}, ({ documento, diapositiva, tarjetas, ...c }) => responder(() => dib.tarjetasNumeradas(documento, diapositiva, tarjetas, c)));

servidor.registerTool("agenda", {
  description: "Two-column agenda: up to 8 items with a number in the accent color, title and description. Use it on a diapositiva_tabla.",
  inputSchema: { documento, diapositiva, puntos: z.array(z.object({ numero: z.string().optional(), titulo: z.string(), descripcion: z.string().optional() })).min(1).max(8) },
}, ({ documento, diapositiva, puntos }) => responder(() => dib.agenda(documento, diapositiva, puntos)));

servidor.registerTool("diapositiva_video", {
  description: "Video slide: kicker ANIMACIÓN, looping video on a white card with a required source line, and on the right a QUÉ OBSERVAR (what to watch) box with 2–3 bullets.",
  inputSchema: {
    documento, titulo: z.string(), video: z.string().describe("video path; read-only"),
    origen: z.string(), observar: z.array(z.string()).min(1).max(4),
    antetitulo: z.string().optional(), pie, notas: notasOrador, despues_de,
  },
}, ({ documento, video, despues_de, ...c }) => responder(() => dib.diapositivaVideo(documento, video, c, despues_de)));

servidor.registerTool("editar_celdas", {
  description: "Changes cells of an existing table (table index as in leer_presentacion with detalle; row and column from 1). Values are stored as text.",
  inputSchema: { documento, diapositiva, tabla: z.number().int().min(1).default(1), celdas: z.array(z.object({ fila: z.number().int().min(1), columna: z.number().int().min(1), valor: z.string() })).min(1) },
}, ({ documento, diapositiva, tabla, celdas }) => responder(() => v.editarCeldas(documento, diapositiva, tabla, celdas)));

// ---------- bulk editing and tables ----------
const refObjeto = z.object({ tipo: z.enum(["texto", "figura", "imagen", "video", "tabla", "grafica", "linea", "grupo"]), indice: z.number().int().min(1) });

servidor.registerTool("tabla_estructura", {
  description: "Changes a table's structure and re-applies the theme style: merge or split a range (\"A1:B1\"; when merging, Keynote joins texts with a tab, so merge empty cells with one filled cell), sort by a column (header stays on top), add rows or columns at the end (keeps the width), remove a row or column.",
  inputSchema: {
    documento, diapositiva, tabla: z.number().int().min(1).default(1),
    accion: z.enum(["fusionar", "separar", "ordenar", "agregar_filas", "quitar_fila", "agregar_columnas", "quitar_columna"]),
    rango: z.string().optional(), columna: z.number().int().min(1).optional(), fila: z.number().int().min(1).optional(),
    descendente: z.boolean().optional(), cantidad: z.number().int().min(1).optional(),
  },
}, ({ documento, diapositiva, tabla, accion, ...o }) => responder(() => v.tablaEstructura(documento, diapositiva, tabla, accion, o)));

servidor.registerTool("buscar_reemplazar", {
  description: "Searches text across the whole presentation (boxes, shapes, notes and table cells); with reemplazar, replaces it. Text with mixed formatting (e.g. one bold colored word) is not rewritten so as not to lose that emphasis, unless forzar is set: it is reported separately. Without reemplazar it only counts and changes nothing.",
  inputSchema: {
    documento, buscar: z.string().min(1), reemplazar: z.string().optional(),
    mayusculas: z.boolean().default(false).describe("case-sensitive"),
    notas: z.boolean().default(true), tablas: z.boolean().default(true), forzar: z.boolean().default(false),
  },
}, ({ documento, buscar, ...o }) => responder(() => ed.buscarReemplazar(documento, buscar, o)));

servidor.registerTool("alinear_objetos", {
  description: "Aligns objects with each other (to a common edge or center) or with the slide: izquierda (left), centro, derecha (right), arriba (top), medio (middle), abajo (bottom).",
  inputSchema: { documento, diapositiva, objetos: z.array(refObjeto).min(1), modo: z.enum(["izquierda", "centro", "derecha", "arriba", "medio", "abajo"]), respecto: z.enum(["objetos", "diapositiva"]).default("objetos") },
}, ({ documento, diapositiva, objetos, modo, respecto }) => responder(() => ed.alinearObjetos(documento, diapositiva, objetos, modo, respecto)));

servidor.registerTool("distribuir_objetos", {
  description: "Spreads 3 or more objects with equal spacing, horizontally or vertically (the first and last do not move).",
  inputSchema: { documento, diapositiva, objetos: z.array(refObjeto).min(3), eje: z.enum(["horizontal", "vertical"]) },
}, ({ documento, diapositiva, objetos, eje }) => responder(() => ed.distribuirObjetos(documento, diapositiva, objetos, eje)));

servidor.registerTool("bloquear_objeto", {
  description: "Locks (or unlocks) an object so it is not moved by accident when editing by hand in Keynote.",
  inputSchema: { documento, diapositiva, ...refObjeto.shape, bloquear: z.boolean().default(true) },
}, ({ documento, diapositiva, tipo, indice, bloquear }) => responder(() => ed.bloquearObjeto(documento, diapositiva, { tipo, indice }, bloquear)));

servidor.registerTool("diapositivas_desde_imagenes", {
  description: "One slide per image. In themed decks each is a diapositiva_figura (white card; source line; title from the file name or from titulos); in other presentations uses Keynote's own command.",
  inputSchema: {
    documento, imagenes: z.array(z.string()).min(1).describe("paths; read-only"),
    origen: z.string().optional(), titulos: z.array(z.string()).optional(), antetitulo: z.string().optional(), pie, despues_de,
  },
}, ({ documento, imagenes, ...o }) => responder(() => ed.diapositivasDesdeImagenes(documento, imagenes, o)));

// ---------- review ----------
servidor.registerTool("revisar_presentacion", {
  description: "Reviews all visible slides and reports problems by severity: objects outside the slide or over the footer, body text Keynote shrinks to fit (estimated effective size), low contrast against the real background, figures or videos without a source line, leftover placeholder text, font < 10 pt and slides without notes. Also returns a contact sheet of all slides. Use it before calling a presentation finished.",
  inputSchema: { documento },
  annotations: { readOnlyHint: true },
}, async ({ documento }) => {
  try {
    const r = await rv.revisarPresentacion(documento);
    const contenido: Resultado["content"] = [{ type: "text", text: JSON.stringify(r, null, 2) }];
    if (r.hoja) contenido.push({ type: "image", data: (await readFile(r.hoja)).toString("base64"), mimeType: "image/png" });
    return { content: contenido };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
  }
});

await asegurarCarpetas();
await servidor.connect(new StdioServerTransport());
