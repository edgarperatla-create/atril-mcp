// Manejo de diapositivas (borrar, mover, ocultar) y modo presentación.
// Los prototipos ocultos de la plantilla (notas "atril:prototipo:…", al final) están protegidos:
// no se borran, no se mueven y nada se coloca después de ellos.
import { documento, editable } from "./herramientas.ts";
import { applescript, jxa } from "./keynote.ts";

async function mapa(id: string) {
  const notas = await jxa<string[]>(`return doc(p.id).slides.presenterNotes();`, { id });
  const primero = notas.findIndex((n) => n.startsWith("atril:prototipo:"));
  return { total: notas.length, reales: primero < 0 ? notas.length : primero, esPrototipo: (n: number) => notas[n - 1]?.startsWith("atril:prototipo:") };
}

function dentro(n: number, max: number, nombre = "diapositiva") {
  if (!(Number.isInteger(n) && n >= 1 && n <= max)) throw new Error(`La ${nombre} ${n} no existe; hay ${max} diapositivas (sin contar prototipos)`);
}

export async function borrarDiapositiva(ref: string, n: number) {
  const d = await editable(ref);
  const m = await mapa(d.id);
  if (m.esPrototipo(n)) throw new Error(`La diapositiva ${n} es un prototipo de la plantilla: no se borra`);
  dentro(n, m.reales);
  if (m.total === 1) throw new Error("No se puede borrar la única diapositiva");
  await applescript(`delete slide ((item 2 of argv) as integer) of document id (item 1 of argv)`, [d.id, String(n)]);
  return { documento: d.nombre, borrada: n, quedan: m.reales - 1 };
}

/** Mueve la diapositiva n para que quede después de `despuesDe` (0 = al principio). */
export async function moverDiapositiva(ref: string, n: number, despuesDe: number) {
  const d = await editable(ref);
  const m = await mapa(d.id);
  if (m.esPrototipo(n)) throw new Error(`La diapositiva ${n} es un prototipo de la plantilla: no se mueve`);
  dentro(n, m.reales);
  if (!(Number.isInteger(despuesDe) && despuesDe >= 0 && despuesDe <= m.reales)) throw new Error(`despues_de debe estar entre 0 y ${m.reales}`);
  if (despuesDe === n || despuesDe === n - 1) return { documento: d.nombre, diapositiva: n, ahora: n, sin_cambio: true };
  await applescript(`set d to document id (item 1 of argv)
set s to slide ((item 2 of argv) as integer) of d
if (item 3 of argv) is "0" then
  move s to before slide 1 of d
else
  move s to after slide ((item 3 of argv) as integer) of d
end if`, [d.id, String(n), String(despuesDe)]);
  const ahora = despuesDe < n ? despuesDe + 1 : despuesDe;
  return { documento: d.nombre, diapositiva: n, ahora };
}

export async function ocultarDiapositiva(ref: string, n: number, ocultar = true) {
  const d = await editable(ref);
  const m = await mapa(d.id);
  if (m.esPrototipo(n)) throw new Error(`La diapositiva ${n} es un prototipo de la plantilla`);
  dentro(n, m.reales);
  await applescript(`set skipped of slide ((item 2 of argv) as integer) of document id (item 1 of argv) to ((item 3 of argv) is "si")`, [d.id, String(n), ocultar ? "si" : "no"]);
  return { documento: d.nombre, diapositiva: n, oculta: ocultar };
}

/** Presentar ocupa la pantalla del usuario: la herramienta lo advierte en su descripción. */
export async function presentar(ref: string | undefined, accion: "iniciar" | "siguiente" | "anterior" | "detener", desde?: number) {
  if (accion === "iniciar") {
    if (!ref) throw new Error("Para iniciar hace falta el documento");
    const d = await documento(ref); // presentar no modifica: vale también para presentaciones del usuario
    const m = await mapa(d.id);
    const n = desde ?? 1;
    dentro(n, m.reales);
    await applescript(`set d to document id (item 1 of argv)
start d from slide ((item 2 of argv) as integer) of d`, [d.id, String(n)]);
    return { presentando: true, documento: d.nombre, desde: n };
  }
  const orden = { siguiente: "show next", anterior: "show previous", detener: "stop" }[accion];
  const enCurso = await applescript(`return playing`);
  if (enCurso !== "true") throw new Error("No hay ninguna presentación en curso");
  await applescript(accion === "detener" ? `stop (front document)` : orden);
  return { accion, presentando: accion !== "detener" };
}
