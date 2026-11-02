// El tema: paleta, tipografías y plantilla de Keynote que usan las herramientas del formato.
//
// Un tema es una carpeta con `tema.json` y la plantilla que genera `npm run plantilla`
// (`plantilla.pptx` → `plantilla.key`). Atril usa ATRIL_TEMA (ruta de la carpeta, o el nombre
// de uno de `temas/`) y, si no se da, `temas/noche`.
//
// Los nombres de color son roles (acento, texto, tarjeta…): las herramientas piden roles, no
// hex, así que el mismo código sirve con cualquier paleta. Un tema puede agregar nombres
// propios, y en cualquier parámetro de color también se acepta hex de 6 dígitos.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Roles de color que todo tema define. */
export const ROLES = [
  "fondo", "tarjeta", "tarjeta2", "cabecera", "borde",
  "titulo", "texto", "apagado", "acento", "acento2", "exito", "alerta",
  "blanco", "oscuro", "borde_figura",
] as const;
export type Rol = (typeof ROLES)[number];

export interface DefTema {
  nombre: string;
  descripcion?: string;
  fuentes: { titulo: string; texto: string };
  colores: Record<Rol, string> & Record<string, string>;
  /** Orden de los colores de las series en gráficas (nombres de `colores`). */
  series: string[];
  /** Fondo de portada, divisores y cierre: imagen (relativa a la carpeta del tema) con velo, o degradado. */
  fondo_portada?: { imagen?: string; velo?: number; credito?: string; degradado?: [string, string] };
  /** Imagen (PNG transparente, 16:9) que decora las diapositivas de contenido. */
  decoracion?: string;
  /** Si las figuras y videos deben llevar pie de origen (y revisar_presentacion lo exige). */
  origen_obligatorio?: boolean;
  /** Ancho medio de un carácter del cuerpo, en em: revisar_presentacion estima con él el texto encogido. */
  ancho_caracter?: number;
}

function cargar() {
  const pedido = process.env.ATRIL_TEMA?.trim() || "noche";
  const dir = isAbsolute(pedido) || pedido.includes("/") ? resolve(pedido.replace(/^~(?=\/)/, process.env.HOME ?? "~")) : join(RAIZ, "temas", pedido);
  const archivo = join(dir, "tema.json");
  if (!existsSync(archivo)) throw new Error(`No encontré el tema: falta ${archivo} (ATRIL_TEMA=${pedido})`);
  const t = JSON.parse(readFileSync(archivo, "utf8")) as DefTema;
  const faltan = ROLES.filter((r) => !/^[0-9a-f]{6}$/i.test(t.colores?.[r] ?? ""));
  if (faltan.length) throw new Error(`${archivo}: faltan colores (hex de 6 dígitos) para ${faltan.join(", ")}`);
  for (const [k, v] of Object.entries(t.colores)) if (!/^[0-9a-f]{6}$/i.test(v)) throw new Error(`${archivo}: el color "${k}" no es hex de 6 dígitos`);
  for (const s of t.series ?? []) if (!(s in t.colores)) throw new Error(`${archivo}: la serie "${s}" no es un color del tema`);
  if (!t.fuentes?.titulo || !t.fuentes?.texto) throw new Error(`${archivo}: faltan fuentes.titulo y fuentes.texto`);
  return { ...t, dir, plantilla: join(dir, "plantilla.key") };
}

export const TEMA = cargar();

/** Paleta del tema: nombre → hex en mayúsculas, sin #. */
export const PALETA: Record<string, string> = Object.fromEntries(Object.entries(TEMA.colores).map(([k, v]) => [k, v.toUpperCase()]));
export const SERIES = (TEMA.series?.length ? TEMA.series : ["acento", "acento2", "exito", "alerta", "titulo", "apagado"]).map((s) => PALETA[s]);

export function color(c: string): string {
  const v = PALETA[c] ?? c.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(v)) throw new Error(`Color desconocido "${c}". Usa hex de 6 dígitos o uno de: ${Object.keys(PALETA).join(", ")}`);
  return v.toUpperCase();
}

// ---------- tipografías ----------
// Keynote pide el nombre PostScript ("Georgia-Bold", "HelveticaNeue-Italic"). Se resuelve una
// vez por familia con NSFontManager, que da cada variante con sus rasgos.
const variantes = new Map<string, { ps: string; negrita: boolean; cursiva: boolean; peso: number }[]>();
function miembros(familia: string) {
  if (!variantes.has(familia)) {
    let lista: { ps: string; negrita: boolean; cursiva: boolean; peso: number }[] = [];
    try {
      const salida = execFileSync("osascript", ["-l", "JavaScript", "-e", `
function run(argv) {
  ObjC.import("AppKit");
  const m = ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableMembersOfFontFamily(argv[0])) || [];
  return JSON.stringify(m.map((x) => ({ ps: x[0], peso: x[2], rasgos: x[3] })));
}`, familia], { encoding: "utf8", timeout: 15_000 });
      // Rasgos de NSFontManager: 1 = cursiva, 2 = negrita.
      lista = (JSON.parse(salida) as { ps: string; peso: number; rasgos: number }[])
        .map((x) => ({ ps: x.ps, peso: x.peso, cursiva: (x.rasgos & 1) !== 0, negrita: (x.rasgos & 2) !== 0 }));
    } catch { /* sin AppKit o sin la familia: se usa el nombre tal cual */ }
    variantes.set(familia, lista);
  }
  return variantes.get(familia)!;
}

/** Nombre PostScript de la variante pedida; si la familia no está instalada, el nombre de la familia (Keynote la sustituye). */
export function fuentePS(familia: string, negrita = false, cursiva = false): string {
  const m = miembros(familia);
  if (!m.length) return familia.replace(/\s+/g, "") + (negrita && cursiva ? "-BoldItalic" : negrita ? "-Bold" : cursiva ? "-Italic" : "");
  const cand = m.filter((x) => x.negrita === negrita && x.cursiva === cursiva);
  // Entre las candidatas, la de peso más cercano al normal (5) o al negrita (9).
  const objetivo = negrita ? 9 : 5;
  const elegida = (cand.length ? cand : m).sort((a, b) => Math.abs(a.peso - objetivo) - Math.abs(b.peso - objetivo))[0];
  return elegida.ps;
}

/** ¿El nombre PostScript es de la familia de títulos del tema? */
export function esDeTitulo(ps: string) {
  return miembros(TEMA.fuentes.titulo).some((x) => x.ps === ps) || ps.replace(/-.*/, "") === TEMA.fuentes.titulo.replace(/\s+/g, "");
}
