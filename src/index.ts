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

// Lo que lee cualquier sesión de Claude que use Atril, desde cualquier proyecto: el flujo de
// trabajo, el tema activo y las reglas. Detalle en README.md.
const colores = Object.keys(PALETA).join(", ");
const origen = TEMA.origen_obligatorio
  ? 'el pie de origen es OBLIGATORIO en este tema: "Elaboración propia", "Esquema propio, ilustrativo" o "Datos: …; gráfica propia"'
  : "el pie de origen es opcional (recomendado si la figura no es propia)";
const INSTRUCCIONES = `Atril controla Keynote para crear, editar, animar, revisar y exportar presentaciones con un formato consistente.

Tema activo: ${TEMA.nombre}${TEMA.descripcion ? ` (${TEMA.descripcion})` : ""}. Títulos en ${TEMA.fuentes.titulo}, texto en ${TEMA.fuentes.texto}. Colores por nombre: ${colores}; también hex de 6 dígitos.

Flujo para una presentación nueva con el formato:
1. crear_con_formato (trae prototipos ocultos al final: no borrarlos).
2. Una herramienta por diapositiva: diapositiva_portada, diapositiva_divisor (número de sección), diapositiva_contenido (antetítulo corto, título, viñetas una por línea, pie de sección), diapositiva_figura (imagen sobre tarjeta blanca; ${origen}), diapositiva_tabla seguida de tabla, y diapositiva_cierre. Pon el guion en notas.
3. Gráficas: grafica (nativa y editable: barras, líneas, pastel) o grafica_cientifica (barras de error, escalas log, bandas, cotas, histogramas; en una diapositiva de figura nueva o encima de una existente).
4. Sobre una diapositiva_tabla (área libre): ecuacion (LaTeX real), forma (figuras con la paleta), cifras_destacadas, tarjetas_numeradas, agenda, grafica o tabla. Para video: diapositiva_video.
5. Animaciones: animar_vinetas en contenido o figura (una viñeta por clic); revelar_por_pasos, animar_cambio y revelar_series (Magic Move); transicion entre diapositivas.
6. Para corregir: poner_texto, estilo_texto, buscar_reemplazar, editar_celdas, tabla_estructura, mover_objeto (también gira), alinear_objetos, distribuir_objetos, bloquear_objeto, borrar_objeto, borrar/mover/ocultar_diapositiva. Para una serie de figuras: diapositivas_desde_imagenes.
7. Mira cada diapositiva con ver_diapositiva después de crearla o cambiarla, y antes de terminar corre revisar_presentacion y corrige lo de gravedad alta y media.
8. exportar (pdf, pptx, png, video, html, keynote09 o gif; pdf con_notas para compartir con el guion) y guardar. presentar solo si el usuario lo pide (ocupa su pantalla).

Reglas:
- Las presentaciones del usuario nunca se modifican: abrir hace una copia en ${DIR}. Atril solo modifica, guarda o cierra lo que vive en esa carpeta.
- Escribe en el idioma de la presentación, con frases medidas; sin jerga interna en las diapositivas.
- Pocas viñetas por diapositiva: si revisar_presentacion dice "cuerpo encogido", divide la diapositiva.
- Letras griegas, subíndices y superíndices (δ₃D, σ_z, M⊙, 10⁴): con ecuacion. El texto de Keynote por script no tiene subíndices, y Unicode no tiene subíndice para D, z ni la mayoría de las letras. En gráficas científicas, con $…$ en títulos, ejes y leyendas.
- Nunca duplicar ni mover diapositivas entre dos documentos: Keynote se cierra de golpe (-609).
- Unidades en puntos; la diapositiva del formato mide 960×540 (13.333×7.5 in a 72 pt/in). La numeración la pone Keynote por posición.
- Límites de Keynote por script: el color de cada serie de una gráfica nativa lo pone el tema, no se elige; la dispersión comparte una lista de x; el borde de las tablas no se puede fijar; las figuras y ecuaciones son imágenes vectoriales (no figuras editables de Keynote); la alineación de párrafo no se puede fijar; el eje se reescala en revelar_series.`;

const servidor = new McpServer({ name: "atril", version: "0.1.0" }, { instructions: INSTRUCCIONES });

type Resultado = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: boolean };

async function responder(fn: () => Promise<unknown>): Promise<Resultado> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn(), null, 2) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
  }
}

const documento = z.string().describe("id de la presentación (de listar_presentaciones_abiertas, abrir o crear) o su nombre exacto");
const numero = z.number().int().min(1).describe("número de diapositiva, empezando en 1");

servidor.registerTool("listar_presentaciones_abiertas", {
  description: "Lista las presentaciones abiertas en Keynote: id, nombre, archivo, número de diapositivas, tema, tamaño y si Atril puede editarla (editable=false: es del usuario, solo lectura).",
  annotations: { readOnlyHint: true },
}, () => responder(() => h.listarPresentaciones()));

servidor.registerTool("abrir", {
  description: "Abre una presentación (.key, .pptx o .ppt) haciendo primero una COPIA en la carpeta de trabajo de Atril; el original nunca se toca. Si la ruta ya está en la carpeta de trabajo, abre esa copia directamente.",
  inputSchema: { ruta: z.string().describe("ruta absoluta (o con ~) de la presentación") },
}, ({ ruta }) => responder(() => h.abrir(ruta)));

servidor.registerTool("crear", {
  description: "Crea una presentación nueva con un tema de Keynote y la guarda de inmediato como .key en la carpeta de copias de Atril. Si el tema no existe, el error lista los disponibles.",
  inputSchema: {
    tema: z.string().default("Basic White"),
    ancho: z.number().int().positive().default(1920),
    alto: z.number().int().positive().default(1080),
    nombre: z.string().optional().describe("nombre del archivo, sin extensión"),
  },
}, ({ tema, ancho, alto, nombre }) => responder(() => h.crear(tema, ancho, alto, nombre)));

servidor.registerTool("leer_presentacion", {
  description: "Lee una presentación: por diapositiva, diseño, si está saltada, título, cuerpo, notas del presentador, transición, conteo de objetos por tipo y sus textos. Con detalle=true devuelve cada objeto con tipo, índice, texto, archivo y posición/tamaño (los índices sirven para poner_texto).",
  inputSchema: {
    documento,
    desde: numero.optional(),
    hasta: numero.optional(),
    detalle: z.boolean().default(false),
  },
  annotations: { readOnlyHint: true },
}, ({ documento, desde, hasta, detalle }) => responder(() => h.leerPresentacion(documento, desde, hasta, detalle)));

servidor.registerTool("agregar_diapositiva", {
  description: "Agrega una diapositiva con un diseño maestro (por nombre) al final, o después de la diapositiva indicada (0 = al principio). Si el diseño no existe, el error lista los disponibles.",
  inputSchema: {
    documento,
    diseno: z.string().optional().describe('nombre del diseño maestro, p. ej. "Title & Bullets"'),
    despues_de: z.number().int().min(0).optional(),
  },
}, ({ documento, diseno, despues_de }) => responder(() => h.agregarDiapositiva(documento, diseno, despues_de)));

servidor.registerTool("poner_texto", {
  description: "Escribe texto en una diapositiva: el título y el cuerpo del diseño, reemplaza el texto de objetos existentes (tipo e índice de leer_presentacion con detalle) y/o agrega un cuadro de texto nuevo en una posición (puntos). En el cuerpo, cada línea es una viñeta.",
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
  description: "Lee las notas del presentador de una diapositiva o, si se da texto, las reemplaza.",
  inputSchema: { documento, diapositiva: numero, texto: z.string().optional() },
}, ({ documento, diapositiva, texto }) => responder(() => h.notas(documento, diapositiva, texto)));

servidor.registerTool("exportar", {
  description: "Exporta la presentación a PDF, PowerPoint, imágenes PNG/JPEG (una por diapositiva visible, en una carpeta), video 1080p (con transiciones), HTML (carpeta), Keynote ’09 o GIF animado (desde el video; requiere ffmpeg). Por defecto va a la carpeta de salidas de Atril; nunca sobrescribe: si el destino existe, agrega _2, _3…",
  inputSchema: {
    documento,
    formato: z.enum(["pdf", "pptx", "png", "jpeg", "video", "html", "keynote09", "gif"]),
    destino: z.string().optional().describe("ruta absoluta del archivo (pdf/pptx) o carpeta (png/jpeg)"),
    etapas: z.boolean().default(false).describe("pdf/png/jpeg: una página o imagen por cada paso de animación"),
    con_notas: z.boolean().default(false).describe("pdf: cada página lleva la diapositiva y debajo sus notas del presentador (para compartir con el guion)"),
  },
}, ({ documento, formato, destino, etapas, con_notas }) => responder(() => h.exportar(documento, formato, destino, etapas, con_notas)));

servidor.registerTool("ver_diapositiva", {
  description: "Devuelve la imagen PNG de una diapositiva tal como la dibuja Keynote, para revisar el resultado.",
  inputSchema: { documento, diapositiva: numero, ancho_max: z.number().int().min(320).max(3840).default(1600) },
  annotations: { readOnlyHint: true },
}, async ({ documento, diapositiva, ancho_max }) => {
  try {
    const v = await h.verDiapositiva(documento, diapositiva, ancho_max);
    return { content: [
      { type: "image", data: v.png.toString("base64"), mimeType: "image/png" },
      { type: "text", text: `${v.documento}, diapositiva ${v.diapositiva} → ${v.ruta}` },
    ] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
  }
});

servidor.registerTool("guardar", {
  description: "Guarda una presentación de Atril como .key en la carpeta de copias (las nuevas o importadas de PowerPoint reciben archivo nuevo). Nunca guarda presentaciones del usuario.",
  inputSchema: { documento, nombre: z.string().optional().describe("nombre del archivo, sin extensión") },
}, ({ documento, nombre }) => responder(() => h.guardar(documento, nombre)));

servidor.registerTool("cerrar", {
  description: "Cierra una presentación de Atril; por defecto sin guardar. No cierra presentaciones del usuario.",
  inputSchema: { documento, guardar: z.boolean().default(false) },
}, ({ documento, guardar }) => responder(() => h.cerrar(documento, guardar)));

// ---------- formato (plantilla del tema) ----------
const despues_de = z.number().int().min(0).optional().describe("insertar después de esta diapositiva (0 = al principio); por omisión, al final");
const notasOrador = z.string().optional().describe("notas del presentador (el guion)");
const antetitulo = z.string().describe("antetítulo corto; se escribe en MAYÚSCULAS");
const pie = z.string().optional().describe('pie de sección, p. ej. "04 · Resultados — Caso A"');
const cuerpo = z.string().optional().describe("viñetas, una por línea (▪ automática)");

servidor.registerTool("crear_con_formato", {
  description: "Crea una presentación con el formato del tema activo (su plantilla: fondos, tipografías y paleta). Trae ocultas 6 diapositivas prototipo al final: no borrarlas, las usan las herramientas diapositiva_*.",
  inputSchema: { nombre: z.string().optional().describe("nombre del archivo, sin extensión") },
}, ({ nombre }) => responder(() => f.crearConFormato(nombre)));

servidor.registerTool("diapositiva_portada", {
  description: "Portada: antetítulo en el color de acento, título grande, subtítulo en cursiva y autor.",
  inputSchema: { documento, antetitulo, titulo: z.string(), subtitulo: z.string().optional(), autor: z.string().optional(), notas: notasOrador, despues_de },
}, ({ documento, despues_de, ...c }) => responder(() => f.agregarConFormato(documento, "portada", c, despues_de)));

servidor.registerTool("diapositiva_divisor", {
  description: "Divisor de sección: número grande en el color de acento, título y subtítulo.",
  inputSchema: { documento, numero: z.string().describe('p. ej. "03"'), titulo: z.string(), subtitulo: z.string().optional(), notas: notasOrador, despues_de },
}, ({ documento, despues_de, ...c }) => responder(() => f.agregarConFormato(documento, "divisor", c, despues_de)));

const animar_vinetas = z.boolean().default(false).describe("las viñetas entran una por clic, desvaneciéndose");

servidor.registerTool("diapositiva_contenido", {
  description: "Diapositiva de contenido: antetítulo, título, viñetas a todo el ancho, pie de sección y número de página. Con animar_vinetas, cada viñeta entra con un clic.",
  inputSchema: { documento, antetitulo, titulo: z.string(), cuerpo, pie, animar_vinetas, notas: notasOrador, despues_de },
}, ({ documento, despues_de, animar_vinetas, ...c }) => responder(async () => {
  if (animar_vinetas && c.cuerpo == null) throw new Error("animar_vinetas necesita un cuerpo con viñetas");
  return f.agregarConFormato(documento, animar_vinetas ? "contenido_vinetas" : "contenido", c, despues_de);
}));

servidor.registerTool("diapositiva_figura", {
  description: "Figura sobre tarjeta blanca con pie de origen (obligatorio si el tema lo exige). Con cuerpo: figura a la izquierda y viñetas a la derecha; sin cuerpo: figura a todo el ancho. La imagen conserva su proporción.",
  inputSchema: {
    documento, antetitulo, titulo: z.string(),
    imagen: z.string().describe("ruta de la imagen (PNG/JPEG); solo se lee"),
    origen: z.string().optional().describe('pie de origen: "Elaboración propia", "Esquema propio, ilustrativo", "Datos: …; gráfica propia"'),
    cuerpo, pie, animar_vinetas, notas: notasOrador, despues_de,
  },
}, ({ documento, imagen, despues_de, animar_vinetas, ...c }) => responder(() => f.agregarFigura(documento, imagen, c, despues_de, animar_vinetas)));

servidor.registerTool("diapositiva_tabla", {
  description: "Diapositiva para tabla: antetítulo, título, pie de sección; el área de contenido queda libre (para tabla, ecuacion, forma, gráficas o componentes).",
  inputSchema: { documento, antetitulo, titulo: z.string(), pie, notas: notasOrador, despues_de },
}, ({ documento, despues_de, ...c }) => responder(() => f.agregarConFormato(documento, "tabla", c, despues_de)));

servidor.registerTool("diapositiva_cierre", {
  description: "Cierre: título (\"Gracias\"), subtítulo en el color de acento y autor.",
  inputSchema: { documento, titulo: z.string().default("Gracias"), subtitulo: z.string().optional(), autor: z.string().optional(), notas: notasOrador, despues_de },
}, ({ documento, despues_de, ...c }) => responder(() => f.agregarConFormato(documento, "cierre", c, despues_de)));

// ---------- gráficas, tablas, transiciones, medios ----------
const diapositiva = numero;
const caja = {
  x: z.number().optional().describe("puntos desde la izquierda (la diapositiva del formato mide 960×540)"),
  y: z.number().optional(), ancho: z.number().positive().optional(), alto: z.number().positive().optional(),
};

servidor.registerTool("grafica", {
  description: `Gráfica nativa de Keynote con los colores de las series del tema y leyenda. Barras/línea/área: cada serie trae un valor por categoría. Pastel: una sola serie, una porción por categoría. Dispersión: valores_x compartidos y, por serie, un valor y por cada x (sin categorías). Por omisión ocupa el área de contenido. Tipos: ${Object.keys(v.TIPOS_GRAFICA).join(", ")}.`,
  inputSchema: {
    documento, diapositiva,
    tipo: z.enum(Object.keys(v.TIPOS_GRAFICA) as [string, ...string[]]),
    categorias: z.array(z.string()).min(1).optional().describe("obligatorias salvo en dispersión"),
    series: z.array(z.object({ nombre: z.string(), valores: z.array(z.number()) })).min(1),
    ...caja,
    valores_x: z.array(z.number()).min(1).optional().describe("solo dispersión: valores de x compartidos"),
  },
}, ({ documento, diapositiva, tipo, categorias, series, valores_x, ...c }) => responder(() => v.grafica(documento, diapositiva, tipo, categorias, series, c, valores_x)));

servidor.registerTool("tabla", {
  description: "Tabla con el estilo del tema: cabecera (color cabecera) con texto de título en negrita, celdas (color tarjeta) con la tipografía de texto, primera columna a la izquierda y el resto centrado. Los valores se guardan como texto (conservan signos y guiones).",
  inputSchema: {
    documento, diapositiva,
    filas: z.array(z.array(z.string())).min(1).describe("filas de celdas; la primera es la cabecera si encabezado=true"),
    encabezado: z.boolean().default(true),
    tamano: z.number().min(8).max(32).default(16).describe("tamaño de letra en pt"),
    ...caja,
  },
}, ({ documento, diapositiva, filas, encabezado, tamano, ...c }) => responder(() => v.tabla(documento, diapositiva, filas, { encabezado, tamano, ...c })));

servidor.registerTool("transicion", {
  description: 'Transición al pasar de esta diapositiva a la siguiente. "magic move" anima los objetos que cambian de lugar, tamaño o rotación entre dos diapositivas parecidas (usa duplicar_diapositiva y mover_objeto). Con automatica=true avanza sola tras el retraso.',
  inputSchema: {
    documento, diapositiva,
    efecto: z.enum(v.EFECTOS),
    duracion: z.number().min(0.1).max(10).default(1).describe("segundos"),
    retraso: z.number().min(0).max(60).default(0).describe("segundos"),
    automatica: z.boolean().default(false),
  },
}, ({ documento, diapositiva, efecto, duracion, retraso, automatica }) => responder(() => v.transicion(documento, diapositiva, efecto, duracion, retraso, automatica)));

servidor.registerTool("insertar_medio", {
  description: "Inserta una imagen, un video (.mp4/.mov/.m4v) o un audio en una diapositiva, sin tarjeta (para figuras con tarjeta y pie de origen usa diapositiva_figura). El alto sigue la proporción del archivo.",
  inputSchema: {
    documento, diapositiva,
    archivo: z.string().describe("ruta del archivo; solo se lee"),
    x: z.number().optional(), y: z.number().optional(), ancho: z.number().positive().optional(),
    repetir: z.enum(["none", "loop", "loop back and forth"]).optional().describe("video/audio"),
    volumen: z.number().min(0).max(100).optional().describe("video/audio, 0–100"),
  },
}, ({ documento, diapositiva, archivo, ...o }) => responder(() => v.insertarMedio(documento, diapositiva, archivo, o)));

servidor.registerTool("linea", {
  description: "Línea recta entre dos puntos (en puntos). El color y el grosor los pone el tema; no se pueden fijar por script.",
  inputSchema: { documento, diapositiva, x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() },
}, ({ documento, diapositiva, x1, y1, x2, y2 }) => responder(() => v.linea(documento, diapositiva, x1, y1, x2, y2)));

servidor.registerTool("duplicar_diapositiva", {
  description: "Duplica una diapositiva y pone la copia justo después. Base de Magic Move: duplicar, mover o escalar objetos en la copia con mover_objeto, y poner transición magic move en la original.",
  inputSchema: { documento, diapositiva },
}, ({ documento, diapositiva }) => responder(() => v.duplicarDiapositiva(documento, diapositiva)));

servidor.registerTool("mover_objeto", {
  description: "Mueve, redimensiona y/o gira un objeto, identificado por tipo e índice como en leer_presentacion con detalle.",
  inputSchema: {
    documento, diapositiva,
    tipo: z.enum(["texto", "figura", "imagen", "video", "tabla", "grafica", "linea", "grupo"]),
    indice: z.number().int().min(1),
    ...caja,
    rotacion: z.number().optional().describe("grados, en sentido horario"),
  },
}, ({ documento, diapositiva, tipo, indice, ...c }) => responder(() => v.moverObjeto(documento, diapositiva, tipo, indice, c)));

// ---------- animaciones con Magic Move ----------
const objeto = { tipo: z.enum(a.TIPOS_OBJETO as [a.TipoObjeto, ...a.TipoObjeto[]]), indice: z.number().int().min(1) };
const duracionMM = z.number().min(0.2).max(5).default(1).describe("segundos de cada Magic Move");

servidor.registerTool("borrar_objeto", {
  description: "Borra un objeto de una diapositiva (tipo e índice como en leer_presentacion con detalle).",
  inputSchema: { documento, diapositiva, ...objeto },
}, ({ documento, diapositiva, tipo, indice }) => responder(() => a.borrarObjeto(documento, diapositiva, tipo, indice)));

servidor.registerTool("revelar_por_pasos", {
  description: "Animación de aparición con Magic Move: los objetos de la diapositiva aparecen en el orden de `pasos` (cada paso, uno o varios objetos). Se insertan antes versiones parciales de la diapositiva; la original queda como la final. Los índices se toman de leer_presentacion con detalle sobre la diapositiva completa.",
  inputSchema: { documento, diapositiva, pasos: z.array(z.array(z.object(objeto)).min(1)).min(1), duracion: duracionMM },
}, ({ documento, diapositiva, pasos, duracion }) => responder(() => a.revelarPorPasos(documento, diapositiva, pasos, duracion)));

servidor.registerTool("animar_cambio", {
  description: "Animación con Magic Move: duplica la diapositiva y en la copia mueve/escala (x, y, ancho, alto en puntos), gira (rotacion, grados), atenúa (opacidad 0–100) o resalta (color_texto hex, en textos) objetos; la transición anima el cambio.",
  inputSchema: {
    documento, diapositiva,
    cambios: z.array(z.object({
      ...objeto, ...caja,
      rotacion: z.number().optional(), opacidad: z.number().min(0).max(100).optional(),
      color_texto: z.string().regex(/^[0-9a-fA-F]{6}$/).optional().describe('hex, p. ej. "E3A35B"'),
    })).min(1),
    duracion: duracionMM,
  },
}, ({ documento, diapositiva, cambios, duracion }) => responder(() => a.animarCambio(documento, diapositiva, cambios, duracion)));

servidor.registerTool("revelar_series", {
  description: "Gráfica cuyas series entran una por una (Magic Move entre copias de la diapositiva). Para barras, líneas o áreas; el eje se reescala entre pasos porque su máximo no se puede fijar por script.",
  inputSchema: {
    documento, diapositiva,
    tipo: z.enum(Object.keys(v.TIPOS_GRAFICA).filter((t) => !t.startsWith("pastel") && t !== "dispersion") as [string, ...string[]]),
    categorias: z.array(z.string()).min(1),
    series: z.array(z.object({ nombre: z.string(), valores: z.array(z.number()) })).min(2),
    ...caja, duracion: duracionMM,
  },
}, ({ documento, diapositiva, tipo, categorias, series, duracion, ...c }) => responder(() => a.revelarSeries(documento, diapositiva, tipo, categorias, series, c, duracion)));

// ---------- diapositivas, ecuaciones, figuras, componentes, estilo, presentar ----------
const colorP = z.string().describe(`color: hex de 6 dígitos o de la paleta (${Object.keys(dib.PALETA).join(", ")})`);
const estiloTexto = {
  fuente: z.enum(["titulo", "texto"]).optional().describe("tipografía de títulos o de texto del tema"), tamano: z.number().min(6).max(120).optional(),
  color: colorP.optional(), negrita: z.boolean().optional(), cursiva: z.boolean().optional(),
};

servidor.registerTool("borrar_diapositiva", {
  description: "Borra una diapositiva. Los prototipos ocultos de la plantilla están protegidos.",
  inputSchema: { documento, diapositiva },
}, ({ documento, diapositiva }) => responder(() => es.borrarDiapositiva(documento, diapositiva)));

servidor.registerTool("mover_diapositiva", {
  description: "Mueve una diapositiva para que quede después de otra (0 = al principio). Devuelve su nuevo número.",
  inputSchema: { documento, diapositiva, despues_de: z.number().int().min(0) },
}, ({ documento, diapositiva, despues_de }) => responder(() => es.moverDiapositiva(documento, diapositiva, despues_de)));

servidor.registerTool("ocultar_diapositiva", {
  description: "Oculta (salta) o vuelve a mostrar una diapositiva. Las ocultas no se presentan ni se exportan.",
  inputSchema: { documento, diapositiva, ocultar: z.boolean().default(true) },
}, ({ documento, diapositiva, ocultar }) => responder(() => es.ocultarDiapositiva(documento, diapositiva, ocultar)));

servidor.registerTool("presentar", {
  description: "Modo presentación de Keynote: iniciar (desde una diapositiva), siguiente, anterior, detener. OCUPA LA PANTALLA del usuario: úsalo solo si lo pidió.",
  inputSchema: { accion: z.enum(["iniciar", "siguiente", "anterior", "detener"]), documento: documento.optional(), desde: numero.optional() },
}, ({ accion, documento, desde }) => responder(() => es.presentar(documento, accion, desde)));

servidor.registerTool("ecuacion", {
  description: "Ecuación con LaTeX real (amsmath; modo display, sin $) como imagen vectorial, en el color de título por omisión. Sin ancho queda del tamaño de letra pedido; sin x se centra. Para varias líneas usa \\begin{aligned}…\\end{aligned}.",
  inputSchema: {
    documento, diapositiva, latex: z.string().min(1),
    tamano: z.number().min(8).max(96).default(28).describe("tamaño de letra en pt"),
    color: colorP.default("titulo"),
    paquetes: z.array(z.string()).optional().describe('paquetes extra, p. ej. ["siunitx", "bm"]'),
    x: z.number().optional(), y: z.number().optional(), ancho: z.number().positive().optional(),
  },
}, ({ documento, diapositiva, latex, ...o }) => responder(() => dib.ecuacion(documento, diapositiva, latex, o)));

// ---------- gráficas científicas (matplotlib) ----------
const numeros = z.array(z.number());
const errorBarras = z.union([numeros, z.object({ inf: numeros, sup: numeros })]).optional().describe("simétrico (una lista) o asimétrico ({inf, sup})");
const ejeCientifico = z.object({
  titulo: z.string().optional().describe("admite fórmulas entre $…$, p. ej. \"$\\sigma_{\\mathrm{3D}}$ (Mpc)\""),
  escala: z.enum(["lineal", "log", "symlog"]).optional(), umbral_lineal: z.number().positive().optional().describe("symlog: tramo lineal alrededor de 0"),
  min: z.number().optional(), max: z.number().optional(), invertir: z.boolean().optional().describe("p. ej. magnitudes"),
  marcas: numeros.optional(), etiquetas_marcas: z.array(z.string()).optional(),
}).optional();
const estiloLinea = z.enum(["continua", "discontinua", "punteada", "raya_punto"]);

servidor.registerTool("grafica_cientifica", {
  description: "Gráfica científica con la paleta del tema (matplotlib → PDF vectorial): barras de error (simétricas o asimétricas, en x y en y), cotas superiores, escalas log/symlog, ejes invertidos, marcas propias, bandas de confianza, histogramas, segundo eje y, líneas de referencia y anotaciones. Textos con fórmulas entre $…$ (Computer Modern, como ecuacion). Sin diapositiva: crea una diapositiva_figura nueva (tarjeta blanca, con pie de origen). Con diapositiva: la dibuja encima, con los colores de texto del tema y fondo transparente (por omisión, en el área de contenido). Para lo que Keynote sí dibuja bien (barras, pastel) usa grafica, que es editable.",
  inputSchema: {
    documento,
    series: z.array(z.object({
      nombre: z.string().optional().describe("en la leyenda; admite $…$"),
      tipo: z.enum(["linea", "puntos", "linea_puntos", "barras", "area", "escalon", "banda", "histograma"]).optional().describe("por omisión: línea, o puntos con línea si trae errores. banda: y_inf/y_sup; histograma: valores y bins"),
      x: numeros.optional(), y: numeros.optional(), error_y: errorBarras, error_x: errorBarras,
      limite_superior: z.array(z.boolean()).optional().describe("puntos que son cota superior (flecha hacia abajo)"),
      y_inf: numeros.optional(), y_sup: numeros.optional(),
      valores: numeros.optional(), bins: z.union([z.number().int().positive(), numeros]).optional(), relleno: z.boolean().optional(),
      color: colorP.optional().describe("por omisión, el ciclo de series del tema"),
      estilo_linea: estiloLinea.optional(),
      marcador: z.enum(["circulo", "cuadrado", "triangulo", "rombo", "estrella", "cruz", "mas", "ninguno"]).optional(),
      tamano_marcador: z.number().positive().optional(), grosor: z.number().positive().optional(),
      opacidad: z.number().min(0).max(100).optional(), ancho_barra: z.number().positive().optional(),
      eje: z.enum(["izquierdo", "derecho"]).optional().describe("derecho: usa el segundo eje y (eje_y2)"),
    })).min(1),
    eje_x: ejeCientifico, eje_y: ejeCientifico, eje_y2: ejeCientifico,
    lineas_ref: z.array(z.object({ eje: z.enum(["x", "y"]), valor: z.number(), etiqueta: z.string().optional(), color: colorP.optional(), estilo_linea: estiloLinea.optional() })).optional(),
    anotaciones: z.array(z.object({ x: z.number(), y: z.number(), texto: z.string(), dx: z.number().optional(), dy: z.number().optional(), flecha: z.boolean().optional(), color: colorP.optional(), tamano: z.number().positive().optional() })).optional(),
    leyenda: z.enum(["auto", "ninguna", "arriba_derecha", "arriba_izquierda", "abajo_derecha", "abajo_izquierda"]).optional(),
    rejilla: z.boolean().optional(),
    tamano_texto: z.number().min(8).max(32).optional().describe("pt reales en la diapositiva (14 por omisión)"),
    diapositiva: numero.optional().describe("si se da, dibuja sobre esa diapositiva en vez de crear una de figura"),
    ...caja,
    antetitulo: antetitulo.optional(), titulo: z.string().optional(),
    origen: z.string().optional().describe('diapositiva nueva: pie de origen, p. ej. "Datos: …; gráfica propia"'),
    cuerpo, pie, notas: notasOrador, despues_de,
  },
}, ({ documento, diapositiva, x, y, ancho, alto, antetitulo, titulo, origen, cuerpo, pie, notas, despues_de, ...espec }) => responder(() => {
  if (diapositiva !== undefined) return ci.graficaCientificaEn(documento, diapositiva, espec, { x, y, ancho, alto });
  if (!antetitulo || !titulo) throw new Error("Para una diapositiva nueva hacen falta antetitulo y titulo (o da diapositiva para dibujar sobre una existente)");
  return ci.graficaCientificaFigura(documento, espec, { antetitulo, titulo, origen, cuerpo, pie, notas }, despues_de);
}));

servidor.registerTool("forma", {
  description: "Figura vectorial con la paleta del formato: rectangulo, rectangulo_redondeado, elipse (círculo si ancho = alto), triangulo, triangulo_rectangulo, rombo, poligono (lados), estrella (lados = puntas), bocadillo (cola) (con x, y, ancho, alto) o linea, flecha, flecha_doble (con x1, y1, x2, y2). Relleno, borde, grosor, opacidad 0–100, punteado; texto opcional centrado encima. Por omisión: relleno tarjeta con borde; líneas en el color de acento.",
  inputSchema: {
    documento, diapositiva,
    tipo: z.enum(["rectangulo", "rectangulo_redondeado", "elipse", "triangulo", "triangulo_rectangulo", "rombo", "poligono", "estrella", "bocadillo", "linea", "flecha", "flecha_doble"]),
    x: z.number().optional(), y: z.number().optional(), ancho: z.number().positive().optional(), alto: z.number().positive().optional(),
    x1: z.number().optional(), y1: z.number().optional(), x2: z.number().optional(), y2: z.number().optional(),
    relleno: colorP.optional().describe('o "ninguno"'), borde: colorP.optional().describe('o "ninguno"'),
    grosor: z.number().min(0.25).max(30).optional(), opacidad: z.number().min(0).max(100).optional(),
    punteado: z.boolean().optional(), radio: z.number().min(0).optional(),
    lados: z.number().int().min(3).max(64).optional().describe("polígono: número de lados (6 por omisión); estrella: puntas (5)"),
    cola: z.enum(["abajo", "arriba", "izquierda", "derecha"]).optional().describe("bocadillo: lado de donde sale la cola"),
    texto: z.string().optional(), estilo_texto: z.object(estiloTexto).optional(),
  },
}, ({ documento, diapositiva, ...f }) => responder(() => dib.forma(documento, diapositiva, f)));

servidor.registerTool("estilo_texto", {
  description: "Cambia el estilo de un texto existente (tipo e índice de leer_presentacion con detalle): tipografía de títulos o de texto del tema, tamaño, color, negrita, cursiva; todo el texto o un párrafo.",
  inputSchema: { documento, diapositiva, tipo: z.enum(["texto", "figura"]).default("texto"), indice: z.number().int().min(1), parrafo: z.number().int().min(1).optional(), ...estiloTexto },
}, ({ documento, diapositiva, tipo, indice, ...e }) => responder(() => dib.estiloTexto(documento, diapositiva, tipo, indice, e)));

servidor.registerTool("cifras_destacadas", {
  description: "Fila de 1–4 cifras destacadas tarjeta con borde, cifra grande en la tipografía de títulos y etiqueta pequeña. Color de la cifra: cualquiera del tema (titulo por omisión).",
  inputSchema: { documento, diapositiva, cifras: z.array(z.object({ valor: z.string(), etiqueta: z.string().describe("una o varias líneas"), color: colorP.optional() })).min(1).max(4), ...caja },
}, ({ documento, diapositiva, cifras, ...c }) => responder(() => dib.cifrasDestacadas(documento, diapositiva, cifras, c)));

servidor.registerTool("tarjetas_numeradas", {
  description: "Fila de 2–4 tarjetas del formato (resúmenes, preguntas, mensajes): encabezado corto en la tipografía de títulos y el color de acento (un número, una cifra o una frase) y texto debajo.",
  inputSchema: { documento, diapositiva, tarjetas: z.array(z.object({ encabezado: z.string(), texto: z.string() })).min(2).max(4), ...caja },
}, ({ documento, diapositiva, tarjetas, ...c }) => responder(() => dib.tarjetasNumeradas(documento, diapositiva, tarjetas, c)));

servidor.registerTool("agenda", {
  description: "Agenda en dos columnas: hasta 8 puntos con número en el color de acento, título y descripción. Úsala sobre una diapositiva_tabla.",
  inputSchema: { documento, diapositiva, puntos: z.array(z.object({ numero: z.string().optional(), titulo: z.string(), descripcion: z.string().optional() })).min(1).max(8) },
}, ({ documento, diapositiva, puntos }) => responder(() => dib.agenda(documento, diapositiva, puntos)));

servidor.registerTool("diapositiva_video", {
  description: "Diapositiva de video del mazo v3: antetítulo ANIMACIÓN, video en bucle sobre tarjeta blanca con pie de origen obligatorio, y a la derecha QUÉ OBSERVAR con 2–3 viñetas.",
  inputSchema: {
    documento, titulo: z.string(), video: z.string().describe("ruta del video; solo se lee"),
    origen: z.string(), observar: z.array(z.string()).min(1).max(4),
    antetitulo: z.string().optional(), pie, notas: notasOrador, despues_de,
  },
}, ({ documento, video, despues_de, ...c }) => responder(() => dib.diapositivaVideo(documento, video, c, despues_de)));

servidor.registerTool("editar_celdas", {
  description: "Cambia celdas de una tabla existente (índice de tabla como en leer_presentacion con detalle; fila y columna desde 1). Los valores quedan como texto.",
  inputSchema: { documento, diapositiva, tabla: z.number().int().min(1).default(1), celdas: z.array(z.object({ fila: z.number().int().min(1), columna: z.number().int().min(1), valor: z.string() })).min(1) },
}, ({ documento, diapositiva, tabla, celdas }) => responder(() => v.editarCeldas(documento, diapositiva, tabla, celdas)));

// ---------- edición de conjunto y tablas ----------
const refObjeto = z.object({ tipo: z.enum(["texto", "figura", "imagen", "video", "tabla", "grafica", "linea", "grupo"]), indice: z.number().int().min(1) });

servidor.registerTool("tabla_estructura", {
  description: "Cambia la estructura de una tabla y le reaplica el estilo del formato: fusionar o separar un rango (\"A1:B1\"; al fusionar Keynote une los textos con un tabulador, así que fusiona celdas vacías con una llena), ordenar por una columna (la cabecera queda arriba), agregar filas o columnas al final (conserva el ancho), quitar una fila o columna.",
  inputSchema: {
    documento, diapositiva, tabla: z.number().int().min(1).default(1),
    accion: z.enum(["fusionar", "separar", "ordenar", "agregar_filas", "quitar_fila", "agregar_columnas", "quitar_columna"]),
    rango: z.string().optional(), columna: z.number().int().min(1).optional(), fila: z.number().int().min(1).optional(),
    descendente: z.boolean().optional(), cantidad: z.number().int().min(1).optional(),
  },
}, ({ documento, diapositiva, tabla, accion, ...o }) => responder(() => v.tablaEstructura(documento, diapositiva, tabla, accion, o)));

servidor.registerTool("buscar_reemplazar", {
  description: "Busca texto en toda la presentación (cuadros, figuras, notas y celdas de tablas); con reemplazar, lo cambia. Un texto con formato mixto (p. ej. una palabra en negrita de color) no se reescribe para no perder ese énfasis, salvo con forzar: se reporta aparte. Sin reemplazar solo cuenta y no modifica.",
  inputSchema: {
    documento, buscar: z.string().min(1), reemplazar: z.string().optional(),
    mayusculas: z.boolean().default(false).describe("distinguir mayúsculas"),
    notas: z.boolean().default(true), tablas: z.boolean().default(true), forzar: z.boolean().default(false),
  },
}, ({ documento, buscar, ...o }) => responder(() => ed.buscarReemplazar(documento, buscar, o)));

servidor.registerTool("alinear_objetos", {
  description: "Alinea objetos entre sí (al borde o centro común) o con la diapositiva: izquierda, centro, derecha, arriba, medio, abajo.",
  inputSchema: { documento, diapositiva, objetos: z.array(refObjeto).min(1), modo: z.enum(["izquierda", "centro", "derecha", "arriba", "medio", "abajo"]), respecto: z.enum(["objetos", "diapositiva"]).default("objetos") },
}, ({ documento, diapositiva, objetos, modo, respecto }) => responder(() => ed.alinearObjetos(documento, diapositiva, objetos, modo, respecto)));

servidor.registerTool("distribuir_objetos", {
  description: "Reparte 3 o más objetos con el mismo espacio entre ellos, en horizontal o vertical (el primero y el último no se mueven).",
  inputSchema: { documento, diapositiva, objetos: z.array(refObjeto).min(3), eje: z.enum(["horizontal", "vertical"]) },
}, ({ documento, diapositiva, objetos, eje }) => responder(() => ed.distribuirObjetos(documento, diapositiva, objetos, eje)));

servidor.registerTool("bloquear_objeto", {
  description: "Bloquea (o desbloquea) un objeto para que no se mueva por accidente al editar a mano en Keynote.",
  inputSchema: { documento, diapositiva, ...refObjeto.shape, bloquear: z.boolean().default(true) },
}, ({ documento, diapositiva, tipo, indice, bloquear }) => responder(() => ed.bloquearObjeto(documento, diapositiva, { tipo, indice }, bloquear)));

servidor.registerTool("diapositivas_desde_imagenes", {
  description: "Una diapositiva por imagen. Con el formato cada una es una diapositiva_figura (tarjeta blanca; pie de origen; título del nombre del archivo o de titulos); en otras presentaciones usa el comando de Keynote.",
  inputSchema: {
    documento, imagenes: z.array(z.string()).min(1).describe("rutas; solo se leen"),
    origen: z.string().optional(), titulos: z.array(z.string()).optional(), antetitulo: z.string().optional(), pie, despues_de,
  },
}, ({ documento, imagenes, ...o }) => responder(() => ed.diapositivasDesdeImagenes(documento, imagenes, o)));

// ---------- revisión ----------
servidor.registerTool("revisar_presentacion", {
  description: "Revisa todas las diapositivas visibles y reporta problemas por gravedad: objetos fuera de la diapositiva o sobre el pie, cuerpo que Keynote encoge para que quepa (tamaño efectivo estimado), contraste bajo contra el fondo real, figuras o videos sin pie de origen, textos de muestra sobrantes, letra < 10 pt y diapositivas sin notas. Devuelve también una hoja con todas las diapositivas. Úsala antes de dar una presentación por terminada.",
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
