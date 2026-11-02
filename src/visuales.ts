// Lo visual que Keynote sí expone a scripts — gráficas nativas, tablas con el
// estilo del tema, transiciones (incluido Magic Move), imágenes, video, audio y líneas.
//
// Los nombres de efecto y de tipo de gráfica son constantes de AppleScript: no pueden ir
// como argumento, así que se escriben en el script, solo después de comprobar que están en
// la lista cerrada del diccionario (Keynote.sdef). Los números se validan antes de escribirse.
// Todo texto del usuario sigue viajando por argv.
import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { editable } from "./herramientas.ts";
import { applescript, jxa } from "./keynote.ts";
import { PALETA, SERIES, TEMA, fuentePS } from "./tema.ts";

const PT = 72;
// Área de contenido del formato: bajo el título y sobre el pie (y 1.75–6.95 in).
const AREA = { x: 0.6 * PT, y: 1.85 * PT, ancho: 12.1 * PT, alto: 4.9 * PT };

export const TIPOS_GRAFICA: Record<string, string> = {
  barras: "vertical_bar_2d", barras_apiladas: "stacked_vertical_bar_2d",
  barras_horizontales: "horizontal_bar_2d", barras_horizontales_apiladas: "stacked_horizontal_bar_2d",
  linea: "line_2d", area: "area_2d", area_apilada: "stacked_area_2d", pastel: "pie_2d", dispersion: "scatterplot_2d",
  barras_3d: "vertical_bar_3d", barras_apiladas_3d: "stacked_vertical_bar_3d",
  barras_horizontales_3d: "horizontal_bar_3d", barras_horizontales_apiladas_3d: "stacked_horizontal_bar_3d",
  linea_3d: "line_3d", area_3d: "area_3d", area_apilada_3d: "stacked_area_3d", pastel_3d: "pie_3d",
};

// Enumeración "transition effects" de Keynote.sdef (15.3.1).
export const EFECTOS = ["no transition effect", "magic move", "shimmer", "sparkle", "swing", "object cube", "object flip",
  "object pop", "object push", "object revolve", "object zoom", "perspective", "clothesline", "confetti", "dissolve",
  "drop", "droplet", "fade through color", "grid", "iris", "move in", "push", "reveal", "switch", "wipe", "blinds",
  "color planes", "cube", "doorway", "fall", "flip", "flop", "mosaic", "page flip", "pivot", "reflection",
  "revolving door", "scale", "swap", "swoosh", "twirl", "twist", "fade and move", "radial wipe"] as const;

const numero = (v: number, nombre: string) => {
  if (!Number.isFinite(v)) throw new Error(`${nombre} debe ser un número finito (recibí ${v})`);
  return String(v);
};
// Color de AppleScript: componentes de 16 bits.
const rgb = (hex: string) => `{${[0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) * 257).join(", ")}}`;

export interface Caja { x?: number; y?: number; ancho?: number; alto?: number }

async function colocar(id: string, n: number, coleccion: string, caja: Required<Caja>) {
  await jxa(`
const c = diapositiva(doc(p.id), p.n)[p.coleccion];
const o = c[c().length - 1];
o.width = p.caja.ancho; o.height = p.caja.alto;
o.position = { x: p.caja.x, y: p.caja.y };`, { id, n, coleccion, caja });
}

/**
 * Gráfica nativa. Los colores salen del esquema de la plantilla (las `series` del tema):
 * por script no se pueden asignar, ni se puede activar la leyenda de Keynote, así que Atril
 * escribe una leyenda propia con esos colores.
 * - Barras, línea, área: cada serie es una fila de valores, uno por categoría.
 * - Pastel: una sola serie; cada categoría es una porción.
 * - Dispersión: una lista de x compartida y, por serie, un valor y para cada x. Keynote toma
 *   la primera fila como x de todas las series (comprobado con puntos conocidos),
 *   así que no admite x distintas por serie.
 * Keynote dibuja las etiquetas de los ejes fuera del marco de la gráfica: el marco por omisión
 * deja margen a la izquierda y abajo para que no se corten ni pisen el pie.
 */
export async function grafica(ref: string, n: number, tipo: string, categorias: string[] | undefined, series: { nombre: string; valores: number[] }[], caja: Caja = {}, x?: number[]) {
  const d = await editable(ref);
  const tipoKeynote = TIPOS_GRAFICA[tipo];
  if (!tipoKeynote) throw new Error(`Tipo de gráfica desconocido "${tipo}". Tipos: ${Object.keys(TIPOS_GRAFICA).join(", ")}`);
  if (!series.length) throw new Error("Hace falta al menos una serie");
  const pastel = tipo.startsWith("pastel"), dispersion = tipo === "dispersion";
  let columnas: string[];
  let filasDatos = series;
  if (dispersion) {
    if (!x?.length) throw new Error("La dispersión necesita valores_x (compartidos por todas las series)");
    for (const s of series) {
      if (s.valores.length !== x.length) throw new Error(`La serie "${s.nombre}" tiene ${s.valores.length} valores y hay ${x.length} valores_x`);
    }
    columnas = x.map((_, i) => String(i + 1));
    filasDatos = [{ nombre: "x", valores: x }, ...series];
  } else {
    if (!categorias?.length) throw new Error("Hacen falta categorías");
    if (pastel && series.length !== 1) throw new Error("El pastel lleva una sola serie; cada categoría es una porción");
    for (const s of series) {
      if (s.valores.length !== categorias.length) throw new Error(`La serie "${s.nombre}" tiene ${s.valores.length} valores y hay ${categorias.length} categorías`);
    }
    columnas = categorias;
  }
  // argv: 1 id, 2 diapositiva, luego nombres de series y de columnas.
  const argv = [d.id, String(n), ...filasDatos.map((s) => s.nombre), ...columnas];
  const filas = filasDatos.map((_, i) => `item ${3 + i} of argv`).join(", ");
  const cols = columnas.map((_, j) => `item ${3 + filasDatos.length + j} of argv`).join(", ");
  const datos = filasDatos.map((s) => `{${s.valores.map((v) => numero(v, `valor de "${s.nombre}"`)).join(", ")}}`).join(", ");
  // En el pastel, agrupar por columna hace que las porciones sean las categorías.
  await applescript(`set s to slide ((item 2 of argv) as integer) of document id (item 1 of argv)
add chart s row names {${filas}} column names {${cols}} data {${datos}} type ${tipoKeynote} group by ${pastel ? "chart column" : "chart row"}`, argv);

  const c = pastel
    ? { x: 480 - 160, y: AREA.y + 15, ancho: 320, alto: 320, ...caja }
    : { x: AREA.x + 45, y: AREA.y + 25, ancho: AREA.ancho - 55, alto: 300, ...caja };
  await colocar(d.id, n, "charts", c);

  const nombres = pastel ? categorias! : series.map((s) => s.nombre);
  if (nombres.length > 1) {
    const fuente = fuentePS(TEMA.fuentes.texto);
    await jxa(`
const d = doc(p.id); fueraDeVista(d, p.n);
const s = diapositiva(d, p.n);
const color = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) * 257);
let x = p.x, y = p.y;
p.nombres.forEach((nombre, i) => {
  const t = k.TextItem({ objectText: "■ " + nombre });
  s.textItems.push(t);
  t.objectText.font = p.fuente; t.objectText.size = 12;
  t.objectText.color = color(p.tinta);
  t.objectText.characters[0].color = color(p.colores[i % p.colores.length]);
  t.position = { x, y };
  if (p.vertical) y += 22; else x += t.width() + 18;
});
aLaVista(d, p.n);`, pastel
      ? { id: d.id, n, nombres, colores: SERIES, fuente, tinta: PALETA.texto, vertical: true, x: c.x + c.ancho + 30, y: c.y + 20 }
      : { id: d.id, n, nombres, colores: SERIES, fuente, tinta: PALETA.texto, vertical: false, x: c.x, y: c.y - 26 });
  }
  return { documento: d.nombre, diapositiva: n, tipo, caja_pt: c, leyenda: nombres.length > 1 ? nombres : [] };
}

/**
 * Estilo del formato sobre toda una tabla. Se reaplica tras cambiar su estructura: las celdas
 * que se separan quedan con el estilo por omisión del tema.
 */
async function estiloTabla(id: string, n: number, indice: number, tamano?: number) {
  await applescript(`tell table ((item 3 of argv) as integer) of slide ((item 2 of argv) as integer) of document id (item 1 of argv)
  set rt to cell range
  set background color of rt to ${rgb(PALETA.tarjeta)}
  set text color of rt to ${rgb(PALETA.texto)}
  set font name of rt to (item 4 of argv)
  ${tamano !== undefined ? `set font size of rt to ${numero(tamano, "tamano")}` : ""}
  set alignment of rt to center
  set vertical alignment of rt to center
  set alignment of column 1 to left
  repeat with r from 1 to header row count
    set background color of row r to ${rgb(PALETA.cabecera)}
    set text color of row r to ${rgb(PALETA.titulo)}
    set font name of row r to (item 5 of argv)
  end repeat
end tell`, [id, String(n), String(indice), fuentePS(TEMA.fuentes.texto), fuentePS(TEMA.fuentes.texto, true)]);
}

export type AccionTabla = "fusionar" | "separar" | "ordenar" | "agregar_filas" | "quitar_fila" | "agregar_columnas" | "quitar_columna";

/**
 * Cambia la estructura de una tabla y le reaplica el estilo del formato.
 * - fusionar / separar: un rango como "A1:B1". Al fusionar, Keynote une los textos con un
 *   tabulador: conviene fusionar celdas vacías con una llena (p. ej. una cabecera).
 * - ordenar: por una columna; la cabecera queda arriba.
 * - agregar_filas / agregar_columnas: al final; la tabla conserva su ancho.
 * - quitar_fila / quitar_columna: una en particular.
 */
export async function tablaEstructura(ref: string, n: number, indiceTabla: number, accion: AccionTabla, o: { rango?: string; columna?: number; fila?: number; descendente?: boolean; cantidad?: number } = {}) {
  const d = await editable(ref);
  const dims = await jxa<{ filas: number; columnas: number; ancho: number; encabezado: number } | null>(`
const t = diapositiva(doc(p.id), p.n).tables;
if (!(p.i >= 1 && p.i <= t().length)) return null;
const x = t[p.i - 1];
return { filas: x.rowCount(), columnas: x.columnCount(), ancho: x.width(), encabezado: x.headerRowCount() };`, { id: d.id, n, i: indiceTabla });
  if (!dims) throw new Error(`No hay tabla ${indiceTabla} en la diapositiva ${n}`);
  const rangoValido = (r?: string) => {
    if (!r || !/^[A-Z]+\d+(:[A-Z]+\d+)?$/.test(r)) throw new Error(`Rango no válido "${r ?? ""}": usa algo como "A1:B1"`);
    return r;
  };
  const enRango = (v: number | undefined, max: number, nombre: string) => {
    if (!(Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max)) throw new Error(`${nombre} debe estar entre 1 y ${max}`);
    return v as number;
  };
  let cuerpo: string, argv: string[] = [];
  switch (accion) {
    case "fusionar": cuerpo = `merge range (item 4 of argv)`; argv = [rangoValido(o.rango)]; break;
    case "separar": cuerpo = `unmerge range (item 4 of argv)`; argv = [rangoValido(o.rango)]; break;
    case "ordenar":
      cuerpo = `sort by column ((item 4 of argv) as integer) direction ${o.descendente ? "descending" : "ascending"}`;
      argv = [String(enRango(o.columna, dims.columnas, "columna"))]; break;
    case "agregar_filas": cuerpo = `set row count to ${dims.filas + enRango(o.cantidad ?? 1, 50, "cantidad")}`; break;
    case "agregar_columnas": cuerpo = `set column count to ${dims.columnas + enRango(o.cantidad ?? 1, 20, "cantidad")}`; break;
    case "quitar_fila":
      if (dims.filas === 1) throw new Error("La tabla solo tiene una fila");
      cuerpo = `delete row ((item 4 of argv) as integer)`; argv = [String(enRango(o.fila, dims.filas, "fila"))]; break;
    case "quitar_columna":
      if (dims.columnas === 1) throw new Error("La tabla solo tiene una columna");
      cuerpo = `delete column ((item 4 of argv) as integer)`; argv = [String(enRango(o.columna, dims.columnas, "columna"))]; break;
    default: throw new Error(`Acción desconocida "${accion}"`);
  }
  await jxa(`fueraDeVista(doc(p.id), p.n);`, { id: d.id, n });
  await applescript(`tell table ((item 3 of argv) as integer) of slide ((item 2 of argv) as integer) of document id (item 1 of argv)
${cuerpo}
end tell`, [d.id, String(n), String(indiceTabla), ...argv]);
  // Las columnas nuevas ensanchan la tabla fuera de la diapositiva: se le devuelve su ancho
  // (Keynote reparte las columnas por igual).
  if (accion.endsWith("columnas") || accion === "quitar_columna") {
    await jxa(`diapositiva(doc(p.id), p.n).tables[p.i - 1].width = p.ancho;`, { id: d.id, n, i: indiceTabla, ancho: dims.ancho });
  }
  await estiloTabla(d.id, n, indiceTabla);
  await jxa(`aLaVista(doc(p.id), p.n);`, { id: d.id, n });
  const despues = await jxa<{ filas: number; columnas: number }>(`const x = diapositiva(doc(p.id), p.n).tables[p.i - 1]; return { filas: x.rowCount(), columnas: x.columnCount() };`, { id: d.id, n, i: indiceTabla });
  return { documento: d.nombre, diapositiva: n, tabla: indiceTabla, accion, ...despues };
}

/** Tabla con el estilo del tema: cabecera (color cabecera) con texto de título en negrita; celdas (tarjeta) con texto. */
export async function tabla(ref: string, n: number, filas: string[][], opciones: { encabezado?: boolean; tamano?: number } & Caja = {}) {
  const d = await editable(ref);
  const nf = filas.length, nc = filas[0]?.length ?? 0;
  if (!nf || !nc) throw new Error("La tabla necesita al menos una fila y una columna");
  if (filas.some((f) => f.length !== nc)) throw new Error(`Todas las filas deben tener ${nc} columnas`);
  const encabezado = opciones.encabezado ?? true;
  // 16 pt y filas holgadas: con 14 pt y 2.2× la tabla quedaba chica arriba del área.
  const tamano = opciones.tamano ?? 16;
  const c = { x: opciones.x ?? AREA.x, y: opciones.y ?? AREA.y, ancho: opciones.ancho ?? AREA.ancho, alto: opciones.alto ?? Math.min(AREA.alto, nf * (tamano * 2.8)) };
  // Escribir las celdas con la diapositiva fuera de vista: ver fueraDeVista en keynote.ts.
  await jxa(`fueraDeVista(doc(p.id), p.n);`, { id: d.id, n });
  // argv: 1 id, 2 diapositiva, luego las celdas fila por fila.
  await applescript(`tell slide ((item 2 of argv) as integer) of document id (item 1 of argv)
set t to make new table with properties {row count:${nf}, column count:${nc}, header row count:${encabezado ? 1 : 0}, header column count:0, footer row count:0}
tell t
  -- Formato de texto antes de los valores: si no, "+0.31" pierde el signo y "−0.02" cambia de guion.
  set format of cell range to text
  repeat with r from 1 to ${nf}
    repeat with k from 1 to ${nc}
      set value of cell k of row r to item (2 + (r - 1) * ${nc} + k) of argv
    end repeat
  end repeat
end tell
end tell`, [d.id, String(n), ...filas.flat()]);
  const indice = Number(await applescript(`tell slide ((item 2 of argv) as integer) of document id (item 1 of argv) to return count of tables`, [d.id, String(n)]));
  await estiloTabla(d.id, n, indice, tamano);
  await colocar(d.id, n, "tables", c);
  await jxa(`aLaVista(doc(p.id), p.n);`, { id: d.id, n });
  return { documento: d.nombre, diapositiva: n, filas: nf, columnas: nc, caja_pt: c };
}

/** Cambia celdas de una tabla existente (fila y columna desde 1; los valores quedan como texto). */
export async function editarCeldas(ref: string, n: number, indiceTabla: number, celdas: { fila: number; columna: number; valor: string }[]) {
  const d = await editable(ref);
  if (!celdas.length) throw new Error("Hace falta al menos una celda");
  const dims = await jxa<{ filas: number; columnas: number } | null>(`
const t = diapositiva(doc(p.id), p.n).tables;
if (!(p.i >= 1 && p.i <= t().length)) return null;
return { filas: t[p.i - 1].rowCount(), columnas: t[p.i - 1].columnCount() };`, { id: d.id, n, i: indiceTabla });
  if (!dims) throw new Error(`No hay tabla ${indiceTabla} en la diapositiva ${n}`);
  for (const c of celdas) {
    if (!(c.fila >= 1 && c.fila <= dims.filas && c.columna >= 1 && c.columna <= dims.columnas)) throw new Error(`La celda (${c.fila}, ${c.columna}) no existe: la tabla es de ${dims.filas}×${dims.columnas}`);
  }
  await jxa(`fueraDeVista(doc(p.id), p.n);`, { id: d.id, n });
  // argv: 1 id, 2 diapositiva, 3 tabla, luego tríos fila, columna, valor.
  await applescript(`tell table ((item 3 of argv) as integer) of slide ((item 2 of argv) as integer) of document id (item 1 of argv)
repeat with i from 4 to (count of argv) by 3
  set c to cell ((item (i + 1) of argv) as integer) of row ((item i of argv) as integer)
  set format of c to text
  set value of c to item (i + 2) of argv
end repeat
end tell`, [d.id, String(n), String(indiceTabla), ...celdas.flatMap((c) => [String(c.fila), String(c.columna), c.valor])]);
  await jxa(`aLaVista(doc(p.id), p.n);`, { id: d.id, n });
  return { documento: d.nombre, diapositiva: n, tabla: indiceTabla, cambiadas: celdas.length };
}

/** Transición al salir de la diapositiva n hacia la siguiente. */
export async function transicion(ref: string, n: number, efecto: string, duracion = 1, retraso = 0, automatica = false) {
  const d = await editable(ref);
  if (!(EFECTOS as readonly string[]).includes(efecto)) throw new Error(`Efecto desconocido "${efecto}". Efectos: ${EFECTOS.join(", ")}`);
  const leido = await applescript(`tell slide ((item 2 of argv) as integer) of document id (item 1 of argv)
set transition properties to {transition effect:${efecto}, transition duration:${numero(duracion, "duracion")}, transition delay:${numero(retraso, "retraso")}, automatic transition:${automatica}}
return transition properties
end tell`, [d.id, String(n)]);
  return { documento: d.nombre, diapositiva: n, transicion: leido };
}

const IMAGEN = [".png", ".jpg", ".jpeg", ".gif", ".tif", ".tiff", ".heic", ".pdf", ".svg"];
const VIDEO = [".mp4", ".mov", ".m4v"];
const AUDIO = [".mp3", ".m4a", ".aif", ".aiff", ".wav"];

/**
 * Inserta una imagen, un video o un audio. `make new movie`/`make new audio clip` no aceptan
 * el archivo (-1700), pero `make new image` con un video o un audio crea el objeto correcto
 *. Sin ancho, Keynote usa el tamaño natural; el alto sigue la proporción.
 */
export async function insertarMedio(ref: string, n: number, archivo: string, opciones: { x?: number; y?: number; ancho?: number; repetir?: "none" | "loop" | "loop back and forth"; volumen?: number } = {}) {
  const d = await editable(ref);
  const ruta = resolve(archivo.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
  if (!existsSync(ruta)) throw new Error(`No existe ${ruta}`);
  const ext = extname(ruta).toLowerCase();
  const tipo = IMAGEN.includes(ext) ? "image" : VIDEO.includes(ext) ? "movie" : AUDIO.includes(ext) ? "audio clip" : null;
  if (!tipo) throw new Error(`Formato no soportado: ${ext}. Imagen: ${IMAGEN.join(" ")}; video: ${VIDEO.join(" ")}; audio: ${AUDIO.join(" ")}`);
  const ajustes: string[] = [];
  if (opciones.x !== undefined || opciones.y !== undefined) ajustes.push(`set position of o to {${numero(opciones.x ?? AREA.x, "x")}, ${numero(opciones.y ?? AREA.y, "y")}}`);
  if (opciones.ancho !== undefined && tipo !== "audio clip") ajustes.push(`set width of o to ${numero(opciones.ancho, "ancho")}`);
  if (tipo !== "image" && opciones.repetir) ajustes.push(`set repetition method of o to ${{ none: "none", loop: "loop", "loop back and forth": "loop back and forth" }[opciones.repetir]}`);
  if (tipo !== "image" && opciones.volumen !== undefined) ajustes.push(`set ${tipo === "movie" ? "movie volume" : "clip volume"} of o to ${numero(Math.round(opciones.volumen), "volumen")}`);
  const plural = { image: "images", movie: "movies", "audio clip": "audio clips" }[tipo];
  const r = await applescript(`tell slide ((item 2 of argv) as integer) of document id (item 1 of argv)
set antes to count of ${plural}
make new image with properties {file:(POSIX file (item 3 of argv))}
if (count of ${plural}) is not (antes + 1) then error "Keynote no creó el ${tipo} esperado"
set o to last ${tipo}
${ajustes.join("\n")}
${tipo === "audio clip" ? 'return {"audio"}' : "return {position of o, width of o, height of o}"}
end tell`, [d.id, String(n), ruta]);
  return { documento: d.nombre, diapositiva: n, tipo: { image: "imagen", movie: "video", "audio clip": "audio" }[tipo], archivo: ruta, geometria: r };
}

/** Línea recta (el color y el grosor no se pueden fijar por script). */
export async function linea(ref: string, n: number, x1: number, y1: number, x2: number, y2: number) {
  const d = await editable(ref);
  const r = await applescript(`tell slide ((item 2 of argv) as integer) of document id (item 1 of argv)
set l to make new line with properties {start point:{${numero(x1, "x1")}, ${numero(y1, "y1")}}, end point:{${numero(x2, "x2")}, ${numero(y2, "y2")}}}
return {start point of l, end point of l}
end tell`, [d.id, String(n)]);
  return { documento: d.nombre, diapositiva: n, puntos: r };
}

/** Duplica una diapositiva (para Magic Move: se duplica y se mueven objetos en la copia). */
export async function duplicarDiapositiva(ref: string, n: number) {
  const d = await editable(ref);
  await applescript(`set d to document id (item 1 of argv)
duplicate slide ((item 2 of argv) as integer) of d to end of slides of d
move last slide of d to after slide ((item 2 of argv) as integer) of d`, [d.id, String(n)]);
  return { documento: d.nombre, original: n, copia: n + 1 };
}

/** Mueve y/o redimensiona un objeto (índice por tipo, como en leer_presentacion con detalle). */
export async function moverObjeto(ref: string, n: number, tipo: string, indice: number, caja: Caja & { rotacion?: number }) {
  const d = await editable(ref);
  const colecciones: Record<string, string> = { texto: "textItems", figura: "shapes", imagen: "images", video: "movies", tabla: "tables", grafica: "charts", linea: "lines", grupo: "groups" };
  const col = colecciones[tipo];
  if (!col) throw new Error(`Tipo desconocido "${tipo}". Tipos: ${Object.keys(colecciones).join(", ")}`);
  return jxa(`
const c = diapositiva(doc(p.id), p.n)[p.col];
const m = c().length;
if (!(p.indice >= 1 && p.indice <= m)) throw new Error("No hay " + p.tipo + " " + p.indice + " en la diapositiva " + p.n + " (hay " + m + ")");
const o = c[p.indice - 1];
if (p.caja.ancho != null) o.width = p.caja.ancho;
if (p.caja.alto != null) o.height = p.caja.alto;
if (p.caja.x != null || p.caja.y != null) { const q = o.position(); o.position = { x: p.caja.x ?? q.x, y: p.caja.y ?? q.y }; }
if (p.caja.rotacion != null) o.rotation = Math.round(((p.caja.rotacion % 360) + 360) % 360);
const q = o.position();
return { x: q.x, y: q.y, ancho: o.width(), alto: o.height(), rotacion: intento(() => o.rotation(), 0) };`, { id: d.id, n, col, tipo, indice, caja });
}
