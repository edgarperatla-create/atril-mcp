"""Gráfica científica con la paleta del tema.

Lee la especificación en JSON por stdin y escribe un PDF vectorial en la ruta de argv[1].
Atril (src/cientifica.ts) valida los colores y los números antes de llamar; aquí no se evalúa
nada que venga del usuario: los textos van a matplotlib como texto (con mathtext para $...$).

La figura mide exactamente `ancho`×`alto` puntos y Atril la inserta a ese tamaño, así que los
tamaños de letra son puntos reales en la diapositiva.
"""
import json
import sys

import matplotlib

matplotlib.use("pdf")
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.ticker  # noqa: E402
import numpy as np  # noqa: E402

e = json.load(sys.stdin)
salida = sys.argv[1]
P = e["paleta"]  # nombre → "#RRGGBB", ya resuelto por Atril
# Atril decide los colores de cada estilo: sobre tarjeta blanca, o sobre el fondo del tema.
E = e["colores_estilo"]
claro = E["fondo"] is not None  # con fondo propio (blanco); si no, transparente
tinta, suave, rejilla, ciclo = E["tinta"], E["suave"], E["rejilla"], E["ciclo"]
t = e.get("tamano_texto", 14)

plt.rcParams.update({
    # La tipografía de texto del tema si matplotlib la encuentra; si no, la sans de macOS.
    # Las fórmulas, en Computer Modern como las de `ecuacion`.
    "font.family": "sans-serif",
    "font.sans-serif": [e["fuente"], "Helvetica Neue", "Helvetica", "DejaVu Sans"],
    "mathtext.fontset": "cm",
    "font.size": t, "axes.labelsize": t + 2, "xtick.labelsize": t, "ytick.labelsize": t, "legend.fontsize": t,
    "text.color": tinta, "axes.labelcolor": tinta, "xtick.color": tinta, "ytick.color": tinta,
    "axes.edgecolor": suave, "axes.linewidth": 1.0,
    "xtick.direction": "in", "ytick.direction": "in", "xtick.top": True, "ytick.right": True,
    "xtick.minor.visible": True, "ytick.minor.visible": True,
    "xtick.major.size": 6, "ytick.major.size": 6, "xtick.minor.size": 3, "ytick.minor.size": 3,
    "pdf.fonttype": 42, "axes.unicode_minus": True,
})

fig, ax = plt.subplots(figsize=(e["ancho"] / 72, e["alto"] / 72))
fig.patch.set_facecolor(E["fondo"] or "none")
ax.set_facecolor(E["fondo"] or "none")
ax2 = None
if any(s.get("eje") == "derecho" for s in e["series"]) or e.get("eje_y2"):
    ax2 = ax.twinx()
    ax2.tick_params(which="both", direction="in")
    ax.tick_params(which="both", right=False)

ESTILO_LINEA = {"continua": "-", "discontinua": "--", "punteada": ":", "raya_punto": "-."}
MARCADOR = {"circulo": "o", "cuadrado": "s", "triangulo": "^", "rombo": "D", "estrella": "*", "cruz": "x", "mas": "+", "ninguno": "None"}


def error(v):
    if v is None:
        return None
    if isinstance(v, dict):
        return np.array([v["inf"], v["sup"]], dtype=float)
    return np.asarray(v, dtype=float)


for i, s in enumerate(e["series"]):
    a = ax2 if s.get("eje") == "derecho" else ax
    c = P[s["color"]] if s.get("color") else ciclo[i % len(ciclo)]
    tipo = s.get("tipo", "linea_puntos" if s.get("error_y") or s.get("error_x") else "linea")
    nombre = s.get("nombre")
    ls = ESTILO_LINEA[s.get("estilo_linea", "continua")]
    mk = MARCADOR[s.get("marcador", "circulo")]
    g = s.get("grosor", 2.0)
    alfa = s.get("opacidad", 100) / 100
    if tipo == "histograma":
        a.hist(s["valores"], bins=s.get("bins", "auto"), color=c, alpha=alfa * 0.85, label=nombre,
               histtype="stepfilled" if s.get("relleno", True) else "step", edgecolor=c, linewidth=g)
        continue
    if tipo == "banda":
        a.fill_between(s["x"], s["y_inf"], s["y_sup"], color=c, alpha=alfa * (0.3 if claro else 0.45), linewidth=0, label=nombre)
        continue
    x, y = np.asarray(s["x"], dtype=float), np.asarray(s["y"], dtype=float)
    ey, ex = error(s.get("error_y")), error(s.get("error_x"))
    if tipo == "barras":
        a.bar(x, y, width=s.get("ancho_barra", 0.8), color=c, alpha=alfa, yerr=ey, xerr=ex, label=nombre,
              error_kw={"ecolor": tinta, "elinewidth": 1.2, "capsize": 3})
        continue
    if tipo == "area":
        a.fill_between(x, y, color=c, alpha=alfa * 0.35, linewidth=0)
        a.plot(x, y, color=c, lw=g, ls=ls, label=nombre)
        continue
    if tipo == "escalon":
        a.step(x, y, where="mid", color=c, lw=g, ls=ls, label=nombre, alpha=alfa)
        continue
    linea = ls if tipo in ("linea", "linea_puntos") else "None"
    marca = mk if tipo in ("puntos", "linea_puntos") else "None"
    lim_sup = np.asarray(s["limite_superior"], dtype=bool) if s.get("limite_superior") else None
    if ey is not None or ex is not None or lim_sup is not None:
        if lim_sup is not None:
            # La flecha de una cota superior es su barra inferior: si no trae (o es 0), se le da
            # un 30 % del valor, que en escala log se ve como una flecha corta.
            flecha = np.abs(y) * 0.3
            if ey is None:
                ey = np.where(lim_sup, flecha, 0.0)
            elif ey.ndim == 1:
                ey = np.array([np.where(lim_sup & (ey == 0), flecha, ey), np.where(lim_sup, 0.0, ey)])
            else:
                ey = np.array([np.where(lim_sup & (ey[0] == 0), flecha, ey[0]), np.where(lim_sup, 0.0, ey[1])])
        a.errorbar(x, y, yerr=ey, xerr=ex, uplims=lim_sup if lim_sup is not None else False,
                   color=c, ecolor=c, elinewidth=1.3, capsize=3, ls=linea, lw=g, marker=marca,
                   ms=s.get("tamano_marcador", 6), mfc=c, mec=c, alpha=alfa, label=nombre)
    else:
        a.plot(x, y, color=c, ls=linea, lw=g, marker=marca, ms=s.get("tamano_marcador", 6), alpha=alfa, label=nombre)


def configurar(a, cfg, eje):
    if not cfg:
        return
    if cfg.get("titulo"):
        (a.set_xlabel if eje == "x" else a.set_ylabel)(cfg["titulo"])
    escala = cfg.get("escala", "lineal")
    fijar = a.set_xscale if eje == "x" else a.set_yscale
    if escala == "log":
        fijar("log")
    elif escala == "symlog":
        fijar("symlog", linthresh=cfg.get("umbral_lineal", 1.0))
    lim = (cfg.get("min"), cfg.get("max"))
    if lim != (None, None):
        (a.set_xlim if eje == "x" else a.set_ylim)(*lim)
    if cfg.get("invertir"):
        (a.invert_xaxis if eje == "x" else a.invert_yaxis)()
    if cfg.get("marcas") is not None:
        (a.set_xticks if eje == "x" else a.set_yticks)(cfg["marcas"], cfg.get("etiquetas_marcas"))


configurar(ax, e.get("eje_x"), "x")
configurar(ax, e.get("eje_y"), "y")
if ax2 is not None:
    configurar(ax2, e.get("eje_y2"), "y")

class Decimal(matplotlib.ticker.LogFormatter):
    """LogFormatter decide qué marcas llevan número; aquí solo cambia cómo se escribe."""

    def __call__(self, x, pos=None):
        return f"{x:g}" if super().__call__(x, pos) else ""


# En un eje log de menos de dos décadas, "6×10⁻¹" estorba: números normales (0.6).
for a, eje in [(ax, "x"), (ax, "y")] + ([(ax2, "y")] if ax2 is not None else []):
    if (a.get_xscale() if eje == "x" else a.get_yscale()) != "log":
        continue
    lo, hi = sorted(a.get_xlim() if eje == "x" else a.get_ylim())
    if lo > 0 and np.log10(hi / lo) < 2:
        ejes = a.xaxis if eje == "x" else a.yaxis
        ejes.set_major_formatter(Decimal(labelOnlyBase=False))
        ejes.set_minor_formatter(Decimal(labelOnlyBase=False, minor_thresholds=(2, 0.5)))

if e.get("rejilla", True):
    ax.grid(True, which="major", color=rejilla, lw=0.8, alpha=0.9 if claro else 0.7)
    ax.set_axisbelow(True)

for r in e.get("lineas_ref", []):
    c = P[r["color"]] if r.get("color") else suave
    ls = ESTILO_LINEA[r.get("estilo_linea", "discontinua")]
    if r["eje"] == "x":
        ax.axvline(r["valor"], color=c, ls=ls, lw=1.5)
    else:
        ax.axhline(r["valor"], color=c, ls=ls, lw=1.5)
    if r.get("etiqueta"):
        trans = ax.get_xaxis_transform() if r["eje"] == "x" else ax.get_yaxis_transform()
        pos = (r["valor"], 0.97) if r["eje"] == "x" else (0.98, r["valor"])
        ax.text(*pos, r["etiqueta"], transform=trans, color=c, fontsize=t - 1,
                ha="right" if r["eje"] == "y" else "left", va="bottom" if r["eje"] == "y" else "top",
                rotation=90 if r["eje"] == "x" else 0)

for n in e.get("anotaciones", []):
    ax.annotate(n["texto"], (n["x"], n["y"]), xytext=(n.get("dx", 0), n.get("dy", 0)), textcoords="offset points",
                color=P[n["color"]] if n.get("color") else tinta, fontsize=n.get("tamano", t),
                arrowprops={"arrowstyle": "->", "color": suave} if n.get("flecha") else None)

leyenda = e.get("leyenda", "auto")
if leyenda != "ninguna":
    h1, l1 = ax.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels() if ax2 is not None else ([], [])
    if l1 or l2:
        lugar = {"auto": "best", "arriba_derecha": "upper right", "arriba_izquierda": "upper left",
                 "abajo_derecha": "lower right", "abajo_izquierda": "lower left"}.get(leyenda, "best")
        lg = ax.legend(h1 + h2, l1 + l2, loc=lugar, frameon=False)
        for tx in lg.get_texts():
            tx.set_color(tinta)

fig.tight_layout(pad=0.4)
fig.savefig(salida, format="pdf", transparent=not claro)
