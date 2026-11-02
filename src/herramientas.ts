// Herramientas del núcleo: crear, leer, editar texto, exportar y ver.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { BUNDLE, applescript, jxa } from "./keynote.ts";
import { COPIAS, SALIDAS, VISTAS, copiaDeTrabajo, dentroDeTrabajo, rutaLibre } from "./trabajo.ts";

const ejecutar = promisify(execFile);

export interface InfoDocumento {
  id: string;
  nombre: string;
  archivo: string | null;
  modificado: boolean;
  diapositivas: number;
  tema: string | null;
  ancho: number;
  alto: number;
  editable: boolean;
}

const INFO_JXA = `
const info = (d) => {
  const f = intento(() => { const x = d.file(); return x ? x.toString() : null; });
  return { id: d.id(), nombre: d.name(), archivo: f, modificado: d.modified(),
           diapositivas: d.slides.length, tema: intento(() => d.documentTheme.name()),
           ancho: d.width(), alto: d.height() };
};`;

// Un documento sin archivo puede ser uno nuevo del usuario: no es editable.
// Por eso crear() guarda de inmediato dentro de la carpeta de trabajo.
function conEditable(i: Omit<InfoDocumento, "editable">): InfoDocumento {
  return { ...i, editable: i.archivo !== null && dentroDeTrabajo(i.archivo) };
}

export async function listarPresentaciones(): Promise<InfoDocumento[]> {
  const docs = await jxa<Omit<InfoDocumento, "editable">[]>(`${INFO_JXA}
return k.documents().map(info);`);
  return docs.map(conEditable);
}

/** Resuelve un documento por id o por nombre exacto. */
export async function documento(ref: string): Promise<InfoDocumento> {
  const docs = await listarPresentaciones();
  const porId = docs.find((d) => d.id === ref);
  if (porId) return porId;
  const porNombre = docs.filter((d) => d.nombre === ref);
  if (porNombre.length === 1) return porNombre[0];
  const abiertas = docs.map((d) => `"${d.nombre}" (${d.id})`).join(", ") || "ninguna";
  if (porNombre.length > 1) throw new Error(`Hay ${porNombre.length} presentaciones llamadas "${ref}"; usa el id. Abiertas: ${abiertas}`);
  throw new Error(`No hay una presentación abierta con id o nombre "${ref}". Abiertas: ${abiertas}`);
}

export async function editable(ref: string): Promise<InfoDocumento> {
  const d = await documento(ref);
  if (!d.editable) {
    throw new Error(`"${d.nombre}" es un archivo del usuario (${d.archivo}); Atril no lo modifica. ` +
      `Ábrelo con la herramienta abrir, que trabaja sobre una copia.`);
  }
  return d;
}

export async function abrir(ruta: string) {
  const original = resolve(ruta.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
  const ext = extname(original).toLowerCase();
  if (![".key", ".pptx", ".ppt"].includes(ext)) throw new Error(`Formato no soportado: ${ext || "(sin extensión)"}. Usa .key, .pptx o .ppt`);
  const copia = await copiaDeTrabajo(original);
  let info = await abrirPorLaunchServices(copia);
  if (info.archivo === null) {
    // Un PowerPoint importado queda sin archivo: se guarda ya como .key junto a la copia,
    // por la misma razón que en crear() (borradores en iCloud).
    const destino = rutaLibre(copia.replace(/\.pptx?$/i, ".key"));
    await applescript(`save document id (item 1 of argv) in my archivo(item 2 of argv)`, [info.id, destino]);
    info = (await documento(info.id));
  }
  return { original, copia, ...conEditable(info) };
}

const ESPERA_ABRIR_MS = 120_000;

/**
 * Abre con `open -g -b` en vez del comando `open` de AppleScript. Desde un script,
 * el sandbox de Keynote solo importa un .pptx que ya abrió antes por Launch Services;
 * con uno nuevo muestra "can't be imported" y el script se cuelga. Además, si Keynote está cerrado, así arranca con el documento
 * y sin el panel Abrir.
 */
async function abrirPorLaunchServices(archivo: string): Promise<Omit<InfoDocumento, "editable">> {
  const corriendo = (await ejecutar("pgrep", ["-x", "Keynote"]).then(() => true, () => false));
  const antes = new Set(corriendo ? (await listarPresentaciones()).map((d) => d.id) : []);
  const nombre = basename(archivo, extname(archivo));
  await ejecutar("open", ["-g", "-b", BUNDLE, archivo]);
  const limite = Date.now() + ESPERA_ABRIR_MS;
  while (Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 500));
    const docs = await listarPresentaciones().catch(() => []); // Keynote puede estar arrancando
    const ya = docs.find((d) => d.archivo === archivo);
    if (ya) return ya;
    const nuevo = docs.find((d) => !antes.has(d.id) && d.nombre === nombre);
    if (nuevo) return nuevo;
  }
  throw new Error(`Keynote no abrió ${archivo} en ${ESPERA_ABRIR_MS / 1000} s. ` +
    `Puede haber un aviso en pantalla (p. ej. "can't be imported") que hay que cerrar con OK.`);
}

/**
 * Crea y guarda de inmediato en COPIAS. Sin archivo, Keynote autoguarda el
 * documento como borrador "Untitled N.key" en iCloud al exportarlo, y cerrarlo
 * sin guardar no borra ese borrador.
 */
export async function crear(tema: string, ancho: number, alto: number, nombre?: string) {
  const temas = await jxa<string[]>(`return k.themes.name();`);
  if (!temas.includes(tema)) throw new Error(`No existe el tema "${tema}". Temas: ${temas.join(", ")}`);
  const base = (nombre ?? `atril_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}`)
    .replace(/\.key$/i, "").replace(/[/:]/g, "_");
  const destino = rutaLibre(join(COPIAS, `${base}.key`));
  await mkdir(COPIAS, { recursive: true });
  const id = await applescript(
    `set d to make new document with properties {document theme:theme (item 1 of argv), width:(item 2 of argv) as integer, height:(item 3 of argv) as integer}
save d in my archivo(item 4 of argv)
return id of d`, [tema, String(ancho), String(alto), destino]);
  return documento(id);
}

interface Objeto { tipo: string; indice: number; texto?: string; archivo?: string; celdas?: string[][]; x: number; y: number; ancho: number; alto: number }
interface Diapositiva {
  n: number; diseno: string | null; saltada: boolean;
  titulo: string | null; cuerpo: string | null; notas: string;
  conteo: Record<string, number>; textos?: string[]; objetos?: Objeto[];
  transicion: { efecto: string; duracion: number; retraso: number; automatica: boolean } | null;
}

export async function leerPresentacion(ref: string, desde?: number, hasta?: number, detalle = false) {
  const d = await documento(ref);
  const diapositivas = await jxa<Diapositiva[]>(`
const d = doc(p.id);
const total = d.slides.length;
const a = Math.max(1, p.desde || 1), b = Math.min(total, p.hasta || total);
// iWorkItems falla con -1700 en algunas diapositivas importadas: se lee por clase.
const clases = [["texto", "textItems", true], ["figura", "shapes", true], ["imagen", "images", false],
  ["video", "movies", false], ["audio", "audioClips", false], ["tabla", "tables", false],
  ["grafica", "charts", false], ["linea", "lines", false], ["grupo", "groups", false]];
const out = [];
for (let i = a; i <= b; i++) {
  const s = d.slides[i - 1];
  const r = { n: i, diseno: intento(() => s.baseLayout.name()), saltada: s.skipped(),
    titulo: s.titleShowing() ? intento(() => s.defaultTitleItem.objectText()) : null,
    cuerpo: s.bodyShowing() ? intento(() => s.defaultBodyItem.objectText()) : null,
    notas: intento(() => s.presenterNotes(), ""), conteo: {},
    transicion: intento(() => { const t = s.transitionProperties();
      return t.transitionEffect === "no transition effect" ? null
        : { efecto: t.transitionEffect, duracion: t.transitionDuration, retraso: t.transitionDelay, automatica: t.automaticTransition }; }) };
  if (p.detalle) r.objetos = []; else r.textos = [];
  for (const [tipo, col, conTexto] of clases) {
    const c = s[col];
    const m = intento(() => c().length, 0);
    if (!m) continue;
    r.conteo[tipo] = m;
    const textos = conTexto ? intento(() => c.objectText(), []) : [];
    if (!p.detalle) { for (const t of textos) if (t) r.textos.push(t); continue; }
    const pos = intento(() => c.position(), []), an = intento(() => c.width(), []), al = intento(() => c.height(), []);
    const archivos = (tipo === "imagen" || tipo === "video" || tipo === "audio") ? intento(() => c.fileName(), []) : [];
    for (let j = 0; j < m; j++) {
      const o = { tipo, indice: j + 1, x: pos[j] ? pos[j].x : null, y: pos[j] ? pos[j].y : null, ancho: an[j], alto: al[j] };
      if (conTexto) o.texto = textos[j];
      if (archivos[j]) o.archivo = archivos[j];
      if (tipo === "tabla") {
        const t = c[j], nc = intento(() => t.columnCount(), 0), v = intento(() => t.cellRange.cells.formattedValue(), []);
        o.celdas = [];
        for (let f = 0; f * nc < v.length && nc; f++) o.celdas.push(v.slice(f * nc, f * nc + nc).map((x) => x == null ? "" : String(x)));
      }
      r.objetos.push(o);
    }
  }
  out.push(r);
}
return out;`, { id: d.id, desde, hasta, detalle });
  return { documento: d, diapositivas };
}

export async function agregarDiapositiva(ref: string, diseno?: string, despuesDe?: number) {
  const d = await editable(ref);
  const disenos = await jxa<string[]>(`return doc(p.id).slideLayouts.name();`, { id: d.id });
  if (diseno && !disenos.includes(diseno)) throw new Error(`No existe el diseño "${diseno}". Diseños de esta presentación: ${disenos.join(", ")}`);
  if (despuesDe !== undefined && !(despuesDe >= 0 && despuesDe <= d.diapositivas)) {
    throw new Error(`despues_de debe estar entre 0 y ${d.diapositivas}`);
  }
  const n = await applescript(`set d to document id (item 1 of argv)
if (item 2 of argv) is "" then
  set s to make new slide at end of slides of d
else
  set s to make new slide at end of slides of d with properties {base layout:slide layout (item 2 of argv) of d}
end if
if (item 3 of argv) is not "" then
  set pos to (item 3 of argv) as integer
  if pos is 0 then
    move s to before slide 1 of d
  else if pos < ((count of slides of d) - 1) then
    move s to after slide pos of d
  end if
end if
return slide number of s`, [d.id, diseno ?? "", despuesDe === undefined ? "" : String(despuesDe)]);
  return { documento: d.nombre, diapositiva: Number(n), disenos_disponibles: disenos };
}

export interface CuadroNuevo { texto: string; x: number; y: number; ancho?: number; alto?: number }
export interface Reemplazo { tipo: "texto" | "figura"; indice: number; texto: string }

export async function ponerTexto(ref: string, n: number, cambios: {
  titulo?: string; cuerpo?: string; reemplazar?: Reemplazo[]; nuevo_cuadro?: CuadroNuevo;
}) {
  const d = await editable(ref);
  return jxa<{ titulo: string | null; cuerpo: string | null; textos: string[] }>(`
const d = doc(p.id);
const s = diapositiva(d, p.n);
fueraDeVista(d, p.n);
if (p.titulo != null) {
  s.titleShowing = true;
  s.defaultTitleItem.objectText = p.titulo;
}
if (p.cuerpo != null) {
  s.bodyShowing = true;
  s.defaultBodyItem.objectText = p.cuerpo;
}
for (const r of (p.reemplazar || [])) {
  const c = r.tipo === "figura" ? s.shapes : s.textItems;
  const m = c().length;
  if (!(r.indice >= 1 && r.indice <= m)) throw new Error("No hay " + r.tipo + " " + r.indice + " en la diapositiva " + p.n + " (hay " + m + ")");
  c[r.indice - 1].objectText = r.texto;
}
if (p.nuevo) {
  // Tras push, t apunta al objeto creado. No usar "el último de textItems":
  // ese puede ser el marcador del cuerpo (se llegó a encoger el cuerpo por error).
  const t = k.TextItem({ objectText: p.nuevo.texto });
  s.textItems.push(t);
  // Tamaño antes que posición: Keynote ajusta el alto al texto y recentra el cuadro.
  if (p.nuevo.ancho) t.width = p.nuevo.ancho;
  if (p.nuevo.alto) t.height = p.nuevo.alto;
  t.position = { x: p.nuevo.x, y: p.nuevo.y };
}
aLaVista(d, p.n);
return { titulo: s.titleShowing() ? s.defaultTitleItem.objectText() : null,
         cuerpo: s.bodyShowing() ? s.defaultBodyItem.objectText() : null,
         textos: s.textItems.objectText() };`, { id: d.id, n, ...cambios, nuevo: cambios.nuevo_cuadro });
}

export async function notas(ref: string, n: number, texto?: string) {
  const d = texto === undefined ? await documento(ref) : await editable(ref);
  const actual = await jxa<string>(`
const d = doc(p.id);
const s = diapositiva(d, p.n);
if (p.texto != null) { fueraDeVista(d, p.n); s.presenterNotes = p.texto; aLaVista(d, p.n); }
return s.presenterNotes();`, { id: d.id, n, texto });
  return { documento: d.nombre, diapositiva: n, notas: actual };
}

const EXT: Record<string, string> = { pdf: ".pdf", pptx: ".pptx", png: "", jpeg: "", video: ".m4v", html: "", keynote09: ".key", gif: ".gif" };

export async function exportar(ref: string, formato: "pdf" | "pptx" | "png" | "jpeg" | "video" | "html" | "keynote09" | "gif", destino?: string, etapas = false, conNotas = false) {
  if (conNotas && formato !== "pdf") throw new Error("con_notas solo aplica a PDF");
  const d = await documento(ref);
  const base = d.nombre.replace(/\.(key|pptx?)$/i, "");
  const objetivo = rutaLibre(resolve(destino ?? join(SALIDAS, base + (formato === "keynote09" ? "_keynote09" : "") + EXT[formato] + (EXT[formato] ? "" : `_${formato}`))));
  await mkdir(dirname(objetivo), { recursive: true });
  if (formato === "gif") return exportarGif(d, objetivo);
  // Con notas se exporta desde una copia temporal con las notas en tinta oscura: un tema oscuro las
  // deja en tinta clara, legible en la vista del presentador (oscura) pero casi
  // invisible sobre el papel blanco del PDF. La presentación original no se toca.
  let origen = d.id, temporal: string | null = null, aviso: string | undefined;
  if (conNotas) {
    if (!d.archivo) throw new Error(`"${d.nombre}" no tiene archivo: guárdala antes de exportarla con notas`);
    if (d.modificado) {
      if (d.editable) await guardar(d.id);
      else aviso = "La presentación tiene cambios sin guardar: el PDF usa la última versión guardada";
    }
    temporal = join(COPIAS, `.notas_${Date.now()}${extname(d.archivo)}`);
    await cp(d.archivo, temporal, { recursive: true });
    origen = (await abrirPorLaunchServices(temporal)).id;
    await jxa(`doc(p.id).slides().forEach((s) => { if (s.presenterNotes()) s.presenterNotes.color = [0x1414, 0x1414, 0x2020]; });`, { id: origen });
  }
  try {
  await applescript(`set d to document id (item 1 of argv)
set f to item 2 of argv
set destino to my archivo(item 3 of argv)
if f is "pdf" then
  if (item 5 of argv) is "si" then
    -- Diapositiva arriba y notas del presentador debajo, una por página.
    export d to destino as PDF with properties {all stages:((item 4 of argv) is "si"), export style:SlideWithNotes}
  else
    export d to destino as PDF with properties {all stages:((item 4 of argv) is "si")}
  end if
else if f is "pptx" then
  export d to destino as Microsoft PowerPoint
else if f is "png" then
  export d to destino as slide images with properties {image format:PNG, all stages:((item 4 of argv) is "si")}
else if f is "jpeg" then
  export d to destino as slide images with properties {image format:JPEG, compression factor:0.9, all stages:((item 4 of argv) is "si")}
else if f is "html" then
  export d to destino as HTML
else if f is "keynote09" then
  export d to destino as Keynote 09
else if f is "video" then
  -- Video autoreproducible con los tiempos por omisión de Keynote; incluye transiciones.
  export d to destino as QuickTime movie with properties {movie format:format1080p}
end if`, [origen, formato, objetivo, etapas ? "si" : "no", conNotas ? "si" : "no"]);
  } finally {
    if (temporal) {
      await applescript(`close document id (item 1 of argv) saving no`, [origen]).catch(() => undefined);
      await rm(temporal, { recursive: true, force: true });
    }
  }
  if (!existsSync(objetivo)) throw new Error(`Keynote no reportó error pero no existe ${objetivo}`);
  const archivos = formato === "png" || formato === "jpeg" || formato === "html" ? (await readdir(objetivo)).sort() : undefined;
  return { documento: d.nombre, formato, destino: objetivo, archivos, ...(aviso ? { aviso } : {}) };
}

/**
 * GIF animado: Keynote no lo exporta por script (no está en el diccionario), así que se exporta
 * a video y se convierte con ffmpeg (paleta propia, 10 fps, 960 px de ancho).
 */
async function exportarGif(d: InfoDocumento, objetivo: string) {
  const ffmpeg = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((r) => existsSync(r));
  if (!ffmpeg) throw new Error("Para exportar a GIF hace falta ffmpeg (brew install ffmpeg)");
  const video = objetivo.replace(/\.gif$/i, `_tmp_${Date.now()}.m4v`);
  await applescript(`export document id (item 1 of argv) to my archivo(item 2 of argv) as QuickTime movie with properties {movie format:format720p}`, [d.id, video]);
  try {
    await ejecutar(ffmpeg, ["-loglevel", "error", "-y", "-i", video, "-vf",
      "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=sierra2_4a", objetivo], { timeout: 600_000 });
  } finally {
    await rm(video, { force: true });
  }
  if (!existsSync(objetivo)) throw new Error(`ffmpeg no produjo ${objetivo}`);
  return { documento: d.nombre, formato: "gif", destino: objetivo };
}

/** Exporta todas las diapositivas a PNG y devuelve la n-ésima, reducida a `anchoMax`. */
export async function verDiapositiva(ref: string, n: number, anchoMax = 1600) {
  const d = await documento(ref);
  if (!(n >= 1 && n <= d.diapositivas)) throw new Error(`La diapositiva ${n} no existe; la presentación tiene ${d.diapositivas}`);
  // Keynote no exporta las diapositivas ocultas aunque se pida "skipped slides": la n-ésima
  // diapositiva es la imagen número (visibles hasta n). Pasa con los prototipos.
  const saltadas = await jxa<boolean[]>(`return doc(p.id).slides.skipped();`, { id: d.id });
  if (saltadas[n - 1]) throw new Error(`La diapositiva ${n} está oculta (saltada) y Keynote no la exporta`);
  const posicion = saltadas.slice(0, n).filter((x) => !x).length;
  const visibles = saltadas.filter((x) => !x).length;
  await mkdir(VISTAS, { recursive: true });
  const tmp = join(VISTAS, `tmp_${d.id}_${Date.now()}`);
  await applescript(`export document id (item 1 of argv) to my archivo(item 2 of argv) as slide images with properties {image format:PNG}`, [d.id, tmp]);
  try {
    const pngs = (await readdir(tmp)).filter((f) => f.endsWith(".png")).sort();
    if (pngs.length !== visibles) throw new Error(`Se esperaban ${visibles} imágenes y Keynote exportó ${pngs.length}`);
    const nombre = basename(d.nombre, extname(d.nombre)).replace(/[^\p{L}\p{N}_-]+/gu, "_");
    const final = join(VISTAS, `${nombre}_d${String(n).padStart(3, "0")}.png`);
    await rm(final, { force: true });
    await rename(join(tmp, pngs[posicion - 1]), final);
    const { stdout } = await ejecutar("sips", ["-g", "pixelWidth", final]);
    const ancho = Number(stdout.match(/pixelWidth: (\d+)/)?.[1]);
    if (ancho > anchoMax) await ejecutar("sips", ["--resampleWidth", String(anchoMax), final]);
    return { ruta: final, png: await readFile(final), documento: d.nombre, diapositiva: n };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export async function guardar(ref: string, nombre?: string) {
  const d = await editable(ref);
  const esKeyPropio = d.archivo !== null && d.archivo.toLowerCase().endsWith(".key") && dentroDeTrabajo(d.archivo);
  if (esKeyPropio && !nombre) {
    await applescript(`save document id (item 1 of argv)`, [d.id]);
    return { documento: d.nombre, archivo: d.archivo };
  }
  const base = (nombre ?? d.nombre).replace(/\.(key|pptx?)$/i, "").replace(/[/:]/g, "_");
  const destino = rutaLibre(join(COPIAS, `${base}.key`));
  await mkdir(COPIAS, { recursive: true });
  await applescript(`save document id (item 1 of argv) in my archivo(item 2 of argv)`, [d.id, destino]);
  return { documento: d.nombre, archivo: destino };
}

export async function cerrar(ref: string, conGuardar = false) {
  const d = await editable(ref);
  const guardado = conGuardar ? await guardar(d.id) : null;
  await applescript(`close document id (item 1 of argv) saving no`, [d.id]);
  return { cerrado: d.nombre, guardado: guardado?.archivo ?? null, cambios_descartados: !conGuardar && d.modificado };
}
