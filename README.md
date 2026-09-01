# IATools

Proyecto general del Instituto Finlay de Vacunas para explorar y construir
herramientas de inteligencia artificial aplicadas al trabajo del instituto.

## Plataforma de encuestas

Antes de construir cualquier herramienta de IA para el instituto, empezamos
por levantar los requisitos directamente de las personas especialistas.
Para eso, el repositorio incluye una **plataforma de encuestas** genérica y
reutilizable: cada encuesta (por ejemplo, la del *Experto Regulatorio
Virtual*) es un caso particular de esta plataforma, no algo construido a
mano por separado.

- 🌐 **Encuestas en línea**: responsivas, bilingües (español/inglés), con
  ayudas contextuales en cada pregunta y guardado automático del progreso
  en el propio dispositivo.
  → `https://pol4720.github.io/IATools/`
- 📄 **Versión en PDF editable** de cada encuesta, generada automáticamente,
  para quien prefiera responder sin conexión o en papel.
- 🛠️ **Panel de administración** para crear, editar o eliminar encuestas sin
  tocar código a mano.
  → `https://pol4720.github.io/IATools/admin/`
- 📊 **Presentaciones de resultados**, HTML autocontenidas para discutir los
  hallazgos con el equipo.
  → `sitio/slides/`

### Cómo funciona, de un vistazo

```
Alguien completa una encuesta (web o PDF)
              │
              ▼
   Pulsa «Enviar mis respuestas»
              │
              ▼
Se descarga un archivo con sus respuestas y
se abre su correo, ya dirigido y con el
asunto listo (no requiere ninguna cuenta)
              │              ╲
              ▼               ╲ alternativa, si tiene
   Adjunta el archivo y        cuenta de GitHub: abre un
   pulsa «Enviar»              issue ya redactado
              │               ╱
              ▼              ╱
   Alguien del equipo añade el archivo a
   /respuestas/<encuesta> (o, por la vía de
   GitHub, un flujo de trabajo lo hace solo)
              │
              ▼
  Las respuestas quedan versionadas en git,
  listas para diseñar la herramienta correspondiente
```

No hace falta ningún servidor propio: todo el mecanismo vive dentro de
GitHub (Pages + Issues + Actions) más el correo electrónico de quien
responde, así que es autosuficiente, gratuito y fácil de mantener en el
tiempo. La vía de GitHub es solo un atajo opcional para quien ya tenga
cuenta; nadie necesita crear una para poder responder.

### Puesta en marcha (una sola vez, para quien administre el repositorio)

GitHub requiere dos ajustes manuales la primera vez que se activan estas
funciones en un repositorio (no se pueden activar por API):

1. **Activar GitHub Pages con origen "GitHub Actions":**
   `Settings → Pages → Build and deployment → Source: GitHub Actions`.
   A partir de ahí, cada cambio en `sitio/` lo publica automáticamente el
   flujo de trabajo `deploy-pages.yml`.
2. **Permitir que los flujos de trabajo puedan escribir en el repositorio:**
   `Settings → Actions → General → Workflow permissions → Read and write
   permissions`. Esto es lo que permite guardar respuestas y regenerar PDF
   automáticamente.

### Estructura del repositorio

```
sitio/                          Todo lo que se publica en GitHub Pages
  index.html                      Página de inicio: lista las encuestas activas
  registro.json                   Catálogo de encuestas (metadatos, no respuestas)
  motor/                          Motor compartido por todas las encuestas
    css/estilos.css                 Estilos responsivos con tema claro/oscuro
    js/app.js                       Renderizado, autoguardado, envío
    js/i18n-ui.js                   Textos de interfaz es/en
    generar_pdf.py                  Generador de PDF, compartido por todas las encuestas
  encuestas/
    experto-regulatorio/            Una encuesta = una carpeta
      index.html                      Página delgada que carga el motor compartido
      preguntas.json                  Fuente única de las preguntas (bilingüe)
      pdf/                            PDF generados (es/en), automáticos
  admin/                           Panel de administración (crear/editar/eliminar)
  slides/                          Presentaciones de resultados (HTML autocontenido)

respuestas/
  <slug-de-la-encuesta>/           Respuestas recibidas, una carpeta por encuesta

.github/
  ISSUE_TEMPLATE/                   Plantilla alternativa de envío por GitHub
  workflows/
    deploy-pages.yml                Publica sitio/ en GitHub Pages
    guardar-respuestas.yml          Convierte cada respuesta (vía GitHub) en archivo
    generar-pdf.yml                 Regenera el PDF de una encuesta cuando cambia
```

### Cómo crear o editar una encuesta

Hay dos vías, igual de válidas:

1. **Panel de administración** (`sitio/admin/`, pensado para colaboradores
   del repositorio): pide un token personal de GitHub de quien lo usa
   (con permiso de escritura solo sobre este repositorio, generado en
   [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   y guardado únicamente en su propio navegador), y desde ahí permite crear,
   editar, activar/desactivar o eliminar encuestas, con una vista previa en
   vivo antes de guardar. El PDF y la publicación en Pages se actualizan
   solos después de guardar.
2. **Pedirlo por chat** a quien mantenga el proyecto con IA: describir la
   encuesta deseada (secciones, preguntas, tipos de campo) y que la cree
   directamente en `sitio/encuestas/<slug>/preguntas.json` siguiendo el
   mismo esquema que ya usa `experto-regulatorio` (ver ese archivo como
   referencia: campos de tipo `texto`, `parrafo`, `unica`, `multiple` o
   `escala`, siempre con etiquetas en español e inglés).

En ambos casos, basta con que exista `preguntas.json` y una entrada en
`sitio/registro.json` para que la encuesta quede disponible en
`https://pol4720.github.io/IATools/encuestas/<slug>/`.

### Desarrollo local

El sitio es HTML/CSS/JS sin dependencias ni paso de construcción. Para
probarlo localmente (necesario porque usa `fetch` para cargar las
preguntas, lo que no funciona abriendo el archivo directamente):

```bash
cd sitio
python3 -m http.server 8000
# abrir http://localhost:8000/ en el navegador
```

Para regenerar el PDF de una encuesta después de editar su
`preguntas.json` (esto también ocurre automáticamente al fusionar un
cambio a `main`, vía `generar-pdf.yml`):

```bash
pip install reportlab
python3 sitio/motor/generar_pdf.py sitio/encuestas/experto-regulatorio
```

### Próximos pasos

La primera encuesta (`experto-regulatorio`) ya tiene respuestas en
[`/respuestas/experto-regulatorio`](./respuestas/experto-regulatorio), con
un resumen visual en
[`sitio/slides/resumen-experto-regulatorio.html`](./sitio/slides/resumen-experto-regulatorio.html).
Con esas respuestas como base, el siguiente paso del proyecto es diseñar,
implementar y someter a validación intensiva el propio experto regulatorio
virtual.
