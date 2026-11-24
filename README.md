# Atril

**An MCP server that lets Claude build Apple Keynote presentations**: create them with a
consistent theme, read, edit, animate, review and export them. Built for scientific and
academic work: real LaTeX equations, scientific charts with error bars and log scales,
figures with source lines, and an automatic quality review before you present.

[Español](README.es.md) · Status: **in development** (0.1). Tested with Keynote Creator Studio
15.3.1 on macOS 26. macOS only.

> Tool names are in Spanish (e.g. `crear_con_formato`, `diapositiva_figura`); their
> descriptions, parameters' help and the server instructions that Claude reads are in English.
> A glossary is in [Tools](#tools).

## What it can do

- **Themed formatting:** `crear_con_formato` plus one tool per slide type (title, section
  divider, content, figure, table, closing). A theme fixes palette, fonts and backgrounds; two
  are included (`noche`, dark, and `papel`, light) and you can write your own.
- **Content:** styled tables, native Keynote charts, vector LaTeX equations, matplotlib
  scientific charts, palette shapes (rectangles, arrows, stars, speech bubbles…), highlighted
  figures, cards, agenda and video.
- **Animation:** bullets that enter one per click, Magic Move (appear, move, scale, highlight,
  reveal series), 44 transitions.
- **Editing:** find and replace across the deck, align and distribute objects, merge and sort
  table cells, move, hide or delete slides.
- **Review:** `revisar_presentacion` reports text outside the slide, body text Keynote
  shrinks, low contrast (measured on the rendered image), figures without a source line,
  leftover placeholder text, tiny fonts and slides without speaker notes.
- **Export:** PDF (also with notes under each slide), PowerPoint, PNG, JPEG, video, HTML,
  Keynote '09 and animated GIF.

**Your files are never modified:** Atril works on copies in its own working folder.

## Requirements

- macOS with Keynote. Atril drives it through AppleScript/JXA; the first time, macOS asks for
  Automation permission to control Keynote.
- Node ≥ 23.6 (runs TypeScript directly, no build step).
- Optional:
  - `ecuacion`: TeX Live or MacTeX (`pdflatex`).
  - `grafica_cientifica`: Python 3 with matplotlib and numpy (`ATRIL_PYTHON` picks the
    interpreter).
  - GIF export and the video tests: ffmpeg.

## Install

From a clone:

```bash
git clone https://github.com/edgarperatla-create/atril-mcp.git
```

```bash
cd atril-mcp && npm install
```

Register it in Claude Code (user scope: every session sees it):

```bash
claude mcp add --scope user atril -- node "$PWD/src/index.ts"
```

With another theme or working folder:

```bash
claude mcp add --scope user atril -e ATRIL_TEMA=papel -e ATRIL_DIR="$HOME/Presentations/Atril" -- node "$PWD/src/index.ts"
```

Once published to npm, no clone is needed:

```bash
claude mcp add --scope user atril -- npx -y atril-mcp
```

| Variable | What it sets | Default |
|---|---|---|
| `ATRIL_TEMA` | name of a theme in `temas/`, or a path to a theme folder | `noche` |
| `ATRIL_DIR` | working folder (`copias/`, `salidas/`, `vistas/`…) | `~/Atril` |
| `ATRIL_PYTHON` | Python with matplotlib for `grafica_cientifica` | first one found |

## How to ask for a deck

Just tell Claude what you want; the server instructions teach it the workflow (create with
the theme, one tool per slide, look at each one, review, export):

> Make me a 10-slide deck on the project status: title slide, a divider per section, the
> figures in `figures/` with their source lines, the estimator's equation, speaker notes with
> the script and animated bullets in the conclusions. Export it to PDF.

> Open `talk.pptx` and tell me which slides have shrunken text or figures without a source
> line.

Slide text is written in whatever language you ask for; only tool names are Spanish.

## Themes

A theme is a folder with `tema.json`: color roles (background, card, title, text, accent…),
title and body fonts, the cover background (gradient or image with veil) and whether figures
must carry a source line. `npm run plantilla -- <theme>` builds its Keynote template. Details
and an example in [`temas/README.md`](temas/README.md).

## Tools

Tool names are Spanish; the glossary shows what each one is.

| Tool | What it does |
|---|---|
| `listar_presentaciones_abiertas` (list open) | id, name, file, slides, theme, size, whether editable |
| `abrir` (open) | opens a copy of a `.key`/`.pptx`/`.ppt` |
| `crear` (create) | new presentation with a built-in Keynote theme, saved in the working folder |
| `leer_presentacion` (read) | per slide: layout, title, body, notes, transition, objects (with `detalle`: positions and cells) |
| `agregar_diapositiva`, `poner_texto`, `notas` | slides, text and speaker notes |
| `exportar` (export) | PDF, PPTX, PNG, JPEG, video, HTML, Keynote '09 or GIF; `etapas` (one animation step per image); PDF `con_notas` |
| `ver_diapositiva` (view slide) | image of a slide, so Claude can inspect it |
| `guardar`, `cerrar` (save, close) | only for presentations in the working folder |
| `crear_con_formato` (create with theme) | new presentation with the active theme (hidden prototypes at the end) |
| `diapositiva_portada` / `_divisor` / `_contenido` / `_figura` / `_tabla` / `_cierre` | title / divider / content / figure / table / closing slide; figures go on a white card with a source line |
| `grafica` (chart) | native Keynote chart (17 types) with the palette and legend |
| `grafica_cientifica` (scientific chart) | matplotlib → vector PDF: error bars, upper limits, log/symlog, bands, histograms, second axis, `$…$` formulas |
| `tabla`, `editar_celdas`, `tabla_estructura` | themed table; edit cells; merge, sort, add/remove rows and columns |
| `ecuacion` (equation) | real LaTeX (amsmath and extra packages) as a vector image |
| `forma` (shape) | vector shapes in the palette with text on top |
| `cifras_destacadas`, `tarjetas_numeradas`, `agenda`, `diapositiva_video` | theme components |
| `estilo_texto` (text style) | title/body font, size, color, bold, italic |
| `transicion`, `revelar_por_pasos`, `animar_cambio`, `revelar_series` | transitions and Magic Move animations |
| `insertar_medio`, `linea`, `duplicar_diapositiva`, `mover_objeto`, `borrar_objeto` | media and objects |
| `alinear_objetos`, `distribuir_objetos`, `bloquear_objeto` | layout (align, distribute, lock) |
| `buscar_reemplazar` (find/replace) | across text, notes and table cells of the whole deck |
| `borrar_diapositiva`, `mover_diapositiva`, `ocultar_diapositiva` | slide management (prototypes are protected) |
| `diapositivas_desde_imagenes` | one slide per image |
| `revisar_presentacion` (review) | problem report by severity, with a contact sheet |
| `presentar` (present) | start, next, previous, stop (takes over the screen) |

## Rules the code enforces

- **Copies, always.** `abrir` copies the file into the working folder before opening it.
- **Only what has a file inside the working folder is editable.** Everything else (your own
  presentations, unsaved documents) can be read, viewed and exported, but not modified, saved
  or closed.
- **No iCloud drafts:** `crear` and `crear_con_formato` save immediately in the working folder
  (otherwise Keynote leaves an `Untitled N.key` in iCloud on export).
- **Export never overwrites**: it appends `_2`, `_3`…
- Texts and paths travel as `osascript` arguments, never interpolated into scripts. LaTeX is
  compiled without shell-escape and without `\input`.

## Keynote scripting limits

Not settable by script: native shape fill, letter spacing, paragraph alignment, subscripts in
text, the color of each series in a native chart, table borders, slide links, grouping, and
z-order. Atril works around several: vector shapes and equations, prototypes in the template,
Magic Move for animation, custom legends. Duplicating or moving slides **between two
documents** crashes Keynote, so Atril never does it. Technical details in
[`CLAUDE.md`](CLAUDE.md) (Spanish).

## Development

```bash
npm run check
```

Tests talk to the server over real MCP (stdio), open Keynote and use their own working folder
in `trabajo/` (with synthetic fixtures they generate themselves):

```bash
node test/fase1.ts
```

```bash
node test/fase2.ts
```

`fase1` core · `fase2` theme format (`ATRIL_TEMA=papel` for the light theme) · `fase3` charts,
tables, transitions and media · `fase4` animations · `fase5` review · `fase6` equations,
shapes and components · `fase8` editing and export · `fase9` scientific charts.
`test/arranque_frio.ts` **quits Keynote** (it refuses if documents are open).

## Security

Atril controls Keynote on your Mac with Automation permission. It only modifies files inside
its working folder, but it **can read any file it is pointed at** (for example through `abrir`
or `insertar_medio`). If malicious text tricked Claude (prompt injection from a web page, an
email or a document), it could in theory put a local file into a presentation; the file does
not leave your Mac unless you share that presentation. Check what Claude is about to insert
before sharing a deck, and don't ask it to work with material from sources you don't trust.

To report a security issue, open an issue without sensitive details or contact the author on
GitHub.

## Support

A personal project maintained in spare time: issues and pull requests are welcome, but there
is no commitment on response or dates. Tested only with the Keynote and macOS versions above.

## License

MIT. See [`LICENSE`](LICENSE).
