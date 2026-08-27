# Respuestas al formulario de requisitos

Esta carpeta se llena automáticamente. Cada vez que alguien completa el
[formulario de requisitos](../formulario-requisitos/) y lo envía, el flujo de
trabajo `.github/workflows/guardar-respuestas.yml` toma el issue de GitHub
generado y guarda aquí dos archivos:

- `AAAA-MM-DD-issue-N-titulo.md` — la respuesta completa en formato legible.
- `AAAA-MM-DD-issue-N-titulo.json` — los mismos datos en formato estructurado,
  para su uso automatizado al diseñar el experto regulatorio virtual.

No es necesario (ni recomendable) editar manualmente los archivos de esta
carpeta: el origen de verdad es siempre el issue de GitHub correspondiente,
enlazado dentro de cada archivo `.md`.
