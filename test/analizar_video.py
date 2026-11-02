#!/usr/bin/env python3
"""Ubica las animaciones de un video exportado por Keynote y extrae fotogramas.

Uso: python3 -I test/analizar_video.py VIDEO SALIDA.png [min_s] [max_s] [ruido]

ruido: tolerancia de freezedetect (0.001 por omisión); bájala para animaciones de
texto pequeño, que cambian pocos píxeles.

Con freezedetect se ubican los tramos en que la imagen está quieta; entre dos tramos
quietos hay movimiento. Un corte deja un hueco de ~0 s; una animación, uno de su duración.
Escribe SALIDA.png (una fila por animación: inicio, 25 %, 50 %, 75 %, final) y
SALIDA.json con los tramos.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

FFMPEG = "/opt/homebrew/bin/ffmpeg"


def huecos(video: str, minimo: float, maximo: float, ruido: float):
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", video, "-vf", f"freezedetect=n={ruido}:d=0.3",
                        "-map", "0:v", "-f", "null", "-"], capture_output=True, text=True)
    inicios = [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", r.stderr)]
    finales = [float(x) for x in re.findall(r"freeze_end: ([\d.]+)", r.stderr)]
    pares = [(fin, inicios[i + 1]) for i, fin in enumerate(finales) if i + 1 < len(inicios)]
    return [(a, b) for a, b in pares if minimo <= b - a <= maximo]


def main():
    video, salida = sys.argv[1], Path(sys.argv[2])
    minimo = float(sys.argv[3]) if len(sys.argv) > 3 else 0.4
    maximo = float(sys.argv[4]) if len(sys.argv) > 4 else 3.0
    ruido = float(sys.argv[5]) if len(sys.argv) > 5 else 0.001
    tramos = huecos(video, minimo, maximo, ruido)
    tmp = salida.with_suffix("")
    tmp.mkdir(parents=True, exist_ok=True)
    cuadros = []
    for i, (a, b) in enumerate(tramos):
        for k, f in enumerate([0.0, 0.25, 0.5, 0.75, 1.0]):
            t = a + (b - a) * f
            archivo = tmp / f"m{i:02d}_{k}.png"
            subprocess.run([FFMPEG, "-loglevel", "error", "-y", "-ss", f"{t:.3f}", "-i", video,
                            "-frames:v", "1", "-vf", "scale=384:-1", str(archivo)], check=True)
            cuadros.append(archivo)
    if cuadros:
        entradas = sum([["-i", str(c)] for c in cuadros], [])
        filas = len(tramos)
        filtro = ";".join(f"{''.join(f'[{r * 5 + k}]' for k in range(5))}hstack=inputs=5[f{r}]" for r in range(filas))
        filtro += (f";{''.join(f'[f{r}]' for r in range(filas))}vstack=inputs={filas}[o]" if filas > 1 else ";[f0]null[o]")
        subprocess.run([FFMPEG, "-loglevel", "error", "-y", *entradas, "-filter_complex", filtro,
                        "-map", "[o]", str(salida)], check=True)
    salida.with_suffix(".json").write_text(json.dumps([{"inicio": a, "fin": b, "duracion": round(b - a, 2)} for a, b in tramos], indent=1))
    for a, b in tramos:
        print(f"{a:7.2f}–{b:7.2f} s  ({b - a:.2f} s)")
    print(f"{len(tramos)} animaciones → {salida}")


if __name__ == "__main__":
    main()
