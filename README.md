# IATools

Proyecto general del Instituto Finlay de Vacunas para explorar y construir
herramientas de inteligencia artificial aplicadas al trabajo del instituto.

## Experto Regulatorio Virtual — Formulario de requisitos

Antes de construir una herramienta de IA capaz de actuar como un experto en
marco regulatorio biofarmacéutico, biotecnológico y de inteligencia
artificial (siempre actualizado, a nivel internacional y en Cuba),
necesitamos levantar los requisitos directamente de las personas
especialistas del instituto.

Para eso existe este primer entregable: un **formulario de requisitos**, en
dos versiones equivalentes, pensado para personas sin conocimientos técnicos
de informática o de IA.

- 🌐 **Formulario en línea** (recomendado): responsivo, bilingüe
  (español/inglés), con ayudas contextuales en cada pregunta y guardado
  automático del progreso en el propio dispositivo.
  → `formulario-requisitos/` — se publica automáticamente en GitHub Pages.
- 📄 **Versión en PDF editable**, para quien prefiera responder sin
  conexión o en papel.
  → `formulario-requisitos/pdf/formulario-requisitos-ia-regulatoria-es.pdf`
  (también disponible en inglés).

Las respuestas enviadas desde el formulario en línea quedan guardadas de
forma permanente en este repositorio, dentro de la carpeta
[`/respuestas`](./respuestas), para que después un agente de IA pueda usarlas
como base para diseñar, implementar y validar el propio experto regulatorio
virtual.

### Cómo funciona, de un vistazo

```
Especialista completa el formulario (web o PDF)
              │
              ▼
   Pulsa «Enviar mis respuestas»
              │
              ▼
 Se abre un issue de GitHub ya redactado
   (sin necesidad de backend ni claves)
              │
              ▼
   El flujo de trabajo "Guardar respuesta
   del formulario" lo convierte en un
   archivo dentro de /respuestas
              │
              ▼
  Las respuestas quedan versionadas en git,
  listas para diseñar el experto regulatorio
```

No hace falta ningún servidor propio: todo el mecanismo vive dentro de
GitHub (Pages + Issues + Actions), así que es autosuficiente, gratuito y
fácil de mantener en el tiempo.

### Puesta en marcha (una sola vez, para quien administre el repositorio)

GitHub requiere dos ajustes manuales la primera vez que se activan estas
funciones en un repositorio (no se pueden activar por API):

1. **Activar GitHub Pages con origen "GitHub Actions":**
   `Settings → Pages → Build and deployment → Source: GitHub Actions`.
   A partir de ahí, cada cambio en `formulario-requisitos/` lo publica
   automáticamente el flujo de trabajo `deploy-pages.yml`.
2. **Permitir que los flujos de trabajo puedan escribir en el repositorio:**
   `Settings → Actions → General → Workflow permissions → Read and write
   permissions`. Esto es lo que le permite a `guardar-respuestas.yml`
   guardar cada respuesta como un archivo dentro de `/respuestas`.

Una vez hecho esto, el enlace que se comparte con los especialistas es:
`https://pol4720.github.io/IATools/formulario-requisitos/`

### Estructura del repositorio

```
formulario-requisitos/       Formulario en línea (HTML/CSS/JS sin build) y PDF
  data/preguntas.json          Fuente única de las preguntas (bilingüe),
                                usada tanto por la web como por el PDF
  assets/                      Estilos, motor de renderizado e i18n
  pdf/                          Generador del PDF y los PDF ya generados
respuestas/                  Respuestas recibidas, guardadas automáticamente
.github/
  ISSUE_TEMPLATE/               Plantilla alternativa de envío por GitHub
  workflows/
    deploy-pages.yml            Publica formulario-requisitos/ en Pages
    guardar-respuestas.yml      Convierte cada respuesta en un archivo versionado
```

### Desarrollo local

El formulario es HTML/CSS/JS sin dependencias ni paso de construcción.
Para probarlo localmente (necesario porque usa `fetch` para cargar las
preguntas, lo que no funciona abriendo el archivo directamente):

```bash
cd formulario-requisitos
python3 -m http.server 8000
# abrir http://localhost:8000/ en el navegador
```

Para regenerar los PDF después de editar `data/preguntas.json`:

```bash
cd formulario-requisitos/pdf
pip install reportlab
python3 generar_formulario_pdf.py
```

Ambas versiones (web y PDF) leen el mismo archivo `data/preguntas.json`,
así que basta con editarlo una vez para mantenerlas sincronizadas.

### Próximos pasos

Este formulario es el punto de partida. Con las respuestas acumuladas en
`/respuestas`, el siguiente paso del proyecto es diseñar, implementar y
someter a validación intensiva el propio experto regulatorio virtual.
