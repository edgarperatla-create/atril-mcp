// Prueba 6: manejo de diapositivas, ecuaciones LaTeX, figuras, componentes del
// formato, estilo de texto y tablas editables, por MCP real.
//
//   node test/fase6.ts              (sin presentar: ocupa la pantalla)
//   node test/fase6.ts --presentar  (también inicia, avanza y detiene una presentación)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAPOSITIVAS_PPTX, recursos } from "./recursos.ts";
import { TEMA, fuentePS } from "../src/tema.ts";

const R = await recursos();

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TRABAJO = join(RAIZ, "trabajo", "prueba_fase6");
const SALIDA = join(RAIZ, "trabajo", "evidencia", "fase6");
const VIDEO = R.video;
const ICLOUD = join(homedir(), "Library/Mobile Documents/com~apple~Keynote/Documents");
const PRESENTAR = process.argv.includes("--presentar");

let fallos = 0;
function revisar(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK  " : "FALLA"} ${nombre}${detalle ? " — " + detalle : ""}`);
}
rmSync(TRABAJO, { recursive: true, force: true });
rmSync(SALIDA, { recursive: true, force: true });
mkdirSync(SALIDA, { recursive: true });
const icloudAntes = existsSync(ICLOUD) ? readdirSync(ICLOUD).sort().join("|") : "";
const cliente = new Client({ name: "verificar-fase6", version: "0" });
await cliente.connect(new StdioClientTransport({
  command: process.execPath, args: [join(RAIZ, "src/index.ts")],
  env: { ...process.env, ATRIL_DIR: TRABAJO } as Record<string, string>,
}));
async function llamar(nombre: string, args: Record<string, unknown> = {}) {
  const r = await cliente.callTool({ name: nombre, arguments: args }, undefined, { timeout: 600_000 });
  const contenido = r.content as { type: string; text?: string; data?: string }[];
  const texto = contenido.find((c) => c.type === "text")?.text ?? "";
  let datos: any = null;
  try { datos = JSON.parse(texto); } catch { /* texto libre */ }
  return { error: r.isError === true, texto, datos, contenido };
}
const id = (await llamar("crear_con_formato", { nombre: "prueba_fase6" })).datos.id;
const titulos = async () => (await llamar("leer_presentacion", { documento: id })).datos.diapositivas.filter((d: any) => !d.saltada || !d.notas.startsWith("atril:")).map((d: any) => (d.saltada ? "~" : "") + d.titulo);
const nueva = async (titulo: string) => (await llamar("diapositiva_tabla", { documento: id, antetitulo: "Fase 6", titulo, notas: "Guion." })).datos.diapositiva as number;

// --- 1. Manejo de diapositivas ---
for (const t of ["A", "B", "C"]) await llamar("diapositiva_contenido", { documento: id, antetitulo: "x", titulo: t, cuerpo: t, notas: "Guion." });
const m = await llamar("mover_diapositiva", { documento: id, diapositiva: 3, despues_de: 0 });
revisar("mover_diapositiva C al principio", !m.error && m.datos.ahora === 1 && (await titulos()).slice(0, 3).join("") === "CAB", (await titulos()).slice(0, 3).join(","));
const o = await llamar("ocultar_diapositiva", { documento: id, diapositiva: 2 });
revisar("ocultar_diapositiva", !o.error && (await titulos())[1] === "~A", (await titulos()).slice(0, 3).join(","));
await llamar("ocultar_diapositiva", { documento: id, diapositiva: 2, ocultar: false });
const b = await llamar("borrar_diapositiva", { documento: id, diapositiva: 1 });
revisar("borrar_diapositiva", !b.error && (await titulos()).slice(0, 2).join("") === "AB", (await titulos()).slice(0, 2).join(","));
const total = (await llamar("listar_presentaciones_abiertas")).datos.find((d: any) => d.id === id).diapositivas;
const proto = await llamar("borrar_diapositiva", { documento: id, diapositiva: total });
revisar("borrar un prototipo → error", proto.error && proto.texto.includes("prototipo"), proto.texto.slice(0, 80));
const fuera = await llamar("mover_diapositiva", { documento: id, diapositiva: 1, despues_de: 50 });
revisar("mover más allá del final → error", fuera.error, fuera.texto.slice(0, 70));

// --- 2. Ecuaciones ---
const nE = await nueva("Ecuaciones");
const e1 = await llamar("ecuacion", { documento: id, diapositiva: nE, latex: String.raw`\delta = \frac{N_{\mathrm{obs}}}{\langle N_{\mathrm{rand}} \rangle} - 1`, tamano: 28, y: 140 });
const e2 = await llamar("ecuacion", { documento: id, diapositiva: nE, latex: String.raw`\delta = \frac{N_{\mathrm{obs}}}{\langle N_{\mathrm{rand}} \rangle} - 1`, tamano: 56, y: 260, color: "acento" });
revisar("ecuacion se inserta y se centra", !e1.error && Math.abs(e1.datos.x + e1.datos.ancho / 2 - 480) <= 2, e1.error ? e1.texto : JSON.stringify(e1.datos && [e1.datos.x, e1.datos.ancho]));
revisar("el tamaño de letra escala la ecuación (56 pt ≈ 2 × 28 pt)", !e2.error && Math.abs(e2.datos.ancho / e1.datos.ancho - 2) < 0.15, `${e1.datos?.ancho} → ${e2.datos?.ancho}`);
const eMal = await llamar("ecuacion", { documento: id, diapositiva: nE, latex: String.raw`\frac{1}{` });
revisar("LaTeX con error → mensaje de LaTeX", eMal.error && eMal.texto.includes("LaTeX no compiló"), eMal.texto.slice(0, 100));
const eArchivo = await llamar("ecuacion", { documento: id, diapositiva: nE, latex: String.raw`\input{/etc/passwd}` });
revisar("LaTeX que lee archivos → rechazado", eArchivo.error && eArchivo.texto.includes("archivos"), eArchivo.texto.slice(0, 80));
const ePaq = await llamar("ecuacion", { documento: id, diapositiva: nE, latex: "x", paquetes: ["amsmath}\\input{x"] });
revisar("paquete con nombre no válido → rechazado", ePaq.error, ePaq.texto.slice(0, 70));
const eSiunitx = await llamar("ecuacion", { documento: id, diapositiva: nE, latex: String.raw`R = \qty{3}{Mpc}`, paquetes: ["siunitx"], tamano: 20, y: 400 });
revisar("ecuacion con paquete extra (siunitx)", !eSiunitx.error, eSiunitx.texto.slice(0, 80));

// --- 3. Figuras ---
const nF = await nueva("Figuras");
const formas: [string, Record<string, unknown>][] = [
  ["rectangulo", { x: 60, y: 140, ancho: 200, alto: 100, relleno: "cabecera", borde: "acento2", texto: "Texto encima" }],
  ["rectangulo_redondeado", { x: 300, y: 140, ancho: 200, alto: 100 }],
  ["elipse", { x: 540, y: 140, ancho: 120, alto: 120, relleno: "acento", opacidad: 40, punteado: true }],
  ["triangulo", { x: 700, y: 140, ancho: 120, alto: 100, relleno: "exito" }],
  ["linea", { x1: 60, y1: 320, x2: 400, y2: 320 }],
  ["flecha", { x1: 60, y1: 380, x2: 400, y2: 440, borde: "acento2" }],
  ["flecha_doble", { x1: 500, y1: 400, x2: 880, y2: 400, grosor: 2, punteado: true }],
];
for (const [tipo, args] of formas) {
  const r = await llamar("forma", { documento: id, diapositiva: nF, tipo, ...args });
  revisar(`forma ${tipo}`, !r.error, r.error ? r.texto : "");
}
const dF = (await llamar("leer_presentacion", { documento: id, desde: nF, hasta: nF, detalle: true })).datos.diapositivas[0];
revisar("7 figuras como imágenes vectoriales + el texto encima", dF.conteo.imagen === 7 && dF.objetos.some((x: any) => x.texto === "Texto encima"), JSON.stringify(dF.conteo));
const fColor = await llamar("forma", { documento: id, diapositiva: nF, tipo: "rectangulo", x: 0, y: 0, ancho: 10, alto: 10, relleno: "morado" });
revisar("color fuera de la paleta → error con la lista", fColor.error && fColor.texto.includes("acento"), fColor.texto.slice(0, 80));
const fLinea = await llamar("forma", { documento: id, diapositiva: nF, tipo: "flecha", x1: 0, y1: 0 });
revisar("flecha sin x2/y2 → error", fLinea.error, fLinea.texto.slice(0, 60));

// --- 4. Componentes ---
const nC = await nueva("Cifras");
const c1 = await llamar("cifras_destacadas", { documento: id, diapositiva: nC, cifras: [{ valor: "0.13", etiqueta: "σ real", color: "acento" }, { valor: "+0.2", etiqueta: "δ3D\ncon σ real" }] });
revisar("cifras_destacadas", !c1.error, c1.texto.slice(0, 60));
const nT = await nueva("Tarjetas");
const t1 = await llamar("tarjetas_numeradas", { documento: id, diapositiva: nT, tarjetas: [{ encabezado: "1", texto: "Primera" }, { encabezado: "2", texto: "Segunda" }, { encabezado: "3", texto: "Tercera" }] });
revisar("tarjetas_numeradas", !t1.error, t1.texto.slice(0, 60));
const t5 = await llamar("tarjetas_numeradas", { documento: id, diapositiva: nT, tarjetas: Array.from({ length: 5 }, (_, i) => ({ encabezado: String(i), texto: "x" })) });
revisar("5 tarjetas → error", t5.error);
const nA = await nueva("Agenda");
const ag = await llamar("agenda", { documento: id, diapositiva: nA, puntos: [{ titulo: "Uno", descripcion: "a" }, { titulo: "Dos" }, { titulo: "Tres", descripcion: "c" }] });
revisar("agenda", !ag.error, ag.texto.slice(0, 60));
const vSinOrigen = await llamar("diapositiva_video", { documento: id, titulo: "Video", video: VIDEO, origen: " ", observar: ["x"] });
revisar("diapositiva_video sin pie de origen → error", vSinOrigen.error, vSinOrigen.texto.slice(0, 60));
const vid = await llamar("diapositiva_video", { documento: id, titulo: "Barrido", video: VIDEO, origen: "Elaboración propia", observar: ["Uno", "Dos"], notas: "Guion." });
revisar("diapositiva_video", !vid.error, vid.texto.slice(0, 60));
const dV = (await llamar("leer_presentacion", { documento: id, desde: vid.datos.diapositiva, hasta: vid.datos.diapositiva, detalle: true })).datos.diapositivas[0];
revisar("el video, su tarjeta y «QUÉ OBSERVAR»", dV.conteo.video === 1 && dV.conteo.imagen === 1 && dV.objetos.some((x: any) => x.texto === "QUÉ OBSERVAR"), JSON.stringify(dV.conteo));

// --- 5. Estilo de texto ---
const iTit = (await llamar("leer_presentacion", { documento: id, desde: nC, hasta: nC, detalle: true })).datos.diapositivas[0].objetos.find((x: any) => x.texto === "0.13").indice;
const es = await llamar("estilo_texto", { documento: id, diapositiva: nC, indice: iTit, tamano: 40, color: "exito", cursiva: true });
revisar("estilo_texto: tamaño, color, cursiva (conserva la negrita)", !es.error && es.datos.fuente === fuentePS(TEMA.fuentes.titulo, true, true) && es.datos.tamano === 40, es.texto.slice(0, 120));
const esMal = await llamar("estilo_texto", { documento: id, diapositiva: nC, indice: 99, tamano: 10 });
revisar("estilo_texto con índice inexistente → error", esMal.error);

// --- 6. Tablas: leer y editar ---
const nTb = await nueva("Tabla");
await llamar("tabla", { documento: id, diapositiva: nTb, filas: [["Caso", "δ2D"], ["Campo A", "+0.06"], ["Campo B", "−0.02"]] });
const ed = await llamar("editar_celdas", { documento: id, diapositiva: nTb, celdas: [{ fila: 2, columna: 2, valor: "+0.31" }, { fila: 3, columna: 1, valor: "Simulación" }] });
revisar("editar_celdas", !ed.error, ed.texto.slice(0, 60));
const celdas = (await llamar("leer_presentacion", { documento: id, desde: nTb, hasta: nTb, detalle: true })).datos.diapositivas[0].objetos.find((x: any) => x.tipo === "tabla").celdas;
revisar("leer_presentacion trae las celdas, con signos intactos", JSON.stringify(celdas) === JSON.stringify([["Caso", "δ2D"], ["Campo A", "+0.31"], ["Simulación", "−0.02"]]), JSON.stringify(celdas));
const edMal = await llamar("editar_celdas", { documento: id, diapositiva: nTb, celdas: [{ fila: 9, columna: 1, valor: "x" }] });
revisar("celda inexistente → error", edMal.error, edMal.texto.slice(0, 60));

// --- 7. Presentar (opcional: ocupa la pantalla) ---
if (PRESENTAR) {
  const ini = await llamar("presentar", { accion: "iniciar", documento: id, desde: 1 });
  await new Promise((r) => setTimeout(r, 2000));
  const sig = await llamar("presentar", { accion: "siguiente" });
  await new Promise((r) => setTimeout(r, 1500));
  const det = await llamar("presentar", { accion: "detener" });
  revisar("presentar: iniciar, siguiente, detener", !ini.error && !sig.error && !det.error, [ini.texto, sig.texto, det.texto].map((t) => t.slice(0, 40)).join(" | "));
}
const sinCurso = await llamar("presentar", { accion: "siguiente" });
revisar("siguiente sin presentación en curso → error", sinCurso.error, sinCurso.texto.slice(0, 60));

// --- 8. Revisión: las figuras y ecuaciones no piden pie de origen ---
const rv = await llamar("revisar_presentacion", { documento: id });
const graves = rv.datos.problemas.filter((p: any) => p.gravedad !== "baja");
revisar("revisar_presentacion sin problemas graves", graves.length === 0, graves.map((p: any) => `${p.diapositiva}:${p.tipo}: ${p.detalle.slice(0, 60)}`).join(" | "));
const hoja = rv.contenido.find((c) => c.type === "image");
if (hoja?.data) writeFileSync(join(SALIDA, "hoja.png"), Buffer.from(hoja.data, "base64"));
await llamar("guardar", { documento: id });
await llamar("cerrar", { documento: id });
await cliente.close();
const icloudDespues = existsSync(ICLOUD) ? readdirSync(ICLOUD).sort().join("|") : "";
revisar("no aparecen borradores en iCloud", icloudDespues === icloudAntes);
console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLA(S)`);
process.exit(fallos === 0 ? 0 : 1);
