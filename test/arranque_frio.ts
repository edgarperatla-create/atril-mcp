// Arranque en frío: Keynote cerrado antes de cada llamada a Atril (por MCP real).
//
//   node test/arranque_frio.ts [repeticiones]
//
// CIERRA KEYNOTE. Solo correrlo sin documentos abiertos en Keynote (los cierra sin preguntar):
// si hay alguno abierto, se detiene sin cerrar nada.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAPOSITIVAS_PPTX, recursos } from "./recursos.ts";

const R = await recursos();

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const N = Number(process.argv[2] ?? 3);
const PPTX = R.pptx;
const TRABAJO = join(RAIZ, "trabajo", "prueba_frio");
const ICLOUD = join(homedir(), "Library/Mobile Documents/com~apple~Keynote/Documents");

let fallos = 0;
function revisar(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "OK  " : "FALLA"} ${nombre}${detalle ? " — " + detalle : ""}`);
}
const vivo = () => spawnSync("pgrep", ["-x", "Keynote"]).status === 0;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cerrarKeynote() {
  if (!vivo()) return;
  const abiertos = execFileSync("osascript", ["-l", "JavaScript", "-e",
    'JSON.stringify(Application("com.apple.Keynote").documents.name())']).toString().trim();
  if (abiertos !== "[]") throw new Error(`Keynote tiene documentos abiertos ${abiertos}; no lo cierro.`);
  execFileSync("osascript", ["-e", 'tell application id "com.apple.Keynote" to quit']);
  for (let i = 0; i < 60 && vivo(); i++) await espera(500);
  if (vivo()) throw new Error("Keynote no se cerró en 30 s");
  await espera(1000);
}

rmSync(TRABAJO, { recursive: true, force: true });
const icloudAntes = existsSync(ICLOUD) ? readdirSync(ICLOUD).sort().join("|") : "";

const cliente = new Client({ name: "arranque-frio", version: "0" });
await cliente.connect(new StdioClientTransport({
  command: process.execPath, args: [join(RAIZ, "src/index.ts")],
  env: { ...process.env, ATRIL_DIR: TRABAJO } as Record<string, string>,
}));
async function llamar(nombre: string, args: Record<string, unknown> = {}) {
  const t0 = Date.now();
  const r = await cliente.callTool({ name: nombre, arguments: args });
  const texto = (r.content as { type: string; text?: string }[]).find((c) => c.type === "text")?.text ?? "";
  let datos: any = null;
  try { datos = JSON.parse(texto); } catch { /* error en texto libre */ }
  return { error: r.isError === true, texto, datos, ms: Date.now() - t0 };
}

for (let i = 1; i <= N; i++) {
  await cerrarKeynote();
  const l = await llamar("listar_presentaciones_abiertas");
  revisar(`#${i} frío → listar`, !l.error && Array.isArray(l.datos) && vivo(), l.error ? l.texto : `${l.ms} ms, ${l.datos.length} abiertas`);

  await cerrarKeynote();
  const c = await llamar("crear", { tema: "Basic White", nombre: `frio_${i}` });
  revisar(`#${i} frío → crear`, !c.error && c.datos.editable, c.error ? c.texto : `${c.ms} ms`);
  if (!c.error) await llamar("cerrar", { documento: c.datos.id });

  await cerrarKeynote();
  const a = await llamar("abrir", { ruta: PPTX });
  revisar(`#${i} frío → abrir .pptx`, !a.error && a.datos.diapositivas === DIAPOSITIVAS_PPTX && a.datos.editable, a.error ? a.texto : `${a.ms} ms, ${a.datos.diapositivas} diapositivas`);
  if (!a.error) await llamar("cerrar", { documento: a.datos.id });
}
// En caliente, con un .pptx que Keynote nunca ha abierto (cada abrir crea una copia
// nueva). Con el open de AppleScript este caso mostraba "can't be imported".
for (let i = 1; i <= N; i++) {
  const a = await llamar("abrir", { ruta: PPTX });
  revisar(`#${i} caliente → abrir .pptx nunca visto`, !a.error && a.datos.diapositivas === DIAPOSITIVAS_PPTX, a.error ? a.texto : `${a.ms} ms, ${a.datos.copia.split("/").pop()}`);
  if (!a.error) await llamar("cerrar", { documento: a.datos.id });
}
await cliente.close();
await cerrarKeynote();

const icloudDespues = existsSync(ICLOUD) ? readdirSync(ICLOUD).sort().join("|") : "";
revisar("no aparecen borradores en iCloud", icloudDespues === icloudAntes, icloudDespues === icloudAntes ? "" : icloudDespues);
console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLA(S)`);
process.exit(fallos === 0 ? 0 : 1);
