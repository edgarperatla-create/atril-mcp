// Verificación de revisar_presentacion: una presentación con un problema puesto a
// propósito en cada diapositiva, más diapositivas limpias que no deben dar falsos positivos.
//
//   node test/fase5.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAPOSITIVAS_PPTX, recursos } from "./recursos.ts";

const R = await recursos();

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TRABAJO = join(RAIZ, "trabajo", "prueba_fase5");
const FIG = R.figura;
const ICLOUD = join(homedir(), "Library/Mobile Documents/com~apple~Keynote/Documents");

let fallos = 0;
function revisar(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK  " : "FALLA"} ${nombre}${detalle ? " — " + detalle : ""}`);
}
rmSync(TRABAJO, { recursive: true, force: true });
const icloudAntes = existsSync(ICLOUD) ? readdirSync(ICLOUD).sort().join("|") : "";
const cliente = new Client({ name: "verificar-fase5", version: "0" });
await cliente.connect(new StdioClientTransport({
  command: process.execPath, args: [join(RAIZ, "src/index.ts")],
  env: { ...process.env, ATRIL_DIR: TRABAJO } as Record<string, string>,
}));
async function llamar(nombre: string, args: Record<string, unknown> = {}) {
  const r = await cliente.callTool({ name: nombre, arguments: args }, undefined, { timeout: 600_000 });
  const contenido = r.content as { type: string; text?: string }[];
  const texto = contenido.find((c) => c.type === "text")?.text ?? "";
  let datos: any = null;
  try { datos = JSON.parse(texto); } catch { /* texto libre */ }
  return { error: r.isError === true, texto, datos, contenido };
}

const id = (await llamar("crear_con_formato", { nombre: "prueba_fase5" })).datos.id;
const nota = "Guion.";
const dia = async (herr: string, args: Record<string, unknown>) => (await llamar(herr, { documento: id, notas: nota, ...args })).datos.diapositiva as number;
const esperado: Record<number, string | null> = {};

// Limpias: no deben dar ningún problema.
esperado[await dia("diapositiva_portada", { antetitulo: "Prueba", titulo: "Revisión", subtitulo: "Fase 5", autor: "Atril" })] = null;
esperado[await dia("diapositiva_contenido", { antetitulo: "Limpia", titulo: "Doce viñetas que caben", cuerpo: Array.from({ length: 12 }, (_, i) => `Viñeta ${i + 1}: texto de longitud mediana que ocupa buena parte de la línea`).join("\n") })] = null;
esperado[await dia("diapositiva_figura", { antetitulo: "Limpia", titulo: "Figura con pie", imagen: FIG, origen: "Elaboración propia", cuerpo: "Una idea" })] = null;

// Con un problema cada una.
let n = await dia("diapositiva_tabla", { antetitulo: "Problema", titulo: "Figura sin pie" });
await llamar("insertar_medio", { documento: id, diapositiva: n, archivo: FIG, x: 200, y: 140, ancho: 400 });
esperado[n] = "figura sin pie de origen";

n = await dia("diapositiva_tabla", { antetitulo: "Problema", titulo: "Pisa el pie" });
await llamar("insertar_medio", { documento: id, diapositiva: n, archivo: FIG, x: 200, y: 380, ancho: 260 });
await llamar("poner_texto", { documento: id, diapositiva: n, nuevo_cuadro: { texto: "Elaboración propia", x: 200, y: 510, ancho: 260 } });
esperado[n] = "pisa el pie";

n = await dia("diapositiva_tabla", { antetitulo: "Problema", titulo: "Texto que se sale" });
await llamar("poner_texto", { documento: id, diapositiva: n, nuevo_cuadro: { texto: Array.from({ length: 20 }, () => "Una línea de texto").join("\n"), x: 100, y: 200, ancho: 400 } });
esperado[n] = "fuera de la diapositiva";

n = await dia("diapositiva_contenido", { antetitulo: "Problema", titulo: "Cuerpo encogido", cuerpo: Array.from({ length: 25 }, (_, i) => `Viñeta ${i + 1}: texto largo que ocupa casi toda la línea del cuerpo de la diapositiva`).join("\n") });
esperado[n] = "cuerpo encogido";

n = await dia("diapositiva_tabla", { antetitulo: "Problema", titulo: "Contraste bajo" });
await llamar("poner_texto", { documento: id, diapositiva: n, nuevo_cuadro: { texto: "Texto casi invisible", x: 100, y: 200, ancho: 500 } });
const dC = (await llamar("leer_presentacion", { documento: id, desde: n, hasta: n, detalle: true })).datos.diapositivas[0];
const iC = dC.objetos.find((o: any) => o.texto === "Texto casi invisible").indice;
const cambio = await llamar("animar_cambio", { documento: id, diapositiva: n, cambios: [{ tipo: "texto", indice: iC, color_texto: "1C1730" }] });
// animar_cambio deja el cambio en la copia (n+1); la original queda limpia.
esperado[n] = null;
esperado[cambio.datos.a] = "contraste bajo";

n = await dia("diapositiva_tabla", { antetitulo: "Problema", titulo: "Texto de muestra" });
await llamar("poner_texto", { documento: id, diapositiva: n, nuevo_cuadro: { texto: "Viñeta", x: 100, y: 200, ancho: 300 } });
esperado[n] = "texto de muestra";

n = (await llamar("diapositiva_tabla", { documento: id, antetitulo: "Problema", titulo: "Sin notas" })).datos.diapositiva;
esperado[n] = "sin notas";

// --- Revisión ---
const r = await llamar("revisar_presentacion", { documento: id });
revisar("revisar_presentacion responde", !r.error, r.error ? r.texto : JSON.stringify(r.datos.resumen));
revisar("devuelve la hoja de contacto como imagen", r.contenido.some((c) => c.type === "image"));
const problemas = (r.datos?.problemas ?? []) as { diapositiva: number; tipo: string; detalle: string }[];
for (const [nn, tipo] of Object.entries(esperado)) {
  const de = problemas.filter((p) => p.diapositiva === Number(nn));
  if (tipo === null) revisar(`diapositiva ${nn} limpia: sin problemas`, de.length === 0, de.map((p) => `${p.tipo}: ${p.detalle}`).join(" | "));
  else revisar(`diapositiva ${nn}: detecta «${tipo}»`, de.some((p) => p.tipo === tipo) && de.every((p) => p.tipo === tipo),
    de.map((p) => `${p.tipo}: ${p.detalle.slice(0, 90)}`).join(" | ") || "nada");
}
const encogido = problemas.find((p) => p.tipo === "cuerpo encogido");
revisar("estima el tamaño efectivo del cuerpo encogido (< 10 pt)", !!encogido && Number(encogido.detalle.match(/~([\d.]+) pt \(estimado\)/)?.[1]) < 10, encogido?.detalle);

await llamar("guardar", { documento: id });
await llamar("cerrar", { documento: id });
await cliente.close();
const icloudDespues = existsSync(ICLOUD) ? readdirSync(ICLOUD).sort().join("|") : "";
revisar("no aparecen borradores en iCloud", icloudDespues === icloudAntes);
console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLA(S)`);
process.exit(fallos === 0 ? 0 : 1);
