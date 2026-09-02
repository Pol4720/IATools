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
    seccionesEditando: [], // estructura editable en memoria (nunca se muestra como JSON)
    expandido: new Set(), // secciones/campos actualmente desplegados (por referencia de objeto)
    idAutoGenerado: new WeakSet(), // secciones/campos cuyo id se sigue derivando del título mientras no se edite a mano
    valorAutoGenerado: new WeakSet(), // opciones cuyo valor se sigue derivando del texto en español
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

  // Plantillas para preguntas nuevas, según el tipo elegido con los botones
  // "Añadir pregunta". El id/valor internos se autogeneran a partir del
  // texto en español y solo dejan de seguirlo si alguien los edita a mano
  // (ver ed-avanzado en el HTML generado).
  const ETIQUETAS_TIPO = {
    texto: "🔤 Texto corto",
    parrafo: "📝 Párrafo",
    unica: "🔘 Opción única",
    multiple: "☑️ Opción múltiple",
    escala: "📊 Escala",
  };
  const PLANTILLA_CAMPO = {
    texto: () => ({ tipo: "texto", requerido: false, etiqueta_es: "", etiqueta_en: "" }),
    parrafo: () => ({ tipo: "parrafo", requerido: false, etiqueta_es: "", etiqueta_en: "" }),
    unica: () => ({ tipo: "unica", requerido: false, etiqueta_es: "", etiqueta_en: "", opciones: [nuevaOpcion(), nuevaOpcion()] }),
    multiple: () => ({ tipo: "multiple", requerido: false, permite_otro: false, etiqueta_es: "", etiqueta_en: "", opciones: [nuevaOpcion(), nuevaOpcion()] }),
    escala: () => ({
      tipo: "escala", requerido: false, etiqueta_es: "", etiqueta_en: "", escala_min: 1, escala_max: 5,
      etiqueta_min_es: "Mínimo", etiqueta_min_en: "Minimum", etiqueta_max_es: "Máximo", etiqueta_max_en: "Maximum",
    }),
  };

  function nuevaOpcion() { return { valor: "", es: "", en: "" }; }
  function nuevaSeccion() { return { icono: "📋", titulo_es: "", titulo_en: "", descripcion_es: "", descripcion_en: "", campos: [] }; }

  function aSlug(texto, maxLen) {
    return (texto || "")
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, maxLen || 40);
  }
  function idUnico(base, existentes) {
    let candidato = base || "elemento";
    let n = 2;
    while (existentes.has(candidato)) { candidato = `${base}_${n}`; n++; }
    return candidato;
  }
  function idsExistentes(lista, excluirObjeto) {
    return new Set(lista.filter((o) => o !== excluirObjeto).map((o) => o.id));
  }
  function todosLosCampos(secciones) { return secciones.flatMap((s) => s.campos); }

  function limpiarEditor() {
    ["editor-slug", "editor-titulo-es", "editor-titulo-en", "editor-descripcion-es", "editor-descripcion-en",
      "editor-correo", "editor-intro-es", "editor-intro-en"].forEach((id) => { el(id).value = ""; });
    el("editor-icono").value = "📋";
    el("editor-activa").checked = true;
    el("editor-error-validacion").hidden = true;
    el("editor-guardar-estado").hidden = true;
    el("iframe-previa").srcdoc = "";
    estado.seccionesEditando = [];
    estado.expandido = new Set();
    estado.idAutoGenerado = new WeakSet();
    estado.valorAutoGenerado = new WeakSet();
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
      // Los id/valor ya existentes son significativos (pueden estar
      // referenciados por respuestas ya recibidas) y nunca se autogeneran
      // solos; solo cambian si alguien los edita a mano en "Avanzado".
      estado.seccionesEditando = datos.secciones || [];
    } else {
      estado.preguntasSha = null;
      const inicial = nuevaSeccion();
      inicial.id = idUnico("seccion", new Set());
      estado.idAutoGenerado.add(inicial);
      estado.seccionesEditando = [inicial];
      estado.expandido.add(inicial);
    }

    renderEditorSecciones();
    el("pantalla-listado").hidden = true;
    el("pantalla-editor").hidden = false;
  }

  function volverAlListado() {
    el("pantalla-editor").hidden = true;
    el("pantalla-listado").hidden = false;
    renderListado();
  }

  // ---------------------------------------------------------------
  // Constructor visual de secciones y preguntas
  // ---------------------------------------------------------------

  function renderEditorSecciones() {
    const contenedor = el("ed-secciones");
    const secciones = estado.seccionesEditando;
    contenedor.innerHTML = secciones.length === 0
      ? '<p class="ed-vacio">Todavía no hay secciones. Empiece con «+ Añadir sección».</p>'
      : secciones.map((s, i) => renderSeccionHTML(s, i, secciones.length)).join("");

    const totalCampos = todosLosCampos(secciones).length;
    el("ed-resumen").textContent = `${secciones.length} sección${secciones.length === 1 ? "" : "es"} · ${totalCampos} pregunta${totalCampos === 1 ? "" : "s"}`;
    programarActualizacionPrevia();
  }

  function renderSeccionHTML(seccion, iSeccion, totalSecciones) {
    const expandida = estado.expandido.has(seccion);
    const numCampos = seccion.campos.length;
    return `
    <div class="ed-seccion" data-seccion-index="${iSeccion}">
      <div class="ed-seccion-cabecera">
        <button type="button" class="ed-toggle" data-accion="alternar-seccion" aria-expanded="${expandida}" aria-label="Expandir o contraer sección">▾</button>
        <input type="text" class="ed-icono-input" data-bind="icono" value="${escaparHtml(seccion.icono || "")}" maxlength="4" title="Icono (un emoji)">
        <input type="text" class="ed-titulo-input" data-bind="titulo_es" placeholder="Título de la sección (ES)" value="${escaparHtml(seccion.titulo_es || "")}">
        <input type="text" class="ed-titulo-input ed-en" data-bind="titulo_en" placeholder="Title (EN)" value="${escaparHtml(seccion.titulo_en || "")}">
        <span class="ed-contador-campos">${numCampos} pregunta${numCampos === 1 ? "" : "s"}</span>
        <div class="ed-acciones-fila">
          <button type="button" class="ed-boton-icono" data-accion="mover-seccion-arriba" ${iSeccion === 0 ? "disabled" : ""} title="Subir sección" aria-label="Subir sección">↑</button>
          <button type="button" class="ed-boton-icono" data-accion="mover-seccion-abajo" ${iSeccion === totalSecciones - 1 ? "disabled" : ""} title="Bajar sección" aria-label="Bajar sección">↓</button>
          <button type="button" class="ed-boton-icono ed-boton-peligro" data-accion="eliminar-seccion" title="Eliminar sección" aria-label="Eliminar sección">🗑</button>
        </div>
      </div>
      ${expandida ? `
      <div class="ed-seccion-cuerpo">
        <div class="ed-fila-doble">
          <textarea data-bind="descripcion_es" placeholder="Descripción breve (ES, opcional)">${escaparHtml(seccion.descripcion_es || "")}</textarea>
          <textarea data-bind="descripcion_en" placeholder="Short description (EN, optional)">${escaparHtml(seccion.descripcion_en || "")}</textarea>
        </div>
        <div class="ed-campos-lista">
          ${seccion.campos.map((c, iC) => renderCampoHTML(c, iC, seccion.campos.length)).join("") || '<p class="ed-vacio">Sin preguntas todavía.</p>'}
        </div>
        <div class="ed-anadir-campo">
          <span>Añadir pregunta:</span>
          ${Object.keys(ETIQUETAS_TIPO).map((tipo) => `<button type="button" class="boton boton-secundario" data-accion="anadir-campo" data-tipo="${tipo}">${ETIQUETAS_TIPO[tipo]}</button>`).join("")}
        </div>
      </div>` : ""}
    </div>`;
  }

  function renderCampoHTML(campo, iCampo, totalCampos) {
    const expandido = estado.expandido.has(campo);
    let cuerpo = "";
    if (expandido) {
      cuerpo += `
        <input type="text" data-bind="etiqueta_en" placeholder="Question (EN)" value="${escaparHtml(campo.etiqueta_en || "")}" style="margin-bottom:0.7rem">
        <div class="ed-fila-doble">
          <input type="text" data-bind="ayuda_es" placeholder="Ayuda o pista (ES, opcional)" value="${escaparHtml(campo.ayuda_es || "")}">
          <input type="text" data-bind="ayuda_en" placeholder="Hint (EN, optional)" value="${escaparHtml(campo.ayuda_en || "")}">
        </div>`;
      if (campo.tipo === "texto") {
        cuerpo += `
        <div class="ed-fila-doble">
          <input type="text" data-bind="placeholder_es" placeholder="Texto de ejemplo dentro del campo (ES, opcional)" value="${escaparHtml(campo.placeholder_es || "")}">
          <input type="text" data-bind="placeholder_en" placeholder="Example text inside the field (EN, optional)" value="${escaparHtml(campo.placeholder_en || "")}">
        </div>`;
      }
      if (campo.tipo === "parrafo") {
        cuerpo += `
        <div class="ed-casillas-fila">
          <label><input type="checkbox" data-bind="grande" ${campo.grande ? "checked" : ""}> Caja de texto grande</label>
          <label><input type="checkbox" data-bind="destacado" ${campo.destacado ? "checked" : ""}> Destacar visualmente</label>
        </div>`;
      }
      if (campo.tipo === "unica" || campo.tipo === "multiple") {
        cuerpo += `<div class="ed-opciones-lista">${(campo.opciones || []).map((op, iOp) => renderOpcionHTML(op, iOp, campo.opciones.length)).join("")}</div>`;
        cuerpo += `<button type="button" class="boton boton-secundario" data-accion="anadir-opcion">+ Añadir opción</button>`;
        cuerpo += `<div class="ed-casillas-fila" style="margin-top:0.7rem"><label><input type="checkbox" data-bind="permite_otro" ${campo.permite_otro ? "checked" : ""}> Permitir opción «Otro» con texto libre</label></div>`;
      }
      if (campo.tipo === "escala") {
        cuerpo += `
        <div class="ed-escala-config">
          <div class="ed-campo-mini">Mínimo<input type="number" data-bind="escala_min" value="${campo.escala_min ?? 1}"></div>
          <div class="ed-campo-mini">Máximo<input type="number" data-bind="escala_max" value="${campo.escala_max ?? 5}"></div>
          <input type="text" data-bind="etiqueta_min_es" placeholder="Etiqueta del mínimo (ES)" value="${escaparHtml(campo.etiqueta_min_es || "")}">
          <input type="text" data-bind="etiqueta_min_en" placeholder="Min label (EN)" value="${escaparHtml(campo.etiqueta_min_en || "")}">
          <input type="text" data-bind="etiqueta_max_es" placeholder="Etiqueta del máximo (ES)" value="${escaparHtml(campo.etiqueta_max_es || "")}">
          <input type="text" data-bind="etiqueta_max_en" placeholder="Max label (EN)" value="${escaparHtml(campo.etiqueta_max_en || "")}">
        </div>`;
      }
      cuerpo += `
        <details class="ed-avanzado">
          <summary>Avanzado</summary>
          <div class="ed-avanzado-cuerpo"><span>ID interno:</span><input type="text" data-bind="id" value="${escaparHtml(campo.id || "")}"></div>
        </details>`;
    }
    return `
    <div class="ed-campo" data-campo-index="${iCampo}">
      <div class="ed-campo-cabecera">
        <button type="button" class="ed-toggle" data-accion="alternar-campo" aria-expanded="${expandido}" aria-label="Expandir o contraer pregunta">▾</button>
        <span class="ed-campo-tipo-badge">${ETIQUETAS_TIPO[campo.tipo] || campo.tipo}</span>
        <input type="text" class="ed-campo-etiqueta-resumen" data-bind="etiqueta_es" placeholder="Pregunta (ES)" value="${escaparHtml(campo.etiqueta_es || "")}">
        <div class="ed-acciones-fila">
          <button type="button" class="ed-boton-icono" data-accion="mover-campo-arriba" ${iCampo === 0 ? "disabled" : ""} title="Subir pregunta" aria-label="Subir pregunta">↑</button>
          <button type="button" class="ed-boton-icono" data-accion="mover-campo-abajo" ${iCampo === totalCampos - 1 ? "disabled" : ""} title="Bajar pregunta" aria-label="Bajar pregunta">↓</button>
          <button type="button" class="ed-boton-icono ed-boton-peligro" data-accion="eliminar-campo" title="Eliminar pregunta" aria-label="Eliminar pregunta">🗑</button>
        </div>
      </div>
      ${expandido ? `<div class="ed-campo-cuerpo">${cuerpo}</div>` : ""}
    </div>`;
  }

  function renderOpcionHTML(opcion, iOpcion, total) {
    return `
    <div class="ed-opcion" data-opcion-index="${iOpcion}">
      <input type="text" data-bind="es" placeholder="Opción (ES)" value="${escaparHtml(opcion.es || "")}">
      <input type="text" class="ed-opcion-en" data-bind="en" placeholder="Option (EN)" value="${escaparHtml(opcion.en || "")}">
      <button type="button" class="ed-boton-icono" data-accion="mover-opcion-arriba" ${iOpcion === 0 ? "disabled" : ""} title="Subir opción" aria-label="Subir opción">↑</button>
      <button type="button" class="ed-boton-icono" data-accion="mover-opcion-abajo" ${iOpcion === total - 1 ? "disabled" : ""} title="Bajar opción" aria-label="Bajar opción">↓</button>
      <button type="button" class="ed-boton-icono ed-boton-peligro" data-accion="eliminar-opcion" title="Eliminar opción" aria-label="Eliminar opción">🗑</button>
    </div>`;
  }

  function indicesDesdeElemento(nodo) {
    const nodoOpcion = nodo.closest(".ed-opcion");
    const nodoCampo = nodo.closest(".ed-campo");
    const nodoSeccion = nodo.closest(".ed-seccion");
    return {
      iSeccion: nodoSeccion ? Number(nodoSeccion.dataset.seccionIndex) : -1,
      iCampo: nodoCampo ? Number(nodoCampo.dataset.campoIndex) : -1,
      iOpcion: nodoOpcion ? Number(nodoOpcion.dataset.opcionIndex) : -1,
    };
  }
  function objetoDesdeIndices(iSeccion, iCampo, iOpcion) {
    const seccion = estado.seccionesEditando[iSeccion];
    if (iCampo < 0) return seccion;
    const campo = seccion.campos[iCampo];
    if (iOpcion < 0) return campo;
    return campo.opciones[iOpcion];
  }

  let temporizadorPrevia = null;
  function programarActualizacionPrevia() {
    if (temporizadorPrevia) clearTimeout(temporizadorPrevia);
    temporizadorPrevia = setTimeout(actualizarPrevia, 400);
  }

  function manejarEntradaEditor(evento) {
    const bind = evento.target.dataset.bind;
    if (!bind) return;
    const { iSeccion, iCampo, iOpcion } = indicesDesdeElemento(evento.target);
    if (iSeccion < 0) return;
    const objetivo = objetoDesdeIndices(iSeccion, iCampo, iOpcion);

    let valor = evento.target.value;
    if (evento.target.type === "checkbox") valor = evento.target.checked;
    else if (evento.target.type === "number") valor = valor === "" ? "" : Number(valor);

    if (bind === "id") { estado.idAutoGenerado.delete(objetivo); objetivo.id = valor; programarActualizacionPrevia(); return; }
    if (bind === "valor") { estado.valorAutoGenerado.delete(objetivo); objetivo.valor = valor; programarActualizacionPrevia(); return; }

    objetivo[bind] = valor;

    if (bind === "titulo_es" && iCampo < 0 && estado.idAutoGenerado.has(objetivo)) {
      objetivo.id = idUnico(aSlug(valor) || "seccion", idsExistentes(estado.seccionesEditando, objetivo));
    }
    if (bind === "etiqueta_es" && iCampo >= 0 && iOpcion < 0 && estado.idAutoGenerado.has(objetivo)) {
      objetivo.id = idUnico(aSlug(valor) || "campo", idsExistentes(todosLosCampos(estado.seccionesEditando), objetivo));
      // El campo "ID interno" vive dentro de <details class="ed-avanzado">
      // del mismo <div class="ed-campo">: no hay un re-render completo tras
      // cada tecleo (perdería el foco), así que hay que reflejar el id
      // recién calculado a mano si ese input ya está en pantalla.
      const nodoCampo = evento.target.closest(".ed-campo");
      const inputId = nodoCampo && nodoCampo.querySelector('[data-bind="id"]');
      if (inputId) inputId.value = objetivo.id;
    }
    if (bind === "es" && iOpcion >= 0 && estado.valorAutoGenerado.has(objetivo)) {
      const campo = objetoDesdeIndices(iSeccion, iCampo, -1);
      objetivo.valor = idUnico(aSlug(valor) || "opcion", new Set(campo.opciones.filter((o) => o !== objetivo).map((o) => o.valor)));
    }
    // Los campos de texto no fuerzan un re-render (perdería el foco/cursor);
    // solo la vista previa se refresca, con un pequeño retraso.
    programarActualizacionPrevia();
  }

  function alternarExpandido(objeto) {
    if (estado.expandido.has(objeto)) estado.expandido.delete(objeto); else estado.expandido.add(objeto);
  }
  function moverElemento(lista, indice, delta) {
    const nuevo = indice + delta;
    if (nuevo < 0 || nuevo >= lista.length) return;
    [lista[indice], lista[nuevo]] = [lista[nuevo], lista[indice]];
  }

  function manejarClicEditor(evento) {
    const boton = evento.target.closest("[data-accion]");
    if (!boton) return;
    const accion = boton.dataset.accion;
    const { iSeccion, iCampo } = indicesDesdeElemento(boton);
    let enfocarUltimoCampoDe = -1;
    let enfocarUltimaOpcionDe = null;

    switch (accion) {
      case "alternar-seccion":
        alternarExpandido(estado.seccionesEditando[iSeccion]);
        break;
      case "mover-seccion-arriba":
        moverElemento(estado.seccionesEditando, iSeccion, -1);
        break;
      case "mover-seccion-abajo":
        moverElemento(estado.seccionesEditando, iSeccion, 1);
        break;
      case "eliminar-seccion": {
        const seccion = estado.seccionesEditando[iSeccion];
        const nombre = seccion.titulo_es || `sección ${iSeccion + 1}`;
        if (!confirm(`¿Eliminar «${nombre}» y sus ${seccion.campos.length} pregunta(s)? No se puede deshacer.`)) return;
        estado.seccionesEditando.splice(iSeccion, 1);
        break;
      }
      case "anadir-campo": {
        const tipo = boton.dataset.tipo;
        const nuevo = PLANTILLA_CAMPO[tipo]();
        nuevo.id = idUnico(tipo, idsExistentes(todosLosCampos(estado.seccionesEditando), null));
        estado.idAutoGenerado.add(nuevo);
        if (nuevo.opciones) nuevo.opciones.forEach((o) => estado.valorAutoGenerado.add(o));
        estado.seccionesEditando[iSeccion].campos.push(nuevo);
        estado.expandido.add(nuevo);
        enfocarUltimoCampoDe = iSeccion;
        break;
      }
      case "alternar-campo":
        alternarExpandido(estado.seccionesEditando[iSeccion].campos[iCampo]);
        break;
      case "mover-campo-arriba":
        moverElemento(estado.seccionesEditando[iSeccion].campos, iCampo, -1);
        break;
      case "mover-campo-abajo":
        moverElemento(estado.seccionesEditando[iSeccion].campos, iCampo, 1);
        break;
      case "eliminar-campo": {
        const campos = estado.seccionesEditando[iSeccion].campos;
        const campo = campos[iCampo];
        if (!confirm(`¿Eliminar la pregunta «${campo.etiqueta_es || "sin título"}»? No se puede deshacer.`)) return;
        campos.splice(iCampo, 1);
        break;
      }
      case "anadir-opcion": {
        const nueva = nuevaOpcion();
        estado.valorAutoGenerado.add(nueva);
        estado.seccionesEditando[iSeccion].campos[iCampo].opciones.push(nueva);
        enfocarUltimaOpcionDe = { iSeccion, iCampo };
        break;
      }
      case "mover-opcion-arriba":
        moverElemento(estado.seccionesEditando[iSeccion].campos[iCampo].opciones, indicesDesdeElemento(boton).iOpcion, -1);
        break;
      case "mover-opcion-abajo":
        moverElemento(estado.seccionesEditando[iSeccion].campos[iCampo].opciones, indicesDesdeElemento(boton).iOpcion, 1);
        break;
      case "eliminar-opcion": {
        const opciones = estado.seccionesEditando[iSeccion].campos[iCampo].opciones;
        if (opciones.length <= 1) { alert("Debe quedar al menos una opción."); return; }
        opciones.splice(indicesDesdeElemento(boton).iOpcion, 1);
        break;
      }
      default:
        return;
    }

    renderEditorSecciones();

    if (enfocarUltimoCampoDe >= 0) {
      requestAnimationFrame(() => {
        const nodosSeccion = document.querySelectorAll(".ed-seccion");
        const nodoSeccion = nodosSeccion[enfocarUltimoCampoDe];
        const nodosCampo = nodoSeccion && nodoSeccion.querySelectorAll(".ed-campo");
        const ultimo = nodosCampo && nodosCampo[nodosCampo.length - 1];
        const entrada = ultimo && ultimo.querySelector('[data-bind="etiqueta_es"]');
        if (entrada) entrada.focus();
      });
    }
    if (enfocarUltimaOpcionDe) {
      requestAnimationFrame(() => {
        const nodosSeccion = document.querySelectorAll(".ed-seccion");
        const nodoCampo = nodosSeccion[enfocarUltimaOpcionDe.iSeccion].querySelectorAll(".ed-campo")[enfocarUltimaOpcionDe.iCampo];
        const nodosOpcion = nodoCampo.querySelectorAll(".ed-opcion");
        const entrada = nodosOpcion[nodosOpcion.length - 1].querySelector('[data-bind="es"]');
        if (entrada) entrada.focus();
      });
    }
  }

  function anadirSeccion() {
    const nueva = nuevaSeccion();
    nueva.id = idUnico("seccion", idsExistentes(estado.seccionesEditando, null));
    estado.idAutoGenerado.add(nueva);
    estado.seccionesEditando.push(nueva);
    estado.expandido.add(nueva);
    renderEditorSecciones();
    requestAnimationFrame(() => {
      const nodos = document.querySelectorAll(".ed-seccion");
      const entrada = nodos[nodos.length - 1] && nodos[nodos.length - 1].querySelector('[data-bind="titulo_es"]');
      if (entrada) entrada.focus();
    });
  }

  function validarSecciones(secciones) {
    if (!Array.isArray(secciones) || secciones.length === 0) return "Añada al menos una sección con «+ Añadir sección».";
    const idsSeccion = new Set();
    const idsCampo = new Set();
    for (let i = 0; i < secciones.length; i++) {
      const seccion = secciones[i];
      const nombreSeccion = seccion.titulo_es || `Sección ${i + 1}`;
      if (!seccion.titulo_es || !seccion.titulo_en) return `«${nombreSeccion}»: falta el título en español o en inglés.`;
      if (!seccion.id) return `«${nombreSeccion}»: falta el ID interno (ábralo en «Avanzado» — no debería pasar).`;
      if (idsSeccion.has(seccion.id)) return `Dos secciones comparten el mismo ID interno («${seccion.id}»). Cambie uno en «Avanzado».`;
      idsSeccion.add(seccion.id);
      if (seccion.campos.length === 0) return `«${nombreSeccion}» todavía no tiene ninguna pregunta.`;
      for (let j = 0; j < seccion.campos.length; j++) {
        const campo = seccion.campos[j];
        const nombreCampo = campo.etiqueta_es || `pregunta ${j + 1} de «${nombreSeccion}»`;
        if (!campo.etiqueta_es || !campo.etiqueta_en) return `«${nombreCampo}»: falta el texto de la pregunta en español o en inglés.`;
        if (!campo.id) return `«${nombreCampo}»: falta el ID interno.`;
        if (idsCampo.has(campo.id)) return `Dos preguntas comparten el mismo ID interno («${campo.id}»). Cambie uno en «Avanzado».`;
        idsCampo.add(campo.id);
        if (campo.tipo === "unica" || campo.tipo === "multiple") {
          if (!campo.opciones || campo.opciones.length === 0) return `«${nombreCampo}» necesita al menos una opción.`;
          const valoresOpcion = new Set();
          for (const op of campo.opciones) {
            if (!op.es || !op.en) return `Una opción de «${nombreCampo}» no tiene texto en español o en inglés.`;
            if (!op.valor) return `Una opción de «${nombreCampo}» no tiene ID interno.`;
            if (valoresOpcion.has(op.valor)) return `Dos opciones de «${nombreCampo}» comparten el mismo ID interno («${op.valor}»).`;
            valoresOpcion.add(op.valor);
          }
        }
        if (campo.tipo === "escala") {
          if (typeof campo.escala_min !== "number" || typeof campo.escala_max !== "number" || campo.escala_min >= campo.escala_max) {
            return `«${nombreCampo}»: el mínimo de la escala debe ser un número menor que el máximo.`;
          }
        }
      }
    }
    return null;
  }

  function construirDatosEncuesta() {
    const slug = el("editor-slug").value.trim();
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
      secciones: estado.seccionesEditando,
    };
    return { slug, datos };
  }

  function validarAntesDeGuardar() {
    const slug = el("editor-slug").value.trim();
    if (!/^[a-z0-9-]+$/.test(slug)) return "El identificador (slug) solo puede tener minúsculas, números y guiones.";
    if (!el("editor-titulo-es").value.trim() || !el("editor-titulo-en").value.trim()) return "Falta el título de la encuesta, en español o en inglés (arriba, en «Datos generales»).";
    return validarSecciones(estado.seccionesEditando);
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

  async function actualizarPrevia() {
    // La vista previa es siempre indulgente: mientras se escribe puede
    // haber títulos vacíos o secciones a medio completar, y aun así debe
    // mostrar algo razonable. La validación estricta solo ocurre al
    // guardar (validarAntesDeGuardar), nunca aquí.
    const { slug, datos } = construirDatosEncuesta();
    const motor = await cargarMotorParaPrevia();
    const srcdoc = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>${motor.css}</style></head><body>${cuerpoHtmlEncuesta()}
<script>window.CONFIG_ENCUESTA = { slug: ${jsonParaScript(slug)}, datosInline: ${jsonParaScript(datos)}, correoDestino: ${jsonParaScript(datos.correo_destino || "")} };<\/script>
<script>${motor.i18n}<\/script>
<script>${motor.app}<\/script>
</body></html>`;
    el("iframe-previa").srcdoc = srcdoc;
  }

  async function guardarEncuesta() {
    const boton = el("boton-guardar-encuesta");
    const estadoTexto = el("editor-guardar-estado");
    const errorNodo = el("editor-error-validacion");
    errorNodo.hidden = true;

    const mensajeError = validarAntesDeGuardar();
    if (mensajeError) {
      errorNodo.hidden = false;
      errorNodo.textContent = mensajeError;
      errorNodo.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    boton.disabled = true;
    estadoTexto.hidden = false;
    estadoTexto.className = "admin-mensaje";
    estadoTexto.textContent = "Guardando…";
    try {
      const { slug, datos } = construirDatosEncuesta();
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
    el("boton-guardar-encuesta").addEventListener("click", guardarEncuesta);
    el("boton-eliminar-encuesta").addEventListener("click", eliminarEncuesta);

    el("ed-anadir-seccion").addEventListener("click", anadirSeccion);
    el("ed-secciones").addEventListener("click", manejarClicEditor);
    el("ed-secciones").addEventListener("input", manejarEntradaEditor);
    el("ed-secciones").addEventListener("change", manejarEntradaEditor);
  }

  document.addEventListener("DOMContentLoaded", () => {
    conectarEventos();
    if (estado.token) conectar(estado.token);
  });
})();
