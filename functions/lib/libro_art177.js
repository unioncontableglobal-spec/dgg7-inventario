// ==============================================================================
// MOTOR DE CORTE MENSUAL, CONSOLIDADO ANUAL (ENE-DIC) Y LIBRO OFICIAL ART. 177 RISLR
// Compartido entre Cloudflare Pages Functions (producción) y server.js (local)
// Método: Costo Promedio Ponderado Móvil (CPP) en Bolívares (VES) y Dólares ($ USD)
// ==============================================================================

const NOMBRES_MESES_2026 = {
  '2025-12': 'Diciembre 2025 (Inventario Inicial)',
  '2026-01': '01 - Enero 2026',
  '2026-02': '02 - Febrero 2026',
  '2026-03': '03 - Marzo 2026',
  '2026-04': '04 - Abril 2026',
  '2026-05': '05 - Mayo 2026',
  '2026-06': '06 - Junio 2026',
  '2026-07': '07 - Julio 2026',
  '2026-08': '08 - Agosto 2026',
  '2026-09': '09 - Septiembre 2026',
  '2026-10': '10 - Octubre 2026',
  '2026-11': '11 - Noviembre 2026',
  '2026-12': '12 - Diciembre 2026'
};

const PERIODOS_2026_SERIE = [
  '2025-12',
  '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
  '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'
];

/**
 * Determina si un movimiento suma al inventario (Entrada) o resta (Salida).
 * Coincide 100% con la regla de vista_inventario_actual.
 */
export function esMovimientoEntrada(tipo, subtipo) {
  const t = String(tipo || '').toUpperCase();
  const sub = String(subtipo || '').toUpperCase();
  if (t === 'INVENTARIO_INICIAL' || t === 'ENTRADA_COMPRA' || t === 'ENTRADA_AJUSTE') {
    return true;
  }
  if (t === 'AJUSTE') {
    if (sub.includes('NEGATIVO') || sub.includes('SALIDA') || sub.includes('MERMA') || sub.includes('DANO') || sub.includes('DAÑO') || sub.includes('FALTANTE') || sub.includes('OBSOLESCENCIA') || sub.includes('AUTOCONSUMO') || sub === 'AJUSTE_INVENTARIO') {
      return false;
    }
    return sub.includes('POSITIVO') || sub.includes('ENTRADA') || sub.includes('SOBRANTE') || sub.includes('OMISION') || sub.includes('RECLASIF') || sub.includes('SINCERACION');
  }
  return false;
}

function getLastDayOfMonth(periodo) {
  if (periodo === '2025-12') return '2025-12-31';
  const [y, m] = String(periodo).split('-').map(Number);
  if (!y || !m) return `${periodo}-28`;
  const lastDay = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

function r2(n) {
  return Number((Number(n || 0)).toFixed(2));
}

/**
 * Calcula el Libro Oficial de Inventarios Art. 177 RISLR y la evolución mes a mes
 * consolidada (Diciembre 2025 + Enero a Diciembre 2026) usando CPP móvil cronológico.
 */
export async function computeLibroInventarioArt177(db, {
  periodo = 'ANUAL_2026',
  desde = '',
  hasta = '',
  almacen = 'TODOS',
  categoria = 'TODAS'
} = {}) {
  let fechaInicio = '2026-01-01';
  let fechaFin = '2026-12-31';

  if (desde && hasta) {
    fechaInicio = String(desde).slice(0, 10);
    fechaFin = String(hasta).slice(0, 10);
  } else if (periodo === '2025-12') {
    fechaInicio = '2025-12-31';
    fechaFin = '2025-12-31';
  } else if (/^\d{4}-\d{2}$/.test(String(periodo))) {
    fechaInicio = `${periodo}-01`;
    fechaFin = getLastDayOfMonth(periodo);
  }

  const prodArgs = [];
  let prodSql = `
    SELECT 
      p.id AS producto_id,
      p.codigo,
      p.descripcion,
      p.unidad_medida,
      COALESCE(c.nombre, 'GENERAL') AS categoria,
      COALESCE(a.nombre, 'PRINCIPAL') AS almacen,
      p.stock_minimo,
      p.costo_referencial_usd,
      p.precio_venta_usd,
      p.conteo_fisico_cierre,
      p.fecha_conteo_fisico,
      p.observacion_auditoria
    FROM productos p
    LEFT JOIN categorias c ON p.categoria_id = c.id
    LEFT JOIN almacenes a ON p.almacen_id = a.id
    WHERE 1=1
  `;
  if (categoria && categoria !== 'TODAS') {
    prodSql += ` AND COALESCE(c.nombre, 'GENERAL') = ?`;
    prodArgs.push(categoria);
  }
  if (almacen && almacen !== 'TODOS') {
    prodSql += ` AND COALESCE(a.nombre, 'PRINCIPAL') = ?`;
    prodArgs.push(almacen);
  }
  prodSql += ` ORDER BY p.codigo ASC`;

  const maxFechaConsulta = fechaFin > '2026-12-31' ? fechaFin : '2026-12-31';
  const movsSql = `
    SELECT 
      md.producto_id,
      md.cantidad,
      COALESCE(NULLIF(md.costo_unitario_divisa, 0), md.costo_unitario_usd) AS costo_unitario_usd,
      COALESCE(NULLIF(md.costo_unitario_bs, 0), md.costo_unitario_ves) AS costo_unitario_ves,
      m.id AS movimiento_id,
      m.fecha,
      m.tipo,
      COALESCE(m.subtipo, CASE WHEN m.tipo='SALIDA_VENTA' THEN 'VENTA' WHEN m.tipo='ENTRADA_COMPRA' THEN 'COMPRA_NACIONAL' ELSE m.tipo END) AS subtipo,
      m.numero_documento,
      m.nro_control,
      m.usuario_responsable,
      COALESCE(NULLIF(md.tasa_bcv_operacion, 0), m.tasa_bcv, 68.50) AS tasa_bcv
    FROM movimiento_detalles md
    JOIN movimientos m ON md.movimiento_id = m.id
    WHERE m.fecha <= ?
    ORDER BY m.fecha ASC, m.id ASC
  `;

  const [prodsRes, movsRes, tasasRes, cfgRes] = await Promise.all([
    db.execute({ sql: prodSql, args: prodArgs }),
    db.execute({ sql: movsSql, args: [maxFechaConsulta] }),
    db.execute("SELECT periodo, tasa_bcv, fecha_cierre, moneda FROM tasas_bcv_periodo ORDER BY periodo ASC").catch(() => ({ rows: [] })),
    db.execute("SELECT tasa_bcv_activa_dia, fecha_bcv_activa_dia FROM config_fiscal_islr WHERE id = 1").catch(() => ({ rows: [] }))
  ]);

  const tasasMap = {};
  let latestTasa = Number(cfgRes.rows[0]?.tasa_bcv_activa_dia || 889.58);
  for (const t of (tasasRes.rows || [])) {
    const tVal = Number(t.tasa_bcv || latestTasa);
    tasasMap[t.periodo] = {
      tasa_bcv: tVal,
      fecha_cierre: t.fecha_cierre || getLastDayOfMonth(t.periodo),
      moneda: t.moneda || 'USD'
    };
    if (tVal > 0) latestTasa = tVal;
  }

  const tasaInicial2025 = tasasMap['2025-12']?.tasa_bcv || 298.1431;
  const targetPeriodoCorte = /^\d{4}-\d{2}$/.test(String(periodo))
    ? periodo
    : String(fechaFin).slice(0, 7);
  const tasaBcvCorte = tasasMap[targetPeriodoCorte]?.tasa_bcv || latestTasa;

  const prodSet = new Set(prodsRes.rows.map(p => Number(p.producto_id)));
  const movsByProd = new Map();
  for (const m of movsRes.rows) {
    const pid = Number(m.producto_id);
    if (!prodSet.has(pid)) continue;
    if (!movsByProd.has(pid)) movsByProd.set(pid, []);
    movsByProd.get(pid).push(m);
  }

  // Inicializar cubetas mensuales consolidadas (2025-12 + 2026-01 .. 2026-12)
  const monthlyAcc = new Map();
  for (const per of PERIODOS_2026_SERIE) {
    const tRate = tasasMap[per]?.tasa_bcv || latestTasa;
    monthlyAcc.set(per, {
      periodo: per,
      nombre: NOMBRES_MESES_2026[per] || per,
      fecha_inicio: per === '2025-12' ? '2025-12-31' : `${per}-01`,
      fecha_corte: getLastDayOfMonth(per),
      tasa_bcv: tRate,
      fecha_tasa_bcv: tasasMap[per]?.fecha_cierre || getLastDayOfMonth(per),
      saldo_inicial_und: 0,
      saldo_inicial_ves: 0,
      saldo_inicial_usd: 0,
      entradas_inicial_und: 0,
      entradas_und: 0,
      ent_compras_und: 0,
      ent_ajustes_und: 0,
      entradas_ves: 0,
      entradas_usd: 0,
      salidas_und: 0,
      sal_ventas_und: 0,
      sal_otros_und: 0,
      salidas_ves: 0,
      salidas_usd: 0,
      saldo_final_und: 0,
      saldo_final_ves: 0,
      saldo_final_usd: 0,
      docs_entradas_ids: new Set(),
      docs_salidas_ids: new Set(),
      docs_ajustes_ids: new Set(),
      docs_totales_ids: new Set()
    });
  }

  const isCorteInicial2025 = (fechaInicio === '2025-12-31' && fechaFin === '2025-12-31');

  const items = prodsRes.rows.map(p => {
    const pid = Number(p.producto_id);
    const refUsd = Number(p.costo_referencial_usd || 0);
    const prodMovs = movsByProd.get(pid) || [];

    // 1. Calcular el período exacto [fechaInicio, fechaFin] para el artículo
    let stockActual = 0;
    let cppUsd = refUsd;
    let cppVes = Number((refUsd * tasaInicial2025).toFixed(2));
    let valTotalUsd = 0;
    let valTotalVes = 0;

    let cantInicial = 0, montoInicialUsd = 0, montoInicialVes = 0;
    let snapshotInicialTomado = false;

    let cantEntradas = 0, montoEntradasUsd = 0, montoEntradasVes = 0;
    let entComprasUnd = 0, entAjustesUnd = 0;
    let cantSalidas = 0, montoSalidasUsd = 0, montoSalidasVes = 0;

    let salVentaUnd = 0, salVentaVes = 0, salVentaUsd = 0;
    let salAutoconsumoUnd = 0, salAutoconsumoVes = 0;
    let salRetiroUnd = 0, salRetiroVes = 0;
    let salMuestraUnd = 0, salMuestraVes = 0;
    let salMermaUnd = 0, salMermaVes = 0;
    let salAjusteUnd = 0, salAjusteVes = 0;

    // Tracking paralelo mes a mes para el consolidado (2025-12 .. 2026-12)
    let mStock = 0;
    let mCppUsd = refUsd;
    let mCppVes = Number((refUsd * tasaInicial2025).toFixed(2));
    let mValUsd = 0;
    let mValVes = 0;
    let movIdx = 0;

    for (const per of PERIODOS_2026_SERIE) {
      const bucket = monthlyAcc.get(per);
      const endPer = bucket.fecha_corte;
      const isPerInicial = (per === '2025-12');

      if (!isPerInicial) {
        bucket.saldo_inicial_und += mStock;
        bucket.saldo_inicial_ves += mValVes;
        bucket.saldo_inicial_usd += mValUsd;
      }

      while (movIdx < prodMovs.length && String(prodMovs[movIdx].fecha) <= endPer) {
        const m = prodMovs[movIdx++];
        const qty = Number(m.cantidad || 0);
        const mPer = String(m.fecha || '').slice(0, 7);
        const tasa = Number(m.tasa_bcv || tasasMap[mPer]?.tasa_bcv || latestTasa);
        const unitUsd = Number(m.costo_unitario_usd || 0) > 0
          ? Number(m.costo_unitario_usd)
          : (mCppUsd > 0 ? mCppUsd : refUsd);
        const unitVes = Number(m.costo_unitario_ves || 0) > 0
          ? Number(m.costo_unitario_ves)
          : Number((unitUsd * tasa).toFixed(2));

        const sub = String(m.subtipo || '').toUpperCase();
        const isEnt = esMovimientoEntrada(m.tipo, m.subtipo);

        bucket.docs_totales_ids.add(m.movimiento_id);

        if (isEnt) {
          const entUsd = qty * unitUsd;
          const entVes = qty * unitVes;
          const nuevoStock = mStock + qty;
          if (mStock > 0 && nuevoStock > 0) {
            mCppUsd = (mValUsd + entUsd) / nuevoStock;
            mCppVes = (mValVes + entVes) / nuevoStock;
          } else {
            mCppUsd = unitUsd > 0 ? unitUsd : mCppUsd;
            mCppVes = unitVes > 0 ? unitVes : mCppVes;
          }
          mStock = nuevoStock;
          mValUsd = mStock * mCppUsd;
          mValVes = mStock * mCppVes;

          if (isPerInicial && m.tipo === 'INVENTARIO_INICIAL') {
            bucket.entradas_inicial_und += qty;
            bucket.saldo_inicial_und += qty;
            bucket.saldo_inicial_ves += entVes;
            bucket.saldo_inicial_usd += entUsd;
          } else {
            bucket.entradas_und += qty;
            bucket.entradas_ves += entVes;
            bucket.entradas_usd += entUsd;
            if (m.tipo === 'ENTRADA_COMPRA') {
              bucket.ent_compras_und += qty;
              bucket.docs_entradas_ids.add(m.movimiento_id);
            } else {
              bucket.ent_ajustes_und += qty;
              bucket.docs_ajustes_ids.add(m.movimiento_id);
            }
          }
        } else {
          const salUsd = qty * mCppUsd;
          const salVes = qty * mCppVes;
          mStock = mStock - qty;
          mValUsd = mStock * mCppUsd;
          mValVes = mStock * mCppVes;

          bucket.salidas_und += qty;
          bucket.salidas_ves += salVes;
          bucket.salidas_usd += salUsd;
          if (m.tipo === 'SALIDA_VENTA') {
            bucket.sal_ventas_und += qty;
            bucket.docs_salidas_ids.add(m.movimiento_id);
          } else {
            bucket.sal_otros_und += qty;
            bucket.docs_ajustes_ids.add(m.movimiento_id);
          }
        }
      }

      bucket.saldo_final_und += mStock;
      bucket.saldo_final_ves += mValVes;
      bucket.saldo_final_usd += mValUsd;
    }

    // 2. Calcular desglose exacto del rango/período consultado [fechaInicio, fechaFin]
    for (const m of prodMovs) {
      if (String(m.fecha) > fechaFin) break;

      const qty = Number(m.cantidad || 0);
      const mPer = String(m.fecha || '').slice(0, 7);
      const tasa = Number(m.tasa_bcv || tasasMap[mPer]?.tasa_bcv || latestTasa);
      const unitUsd = Number(m.costo_unitario_usd || 0) > 0
        ? Number(m.costo_unitario_usd)
        : (cppUsd > 0 ? cppUsd : refUsd);
      const unitVes = Number(m.costo_unitario_ves || 0) > 0
        ? Number(m.costo_unitario_ves)
        : Number((unitUsd * tasa).toFixed(2));

      const esAntesDelPeriodo = isCorteInicial2025 ? false : (String(m.fecha) < fechaInicio);

      if (!esAntesDelPeriodo && !snapshotInicialTomado) {
        if (isCorteInicial2025) {
          cantInicial = 0;
          montoInicialUsd = 0;
          montoInicialVes = 0;
        } else {
          cantInicial = r2(stockActual);
          montoInicialUsd = r2(valTotalUsd);
          montoInicialVes = r2(valTotalVes);
        }
        snapshotInicialTomado = true;
      }

      const sub = String(m.subtipo || '').toUpperCase();
      const isEntrada = esMovimientoEntrada(m.tipo, m.subtipo);

      if (isEntrada) {
        const entradaUsd = qty * unitUsd;
        const entradaVes = qty * unitVes;
        const nuevoStock = stockActual + qty;
        if (stockActual > 0 && nuevoStock > 0) {
          cppUsd = (valTotalUsd + entradaUsd) / nuevoStock;
          cppVes = (valTotalVes + entradaVes) / nuevoStock;
        } else {
          cppUsd = unitUsd > 0 ? unitUsd : cppUsd;
          cppVes = unitVes > 0 ? unitVes : cppVes;
        }
        stockActual = nuevoStock;
        valTotalUsd = stockActual * cppUsd;
        valTotalVes = stockActual * cppVes;

        if (!esAntesDelPeriodo) {
          if (m.tipo === 'INVENTARIO_INICIAL') {
            cantInicial += qty;
            montoInicialUsd += entradaUsd;
            montoInicialVes += entradaVes;
          } else {
            cantEntradas += qty;
            montoEntradasUsd += entradaUsd;
            montoEntradasVes += entradaVes;
            if (m.tipo === 'ENTRADA_COMPRA') entComprasUnd += qty;
            else entAjustesUnd += qty;
          }
        }
      } else {
        const costoSalidaUsd = qty * cppUsd;
        const costoSalidaVes = qty * cppVes;
        stockActual = stockActual - qty;
        valTotalUsd = stockActual * cppUsd;
        valTotalVes = stockActual * cppVes;

        if (!esAntesDelPeriodo) {
          cantSalidas += qty;
          montoSalidasUsd += costoSalidaUsd;
          montoSalidasVes += costoSalidaVes;

          if (sub.includes('AUTOCONSUMO')) {
            salAutoconsumoUnd += qty; salAutoconsumoVes += costoSalidaVes;
          } else if (sub.includes('RETIRO')) {
            salRetiroUnd += qty; salRetiroVes += costoSalidaVes;
          } else if (sub.includes('MUESTRA')) {
            salMuestraUnd += qty; salMuestraVes += costoSalidaVes;
          } else if (sub.includes('MERMA') || sub.includes('DANO') || sub.includes('DAÑO') || sub.includes('OBSOLESCENCIA')) {
            salMermaUnd += qty; salMermaVes += costoSalidaVes;
          } else if (m.tipo === 'AJUSTE' || m.tipo === 'SALIDA_AJUSTE' || sub.includes('AJUSTE') || sub.includes('FALTANTE') || sub.includes('CORRECCION')) {
            salAjusteUnd += qty; salAjusteVes += costoSalidaVes;
          } else {
            salVentaUnd += qty; salVentaVes += costoSalidaVes; salVentaUsd += costoSalidaUsd;
          }
        }
      }
    }

    if (!snapshotInicialTomado && !isCorteInicial2025) {
      cantInicial = r2(stockActual);
      montoInicialUsd = r2(valTotalUsd);
      montoInicialVes = r2(valTotalVes);
    }

    const cantFinal = r2(stockActual);
    const montoFinalUsd = r2(valTotalUsd);
    const montoFinalVes = r2(valTotalVes);

    const conteoFisico = (p.conteo_fisico_cierre !== null && p.conteo_fisico_cierre !== undefined)
      ? Number(p.conteo_fisico_cierre)
      : cantFinal;
    const diferenciaUnidades = r2(conteoFisico - cantFinal);
    const diferenciaVes = r2(diferenciaUnidades * cppVes);
    const diferenciaUsd = r2(diferenciaUnidades * cppUsd);

    return {
      producto_id: pid,
      codigo: p.codigo,
      descripcion: p.descripcion,
      unidad_medida: p.unidad_medida || 'UND',
      categoria: p.categoria,
      almacen: p.almacen,
      stock_minimo: Number(p.stock_minimo || 0),
      costo_referencial_usd: refUsd,
      precio_venta_usd: Number(p.precio_venta_usd || 0),
      costo_unitario_usd: r2(cppUsd),
      costo_promedio_ves: r2(cppVes),
      cant_inicial: r2(cantInicial),
      monto_inicial_usd: r2(montoInicialUsd),
      monto_inicial_ves: r2(montoInicialVes),
      cant_entradas: r2(cantEntradas),
      ent_compras_und: r2(entComprasUnd),
      ent_ajustes_und: r2(entAjustesUnd),
      monto_entradas_usd: r2(montoEntradasUsd),
      monto_entradas_ves: r2(montoEntradasVes),
      cant_salidas: r2(cantSalidas),
      monto_salidas_usd: r2(montoSalidasUsd),
      monto_salidas_ves: r2(montoSalidasVes),
      sal_venta_und: r2(salVentaUnd),
      sal_venta_ves: r2(salVentaVes),
      sal_venta_usd: r2(salVentaUsd),
      sal_autoconsumo_und: r2(salAutoconsumoUnd),
      sal_autoconsumo_ves: r2(salAutoconsumoVes),
      sal_retiro_und: r2(salRetiroUnd),
      sal_retiro_ves: r2(salRetiroVes),
      sal_muestra_und: r2(salMuestraUnd),
      sal_muestra_ves: r2(salMuestraVes),
      sal_merma_und: r2(salMermaUnd),
      sal_merma_ves: r2(salMermaVes),
      sal_ajuste_und: r2(salAjusteUnd),
      sal_ajuste_ves: r2(salAjusteVes),
      cant_final: cantFinal,
      monto_final_usd: montoFinalUsd,
      monto_final_ves: montoFinalVes,
      conteo_fisico: conteoFisico,
      valor_fisico_ves: r2(conteoFisico * cppVes),
      valor_fisico_usd: r2(conteoFisico * cppUsd),
      diferencia_unidades: diferenciaUnidades,
      diferencia_ves: diferenciaVes,
      diferencia_usd: diferenciaUsd,
      observacion_auditoria: p.observacion_auditoria || ''
    };
  });

  // Consolidado mensual (Enero a Diciembre 2026 + Diciembre 2025 Inicial)
  const resumenMensual = PERIODOS_2026_SERIE.map(per => {
    const b = monthlyAcc.get(per);
    return {
      periodo: b.periodo,
      nombre: b.nombre,
      fecha_inicio: b.fecha_inicio,
      fecha_corte: b.fecha_corte,
      tasa_bcv: b.tasa_bcv,
      fecha_tasa_bcv: b.fecha_tasa_bcv,
      saldo_inicial_und: r2(b.saldo_inicial_und),
      saldo_inicial_ves: r2(b.saldo_inicial_ves),
      saldo_inicial_usd: r2(b.saldo_inicial_usd),
      entradas_inicial_und: r2(b.entradas_inicial_und),
      entradas_und: r2(b.entradas_und),
      ent_compras_und: r2(b.ent_compras_und),
      ent_ajustes_und: r2(b.ent_ajustes_und),
      entradas_ves: r2(b.entradas_ves),
      entradas_usd: r2(b.entradas_usd),
      salidas_und: r2(b.salidas_und),
      sal_ventas_und: r2(b.sal_ventas_und),
      sal_otros_und: r2(b.sal_otros_und),
      salidas_ves: r2(b.salidas_ves),
      salidas_usd: r2(b.salidas_usd),
      saldo_final_und: r2(b.saldo_final_und),
      saldo_final_ves: r2(b.saldo_final_ves),
      saldo_final_usd: r2(b.saldo_final_usd),
      docs_entradas: b.docs_entradas_ids.size,
      docs_salidas: b.docs_salidas_ids.size,
      docs_ajustes: b.docs_ajustes_ids.size,
      total_docs: b.docs_totales_ids.size
    };
  });

  const totales = items.reduce((acc, it) => {
    acc.cant_inicial += it.cant_inicial;
    acc.monto_inicial_ves += it.monto_inicial_ves;
    acc.monto_inicial_usd += it.monto_inicial_usd;
    acc.cant_entradas += it.cant_entradas;
    acc.ent_compras_und += it.ent_compras_und;
    acc.ent_ajustes_und += it.ent_ajustes_und;
    acc.monto_entradas_ves += it.monto_entradas_ves;
    acc.monto_entradas_usd += it.monto_entradas_usd;
    acc.cant_salidas += it.cant_salidas;
    acc.sal_venta_und += it.sal_venta_und;
    acc.monto_salidas_ves += it.monto_salidas_ves;
    acc.monto_salidas_usd += it.monto_salidas_usd;
    acc.cant_final += it.cant_final;
    acc.monto_final_ves += it.monto_final_ves;
    acc.monto_final_usd += it.monto_final_usd;
    return acc;
  }, {
    cant_inicial: 0, monto_inicial_ves: 0, monto_inicial_usd: 0,
    cant_entradas: 0, ent_compras_und: 0, ent_ajustes_und: 0, monto_entradas_ves: 0, monto_entradas_usd: 0,
    cant_salidas: 0, sal_venta_und: 0, monto_salidas_ves: 0, monto_salidas_usd: 0,
    cant_final: 0, monto_final_ves: 0, monto_final_usd: 0
  });

  for (const k of Object.keys(totales)) totales[k] = r2(totales[k]);

  const mapLabels = {
    'ANUAL_2026': 'Consolidado Ejercicio Fiscal 2026 (Enero a Diciembre)',
    'HISTORICO': 'Histórico Completo (Dic 2025 - Dic 2026)',
    ...NOMBRES_MESES_2026
  };

  const etiquetaPeriodo = (desde && hasta)
    ? `Rango Auditado: ${desde} al ${hasta}`
    : (mapLabels[periodo] || `Período Fiscal ${periodo}`);

  return {
    periodo,
    etiquetaPeriodo,
    fechaInicio,
    fechaFin,
    fechaCorte: fechaFin,
    tasaBcvCorte,
    metodoValoracion: 'COSTO PROMEDIO PONDERADO MÓVIL (ART. 177 RISLR)',
    totales,
    resumen_mensual: resumenMensual,
    items
  };
}

/**
 * Formatea los datos del consolidado mensual manteniendo retrocompatibilidad con /api/reportes/mes-a-mes.
 */
export async function getMesAMesCompat(db) {
  const libro = await computeLibroInventarioArt177(db, { periodo: 'ANUAL_2026' });
  return libro.resumen_mensual.map(m => {
    const isIni = m.periodo === '2025-12';
    return {
      periodo: m.periodo,
      nombre: m.nombre,
      fechaCorte: m.fecha_corte,
      tasa_bcv_cierre: m.tasa_bcv,
      fecha_tasa_bcv: m.fecha_tasa_bcv,
      moneda: 'USD',
      saldoInicial: isIni ? 0 : m.saldo_inicial_und,
      saldo_inicial_ves: isIni ? 0 : m.saldo_inicial_ves,
      saldo_inicial_usd: isIni ? 0 : m.saldo_inicial_usd,
      entradasInicial: m.entradas_inicial_und,
      inicialUsd: m.saldo_inicial_usd,
      inicialBs: m.saldo_inicial_ves,
      compras: m.entradas_und,
      ent_compras_und: m.ent_compras_und,
      ent_ajustes_und: m.ent_ajustes_und,
      comprasUsd: isIni ? m.saldo_inicial_usd : m.entradas_usd,
      comprasBs: isIni ? m.saldo_inicial_ves : m.entradas_ves,
      ventas: m.salidas_und,
      sal_ventas_und: m.sal_ventas_und,
      sal_otros_und: m.sal_otros_und,
      salidasUsd: m.salidas_usd,
      salidasBs: m.salidas_ves,
      saldoFinal: m.saldo_final_und,
      saldo_final_ves: m.saldo_final_ves,
      saldo_final_usd: m.saldo_final_usd,
      totalDocs: m.total_docs,
      docs_entradas: m.docs_entradas,
      docs_salidas: m.docs_salidas,
      docs_ajustes: m.docs_ajustes
    };
  });
}

/**
 * Construye filas planas estandarizadas del Libro Art. 177 para CSV / Excel.
 */
export function mapItemsArt177ExportRows(items = []) {
  return items.map((it, idx) => ({
    "N°": idx + 1,
    "CÓDIGO": it.codigo,
    "DESCRIPCIÓN DEL REPUESTO / MERCANCÍA": it.descripcion,
    "UND": it.unidad_medida,
    "ALMACÉN": it.almacen,
    "CPP UNITARIO (BS)": it.costo_promedio_ves,
    "CPP UNITARIO ($)": it.costo_unitario_usd,
    "INV. INICIAL (UND)": it.cant_inicial,
    "INV. INICIAL (BS)": it.monto_inicial_ves,
    "INV. INICIAL ($)": it.monto_inicial_usd,
    "ENTRADAS COMPRAS (UND)": it.ent_compras_und,
    "ENTRADAS AJUSTES (UND)": it.ent_ajustes_und,
    "TOTAL ENTRADAS (UND)": it.cant_entradas,
    "TOTAL ENTRADAS (BS)": it.monto_entradas_ves,
    "TOTAL ENTRADAS ($)": it.monto_entradas_usd,
    "SALIDA VENTA (UND)": it.sal_venta_und,
    "SALIDA AUTOCONSUMO (UND)": it.sal_autoconsumo_und,
    "SALIDA RETIRO SOCIOS (UND)": it.sal_retiro_und,
    "SALIDA MUESTRA (UND)": it.sal_muestra_und,
    "SALIDA MERMA / DAÑO (UND)": it.sal_merma_und,
    "SALIDA AJUSTE (UND)": it.sal_ajuste_und,
    "TOTAL SALIDAS (UND)": it.cant_salidas,
    "COSTO SALIDAS (BS)": it.monto_salidas_ves,
    "COSTO SALIDAS ($)": it.monto_salidas_usd,
    "INV. FINAL CORTE (UND)": it.cant_final,
    "INV. FINAL CORTE (BS)": it.monto_final_ves,
    "INV. FINAL CORTE ($)": it.monto_final_usd,
    "TOMA FÍSICA CIERRE (UND)": it.conteo_fisico,
    "DIFERENCIA AUDITORÍA (UND)": it.diferencia_unidades,
    "AJUSTE CONTABLE CIERRE (BS)": it.diferencia_ves
  }));
}
