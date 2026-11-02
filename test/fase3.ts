// Prueba 3: una presentación con una gráfica de cada tipo,
// una tabla y tres transiciones (disolver, Magic Move, cubo), exportada a video; con ffmpeg
// se ubican los cambios de escena y se extraen fotogramas de cada transición.
//
//   node test/fase3.ts
//
// Deja trabajo/evidencia/fase3/: hoja_graficas.png, tabla.png, transiciones.png, prueba_fase3.m4v.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAPOSITIVAS_PPTX, recursos } from "./recursos.ts";

const R = await recursos();

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TRABAJO = join(RAIZ, "trabajo", "prueba_fase3");
const SALIDA = join(RAIZ, "trabajo", "evidencia", "fase3");
const FFMPEG = "/opt/homebrew/bin/ffmpeg";
const FIGURA = R.figura;
const VIDEO = R.video;
const ICLOUD = join(homedir(), "Library/Mobile Documents/com~apple~Keynote/Documents");

let fallos = 0;
function revisar(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK  " : "FALLA"} ${nombre}${detalle ? " — " + detalle : ""}`);
}
rmSync(TRABAJO, { recursive: true, force: true });
rmSync(SALIDA, { recursive: true, force: true });
mkdirSync(SALIDA, { recursive: true });
const icloudAntes = existsSync(ICLOUD) ? readdirSync(ICLOUD).sort().join("|") : "";

const cliente = new Client({ name: "verificar-fase3", version: "0" });
await cliente.connect(new StdioClientTransport({
  command: process.execPath, args: [join(RAIZ, "src/index.ts")],
  env: { ...process.env, ATRIL_DIR: TRABAJO } as Record<string, string>,
}));
async function llamar(nombre: string, args: Record<string, unknown> = {}) {
  // Exportar a video tarda: el límite del cliente (60 s por omisión) no alcanza.
  const r = await cliente.callTool({ name: nombre, arguments: args }, undefined, { timeout: 600_000 });
  const contenido = r.content as { type: string; text?: string; data?: string }[];
  const texto = contenido.find((c) => c.type === "text")?.text ?? "";
  let datos: any = null;
  try { datos = JSON.parse(texto); } catch { /* texto libre */ }
  return { error: r.isError === true, texto, datos, contenido };
}

const p = await llamar("crear_con_formato", { nombre: "prueba_fase3" });
const id = p.datos.id;
await llamar("diapositiva_portada", { documento: id, antetitulo: "Atril · Fase 3", titulo: "Gráficas, tablas\ny transiciones", subtitulo: "Prueba de verificación" });

// --- 1. Una gráfica de cada tipo ---
const tipos = (await cliente.listTools()).tools.find((t) => t.name === "grafica")!.inputSchema.properties!.tipo as { enum: string[] };
const categorias = ["z < 1.5", "1.5–2.5", "> 2.5"];
const series = [
  { nombre: "Campo A", valores: [0.12, 0.31, 0.22] },
  { nombre: "Campo B", valores: [0.08, 0.25, 0.30] },
  { nombre: "Campo C", valores: [0.35, 0.62, 0.90] },
];
const diapositivasGraficas: number[] = [];
for (const tipo of tipos.enum) {
  const s = await llamar("diapositiva_tabla", { documento: id, antetitulo: "Gráfica nativa", titulo: tipo, pie: "Fase 3 · Gráficas" });
  const datos = tipo.startsWith("pastel")
    ? { categorias, series: [{ nombre: "Campo A", valores: [12, 31, 22] }] }
    : tipo === "dispersion"
      ? { valores_x: [0.1, 0.3, 0.6], series: [{ nombre: "Campo A", valores: [0.2, 0.5, 0.4] }, { nombre: "Campo B", valores: [0.1, 0.3, 0.7] }] }
      : { categorias, series };
  const g = await llamar("grafica", { documento: id, diapositiva: s.datos.diapositiva, tipo, ...datos });
  diapositivasGraficas.push(s.datos.diapositiva);
  revisar(`grafica ${tipo}`, !g.error, g.error ? g.texto : "");
}
revisar("17 tipos de gráfica", tipos.enum.length === 17, `${tipos.enum.length}`);

// --- 2. Tabla ---
const st = await llamar("diapositiva_tabla", { documento: id, antetitulo: "Resultados", titulo: "Sobredensidad media por caso", pie: "Fase 3 · Tabla" });
const nTabla = st.datos.diapositiva;
const filas = [["Caso", "δ2D", "δ3D", "Conclusión"],
  ["Campo A vs. Campo C", "+0.05 ± 0.12", "+0.21", "compatible"],
  ["Simulación vs. Campo C", "+0.31", "+0.90", "señal en simulación"],
  ["Campo A vs. Campo B", "+0.04", "−0.02", "consistente"]];
const t = await llamar("tabla", { documento: id, diapositiva: nTabla, filas });
revisar("tabla", !t.error, t.error ? t.texto : `${t.datos.filas}×${t.datos.columnas}`);

// --- 3. Magic Move: un objeto que se mueve y crece entre una diapositiva y su copia ---
const sm = await llamar("diapositiva_contenido", { documento: id, antetitulo: "Magic Move", titulo: "La figura se mueve y crece", pie: "Fase 3 · Transiciones" });
const nA = sm.datos.diapositiva;
const im = await llamar("insertar_medio", { documento: id, diapositiva: nA, archivo: FIGURA, x: 60, y: 300, ancho: 240 });
revisar("insertar_medio imagen", !im.error && im.datos.tipo === "imagen", im.texto.slice(0, 120));
const dup = await llamar("duplicar_diapositiva", { documento: id, diapositiva: nA });
const nB = dup.datos.copia;
const mv = await llamar("mover_objeto", { documento: id, diapositiva: nB, tipo: "imagen", indice: 1, x: 420, y: 140, ancho: 480 });
revisar("mover_objeto en la copia", !mv.error && mv.datos.x === 420 && mv.datos.ancho === 480, mv.texto.slice(0, 120));

// --- 4. Video y audio en su propia diapositiva ---
const sv = await llamar("diapositiva_tabla", { documento: id, antetitulo: "Animación", titulo: "Video y audio", pie: "Fase 3 · Medios" });
const vid = await llamar("insertar_medio", { documento: id, diapositiva: sv.datos.diapositiva, archivo: VIDEO, x: 43, y: 133, ancho: 614, repetir: "loop", volumen: 0 });
revisar("insertar_medio video", !vid.error && vid.datos.tipo === "video", vid.texto.slice(0, 140));
const aud = await llamar("insertar_medio", { documento: id, diapositiva: sv.datos.diapositiva, archivo: "/System/Library/Sounds/Glass.aiff", volumen: 0 });
revisar("insertar_medio audio", !aud.error && aud.datos.tipo === "audio", aud.texto.slice(0, 100));
const ln = await llamar("linea", { documento: id, diapositiva: sv.datos.diapositiva, x1: 680, y1: 140, x2: 900, y2: 470 });
revisar("linea", !ln.error, ln.texto.slice(0, 100));
await llamar("diapositiva_cierre", { documento: id, subtitulo: "Fin de la prueba" });

// --- 5. Transiciones: disolver (tabla → Magic Move), Magic Move (A → B), cubo (B → video) ---
const tr: [number, string][] = [[nTabla, "dissolve"], [nA, "magic move"], [nB, "cube"]];
for (const [n, efecto] of tr) {
  const r = await llamar("transicion", { documento: id, diapositiva: n, efecto, duracion: 1.5 });
  revisar(`transicion ${efecto}`, !r.error && r.datos.transicion.includes(efecto), r.error ? r.texto : r.datos.transicion);
}

// --- 6. Casos que deben fallar ---
const malTipo = await llamar("grafica", { documento: id, diapositiva: nA, tipo: "radar", categorias, series });
revisar("tipo de gráfica inexistente → error", malTipo.error);
const malSerie = await llamar("grafica", { documento: id, diapositiva: nA, tipo: "barras", categorias, series: [{ nombre: "x", valores: [1, 2] }] });
revisar("serie con valores de menos → error", malSerie.error && malSerie.texto.includes("categorías"), malSerie.texto.slice(0, 90));
const malPastel = await llamar("grafica", { documento: id, diapositiva: nA, tipo: "pastel", categorias, series });
revisar("pastel con varias series → error", malPastel.error, malPastel.texto.slice(0, 80));
const malDisp = await llamar("grafica", { documento: id, diapositiva: nA, tipo: "dispersion", valores_x: [1, 2], series: [{ nombre: "s", valores: [1, 2, 3] }] });
revisar("dispersión con y de más → error", malDisp.error, malDisp.texto.slice(0, 80));
const malTabla = await llamar("tabla", { documento: id, diapositiva: nTabla, filas: [["a", "b"], ["c"]] });
revisar("tabla con filas desiguales → error", malTabla.error, malTabla.texto.slice(0, 80));
const malEfecto = await llamar("transicion", { documento: id, diapositiva: nA, efecto: "explosion" });
revisar("efecto inexistente → error", malEfecto.error);
const malMedio = await llamar("insertar_medio", { documento: id, diapositiva: nA, archivo: join(RAIZ, "README.md") });
revisar("medio con formato no soportado → error", malMedio.error && malMedio.texto.includes("Formato no soportado"), malMedio.texto.slice(0, 80));
const leidoA = (await llamar("leer_presentacion", { documento: id, desde: nA, hasta: nA, detalle: true })).datos.diapositivas[0];
revisar("los errores no dejaron objetos de más", (leidoA.conteo.imagen ?? 0) === 1 && !leidoA.conteo.grafica, JSON.stringify(leidoA.conteo));

// Leyenda: barras con 3 series → 3 entradas; pastel → una por categoría.
const conLeyenda = (await llamar("leer_presentacion", { documento: id, desde: diapositivasGraficas[0], hasta: diapositivasGraficas[0] })).datos.diapositivas[0];
revisar("la gráfica de barras trae leyenda", ["■ Campo A", "■ Campo B", "■ Campo C"].every((t) => conLeyenda.textos.includes(t)), JSON.stringify(conLeyenda.textos));

// --- 7. Vistas: gráficas y tabla ---
const vistas: string[] = [];
for (const n of [...diapositivasGraficas, nTabla]) {
  const v = await llamar("ver_diapositiva", { documento: id, diapositiva: n, ancho_max: 960 });
  const img = v.contenido.find((c) => c.type === "image");
  const archivo = join(SALIDA, `d${String(n).padStart(2, "0")}.png`);
  if (img?.data) { writeFileSync(archivo, Buffer.from(img.data, "base64")); vistas.push(archivo); }
}
revisar("vistas de las 17 gráficas y la tabla", vistas.length === 18);
copyFileSync(vistas[vistas.length - 1], join(SALIDA, "tabla.png"));
copyFileSync(vistas[tipos.enum.indexOf("dispersion")], join(SALIDA, "dispersion.png"));

// --- 8. Video ---
const ex = await llamar("exportar", { documento: id, formato: "video", destino: join(SALIDA, "prueba_fase3.m4v") });
revisar("exportar video", !ex.error && existsSync(join(SALIDA, "prueba_fase3.m4v")), ex.error ? ex.texto : ex.datos.destino);
await llamar("guardar", { documento: id });
await llamar("cerrar", { documento: id });
await cliente.close();

if (!ex.error) {
  const video = join(SALIDA, "prueba_fase3.m4v");
  // Tramos con la imagen quieta (freezedetect, que escribe en stderr): entre dos tramos quietos
  // hay movimiento. Un corte deja un hueco de ~0 s; una transición animada, uno de ~1.5 s.
  // El video incrustado (después del cubo) también se mueve: por eso se toman los tres
  // primeros huecos de 1–2 s, que en esta presentación son disolver, Magic Move y cubo.
  const analisis = spawnSync(FFMPEG, ["-hide_banner", "-i", video, "-vf", "freezedetect=n=0.001:d=0.3", "-map", "0:v", "-f", "null", "-"], { encoding: "utf8" });
  const inicios = [...analisis.stderr.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const finales = [...analisis.stderr.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const huecos = finales.map((fin, i) => [fin, inicios[i + 1]]).filter(([a, b]) => b !== undefined && b - a >= 1 && b - a <= 2);
  writeFileSync(join(SALIDA, "huecos_de_movimiento.json"), JSON.stringify(huecos));
  const transiciones = huecos.slice(0, 3).map(([a, b]) => [a, b]);
  revisar("tres transiciones animadas en el video (≈1.5 s cada una)", transiciones.length === 3,
    transiciones.map(([a, b]) => `${a.toFixed(2)}–${b.toFixed(2)} s`).join(", "));
  const cuadros: string[] = [];
  for (const [i, g] of transiciones.entries()) {
    const a = g[0], b = g[g.length - 1];
    for (const [k, f] of [-0.3, 0, 0.25, 0.5, 0.75, 1, 1.3].entries()) {
      const tt = f < 0 ? a + f : f > 1 ? b + (f - 1) : a + (b - a) * f;
      const archivo = join(SALIDA, `tr${i + 1}_${k}.png`);
      execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-ss", tt.toFixed(3), "-i", video, "-frames:v", "1", "-vf", "scale=480:-1", archivo]);
      cuadros.push(archivo);
    }
  }
  if (cuadros.length === 21) {
    const entradas = cuadros.flatMap((c) => ["-i", c]);
    const filtro = [0, 1, 2].map((r) => `${[0, 1, 2, 3, 4, 5, 6].map((k) => `[${r * 7 + k}]`).join("")}hstack=inputs=7[f${r}]`).join(";") + ";[f0][f1][f2]vstack=inputs=3[o]";
    execFileSync(FFMPEG, ["-loglevel", "error", "-y", ...entradas, "-filter_complex", filtro, "-map", "[o]", join(SALIDA, "transiciones.png")]);
  }
  execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-pattern_type", "glob", "-i", join(SALIDA, "d*.png"), "-vf", "scale=480:-1,tile=3x6:padding=4:color=gray", "-frames:v", "1", join(SALIDA, "hoja_graficas.png")]);
}
const icloudDespues = existsSync(ICLOUD) ? readdirSync(ICLOUD).sort().join("|") : "";
revisar("no aparecen borradores en iCloud", icloudDespues === icloudAntes);
console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLA(S)`);
process.exit(fallos === 0 ? 0 : 1);
