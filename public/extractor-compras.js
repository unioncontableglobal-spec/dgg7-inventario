/**
 * public/extractor-compras.js
 * Módulo de Carga Masiva y Extracción Inteligente de Facturas de Compras en PDF
 * Cumple con formato SENIAT (Art. 75 y 76 RLIVA • PA SNAT/2026/00093)
 * Doble Expresión Monetaria: Bolívares (Bs.) prominente y Dólares ($ USD) referencial
 */

let stagingFacturasCompras = [];
let proveedoresCache = [];
let tasaBcvExtractor = 889.58;

// Inicialización de proveedores y tasa
async function initExtractorCompras() {
  try {
    const res = await fetch('/api/proveedores');
    if (res.ok) {
      proveedoresCache = await res.json();
    }
  } catch (e) {
    console.warn('No se pudo precargar catálogo de proveedores:', e.message);
  }

  // Tasa BCV activa
  const selPer = document.getElementById('compras-periodo-select')?.value || '2026-10';
  if (typeof getTasaBcvPorFechaOPeriodo === 'function') {
    tasaBcvExtractor = Number(getTasaBcvPorFechaOPeriodo(selPer) || 889.58);
  }
}

// Abrir Modal de Carga Masiva
function abrirModalCargaMasivaPDF() {
  initExtractorCompras();
  const modal = document.getElementById('modal-carga-masiva-facturas-pdf');
  if (!modal) return;
  modal.style.display = 'flex';

  // Sincronizar período con el selector principal del libro
  const selPerPrincipal = document.getElementById('compras-periodo-select')?.value || '2026-10';
  const selPerModal = document.getElementById('staging-periodo-select');
  if (selPerModal) selPerModal.value = selPerPrincipal;

  const tasaDisplay = document.getElementById('staging-tasa-bcv-display');
  if (tasaDisplay) tasaDisplay.textContent = `Bs. ${tasaBcvExtractor.toFixed(2)}`;

  renderBandejaStagingFacturas();
}

function cerrarModalCargaMasivaPDF() {
  const modal = document.getElementById('modal-carga-masiva-facturas-pdf');
  if (modal) modal.style.display = 'none';
}

// Procesar Lote de Archivos PDF
async function procesarArchivosPDFMasivos(fileList) {
  if (!fileList || fileList.length === 0) return;
  const files = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.pdf'));
  if (files.length === 0) {
    showToast('Por favor selecciona archivos con extensión .PDF', 'warning');
    return;
  }

  const progressBar = document.getElementById('staging-progress-bar');
  const progressCont = document.getElementById('staging-progress-container');
  const progressText = document.getElementById('staging-progress-text');

  if (progressCont) progressCont.style.display = 'block';

  let procesados = 0;
  const periodoActual = document.getElementById('staging-periodo-select')?.value || '2026-10';

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (progressText) progressText.textContent = `Analizando factura ${i + 1} de ${files.length}: ${file.name}...`;
    if (progressBar) progressBar.style.width = `${Math.round(((i + 1) / files.length) * 100)}%`;

    try {
      const textoPdf = await extraerTextoDeArchivoPDF(file);
      const facturaData = analizarTextoFacturaSENIAT(textoPdf, file.name, file, periodoActual, tasaBcvExtractor);
      
      // Validar si ya existe en la bandeja
      const existeEnStaging = stagingFacturasCompras.some(item => 
        item.rif === facturaData.rif && item.nro_factura === facturaData.nro_factura && item.rif !== ''
      );

      if (existeEnStaging) {
        facturaData.alertas.push('⚠️ Factura repetida en la bandeja de carga.');
        facturaData.estado_validacion = 'ADVERTENCIA';
      }

      stagingFacturasCompras.push(facturaData);
      procesados++;
    } catch (err) {
      console.error(`Error analizando ${file.name}:`, err);
      stagingFacturasCompras.push({
        id: `err-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        archivo_nombre: file.name,
        file: file,
        periodo: periodoActual,
        fecha: new Date().toISOString().slice(0, 10),
        rif: '',
        razon_social: '',
        nro_factura: '',
        nro_control: '',
        tipo_servicio: 'MERCANCIA_REPUESTOS',
        aplica_inventario: 1,
        base_imponible_bs: 0,
        iva_bs: 0,
        total_bs: 0,
        base_imponible_divisa: 0,
        total_divisa: 0,
        tasa_bcv: tasaBcvExtractor,
        estado_validacion: 'ERROR',
        alertas: [`Error de lectura: ${err.message}. Requiere ingreso manual.`]
      });
    }
  }

  if (progressCont) progressCont.style.display = 'none';
  showToast(`✅ ${procesados} facturas analizadas y cargadas en la bandeja de revisión.`, 'success');
  renderBandejaStagingFacturas();
}

// Extracción de texto puro vía PDF.js
function extraerTextoDeArchivoPDF(file) {
  return new Promise((resolve, reject) => {
    if (typeof pdfjsLib === 'undefined') {
      return reject(new Error('Librería PDF.js no cargada en el navegador.'));
    }

    const fileReader = new FileReader();
    fileReader.onload = async function () {
      try {
        const typedarray = new Uint8Array(this.result);
        const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageStrings = textContent.items.map(item => item.str);
          fullText += pageStrings.join(' ') + '\n';
        }

        resolve(fullText);
      } catch (e) {
        reject(e);
      }
    };
    fileReader.onerror = () => reject(new Error('Error al leer el archivo en memoria.'));
    fileReader.readAsArrayBuffer(file);
  });
}

// Motor Heurístico SENIAT para Facturas Venezolanas
function analizarTextoFacturaSENIAT(text, fileName, fileObject, periodoDefecto, tasaBcv) {
  const cleanText = text.replace(/\r/g, ' ').replace(/\s+/g, ' ');
  const alertas = [];

  // 1. RIF del Proveedor
  // Excluimos el RIF de DG67 (J-50700865-7)
  const rifRegex = /\b([JVEGjveg][-\s]?\d{7,9}[-\s]?\d)\b/g;
  const rifsEncontrados = cleanText.match(rifRegex) || [];
  let rifProveedor = '';

  for (const r of rifsEncontrados) {
    const rClean = r.replace(/[-\s]/g, '').toUpperCase();
    if (!rClean.includes('507008657') && !rClean.includes('50700865')) {
      const letra = rClean[0];
      const num = rClean.slice(1, -1);
      const dv = rClean.slice(-1);
      rifProveedor = `${letra}-${num}-${dv}`;
      break;
    }
  }

  // 2. Razón Social
  let razonSocial = '';
  if (rifProveedor) {
    // Buscar si existe en el directorio de proveedores
    const provExistente = proveedoresCache.find(p => 
      p.rif.replace(/[-\s]/g, '').toUpperCase() === rifProveedor.replace(/[-\s]/g, '').toUpperCase()
    );
    if (provExistente) {
      razonSocial = provExistente.razon_social;
    }
  }

  if (!razonSocial) {
    // Intentar extraer de encabezado
    const matchRazon = cleanText.match(/(?:Razón\s+Social|Empresa|Proveedor|Denominación\s+Comercial)[\s:]+([A-Z0-9\s.,&'-]{3,60}?)(?:RIF|R\.I\.F|Dirección|Teléfono|Factura)/i);
    if (matchRazon && matchRazon[1]) {
      razonSocial = matchRazon[1].trim();
    } else {
      // Tomar las primeras palabras significativas del encabezado
      const firstWords = cleanText.split(/RIF|R\.I\.F|NIT/i)[0] || '';
      razonSocial = firstWords.trim().slice(0, 45) || 'PROVEEDOR POR CONFIRMAR';
    }
  }

  // 3. Número de Factura
  let nroFactura = '';
  const facRegexes = [
    /(?:Factura|FACTURA|Fac\.?)\s*(?:N[°ºo\.]*|Nro\.?|Número)?\s*[:#]?\s*([A-Za-z0-9\-]{2,20})/i,
    /(?:N[°ºo\.]*|Nro\.?)\s*(?:de\s+)?Factura\s*[:#]?\s*([A-Za-z0-9\-]{2,20})/i,
    /\b(00\d{4,6}|\d{5,8})\b/
  ];

  for (const reg of facRegexes) {
    const m = cleanText.match(reg);
    if (m && m[1]) {
      nroFactura = m[1].replace(/[^A-Za-z0-9\-]/g, '').trim();
      if (nroFactura.length >= 2) break;
    }
  }

  if (!nroFactura) {
    // Extraer número del nombre del archivo si tiene formato FAC-123.pdf
    const matchNom = fileName.match(/(\d{3,8})/);
    if (matchNom) nroFactura = matchNom[1];
    else alertas.push('⚠️ N° de Factura no detectado automáticamente.');
  }

  // 4. Número de Control
  let nroControl = '';
  const ctrlRegexes = [
    /(?:N[°ºo\.]*|Nro\.?|Número)?\s*(?:de\s+)?Control\s*[:#]?\s*([0-9]{2}[-\s]?[0-9]{4,8}|[0-9]{6,8})/i,
    /\b(00-\d{5,8}|01-\d{5,8})\b/i
  ];

  for (const reg of ctrlRegexes) {
    const m = cleanText.match(reg);
    if (m && m[1]) {
      nroControl = m[1].replace(/\s/g, '').trim();
      break;
    }
  }

  if (!nroControl) {
    nroControl = '00-000000';
    alertas.push('⚠️ Falta N° de Control (Verificar documento original).');
  }

  // 5. Fecha de Emisión
  let fechaEmision = '';
  const fechaRegex = /(?:Fecha|FECHA)(?:\s+de\s+Emisi[oó]n)?[\s:]+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/;
  const matchFecha = cleanText.match(fechaRegex);

  if (matchFecha && matchFecha[1]) {
    const rawF = matchFecha[1].replace(/\//g, '-');
    const parts = rawF.split('-');
    if (parts.length === 3) {
      const d = parts[0].padStart(2, '0');
      const m = parts[1].padStart(2, '0');
      let y = parts[2];
      if (y.length === 2) y = '20' + y;
      fechaEmision = `${y}-${m}-${d}`;
    }
  }

  if (!fechaEmision) {
    fechaEmision = `${periodoDefecto}-15`;
    alertas.push('⚠️ Fecha no detectada con certeza; asignada a mediados de período.');
  }

  // 6. Detección de Moneda y Montos (Base, IVA, Total)
  const esDolar = /USD|\$|DOLARES|DIVISA/i.test(cleanText) && !/BOLIVARES|VES|BS\./i.test(cleanText);

  // Extraer números con formato latino (1.234,56) o internacional (1,234.56)
  function parseMonto(str) {
    if (!str) return 0;
    let s = str.trim().replace(/[^0-9.,]/g, '');
    if (s.includes(',') && s.includes('.')) {
      if (s.indexOf('.') < s.indexOf(',')) {
        s = s.replace(/\./g, '').replace(',', '.'); // Latino: 1.250,50 -> 1250.50
      } else {
        s = s.replace(/,/g, ''); // Internacional: 1,250.50 -> 1250.50
      }
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    }
    const val = parseFloat(s);
    return isNaN(val) ? 0 : val;
  }

  let baseImponible = 0;
  let ivaMonto = 0;
  let totalMonto = 0;

  // Buscar bloque de totales
  const mTotal = cleanText.match(/(?:Total\s+(?:a\s+Pagar|Factura|General)?|TOTAL)[\s:]+([0-9.,]+)/i);
  if (mTotal) totalMonto = parseMonto(mTotal[1]);

  const mBase = cleanText.match(/(?:Base\s+Imponible|BASE\s+IMPONIBLE|Subtotal|Base\s+16%)[\s:]+([0-9.,]+)/i);
  if (mBase) baseImponible = parseMonto(mBase[1]);

  const mIva = cleanText.match(/(?:IVA|I\.V\.A\.|Impuesto)(?:\s*16%|\s*\(16%\))?[\s:]+([0-9.,]+)/i);
  if (mIva) ivaMonto = parseMonto(mIva[1]);

  // Si tenemos total y no base
  if (totalMonto > 0 && baseImponible === 0) {
    baseImponible = Number((totalMonto / 1.16).toFixed(2));
    ivaMonto = Number((totalMonto - baseImponible).toFixed(2));
  } else if (baseImponible > 0 && totalMonto === 0) {
    ivaMonto = Number((baseImponible * 0.16).toFixed(2));
    totalMonto = Number((baseImponible + ivaMonto).toFixed(2));
  } else if (baseImponible > 0 && ivaMonto > 0 && totalMonto === 0) {
    totalMonto = Number((baseImponible + ivaMonto).toFixed(2));
  }

  // Conversión Bimonetaria
  let baseBs = baseImponible;
  let ivaBs = ivaMonto;
  let totBs = totalMonto;
  let baseUsd = 0;
  let totUsd = 0;

  if (esDolar) {
    baseUsd = baseImponible;
    totUsd = totalMonto;
    baseBs = Number((baseUsd * tasaBcv).toFixed(2));
    ivaBs = Number((baseBs * 0.16).toFixed(2));
    totBs = Number((baseBs + ivaBs).toFixed(2));
  } else {
    baseUsd = Number((baseBs / tasaBcv).toFixed(2));
    totUsd = Number((totBs / tasaBcv).toFixed(2));
  }

  // Comprobar cuadre matemático
  const delta = Math.abs((baseBs + ivaBs) - totBs);
  if (delta > 1.5 && totBs > 0) {
    alertas.push(`⚠️ Descuadre en totales (Base Bs. ${baseBs} + IVA Bs. ${ivaBs} ≠ Total Bs. ${totBs}).`);
  }

  // 7. Clasificación Contable Sugerida
  let tipoServicio = 'MERCANCIA_REPUESTOS';
  let aplicaInventario = 1;

  const lowText = cleanText.toLowerCase();
  const esMercanciaKws = ['repuesto', 'filtro', 'correa', 'pastilla', 'bomba', 'amortiguador', 'bujia', 'aceite', 'estopera', 'disco', 'rodamient', 'embrague', 'freno'];
  const esActivoKws = ['computador', 'laptop', 'impresora', 'mueble', 'escritorio', 'silla', 'aire acondicionado', 'herramienta', 'taladro', 'estanteria'];
  const esGastoKws = ['honorarios', 'asesoria', 'contable', 'legal', 'flete', 'transporte', 'servicio', 'alquiler', 'papeleria', 'mantenimiento', 'encomienda', 'suministro'];

  if (esActivoKws.some(k => lowText.includes(k))) {
    tipoServicio = 'ACTIVO_FIJO_EQUIPOS';
    aplicaInventario = 0;
  } else if (esGastoKws.some(k => lowText.includes(k))) {
    tipoServicio = 'SERVICIOS_CONTABLES_Y_LEGALES';
    aplicaInventario = 0;
  } else if (esMercanciaKws.some(k => lowText.includes(k))) {
    tipoServicio = 'MERCANCIA_REPUESTOS';
    aplicaInventario = 1;
  }

  const estado = alertas.length === 0 ? 'LISTO' : 'ADVERTENCIA';

  return {
    id: `pdf-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    archivo_nombre: fileName,
    file: fileObject,
    periodo: fechaEmision.slice(0, 7) || periodoDefecto,
    fecha: fechaEmision,
    rif: rifProveedor,
    razon_social: razonSocial,
    nro_factura: nroFactura,
    nro_control: nroControl,
    tipo_servicio: tipoServicio,
    aplica_inventario: aplicaInventario,
    base_imponible_bs: baseBs,
    alicuota: 0.16,
    iva_bs: ivaBs,
    total_bs: totBs,
    base_imponible_divisa: baseUsd,
    total_divisa: totUsd,
    tasa_bcv: tasaBcv,
    estado_validacion: estado,
    alertas: alertas,
    asentado: false
  };
}

// Renderizado de la Bandeja de Validación (Staging Grid)
function renderBandejaStagingFacturas() {
  const tbody = document.getElementById('tbody-staging-compras-pdf');
  if (!tbody) return;

  const totalComps = stagingFacturasCompras.length;
  const listos = stagingFacturasCompras.filter(f => f.estado_validacion === 'LISTO' && !f.asentado).length;
  const alertas = stagingFacturasCompras.filter(f => f.estado_validacion === 'ADVERTENCIA' && !f.asentado).length;
  const asentados = stagingFacturasCompras.filter(f => f.asentado).length;

  let sumBaseBs = 0;
  let sumIvaBs = 0;
  let sumTotBs = 0;
  let sumTotUsd = 0;

  stagingFacturasCompras.forEach(f => {
    if (!f.asentado) {
      sumBaseBs += Number(f.base_imponible_bs || 0);
      sumIvaBs += Number(f.iva_bs || 0);
      sumTotBs += Number(f.total_bs || 0);
      sumTotUsd += Number(f.total_divisa || 0);
    }
  });

  // KPIs
  if (document.getElementById('kpi-staging-total')) document.getElementById('kpi-staging-total').textContent = totalComps;
  if (document.getElementById('kpi-staging-listos')) document.getElementById('kpi-staging-listos').textContent = listos;
  if (document.getElementById('kpi-staging-alertas')) document.getElementById('kpi-staging-alertas').textContent = alertas;
  if (document.getElementById('kpi-staging-tot-bs')) document.getElementById('kpi-staging-tot-bs').textContent = `Bs. ${Number(sumTotBs).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (document.getElementById('kpi-staging-tot-usd')) document.getElementById('kpi-staging-tot-usd').textContent = `$${Number(sumTotUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;

  const btnAsentarTodo = document.getElementById('btn-asentar-todo-staging');
  if (btnAsentarTodo) {
    btnAsentarTodo.disabled = (listos === 0 && alertas === 0);
    btnAsentarTodo.innerHTML = `⚡ Asentar Todo el Lote Válido (${listos + alertas} comprobantes)`;
  }

  if (stagingFacturasCompras.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align: center; padding: 36px 16px; color: #64748b;">
          <div style="font-size: 2.2rem; margin-bottom: 8px;">📂</div>
          <strong style="color: #1e293b; font-size: 0.95rem;">No hay facturas cargadas en la bandeja de previsualización</strong>
          <p style="font-size: 0.78rem; margin-top: 4px; color: #94a3b8;">Arrastra archivos en formato PDF o haz clic en "Seleccionar Facturas PDF" para comenzar la extracción automática.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = stagingFacturasCompras.map((f, idx) => {
    const isAsentado = Boolean(f.asentado);
    const badgeStatus = isAsentado
      ? `<span class="badge" style="background:#10b981; color:#fff;">✓ ASENTADA</span>`
      : (f.estado_validacion === 'LISTO'
        ? `<span class="badge" style="background:#0284c7; color:#fff;">✅ LISTA</span>`
        : `<span class="badge" style="background:#f59e0b; color:#fff;" title="${f.alertas.join(' • ')}">⚠️ REVISAR</span>`);

    const rowBg = isAsentado ? '#f0fdf4' : (idx % 2 === 0 ? '#ffffff' : '#f8fafc');

    return `
      <tr style="background: ${rowBg}; border-bottom: 1px solid #e2e8f0; font-size: 0.82rem;">
        <td style="padding: 8px 10px; font-weight: 700; color: #64748b; text-align: center;">${idx + 1}</td>
        
        <!-- Archivo y Visor -->
        <td style="padding: 8px 10px;">
          <div style="font-weight: 700; color: #0B2447; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${f.archivo_nombre}">
            📄 ${f.archivo_nombre}
          </div>
          <button type="button" class="btn-link" onclick="abrirVisorPDF(${idx})" style="font-size: 0.72rem; color: #0284c7; padding: 0; background: none; border: none; cursor: pointer; text-decoration: underline; margin-top: 2px;">
            👁️ Ver Documento PDF
          </button>
        </td>

        <!-- Fecha -->
        <td style="padding: 8px 10px;">
          <input type="date" value="${f.fecha}" class="form-control" style="font-size: 0.78rem; padding: 3px 6px; width: 125px;"
            ${isAsentado ? 'disabled' : ''} onchange="actualizarCampoStaging(${idx}, 'fecha', this.value)">
        </td>

        <!-- Proveedor (RIF y Nombre) -->
        <td style="padding: 8px 10px;">
          <input type="text" value="${f.rif}" placeholder="J-12345678-9" class="form-control" style="font-size: 0.78rem; padding: 3px 6px; width: 110px; font-family: monospace; font-weight: 700;"
            ${isAsentado ? 'disabled' : ''} onchange="actualizarCampoStaging(${idx}, 'rif', this.value)">
          <input type="text" value="${f.razon_social}" placeholder="Razón Social" class="form-control" style="font-size: 0.75rem; padding: 3px 6px; width: 180px; margin-top: 3px;"
            ${isAsentado ? 'disabled' : ''} onchange="actualizarCampoStaging(${idx}, 'razon_social', this.value)">
        </td>

        <!-- Factura y Control -->
        <td style="padding: 8px 10px;">
          <div style="display:flex; flex-direction:column; gap:3px;">
            <input type="text" value="${f.nro_factura}" placeholder="N° Factura" class="form-control" style="font-size: 0.78rem; padding: 3px 6px; width: 105px; font-weight: 700;"
              ${isAsentado ? 'disabled' : ''} onchange="actualizarCampoStaging(${idx}, 'nro_factura', this.value)">
            <input type="text" value="${f.nro_control}" placeholder="N° Control" class="form-control" style="font-size: 0.72rem; padding: 3px 6px; width: 105px; color: #475569;"
              ${isAsentado ? 'disabled' : ''} onchange="actualizarCampoStaging(${idx}, 'nro_control', this.value)">
          </div>
        </td>

        <!-- Clasificación Contable -->
        <td style="padding: 8px 10px;">
          <select class="form-control" style="font-size: 0.75rem; padding: 4px 6px; font-weight: 700; border-radius: 6px; ${getClasificacionColorStyle(f.tipo_servicio)}"
            ${isAsentado ? 'disabled' : ''} onchange="cambiarClasificacionStaging(${idx}, this.value)">
            <option value="MERCANCIA_REPUESTOS" ${f.tipo_servicio === 'MERCANCIA_REPUESTOS' ? 'selected' : ''}>📦 Mercancía (Inventario)</option>
            <option value="ACTIVO_FIJO_EQUIPOS" ${f.tipo_servicio === 'ACTIVO_FIJO_EQUIPOS' ? 'selected' : ''}>🏢 Activo Fijo / Equipos</option>
            <option value="SERVICIOS_CONTABLES_Y_LEGALES" ${f.tipo_servicio === 'SERVICIOS_CONTABLES_Y_LEGALES' ? 'selected' : ''}>📑 Gasto / Servicios</option>
          </select>
          <div style="font-size: 0.68rem; color: #64748b; margin-top: 3px;">
            ${f.aplica_inventario === 1 ? '✓ Genera Entrada de Almacén' : '• Sin afectación de stock'}
          </div>
        </td>

        <!-- Base e IVA -->
        <td style="padding: 8px 10px; text-align: right; font-family: monospace;">
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px;">
            <div style="font-weight: 700; color: #1e293b;">
              Bs. <input type="number" step="0.01" value="${f.base_imponible_bs}" style="font-size: 0.78rem; width: 95px; text-align: right; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 4px;"
                ${isAsentado ? 'disabled' : ''} onchange="recalcularMontosStaging(${idx}, 'base', this.value)">
            </div>
            <div style="font-size: 0.70rem; color: #64748b;">
              IVA: Bs. ${Number(f.iva_bs).toFixed(2)}
            </div>
          </div>
        </td>

        <!-- Total Factura (Doble Expresión) -->
        <td style="padding: 8px 10px; text-align: right; font-family: monospace;">
          <div style="font-weight: 800; color: #0284c7; font-size: 0.88rem;">
            Bs. ${Number(f.total_bs).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style="font-size: 0.72rem; color: #15803d; font-weight: 700;">
            Ref: $${Number(f.total_divisa).toFixed(2)} USD
          </div>
        </td>

        <!-- Estado y Alertas -->
        <td style="padding: 8px 10px; text-align: center;">
          ${badgeStatus}
          ${f.alertas && f.alertas.length > 0 && !isAsentado ? `
            <div style="font-size: 0.68rem; color: #b45309; margin-top: 3px; max-width: 140px; text-align: left;" title="${f.alertas.join(' \n ')}">
              ${f.alertas[0]}
            </div>
          ` : ''}
        </td>

        <!-- Acciones -->
        <td style="padding: 8px 10px; text-align: center;">
          ${isAsentado ? `
            <span style="color: #10b981; font-weight: 800; font-size: 0.85rem;">✓ Asentada</span>
          ` : `
            <div style="display: flex; gap: 4px; justify-content: center;">
              <button type="button" class="btn btn-emerald btn-sm" onclick="asentarFacturaStagingIndividual(${idx})" title="Dar visto bueno y asentar esta factura en el Libro de Compras">
                ✓ Asentar
              </button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="quitarFacturaStaging(${idx})" title="Quitar de la bandeja">
                ✕
              </button>
            </div>
          `}
        </td>
      </tr>
    `;
  }).join('');
}

function getClasificacionColorStyle(tipo) {
  if (tipo === 'MERCANCIA_REPUESTOS') return 'background:#ecfdf5; color:#065f46; border-color:#a7f3d0;';
  if (tipo === 'ACTIVO_FIJO_EQUIPOS') return 'background:#eff6ff; color:#1e40af; border-color:#bfdbfe;';
  return 'background:#fefce8; color:#854d0e; border-color:#fde047;';
}

function cambiarClasificacionStaging(idx, nuevoTipo) {
  if (!stagingFacturasCompras[idx]) return;
  stagingFacturasCompras[idx].tipo_servicio = nuevoTipo;
  stagingFacturasCompras[idx].aplica_inventario = (nuevoTipo === 'MERCANCIA_REPUESTOS') ? 1 : 0;
  renderBandejaStagingFacturas();
}

function actualizarCampoStaging(idx, campo, valor) {
  if (!stagingFacturasCompras[idx]) return;
  stagingFacturasCompras[idx][campo] = valor;
}

function recalcularMontosStaging(idx, campo, nuevoValor) {
  const f = stagingFacturasCompras[idx];
  if (!f) return;
  const num = parseFloat(nuevoValor) || 0;
  if (campo === 'base') {
    f.base_imponible_bs = num;
    f.iva_bs = Number((num * 0.16).toFixed(2));
    f.total_bs = Number((num + f.iva_bs).toFixed(2));
    f.base_imponible_divisa = Number((f.base_imponible_bs / f.tasa_bcv).toFixed(2));
    f.total_divisa = Number((f.total_bs / f.tasa_bcv).toFixed(2));
  }
  f.alertas = f.alertas.filter(a => !a.includes('Descuadre'));
  renderBandejaStagingFacturas();
}

function quitarFacturaStaging(idx) {
  stagingFacturasCompras.splice(idx, 1);
  renderBandejaStagingFacturas();
}

function limpiarBandejaStaging() {
  if (stagingFacturasCompras.length === 0) return;
  if (!confirm('¿Deseas vaciar la bandeja de previsualización de facturas?')) return;
  stagingFacturasCompras = [];
  renderBandejaStagingFacturas();
  showToast('Bandeja de facturas vaciada.', 'info');
}

// Asentar Factura Individual con Visto Bueno
async function asentarFacturaStagingIndividual(idx) {
  const f = stagingFacturasCompras[idx];
  if (!f || f.asentado) return;

  if (!f.rif || !f.nro_factura) {
    showToast('La factura debe tener RIF y N° de Factura antes de asentar.', 'warning');
    return;
  }

  const payload = {
    periodo: f.periodo,
    fecha: f.fecha,
    rif: f.rif,
    razon_social: f.razon_social || 'PROVEEDOR GENERAL',
    nro_factura: f.nro_factura,
    nro_control: f.nro_control || '00-000000',
    tipo_servicio: f.tipo_servicio,
    aplica_inventario: f.aplica_inventario,
    base_imponible_bs: f.base_imponible_bs,
    alicuota: 0.16,
    iva_bs: f.iva_bs,
    total_bs: f.total_bs,
    tasa_bcv: f.tasa_bcv,
    archivo_origen: f.archivo_nombre
  };

  try {
    const res = await fetch('/api/fiscal/libro-compras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error al asentar factura');
    }

    f.asentado = true;
    f.estado_validacion = 'ASENTADA';
    showToast(`✅ Factura [${f.nro_factura}] asentada formalmente en el Libro de Compras (Op #${data.nro_operacion || ''}).`, 'success');

    // Recargar vista principal del libro si está abierta
    if (typeof loadLibroCompras === 'function') loadLibroCompras();
    renderBandejaStagingFacturas();
  } catch (error) {
    console.error('Error asentando factura:', error);
    showToast(`❌ Error al asentar [${f.nro_factura}]: ${error.message}`, 'error');
  }
}

// Asentar Todo el Lote Válido
async function asentarTodasFacturasValidadas() {
  const pendientes = stagingFacturasCompras.filter(f => !f.asentado && f.rif && f.nro_factura);
  if (pendientes.length === 0) {
    showToast('No hay facturas pendientes y listas para asentar en la bandeja.', 'warning');
    return;
  }

  const confirmacion = confirm(`¿Estás seguro de asentar formalmente ${pendientes.length} facturas al Libro de Compras fiscal?`);
  if (!confirmacion) return;

  const btn = document.getElementById('btn-asentar-todo-staging');
  if (btn) btn.disabled = true;

  const payload = {
    facturas: pendientes.map(f => ({
      periodo: f.periodo,
      fecha: f.fecha,
      rif: f.rif,
      razon_social: f.razon_social || 'PROVEEDOR GENERAL',
      nro_factura: f.nro_factura,
      nro_control: f.nro_control || '00-000000',
      tipo_servicio: f.tipo_servicio,
      aplica_inventario: f.aplica_inventario,
      base_imponible_bs: f.base_imponible_bs,
      alicuota: 0.16,
      iva_bs: f.iva_bs,
      total_bs: f.total_bs,
      tasa_bcv: f.tasa_bcv,
      archivo_origen: f.archivo_nombre
    }))
  };

  try {
    const res = await fetch('/api/fiscal/libro-compras/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al asentar lote de compras');

    // Marcar resultados
    if (data.resultados && Array.isArray(data.resultados)) {
      data.resultados.forEach(r => {
        const item = stagingFacturasCompras.find(f => f.nro_factura === r.nro_factura);
        if (item && r.success) {
          item.asentado = true;
          item.estado_validacion = 'ASENTADA';
        } else if (item && !r.success) {
          item.alertas.push(`Error: ${r.error}`);
        }
      });
    }

    showToast(`⚡ Lote procesado: ${data.insertadas} facturas asentadas con éxito en el Libro de Compras.`, 'success');
    if (typeof loadLibroCompras === 'function') loadLibroCompras();
    renderBandejaStagingFacturas();
  } catch (err) {
    console.error('Error asentando lote:', err);
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Visor de PDF Integrado
function abrirVisorPDF(idx) {
  const f = stagingFacturasCompras[idx];
  if (!f || !f.file) {
    showToast('No se encontró el objeto del archivo PDF original.', 'warning');
    return;
  }

  const modalVisor = document.getElementById('modal-visor-pdf-factura');
  const iframe = document.getElementById('iframe-visor-pdf-factura');
  const titulo = document.getElementById('visor-pdf-titulo');

  if (!modalVisor || !iframe) return;

  const fileUrl = URL.createObjectURL(f.file);
  iframe.src = fileUrl;
  if (titulo) titulo.textContent = `Visualizando Factura: ${f.archivo_nombre} (${f.nro_factura || 'Sin Nro'})`;

  modalVisor.style.display = 'flex';
}

function cerrarVisorPDF() {
  const modalVisor = document.getElementById('modal-visor-pdf-factura');
  const iframe = document.getElementById('iframe-visor-pdf-factura');
  if (modalVisor) modalVisor.style.display = 'none';
  if (iframe) iframe.src = '';
}

// Exponer funciones globales
window.abrirModalCargaMasivaPDF = abrirModalCargaMasivaPDF;
window.cerrarModalCargaMasivaPDF = cerrarModalCargaMasivaPDF;
window.procesarArchivosPDFMasivos = procesarArchivosPDFMasivos;
window.actualizarCampoStaging = actualizarCampoStaging;
window.cambiarClasificacionStaging = cambiarClasificacionStaging;
window.recalcularMontosStaging = recalcularMontosStaging;
window.quitarFacturaStaging = quitarFacturaStaging;
window.limpiarBandejaStaging = limpiarBandejaStaging;
window.asentarFacturaStagingIndividual = asentarFacturaStagingIndividual;
window.asentarTodasFacturasValidadas = asentarTodasFacturasValidadas;
window.abrirVisorPDF = abrirVisorPDF;
window.cerrarVisorPDF = cerrarVisorPDF;
