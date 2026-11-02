// Convierte <tema>/plantilla.pptx en <tema>/plantilla.key con Keynote: los maestros quedan
// como diseños con nombre y los prototipos como diapositivas ocultas.
//
//   npm run plantilla [-- <tema>]   (primero genera el .pptx con construir_plantilla.cjs)
import { execFileSync } from "node:child_process";
import { copyFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Antes de cargar src/: el tema y la carpeta de trabajo se leen al importar.
const arg = process.argv[2];
if (arg) process.env.ATRIL_TEMA = arg.includes("/") ? resolve(arg) : arg;
process.env.ATRIL_DIR = join(dirname(fileURLToPath(import.meta.url)), ".importar");
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "construir_plantilla.cjs"), ...(process.env.ATRIL_TEMA ? [process.env.ATRIL_TEMA] : [])], { stdio: "inherit" });
const { TEMA } = await import("../src/tema.ts");
const h = await import("../src/herramientas.ts");
const { jxa } = await import("../src/keynote.ts");

await rm(process.env.ATRIL_DIR, { recursive: true, force: true });
const a = await h.abrir(join(TEMA.dir, "plantilla.pptx"));
const r = await jxa<{ disenos: string[]; prototipos: string[] }>(`
const d = doc(p.id);
d.slides().forEach((s) => { s.skipped = true; });
return { disenos: d.slideLayouts.name(), prototipos: d.slides.presenterNotes() };`, { id: a.id });
await h.guardar(a.id);
await h.cerrar(a.id);
await copyFile(a.archivo!, TEMA.plantilla);
await rm(process.env.ATRIL_DIR, { recursive: true, force: true });
console.log("->", TEMA.plantilla);
console.log("diseños:", r.disenos.join(", "));
console.log("prototipos:", r.prototipos.join(", "));
