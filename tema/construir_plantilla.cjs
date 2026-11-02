// Genera <tema>/plantilla.pptx desde <tema>/tema.json: diapositivas maestras y una diapositiva
// "prototipo" por tipo. tema/importar_plantilla.ts la convierte en <tema>/plantilla.key.
//
//   npm run plantilla                    (tema de ATRIL_TEMA, o temas/noche)
//   npm run plantilla -- temas/papel     (otro tema)
//
// Por qué maestros + prototipos:
// - Keynote convierte los maestros de un .pptx en diseños con nombre, pero solo reconoce
//   un marcador de título y uno de cuerpo por diseño.
// - Por script no se pueden crear diseños, ni rellenar figuras, ni fijar el espaciado de
//   letras, ni copiar objetos sueltos ("Shapes can not be copied"). Sí se pueden duplicar
//   diapositivas, y al cambiarles el texto conservan el formato.
// Así que lo fijo (fondos, decoración, título, cuerpo) va en el maestro, y lo demás
// (antetítulo, pie, número de sección, tarjeta de figura) en el prototipo.
//
// La geometría (16:9, 13.333 × 7.5 in) es fija; colores, tipografías y fondos salen del tema.
// Las imágenes llevan texto alternativo: sin él, pptxgenjs guarda su ruta completa en el archivo.
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const JSZip = require("jszip");
const PptxGenJS = require("pptxgenjs");

const RAIZ = path.resolve(__dirname, "..");
const pedido = process.argv[2] || process.env.ATRIL_TEMA || "noche";
const DIR = pedido.includes("/") ? path.resolve(pedido) : path.join(RAIZ, "temas", pedido);
const tema = JSON.parse(fs.readFileSync(path.join(DIR, "tema.json"), "utf8"));
const C = tema.colores;
const F = tema.fuentes;
const SALIDA = path.join(DIR, "plantilla.pptx");
const RECURSOS = path.join(DIR, "recursos");
fs.mkdirSync(RECURSOS, { recursive: true });

const W = 13.333, H = 7.5;
const pres = new PptxGenJS();
pres.defineLayout({ name: "ATRIL169", width: W, height: H });
pres.layout = "ATRIL169";

// ---------- geometría del formato (pulgadas) ----------
const antetitulo = { x: 0.6, y: 0.35, w: 12, h: 0.35, fontFace: F.texto, fontSize: 13, bold: true, color: C.acento, charSpacing: 2 };
const titulo = { x: 0.6, y: 0.68, w: 12.1, h: 0.9, fontFace: F.titulo, fontSize: 30, bold: true, color: C.titulo };
const pieSeccion = { x: 0.5, y: 7.05, w: 8, h: 0.3, fontFace: F.texto, fontSize: 10, color: C.apagado, align: "left" };
const divNumero = { x: 0.9, y: 2.35, w: 3, h: 1.6, fontFace: F.titulo, fontSize: 90, bold: true, color: C.acento };
const divTitulo = { x: 3.1, y: 2.55, w: 9.2, h: 1.3, fontFace: F.titulo, fontSize: 34, bold: true, color: C.titulo, valign: "middle" };
const divSubtitulo = { x: 3.15, y: 3.75, w: 9, h: 0.7, fontFace: F.texto, fontSize: 15, italic: true, color: C.texto };
const vinetas = { bullet: { code: "25AA", indent: 18 }, paraSpaceAfter: 10 };
const tarjeta = { x: 0.52, y: 1.77, w: 6.71, h: 4.63, rectRadius: 0.06, fill: { color: C.blanco }, line: { color: C.borde_figura, width: 1 } };
const pieFigura = { x: 0.6, y: 6.38, w: 6.55, h: 0.35, fontFace: F.texto, fontSize: 11, italic: true, color: C.apagado, align: "center" };

// ---------- fondos ----------
async function png(nombre, svg) {
  const destino = path.join(RECURSOS, nombre);
  await sharp(Buffer.from(svg)).png().toFile(destino);
  return destino;
}
async function fondoPortada() {
  const f = tema.fondo_portada ?? {};
  if (f.imagen) {
    const objs = [{ image: { x: 0, y: 0, w: W, h: H, path: path.resolve(DIR, f.imagen), altText: "Fondo" } }];
    if (f.velo) objs.push({ rect: { x: 0, y: 0, w: W, h: H, fill: { color: C.fondo, transparency: 100 - f.velo }, line: { type: "none" } } });
    return objs;
  }
  if (f.degradado) {
    const [a, b] = f.degradado;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1125"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="#${a}"/><stop offset="1" stop-color="#${b}"/></linearGradient></defs><rect width="2000" height="1125" fill="url(#g)"/></svg>`;
    return [{ image: { x: 0, y: 0, w: W, h: H, path: await png("portada.png", svg), altText: "Fondo" } }];
  }
  return [];
}
const fondoContenido = () => (tema.decoracion ? [{ image: { x: 0, y: 0, w: W, h: H, path: path.resolve(DIR, tema.decoracion), altText: "Decoración" } }] : []);

// ---------- animación por párrafo (PowerPoint <p:timing>) ----------
// Desvanecer de 0.5 s, un clic por párrafo. Keynote lo importa como "Dissolve", entrega
// "By Paragraph".
function timingVinetas(spid, parrafos) {
  let id = 2;
  const clic = (k) => {
    const tgt = `<p:spTgt spid="${spid}"><p:txEl><p:pRg st="${k}" end="${k}"/></p:txEl></p:spTgt>`;
    const [a, b, c, d, e] = [++id, ++id, ++id, ++id, ++id];
    return `<p:par><p:cTn id="${a}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>` +
      `<p:par><p:cTn id="${b}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
      `<p:par><p:cTn id="${c}" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
      `<p:set><p:cBhvr><p:cTn id="${d}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl>${tgt}</p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>` +
      `<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${e}" dur="500"/><p:tgtEl>${tgt}</p:tgtEl></p:cBhvr></p:animEffect>` +
      `</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
  };
  const clics = Array.from({ length: parrafos }, (_, k) => clic(k)).join("");
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
    `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${clics}</p:childTnLst></p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
    `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>` +
    `</p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst><p:bldP spid="${spid}" grpId="0" build="p"/></p:bldLst></p:timing>`;
}

// ---------- maestros ----------
// Keynote da a los marcadores un margen interior ~3 pt menor que el de un cuadro de texto
// importado (0.1 in), y no respeta lIns/rIns en el XML. Se compensa corriendo cada marcador
// 3 pt a la derecha.
const AJUSTE_X = 3 / 72;
const ph = (name, type, o, texto) =>
  ({ placeholder: { options: { name, type, ...o, x: o.x + AJUSTE_X, w: o.w - AJUSTE_X }, text: texto } });
const numeroPagina = { x: W - 1.0, y: H - 0.45, w: 0.5, h: 0.3, fontFace: F.texto, fontSize: 10, color: C.apagado, align: "right" };
// Anclaje vertical por marcador, en orden de definición (pptxgenjs no lo escribe): títulos al
// centro, viñetas arriba.
const ANCLAJES = {};

function maestro(nombre, fondo, objetos, anclajes, conNumero) {
  ANCLAJES[nombre] = anclajes;
  pres.defineSlideMaster({ title: nombre, background: { color: C.fondo }, objects: [...fondo, ...objetos], ...(conNumero ? { slideNumber: numeroPagina } : {}) });
}

async function construir() {
  const hero = await fondoPortada();
  const deco = fondoContenido();
  const tituloContenido = ph("titulo", "title", { ...titulo, align: "left" }, "Título");
  const cuerpo = (o) => ph("cuerpo", "body", {
    fontFace: F.texto, color: C.texto, align: "left", valign: "top",
    bullet: vinetas.bullet, paraSpaceAfter: vinetas.paraSpaceAfter, ...o,
  }, "Viñeta");
  const credito = tema.fondo_portada?.credito
    ? [{ text: { text: tema.fondo_portada.credito, options: { x: 7.3, y: 7.12, w: 5.6, h: 0.3, fontFace: F.texto, fontSize: 8.5, italic: true, color: C.apagado, align: "right" } } }]
    : [];

  maestro("Portada", hero, [
    ph("titulo", "title", { x: 0.9, y: 2.95, w: 11.2, h: 1.9, fontFace: F.titulo, fontSize: 42, bold: true, color: C.titulo, lineSpacingMultiple: 1.05, align: "left" }, "Título de la presentación"),
    ph("subtitulo", "body", { x: 0.9, y: 4.85, w: 10.8, h: 0.6, fontFace: F.texto, fontSize: 17, italic: true, color: C.texto, align: "left" }, "Subtítulo"),
    ...credito,
  ], ["ctr", "ctr"]);
  maestro("Divisor", hero, [
    ph("titulo", "title", { ...divTitulo, align: "left" }, "Título de sección"),
    ph("subtitulo", "body", { ...divSubtitulo, align: "left" }, "Subtítulo de sección"),
  ], ["ctr", "ctr"]);
  maestro("Contenido", deco, [tituloContenido, cuerpo({ x: 0.6, y: 1.9, w: 12.1, h: 4.9, fontSize: 15 })], ["ctr", "t"], true);
  maestro("Figura", deco, [tituloContenido, cuerpo({ x: 7.4, y: 1.95, w: 5.35, h: 4.4, fontSize: 14 })], ["ctr", "t"], true);
  maestro("Tabla", deco, [tituloContenido], ["ctr"], true);
  maestro("Cierre", hero, [
    ph("titulo", "title", { x: 0.9, y: 2.9, w: 8, h: 1.1, fontFace: F.titulo, fontSize: 46, bold: true, color: C.titulo, align: "left" }, "Gracias"),
    ph("subtitulo", "body", { x: 0.9, y: 3.95, w: 8, h: 0.6, fontFace: F.texto, fontSize: 18, italic: true, color: C.acento, align: "left" }, "Preguntas y discusión"),
  ], ["ctr", "ctr"]);

  // ---------- prototipos (las herramientas los duplican y cambian sus textos) ----------
  // Los textos de muestra son los que src/formato.ts busca para reemplazar: no cambiarlos.
  const proto = (tipo, maestroNombre) => {
    const s = pres.addSlide({ masterName: maestroNombre });
    s.addNotes(`atril:prototipo:${tipo}`);
    return s;
  };

  let s = proto("portada", "Portada");
  s.addText("ANTETÍTULO DE PORTADA", { x: 0.9, y: 2.55, w: 10, h: 0.4, fontFace: F.texto, fontSize: 14, bold: true, color: C.acento, charSpacing: 3 });
  s.addText("Título de la presentación", { placeholder: "titulo" });
  s.addText("Subtítulo", { placeholder: "subtitulo" });
  s.addText("Autor  ·  Institución  ·  Año", { x: 0.9, y: 6.6, w: 9, h: 0.4, fontFace: F.texto, fontSize: 13, color: C.apagado });

  s = proto("divisor", "Divisor");
  s.addText("01", divNumero);
  s.addText("Título de sección", { placeholder: "titulo" });
  s.addText("Subtítulo de sección", { placeholder: "subtitulo" });

  // *_vinetas: el mismo prototipo con las viñetas del cuerpo entrando una por clic. La
  // muestra lleva 3 viñetas: así Keynote importa la animación "por párrafo", y al cambiar
  // el texto se adapta al número nuevo de viñetas.
  const animados = [];
  for (const [tipo, m] of [["contenido", "Contenido"], ["figura", "Figura"], ["tabla", "Tabla"], ["contenido_vinetas", "Contenido"], ["figura_vinetas", "Figura"]]) {
    s = proto(tipo, m);
    if (tipo.endsWith("_vinetas")) animados.push(pres.slides.length);
    s.addText("ANTETÍTULO", antetitulo);
    s.addText("Título", { placeholder: "titulo" });
    if (tipo !== "tabla") s.addText(tipo.endsWith("_vinetas") ? "Viñeta 1\nViñeta 2\nViñeta 3" : "Viñeta", { placeholder: "cuerpo" });
    s.addText("Sección", pieSeccion);
    if (tipo.startsWith("figura")) {
      s.addShape("roundRect", tarjeta);
      s.addText("Elaboración propia", pieFigura);
    }
  }

  s = proto("cierre", "Cierre");
  s.addText("Gracias", { placeholder: "titulo" });
  s.addText("Preguntas y discusión", { placeholder: "subtitulo" });
  s.addText("Autor · Institución", { x: 0.9, y: 6.7, w: 8, h: 0.4, fontFace: F.texto, fontSize: 12, color: C.apagado });

  // ---------- anclaje vertical en el XML de cada diseño ----------
  const zip = await JSZip.loadAsync(await pres.write({ outputType: "nodebuffer" }));
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n))) {
    let xml = await zip.file(f).async("string");
    const nombre = xml.match(/<p:cSld name="([^"]*)"/)?.[1];
    const anclajes = ANCLAJES[nombre];
    if (!anclajes) continue;
    let i = 0;
    xml = xml.replace(/(<p:ph\s[^>]*type="(?:title|body)"[^>]*\/>[\s\S]*?<a:bodyPr) /g, (m, pre) => `${pre} anchor="${anclajes[i++] ?? "t"}" `);
    if (i !== anclajes.length) throw new Error(`${nombre}: ${i} marcadores, se esperaban ${anclajes.length}`);
    zip.file(f, xml);
  }
  // ---------- animación de las viñetas en los prototipos *_vinetas ----------
  for (const n of animados) {
    const f = `ppt/slides/slide${n}.xml`;
    const xml = await zip.file(f).async("string");
    const cuerpo = xml.match(/<p:cNvPr id="(\d+)"[^>]*>(?:(?!<\/p:nvSpPr>)[\s\S])*?<p:ph\s[^>]*type="body"/);
    if (!cuerpo) throw new Error(`${f}: no encontré el cuerpo`);
    const parrafos = (xml.slice(cuerpo.index).match(/<p:txBody>[\s\S]*?<\/p:txBody>/)[0].match(/<a:p>/g) ?? []).length;
    if (parrafos !== 3) throw new Error(`${f}: el cuerpo tiene ${parrafos} párrafos, se esperaban 3`);
    if (!xml.includes("</p:clrMapOvr>")) throw new Error(`${f}: sin clrMapOvr`);
    zip.file(f, xml.replace("</p:clrMapOvr>", "</p:clrMapOvr>" + timingVinetas(cuerpo[1], parrafos)));
  }

  // ---------- esquema de colores del tema ----------
  // pptxgenjs mete el esquema "Office" (texto negro, acentos azul/naranja/gris). Keynote lo
  // usa para lo que no trae color propio: series de las gráficas, etiquetas de ejes, texto
  // nuevo. Se reemplaza por la paleta del tema, con las series en el orden de `series`.
  const serie = (i) => C[(tema.series ?? [])[i]] ?? [C.acento, C.acento2, C.exito, C.alerta, C.titulo, C.apagado][i];
  const color = (n, hex) => `<a:${n}><a:srgbClr val="${hex}"/></a:${n}>`;
  const esquema = `<a:clrScheme name="${tema.nombre.replace(/[<>&"]/g, "")}">${[
    ["dk1", C.texto], ["lt1", C.fondo], ["dk2", C.apagado], ["lt2", C.tarjeta],
    ...[0, 1, 2, 3, 4, 5].map((i) => [`accent${i + 1}`, serie(i)]),
    ["hlink", C.acento2], ["folHlink", C.apagado],
  ].map(([n, hex]) => color(n, hex)).join("")}</a:clrScheme>`;
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n))) {
    const xml = await zip.file(f).async("string");
    const nuevo = xml.replace(/<a:clrScheme [\s\S]*?<\/a:clrScheme>/, esquema);
    if (nuevo === xml) throw new Error(`${f}: no encontré el esquema de colores`);
    zip.file(f, nuevo);
  }

  fs.writeFileSync(SALIDA, await zip.generateAsync({ type: "nodebuffer" }));
  console.log("->", SALIDA, Object.keys(ANCLAJES).join(", "));
}

construir().catch((e) => { console.error(e); process.exit(1); });
