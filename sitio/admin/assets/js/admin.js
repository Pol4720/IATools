/**
 * Panel de administración de encuestas.
 * Funciona enteramente en el navegador: usa un token personal de GitHub
 * (proporcionado por quien administra, guardado solo en su navegador) para
 * leer y escribir directamente en el repositorio a través de la API REST
 * de GitHub (Contents API). No hay backend propio ni credenciales
 * compartidas: cada colaborador usa su propio token, con su propio
 * permiso de escritura sobre el repositorio.
 */
(function () {
  "use strict";

  const OWNER = "Pol4720";
  const REPO = "IATools";
  const RAMA = "main";
  const CLAVE_TOKEN = "iatools-admin:token";
  const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

  const el = (id) => document.getElementById(id);

  const estado = {
    token: localStorage.getItem(CLAVE_TOKEN) || "",
    registro: null,
    registroSha: null,
    editando: null, // slug en edición, o null si es una encuesta nueva
    preguntasSha: null,
    cacheMotor: null, // { css, i18n, app }
  };

  // ---------------------------------------------------------------
  // Cliente mínimo de la API de GitHub (Contents API)
  // ---------------------------------------------------------------

  function utf8ABase64(texto) {
    const bytes = new TextEncoder().encode(texto);
    let binario = "";
    bytes.forEach((b) => { binario += String.fromCharCode(b); });
    return btoa(binario);
  }

  function base64AUtf8(b64) {
    const binario = atob((b64 || "").replace(/\n/g, ""));
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function ghApi(ruta, opciones) {
    // Sin ruta, la URL debe ser la del repositorio sin barra final
    // (.../repos/OWNER/REPO), no .../repos/OWNER/REPO/ — GitHub responde
    // 404 a esa variante con barra, lo que antes rompía la verificación
    // del token incluso siendo válido.
    const url = ruta ? `${API}/${ruta}` : API;
    const resp = await fetch(url, {
      ...opciones,
      headers: {
        Authorization: `Bearer ${estado.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opciones && opciones.headers),
      },
    });
    return resp;
  }

  async function leerArchivo(ruta) {
    const resp = await ghApi(`contents/${ruta}?ref=${RAMA}`);
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`Error al leer ${ruta}: ${resp.status} ${(await resp.json().catch(() => ({}))).message || ""}`);
    const datos = await resp.json();
    return { contenido: base64AUtf8(datos.content), sha: datos.sha };
  }

  async function listarCarpeta(ruta) {
    const resp = await ghApi(`contents/${ruta}?ref=${RAMA}`);
    if (resp.status === 404) return [];
    if (!resp.ok) return [];
    const datos = await resp.json();
    return Array.isArray(datos) ? datos : [];
  }

  async function escribirArchivo(ruta, contenidoTexto, sha, mensaje) {
    const cuerpo = {
      message: mensaje,
      content: utf8ABase64(contenidoTexto),
      branch: RAMA,
    };
    if (sha) cuerpo.sha = sha;
    const resp = await ghApi(`contents/${ruta}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Error al guardar ${ruta}: ${resp.status} ${err.message || ""}`);
    }
    return resp.json();
  }

  async function eliminarArchivo(ruta, sha, mensaje) {
    const resp = await ghApi(`contents/${ruta}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: mensaje, sha, branch: RAMA }),
    });
    if (!resp.ok && resp.status !== 404) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Error al eliminar ${ruta}: ${resp.status} ${err.message || ""}`);
    }
  }

  // ---------------------------------------------------------------
  // Acceso
  // ---------------------------------------------------------------

  async function verificarAcceso() {
    // Paso 1: ¿el token es válido? (independiente de a qué repositorios
    // alcance, así el mensaje de error distingue "token inválido" de
    // "token válido pero sin acceso a este repositorio").
    const respUsuario = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${estado.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!respUsuario.ok) {
      const err = await respUsuario.json().catch(() => ({}));
      return {
        ok: false,
        motivo: `El token no es válido (código ${respUsuario.status}). ${err.message || "Revise que lo haya copiado completo y que no haya expirado."}`,
      };
    }

    // Paso 2: ¿ese token alcanza este repositorio? Se comprueba con una
    // lectura real (más fiable que el campo "permissions", que no
    // siempre viene presente según el tipo de token) e informa si el
    // problema es de alcance o de permiso de escritura.
    const respRepo = await ghApi("");
    if (!respRepo.ok) {
      const err = await respRepo.json().catch(() => ({}));
      return {
        ok: false,
        motivo: `El token es válido, pero no tiene acceso al repositorio ${OWNER}/${REPO} (código ${respRepo.status}). ${err.message || "Revise que el token incluya este repositorio en «Repository access»."}`,
      };
    }
    const datosRepo = await respRepo.json();
    if (datosRepo.permissions && datosRepo.permissions.push === false) {
      return {
        ok: false,
        motivo: "El token alcanza este repositorio, pero solo con permiso de lectura. Genere uno nuevo con «Contents: Read and write».",
      };
    }
    return { ok: true };
  }

  function mostrarMensajeAcceso(texto, esError) {
    const nodo = el("mensaje-acceso");
    nodo.hidden = false;
    nodo.textContent = texto;
    nodo.className = `admin-mensaje ${esError ? "admin-mensaje-error" : "admin-mensaje-ok"}`;
  }

  async function conectar(token) {
    estado.token = token;
    mostrarMensajeAcceso("Verificando…", false);
    try {
      const resultado = await verificarAcceso();
      if (!resultado.ok) {
        mostrarMensajeAcceso(resultado.motivo, true);
        estado.token = "";
        return;
      }
      localStorage.setItem(CLAVE_TOKEN, token);
      await mostrarPanelPrincipal();
    } catch (err) {
      mostrarMensajeAcceso(`No se pudo conectar: ${err.message}`, true);
      estado.token = "";
    }
  }

  function cerrarSesion() {
    localStorage.removeItem(CLAVE_TOKEN);
    estado.token = "";
    location.reload();
  }

  // ---------------------------------------------------------------
  // Listado de encuestas
  // ---------------------------------------------------------------

  async function cargarRegistro() {
    const archivo = await leerArchivo("sitio/registro.json");
    if (!archivo) {
      estado.registro = { encuestas: [] };
      estado.registroSha = null;
    } else {
      estado.registro = JSON.parse(archivo.contenido);
      estado.registroSha = archivo.sha;
    }
  }

  function renderListado() {
    const contenedor = el("listado-encuestas-admin");
    contenedor.innerHTML = "";
    const encuestas = estado.registro.encuestas || [];
    if (encuestas.length === 0) {
      contenedor.innerHTML = '<p class="admin-mensaje">Todavía no hay encuestas. Cree la primera con «+ Nueva encuesta».</p>';
      return;
    }
    encuestas.forEach((enc) => {
      const fila = document.createElement("div");
      fila.className = "admin-encuesta-fila";
      fila.innerHTML = `
        <div>
          <h3>${enc.icono || "📋"} ${enc.titulo_es || enc.slug}${enc.activa ? "" : '<span class="admin-estado-inactiva">Inactiva</span>'}</h3>
          <p>/encuestas/${enc.slug}/ — ${enc.descripcion_es || ""}</p>
        </div>
        <div class="admin-encuesta-acciones">
          <button type="button" class="boton boton-secundario" data-accion="editar" data-slug="${enc.slug}">Editar</button>
          <button type="button" class="boton boton-secundario" data-accion="alternar" data-slug="${enc.slug}">${enc.activa ? "Desactivar" : "Activar"}</button>
          <a class="boton boton-secundario" href="../encuestas/${enc.slug}/" target="_blank" rel="noopener">Ver</a>
        </div>
      `;
      contenedor.appendChild(fila);
    });

    contenedor.querySelectorAll('[data-accion="editar"]').forEach((b) => {
      b.addEventListener("click", () => abrirEditor(b.dataset.slug));
    });
    contenedor.querySelectorAll('[data-accion="alternar"]').forEach((b) => {
      b.addEventListener("click", () => alternarActiva(b.dataset.slug));
    });
  }

  async function alternarActiva(slug) {
    const enc = estado.registro.encuestas.find((e) => e.slug === slug);
    if (!enc) return;
    enc.activa = !enc.activa;
    await guardarRegistro(`chore(encuestas): ${enc.activa ? "activar" : "desactivar"} ${slug}`);
    renderListado();
  }

  async function guardarRegistro(mensaje) {
    const resultado = await escribirArchivo(
      "sitio/registro.json",
      JSON.stringify(estado.registro, null, 2) + "\n",
      estado.registroSha,
      mensaje
    );
    estado.registroSha = resultado.content.sha;
  }

  // ---------------------------------------------------------------
  // Plantilla de index.html de una encuesta (compartida con la previa)
  // ---------------------------------------------------------------

  function cuerpoHtmlEncuesta() {
    return `
<a class="enlace-saltar" href="#contenido-principal" data-i18n="ui.saltarContenido">Saltar al contenido principal</a>
<header class="encabezado">
  <div class="encabezado-fila">
    <div class="encabezado-marca">
      <a href="../../" class="encabezado-icono-enlace" aria-label="Ir al listado de encuestas"><span class="encabezado-icono" aria-hidden="true">🧬</span></a>
      <div>
        <p class="encabezado-institucion" data-i18n="meta.subtitulo"></p>
        <h1 class="encabezado-titulo" data-i18n="meta.titulo"></h1>
      </div>
    </div>
    <div class="encabezado-controles">
      <button type="button" id="boton-idioma" class="boton-idioma" aria-label="Cambiar idioma / Switch language"><span id="boton-idioma-texto">EN</span></button>
    </div>
  </div>
  <div class="barra-progreso" role="progressbar" aria-valuemin="0" aria-valuemax="100" id="barra-progreso" aria-label="Progreso"><div class="barra-progreso-relleno" id="barra-progreso-relleno"></div></div>
  <p class="progreso-texto" id="progreso-texto"></p>
</header>
<main id="contenido-principal" class="contenedor">
  <section id="pantalla-intro" class="tarjeta intro">
    <div id="intro-parrafos"></div>
    <p class="intro-tiempo" id="intro-tiempo" data-i18n="meta.tiempoEstimado"></p>
    <div id="aviso-borrador" class="aviso-borrador" hidden><p id="aviso-borrador-texto"></p><button type="button" id="boton-descartar-borrador" class="boton boton-texto" data-i18n="ui.empezarDeNuevo"></button></div>
    <nav class="mapa-secciones" id="mapa-secciones" aria-label="Secciones"></nav>
    <button type="button" id="boton-comenzar" class="boton boton-primario boton-grande"><span data-i18n="ui.comenzar"></span></button>
  </section>
  <form id="formulario" novalidate hidden>
    <div id="pasos-secciones"></div>
    <section id="paso-revision" class="tarjeta paso" data-paso="revision" hidden>
      <h2 data-i18n="ui.revisionTitulo"></h2>
      <p data-i18n="ui.revisionDescripcion"></p>
      <div id="resumen-revision" class="resumen-revision"></div>
    </section>
    <nav class="navegacion-pasos" aria-label="Navegación">
      <button type="button" id="boton-anterior" class="boton boton-secundario" data-i18n="ui.anterior"></button>
      <button type="button" id="boton-siguiente" class="boton boton-primario" data-i18n="ui.siguiente"></button>
    </nav>
    <section id="pantalla-envio" class="tarjeta envio" hidden>
      <h2 data-i18n="ui.envioTitulo"></h2>
      <ol class="envio-pasos" id="envio-instrucciones"></ol>
      <div class="envio-botones"><button type="button" id="boton-enviar-correo" class="boton boton-primario boton-grande" data-i18n="ui.enviarCorreo"></button></div>
      <p class="envio-resultado" id="envio-resultado" role="status" hidden></p>
      <p class="envio-nota" data-i18n="ui.envioNotaAlternativa"></p>
      <details class="envio-otras-opciones">
        <summary data-i18n="ui.otrasOpcionesEnvioTitulo"></summary>
        <p data-i18n="ui.otrasOpcionesEnvioDescripcion"></p>
        <div class="envio-botones envio-botones-secundarios">
          <button type="button" id="boton-enviar-github" class="boton boton-secundario" data-i18n="ui.enviarGithub"></button>
          <button type="button" id="boton-descargar-md" class="boton boton-secundario" data-i18n="ui.descargarTexto"></button>
          <button type="button" id="boton-descargar-json" class="boton boton-secundario" data-i18n="ui.descargarJson"></button>
        </div>
      </details>
    </section>
  </form>
</main>
<footer class="pie"><p data-i18n="ui.pieTexto"></p><p class="pie-secundario"><a id="enlace-version-pdf" href="#" data-i18n="ui.versionPdf"></a></p></footer>
<div id="region-anuncios" class="visualmente-oculto" role="status" aria-live="polite"></div>
`.trim();
  }

  function escaparHtml(texto) {
    return String(texto || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // JSON.stringify seguro para insertar dentro de un <script>: además evita
  // que un valor con "</script>" corte la etiqueta antes de tiempo.
  function jsonParaScript(valor) {
    return JSON.stringify(valor).replace(/</g, "\\u003c");
  }

  function paginaHtmlEncuesta(config) {
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escaparHtml(config.tituloEs)} | Instituto Finlay de Vacunas</title>
<meta name="description" content="${escaparHtml(config.descripcionEs)}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>${config.icono}</text></svg>">
<link rel="stylesheet" href="../../motor/css/estilos.css">
</head>
<body>
${cuerpoHtmlEncuesta()}
<script>
  window.CONFIG_ENCUESTA = {
    slug: ${jsonParaScript(config.slug)},
    datos: "./preguntas.json",
    pdfBase: ${jsonParaScript(`./pdf/${config.slug}`)},
    correoDestino: ${jsonParaScript(config.correo)},
    repoOwner: ${jsonParaScript(OWNER)},
    repoName: ${jsonParaScript(REPO)},
  };
<\/script>
<script src="../../motor/js/i18n-ui.js"><\/script>
<script src="../../motor/js/app.js"><\/script>
</body>
</html>
`;
  }

  // ---------------------------------------------------------------
  // Editor
  // ---------------------------------------------------------------

  const SNIPPETS = {
    seccion: {
      id: "nueva_seccion", icono: "📋",
      titulo_es: "Título de la sección", titulo_en: "Section title",
      descripcion_es: "Descripción breve.", descripcion_en: "Short description.",
      campos: [],
    },
    texto: { id: "campo_texto", tipo: "texto", requerido: false, etiqueta_es: "Etiqueta", etiqueta_en: "Label" },
    parrafo: { id: "campo_parrafo", tipo: "parrafo", requerido: false, etiqueta_es: "Etiqueta", etiqueta_en: "Label" },
    unica: {
      id: "campo_unica", tipo: "unica", requerido: false, etiqueta_es: "Etiqueta", etiqueta_en: "Label",
      opciones: [{ valor: "opcion_1", es: "Opción 1", en: "Option 1" }, { valor: "opcion_2", es: "Opción 2", en: "Option 2" }],
    },
    multiple: {
      id: "campo_multiple", tipo: "multiple", requerido: false, permite_otro: true, etiqueta_es: "Etiqueta", etiqueta_en: "Label",
      opciones: [{ valor: "opcion_1", es: "Opción 1", en: "Option 1" }, { valor: "opcion_2", es: "Opción 2", en: "Option 2" }],
    },
    escala: {
      id: "campo_escala", tipo: "escala", requerido: false, escala_min: 1, escala_max: 5,
      etiqueta_es: "Etiqueta", etiqueta_en: "Label",
      etiqueta_min_es: "Mínimo", etiqueta_min_en: "Minimum", etiqueta_max_es: "Máximo", etiqueta_max_en: "Maximum",
    },
  };

  function limpiarEditor() {
    ["editor-slug", "editor-titulo-es", "editor-titulo-en", "editor-descripcion-es", "editor-descripcion-en",
      "editor-correo", "editor-intro-es", "editor-intro-en"].forEach((id) => { el(id).value = ""; });
    el("editor-icono").value = "📋";
    el("editor-activa").checked = true;
    el("editor-secciones-json").value = JSON.stringify([SNIPPETS.seccion], null, 2);
    el("editor-json-error").hidden = true;
    el("editor-guardar-estado").hidden = true;
    el("iframe-previa").srcdoc = "";
  }

  async function abrirEditor(slug) {
    limpiarEditor();
    estado.editando = slug || null;
    el("editor-slug").disabled = !!slug;
    el("editor-titulo").textContent = slug ? `Editar: ${slug}` : "Nueva encuesta";

    if (slug) {
      const archivo = await leerArchivo(`sitio/encuestas/${slug}/preguntas.json`);
      if (!archivo) { alert("No se encontró preguntas.json para esta encuesta."); return; }
      const datos = JSON.parse(archivo.contenido);
      estado.preguntasSha = archivo.sha;
      const registroEnc = (estado.registro.encuestas || []).find((e) => e.slug === slug) || {};

      el("editor-slug").value = slug;
      el("editor-titulo-es").value = datos.meta.titulo_es || "";
      el("editor-titulo-en").value = datos.meta.titulo_en || "";
      el("editor-descripcion-es").value = registroEnc.descripcion_es || "";
      el("editor-descripcion-en").value = registroEnc.descripcion_en || "";
      el("editor-icono").value = registroEnc.icono || "📋";
      el("editor-correo").value = datos.correo_destino || "";
      el("editor-activa").checked = registroEnc.activa !== false;
      el("editor-intro-es").value = (datos.meta.introduccion_es || []).join("\n");
      el("editor-intro-en").value = (datos.meta.introduccion_en || []).join("\n");
      el("editor-secciones-json").value = JSON.stringify(datos.secciones || [], null, 2);
    } else {
      estado.preguntasSha = null;
    }

    el("pantalla-listado").hidden = true;
    el("pantalla-editor").hidden = false;
  }

  function volverAlListado() {
    el("pantalla-editor").hidden = true;
    el("pantalla-listado").hidden = false;
    renderListado();
  }

  function insertarSnippet(clave) {
    const area = el("editor-secciones-json");
    let valor;
    try {
      valor = JSON.parse(area.value || "[]");
    } catch (err) {
      alert("Corrija primero el JSON actual (tiene un error de sintaxis) antes de insertar una plantilla.");
      return;
    }
    if (clave === "seccion") {
      valor.push(JSON.parse(JSON.stringify(SNIPPETS.seccion)));
    } else {
      if (valor.length === 0) valor.push(JSON.parse(JSON.stringify(SNIPPETS.seccion)));
      valor[valor.length - 1].campos.push(JSON.parse(JSON.stringify(SNIPPETS[clave])));
    }
    area.value = JSON.stringify(valor, null, 2);
  }

  const TIPOS_VALIDOS = new Set(["texto", "parrafo", "unica", "multiple", "escala"]);

  function validarSecciones(secciones) {
    if (!Array.isArray(secciones)) return "La raíz debe ser una lista de secciones.";
    const idsSeccion = new Set();
    const idsCampo = new Set();
    for (const seccion of secciones) {
      if (!seccion.id || !seccion.titulo_es || !seccion.titulo_en) return `Cada sección necesita id, titulo_es y titulo_en (revise «${seccion.id || "?"}»).`;
      if (idsSeccion.has(seccion.id)) return `El id de sección «${seccion.id}» está repetido.`;
      idsSeccion.add(seccion.id);
      if (!Array.isArray(seccion.campos)) return `La sección «${seccion.id}» no tiene una lista «campos».`;
      for (const campo of seccion.campos) {
        if (!campo.id || !campo.tipo) return `Cada campo necesita id y tipo (sección «${seccion.id}»).`;
        if (idsCampo.has(campo.id)) return `El id de campo «${campo.id}» está repetido.`;
        idsCampo.add(campo.id);
        if (!TIPOS_VALIDOS.has(campo.tipo)) return `Tipo desconocido «${campo.tipo}» en el campo «${campo.id}» (use texto, parrafo, unica, multiple o escala).`;
        if (!campo.etiqueta_es || !campo.etiqueta_en) return `El campo «${campo.id}» necesita etiqueta_es y etiqueta_en.`;
        if ((campo.tipo === "unica" || campo.tipo === "multiple")) {
          if (!Array.isArray(campo.opciones) || campo.opciones.length === 0) return `El campo «${campo.id}» necesita al menos una opción.`;
          for (const op of campo.opciones) {
            if (!op.valor || !op.es || !op.en) return `Cada opción del campo «${campo.id}» necesita valor, es y en.`;
          }
        }
        if (campo.tipo === "escala") {
          if (typeof campo.escala_min !== "number" || typeof campo.escala_max !== "number") return `El campo «${campo.id}» necesita escala_min y escala_max numéricos.`;
        }
      }
    }
    return null;
  }

  function construirPreguntasDesdeEditor() {
    const slug = el("editor-slug").value.trim();
    if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("El identificador (slug) solo puede tener minúsculas, números y guiones.");
    let secciones;
    try {
      secciones = JSON.parse(el("editor-secciones-json").value || "[]");
    } catch (err) {
      throw new Error(`El JSON de secciones tiene un error de sintaxis: ${err.message}`);
    }
    const errorValidacion = validarSecciones(secciones);
    if (errorValidacion) throw new Error(errorValidacion);

    const datos = {
      version: "1.0.0",
      slug,
      pdf_nombre_base: slug,
      correo_destino: el("editor-correo").value.trim(),
      meta: {
        titulo_es: el("editor-titulo-es").value.trim(),
        titulo_en: el("editor-titulo-en").value.trim(),
        subtitulo_es: "Instituto Finlay de Vacunas — Proyecto de Inteligencia Artificial",
        subtitulo_en: "Instituto Finlay de Vacunas — Artificial Intelligence Project",
        introduccion_es: el("editor-intro-es").value.split("\n").map((s) => s.trim()).filter(Boolean),
        introduccion_en: el("editor-intro-en").value.split("\n").map((s) => s.trim()).filter(Boolean),
        tiempo_estimado_es: "Tiempo estimado: unos minutos (puede pausar y continuar cuando quiera)",
        tiempo_estimado_en: "Estimated time: a few minutes (you may pause and resume at any time)",
      },
      secciones,
    };
    return { slug, datos };
  }

  async function cargarMotorParaPrevia() {
    if (estado.cacheMotor) return estado.cacheMotor;
    const [css, i18n, app] = await Promise.all([
      fetch("../motor/css/estilos.css").then((r) => r.text()),
      fetch("../motor/js/i18n-ui.js").then((r) => r.text()),
      fetch("../motor/js/app.js").then((r) => r.text()),
    ]);
    estado.cacheMotor = { css, i18n, app };
    return estado.cacheMotor;
  }

  async function validarYPrevisualizar() {
    el("editor-json-error").hidden = true;
    let resultado;
    try {
      resultado = construirPreguntasDesdeEditor();
    } catch (err) {
      el("editor-json-error").hidden = false;
      el("editor-json-error").textContent = err.message;
      return null;
    }
    const motor = await cargarMotorParaPrevia();
    const srcdoc = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>${motor.css}</style></head><body>${cuerpoHtmlEncuesta()}
<script>window.CONFIG_ENCUESTA = { slug: ${jsonParaScript(resultado.slug)}, datosInline: ${jsonParaScript(resultado.datos)}, correoDestino: ${jsonParaScript(resultado.datos.correo_destino || "")} };<\/script>
<script>${motor.i18n}<\/script>
<script>${motor.app}<\/script>
</body></html>`;
    el("iframe-previa").srcdoc = srcdoc;
    return resultado;
  }

  async function guardarEncuesta() {
    const boton = el("boton-guardar-encuesta");
    const estadoTexto = el("editor-guardar-estado");
    boton.disabled = true;
    estadoTexto.hidden = false;
    estadoTexto.className = "admin-mensaje";
    estadoTexto.textContent = "Guardando…";
    try {
      const resultado = await validarYPrevisualizar();
      if (!resultado) { estadoTexto.hidden = true; boton.disabled = false; return; }
      const { slug, datos } = resultado;
      const esNueva = !estado.editando;

      if (esNueva && (estado.registro.encuestas || []).some((e) => e.slug === slug)) {
        throw new Error(`Ya existe una encuesta con el identificador «${slug}».`);
      }

      const rutaPreguntas = `sitio/encuestas/${slug}/preguntas.json`;
      const guardadoPreguntas = await escribirArchivo(
        rutaPreguntas,
        JSON.stringify(datos, null, 2) + "\n",
        estado.preguntasSha,
        esNueva ? `feat(encuestas): crear encuesta ${slug}` : `chore(encuestas): editar encuesta ${slug}`
      );
      estado.preguntasSha = guardadoPreguntas.content.sha;

      if (esNueva) {
        const rutaIndex = `sitio/encuestas/${slug}/index.html`;
        const html = paginaHtmlEncuesta({
          slug,
          tituloEs: datos.meta.titulo_es,
          descripcionEs: el("editor-descripcion-es").value.trim(),
          icono: el("editor-icono").value.trim() || "📋",
          correo: datos.correo_destino || "",
        });
        await escribirArchivo(rutaIndex, html, null, `feat(encuestas): crear encuesta ${slug}`);
      }

      const entradaRegistro = {
        slug,
        titulo_es: datos.meta.titulo_es,
        titulo_en: datos.meta.titulo_en,
        descripcion_es: el("editor-descripcion-es").value.trim(),
        descripcion_en: el("editor-descripcion-en").value.trim(),
        icono: el("editor-icono").value.trim() || "📋",
        activa: el("editor-activa").checked,
        creada: new Date().toISOString().slice(0, 10),
      };
      const indiceExistente = (estado.registro.encuestas || []).findIndex((e) => e.slug === slug);
      if (indiceExistente >= 0) {
        entradaRegistro.creada = estado.registro.encuestas[indiceExistente].creada || entradaRegistro.creada;
        estado.registro.encuestas[indiceExistente] = entradaRegistro;
      } else {
        estado.registro.encuestas = estado.registro.encuestas || [];
        estado.registro.encuestas.push(entradaRegistro);
      }
      await guardarRegistro(esNueva ? `feat(encuestas): registrar encuesta ${slug}` : `chore(encuestas): actualizar registro de ${slug}`);

      estado.editando = slug;
      el("editor-slug").disabled = true;
      estadoTexto.className = "admin-mensaje admin-mensaje-ok";
      estadoTexto.textContent = esNueva
        ? "Encuesta creada. El PDF editable se generará solo en unos minutos (flujo de trabajo de GitHub Actions); el sitio se publicará automáticamente."
        : "Cambios guardados. El sitio se actualizará automáticamente en unos minutos.";
    } catch (err) {
      estadoTexto.className = "admin-mensaje admin-mensaje-error";
      estadoTexto.textContent = err.message;
    } finally {
      boton.disabled = false;
    }
  }

  async function eliminarEncuesta() {
    const slug = estado.editando;
    if (!slug) { alert("Guarde primero la encuesta antes de poder eliminarla."); return; }
    if (!confirm(`¿Eliminar definitivamente la encuesta «${slug}»? Esta acción no se puede deshacer desde este panel.`)) return;

    try {
      const preguntas = await leerArchivo(`sitio/encuestas/${slug}/preguntas.json`);
      if (preguntas) await eliminarArchivo(`sitio/encuestas/${slug}/preguntas.json`, preguntas.sha, `chore(encuestas): eliminar encuesta ${slug}`);

      const index = await leerArchivo(`sitio/encuestas/${slug}/index.html`);
      if (index) await eliminarArchivo(`sitio/encuestas/${slug}/index.html`, index.sha, `chore(encuestas): eliminar encuesta ${slug}`);

      const pdfs = await listarCarpeta(`sitio/encuestas/${slug}/pdf`);
      for (const archivo of pdfs) {
        await eliminarArchivo(`sitio/encuestas/${slug}/pdf/${archivo.name}`, archivo.sha, `chore(encuestas): eliminar encuesta ${slug}`);
      }

      estado.registro.encuestas = (estado.registro.encuestas || []).filter((e) => e.slug !== slug);
      await guardarRegistro(`chore(encuestas): eliminar encuesta ${slug} del registro`);

      alert("Encuesta eliminada.");
      estado.editando = null;
      volverAlListado();
    } catch (err) {
      alert(`No se pudo eliminar por completo: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------
  // Arranque
  // ---------------------------------------------------------------

  async function mostrarPanelPrincipal() {
    el("pantalla-acceso").hidden = true;
    el("panel-principal").hidden = false;
    el("controles-sesion").innerHTML = '<button type="button" id="boton-cerrar-sesion" class="boton-idioma" data-sesion>Cerrar sesión</button>';
    el("boton-cerrar-sesion").addEventListener("click", cerrarSesion);

    el("listado-estado").hidden = false;
    el("listado-estado").textContent = "Cargando encuestas…";
    await cargarRegistro();
    el("listado-estado").hidden = true;
    renderListado();
  }

  function conectarEventos() {
    el("boton-conectar").addEventListener("click", () => {
      const token = el("campo-token").value.trim();
      if (!token) { mostrarMensajeAcceso("Pegue un token de acceso.", true); return; }
      conectar(token);
    });
    el("boton-nueva-encuesta").addEventListener("click", () => abrirEditor(null));
    el("boton-volver-listado").addEventListener("click", volverAlListado);
    el("boton-validar-previsualizar").addEventListener("click", validarYPrevisualizar);
    el("boton-guardar-encuesta").addEventListener("click", guardarEncuesta);
    el("boton-eliminar-encuesta").addEventListener("click", eliminarEncuesta);

    document.querySelectorAll("[data-snippet]").forEach((boton) => {
      boton.addEventListener("click", () => insertarSnippet(boton.dataset.snippet));
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    conectarEventos();
    if (estado.token) conectar(estado.token);
  });
})();
