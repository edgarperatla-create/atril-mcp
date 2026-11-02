// Ejecutores de scripts contra Keynote, siempre por bundle id.
//
// Los scripts son código fijo de este repo; los datos del usuario (textos, rutas,
// nombres) nunca se interpolan en ellos: viajan como argumentos de osascript.
// - jxa():         lectura y escritura de texto. Devuelve JSON.
// - applescript(): comandos cuyas opciones JXA no logra convertir (export, save,
//                  make slide con diseño). Verificado: en JXA,
//                  `export ... withProperties {imageFormat}` falla con -1700.
import { execFile } from "node:child_process";

export const BUNDLE = "com.apple.Keynote";
const TIMEOUT_MS = 180_000;

export class ErrorKeynote extends Error {}

function osascript(args: string[], timeout = TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/osascript", args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed) return reject(new ErrorKeynote(`Keynote no respondió en ${timeout / 1000} s`));
        const msg = (stderr || err.message).trim().replace(/^.*?execution error: (Error: )*/s, "").replace(/ \(-2700\)$/, "");
        return reject(new ErrorKeynote(msg));
      }
      resolve(stdout.replace(/\n$/, ""));
    });
  });
}

// Disponibles dentro de todo script JXA: k (Keynote), p (parámetros), doc(id),
// diapositiva(d, n) y intento(fn) para propiedades que pueden no existir.
const PREAMBULO_JXA = `
const k = Application("${BUNDLE}");
const doc = (id) => {
  const d = k.documents.byId(id);
  try { d.id(); } catch (e) { throw new Error("No hay ninguna presentación abierta con id " + id); }
  return d;
};
const diapositiva = (d, n) => {
  const total = d.slides.length;
  if (!(n >= 1 && n <= total)) throw new Error("La diapositiva " + n + " no existe; la presentación tiene " + total);
  return d.slides[n - 1];
};
const intento = (fn, siFalla = null) => { try { return fn(); } catch (e) { return siFalla; } };
// Si se escribe texto en la diapositiva que está a la vista, el corrector de macOS puede
// dejarla en edición con una sugerencia abierta ("área_apilada") y Keynote deja de
// responder a scripts hasta que alguien la cierra. Escribir con otra diapositiva
// activa lo evita, y mostrarla después no lo dispara.
const fueraDeVista = (d, n) => {
  const total = d.slides.length;
  const otra = n !== 1 ? 1 : (total > 1 ? 2 : 0);
  if (otra) d.currentSlide = d.slides[otra - 1];
};
const aLaVista = (d, n) => { d.currentSlide = d.slides[n - 1]; };
`;

/** Corre JXA. `cuerpo` es el cuerpo de una función que usa `p` y devuelve algo serializable. */
export async function jxa<T>(cuerpo: string, p: object = {}): Promise<T> {
  const script = `function run(argv) {
const p = JSON.parse(argv[0]);
${PREAMBULO_JXA}
const r = (() => {
${cuerpo}
})();
return JSON.stringify(r === undefined ? null : r);
}`;
  const out = await osascript(["-l", "JavaScript", "-e", script, JSON.stringify(p)]);
  return JSON.parse(out) as T;
}

/**
 * Corre AppleScript dentro de `tell application id`. Los datos llegan en `argv`.
 * Para rutas usar `my archivo(ruta)`: `POSIX file` dinámico dentro del tell se
 * lo pide a Keynote, que falla con -1728 si el archivo aún no existe.
 */
export function applescript(cuerpo: string, argv: string[] = []): Promise<string> {
  // osascript tomaría un argumento que empiece con "-" como opción.
  const raro = argv.find((a) => a.startsWith("-"));
  if (raro !== undefined) throw new ErrorKeynote(`Argumento no permitido (empieza con "-"): ${raro}`);
  const script = `on archivo(ruta)\nreturn POSIX file ruta\nend archivo\n` +
    `on run argv\ntell application id "${BUNDLE}"\n${cuerpo}\nend tell\nend run`;
  return osascript(["-e", script, ...argv]);
}
