# Atril

**Servidor MCP para que Claude haga presentaciones de Keynote**: crearlas con un formato
consistente, leerlas, editarlas, animarlas, revisarlas y exportarlas. Pensado para trabajo
científico y académico: ecuaciones en LaTeX real, gráficas científicas con barras de error y
escalas logarítmicas, figuras con pie de origen y una revisión automática antes de presentar.

> *An MCP server that lets Claude build, read, edit, animate, review and export Apple Keynote
> presentations on macOS, with configurable themes, real LaTeX equations and scientific
> charts. Tool names and docs are in Spanish for now.*

Estado: **en desarrollo** (0.1). Probado con Keynote Creator Studio 15.3.1 en macOS 26.

## Qué puede hacer

- **Formato con temas:** `crear_con_formato` y una herramienta por tipo de diapositiva
  (portada, divisor, contenido, figura, tabla, cierre). El tema fija paleta, tipografías y
  fondos; trae dos (`noche`, oscuro, y `papel`, claro) y puedes crear el tuyo.
- **Contenido:** tablas con estilo, gráficas nativas de Keynote, ecuaciones LaTeX
  (vectoriales), gráficas científicas con matplotlib, figuras con la paleta (rectángulos,
  flechas, estrellas, bocadillos…), cifras destacadas, tarjetas, agenda y video.
- **Animación:** viñetas que entran una por clic, Magic Move (aparecer, mover, escalar,
  resaltar, revelar series), 44 transiciones.
- **Edición:** buscar y reemplazar en toda la presentación, alinear y distribuir objetos,
  fusionar y ordenar celdas, mover, ocultar o borrar diapositivas.
- **Revisión:** `revisar_presentacion` reporta texto fuera de la diapositiva, cuerpo que
  Keynote encoge, contraste bajo (medido en la imagen real), figuras sin pie de origen,
  textos de muestra sobrantes, letra pequeña y diapositivas sin notas.
- **Exportar:** PDF (también con las notas debajo de cada diapositiva), PowerPoint, PNG,
  JPEG, video, HTML, Keynote ’09 y GIF animado.

**Tus archivos nunca se modifican:** Atril trabaja sobre copias en su carpeta de trabajo.

## Requisitos

- macOS con Keynote. Atril lo controla por AppleScript/JXA: la primera vez macOS pide
  permiso de Automatización para controlar Keynote.
- Node ≥ 23.6 (corre TypeScript directo, sin compilar).
- Opcionales:
  - `ecuacion`: TeX Live o MacTeX (`pdflatex`).
  - `grafica_cientifica`: Python 3 con matplotlib y numpy (`ATRIL_PYTHON` para elegir el
    intérprete).
  - Exportar a GIF y las pruebas de video: ffmpeg.

## Instalación

```bash
git clone https://github.com/edgarperatla-create/atril-mcp.git
```

```bash
cd atril-mcp && npm install
```

Registrar en Claude Code (alcance de usuario: lo ven todas las sesiones):

```bash
claude mcp add --scope user atril -- node "$PWD/src/index.ts"
```

Con otro tema o carpeta de trabajo:

```bash
claude mcp add --scope user atril -e ATRIL_TEMA=papel -e ATRIL_DIR="$HOME/Presentaciones/Atril" -- node "$PWD/src/index.ts"
```

| Variable | Qué fija | Por omisión |
|---|---|---|
| `ATRIL_TEMA` | nombre de un tema de `temas/` o ruta a la carpeta de un tema | `noche` |
| `ATRIL_DIR` | carpeta de trabajo (`copias/`, `salidas/`, `vistas/`…) | `~/Atril` |
| `ATRIL_PYTHON` | Python con matplotlib para `grafica_cientifica` | el primero que encuentre |

## Cómo pedir una presentación

Basta con decirle a Claude qué quieres; las instrucciones del servidor le enseñan el flujo
(crear con formato, una herramienta por diapositiva, mirar cada una, revisar y exportar):

> Hazme una presentación de 10 diapositivas sobre el avance del proyecto: portada, un
> divisor por sección, las figuras de `figuras/` con su pie de origen, la ecuación del
> estimador, notas con el guion y viñetas animadas en las conclusiones. Expórtala a PDF.

> Abre `charla.pptx` y dime qué diapositivas tienen texto encogido o figuras sin pie de
> origen.

## Temas

Un tema es una carpeta con `tema.json`: roles de color (fondo, tarjeta, título, texto,
acento…), tipografías de títulos y de texto, fondo de portada (degradado o imagen con velo)
y si las figuras deben llevar pie de origen. `npm run plantilla -- <tema>` genera su
plantilla de Keynote. Detalles y ejemplo en [`temas/README.md`](temas/README.md).

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `listar_presentaciones_abiertas` | id, nombre, archivo, diapositivas, tema, tamaño, si es editable |
| `abrir` | abre una copia de un `.key`/`.pptx`/`.ppt` |
| `crear` | presentación nueva con un tema de Keynote; la guarda en la carpeta de trabajo |
| `leer_presentacion` | por diapositiva: diseño, título, cuerpo, notas, transición, objetos (con `detalle`: posiciones y celdas) |
| `agregar_diapositiva`, `poner_texto`, `notas` | diapositivas, textos y notas del presentador |
| `exportar` | PDF, PPTX, PNG, JPEG, video, HTML, Keynote ’09 o GIF; `etapas` (un paso de animación por imagen); PDF `con_notas` |
| `ver_diapositiva` | imagen de una diapositiva, para que Claude la revise |
| `guardar`, `cerrar` | solo para presentaciones de la carpeta de trabajo |
| `crear_con_formato` | presentación nueva con el tema activo (trae prototipos ocultos al final) |
| `diapositiva_portada` / `_divisor` / `_contenido` / `_figura` / `_tabla` / `_cierre` | una diapositiva del formato; la figura va sobre tarjeta blanca con pie de origen |
| `grafica` | gráfica nativa de Keynote (17 tipos) con la paleta y leyenda |
| `grafica_cientifica` | matplotlib → PDF vectorial: barras de error, cotas, log/symlog, bandas, histogramas, segundo eje, fórmulas `$…$` |
| `tabla`, `editar_celdas`, `tabla_estructura` | tabla con el estilo del tema; editar; fusionar, ordenar, filas y columnas |
| `ecuacion` | LaTeX real (amsmath y paquetes extra) como imagen vectorial |
| `forma` | figuras vectoriales con la paleta y texto encima |
| `cifras_destacadas`, `tarjetas_numeradas`, `agenda`, `diapositiva_video` | componentes del formato |
| `estilo_texto` | tipografía (de títulos o de texto), tamaño, color, negrita, cursiva |
| `transicion`, `revelar_por_pasos`, `animar_cambio`, `revelar_series` | transiciones y animaciones con Magic Move |
| `insertar_medio`, `linea`, `duplicar_diapositiva`, `mover_objeto`, `borrar_objeto` | medios y objetos |
| `alinear_objetos`, `distribuir_objetos`, `bloquear_objeto` | disposición |
| `buscar_reemplazar` | en textos, notas y celdas de toda la presentación |
| `borrar_diapositiva`, `mover_diapositiva`, `ocultar_diapositiva` | manejo de diapositivas (los prototipos están protegidos) |
| `diapositivas_desde_imagenes` | una diapositiva por imagen |
| `revisar_presentacion` | reporte de problemas por gravedad, con hoja de contacto |
| `presentar` | iniciar, avanzar, retroceder, detener (ocupa la pantalla) |

## Reglas que el código hace cumplir

- **Copias, siempre.** `abrir` copia el archivo a la carpeta de trabajo antes de abrirlo.
- **Solo es editable lo que tiene archivo dentro de la carpeta de trabajo.** Lo demás (tus
  presentaciones, documentos sin guardar) se puede leer, ver y exportar, pero no modificar,
  guardar ni cerrar.
- **Nada de borradores en iCloud:** `crear` y `crear_con_formato` guardan de inmediato en la
  carpeta de trabajo (sin archivo, Keynote deja un `Untitled N.key` en iCloud al exportar).
- **Exportar nunca sobrescribe**: agrega `_2`, `_3`…
- Los textos y rutas viajan como argumentos de `osascript`, nunca interpolados en los scripts.
  LaTeX se compila sin shell-escape y sin `\input`.

## Límites de Keynote por script

No se pueden fijar por script: el relleno de las figuras nativas, el espaciado de letras, la
alineación de párrafo, subíndices en texto, el color de cada serie de una gráfica nativa, los
bordes de tabla, los enlaces entre diapositivas, agrupar objetos o el orden de apilado. Atril
rodea varios: figuras y ecuaciones vectoriales, prototipos en la plantilla, Magic Move para
animar, leyendas propias. Duplicar o mover diapositivas **entre dos documentos** cierra Keynote
de golpe: Atril no lo hace. Detalles técnicos en [`CLAUDE.md`](CLAUDE.md).

## Desarrollo

```bash
npm run check
```

Las pruebas hablan con el servidor por MCP real (stdio), abren Keynote y usan su propia carpeta
de trabajo en `trabajo/` (con archivos de prueba sintéticos que generan ellas mismas):

```bash
node test/fase1.ts
```

```bash
node test/fase2.ts
```

`fase1` núcleo · `fase2` formato (`ATRIL_TEMA=papel` para el tema claro) · `fase3` gráficas,
tablas, transiciones y medios · `fase4` animaciones · `fase5` revisión · `fase6` ecuaciones,
figuras y componentes · `fase8` edición y exportación · `fase9` gráficas científicas.
`test/arranque_frio.ts` **cierra Keynote** (se niega si hay documentos abiertos).

## Seguridad

Atril controla Keynote en tu Mac con permisos de Automatización. Solo modifica archivos dentro
de su carpeta de trabajo, pero **puede leer cualquier archivo que se le indique** (por ejemplo,
`abrir` o `insertar_medio`). Si un texto malicioso engañara a Claude (inyección de prompt
desde una página, un correo o un documento), en teoría podría meter un archivo local en una
presentación; el archivo no sale de tu Mac a menos que compartas esa presentación. Revisa lo
que Claude va a insertar antes de compartir una presentación, y no le pidas trabajar con
material de fuentes en las que no confías.

Para reportar un problema de seguridad, abre un issue sin detalles sensibles o escribe al
autor por GitHub.

## Soporte

Es un proyecto personal que se mantiene en el tiempo libre: los issues y pull requests son
bienvenidos, pero no hay compromiso de respuesta ni de fechas. Probado solo con la versión de
Keynote y macOS indicadas arriba.

## Licencia

MIT. Ver [`LICENSE`](LICENSE).
