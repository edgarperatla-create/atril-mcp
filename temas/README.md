# Temas

Un tema es una carpeta con un `tema.json`. Atril usa el de `ATRIL_TEMA` (nombre de una carpeta
de aquí o ruta a cualquier carpeta) y, si no se da, `noche`.

| Tema | Aspecto |
|---|---|
| `noche` | fondo azul noche, Georgia en títulos, Helvetica Neue en texto, acento ámbar; pie de origen obligatorio |
| `papel` | fondo claro, Avenir Next, acento terracota; pie de origen opcional |

## Crear uno

1. Copia una carpeta (`cp -R temas/noche temas/mio`) o crea una fuera del repo.
2. Edita `tema.json`.
3. Genera su plantilla de Keynote (abre y cierra un documento en Keynote):

   ```bash
   npm run plantilla -- temas/mio
   ```

4. Úsalo con `ATRIL_TEMA=mio` (o la ruta) al registrar el servidor.

## `tema.json`

```json
{
  "nombre": "Noche",
  "descripcion": "Una línea que Claude lee en las instrucciones del servidor.",
  "fuentes": { "titulo": "Georgia", "texto": "Helvetica Neue" },
  "colores": {
    "fondo": "11141C", "tarjeta": "1B2030", "tarjeta2": "262C40", "cabecera": "2E3752", "borde": "39435F",
    "titulo": "F4F1EA", "texto": "D8DCE6", "apagado": "8E97AB",
    "acento": "E3A35B", "acento2": "7FA7E0", "exito": "66C28F", "alerta": "E3765F",
    "blanco": "FFFFFF", "oscuro": "111827", "borde_figura": "D5DCE5"
  },
  "series": ["acento", "acento2", "exito", "alerta", "titulo", "apagado"],
  "fondo_portada": { "degradado": ["11141C", "2B3553"] },
  "origen_obligatorio": true,
  "ancho_caracter": 0.52
}
```

| Campo | Qué es |
|---|---|
| `fuentes` | familias instaladas en la Mac (como aparecen en el Catálogo Tipográfico). Atril resuelve sus variantes (negrita, cursiva) solo |
| `colores` | hex de 6 dígitos. Los 15 roles de arriba son obligatorios; puedes agregar nombres propios y usarlos en cualquier herramienta |
| `series` | orden de los colores de las series en las gráficas |
| `fondo_portada` | portada, divisores y cierre: `{ "degradado": [hex, hex] }`, o `{ "imagen": "fondo.jpg", "velo": 60, "credito": "Fondo: …" }` (imagen relativa a la carpeta del tema; `velo` es la opacidad, 0–100, de una capa del color de fondo encima) |
| `decoracion` | PNG transparente 16:9 que se pone encima del fondo en las diapositivas de contenido (opcional) |
| `origen_obligatorio` | si las figuras y videos deben llevar pie de origen; `revisar_presentacion` lo exige |
| `ancho_caracter` | ancho medio de un carácter del cuerpo, en em, para estimar el texto que Keynote encoge (0.48 para Calibri, 0.52 para Helvetica Neue) |

**Para qué se usa cada rol:** `fondo` diapositivas · `tarjeta`/`tarjeta2` tarjetas y celdas ·
`cabecera` fila de encabezado de tablas · `borde` bordes de tarjetas · `titulo` títulos y cifras ·
`texto` cuerpo · `apagado` pies y etiquetas · `acento` antetítulos, números de sección y líneas ·
`acento2`, `exito`, `alerta` series y énfasis · `blanco`/`borde_figura` tarjeta de las figuras ·
`oscuro` tinta de las gráficas sobre tarjeta blanca.

La geometría (16:9, posiciones de título, cuerpo y pies) es la misma en todos los temas.
