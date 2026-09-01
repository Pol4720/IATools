# Respuestas de las encuestas

Cada subcarpeta corresponde al identificador (slug) de una encuesta de
`sitio/encuestas/` y contiene sus respuestas recibidas, por ejemplo
`respuestas/experto-regulatorio/`.

## Cómo llegan aquí

La mayoría de los archivos se generan automáticamente: cuando alguien
completa una encuesta en línea y la envía por la vía de GitHub (una de
las opciones de envío), el flujo de trabajo
`.github/workflows/guardar-respuestas.yml` toma el issue generado y
guarda dos archivos:

- `AAAA-MM-DD-issue-N-titulo.md` — la respuesta completa en formato legible.
- `AAAA-MM-DD-issue-N-titulo.json` — los mismos datos en formato
  estructurado, para uso automatizado al diseñar la herramienta
  correspondiente.

La vía principal de envío (pensada para quien no tiene cuenta de GitHub)
es por correo: la respuesta descarga un archivo y abre el correo del
respondiente ya dirigido. Esas respuestas no llegan aquí automáticamente;
alguien del equipo las añade a mano (o pide que se incorporen) con el
mismo formato `.md`/`.json` que produce el flujo automático, para que
todas las respuestas —sin importar la vía— queden en un formato
consistente.

## Respuestas reconstruidas a partir de otros formatos

Algunas respuestas de `experto-regulatorio/` se recibieron en PDF
rellenado a mano o en un documento Word con las opciones marcadas con
resaltado, en vez de a través del formulario en línea. Esas respuestas
fueron transcritas a este mismo formato; cuando la interpretación de una
marca no era unívoca (por ejemplo, texto libre añadido junto a una
pregunta, en vez de marcar una opción predefinida), el archivo `.md`
correspondiente lo señala explícitamente en la respuesta o en las notas
de la sección, y el campo `fuente` del `.json` indica el origen. Ante
cualquier duda sobre una respuesta reconstruida, la fuente original queda
disponible con quien coordina el proyecto.

No es necesario (ni recomendable) editar a mano los archivos generados
automáticamente por el flujo de trabajo: para esos, el origen de verdad
es siempre el issue de GitHub correspondiente, enlazado dentro de cada
`.md`.
