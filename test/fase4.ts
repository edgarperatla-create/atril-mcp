// Prueba 4: viñetas animadas desde la plantilla (vías D+B) y animaciones con
// Magic Move (vía A), solo con las herramientas, por MCP real.
//
//   node test/fase4.ts
//
// Comprueba los pasos de animación exportando con `etapas` y el movimiento en el video
// (test/analizar_video.py). Deja trabajo/evidencia/fase4/: etapas.png, fotogramas.png.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAPOSITIVAS_PPTX, recursos } from "./recursos.ts";

const R = await recursos();

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TRABAJO = join(RAIZ, "trabajo", "prueba_fase4");
const SALIDA = join(RAIZ, "trabajo", "evidencia", "fase4");
const FFMPEG = "/opt/homebrew/bin/ffmpeg";
const FIG = R.figura;
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

const cliente = new Client({ name: "verificar-fase4", version: "0" });
await cliente.connect(new StdioClientTransport({
  command: process.execPath, args: [join(RAIZ, "src/index.ts")],
  env: { ...process.env, ATRIL_DIR: TRABAJO } as Record<string, string>,
}));
async function llamar(nombre: string, args: Record<string, unknown> = {}) {
  const r = await cliente.callTool({ name: nombre, arguments: args }, undefined, { timeout: 600_000 });
  const texto = (r.content as { type: string; text?: string }[]).find((c) => c.type === "text")?.text ?? "";
  let datos: any = null;
  try { datos = JSON.parse(texto); } catch { /* texto libre */ }
  return { error: r.isError === true, texto, datos };
}
const detalle = async (id: string, n: number) => (await llamar("leer_presentacion", { documento: id, desde: n, hasta: n, detalle: true })).datos.diapositivas[0];
const indiceTexto = (d: any, texto: string) => d.objetos.find((o: any) => o.tipo === "texto" && o.texto === texto)?.indice;

const id = (await llamar("crear_con_formato", { nombre: "prueba_fase4" })).datos.id;

// --- 1. Viñetas animadas desde la plantilla (D + B) ---
const c1 = await llamar("diapositiva_contenido", { documento: id, antetitulo: "Viñetas animadas", titulo: "Cuatro ideas, una por clic", cuerpo: "Primera\nSegunda\nTercera\nCuarta", animar_vinetas: true });
revisar("diapositiva_contenido con animar_vinetas", !c1.error, c1.texto.slice(0, 80));
const c2 = await llamar("diapositiva_figura", { documento: id, antetitulo: "Viñetas animadas", titulo: "Figura con dos ideas", imagen: FIG, origen: "Elaboración propia", cuerpo: "Una\nOtra", animar_vinetas: true });
revisar("diapositiva_figura con animar_vinetas", !c2.error, c2.texto.slice(0, 80));
const sinCuerpo = await llamar("diapositiva_contenido", { documento: id, antetitulo: "x", titulo: "x", animar_vinetas: true });
revisar("animar_vinetas sin cuerpo → error", sinCuerpo.error, sinCuerpo.texto.slice(0, 70));

// --- 2. Revelar por pasos (A) ---
const sr = await llamar("diapositiva_tabla", { documento: id, antetitulo: "Magic Move", titulo: "Revelar por pasos" });
const nR = sr.datos.diapositiva;
await llamar("insertar_medio", { documento: id, diapositiva: nR, archivo: FIG, x: 60, y: 150, ancho: 400 });
await llamar("poner_texto", { documento: id, diapositiva: nR, nuevo_cuadro: { texto: "Primero, la figura", x: 520, y: 180, ancho: 380 } });
await llamar("poner_texto", { documento: id, diapositiva: nR, nuevo_cuadro: { texto: "Después, la conclusión", x: 520, y: 260, ancho: 380 } });
let dR = await detalle(id, nR);
const t1 = indiceTexto(dR, "Primero, la figura"), t2 = indiceTexto(dR, "Después, la conclusión");
const malPaso = await llamar("revelar_por_pasos", { documento: id, diapositiva: nR, pasos: [[{ tipo: "imagen", indice: 9 }]] });
revisar("revelar_por_pasos con índice inexistente → error", malPaso.error, malPaso.texto.slice(0, 70));
const repetido = await llamar("revelar_por_pasos", { documento: id, diapositiva: nR, pasos: [[{ tipo: "imagen", indice: 1 }], [{ tipo: "imagen", indice: 1 }]] });
revisar("objeto repetido en dos pasos → error", repetido.error, repetido.texto.slice(0, 70));
const rv = await llamar("revelar_por_pasos", { documento: id, diapositiva: nR, pasos: [[{ tipo: "imagen", indice: 1 }], [{ tipo: "texto", indice: t1 }], [{ tipo: "texto", indice: t2 }]] });
revisar("revelar_por_pasos (3 pasos)", !rv.error && rv.datos.diapositivas.length === 4, rv.error ? rv.texto : rv.datos.diapositivas.join(","));
const parciales = await Promise.all([0, 1, 2, 3].map((j) => detalle(id, nR + j)));
const visibles = parciales.map((d) => [(d.conteo.imagen ?? 0) > 0, indiceTexto(d, "Primero, la figura") !== undefined, indiceTexto(d, "Después, la conclusión") !== undefined].filter(Boolean).length);
revisar("las versiones parciales muestran 0, 1, 2 y 3 objetos", visibles.join(",") === "0,1,2,3", visibles.join(","));

// --- 3. Animar cambios (A): mover y escalar, atenuar, resaltar color ---
const sc = await llamar("diapositiva_tabla", { documento: id, antetitulo: "Magic Move", titulo: "Mover, atenuar y resaltar" });
const nC = sc.datos.diapositiva;
await llamar("insertar_medio", { documento: id, diapositiva: nC, archivo: FIG, x: 60, y: 300, ancho: 240 });
await llamar("poner_texto", { documento: id, diapositiva: nC, nuevo_cuadro: { texto: "La señal desaparece con σ real", x: 420, y: 160, ancho: 480 } });
const tC = indiceTexto(await detalle(id, nC), "La señal desaparece con σ real");
const malColor = await llamar("animar_cambio", { documento: id, diapositiva: nC, cambios: [{ tipo: "imagen", indice: 1, color_texto: "D6924F" }] });
revisar("color_texto en una imagen → error", malColor.error, malColor.texto.slice(0, 70));
const m1 = await llamar("animar_cambio", { documento: id, diapositiva: nC, cambios: [{ tipo: "imagen", indice: 1, x: 420, y: 230, ancho: 480 }] });
revisar("animar_cambio mover y escalar", !m1.error && m1.datos.cambios[0].x === 420 && m1.datos.cambios[0].ancho === 480, m1.texto.slice(0, 90));
const m2 = await llamar("animar_cambio", { documento: id, diapositiva: m1.datos.a, cambios: [{ tipo: "imagen", indice: 1, opacidad: 25 }, { tipo: "texto", indice: tC, color_texto: "D6924F" }] });
revisar("animar_cambio atenuar y resaltar", !m2.error, m2.texto.slice(0, 90));

// --- 4. Revelar series (A) ---
const ss = await llamar("diapositiva_tabla", { documento: id, antetitulo: "Magic Move", titulo: "Series una por una" });
const malSeries = await llamar("revelar_series", { documento: id, diapositiva: ss.datos.diapositiva, tipo: "barras", categorias: ["a"], series: [{ nombre: "x", valores: [1] }] });
revisar("revelar_series con una serie → error", malSeries.error);
const rs = await llamar("revelar_series", { documento: id, diapositiva: ss.datos.diapositiva, tipo: "barras", categorias: ["z<1.5", "1.5–2.5", ">2.5"], series: [
  { nombre: "Campo A", valores: [0.12, 0.31, 0.22] }, { nombre: "Campo B", valores: [0.08, 0.25, 0.30] }, { nombre: "Campo C", valores: [0.35, 0.62, 0.90] }] });
revisar("revelar_series (3 series)", !rs.error && rs.datos.diapositivas.length === 3, rs.error ? rs.texto : rs.datos.diapositivas.join(","));
const ultima = await detalle(id, rs.datos.diapositivas[2]);
revisar("la última versión tiene una gráfica y la leyenda de 3", ultima.conteo.grafica === 1 && ["■ Campo A", "■ Campo B", "■ Campo C"].every((t) => ultima.objetos.some((o: any) => o.texto === t)), JSON.stringify(ultima.conteo));

// --- 5. borrar_objeto ---
const malBorrar = await llamar("borrar_objeto", { documento: id, diapositiva: nC, tipo: "grafica", indice: 1 });
revisar("borrar_objeto inexistente → error", malBorrar.error, malBorrar.texto.slice(0, 70));

// --- 6. Transiciones: Magic Move exactamente donde lo pusieron las herramientas ---
const info = (await llamar("leer_presentacion", { documento: id })).datos.diapositivas;
const conMM = info.filter((d: any) => d.transicion?.efecto === "magic move").map((d: any) => d.n);
const esperadas = [...rv.datos.diapositivas.slice(0, -1), m1.datos.de, m2.datos.de, ...rs.datos.diapositivas.slice(0, -1)];
revisar("Magic Move en las 7 diapositivas esperadas", conMM.join(",") === esperadas.join(","), `${conMM.join(",")} (esperadas ${esperadas.join(",")})`);

// --- 7. Pasos de animación: diapositivas visibles más 4 + 2 viñetas ---
const nVisibles = info.filter((d: any) => !d.saltada).length;
const et = await llamar("exportar", { documento: id, formato: "png", destino: join(SALIDA, "etapas"), etapas: true });
const imagenes = et.datos?.archivos?.length ?? -1;
revisar("etapas exportadas = diapositivas + 6 viñetas animadas", imagenes === nVisibles + 6, `${imagenes} imágenes, ${nVisibles} diapositivas`);
execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-pattern_type", "glob", "-i", join(SALIDA, "etapas", "*.png"), "-vf", "scale=320:-1,tile=6x4:padding=4:color=gray", "-frames:v", "1", join(SALIDA, "etapas.png")]);

// --- 8. Video: evidencia visual (fotogramas.png). El detector de movimiento no ve todos los
// fundidos de texto pequeño, así que aquí solo se exige que haya video y
// que se detecten animaciones de ambos tipos; la comprobación exacta es la de los pasos 6 y 7.
const vd = await llamar("exportar", { documento: id, formato: "video", destino: join(SALIDA, "prueba_fase4.m4v") });
await llamar("guardar", { documento: id });
await llamar("cerrar", { documento: id });
await cliente.close();
if (!vd.error) {
  execFileSync("python3", ["-I", join(RAIZ, "test/analizar_video.py"), vd.datos.destino, join(SALIDA, "fotogramas.png"), "0.25", "2.5", "0.00005"], { stdio: "ignore" });
  const tramos = JSON.parse(readFileSync(join(SALIDA, "fotogramas.json"), "utf8")) as { duracion: number }[];
  const cortos = tramos.filter((t) => t.duracion < 0.8).length, largos = tramos.filter((t) => t.duracion >= 0.8).length;
  revisar("en el video hay viñetas (~0.5 s) y Magic Move (~1 s)", cortos > 0 && largos > 0, `${cortos} cortas, ${largos} largas: ${tramos.map((t) => t.duracion).join(" ")}`);
} else revisar("exportar video", false, vd.texto);
const icloudDespues = existsSync(ICLOUD) ? readdirSync(ICLOUD).sort().join("|") : "";
revisar("no aparecen borradores en iCloud", icloudDespues === icloudAntes);
console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLA(S)`);
process.exit(fallos === 0 ? 0 : 1);
