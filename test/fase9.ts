// Gráficas científicas (matplotlib → PDF vectorial), por MCP real.
//
//   node test/fase9.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TEMA } from "../src/tema.ts";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TRABAJO = join(RAIZ, "trabajo", "prueba_fase9");
const SALIDA = join(RAIZ, "trabajo", "evidencia", "fase9");
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
const cliente = new Client({ name: "verificar-fase9", version: "0" });
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
async function vista(n: number, nombre: string) {
  const v = await llamar("ver_diapositiva", { documento: id, diapositiva: n });
  const img = v.contenido.find((c) => c.type === "image");
  if (img?.data) writeFileSync(join(SALIDA, nombre), Buffer.from(img.data, "base64"));
  return !!img?.data;
}
const tamanoPdf = (f: string) => {
  const s = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", f], { encoding: "utf8" });
  return [Number(s.match(/pixelWidth: ([\d.]+)/)?.[1]), Number(s.match(/pixelHeight: ([\d.]+)/)?.[1])].map(Math.round);
};
const id = (await llamar("crear_con_formato", { nombre: "prueba_fase9" })).datos.id;
const objetos = async (n: number) => (await llamar("leer_presentacion", { documento: id, desde: n, hasta: n, detalle: true })).datos.diapositivas[0].objetos as any[];

const z = [0.5, 1, 1.5, 2, 2.5, 3, 3.5];
const base = {
  series: [
    { nombre: "Observado", x: z, y: [0.9, 0.62, 0.45, 0.31, 0.24, 0.18, 0.12], error_y: { inf: [0.08, 0.06, 0.05, 0.04, 0.04, 0.05, 0], sup: [0.1, 0.07, 0.05, 0.05, 0.04, 0.05, 0] }, tipo: "puntos", limite_superior: [false, false, false, false, false, false, true] },
    { nombre: "Modelo $\\Lambda$CDM", x: z, y: [0.95, 0.6, 0.43, 0.32, 0.25, 0.19, 0.15], estilo_linea: "discontinua" },
    { nombre: "$1\\sigma$", tipo: "banda", x: z, y_inf: [0.85, 0.55, 0.39, 0.28, 0.21, 0.16, 0.12], y_sup: [1.05, 0.66, 0.48, 0.36, 0.29, 0.22, 0.18], color: "acento2" },
  ],
  eje_x: { titulo: "Corrimiento al rojo $z$" },
  eje_y: { titulo: "$\\sigma_{\\delta,\\,\\mathrm{3D}}$", escala: "log" },
  lineas_ref: [{ eje: "x", valor: 2, etiqueta: "z = 2" }],
};

// --- 1. Diapositiva de figura nueva, a todo el ancho ---
const f1 = await llamar("grafica_cientifica", { documento: id, ...base, antetitulo: "Resultados", titulo: "Dispersión de la sobredensidad", origen: "Datos: simulación propia; gráfica propia", notas: "Guion." });
revisar("figura nueva con barras asimétricas, cota superior, banda y eje log", !f1.error && existsSync(f1.datos?.grafica ?? ""), f1.texto.slice(0, 120));
const [w1, h1] = tamanoPdf(f1.datos.grafica);
revisar("el PDF mide la caja de la figura (12.1×4.6 in) y se inserta sin escalar", w1 === 871 && h1 === 331 && f1.datos.caja_pt.ancho === 871, `${w1}×${h1}, caja ${JSON.stringify(f1.datos.caja_pt)}`);
const o1 = await objetos(f1.datos.diapositiva);
revisar("lleva la gráfica, la tarjeta y el pie de origen", o1.some((o) => o.tipo === "imagen" && /graf_/.test(o.archivo ?? "")) && o1.some((o) => o.texto === "Datos: simulación propia; gráfica propia"), o1.map((o) => o.tipo).join(","));
revisar("vista de la figura nueva", await vista(f1.datos.diapositiva, "figura_ancha.png"));

// --- 2. Con viñetas: la gráfica va a la izquierda, a la mitad ---
const f2 = await llamar("grafica_cientifica", {
  documento: id, antetitulo: "Resultados", titulo: "Función de luminosidad", origen: "Elaboración propia",
  cuerpo: "Pendiente más pronunciada en z > 2\nExceso en el extremo brillante",
  series: [{ nombre: "Campo", tipo: "histograma", valores: Array.from({ length: 400 }, (_, i) => 20 + 4 * Math.sin(i * 12.9898) ** 2 + (i % 7) * 0.3), bins: 18 }],
  eje_x: { titulo: "Magnitud $M_{\\mathrm{UV}}$", invertir: true }, eje_y: { titulo: "Número de galaxias" }, leyenda: "ninguna",
});
const [w2] = f2.error ? [0] : tamanoPdf(f2.datos.grafica);
revisar("figura con viñetas: histograma, eje invertido, mitad de ancho (6.55 in)", !f2.error && w2 === 472, f2.error ? f2.texto : `${w2} pt`);
revisar("vista de la figura con viñetas", !f2.error && await vista(f2.datos.diapositiva, "figura_vinetas.png"));

// --- 3. Encima de una diapositiva que ya existe (tinta clara, fondo transparente) ---
const nT = (await llamar("diapositiva_tabla", { documento: id, antetitulo: "Resultados", titulo: "Dos escalas", notas: "Guion." })).datos.diapositiva;
const f3 = await llamar("grafica_cientifica", {
  documento: id, diapositiva: nT,
  series: [
    { nombre: "$\\delta_{\\mathrm{2D}}$", x: [-10, -1, -0.1, 0, 0.1, 1, 10, 100], y: [0.2, 0.5, 0.9, 1, 0.9, 0.5, 0.2, 0.05], tipo: "linea_puntos", marcador: "cuadrado" },
    { nombre: "Fracción", x: [-10, -1, -0.1, 0, 0.1, 1, 10, 100], y: [5, 12, 30, 41, 33, 15, 6, 2], tipo: "escalon", eje: "derecho", color: "#5FBE8D" },
  ],
  eje_x: { titulo: "Contraste", escala: "symlog", umbral_lineal: 0.1, marcas: [-10, -1, 0, 1, 10, 100], etiquetas_marcas: ["−10", "−1", "0", "1", "10", "100"] },
  eje_y: { titulo: "Amplitud", min: 0 }, eje_y2: { titulo: "Fracción (%)" },
  anotaciones: [{ x: 0, y: 1, texto: "pico", dx: 30, dy: -10, flecha: true, color: "acento" }],
  leyenda: "arriba_derecha",
});
revisar("sobre diapositiva existente: symlog, marcas propias, segundo eje, color hex, anotación", !f3.error && /graf_/.test(f3.datos?.grafica ?? ""), f3.texto.slice(0, 120));
const g3 = f3.error ? [] : String(f3.datos.geometria).split(", ").map(Number);
revisar("por omisión ocupa el área de contenido sin escalar", g3[0] === 43 && g3[1] === 133 && g3[2] === 871, String(f3.datos?.geometria));
revisar("vista sobre fondo oscuro", await vista(nT, "sobre_diapositiva.png"));

// --- 4. Errores ---
const casos: [string, Record<string, unknown>, string][] = [
  ["x e y de distinto largo", { diapositiva: nT, series: [{ x: [1, 2, 3], y: [1, 2] }] }, "debe tener 3"],
  ["color desconocido", { diapositiva: nT, series: [{ x: [1], y: [1], color: "turquesa" }] }, "Color desconocido"],
  ["etiquetas sin sus marcas", { diapositiva: nT, series: [{ x: [1], y: [1] }], eje_x: { marcas: [1, 2], etiquetas_marcas: ["a"] } }, "etiquetas_marcas"],
  ["fórmula mal escrita", { diapositiva: nT, series: [{ x: [1, 2], y: [1, 2], nombre: "$\\frac{a$" }] }, "matplotlib"],
  ["diapositiva nueva sin título", { series: [{ x: [1], y: [1] }] }, "antetitulo y titulo"],
];
if (TEMA.origen_obligatorio) casos.push(["diapositiva nueva sin origen (el tema lo exige)", { series: [{ x: [1], y: [1] }], antetitulo: "a", titulo: "b" }, "pie de origen"]);
for (const [nombre, args, espera] of casos) {
  const r = await llamar("grafica_cientifica", { documento: id, ...args });
  revisar(`${nombre} → error`, r.error && r.texto.includes(espera), r.texto.slice(0, 100));
}

// --- 5. Revisión, guardar, iCloud ---
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
