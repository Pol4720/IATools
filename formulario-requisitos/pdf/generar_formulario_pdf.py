#!/usr/bin/env python3
"""Genera la versión PDF editable (rellenable) del formulario de requisitos.

Lee la misma fuente de datos que usa el formulario en línea
(``formulario-requisitos/data/preguntas.json``) para que ambas versiones
nunca se desincronicen, y produce un PDF con campos de formulario
reales (AcroForm): texto, párrafo, opción única, opción múltiple y escala.

Uso:
    python3 generar_formulario_pdf.py

Requiere: reportlab (``pip install reportlab``).
"""
from __future__ import annotations

import json
import textwrap
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

CARPETA_ACTUAL = Path(__file__).resolve().parent
RUTA_DATOS = CARPETA_ACTUAL.parent / "data" / "preguntas.json"

ANCHO_PAGINA, ALTO_PAGINA = A4
MARGEN = 2.0 * 72 / 2.54  # 2 cm en puntos
ANCHO_UTIL = ANCHO_PAGINA - 2 * MARGEN
Y_TOPE_INFERIOR = MARGEN + 30  # deja espacio para el pie de página

COLOR_PRIMARIO = HexColor("#0f6f6a")
COLOR_TEXTO = HexColor("#1f2933")
COLOR_TEXTO_SUAVE = HexColor("#52606d")
COLOR_BORDE = HexColor("#a9b7bb")

TEXTOS_UI = {
    "es": {
        "instituto": "Instituto Finlay de Vacunas — Proyecto de Inteligencia Artificial",
        "version_pdf": "Versión en PDF editable",
        "instrucciones_titulo": "Cómo completar este formulario",
        "instrucciones": [
            "Puede rellenar este PDF directamente en su computadora con cualquier lector que admita formularios "
            "(Adobe Acrobat Reader, Vista previa de macOS, Foxit, el propio navegador, etc.), o imprimirlo y "
            "completarlo a mano.",
            "Todas las preguntas son opcionales: responda con la profundidad que desee.",
            "Si prefiere hacerlo en línea, con guardado automático y en su idioma preferido, use el formulario "
            "web: https://pol4720.github.io/IATools/formulario-requisitos/",
            "Al terminar, envíe este PDF (por correo o a la persona que se lo compartió) o transcriba sus "
            "respuestas al formulario en línea.",
        ],
        "sin_limite": "Sea tan ambicioso/a como quiera: no hay límite técnico que deba autoimponerse.",
        "otro": "Otro (especifique):",
        "pagina": "Página",
        "seccion": "Sección",
    },
    "en": {
        "instituto": "Instituto Finlay de Vacunas — Artificial Intelligence Project",
        "version_pdf": "Editable PDF version",
        "instrucciones_titulo": "How to complete this form",
        "instrucciones": [
            "You can fill in this PDF directly on your computer with any reader that supports forms "
            "(Adobe Acrobat Reader, macOS Preview, Foxit, your browser, etc.), or print it and fill it in by hand.",
            "All questions are optional: answer in as much depth as you like.",
            "If you prefer to answer online, with automatic saving and in your preferred language, use the web "
            "form: https://pol4720.github.io/IATools/formulario-requisitos/",
            "When you are done, send this PDF back (by email or to whoever shared it with you) or transcribe "
            "your answers into the online form.",
        ],
        "sin_limite": "Be as ambitious as you like: there is no technical limit you should impose on yourself.",
        "otro": "Other (please specify):",
        "pagina": "Page",
        "seccion": "Section",
    },
}


class GeneradorPdf:
    def __init__(self, ruta_salida: Path, datos: dict, idioma: str):
        self.datos = datos
        self.idioma = idioma
        self.ui = TEXTOS_UI[idioma]
        self.c = canvas.Canvas(str(ruta_salida), pagesize=A4)
        self.c.setTitle(datos["meta"][f"titulo_{idioma}"])
        self.c.setAuthor("Instituto Finlay de Vacunas")
        self.form = self.c.acroForm
        self.y = ALTO_PAGINA - MARGEN
        self.numero_pagina = 1
        self.total_campos_creados = 0

    # ------------------------------------------------------------------
    # Utilidades de bajo nivel
    # ------------------------------------------------------------------

    def envolver_texto(self, texto: str, fuente: str, tamano: int, ancho_max: float) -> list[str]:
        self.c.setFont(fuente, tamano)
        palabras = texto.split()
        lineas: list[str] = []
        actual = ""
        for palabra in palabras:
            candidata = f"{actual} {palabra}".strip()
            if self.c.stringWidth(candidata, fuente, tamano) <= ancho_max:
                actual = candidata
            else:
                if actual:
                    lineas.append(actual)
                actual = palabra
        if actual:
            lineas.append(actual)
        return lineas or [""]

    def necesita_espacio(self, alto: float):
        if self.y - alto < Y_TOPE_INFERIOR:
            self.nueva_pagina()

    def pie_de_pagina(self):
        self.c.setFont("Helvetica", 8)
        self.c.setFillColor(COLOR_TEXTO_SUAVE)
        self.c.drawString(MARGEN, MARGEN / 2, self.datos["meta"][f"titulo_{self.idioma}"])
        self.c.drawRightString(
            ANCHO_PAGINA - MARGEN, MARGEN / 2, f"{self.ui['pagina']} {self.numero_pagina}"
        )
        self.c.setFillColor(COLOR_TEXTO)

    def nueva_pagina(self):
        self.pie_de_pagina()
        self.c.showPage()
        self.numero_pagina += 1
        self.y = ALTO_PAGINA - MARGEN

    def escribir_parrafo(self, texto: str, fuente="Helvetica", tamano=10, color=COLOR_TEXTO, espacio_bajo=6):
        for linea in self.envolver_texto(texto, fuente, tamano, ANCHO_UTIL):
            self.necesita_espacio(tamano + 4)
            self.c.setFont(fuente, tamano)
            self.c.setFillColor(color)
            self.c.drawString(MARGEN, self.y, linea)
            self.y -= tamano + 4
        self.y -= espacio_bajo
        self.c.setFillColor(COLOR_TEXTO)

    # ------------------------------------------------------------------
    # Portada
    # ------------------------------------------------------------------

    def portada(self):
        meta = self.datos["meta"]
        self.c.setFillColor(COLOR_PRIMARIO)
        self.c.rect(0, ALTO_PAGINA - 3.6 * 72, ANCHO_PAGINA, 3.6 * 72, fill=1, stroke=0)
        self.c.setFillColor(HexColor("#ffffff"))
        self.c.setFont("Helvetica", 10)
        self.c.drawString(MARGEN, ALTO_PAGINA - 1.0 * 72, self.ui["instituto"])
        self.c.setFont("Helvetica-Bold", 20)
        titulo_lineas = self.envolver_texto(meta[f"titulo_{self.idioma}"], "Helvetica-Bold", 20, ANCHO_UTIL)
        y_titulo = ALTO_PAGINA - 1.6 * 72
        for linea in titulo_lineas:
            self.c.drawString(MARGEN, y_titulo, linea)
            y_titulo -= 26
        self.c.setFont("Helvetica-Oblique", 11)
        self.c.drawString(MARGEN, y_titulo - 6, self.ui["version_pdf"])

        self.y = ALTO_PAGINA - 3.9 * 72
        self.c.setFillColor(COLOR_TEXTO)

        for parrafo in meta[f"introduccion_{self.idioma}"]:
            self.escribir_parrafo(parrafo, tamano=10.5)

        self.escribir_parrafo(meta[f"tiempo_estimado_{self.idioma}"], fuente="Helvetica-Bold", color=COLOR_PRIMARIO)

        self.y -= 6
        self.escribir_parrafo(self.ui["instrucciones_titulo"], fuente="Helvetica-Bold", tamano=12)
        for item in self.ui["instrucciones"]:
            self.escribir_parrafo(f"•  {item}", tamano=9.5, color=COLOR_TEXTO_SUAVE)

        self.nueva_pagina()

    # ------------------------------------------------------------------
    # Secciones y campos
    # ------------------------------------------------------------------

    def titulo_seccion(self, seccion: dict, indice: int):
        self.necesita_espacio(50)
        self.c.setFillColor(COLOR_PRIMARIO)
        self.c.rect(MARGEN, self.y - 4, ANCHO_UTIL, 30, fill=1, stroke=0)
        self.c.setFillColor(HexColor("#ffffff"))
        self.c.setFont("Helvetica-Bold", 12)
        etiqueta = f"{self.ui['seccion']} {indice + 1}/{len(self.datos['secciones'])} — {seccion[f'titulo_{self.idioma}']}"
        self.c.drawString(MARGEN + 8, self.y + 6, etiqueta)
        self.c.setFillColor(COLOR_TEXTO)
        self.y -= 34
        self.escribir_parrafo(seccion[f"descripcion_{self.idioma}"], tamano=9.5, color=COLOR_TEXTO_SUAVE, espacio_bajo=10)

    def etiqueta_campo(self, campo: dict):
        self.necesita_espacio(26)
        self.escribir_parrafo(campo[f"etiqueta_{self.idioma}"], fuente="Helvetica-Bold", tamano=10.5, espacio_bajo=2)
        ayuda = campo.get(f"ayuda_{self.idioma}")
        if ayuda:
            self.escribir_parrafo(ayuda, fuente="Helvetica-Oblique", tamano=8.5, color=COLOR_TEXTO_SUAVE, espacio_bajo=4)

    def nombre_unico(self, *partes: str) -> str:
        return "_".join(partes)

    def campo_texto(self, campo: dict, multilinea: bool = False, alto: float = 16):
        self.etiqueta_campo(campo)
        self.necesita_espacio(alto + 6)
        self.total_campos_creados += 1
        self.form.textfield(
            name=campo["id"],
            tooltip=campo[f"etiqueta_{self.idioma}"],
            x=MARGEN,
            y=self.y - alto + 10,
            width=ANCHO_UTIL,
            height=alto,
            borderStyle="underlined",
            borderColor=COLOR_BORDE,
            fillColor=None,
            forceBorder=True,
            fontSize=10,
            fieldFlags="multiline" if multilinea else 0,
        )
        self.y -= alto + 14

    def campo_opciones(self, campo: dict, tipo_input: str):
        self.etiqueta_campo(campo)
        opciones = list(campo["opciones"])
        if campo.get("permite_otro"):
            opciones = opciones + [{"valor": "__otro__", "es": self.ui["otro"], "en": self.ui["otro"]}]

        for opcion in opciones:
            self.necesita_espacio(16)
            texto_opcion = opcion.get(self.idioma) or opcion.get("es", "")
            tamano_marca = 10
            y_marca = self.y - 8
            self.total_campos_creados += 1
            if tipo_input == "radio":
                self.form.radio(
                    name=campo["id"],
                    value=opcion["valor"],
                    x=MARGEN,
                    y=y_marca,
                    size=tamano_marca,
                    buttonStyle="circle",
                    borderColor=COLOR_BORDE,
                    fillColor=None,
                    selected=False,
                )
            else:
                self.form.checkbox(
                    name=self.nombre_unico(campo["id"], opcion["valor"]),
                    x=MARGEN,
                    y=y_marca,
                    size=tamano_marca,
                    borderColor=COLOR_BORDE,
                    fillColor=None,
                    checked=False,
                )
            self.c.setFont("Helvetica", 9.5)
            self.c.setFillColor(COLOR_TEXTO)
            for i, linea in enumerate(self.envolver_texto(texto_opcion, "Helvetica", 9.5, ANCHO_UTIL - 20)):
                self.c.drawString(MARGEN + 16, self.y - 8 - (i * 11), linea)
            lineas_opcion = self.envolver_texto(texto_opcion, "Helvetica", 9.5, ANCHO_UTIL - 20)
            self.y -= 14 + (len(lineas_opcion) - 1) * 11

            ayuda_opcion = opcion.get(f"ayuda_{self.idioma}")
            if ayuda_opcion:
                self.necesita_espacio(12)
                self.c.setFont("Helvetica-Oblique", 8)
                self.c.setFillColor(COLOR_TEXTO_SUAVE)
                for linea in self.envolver_texto(ayuda_opcion, "Helvetica-Oblique", 8, ANCHO_UTIL - 20):
                    self.necesita_espacio(11)
                    self.c.drawString(MARGEN + 16, self.y, linea)
                    self.y -= 11
                self.c.setFillColor(COLOR_TEXTO)
                self.y -= 3

            if opcion["valor"] == "__otro__":
                self.necesita_espacio(18)
                self.total_campos_creados += 1
                self.form.textfield(
                    name=self.nombre_unico(campo["id"], "otro_texto"),
                    x=MARGEN + 16,
                    y=self.y - 12,
                    width=ANCHO_UTIL - 16,
                    height=14,
                    borderStyle="underlined",
                    borderColor=COLOR_BORDE,
                    fillColor=None,
                    forceBorder=True,
                    fontSize=9,
                )
                self.y -= 20
        self.y -= 8

    def campo_escala(self, campo: dict):
        self.etiqueta_campo(campo)
        self.necesita_espacio(26)
        minimo, maximo = campo["escala_min"], campo["escala_max"]
        ancho_opcion = ANCHO_UTIL / (maximo - minimo + 1)
        for n in range(minimo, maximo + 1):
            x_centro = MARGEN + (n - minimo) * ancho_opcion + ancho_opcion / 2
            self.total_campos_creados += 1
            self.form.radio(
                name=campo["id"],
                value=str(n),
                x=x_centro - 6,
                y=self.y - 8,
                size=12,
                buttonStyle="circle",
                borderColor=COLOR_BORDE,
                fillColor=None,
                selected=False,
            )
            self.c.setFont("Helvetica", 9)
            self.c.drawCentredString(x_centro, self.y - 22, str(n))
        self.y -= 30
        self.c.setFont("Helvetica-Oblique", 8.5)
        self.c.setFillColor(COLOR_TEXTO_SUAVE)
        self.c.drawString(MARGEN, self.y, f"{minimo} · {campo[f'etiqueta_min_{self.idioma}']}")
        self.c.drawRightString(ANCHO_PAGINA - MARGEN, self.y, f"{maximo} · {campo[f'etiqueta_max_{self.idioma}']}")
        self.c.setFillColor(COLOR_TEXTO)
        self.y -= 20

    def campo(self, campo: dict):
        tipo = campo["tipo"]
        if tipo == "texto":
            self.campo_texto(campo, multilinea=False, alto=16)
        elif tipo == "parrafo":
            self.campo_texto(campo, multilinea=True, alto=70 if campo.get("grande") else 40)
        elif tipo == "unica":
            self.campo_opciones(campo, "radio")
        elif tipo == "multiple":
            self.campo_opciones(campo, "checkbox")
        elif tipo == "escala":
            self.campo_escala(campo)
        else:
            raise ValueError(f"Tipo de campo desconocido: {tipo}")

    # ------------------------------------------------------------------
    # Orquestación
    # ------------------------------------------------------------------

    def generar(self):
        self.portada()
        for indice, seccion in enumerate(self.datos["secciones"]):
            self.titulo_seccion(seccion, indice)
            for c in seccion["campos"]:
                self.campo(c)
            self.y -= 8
        self.pie_de_pagina()
        self.c.save()
        return self.total_campos_creados


def generar_pdf(idioma: str, ruta_salida: Path) -> int:
    datos = json.loads(RUTA_DATOS.read_text(encoding="utf-8"))
    generador = GeneradorPdf(ruta_salida, datos, idioma)
    return generador.generar()


def main():
    for idioma in ("es", "en"):
        ruta_salida = CARPETA_ACTUAL / f"formulario-requisitos-ia-regulatoria-{idioma}.pdf"
        total_campos = generar_pdf(idioma, ruta_salida)
        tamano_kb = ruta_salida.stat().st_size / 1024
        print(f"[{idioma}] {ruta_salida.name}: {total_campos} campos de formulario, {tamano_kb:.0f} KB")


if __name__ == "__main__":
    main()
