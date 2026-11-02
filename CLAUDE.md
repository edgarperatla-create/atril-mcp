# CLAUDE.md — Atril

Servidor MCP (TypeScript, Node ≥ 23.6, sin compilar) para que Claude haga presentaciones de
**Keynote**: crear con un tema, leer, editar, animar, revisar y exportar. Uso en `README.md`;
temas en `temas/README.md`.

## Reglas (no se rompen)

1. **Nunca escribir sobre las presentaciones del usuario.** `abrir` copia a la carpeta de
   trabajo (`ATRIL_DIR`, por omisión `~/Atril`). El código solo modifica, guarda o cierra
   documentos con archivo **dentro** de esa carpeta (`src/trabajo.ts`, `editable()` en
   `src/herramientas.ts`). Un documento sin guardar también es del usuario.
2. **Nada en iCloud.** Una presentación sin archivo que se exporta deja un borrador
   `Untitled N.key` en `~/Library/Mobile Documents/com~apple~Keynote/Documents/`, y cerrarla sin
   guardar no lo borra. Por eso `crear`, `crear_con_formato` y `abrir` (PowerPoint) guardan de
   inmediato en la carpeta de trabajo. Las pruebas verifican que esa carpeta no cambie.
3. **No cerrar Keynote ni tocar documentos ajenos.** `test/arranque_frio.ts` cierra Keynote.
4. Los textos y rutas del usuario viajan como argumentos de `osascript`, nunca interpolados
   en scripts. Las constantes de AppleScript (efectos, tipos de gráfica) solo pasan de una
   lista cerrada, y los números se validan.
5. **Nada personal en el repo:** las pruebas usan archivos sintéticos (`test/recursos.ts`) y
   dejan todo en `trabajo/` (ignorado por git).

## Comandos

```bash
npm install
npm run check                       # tsc --noEmit
npm run plantilla -- <tema>         # regenera temas/<tema>/plantilla.key desde tema.json
node test/fase1.ts                  # núcleo
node test/fase2.ts                  # formato (ATRIL_TEMA=papel para el tema claro)
node test/fase3.ts                  # gráficas, tablas, transiciones, medios
node test/fase4.ts                  # animaciones
node test/fase5.ts                  # revisar_presentacion
node test/fase6.ts                  # ecuaciones, figuras, componentes (--presentar ocupa la pantalla)
node test/fase8.ts                  # tablas, buscar/reemplazar, disposición, exportar, imágenes
node test/fase9.ts                  # grafica_cientifica (matplotlib)
```

Las pruebas hablan con el servidor por MCP real (stdio) y abren Keynote. Si cambias el
generador de plantillas o el preámbulo de los scripts, regenera las plantillas y corre
**todas** las pruebas.

## Gotchas de Keynote Creator Studio 15.3.1 (todos verificados)

- **Por bundle id** `com.apple.Keynote`, nunca por nombre.
- **Abrir con `open -g -b`**, nunca con el `open` de AppleScript/JXA. El sandbox no importa
  un `.pptx` que no haya abierto antes por Launch Services: sale el aviso "can't be
  imported" y el script se cuelga.
- **Escribir texto con otra diapositiva a la vista** (`fueraDeVista`/`aLaVista` en
  `src/keynote.ts`). Si no, el corrector de macOS puede dejar la diapositiva en edición con
  una sugerencia, y Keynote no responde hasta que alguien la cierra.
- **JXA o AppleScript, según la operación:**
  - **JXA:** para leer y escribir texto.
  - **AppleScript:** para `export`, `save`, `make slide`, `make table`, `delete`, `add chart`
    y transiciones. En JXA esas operaciones fallan con -1700 o -10000.
  - **`POSIX file` dinámico** dentro del `tell` se resuelve con el manejador `my archivo()`.
- **Colecciones:** `iWorkItems` falla en diapositivas importadas, así que se lee por clase
  (`textItems`, `shapes`…). La lista de textos incluye marcadores ocultos: nunca usar
  "el último" para referirse al recién creado.
- **Imágenes, video y audio:** `make new image` con el archivo crea imagen, video o audio.
  `make new movie` no acepta el archivo.
- **Diapositivas ocultas:** Keynote no las exporta, aunque se pida `skipped slides`.
  `ver_diapositiva` traduce el número a su posición entre las visibles.
- **Lo que no se puede fijar por script:**
  - el nombre de los diseños, ni crearlos;
  - el relleno de figuras;
  - el espaciado de letras;
  - copiar un objeto suelto;
  - la leyenda o el color de las series de una gráfica;
  - los *builds*.
  
  Rodeos:
  - **Maestros y prototipos:** se generan desde un `.pptx` (`tema/construir_plantilla.cjs`, desde `tema.json`);
    duplicar una diapositiva conserva todo.
  - **Paleta:** el esquema de colores del tema.
  - **Leyenda:** propia, en texto.
  - **Animaciones:** prototipos con `<p:timing>` y Magic Move.
- **Marcadores:** Keynote les da ~3 pt menos de margen interior y no respeta `lIns`. Se
  compensa corriéndolos 3 pt (`AJUSTE_X`).
- **Gráficas:** el pastel agrupa por columna, la dispersión usa la primera fila como x, y
  las etiquetas de los ejes se dibujan fuera del marco.
- **Tablas:** formato texto *antes* de escribir los valores; si no, "+0.31" pierde el signo.
- **Texto encogido:** Keynote encoge el cuerpo que no cabe pero reporta el tamaño nominal
  (`revisar_presentacion` lo estima).
- **Colores:** `objectText.color()` devuelve otro espacio de color. Para contraste, muestrear
  la imagen.
- **Figuras con estilo y ecuaciones:** Keynote importa SVG y PDF como imágenes
  vectoriales. Atril genera SVG con la paleta (`forma`), PDF con `pdflatex`
  (`ecuacion`, con `fix-cm`: sin él, Computer Modern no pasa de ~25 pt) y PDF con matplotlib
  (`grafica_cientifica`). Nunca shell-escape ni `\input`. `revisar_presentacion` reconoce esas
  imágenes por su nombre (`forma_*`, `ec_*`, `graf_*`).
- **Alineación de párrafo:** no se puede fijar por script. Para centrar texto se usa un
  cuadro ajustado al contenido, una línea por cuadro.
- **Cambiar el tema por script destruye el formato:** descarta los estilos propios de cada
  objeto.
- **Notas del presentador:** un tema oscuro las pone en tinta clara, invisible sobre papel. El PDF
  `con_notas` se exporta desde una copia temporal con tinta oscura.
- **Escribir un texto completo** le aplica el estilo de su primer carácter. `buscar_reemplazar`
  no reescribe los textos con formato mixto salvo con `forzar`.
- **Tablas:** tras cambiar su estructura hay que reaplicar el estilo (las celdas separadas
  quedan beige) y, si cambian las columnas, el ancho.
- **Nunca duplicar ni mover diapositivas entre documentos:** `duplicate slide … to … of document id B`
  da -609 y Keynote se cierra (SIGABRT, Fase 9). Lo que entra por `.pptx` (subíndices reales,
  enlaces a diapositivas, figuras nativas, bordes de tabla) solo llega importando el archivo entero.
- **Subíndices y letras griegas:** el texto por script no tiene línea base y Unicode no tiene
  subíndice para D, z, etc. Se usa `ecuacion`; en las gráficas, `$…$`.
- **Cliente MCP:** corta a los 60 s por omisión, y exportar a video tarda más. Usar
  `timeout` en `callTool`.

## Mapa del código

```
src/tema.ts          carga el tema (ATRIL_TEMA): paleta por roles, tipografías (nombres PostScript), plantilla
src/keynote.ts       ejecutores jxa()/applescript(), preámbulo (doc, diapositiva, fueraDeVista)
src/trabajo.ts       carpeta de trabajo, copias, qué es editable
src/herramientas.ts  núcleo: listar, abrir, crear, leer, texto, notas, exportar, ver, guardar, cerrar
src/formato.ts       crear_con_formato y diapositiva_* (duplican los prototipos de la plantilla)
src/visuales.ts      gráficas, tablas, transiciones, medios, línea, duplicar, mover
src/animaciones.ts   Magic Move (revelar_por_pasos, animar_cambio, revelar_series), borrar_objeto
src/revision.ts      revisar_presentacion
src/dibujo.ts        ecuaciones (LaTeX→PDF), figuras (SVG), componentes del formato, estilo de texto
src/estructura.ts    borrar/mover/ocultar diapositivas, presentar
src/edicion.ts       buscar_reemplazar, alinear/distribuir/bloquear, diapositivas_desde_imagenes
src/cientifica.ts    grafica_cientifica: valida y llama a grafica_cientifica.py (matplotlib → PDF)
src/index.ts         registro MCP y las instrucciones que ven las sesiones que usan Atril
tema/                generador de plantillas (tema.json → .pptx → .key)
temas/               temas incluidos (noche, papel) con su plantilla generada
test/                una prueba por área (MCP real) y los archivos sintéticos que usan
```
