// Formato: una presentación de 5 diapositivas hecha solo con las herramientas de formato,
// con el tema activo (ATRIL_TEMA, o temas/noche).
//
//   node test/fase2.ts
//   ATRIL_TEMA=papel node test/fase2.ts
//
// Deja trabajo/evidencia/fase2/<tema>.png con las 5 diapositivas.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TEMA } from "../src/tema.ts";
import { recursos } from "./recursos.ts";

const R = await recursos();

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = JSON.parse(readFileSync(join(RAIZ, "test/contenido_fase2.json"), "utf8"));
const TRABAJO = join(RAIZ, "trabajo", "prueba_fase2");
const COMP = join(RAIZ, "trabajo", "evidencia", "fase2");
const ICLOUD = join(homedir(), "Library/Mobile Documents/com~apple~Keynote/Documents");

let fallos = 0;
function revisar(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK  " : "FALLA"} ${nombre}${detalle ? " — " + detalle : ""}`);
}
const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");

rmSync(TRABAJO, { recursive: true, force: true });
mkdirSync(COMP, { recursive: true });
C.figura.imagen = R.figura;
const hashFigura = sha(C.figura.imagen);
const icloudAntes = existsSync(ICLOUD) ? readdirSync(ICLOUD).sort().join("|") : "";

const cliente = new Client({ name: "verificar-fase2", version: "0" });
await cliente.connect(new StdioClientTransport({
  command: process.execPath, args: [join(RAIZ, "src/index.ts")],
  env: { ...process.env, ATRIL_DIR: TRABAJO } as Record<string, string>,
}));
async function llamar(nombre: string, args: Record<string, unknown> = {}) {
  const r = await cliente.callTool({ name: nombre, arguments: args });
  const contenido = r.content as { type: string; text?: string; data?: string }[];
  const texto = contenido.find((c) => c.type === "text")?.text ?? "";
  let datos: any = null;
  try { datos = JSON.parse(texto); } catch { /* error en texto libre */ }
  return { error: r.isError === true, texto, datos, contenido };
}
async function guardarVista(doc: string, n: number, archivo: string) {
  const v = await llamar("ver_diapositiva", { documento: doc, diapositiva: n, ancho_max: 1920 });
  const img = v.contenido.find((c) => c.type === "image");
  if (img?.data) writeFileSync(join(COMP, archivo), Buffer.from(img.data, "base64"));
  return !!img;
}

// --- 1. La presentación con las herramientas de formato ---
const p = await llamar("crear_con_formato", { nombre: "prueba_fase2" });
// Prototipos de la plantilla: 6 tipos más 2 con viñetas animadas.
const PROTOTIPOS = 8;
revisar("crear_con_formato", !p.error && p.datos.editable && p.datos.diapositivas === PROTOTIPOS, p.error ? p.texto : `${p.datos.archivo} (${p.datos.diapositivas} prototipos)`);
const id = p.datos.id;
const pasos: [string, Record<string, unknown>][] = [
  ["diapositiva_portada", C.portada],
  ["diapositiva_divisor", C.divisor],
  ["diapositiva_contenido", C.contenido],
  ["diapositiva_figura", C.figura],
  ["diapositiva_cierre", C.cierre],
];
for (const [i, [herramienta, campos]] of pasos.entries()) {
  const r = await llamar(herramienta, { documento: id, ...campos, notas: `Guion de la diapositiva ${i + 1}` });
  revisar(herramienta, !r.error && r.datos.diapositiva === i + 1, r.error ? r.texto : `diapositiva ${r.datos.diapositiva}`);
}

const leido = (await llamar("leer_presentacion", { documento: id, detalle: true })).datos.diapositivas;
const reales = leido.filter((d: any) => !d.saltada);
revisar(`5 diapositivas visibles + ${PROTOTIPOS} prototipos ocultos`, reales.length === 5 && leido.length === 5 + PROTOTIPOS, `${reales.length} + ${leido.length - reales.length}`);
revisar("diseños en orden", reales.map((d: any) => d.diseno).join(",") === "Portada,Divisor,Contenido,Figura,Cierre", reales.map((d: any) => d.diseno).join(","));
revisar("títulos", reales.map((d: any) => d.titulo).join("|") === [C.portada, C.divisor, C.contenido, C.figura, C.cierre].map((c) => c.titulo).join("|"));
revisar("antetítulo en mayúsculas", reales[2].objetos.some((o: any) => o.texto === C.contenido.antetitulo.toUpperCase()));
revisar("no queda texto de muestra", !reales.some((d: any) => d.objetos.some((o: any) => ["ANTETÍTULO", "Sección", "Autor · Institución", "Elaboración propia"].includes(o.texto))));
revisar("notas del guion", reales.every((d: any, i: number) => d.notas === `Guion de la diapositiva ${i + 1}`));
const fig = reales[3].objetos;
const imagen = fig.find((o: any) => o.tipo === "imagen");
const tarjeta = fig.filter((o: any) => o.tipo === "figura" && !o.texto).sort((a: any, b: any) => b.ancho * b.alto - a.ancho * a.alto)[0];
revisar("la tarjeta rodea la imagen (6 pt por lado)", imagen && tarjeta && Math.abs(tarjeta.x - (imagen.x - 6)) <= 1 && Math.abs(tarjeta.ancho - (imagen.ancho + 12)) <= 1,
  JSON.stringify({ imagen: imagen && [imagen.x, imagen.y, imagen.ancho, imagen.alto], tarjeta: tarjeta && [tarjeta.x, tarjeta.y, tarjeta.ancho, tarjeta.alto] }));

// --- 2. Casos que deben fallar ---
const sinOrigen = await llamar("diapositiva_figura", { documento: id, antetitulo: "x", titulo: "x", imagen: C.figura.imagen, origen: " ", despues_de: 5 });
if (TEMA.origen_obligatorio) revisar("figura sin pie de origen → error (el tema lo exige)", sinOrigen.error, sinOrigen.texto.slice(0, 80));
else {
  // Sin origen y sin exigirlo: la figura queda sin pie (y sin el texto de muestra).
  const sp = !sinOrigen.error && (await llamar("leer_presentacion", { documento: id, desde: 6, hasta: 6, detalle: true })).datos.diapositivas[0].objetos;
  revisar("figura sin pie de origen → sin pie (el tema no lo exige)", sp && !sp.some((o: any) => o.tipo === "texto" && /Elaboración propia|atril:/.test(o.texto ?? "")), sinOrigen.texto.slice(0, 80));
  await llamar("borrar_diapositiva", { documento: id, diapositiva: 6 });
}
const sinImagen = await llamar("diapositiva_figura", { documento: id, antetitulo: "x", titulo: "x", imagen: "/no/existe.png", origen: "x" });
revisar("imagen inexistente → error", sinImagen.error, sinImagen.texto.slice(0, 80));
const llano = await llamar("crear", { tema: "Basic White", nombre: "sin_formato" });
const sinProto = await llamar("diapositiva_contenido", { documento: llano.datos.id, antetitulo: "x", titulo: "x" });
revisar("presentación sin plantilla → error", sinProto.error && sinProto.texto.includes("crear_con_formato"), sinProto.texto.slice(0, 90));
await llamar("cerrar", { documento: llano.datos.id });
const total = (await llamar("listar_presentaciones_abiertas")).datos.find((d: any) => d.id === id).diapositivas;
revisar("los intentos fallidos no dejaron diapositivas", total === 5 + PROTOTIPOS, `${total}`);

// --- 3. Exportar: los prototipos no deben salir ---
const pdf = await llamar("exportar", { documento: id, formato: "pdf" });
const paginas = pdf.error ? -1 : (readFileSync(pdf.datos.destino, "latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
revisar("el PDF tiene 5 páginas (sin prototipos)", paginas === 5, `${paginas} páginas`);

// --- 4. Vista de las 5 diapositivas ---
for (let n = 1; n <= 5; n++) await guardarVista(id, n, `d${n}.png`);
await llamar("guardar", { documento: id });
await llamar("cerrar", { documento: id });
await cliente.close();
const nombreTema = TEMA.dir.split("/").pop();
execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...[1, 2, 3, 4, 5].flatMap((n) => ["-i", join(COMP, `d${n}.png`)]), "-filter_complex",
  "[0][1][2][3][4]xstack=inputs=5:layout=0_0|w0_0|0_h0|w0_h0|0_h0+h1[o]", "-map", "[o]", join(COMP, `${nombreTema}.png`)]);
revisar("hoja con las 5 diapositivas", existsSync(join(COMP, `${nombreTema}.png`)));
revisar("figura original intacta (sha256)", sha(C.figura.imagen) === hashFigura);
const icloudDespues = existsSync(ICLOUD) ? readdirSync(ICLOUD).sort().join("|") : "";
revisar("no aparecen borradores en iCloud", icloudDespues === icloudAntes);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLA(S)`);
process.exit(fallos === 0 ? 0 : 1);
