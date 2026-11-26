// ==============================================================================
// MOTOR OFICIAL DE RETENCIONES ISLR (DECRETO 1.808) Y GENERADOR XML SENIAT
// Compartido entre Cloudflare Pages Functions (producción) y server.js (local)
// ==============================================================================

/**
 * Catálogo oficial de códigos de concepto ISLR para el archivo XML del Portal SENIAT
 * (RelacionRetencionesISLR) bajo el Decreto N° 1.808 (Art. 9).
 */
export const CATALOGO_CONCEPTOS_ISLR = [
  // 1. Honorarios Profesionales No Mercantiles (Art. 9 Num. 1)
  { codigo: '002', descripcion: 'Honorarios Profesionales No Mercantiles (PN-R)', grupo_servicio: 'HONORARIOS_NO_MERCANTILES', tipo_persona: 'PN-R', pct_base: 100.0, pct_tarifa: 3.0, aplica_sustraendo: 1, literal_decreto: 'Art. 9 Num. 1b' },
  { codigo: '003', descripcion: 'Honorarios Profesionales No Mercantiles (PN-NR)', grupo_servicio: 'HONORARIOS_NO_MERCANTILES', tipo_persona: 'PN-NR', pct_base: 90.0, pct_tarifa: 34.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 1a' },
  { codigo: '004', descripcion: 'Honorarios Profesionales No Mercantiles (PJ-D)', grupo_servicio: 'HONORARIOS_NO_MERCANTILES', tipo_persona: 'PJ-D', pct_base: 100.0, pct_tarifa: 5.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 1b' },
  { codigo: '005', descripcion: 'Honorarios Profesionales No Mercantiles (PJ-ND)', grupo_servicio: 'HONORARIOS_NO_MERCANTILES', tipo_persona: 'PJ-ND', pct_base: 90.0, pct_tarifa: 34.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 1b' },

  // 2. Comisiones Mercantiles y de Venta de Inmuebles (Art. 9 Num. 2)
  { codigo: '014', descripcion: 'Comisiones por Venta de Inmuebles (PN-R)', grupo_servicio: 'COMISIONES_MERCANTILES', tipo_persona: 'PN-R', pct_base: 100.0, pct_tarifa: 3.0, aplica_sustraendo: 1, literal_decreto: 'Art. 9 Num. 2a' },
  { codigo: '015', descripcion: 'Comisiones por Venta de Inmuebles (PJ-D)', grupo_servicio: 'COMISIONES_MERCANTILES', tipo_persona: 'PJ-D', pct_base: 100.0, pct_tarifa: 5.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 2a' },
  { codigo: '018', descripcion: 'Comisiones Mercantiles y Otras Comisiones (PN-R)', grupo_servicio: 'COMISIONES_MERCANTILES', tipo_persona: 'PN-R', pct_base: 100.0, pct_tarifa: 3.0, aplica_sustraendo: 1, literal_decreto: 'Art. 9 Num. 2b' },
  { codigo: '019', descripcion: 'Comisiones Mercantiles y Otras Comisiones (PJ-D)', grupo_servicio: 'COMISIONES_MERCANTILES', tipo_persona: 'PJ-D', pct_base: 100.0, pct_tarifa: 5.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 2b' },
  { codigo: '020', descripcion: 'Comisiones Mercantiles y Otras Comisiones (PN-NR)', grupo_servicio: 'COMISIONES_MERCANTILES', tipo_persona: 'PN-NR', pct_base: 100.0, pct_tarifa: 34.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 2b' },
  { codigo: '021', descripcion: 'Comisiones Mercantiles y Otras Comisiones (PJ-ND)', grupo_servicio: 'COMISIONES_MERCANTILES', tipo_persona: 'PJ-ND', pct_base: 100.0, pct_tarifa: 5.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 2b' },

  // 3. Empresas Contratistas, Obras y Servicios Empresariales/Asesoría Mercantil (Art. 9 Num. 11)
  { codigo: '053', descripcion: 'Ejecución de Obras y Prestación de Servicios (PN-R)', grupo_servicio: 'CONTRATISTAS_OBRAS_SERVICIOS', tipo_persona: 'PN-R', pct_base: 100.0, pct_tarifa: 1.0, aplica_sustraendo: 1, literal_decreto: 'Art. 9 Num. 11a' },
  { codigo: '054', descripcion: 'Ejecución de Obras y Prestación de Servicios (PN-NR)', grupo_servicio: 'CONTRATISTAS_OBRAS_SERVICIOS', tipo_persona: 'PN-NR', pct_base: 100.0, pct_tarifa: 34.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 11a' },
  { codigo: '055', descripcion: 'Contratistas, Servicios y Asesoría Empresarial (PJ-D)', grupo_servicio: 'CONTRATISTAS_OBRAS_SERVICIOS', tipo_persona: 'PJ-D', pct_base: 100.0, pct_tarifa: 2.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 11b' },
  { codigo: '056', descripcion: 'Ejecución de Obras y Prestación de Servicios (PJ-ND)', grupo_servicio: 'CONTRATISTAS_OBRAS_SERVICIOS', tipo_persona: 'PJ-ND', pct_base: 100.0, pct_tarifa: 34.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 11b' },

  // 4. Arrendamiento de Bienes Inmuebles (Art. 9 Num. 12)
  { codigo: '057', descripcion: 'Arrendamiento de Bienes Inmuebles (PN-R)', grupo_servicio: 'ARRENDAMIENTO_INMUEBLES', tipo_persona: 'PN-R', pct_base: 100.0, pct_tarifa: 3.0, aplica_sustraendo: 1, literal_decreto: 'Art. 9 Num. 12a' },
  { codigo: '058', descripcion: 'Arrendamiento de Bienes Inmuebles (PJ-D)', grupo_servicio: 'ARRENDAMIENTO_INMUEBLES', tipo_persona: 'PJ-D', pct_base: 100.0, pct_tarifa: 5.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 12b' },
  { codigo: '059', descripcion: 'Arrendamiento de Bienes Inmuebles (PN-NR)', grupo_servicio: 'ARRENDAMIENTO_INMUEBLES', tipo_persona: 'PN-NR', pct_base: 100.0, pct_tarifa: 34.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 12a' },
  { codigo: '060', descripcion: 'Arrendamiento de Bienes Inmuebles (PJ-ND)', grupo_servicio: 'ARRENDAMIENTO_INMUEBLES', tipo_persona: 'PJ-ND', pct_base: 100.0, pct_tarifa: 34.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 12b' },

  // 5. Arrendamiento de Bienes Muebles (Art. 9 Num. 13)
  { codigo: '061', descripcion: 'Arrendamiento de Bienes Muebles (PN-R)', grupo_servicio: 'ARRENDAMIENTO_MUEBLES', tipo_persona: 'PN-R', pct_base: 100.0, pct_tarifa: 3.0, aplica_sustraendo: 1, literal_decreto: 'Art. 9 Num. 13a' },
  { codigo: '062', descripcion: 'Arrendamiento de Bienes Muebles (PJ-D)', grupo_servicio: 'ARRENDAMIENTO_MUEBLES', tipo_persona: 'PJ-D', pct_base: 100.0, pct_tarifa: 5.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 13b' },
  { codigo: '063', descripcion: 'Arrendamiento de Bienes Muebles (PN-NR)', grupo_servicio: 'ARRENDAMIENTO_MUEBLES', tipo_persona: 'PN-NR', pct_base: 100.0, pct_tarifa: 34.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 13a' },
  { codigo: '064', descripcion: 'Arrendamiento de Bienes Muebles (PJ-ND)', grupo_servicio: 'ARRENDAMIENTO_MUEBLES', tipo_persona: 'PJ-ND', pct_base: 100.0, pct_tarifa: 5.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 13b' },

  // 6. Gastos de Transporte conformados por Fletes Nacionales (Art. 9 Num. 15)
  { codigo: '071', descripcion: 'Gastos de Transporte / Fletes Nacionales (PN-R)', grupo_servicio: 'FLETES_Y_TRANSPORTE', tipo_persona: 'PN-R', pct_base: 100.0, pct_tarifa: 1.0, aplica_sustraendo: 1, literal_decreto: 'Art. 9 Num. 15a' },
  { codigo: '072', descripcion: 'Gastos de Transporte / Fletes Nacionales (PJ-D)', grupo_servicio: 'FLETES_Y_TRANSPORTE', tipo_persona: 'PJ-D', pct_base: 100.0, pct_tarifa: 3.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 15b' },

  // 7. Publicidad y Propaganda Comercial (Art. 9 Num. 19)
  { codigo: '083', descripcion: 'Publicidad y Propaganda Comercial (PN-R)', grupo_servicio: 'PUBLICIDAD_Y_PROPAGANDA', tipo_persona: 'PN-R', pct_base: 100.0, pct_tarifa: 3.0, aplica_sustraendo: 1, literal_decreto: 'Art. 9 Num. 19a' },
  { codigo: '084', descripcion: 'Publicidad y Propaganda Comercial (PJ-D)', grupo_servicio: 'PUBLICIDAD_Y_PROPAGANDA', tipo_persona: 'PJ-D', pct_base: 100.0, pct_tarifa: 5.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 19b' },
  { codigo: '085', descripcion: 'Publicidad y Propaganda Comercial (PJ-ND)', grupo_servicio: 'PUBLICIDAD_Y_PROPAGANDA', tipo_persona: 'PJ-ND', pct_base: 100.0, pct_tarifa: 5.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 19b' },
  { codigo: '086', descripcion: 'Publicidad en Emisoras de Radio (PJ-D)', grupo_servicio: 'PUBLICIDAD_RADIO', tipo_persona: 'PJ-D', pct_base: 100.0, pct_tarifa: 3.0, aplica_sustraendo: 0, literal_decreto: 'Art. 9 Num. 19c' }
];

/**
 * Matriz de mapeo directo: Tipo de Servicio del sistema x Tipo de Contribuyente -> Código XML SENIAT
 */
export const SERVICIO_A_CONCEPTOS = {
  HONORARIOS_NO_MERCANTILES:       { 'PN-R': '002', 'PN-NR': '003', 'PJ-D': '004', 'PJ-ND': '005' },
  COMISIONES_MERCANTILES:          { 'PN-R': '018', 'PN-NR': '020', 'PJ-D': '019', 'PJ-ND': '021' },
  CONTRATISTAS_OBRAS_SERVICIOS:    { 'PN-R': '053', 'PN-NR': '054', 'PJ-D': '055', 'PJ-ND': '056' },
  SERVICIOS_CONTABLES_Y_LEGALES:   { 'PN-R': '053', 'PN-NR': '054', 'PJ-D': '055', 'PJ-ND': '056' },
  SERVICIOS_TECNICOS_Y_SISTEMAS:   { 'PN-R': '053', 'PN-NR': '054', 'PJ-D': '055', 'PJ-ND': '056' },
  GASTOS_MANTENIMIENTO_FERRETERIA: { 'PN-R': '053', 'PN-NR': '054', 'PJ-D': '055', 'PJ-ND': '056' },
  GASTOS_OPERATIVOS_VARIOS:        { 'PN-R': '053', 'PN-NR': '054', 'PJ-D': '055', 'PJ-ND': '056' },
  ARRENDAMIENTO_INMUEBLES:         { 'PN-R': '057', 'PN-NR': '059', 'PJ-D': '058', 'PJ-ND': '060' },
  ARRENDAMIENTO_MUEBLES:           { 'PN-R': '061', 'PN-NR': '063', 'PJ-D': '062', 'PJ-ND': '064' },
  FLETES_Y_TRANSPORTE:             { 'PN-R': '071', 'PN-NR': '071', 'PJ-D': '072', 'PJ-ND': '072' },
  PUBLICIDAD_Y_PROPAGANDA:         { 'PN-R': '083', 'PN-NR': '083', 'PJ-D': '084', 'PJ-ND': '085' },
  PUBLICIDAD_RADIO:                { 'PN-R': '083', 'PN-NR': '083', 'PJ-D': '086', 'PJ-ND': '085' },
  MERCANCIA_REPUESTOS:             { 'PN-R': '053', 'PN-NR': '054', 'PJ-D': '055', 'PJ-ND': '056' },
  ACTIVO_FIJO_EQUIPOS:             { 'PN-R': '053', 'PN-NR': '054', 'PJ-D': '055', 'PJ-ND': '056' },
  GASTOS_CONSUMO_ALIMENTOS:        { 'PN-R': '053', 'PN-NR': '054', 'PJ-D': '055', 'PJ-ND': '056' }
};

/**
 * Etiquetas legibles de clasificación de servicio en UI
 */
export const ETIQUETAS_TIPO_SERVICIO = {
  MERCANCIA_REPUESTOS: 'Repuestos / Mercancía (Inventario)',
  SERVICIOS_CONTABLES_Y_LEGALES: 'Servicios Contables, Legales y Asesoría (Contratista)',
  HONORARIOS_NO_MERCANTILES: 'Honorarios Profesionales No Mercantiles',
  SERVICIOS_TECNICOS_Y_SISTEMAS: 'Servicios Técnicos, Sistemas y Máquinas Fiscales',
  CONTRATISTAS_OBRAS_SERVICIOS: 'Contratistas de Obras y Servicios Generales',
  FLETES_Y_TRANSPORTE: 'Fletes y Transporte Nacional de Carga',
  ARRENDAMIENTO_INMUEBLES: 'Arrendamiento de Bienes Inmuebles',
  ARRENDAMIENTO_MUEBLES: 'Arrendamiento de Bienes Muebles / Equipos',
  COMISIONES_MERCANTILES: 'Comisiones Mercantiles e Intermediación',
  PUBLICIDAD_Y_PROPAGANDA: 'Publicidad y Propaganda Comercial',
  PUBLICIDAD_RADIO: 'Publicidad en Emisoras de Radio',
  GASTOS_MANTENIMIENTO_FERRETERIA: 'Ferretería y Mantenimiento',
  GASTOS_CONSUMO_ALIMENTOS: 'Consumo y Alimentación',
  ACTIVO_FIJO_EQUIPOS: 'Activo Fijo y Mobiliario',
  GASTOS_OPERATIVOS_VARIOS: 'Otros Gastos Operativos / Servicios'
};

/**
 * Equivalencias desde códigos heredados usados en versiones previas hacia códigos oficiales XML SENIAT
 */
const LEGACY_CODIGO_A_OFICIAL = {
  '001': '002', // Honorarios PN-R 3% -> 002
  '039': '071', // Fletes PN-R 1% -> 071
  '041': '072', // Fletes PJ-D 3% -> 072
  '047': '083', // Publicidad PN-R 3% -> 083
  '049': '084', // Publicidad PJ-D 5% -> 084
  '027': '057', // Arrend. Inmuebles PN-R 3% -> 057
  '029': '058', // Arrend. Inmuebles PJ-D 5% -> 058
  '031': '061', // Arrend. Muebles PN-R 3% -> 061
  '033': '062', // Arrend. Muebles PJ-D 5% -> 062
  '016': '019'  // Comisiones PJ-D 5% -> 019
};

export function getConceptoByCodigo(codigo) {
  const cleanCod = String(codigo || '').trim().padStart(3, '0');
  return CATALOGO_CONCEPTOS_ISLR.find(c => c.codigo === cleanCod) || null;
}

/**
 * Normaliza el tipo de contribuyente (PN-R, PN-NR, PJ-D, PJ-ND) respetando la letra inicial del RIF.
 */
export function normalizarTipoContribuyente(rif, tipoPersonaExplicito) {
  const cleanRif = String(rif || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const explicit = String(tipoPersonaExplicito || '').trim().toUpperCase();

  if (cleanRif.startsWith('V') || cleanRif.startsWith('E')) {
    return explicit === 'PN-NR' ? 'PN-NR' : 'PN-R';
  }
  if (cleanRif.startsWith('J') || cleanRif.startsWith('G') || cleanRif.startsWith('C')) {
    return explicit === 'PJ-ND' ? 'PJ-ND' : 'PJ-D';
  }
  if (['PN-R', 'PN-NR', 'PJ-D', 'PJ-ND'].includes(explicit)) {
    return explicit;
  }
  return 'PJ-D';
}

/**
 * Resuelve automáticamente el código oficial SENIAT y sus parámetros (base %, tarifa %, sustraendo)
 * según la combinación exacta de Tipo de Servicio y Tipo de Contribuyente.
 */
export function resolverConceptoISLR({ tipoServicio, rif, tipoPersona, codigoActual = null }) {
  const tipoContribuyente = normalizarTipoContribuyente(rif, tipoPersona);
  const cleanSrv = String(tipoServicio || 'CONTRATISTAS_OBRAS_SERVICIOS').trim().toUpperCase();
  const mapSrv = SERVICIO_A_CONCEPTOS[cleanSrv] || SERVICIO_A_CONCEPTOS.CONTRATISTAS_OBRAS_SERVICIOS;
  const codigoSugerido = mapSrv[tipoContribuyente] || (tipoContribuyente === 'PN-R' ? '053' : '055');
  const conceptoSugerido = getConceptoByCodigo(codigoSugerido) || CATALOGO_CONCEPTOS_ISLR[0];

  let conceptoEfectivo = conceptoSugerido;
  if (codigoActual) {
    const cleanAct = String(codigoActual).trim().padStart(3, '0');
    const migrated = LEGACY_CODIGO_A_OFICIAL[cleanAct] || cleanAct;
    const foundAct = getConceptoByCodigo(migrated);
    if (foundAct) {
      conceptoEfectivo = foundAct;
    }
  }

  return {
    tipo_contribuyente: tipoContribuyente,
    tipo_servicio: cleanSrv,
    codigo_sugerido: conceptoSugerido.codigo,
    concepto_sugerido: conceptoSugerido,
    concepto_efectivo: conceptoEfectivo
  };
}

/**
 * Sincroniza la tabla conceptos_islr_seniat en base de datos con el catálogo oficial completo.
 */
export async function syncCatalogoConceptosISLR(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS conceptos_islr_seniat (
      codigo TEXT PRIMARY KEY,
      descripcion TEXT NOT NULL,
      tipo_persona TEXT NOT NULL,
      pct_base REAL NOT NULL DEFAULT 100.0,
      pct_tarifa REAL NOT NULL DEFAULT 2.0,
      aplica_sustraendo INTEGER NOT NULL DEFAULT 0,
      literal_decreto TEXT DEFAULT ''
    )
  `).catch(() => {});

  for (const c of CATALOGO_CONCEPTOS_ISLR) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO conceptos_islr_seniat (codigo, descripcion, tipo_persona, pct_base, pct_tarifa, aplica_sustraendo, literal_decreto)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [c.codigo, c.descripcion, c.tipo_persona, c.pct_base, c.pct_tarifa, c.aplica_sustraendo, c.literal_decreto]
    }).catch(() => {});
  }
}

// ==============================================================================
// FORMATEADORES ESTRICTOS XSD PORTAL SENIAT (RelacionRetencionesISLR)
// ==============================================================================

export function escapeXml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function formatRifSeniat(rif) {
  return String(rif || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function isRifSeniatValido(cleanRif) {
  return /^[VEJGP][0-9]{9}$/.test(String(cleanRif || ''));
}

export function formatFacturaSeniat(nroFactura) {
  let clean = String(nroFactura || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!clean || clean === 'SN' || clean === 'NA' || clean === 'SF') {
    return '';
  }
  if (clean.length > 10) {
    clean = clean.replace(/^0+/, '') || '';
    if (clean.length > 10) clean = clean.slice(-10);
  }
  return clean;
}

export function formatControlSeniat(nroControl) {
  const raw = String(nroControl || '').trim().toUpperCase();
  if (!raw || ['NA', 'N/A', 'SC', 'S/C', 'SN', 'S/N', 'NO APLICA', '00-', '00'].includes(raw)) {
    return 'NA';
  }
  let digits = raw.replace(/[^0-9]/g, '');
  if (!digits || /^0+$/.test(digits)) {
    return 'NA';
  }
  if (digits.length > 10) {
    digits = digits.replace(/^0+/, '') || '0';
    if (digits.length > 10) digits = digits.slice(-10);
  }
  return digits;
}

export function formatFechaSeniat(fechaStr, fallbackFecha) {
  const raw = String(fechaStr || fallbackFecha || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-');
    return `${d}/${m}/${y}`;
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    const [d, m, y] = raw.split('/');
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }
  return raw;
}

export function formatPorcentajeSeniat(pct) {
  const num = Number(pct || 0);
  if (!Number.isFinite(num) || num < 0) return '0';
  const rounded = Number(num.toFixed(2));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/**
 * Construye el archivo XML oficial del SENIAT (<RelacionRetencionesISLR>) y audita cada línea
 * verificando validez XSD y consistencia legal entre Tipo de Servicio, Contribuyente, Código y %.
 */
export function buildXmlRelacionRetencionesISLR({ agenteRif, periodo, rows = [], utBs = 43.0, factorSustraendo = 83.3334 }) {
  const yyyymm = String(periodo || '').replace(/[^0-9]/g, '').slice(0, 6);
  const cleanAgenteRif = formatRifSeniat(agenteRif || 'J507008657');

  const xmlLines = [
    `<?xml version="1.0" encoding="ISO-8859-1"?>`,
    `<RelacionRetencionesISLR RifAgente="${escapeXml(cleanAgenteRif)}" Periodo="${escapeXml(yyyymm)}">`
  ];

  const detallesPreview = [];
  const erroresValidacion = [];
  const advertencias = [];
  const resumenConceptosMap = new Map();

  let totalMontoOperacion = 0;
  let totalRetenidoBs = 0;

  if (!isRifSeniatValido(cleanAgenteRif)) {
    erroresValidacion.push(`RIF del Agente de Retención inválido para esquema XML SENIAT: "${cleanAgenteRif}"`);
  }
  if (!/^\d{6}$/.test(yyyymm)) {
    erroresValidacion.push(`Período inválido para XML SENIAT (debe ser AAAAMM): "${yyyymm}"`);
  }

  for (const row of rows) {
    const cleanRifRetenido = formatRifSeniat(row.sujeto_rif);
    const cleanFactura = formatFacturaSeniat(row.nro_factura);
    const cleanControl = formatControlSeniat(row.nro_control);
    const fechaOp = formatFechaSeniat(row.fecha_factura, row.fecha_emision);

    // Tipo de servicio efectivo: priorizar clasificación específica de factura/proveedor
    const isGenericType = t => !t || ['MERCANCIA_REPUESTOS', 'ACTIVO_FIJO_EQUIPOS', 'GASTOS_OPERATIVOS_VARIOS'].includes(t);
    const lcTipo = String(row.lc_tipo_servicio || '').trim().toUpperCase();
    const provTipo = String(row.prov_tipo_servicio || '').trim().toUpperCase();
    const tipoServicio = (!isGenericType(lcTipo) ? lcTipo : (!isGenericType(provTipo) ? provTipo : (lcTipo || provTipo || 'CONTRATISTAS_OBRAS_SERVICIOS')));

    const resolucion = resolverConceptoISLR({
      tipoServicio,
      rif: row.sujeto_rif,
      tipoPersona: row.sujeto_tipo_persona,
      codigoActual: row.codigo_concepto
    });

    const codConcepto = String(row.codigo_concepto || resolucion.codigo_sugerido || '055').trim().padStart(3, '0');
    const conceptoCatalogo = getConceptoByCodigo(codConcepto);

    const baseImp = Number(row.base_imponible_bs || 0);
    const pctBase = Number(row.pct_base !== undefined && row.pct_base !== null ? row.pct_base : (conceptoCatalogo?.pct_base || 100));
    const pctTarifa = Number(row.pct_tarifa !== undefined && row.pct_tarifa !== null ? row.pct_tarifa : (conceptoCatalogo?.pct_tarifa || 2));

    // MontoOperacion en el XML del SENIAT = base sujeta a retención (ej. 100% o 90% de la base imponible)
    const montoOperacionNum = Number((baseImp * (pctBase / 100)).toFixed(2));
    const montoOpStr = montoOperacionNum.toFixed(2);
    const pctRetStr = formatPorcentajeSeniat(pctTarifa);
    const impuestoRetenido = Number(row.impuesto_retenido_bs || 0);

    totalMontoOperacion += montoOperacionNum;
    totalRetenidoBs += impuestoRetenido;

    const lineErrors = [];
    const lineWarnings = [];

    if (!isRifSeniatValido(cleanRifRetenido)) {
      lineErrors.push(`RIF Retenido inválido (${cleanRifRetenido || 'vacío'})`);
    }
    if (!/^[A-Za-z0-9]{1,10}$/.test(cleanFactura)) {
      lineErrors.push(`N° Factura inválido para XSD (${cleanFactura})`);
    }
    if (!/^(NA|na|[0-9]{1,10})$/.test(cleanControl)) {
      lineErrors.push(`N° Control inválido para XSD (${cleanControl})`);
    }
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(fechaOp)) {
      lineErrors.push(`FechaOperacion inválida (${fechaOp})`);
    }
    if (!/^\d{3}$/.test(codConcepto)) {
      lineErrors.push(`CodigoConcepto debe ser de 3 dígitos (${codConcepto})`);
    }
    if (montoOperacionNum <= 0) {
      lineErrors.push(`MontoOperacion debe ser mayor a 0`);
    }

    // Auditoría legal Servicio ↔ Contribuyente ↔ Código ↔ Porcentaje
    if (!conceptoCatalogo) {
      lineWarnings.push(`Código ${codConcepto} no figura en la matriz oficial Decreto 1.808 (se sugiere ${resolucion.codigo_sugerido})`);
    } else {
      if (conceptoCatalogo.tipo_persona !== resolucion.tipo_contribuyente) {
        lineWarnings.push(
          `El código ${codConcepto} corresponde a ${conceptoCatalogo.tipo_persona}, pero el contribuyente es ${resolucion.tipo_contribuyente}. Sugerido: ${resolucion.codigo_sugerido} (${resolucion.concepto_sugerido.pct_tarifa}%)`
        );
      }
      if (Math.abs(Number(conceptoCatalogo.pct_tarifa) - pctTarifa) > 0.01) {
        lineWarnings.push(
          `El código ${codConcepto} establece ${conceptoCatalogo.pct_tarifa}% en Decreto 1.808, pero la retención registra ${pctRetStr}%`
        );
      }
      if (!isGenericType(tipoServicio) && codConcepto !== resolucion.codigo_sugerido) {
        const labelSrv = ETIQUETAS_TIPO_SERVICIO[resolucion.tipo_servicio] || resolucion.tipo_servicio;
        lineWarnings.push(
          `Según clasificación "${labelSrv}" y contribuyente ${resolucion.tipo_contribuyente}, corresponde el código ${resolucion.codigo_sugerido} (${resolucion.concepto_sugerido.pct_tarifa}%)`
        );
      }
    }

    if (lineErrors.length > 0) {
      erroresValidacion.push(`Comp. ${row.nro_comprobante} / Fact. ${cleanFactura}: ${lineErrors.join('; ')}`);
    }
    if (lineWarnings.length > 0) {
      advertencias.push(`Comp. ${row.nro_comprobante} / Fact. ${cleanFactura}: ${lineWarnings.join(' | ')}`);
    }

    xmlLines.push(`  <DetalleRetencion>`);
    xmlLines.push(`    <RifRetenido>${escapeXml(cleanRifRetenido)}</RifRetenido>`);
    xmlLines.push(`    <NumeroFactura>${escapeXml(cleanFactura)}</NumeroFactura>`);
    xmlLines.push(`    <NumeroControl>${escapeXml(cleanControl)}</NumeroControl>`);
    xmlLines.push(`    <FechaOperacion>${escapeXml(fechaOp)}</FechaOperacion>`);
    xmlLines.push(`    <CodigoConcepto>${escapeXml(codConcepto)}</CodigoConcepto>`);
    xmlLines.push(`    <MontoOperacion>${escapeXml(montoOpStr)}</MontoOperacion>`);
    xmlLines.push(`    <PorcentajeRetencion>${escapeXml(pctRetStr)}</PorcentajeRetencion>`);
    xmlLines.push(`  </DetalleRetencion>`);

    const groupKey = `${codConcepto}|${resolucion.tipo_contribuyente}|${pctRetStr}`;
    const prevGrp = resumenConceptosMap.get(groupKey) || {
      codigo_concepto: codConcepto,
      descripcion_concepto: conceptoCatalogo?.descripcion || row.descripcion_concepto || 'Concepto ISLR',
      tipo_contribuyente: resolucion.tipo_contribuyente,
      porcentaje: pctRetStr,
      cantidad: 0,
      monto_operacion: 0,
      impuesto_retenido: 0
    };
    prevGrp.cantidad += 1;
    prevGrp.monto_operacion = Number((prevGrp.monto_operacion + montoOperacionNum).toFixed(2));
    prevGrp.impuesto_retenido = Number((prevGrp.impuesto_retenido + impuestoRetenido).toFixed(2));
    resumenConceptosMap.set(groupKey, prevGrp);

    detallesPreview.push({
      retencion_id: row.retencion_id || row.id,
      detalle_id: row.detalle_id,
      nro_comprobante: row.nro_comprobante,
      sujeto_razon_social: row.sujeto_razon_social,
      sujeto_rif: row.sujeto_rif,
      rif_xml: cleanRifRetenido,
      tipo_contribuyente: resolucion.tipo_contribuyente,
      tipo_servicio: resolucion.tipo_servicio,
      tipo_servicio_label: ETIQUETAS_TIPO_SERVICIO[resolucion.tipo_servicio] || resolucion.tipo_servicio,
      nro_factura_original: row.nro_factura,
      nro_factura_xml: cleanFactura,
      nro_control_original: row.nro_control,
      nro_control_xml: cleanControl,
      fecha_operacion: fechaOp,
      codigo_concepto: codConcepto,
      descripcion_codigo: conceptoCatalogo?.descripcion || row.descripcion_concepto || '',
      codigo_sugerido: resolucion.codigo_sugerido,
      pct_tarifa_sugerido: resolucion.concepto_sugerido.pct_tarifa,
      monto_operacion: montoOperacionNum,
      monto_operacion_xml: montoOpStr,
      porcentaje_retencion: pctTarifa,
      porcentaje_xml: pctRetStr,
      sustraendo_bs: Number(row.sustraendo_bs || 0),
      impuesto_retenido_bs: impuestoRetenido,
      xsd_valido: lineErrors.length === 0,
      legal_consistente: lineWarnings.length === 0,
      errores: lineErrors,
      advertencias: lineWarnings
    });
  }

  xmlLines.push(`</RelacionRetencionesISLR>`);

  return {
    xml: xmlLines.join('\n'),
    yyyymm,
    rif_agente: cleanAgenteRif,
    total_lineas: detallesPreview.length,
    total_monto_operacion: Number(totalMontoOperacion.toFixed(2)),
    total_islr_retenido: Number(totalRetenidoBs.toFixed(2)),
    xsd_valido: erroresValidacion.length === 0 && detallesPreview.length > 0,
    errores_validacion: erroresValidacion,
    advertencias,
    resumen_conceptos: Array.from(resumenConceptosMap.values()),
    detalles: detallesPreview,
    ut_bs: utBs,
    factor_sustraendo: factorSustraendo
  };
}

/**
 * Consulta la base de datos y construye la previsualización completa + XML SENIAT para un período.
 */
export async function obtenerDatosXmlISLR(db, periodo) {
  const targetPeriodo = periodo && periodo !== 'TODOS' ? periodo : '2026-10';

  const [cfgRes, itemsRes, pendientesRes] = await Promise.all([
    db.execute("SELECT * FROM config_fiscal_islr WHERE id = 1"),
    db.execute({
      sql: `
        SELECT 
          r.id as retencion_id,
          r.nro_comprobante,
          r.periodo,
          r.fecha_emision,
          r.sujeto_rif,
          r.sujeto_razon_social,
          r.sujeto_tipo_persona,
          d.id as detalle_id,
          d.libro_compra_id,
          d.nro_operacion,
          d.fecha_factura,
          d.nro_factura,
          d.nro_control,
          d.codigo_concepto,
          d.descripcion_concepto,
          d.monto_total_bs,
          d.base_imponible_bs,
          d.pct_base,
          d.pct_tarifa,
          d.sustraendo_bs,
          d.impuesto_retenido_bs,
          lc.tipo_servicio as lc_tipo_servicio,
          (SELECT p.tipo_servicio FROM proveedores p WHERE UPPER(REPLACE(REPLACE(p.rif, '-', ''), ' ', '')) = UPPER(REPLACE(REPLACE(r.sujeto_rif, '-', ''), ' ', '')) ORDER BY p.id ASC LIMIT 1) as prov_tipo_servicio,
          (SELECT p.tipo_persona FROM proveedores p WHERE UPPER(REPLACE(REPLACE(p.rif, '-', ''), ' ', '')) = UPPER(REPLACE(REPLACE(r.sujeto_rif, '-', ''), ' ', '')) ORDER BY p.id ASC LIMIT 1) as prov_tipo_persona,
          (SELECT p.codigo_concepto_islr FROM proveedores p WHERE UPPER(REPLACE(REPLACE(p.rif, '-', ''), ' ', '')) = UPPER(REPLACE(REPLACE(r.sujeto_rif, '-', ''), ' ', '')) ORDER BY p.id ASC LIMIT 1) as prov_codigo_concepto
        FROM retenciones_islr r
        JOIN retenciones_islr_detalles d ON r.id = d.retencion_id
        LEFT JOIN libro_compras lc ON d.libro_compra_id = lc.id
        WHERE r.periodo = ? AND COALESCE(r.estatus, 'EMITIDO') != 'ANULADO'
        ORDER BY r.nro_comprobante ASC, d.nro_operacion ASC
      `,
      args: [targetPeriodo]
    }),
    db.execute({
      sql: `
        SELECT 
          lc.id, lc.periodo, lc.fecha, lc.rif, lc.razon_social, lc.nro_factura, lc.nro_control,
          lc.tipo_servicio, lc.aplica_inventario, lc.base_imponible_bs, lc.iva_bs, lc.total_bs,
          p.tipo_persona as prov_tipo_persona, p.codigo_concepto_islr
        FROM libro_compras lc
        LEFT JOIN proveedores p ON UPPER(REPLACE(REPLACE(p.rif, '-', ''), ' ', '')) = UPPER(REPLACE(REPLACE(lc.rif, '-', ''), ' ', ''))
        WHERE lc.periodo = ?
          AND lc.aplica_inventario = 0
          AND NOT EXISTS (
            SELECT 1 FROM retenciones_islr_detalles rid
            WHERE rid.libro_compra_id = lc.id
               OR (UPPER(TRIM(rid.nro_factura)) = UPPER(TRIM(lc.nro_factura))
                   AND EXISTS (SELECT 1 FROM retenciones_islr ri WHERE ri.id = rid.retencion_id AND UPPER(REPLACE(ri.sujeto_rif, '-', '')) = UPPER(REPLACE(lc.rif, '-', ''))))
          )
        ORDER BY lc.fecha ASC, lc.id ASC
      `,
      args: [targetPeriodo]
    }).catch(() => ({ rows: [] }))
  ]);

  const cfg = cfgRes.rows[0] || {
    agente_rif: 'J-50700865-7',
    agente_razon_social: 'INVERSIONES DG 67, C.A.',
    valor_ut_bs: 43.0,
    factor_sustraendo: 83.3334
  };

  const buildRes = buildXmlRelacionRetencionesISLR({
    agenteRif: cfg.agente_rif || 'J-50700865-7',
    periodo: targetPeriodo,
    rows: itemsRes.rows || [],
    utBs: Number(cfg.valor_ut_bs || 43.0),
    factorSustraendo: Number(cfg.factor_sustraendo || 83.3334)
  });

  const pendientes = (pendientesRes.rows || []).map(f => {
    const resConc = resolverConceptoISLR({
      tipoServicio: f.tipo_servicio,
      rif: f.rif,
      tipoPersona: f.prov_tipo_persona
    });
    return {
      ...f,
      tipo_contribuyente_sugerido: resConc.tipo_contribuyente,
      codigo_sugerido: resConc.codigo_sugerido,
      tarifa_sugerida: resConc.concepto_sugerido.pct_tarifa,
      descripcion_sugerida: resConc.concepto_sugerido.descripcion
    };
  });

  return {
    periodo: targetPeriodo,
    agente_razon_social: cfg.agente_razon_social || 'INVERSIONES DG 67, C.A.',
    agente_rif: cfg.agente_rif || 'J-50700865-7',
    ...buildRes,
    facturas_sin_retencion: pendientes
  };
}

/**
 * Adecua automáticamente las líneas de retención ISLR de un período abierto según el Tipo de Servicio
 * y Tipo de Contribuyente bajo el Decreto 1.808, manteniendo invariable el N° de Comprobante (14 dígitos).
 */
export async function adecuarCodigosRetencionesPeriodo(db, periodo) {
  const preview = await obtenerDatosXmlISLR(db, periodo);
  const utBs = Number(preview.ut_bs || 43.0);
  const factorSust = Number(preview.factor_sustraendo || 83.3334);
  const thresholdSust = utBs * factorSust;

  const updatesByRetId = new Map();
  let actualizadas = 0;

  for (const det of preview.detalles) {
    const comp = getConceptoByCodigo(det.codigo_sugerido);
    if (!comp) continue;

    // Adecuar si difiere el código sugerido o el porcentaje/base respecto a lo almacenado
    if (
      det.codigo_concepto !== det.codigo_sugerido ||
      Math.abs(det.porcentaje_retencion - comp.pct_tarifa) > 0.01 ||
      !det.legal_consistente
    ) {
      // Recalcular impuesto según regla legal oficial
      const detRowRes = await db.execute({
        sql: "SELECT base_imponible_bs, monto_total_bs FROM retenciones_islr_detalles WHERE id = ?",
        args: [det.detalle_id]
      });
      const baseImp = Number(detRowRes.rows[0]?.base_imponible_bs || det.monto_operacion || 0);
      const pctBase = Number(comp.pct_base || 100);
      const pctTarifa = Number(comp.pct_tarifa || 2);

      let sustraendo = 0.0;
      if (comp.tipo_persona === 'PN-R' && comp.aplica_sustraendo === 1 && baseImp > thresholdSust) {
        sustraendo = Number((thresholdSust * (pctTarifa / 100)).toFixed(2));
      }
      const baseObj = baseImp * (pctBase / 100);
      const impRet = Math.max(0, Number(((baseObj * (pctTarifa / 100)) - sustraendo).toFixed(2)));

      await db.execute({
        sql: `UPDATE retenciones_islr_detalles
              SET codigo_concepto = ?, pct_base = ?, pct_tarifa = ?, sustraendo_bs = ?, impuesto_retenido_bs = ?
              WHERE id = ?`,
        args: [comp.codigo, pctBase, pctTarifa, sustraendo, impRet, det.detalle_id]
      });

      actualizadas++;
      updatesByRetId.set(det.retencion_id, {
        codigoPrincipal: comp.codigo,
        tipoPersona: det.tipo_contribuyente
      });
    }
  }

  for (const [retId, meta] of updatesByRetId.entries()) {
    const sums = await db.execute({
      sql: `SELECT COALESCE(SUM(monto_total_bs), 0) as doc,
                   COALESCE(SUM(base_imponible_bs), 0) as base,
                   COALESCE(SUM(sustraendo_bs), 0) as sust,
                   COALESCE(SUM(impuesto_retenido_bs), 0) as ret
            FROM retenciones_islr_detalles WHERE retencion_id = ?`,
      args: [retId]
    });
    const s = sums.rows[0] || {};
    const totalPagar = Number((Number(s.doc || 0) - Number(s.ret || 0)).toFixed(2));

    await db.execute({
      sql: `UPDATE retenciones_islr
            SET sujeto_tipo_persona = ?,
                codigo_concepto_principal = ?,
                total_documento_bs = ?,
                total_base_imponible_bs = ?,
                total_sustraendo_bs = ?,
                total_islr_retenido_bs = ?,
                total_a_pagar_bs = ?
            WHERE id = ?`,
      args: [
        meta.tipoPersona,
        meta.codigoPrincipal,
        Number(Number(s.doc || 0).toFixed(2)),
        Number(Number(s.base || 0).toFixed(2)),
        Number(Number(s.sust || 0).toFixed(2)),
        Number(Number(s.ret || 0).toFixed(2)),
        totalPagar,
        retId
      ]
    });
  }

  return { actualizadas, previewActualizado: await obtenerDatosXmlISLR(db, periodo) };
}

