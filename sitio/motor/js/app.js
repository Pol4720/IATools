/**
 * Motor compartido de encuestas de la plataforma IATools.
 * Renderiza dinámicamente a partir del preguntas.json de la encuesta
 * indicada en window.CONFIG_ENCUESTA, guarda un borrador en localStorage
 * y, al enviar, descarga un archivo con las respuestas y abre el
 * programa de correo del respondiente ya dirigido y con el asunto
 * completado (vía principal: no requiere cuenta de ningún tipo). Como
 * alternativa para quien sí tenga cuenta de GitHub, también puede abrir
 * un "issue" pre-rellenado que un flujo de trabajo del repositorio
 * convierte automáticamente en un archivo versionado dentro de
 * /respuestas/<encuesta>.
 */
(function () {
  "use strict";

  const CONFIG = window.CONFIG_ENCUESTA || {};
  const SLUG = CONFIG.slug || "encuesta";
  const RUTA_DATOS = CONFIG.datos || "./preguntas.json";
  const RUTA_PDF_BASE = CONFIG.pdfBase || "./pdf/formulario";
  const REPO_OWNER = CONFIG.repoOwner || "Pol4720";
  const REPO_NAME = CONFIG.repoName || "IATools";
  const ISSUE_LABEL = `respuesta:${SLUG}`;
  const CLAVE_RESPUESTAS = `iatools-encuestas:${SLUG}:respuestas`;
  const CLAVE_IDIOMA = `iatools-encuestas:${SLUG}:idioma`;
  const VALOR_OTRO = "__otro__";

  const estado = {
    datos: null,
    idioma: localStorage.getItem(CLAVE_IDIOMA) || "es",
    respuestas: {},
    guardadoEn: null,
    pasoActual: -1, // -1 = intro, 0..N-1 = secciones, N = revisión
  };

  const el = (id) => document.getElementById(id);
  const anunciar = (texto) => { el("region-anuncios").textContent = texto; };
  const t = (clave, ...args) => {
    const valor = UI_STRINGS[estado.idioma][clave];
    return typeof valor === "function" ? valor(...args) : valor;
  };

  function totalSecciones() { return estado.datos.secciones.length; }
  function totalPasos() { return totalSecciones() + 1; } // + revisión

  // ---------------------------------------------------------------
  // Carga inicial
  // ---------------------------------------------------------------

  async function iniciar() {
    if (CONFIG.datosInline) {
      // Modo vista previa (usado por el panel de administración): los
      // datos ya vienen en memoria, sin necesidad de red ni borrador.
      estado.datos = CONFIG.datosInline;
      document.documentElement.lang = estado.idioma;
      actualizarBotonIdioma();
      renderTextosEstaticos();
      renderIntro();
      construirPasos();
      actualizarProgreso();
      conectarEventos();
      return;
    }
    const resp = await fetch(RUTA_DATOS, { cache: "no-store" });
    estado.datos = await resp.json();

    cargarBorrador();
    document.documentElement.lang = estado.idioma;
    actualizarBotonIdioma();
    renderTextosEstaticos();
    renderIntro();
    construirPasos();
    actualizarProgreso();
    conectarEventos();
  }

  function cargarBorrador() {
    try {
      const crudo = localStorage.getItem(CLAVE_RESPUESTAS);
      if (!crudo) return;
      const guardado = JSON.parse(crudo);
      estado.respuestas = guardado.respuestas || {};
      estado.guardadoEn = guardado.fecha || null;
    } catch (err) {
      console.warn("No se pudo leer el borrador guardado:", err);
    }
  }

  function guardarBorrador() {
    estado.guardadoEn = new Date().toISOString();
    localStorage.setItem(CLAVE_RESPUESTAS, JSON.stringify({
      respuestas: estado.respuestas,
      fecha: estado.guardadoEn,
    }));
  }

  // ---------------------------------------------------------------
  // Textos estáticos (data-i18n) y meta del formulario
  // ---------------------------------------------------------------

  function renderTextosEstaticos() {
    document.querySelectorAll("[data-i18n]").forEach((nodo) => {
      const clave = nodo.getAttribute("data-i18n");
      if (clave.startsWith("meta.")) {
        const campo = clave.split(".")[1];
        const mapaMeta = { titulo: "titulo", subtitulo: "subtitulo", tiempoEstimado: "tiempo_estimado" };
        const propiedad = `${mapaMeta[campo]}_${estado.idioma}`;
        if (estado.datos.meta[propiedad] !== undefined) nodo.textContent = estado.datos.meta[propiedad];
      } else if (clave.startsWith("ui.")) {
        const texto = t(clave.split(".")[1]);
        if (typeof texto === "string") nodo.textContent = texto;
      }
    });
    document.title = `${estado.datos.meta[`titulo_${estado.idioma}`]} | Instituto Finlay de Vacunas`;
    el("envio-instrucciones").innerHTML = "";
    ["envioPaso1", "envioPaso2", "envioPaso3"].forEach((clave) => {
      const li = document.createElement("li");
      li.textContent = t(clave);
      el("envio-instrucciones").appendChild(li);
    });
  }

  function actualizarBotonIdioma() {
    el("boton-idioma-texto").textContent = estado.idioma === "es" ? "EN" : "ES";
    el("boton-idioma").setAttribute("aria-label", estado.idioma === "es" ? "Switch to English" : "Cambiar a español");
    el("enlace-version-pdf").setAttribute("href", `${RUTA_PDF_BASE}-${estado.idioma}.pdf`);
  }

  // ---------------------------------------------------------------
  // Pantalla de introducción
  // ---------------------------------------------------------------

  function renderIntro() {
    const contenedor = el("intro-parrafos");
    contenedor.innerHTML = "";
    estado.datos.meta[`introduccion_${estado.idioma}`].forEach((parrafo) => {
      const p = document.createElement("p");
      p.textContent = parrafo;
      contenedor.appendChild(p);
    });

    const avisoBorrador = el("aviso-borrador");
    const hayRespuestas = Object.keys(estado.respuestas).length > 0;
    avisoBorrador.hidden = !hayRespuestas;
    if (hayRespuestas && estado.guardadoEn) {
      const fecha = new Date(estado.guardadoEn).toLocaleString(estado.idioma === "es" ? "es-ES" : "en-US");
      el("aviso-borrador-texto").textContent = t("borradorEncontrado", fecha);
    }

    const mapa = el("mapa-secciones");
    mapa.innerHTML = "";
    const titulo = document.createElement("p");
    titulo.className = "campo-etiqueta";
    titulo.textContent = t("mapaSeccionesTitulo");
    mapa.appendChild(titulo);
    const grilla = document.createElement("div");
    grilla.style.display = "grid";
    grilla.style.gridTemplateColumns = "repeat(auto-fill, minmax(150px, 1fr))";
    grilla.style.gap = "0.6rem";
    grilla.style.width = "100%";
    estado.datos.secciones.forEach((seccion, indice) => {
      const boton = document.createElement("button");
      boton.type = "button";
      boton.innerHTML = `<span class="mapa-icono" aria-hidden="true">${seccion.icono}</span><span>${seccion[`titulo_${estado.idioma}`]}</span>`;
      boton.addEventListener("click", () => {
        mostrarFormulario();
        irAPaso(indice);
      });
      grilla.appendChild(boton);
    });
    mapa.appendChild(grilla);
  }

  function mostrarFormulario() {
    el("pantalla-intro").hidden = true;
    el("formulario").hidden = false;
    el("pantalla-envio").hidden = true;
  }

  // ---------------------------------------------------------------
  // Construcción de los pasos (secciones) del formulario
  // ---------------------------------------------------------------

  function construirPasos() {
    const contenedor = el("pasos-secciones");
    contenedor.innerHTML = "";
    estado.datos.secciones.forEach((seccion, indice) => {
      const paso = document.createElement("section");
      paso.className = "tarjeta paso";
      paso.dataset.pasoIndex = String(indice);
      paso.hidden = true;

      const encabezado = document.createElement("div");
      encabezado.className = "paso-encabezado";
      encabezado.innerHTML = `<span class="paso-icono" aria-hidden="true">${seccion.icono}</span><h2>${seccion[`titulo_${estado.idioma}`]}</h2>`;
      paso.appendChild(encabezado);

      const descripcion = document.createElement("p");
      descripcion.className = "paso-descripcion";
      descripcion.textContent = seccion[`descripcion_${estado.idioma}`];
      paso.appendChild(descripcion);

      seccion.campos.forEach((campo) => paso.appendChild(renderCampo(campo)));

      contenedor.appendChild(paso);
    });
  }

  function crearFilaEtiqueta(campo) {
    const fila = document.createElement("div");
    fila.className = "campo-etiqueta-fila";

    const etiqueta = document.createElement(campo.tipo === "unica" || campo.tipo === "multiple" || campo.tipo === "escala" ? "span" : "label");
    etiqueta.className = "campo-etiqueta";
    etiqueta.textContent = campo[`etiqueta_${estado.idioma}`];
    if (etiqueta.tagName === "LABEL") etiqueta.setAttribute("for", campo.id);
    fila.appendChild(etiqueta);

    const ayudaTexto = campo[`ayuda_${estado.idioma}`];
    if (ayudaTexto) {
      const idAyuda = `${campo.id}__ayuda`;
      const botonAyuda = document.createElement("button");
      botonAyuda.type = "button";
      botonAyuda.className = "boton-ayuda";
      botonAyuda.setAttribute("aria-expanded", "false");
      botonAyuda.setAttribute("aria-controls", idAyuda);
      botonAyuda.setAttribute("aria-label", estado.idioma === "es" ? "Mostrar ayuda" : "Show hint");
      botonAyuda.textContent = "i";
      botonAyuda.addEventListener("click", () => {
        const expandido = botonAyuda.getAttribute("aria-expanded") === "true";
        botonAyuda.setAttribute("aria-expanded", String(!expandido));
        el(idAyuda).hidden = expandido;
      });
      fila.appendChild(botonAyuda);
    }
    return fila;
  }

  function crearBloqueAyuda(campo) {
    const ayudaTexto = campo[`ayuda_${estado.idioma}`];
    if (!ayudaTexto) return null;
    const p = document.createElement("p");
    p.id = `${campo.id}__ayuda`;
    p.className = "campo-ayuda";
    p.hidden = true;
    p.textContent = ayudaTexto;
    return p;
  }

  function renderCampo(campo) {
    const contenedor = document.createElement("div");
    contenedor.className = "campo" + (campo.destacado ? " campo-destacado" : "");
    contenedor.dataset.campoId = campo.id;

    contenedor.appendChild(crearFilaEtiqueta(campo));
    const ayuda = crearBloqueAyuda(campo);
    if (ayuda) contenedor.appendChild(ayuda);

    switch (campo.tipo) {
      case "texto": {
        const input = document.createElement("input");
        input.type = "text";
        input.id = campo.id;
        input.name = campo.id;
        if (campo.placeholder_es) input.placeholder = campo[`placeholder_${estado.idioma}`] || campo.placeholder_es;
        input.value = estado.respuestas[campo.id] || "";
        contenedor.appendChild(input);
        break;
      }
      case "parrafo": {
        const textarea = document.createElement("textarea");
        textarea.id = campo.id;
        textarea.name = campo.id;
        textarea.rows = campo.grande ? 6 : 3;
        if (campo.grande) textarea.classList.add("parrafo-grande");
        textarea.value = estado.respuestas[campo.id] || "";
        contenedor.appendChild(textarea);
        break;
      }
      case "unica":
        contenedor.appendChild(renderOpciones(campo, "radio"));
        break;
      case "multiple":
        contenedor.appendChild(renderOpciones(campo, "checkbox"));
        break;
      case "escala":
        contenedor.appendChild(renderEscala(campo));
        break;
      default:
        console.warn("Tipo de campo desconocido:", campo.tipo);
    }
    return contenedor;
  }

  function renderOpciones(campo, tipoInput) {
    const fieldset = document.createElement("fieldset");
    const lista = document.createElement("div");
    lista.className = "opciones-lista";

    const opciones = campo.opciones.slice();
    if (campo.permite_otro) {
      opciones.push({ valor: VALOR_OTRO, es: "Otro (especifique)", en: "Other (please specify)" });
    }

    const valoresGuardados = estado.respuestas[campo.id];
    const seleccionados = tipoInput === "checkbox"
      ? (Array.isArray(valoresGuardados) ? valoresGuardados : [])
      : [valoresGuardados];

    opciones.forEach((opcion) => {
      const etiquetaOpcion = document.createElement("label");
      etiquetaOpcion.className = "opcion";

      const input = document.createElement("input");
      input.type = tipoInput;
      input.name = tipoInput === "checkbox" ? `${campo.id}[]` : campo.id;
      input.id = `${campo.id}__${opcion.valor}`;
      input.value = opcion.valor;
      input.checked = seleccionados.includes(opcion.valor);

      const texto = document.createElement("span");
      texto.textContent = opcion[estado.idioma] || opcion.es;

      etiquetaOpcion.appendChild(input);
      etiquetaOpcion.appendChild(texto);
      lista.appendChild(etiquetaOpcion);

      if (opcion.ayuda_es) {
        const ayudaOpcion = document.createElement("small");
        ayudaOpcion.style.display = "block";
        ayudaOpcion.style.color = "var(--color-texto-suave)";
        ayudaOpcion.style.marginTop = "0.15rem";
        ayudaOpcion.textContent = opcion[`ayuda_${estado.idioma}`] || opcion.ayuda_es;
        etiquetaOpcion.appendChild(ayudaOpcion);
      }

      if (opcion.valor === VALOR_OTRO) {
        const textoOtro = document.createElement("input");
        textoOtro.type = "text";
        textoOtro.className = "opcion-otro-texto";
        textoOtro.id = `${campo.id}__otro_texto`;
        textoOtro.name = `${campo.id}__otro_texto`;
        textoOtro.placeholder = estado.idioma === "es" ? "Escriba aquí…" : "Type here…";
        textoOtro.value = estado.respuestas[`${campo.id}__otro_texto`] || "";
        textoOtro.setAttribute("aria-label", t("otroEspecifique"));
        lista.appendChild(textoOtro);
      }
    });

    fieldset.appendChild(lista);
    return fieldset;
  }

  function renderEscala(campo) {
    const fieldset = document.createElement("fieldset");
    const fila = document.createElement("div");
    fila.className = "escala-fila";
    const guardado = estado.respuestas[campo.id];

    for (let n = campo.escala_min; n <= campo.escala_max; n++) {
      const etiquetaOpcion = document.createElement("label");
      etiquetaOpcion.className = "escala-opcion";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = campo.id;
      input.id = `${campo.id}__${n}`;
      input.value = String(n);
      input.checked = String(guardado) === String(n);
      const numero = document.createElement("span");
      numero.textContent = String(n);
      etiquetaOpcion.appendChild(input);
      etiquetaOpcion.appendChild(numero);
      fila.appendChild(etiquetaOpcion);
    }
    fieldset.appendChild(fila);

    const extremos = document.createElement("div");
    extremos.className = "escala-extremos";
    extremos.innerHTML = `<span>${campo[`escala_min`]} · ${campo[`etiqueta_min_${estado.idioma}`]}</span><span>${campo[`escala_max`]} · ${campo[`etiqueta_max_${estado.idioma}`]}</span>`;
    fieldset.appendChild(extremos);
    return fieldset;
  }

  // ---------------------------------------------------------------
  // Autoguardado
  // ---------------------------------------------------------------

  function manejarCambio(evento) {
    const objetivo = evento.target;
    if (!objetivo.name) return;

    if (objetivo.type === "checkbox") {
      const idCampo = objetivo.name.replace(/\[\]$/, "");
      const marcados = Array.from(
        document.querySelectorAll(`input[name="${CSS.escape(objetivo.name)}"]:checked`)
      ).map((n) => n.value);
      estado.respuestas[idCampo] = marcados;
    } else if (objetivo.name.endsWith("__otro_texto")) {
      estado.respuestas[objetivo.name] = objetivo.value;
    } else {
      estado.respuestas[objetivo.name] = objetivo.value;
    }
    guardarBorrador();
    actualizarProgreso();
  }

  function contarCampos() {
    return estado.datos.secciones.reduce((total, s) => total + s.campos.length, 0);
  }

  function contarRespondidos() {
    let n = 0;
    estado.datos.secciones.forEach((seccion) => {
      seccion.campos.forEach((campo) => {
        const valor = estado.respuestas[campo.id];
        if (Array.isArray(valor) ? valor.length > 0 : !!(valor && String(valor).trim())) n++;
      });
    });
    return n;
  }

  function actualizarProgreso() {
    const total = contarCampos();
    const respondidos = contarRespondidos();
    const pct = total === 0 ? 0 : Math.round((respondidos / total) * 100);
    el("barra-progreso-relleno").style.width = `${pct}%`;
    el("barra-progreso").setAttribute("aria-valuenow", String(pct));
    el("progreso-texto").textContent = t("progresoCompletado", pct);
  }

  // ---------------------------------------------------------------
  // Navegación entre pasos
  // ---------------------------------------------------------------

  function irAPaso(indice) {
    estado.pasoActual = indice;
    const esRevision = indice === totalSecciones();

    document.querySelectorAll("#pasos-secciones > .paso").forEach((nodo) => {
      nodo.hidden = Number(nodo.dataset.pasoIndex) !== indice || esRevision;
    });
    el("paso-revision").hidden = !esRevision;
    if (esRevision) construirResumen();

    el("boton-anterior").disabled = indice === 0;
    el("boton-siguiente").textContent = esRevision ? t("continuarEnvio") : t("siguiente");

    const tituloPaso = esRevision
      ? t("revisionSeccionDe")
      : estado.datos.secciones[indice][`titulo_${estado.idioma}`];
    anunciar(t("anuncioSeccion", tituloPaso));

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function avanzar() {
    if (estado.pasoActual === totalSecciones()) {
      mostrarPantallaEnvio();
      return;
    }
    if (estado.pasoActual < totalSecciones()) irAPaso(estado.pasoActual + 1);
  }

  function retroceder() {
    if (estado.pasoActual > 0) irAPaso(estado.pasoActual - 1);
  }

  function mostrarPantallaEnvio() {
    el("pasos-secciones").hidden = true;
    el("paso-revision").hidden = true;
    document.querySelector(".navegacion-pasos").hidden = true;
    el("pantalla-envio").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------------------------------------------------------------
  // Resumen / revisión
  // ---------------------------------------------------------------

  function textoDeValor(campo, valor) {
    if (valor === undefined || valor === null) return null;
    if (campo.tipo === "unica" || campo.tipo === "multiple") {
      const lista = Array.isArray(valor) ? valor : [valor];
      if (lista.length === 0) return null;
      const opciones = campo.opciones.slice();
      if (campo.permite_otro) opciones.push({ valor: VALOR_OTRO, es: "Otro", en: "Other" });
      const textos = lista.map((v) => {
        if (v === VALOR_OTRO) {
          const libre = estado.respuestas[`${campo.id}__otro_texto`];
          return libre ? `${t("otroEspecifique")}: ${libre}` : t("otroEspecifique");
        }
        const opcion = opciones.find((o) => o.valor === v);
        return opcion ? (opcion[estado.idioma] || opcion.es) : v;
      });
      return textos.join(", ");
    }
    if (campo.tipo === "escala") {
      return valor ? `${valor} / ${campo.escala_max}` : null;
    }
    const texto = String(valor).trim();
    return texto ? texto : null;
  }

  function construirResumen() {
    const contenedor = el("resumen-revision");
    contenedor.innerHTML = "";
    estado.datos.secciones.forEach((seccion, indice) => {
      const bloque = document.createElement("div");
      bloque.className = "resumen-seccion";

      const encabezado = document.createElement("div");
      encabezado.className = "resumen-seccion-encabezado";
      const h3 = document.createElement("h3");
      h3.textContent = `${seccion.icono} ${seccion[`titulo_${estado.idioma}`]}`;
      const botonEditar = document.createElement("button");
      botonEditar.type = "button";
      botonEditar.className = "boton boton-texto";
      botonEditar.textContent = t("editarSeccion");
      botonEditar.addEventListener("click", () => irAPaso(indice));
      encabezado.appendChild(h3);
      encabezado.appendChild(botonEditar);
      bloque.appendChild(encabezado);

      const dl = document.createElement("dl");
      seccion.campos.forEach((campo) => {
        const texto = textoDeValor(campo, estado.respuestas[campo.id]);
        const item = document.createElement("div");
        item.className = "resumen-campo";
        const dt = document.createElement("dt");
        dt.textContent = campo[`etiqueta_${estado.idioma}`];
        const dd = document.createElement("dd");
        if (texto) {
          dd.textContent = texto;
        } else {
          dd.textContent = t("sinResponder");
          dd.className = "resumen-vacio";
        }
        item.appendChild(dt);
        item.appendChild(dd);
        dl.appendChild(item);
      });
      bloque.appendChild(dl);
      contenedor.appendChild(bloque);
    });
  }

  // ---------------------------------------------------------------
  // Generación del texto final y envío
  // ---------------------------------------------------------------

  function construirMarkdown() {
    const nombre = estado.respuestas.nombre && estado.respuestas.nombre.trim();
    const lineas = [];
    lineas.push(`# ${estado.datos.meta[`titulo_${estado.idioma}`]}`);
    lineas.push("");
    lineas.push(`- **${estado.idioma === "es" ? "Respondiente" : "Respondent"}:** ${nombre || (estado.idioma === "es" ? "Anónimo" : "Anonymous")}`);
    lineas.push(`- **${estado.idioma === "es" ? "Fecha" : "Date"}:** ${new Date().toISOString().slice(0, 10)}`);
    lineas.push(`- **${estado.idioma === "es" ? "Idioma de respuesta" : "Response language"}:** ${estado.idioma}`);
    lineas.push("");

    estado.datos.secciones.forEach((seccion) => {
      lineas.push(`## ${seccion.icono} ${seccion[`titulo_${estado.idioma}`]}`);
      lineas.push("");
      seccion.campos.forEach((campo) => {
        const texto = textoDeValor(campo, estado.respuestas[campo.id]);
        lineas.push(`**${campo[`etiqueta_${estado.idioma}`]}**`);
        lineas.push(texto || `_${t("sinResponder")}_`);
        lineas.push("");
      });
    });

    lineas.push("<details>");
    lineas.push(`<summary>${estado.idioma === "es" ? "Datos estructurados (uso interno)" : "Structured data (internal use)"}</summary>`);
    lineas.push("");
    lineas.push("```json");
    lineas.push(JSON.stringify({ idioma: estado.idioma, fecha: new Date().toISOString(), respuestas: estado.respuestas }, null, 2));
    lineas.push("```");
    lineas.push("</details>");

    return lineas.join("\n");
  }

  function descargarArchivo(nombreArchivo, contenido, tipoMime) {
    const blob = new Blob([contenido], { type: tipoMime });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = nombreArchivo;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    URL.revokeObjectURL(url);
    anunciar(t("anuncioDescarga"));
  }

  // Vía principal de envío: no requiere ninguna cuenta. El cuerpo completo
  // de un mailto: se trunca en muchos clientes bastante antes de lo que
  // ocuparía una respuesta detallada (y no es posible adjuntar un archivo
  // por JavaScript), así que el mensaje solo lleva instrucciones breves y
  // el archivo con las respuestas se descarga aparte, para adjuntarlo a mano.
  function enviarPorCorreo() {
    const markdown = construirMarkdown();
    const nombre = (estado.respuestas.nombre && estado.respuestas.nombre.trim()) || (estado.idioma === "es" ? "Anónimo" : "Anonymous");
    const fecha = new Date().toISOString().slice(0, 10);
    const nombreArchivo = `respuestas-${SLUG}-${fecha}.md`;
    descargarArchivo(nombreArchivo, markdown, "text/markdown;charset=utf-8");

    const destino = CONFIG.correoDestino || "";
    const asunto = `${t("correoAsuntoPrefijo")}: ${nombre} — ${fecha}`;
    const parametros = new URLSearchParams({ subject: asunto, body: t("correoCuerpo", nombreArchivo) });
    const mailto = `mailto:${destino}?${parametros.toString()}`;

    // Pequeña espera para que el navegador dispare primero la descarga.
    window.setTimeout(() => { window.location.href = mailto; }, 300);

    anunciar(t("anuncioEnvioCorreo"));
    const resultado = el("envio-resultado");
    resultado.hidden = false;
    resultado.innerHTML = t("envioResultadoCorreo", nombreArchivo, destino);
  }

  // Margen prudente por debajo de los límites prácticos de longitud de URL
  // de navegadores/servidores, para que el cuerpo del issue nunca quede
  // truncado a mitad de una respuesta.
  const LIMITE_SEGURO_URL = 6500;

  async function enviarPorGitHub() {
    const markdown = construirMarkdown();
    const nombre = (estado.respuestas.nombre && estado.respuestas.nombre.trim()) || (estado.idioma === "es" ? "Anónimo" : "Anonymous");
    const titulo = `Respuesta: ${nombre} — ${new Date().toISOString().slice(0, 10)}`;
    const cuerpoCodificado = encodeURIComponent(markdown);
    const cabePrefill = cuerpoCodificado.length < LIMITE_SEGURO_URL;

    let copiadoAlPortapapeles = false;
    if (!cabePrefill && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(markdown);
        copiadoAlPortapapeles = true;
      } catch (err) {
        copiadoAlPortapapeles = false;
      }
    }

    const parametrosBase = { title: titulo, labels: ISSUE_LABEL };
    const parametros = new URLSearchParams(cabePrefill ? { ...parametrosBase, body: markdown } : parametrosBase);
    const url = `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/new?${parametros.toString()}`;
    window.open(url, "_blank", "noopener");
    anunciar(t("anuncioEnvio"));

    const resultado = el("envio-resultado");
    resultado.hidden = false;
    resultado.textContent = cabePrefill
      ? t("envioResultadoCorto")
      : (copiadoAlPortapapeles ? t("envioResultadoLargoConCopia") : t("envioResultadoLargoSinCopia"));
  }

  // ---------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------

  function conectarEventos() {
    el("boton-comenzar").addEventListener("click", () => {
      mostrarFormulario();
      irAPaso(0);
    });

    el("boton-descartar-borrador").addEventListener("click", () => {
      if (!confirm(t("confirmarDescarte"))) return;
      estado.respuestas = {};
      estado.guardadoEn = null;
      localStorage.removeItem(CLAVE_RESPUESTAS);
      renderIntro();
      construirPasos();
      actualizarProgreso();
    });

    el("formulario").addEventListener("input", manejarCambio);
    el("formulario").addEventListener("change", manejarCambio);

    el("boton-siguiente").addEventListener("click", avanzar);
    el("boton-anterior").addEventListener("click", retroceder);

    el("boton-enviar-correo").addEventListener("click", enviarPorCorreo);
    el("boton-enviar-github").addEventListener("click", enviarPorGitHub);
    el("boton-descargar-md").addEventListener("click", () => {
      descargarArchivo(`respuestas-${SLUG}.md`, construirMarkdown(), "text/markdown;charset=utf-8");
    });
    el("boton-descargar-json").addEventListener("click", () => {
      const datos = JSON.stringify({ idioma: estado.idioma, fecha: new Date().toISOString(), respuestas: estado.respuestas }, null, 2);
      descargarArchivo(`respuestas-${SLUG}.json`, datos, "application/json;charset=utf-8");
    });

    el("boton-idioma").addEventListener("click", () => {
      estado.idioma = estado.idioma === "es" ? "en" : "es";
      localStorage.setItem(CLAVE_IDIOMA, estado.idioma);
      document.documentElement.lang = estado.idioma;
      actualizarBotonIdioma();
      renderTextosEstaticos();
      renderIntro();
      construirPasos();
      actualizarProgreso();
      if (estado.pasoActual >= 0 && !el("formulario").hidden) {
        if (estado.pasoActual === totalSecciones()) {
          construirResumen();
        } else if (el("pantalla-envio").hidden === false) {
          mostrarPantallaEnvio();
        } else {
          irAPaso(Math.min(estado.pasoActual, totalSecciones()));
        }
      }
    });
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();
