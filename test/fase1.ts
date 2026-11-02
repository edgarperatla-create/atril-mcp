// Prueba 1: habla con el servidor por MCP real (stdio).
//
//   node test/fase1.ts [ruta de un .pptx con notas en cada diapositiva]
//
// Usa una carpeta de trabajo propia (trabajo/prueba_fase1) para no mezclar con ~/Atril.
// Casos que deben FALLAR: editar o cerrar una presentación fuera de la carpeta de trabajo.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAPOSITIVAS_PPTX, recursos } from "./recursos.ts";

const R = await recursos();

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PPTX = process.argv[2] ?? R.pptx;
const TRABAJO = join(RAIZ, "trabajo", "prueba_fase1");
const FUERA = join(RAIZ, "trabajo", "fuera_de_atril");
const EVIDENCIA = join(RAIZ, "trabajo", "evidencia", "fase1");

let fallos = 0;
function revisar(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK  " : "FALLA"} ${nombre}${detalle ? " — " + detalle : ""}`);
}
const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
const osa = (s: string, ...args: string[]) =>
  execFileSync("osascript", ["-e", `on run argv\ntell application id "com.apple.Keynote"\n${s}\nend tell\nend run`, ...args]).toString().trim();

rmSync(TRABAJO, { recursive: true, force: true });
rmSync(FUERA, { recursive: true, force: true });
mkdirSync(FUERA, { recursive: true });
mkdirSync(EVIDENCIA, { recursive: true });
const hashAntes = sha(PPTX);
const ICLOUD = join(homedir(), "Library/Mobile Documents/com~apple~Keynote/Documents");
const icloudAntes = existsSync(ICLOUD) ? readdirSync(ICLOUD).sort().join("|") : "";

const cliente = new Client({ name: "verificar-fase1", version: "0" });
await cliente.connect(new StdioClientTransport({
  command: process.execPath, args: [join(RAIZ, "src/index.ts")],
  env: { ...process.env, ATRIL_DIR: TRABAJO } as Record<string, string>,
}));

type Contenido = { type: string; text?: string; data?: string };
async function llamar(nombre: string, args: Record<string, unknown> = {}) {
  const t0 = Date.now();
  const r = await cliente.callTool({ name: nombre, arguments: args });
  const contenido = r.content as Contenido[];
  const texto = contenido.find((c) => c.type === "text")?.text ?? "";
  let datos: any = null;
  try { datos = JSON.parse(texto); } catch { /* errores y textos libres */ }
  return { error: r.isError === true, texto, datos, contenido, ms: Date.now() - t0 };
}

const herramientas = (await cliente.listTools()).tools.map((t) => t.name);
const NUCLEO = ["listar_presentaciones_abiertas", "abrir", "crear", "leer_presentacion", "agregar_diapositiva", "poner_texto", "notas", "exportar", "ver_diapositiva", "guardar", "cerrar"];
revisar("las 11 herramientas del núcleo", NUCLEO.every((n) => herramientas.includes(n)), `${herramientas.length} expuestas`);

// --- 1. Un .pptx: abrir copia y leer todas sus diapositivas con notas ---
const abierto = await llamar("abrir", { ruta: PPTX });
revisar("abrir el .pptx crea copia en la carpeta de trabajo", !abierto.error && abierto.datos.copia.startsWith(TRABAJO), abierto.error ? abierto.texto : `${abierto.datos.copia} (${abierto.ms} ms)`);
const pptx = abierto.datos?.id;
const leido = await llamar("leer_presentacion", { documento: pptx });
const dias = leido.datos?.diapositivas ?? [];
const conNotas = dias.filter((d: any) => d.notas && d.notas.trim()).length;
revisar(`leer_presentacion devuelve ${DIAPOSITIVAS_PPTX} diapositivas`, dias.length === DIAPOSITIVAS_PPTX, `${dias.length} (${leido.ms} ms)`);
revisar("todas tienen notas", conNotas === DIAPOSITIVAS_PPTX, `${conNotas} con notas`);
const videos = dias.reduce((s: number, d: any) => s + (d.conteo.video ?? 0), 0);
revisar("detecta los videos", videos > 0, `${videos} videos`);
writeFileSync(join(EVIDENCIA, "leer_pptx_d1-3.json"), JSON.stringify(dias.slice(0, 3), null, 2));
const detalle = await llamar("leer_presentacion", { documento: pptx, desde: 2, hasta: 2, detalle: true });
revisar("detalle trae posiciones", !detalle.error && detalle.datos.diapositivas[0].objetos.every((o: any) => typeof o.x === "number"), `${detalle.datos?.diapositivas[0].objetos.length} objetos`);
const vistaPptx = await llamar("ver_diapositiva", { documento: pptx, diapositiva: 2 });
const imgPptx = vistaPptx.contenido.find((c) => c.type === "image");
revisar("ver_diapositiva del .pptx devuelve imagen", !!imgPptx, `${vistaPptx.texto} (${vistaPptx.ms} ms)`);
if (imgPptx?.data) writeFileSync(join(EVIDENCIA, "pptx_d002.png"), Buffer.from(imgPptx.data, "base64"));

// --- 2. Crear, agregar, escribir, notas, ver, exportar, guardar ---
const nuevo = await llamar("crear", { tema: "Basic White", nombre: "prueba_fase1" });
revisar("crear guarda en la carpeta de copias", !nuevo.error && nuevo.datos.ancho === 1920 && nuevo.datos.editable && nuevo.datos.archivo.startsWith(join(TRABAJO, "copias")),
  nuevo.error ? nuevo.texto : `${nuevo.datos.archivo} ${nuevo.datos.ancho}x${nuevo.datos.alto}`);
const id = nuevo.datos?.id;
const malTema = await llamar("crear", { tema: "No Existe" });
revisar("tema inexistente → error con lista", malTema.error && malTema.texto.includes("Basic White"));
const malDiseno = await llamar("agregar_diapositiva", { documento: id, diseno: "No Existe" });
revisar("diseño inexistente → error con lista", malDiseno.error && malDiseno.texto.includes("Title & Bullets"));
const agregada = await llamar("agregar_diapositiva", { documento: id, diseno: "Title & Bullets" });
revisar("agregar_diapositiva", !agregada.error && agregada.datos.diapositiva === 2, agregada.texto.slice(0, 80));
const texto = await llamar("poner_texto", {
  documento: id, diapositiva: 2, titulo: "Resultados preliminares",
  cuerpo: "Exceso de vecinos a z ≈ 2–3\nComparación con 1000 campos aleatorios\nSignificancia por nulo empírico",
  nuevo_cuadro: { texto: "Atril · Fase 1", x: 80, y: 980, ancho: 600, alto: 60 },
});
revisar("poner_texto título, cuerpo y cuadro nuevo", !texto.error && texto.datos.titulo === "Resultados preliminares" && texto.datos.textos.includes("Atril · Fase 1"), texto.error ? texto.texto : "");
const releido = await llamar("leer_presentacion", { documento: id, desde: 2, hasta: 2, detalle: true });
const d2 = releido.datos?.diapositivas[0];
const cuadro = d2?.objetos.find((o: any) => o.texto === "Atril · Fase 1");
revisar("el cuadro nuevo quedó en (80, 980) con 600 de ancho", cuadro?.x === 80 && cuadro?.y === 980 && cuadro?.ancho === 600, JSON.stringify(cuadro));
revisar("el cuerpo conserva sus 3 viñetas", d2?.cuerpo?.split("\n").length === 3, JSON.stringify(d2?.cuerpo));
const cuerpoObj = d2?.objetos.find((o: any) => o.texto === d2.cuerpo);
revisar("el cuerpo no se movió ni encogió (alto > 300)", cuerpoObj?.alto > 300, JSON.stringify(cuerpoObj && { x: cuerpoObj.x, y: cuerpoObj.y, ancho: cuerpoObj.ancho, alto: cuerpoObj.alto }));
const malIndice = await llamar("poner_texto", { documento: id, diapositiva: 2, reemplazar: [{ tipo: "texto", indice: 99, texto: "x" }] });
revisar("índice inexistente → error", malIndice.error, malIndice.texto);
const malNum = await llamar("notas", { documento: id, diapositiva: 50 });
revisar("diapositiva inexistente → error", malNum.error, malNum.texto);
await llamar("notas", { documento: id, diapositiva: 2, texto: "Nota de prueba: explicar el nulo empírico." });
const nota = await llamar("notas", { documento: id, diapositiva: 2 });
revisar("notas escribir y releer", nota.datos?.notas === "Nota de prueba: explicar el nulo empírico.", nota.texto.slice(0, 120));
const vista = await llamar("ver_diapositiva", { documento: id, diapositiva: 2 });
const img = vista.contenido.find((c) => c.type === "image");
revisar("ver_diapositiva de la nueva", !!img, vista.texto);
if (img?.data) writeFileSync(join(EVIDENCIA, "nueva_d002.png"), Buffer.from(img.data, "base64"));
for (const formato of ["pdf", "pptx", "png"]) {
  const e = await llamar("exportar", { documento: id, formato });
  revisar(`exportar ${formato}`, !e.error && existsSync(e.datos.destino), e.error ? e.texto : `${e.datos.destino}${e.datos.archivos ? " " + e.datos.archivos.length + " archivos" : ""}`);
}
const e2 = await llamar("exportar", { documento: id, formato: "pdf" });
revisar("exportar no sobrescribe (agrega _2)", !e2.error && e2.datos.destino.endsWith("_2.pdf"), e2.datos?.destino);
const g = await llamar("guardar", { documento: id });
revisar("guardar en la carpeta de copias", !g.error && g.datos.archivo.startsWith(join(TRABAJO, "copias")) && existsSync(g.datos.archivo), g.error ? g.texto : g.datos.archivo);

// --- 3. Casos que deben fallar: presentación fuera de la carpeta de trabajo ---
const ajenoRuta = join(FUERA, "ajena.key");
const ajeno = osa(`set d to make new document with properties {document theme:theme "Basic White"}
save d in POSIX file (item 1 of argv)
return id of d`, ajenoRuta);
const lista = await llamar("listar_presentaciones_abiertas");
const ajenaInfo = lista.datos.find((d: any) => d.id === ajeno);
revisar("listar marca la ajena como no editable", ajenaInfo?.editable === false);
revisar("listar marca la copia del .pptx como editable", lista.datos.find((d: any) => d.id === pptx)?.editable === true);
const hashAjena = sha(join(ajenoRuta, "..", "ajena.key"));
for (const [nombre, args] of [
  ["poner_texto", { documento: ajeno, diapositiva: 1, titulo: "NO" }],
  ["notas", { documento: ajeno, diapositiva: 1, texto: "NO" }],
  ["agregar_diapositiva", { documento: ajeno }],
  ["guardar", { documento: ajeno }],
  ["cerrar", { documento: ajeno }],
] as const) {
  const r = await llamar(nombre, args);
  revisar(`${nombre} sobre ajena → rechazado`, r.error && r.texto.includes("Atril no lo modifica"), r.texto.slice(0, 90));
}
const ajenaIntacta = osa(`set d to document id (item 1 of argv)
return (modified of d as text) & "|" & (count of slides of d)`, ajeno);
revisar("la ajena sigue sin cambios", ajenaIntacta === "false|1" && sha(ajenoRuta) === hashAjena, ajenaIntacta);
const leerAjena = await llamar("leer_presentacion", { documento: ajeno });
revisar("leer la ajena sí se permite", !leerAjena.error);
osa(`close document id (item 1 of argv) saving no`, ajeno);

const sinGuardar = osa(`set d to make new document with properties {document theme:theme "Basic White"}
return id of d`);
const rSin = await llamar("poner_texto", { documento: sinGuardar, diapositiva: 1, titulo: "NO" });
revisar("documento sin archivo (podría ser del usuario) → rechazado", rSin.error, rSin.texto.slice(0, 90));
osa(`close document id (item 1 of argv) saving no`, sinGuardar);

// --- 4. Cerrar y comprobar originales ---
const c1 = await llamar("cerrar", { documento: id });
const c2 = await llamar("cerrar", { documento: pptx });
revisar("cerrar ambas", !c1.error && !c2.error, `${c1.texto.slice(0, 60)} | ${c2.texto.slice(0, 60)}`);
const quedan = (await llamar("listar_presentaciones_abiertas")).datos.map((d: any) => d.id);
revisar("ya no están abiertas", !quedan.includes(id) && !quedan.includes(pptx));
revisar("original del .pptx intacto (sha256)", sha(PPTX) === hashAntes, hashAntes.slice(0, 16));
const icloudDespues = existsSync(ICLOUD) ? readdirSync(ICLOUD).sort().join("|") : "";
revisar("no aparecen borradores en iCloud", icloudDespues === icloudAntes, icloudDespues === icloudAntes ? "" : `antes: ${icloudAntes} / después: ${icloudDespues}`);

await cliente.close();
console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLA(S)`);
process.exit(fallos === 0 ? 0 : 1);
