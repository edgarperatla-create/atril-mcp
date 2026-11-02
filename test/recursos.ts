// Archivos de prueba sintéticos (en trabajo/recursos, fuera del repo): figuras PNG, un video
// y una presentación .pptx con notas y un video. Las pruebas los generan la primera vez que corren.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(RAIZ, "trabajo", "recursos");
const requerir = createRequire(import.meta.url);

export const DIAPOSITIVAS_PPTX = 12;

/** Una figura tipo "gráfica" en PNG: ejes y una curva, con un título. */
async function figura(archivo: string, titulo: string, fase: number) {
  const sharp = requerir("sharp");
  const puntos = Array.from({ length: 60 }, (_, i) => `${80 + i * 14},${380 - 140 * (1 + Math.sin(i / 8 + fase)) - i * 1.5}`).join(" ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500">
<rect width="1000" height="500" fill="#ffffff"/>
<line x1="80" y1="420" x2="940" y2="420" stroke="#333" stroke-width="2"/><line x1="80" y1="40" x2="80" y2="420" stroke="#333" stroke-width="2"/>
<polyline points="${puntos}" fill="none" stroke="#c0602a" stroke-width="4"/>
<text x="500" y="470" font-family="Helvetica" font-size="26" text-anchor="middle" fill="#333">${titulo}</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(archivo);
}

function ffmpeg() {
  for (const r of ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"]) if (existsSync(r)) return r;
  throw new Error("Las pruebas de video necesitan ffmpeg (brew install ffmpeg)");
}

async function presentacion(archivo: string, video: string) {
  const PptxGenJS = requerir("pptxgenjs");
  const p = new PptxGenJS();
  p.layout = "LAYOUT_WIDE";
  for (let i = 1; i <= DIAPOSITIVAS_PPTX; i++) {
    const s = p.addSlide();
    s.background = { color: "1E2230" };
    s.addText(`Diapositiva ${i}`, { x: 0.6, y: 0.5, w: 12, h: 0.9, fontSize: 30, bold: true, color: "F4F1EA" });
    s.addText(`Punto A de ${i}\nPunto B de ${i}`, { x: 0.6, y: 1.8, w: 12, h: 3, fontSize: 18, color: "D8DCE6", bullet: true });
    if (i === 3) s.addMedia({ type: "video", path: video, x: 7, y: 2, w: 5.33, h: 3 });
    s.addNotes(`Guion de la diapositiva ${i}.`);
  }
  await p.writeFile({ fileName: archivo });
}

/** Rutas de los recursos; los genera si faltan. */
export async function recursos() {
  mkdirSync(DIR, { recursive: true });
  const r = {
    figura: join(DIR, "figura.png"),
    figuras: ["serie_1.png", "serie_2.png", "serie_3.png"].map((f) => join(DIR, f)),
    video: join(DIR, "video.mp4"),
    pptx: join(DIR, "presentacion.pptx"),
  };
  if (!existsSync(r.figura)) await figura(r.figura, "Señal frente a corrimiento al rojo", 0);
  for (const [i, f] of r.figuras.entries()) if (!existsSync(f)) await figura(f, `Serie ${i + 1}`, i);
  if (!existsSync(r.video)) {
    execFileSync(ffmpeg(), ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=3",
      "-pix_fmt", "yuv420p", "-c:v", "libx264", r.video]);
  }
  if (!existsSync(r.pptx)) await presentacion(r.pptx, r.video);
  return r;
}
