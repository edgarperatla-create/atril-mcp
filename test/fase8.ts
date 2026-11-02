// Prueba 8: lo que faltaba de los menús (fase7/MENUS.md), por MCP real.
//
//   node test/fase8.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAPOSITIVAS_PPTX, recursos } from "./recursos.ts";

const R = await recursos();

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TRABAJO = join(RAIZ, "trabajo", "prueba_fase8");
const SALIDA = join(RAIZ, "trabajo", "evidencia", "fase8");

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
const cliente = new Client({ name: "verificar-fase8", version: "0" });
await cliente.connect(new StdioClientTransport({
  command: process.execPath, args: [join(RAIZ, "src/index.ts")],
  env: { ...process.env, ATRIL_DIR: TRABAJO } as Record<string, string>,
}));
async function llamar(nombre: string, args: Record<string, unknown> = {}) {
  const r = await cliente.callTool({ name: nombre, arguments: args }, undefined, { timeout: 900_000 });
  const contenido = r.content as { type: string; text?: string; data?: string }[];
  const texto = contenido.find((c) => c.type === "text")?.text ?? "";
  let datos: any = null;
  try { datos = JSON.parse(texto); } catch { /* texto libre */ }
  return { error: r.isError === true, texto, datos, contenido };
}
const id = (await llamar("crear_con_formato", { nombre: "prueba_fase8" })).datos.id;
const nueva = async (titulo: string) => (await llamar("diapositiva_tabla", { documento: id, antetitulo: "Fase 8", titulo, notas: "Guion con la cifra 0.13." })).datos.diapositiva as number;
const detalle = async (n: number) => (await llamar("leer_presentacion", { documento: id, desde: n, hasta: n, detalle: true })).datos.diapositivas[0];
const celdas = async (n: number) => (await detalle(n)).objetos.find((o: any) => o.tipo === "tabla").celdas;

// --- 1. Tablas ---
const nT = await nueva("Tabla");
await llamar("tabla", { documento: id, diapositiva: nT, filas: [["Caso", "δ2D", "δ3D"], ["A", "+0.06", "+0.21"], ["B", "+0.31", "+0.90"], ["C", "+0.04", "−0.02"]] });
const ord = await llamar("tabla_estructura", { documento: id, diapositiva: nT, accion: "ordenar", columna: 2, descendente: true });
revisar("ordenar por δ2D descendente (cabecera arriba)", !ord.error && JSON.stringify((await celdas(nT)).map((f: string[]) => f[0])) === JSON.stringify(["Caso", "B", "A", "C"]), JSON.stringify((await celdas(nT)).map((f: string[]) => f[0])));
const anchoAntes = (await detalle(nT)).objetos.find((o: any) => o.tipo === "tabla").ancho;
const af = await llamar("tabla_estructura", { documento: id, diapositiva: nT, accion: "agregar_filas", cantidad: 2 });
const ac = await llamar("tabla_estructura", { documento: id, diapositiva: nT, accion: "agregar_columnas" });
const tb = (await detalle(nT)).objetos.find((o: any) => o.tipo === "tabla");
revisar("agregar 2 filas y 1 columna: 6×4 y la tabla conserva su ancho", !af.error && !ac.error && ac.datos.filas === 6 && ac.datos.columnas === 4 && Math.abs(tb.ancho - anchoAntes) <= 2, `${ac.datos?.filas}×${ac.datos?.columnas}, ancho ${anchoAntes} → ${tb.ancho}`);
await llamar("editar_celdas", { documento: id, diapositiva: nT, celdas: [{ fila: 1, columna: 4, valor: "" }] });
const fu = await llamar("tabla_estructura", { documento: id, diapositiva: nT, accion: "fusionar", rango: "C1:D1" });
const se = await llamar("tabla_estructura", { documento: id, diapositiva: nT, accion: "separar", rango: "C1:D1" });
revisar("fusionar y separar un rango de la cabecera", !fu.error && !se.error, [fu.texto, se.texto].map((t) => t.slice(0, 40)).join(" | "));
const qf = await llamar("tabla_estructura", { documento: id, diapositiva: nT, accion: "quitar_fila", fila: 6 });
const qc = await llamar("tabla_estructura", { documento: id, diapositiva: nT, accion: "quitar_columna", columna: 4 });
revisar("quitar una fila y una columna", !qf.error && !qc.error && qc.datos.filas === 5 && qc.datos.columnas === 3, `${qc.datos?.filas}×${qc.datos?.columnas}`);
const malRango = await llamar("tabla_estructura", { documento: id, diapositiva: nT, accion: "fusionar", rango: "A1-B2" });
revisar("rango mal escrito → error", malRango.error, malRango.texto.slice(0, 60));
const malCol = await llamar("tabla_estructura", { documento: id, diapositiva: nT, accion: "ordenar", columna: 9 });
revisar("ordenar por una columna inexistente → error", malCol.error, malCol.texto.slice(0, 60));
const vT = await llamar("ver_diapositiva", { documento: id, diapositiva: nT });
const imgT = vT.contenido.find((c) => c.type === "image");
if (imgT?.data) writeFileSync(join(SALIDA, "tabla.png"), Buffer.from(imgT.data, "base64"));

// --- 2. Buscar y reemplazar ---
const nB = await nueva("La cifra 0.13 en el título");
await llamar("poner_texto", { documento: id, diapositiva: nB, nuevo_cuadro: { texto: "σ_z/(1+z) = 0.13 en el catálogo", x: 60, y: 160, ancho: 500 } });
// Formato mixto de verdad: dos párrafos de distinto color (como un énfasis de color).
await llamar("poner_texto", { documento: id, diapositiva: nB, nuevo_cuadro: { texto: "Mixto: 0.13\nresaltado", x: 60, y: 260, ancho: 500 } });
const iMixto = (await detalle(nB)).objetos.find((o: any) => o.texto === "Mixto: 0.13\nresaltado").indice;
await llamar("estilo_texto", { documento: id, diapositiva: nB, indice: iMixto, parrafo: 2, color: "acento" });
await llamar("tabla", { documento: id, diapositiva: nB, filas: [["Parámetro", "Valor"], ["σ_z/(1+z)", "0.13"]], y: 330, alto: 80 });
const cuenta = await llamar("buscar_reemplazar", { documento: id, buscar: "0.13" });
revisar("buscar sin reemplazar cuenta título, cuadros, notas y celdas", !cuenta.error && cuenta.datos.total >= 5 && !cuenta.datos.reemplazado, `${cuenta.datos?.total} coincidencias`);
const rep = await llamar("buscar_reemplazar", { documento: id, buscar: "0.13", reemplazar: "0.131" });
const d2 = await detalle(nB);
revisar("reemplazar cambia título, cuadro, notas y celda", !rep.error && d2.titulo.includes("0.131") && d2.objetos.some((o: any) => o.texto === "σ_z/(1+z) = 0.131 en el catálogo") && d2.notas.includes("0.131") && d2.objetos.find((o: any) => o.tipo === "tabla").celdas[1][1] === "0.131",
  rep.error ? rep.texto : `${rep.datos.total} cambios, ${rep.datos.sin_cambiar_por_formato_mixto.length} mixtos`);
revisar("el texto con formato mixto no se reescribe y se reporta", !rep.error && d2.objetos.some((o: any) => o.texto === "Mixto: 0.13\nresaltado") && rep.datos.sin_cambiar_por_formato_mixto.length === 1,
  JSON.stringify(rep.datos?.sin_cambiar_por_formato_mixto?.map((m: any) => m.donde)));
const forzado = await llamar("buscar_reemplazar", { documento: id, buscar: "Mixto: 0.13", reemplazar: "Mixto: 0.131", forzar: true });
revisar("con forzar sí se reescribe", !forzado.error && (await detalle(nB)).objetos.some((o: any) => o.texto === "Mixto: 0.131\nresaltado"), forzado.texto.slice(0, 80));
const nada = await llamar("buscar_reemplazar", { documento: id, buscar: "inexistente-xyz" });
revisar("buscar algo que no está → 0", !nada.error && nada.datos.total === 0);
const sinCambio = await llamar("buscar_reemplazar", { documento: id, buscar: "0.131", reemplazar: "0.131" });
revisar("reemplazar con lo mismo no rompe nada", !sinCambio.error);

// --- 3. Alinear, distribuir, girar, bloquear ---
const nA = await nueva("Alinear y distribuir");
for (const [x, y] of [[60, 150], [300, 200], [700, 170]]) await llamar("forma", { documento: id, diapositiva: nA, tipo: "rectangulo_redondeado", x, y, ancho: 120, alto: 80 });
const imgs = [1, 2, 3].map((i) => ({ tipo: "imagen", indice: i }));
const al = await llamar("alinear_objetos", { documento: id, diapositiva: nA, objetos: imgs, modo: "arriba" });
const yAl = (await detalle(nA)).objetos.filter((o: any) => o.tipo === "imagen").map((o: any) => o.y);
revisar("alinear arriba: misma y", !al.error && new Set(yAl).size === 1, yAl.join(","));
const di = await llamar("distribuir_objetos", { documento: id, diapositiva: nA, objetos: imgs, eje: "horizontal" });
const xs = (await detalle(nA)).objetos.filter((o: any) => o.tipo === "imagen").map((o: any) => [o.x, o.ancho]).sort((a: number[], b: number[]) => a[0] - b[0]);
const huecos = [xs[1][0] - (xs[0][0] + xs[0][1]), xs[2][0] - (xs[1][0] + xs[1][1])];
revisar("distribuir en horizontal: huecos iguales", !di.error && Math.abs(huecos[0] - huecos[1]) <= 2, huecos.join(","));
const ce = await llamar("alinear_objetos", { documento: id, diapositiva: nA, objetos: [{ tipo: "imagen", indice: 2 }], modo: "centro", respecto: "diapositiva" });
const i2 = (await detalle(nA)).objetos.filter((o: any) => o.tipo === "imagen")[1];
revisar("centrar uno en la diapositiva", !ce.error && Math.abs(i2.x + i2.ancho / 2 - 480) <= 2, `${i2.x}+${i2.ancho}/2`);
const gi = await llamar("mover_objeto", { documento: id, diapositiva: nA, tipo: "imagen", indice: 3, rotacion: -15 });
revisar("girar −15° (queda en 345°)", !gi.error && gi.datos.rotacion === 345, gi.texto.slice(0, 80));
const bl = await llamar("bloquear_objeto", { documento: id, diapositiva: nA, tipo: "imagen", indice: 1 });
revisar("bloquear un objeto", !bl.error && bl.datos.bloqueado === true);
const unoSolo = await llamar("alinear_objetos", { documento: id, diapositiva: nA, objetos: [{ tipo: "imagen", indice: 1 }], modo: "izquierda" });
revisar("alinear un solo objeto entre sí → error", unoSolo.error);
const dosDist = await llamar("distribuir_objetos", { documento: id, diapositiva: nA, objetos: imgs.slice(0, 2), eje: "vertical" });
revisar("distribuir dos objetos → error", dosDist.error);

// --- 4. Figuras nuevas ---
const nF = await nueva("Figuras nuevas");
const nuevas: [string, Record<string, unknown>][] = [
  ["rombo", { x: 60, y: 140, ancho: 150, alto: 120, relleno: "acento2", opacidad: 60 }],
  ["poligono", { x: 250, y: 140, ancho: 130, alto: 130, lados: 6, relleno: "tarjeta2", borde: "acento", grosor: 2 }],
  ["estrella", { x: 420, y: 140, ancho: 130, alto: 130, lados: 5, relleno: "acento" }],
  ["triangulo_rectangulo", { x: 600, y: 140, ancho: 130, alto: 110, relleno: "exito", opacidad: 70 }],
  ["bocadillo", { x: 120, y: 300, ancho: 320, alto: 140, cola: "abajo", texto: "¿Se observa\nel exceso?" }],
  ["bocadillo", { x: 520, y: 300, ancho: 320, alto: 120, cola: "izquierda", relleno: "cabecera", borde: "acento2", texto: "Cola a la izquierda" }],
];
for (const [tipo, a] of nuevas) {
  const r = await llamar("forma", { documento: id, diapositiva: nF, tipo, ...a });
  revisar(`forma ${tipo}${a.cola ? ` (cola ${a.cola})` : ""}`, !r.error, r.error ? r.texto : "");
}
const malLados = await llamar("forma", { documento: id, diapositiva: nF, tipo: "poligono", x: 0, y: 0, ancho: 10, alto: 10, lados: 2 });
revisar("polígono de 2 lados → error", malLados.error);
const vF = await llamar("ver_diapositiva", { documento: id, diapositiva: nF });
const imgF = vF.contenido.find((c) => c.type === "image");
if (imgF?.data) writeFileSync(join(SALIDA, "figuras_nuevas.png"), Buffer.from(imgF.data, "base64"));

// --- 5. Diapositivas desde imágenes ---
const antes = (await llamar("listar_presentaciones_abiertas")).datos.find((d: any) => d.id === id).diapositivas;
const sinOrigen = await llamar("diapositivas_desde_imagenes", { documento: id, imagenes: [R.figuras[0]] });
revisar("con formato y sin origen → error", sinOrigen.error, sinOrigen.texto.slice(0, 70));
const di3 = await llamar("diapositivas_desde_imagenes", { documento: id, imagenes: R.figuras, origen: "Elaboración propia", antetitulo: "Serie" });
const despues = (await llamar("listar_presentaciones_abiertas")).datos.find((d: any) => d.id === id).diapositivas;
revisar("3 imágenes → 3 diapositivas de figura con pie", !di3.error && despues === antes + 3 && di3.datos.con_formato, di3.error ? di3.texto : di3.datos.diapositivas.join(","));
if (!di3.error) {
  const f1 = await detalle(di3.datos.diapositivas[0]);
  revisar("la primera trae título del archivo, figura y pie", f1.titulo === "serie 1" && f1.conteo.imagen === 1 && f1.objetos.some((o: any) => o.texto === "Elaboración propia"), `${f1.titulo} ${JSON.stringify(f1.conteo)}`);
}

// --- 6. Exportar HTML, Keynote ’09 y GIF ---
const html = await llamar("exportar", { documento: id, formato: "html" });
revisar("exportar HTML (carpeta con index)", !html.error && existsSync(html.datos.destino) && (html.datos.archivos ?? []).some((f: string) => /index\.html?$/i.test(f) || f.endsWith(".html")), html.error ? html.texto : (html.datos.archivos ?? []).slice(0, 4).join(", "));
const k09 = await llamar("exportar", { documento: id, formato: "keynote09" });
revisar("exportar Keynote ’09", !k09.error && existsSync(k09.datos.destino), k09.error ? k09.texto : k09.datos.destino);
const gif = await llamar("exportar", { documento: id, formato: "gif", destino: join(SALIDA, "presentacion.gif") });
const cabecera = gif.error ? "" : readFileSync(gif.datos.destino).subarray(0, 6).toString("latin1");
revisar("exportar GIF animado", !gif.error && cabecera === "GIF89a" && statSync(gif.datos.destino).size > 10_000, gif.error ? gif.texto : `${cabecera}, ${(statSync(gif.datos.destino).size / 1e6).toFixed(1)} MB`);

const rv = await llamar("revisar_presentacion", { documento: id });
const graves = rv.datos.problemas.filter((p: any) => p.gravedad === "alta");
revisar("revisar_presentacion sin problemas de gravedad alta", graves.length === 0, graves.map((p: any) => `${p.diapositiva}:${p.tipo}: ${p.detalle.slice(0, 50)}`).join(" | "));
await llamar("guardar", { documento: id });
await llamar("cerrar", { documento: id });
await cliente.close();
const icloudDespues = existsSync(ICLOUD) ? readdirSync(ICLOUD).sort().join("|") : "";
revisar("no aparecen borradores en iCloud", icloudDespues === icloudAntes);
console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLA(S)`);
process.exit(fallos === 0 ? 0 : 1);
