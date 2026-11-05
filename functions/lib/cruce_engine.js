/**
 * lib/cruce_engine.js
 * Motor de Conciliación de Doble Vía (Cruce de Información DG67 ↔ UCG)
 * Compatible con @libsql/client (SQLite local y Turso Cloud)
 */

export async function conciliarReporteZ(reporteZId, db) {
  const zRes = await db.execute({
    sql: "SELECT * FROM libro_ventas WHERE id = ?",
    args: [reporteZId]
  });
  if (zRes.rows.length === 0) return null;
  const z = zRes.rows[0];

  const desdeNum = z.factura_desde ? parseInt(String(z.factura_desde).replace(/\D/g, ''), 10) : null;
  const hastaNum = z.factura_hasta ? parseInt(String(z.factura_hasta).replace(/\D/g, ''), 10) : null;

  if (!desdeNum || !hastaNum || isNaN(desdeNum) || isNaN(hastaNum)) {
    return { z, estatus: z.estatus_conciliacion || 'REGISTRADO_FISCAL', faltantes: [] };
  }

  // Generar correlativo esperado
  const esperados = [];
  for (let n = desdeNum; n <= hastaNum; n++) {
    esperados.push(n);
  }

  // Buscar salidas cargadas por DG67 estrictamente para la fecha fiscal del Reporte Z
  const movsRes = await db.execute({
    sql: `SELECT m.id, m.numero_documento, m.numero_factura_numerico, m.fecha,
                 COALESCE(SUM(NULLIF(md.total_linea_bs, 0)), SUM(md.cantidad * md.precio_unitario_bs), 0) AS total_bs
          FROM movimientos m
          LEFT JOIN movimiento_detalles md ON m.id = md.movimiento_id
          WHERE m.tipo = 'SALIDA_VENTA' 
            AND m.fecha = ?
          GROUP BY m.id`,
    args: [z.fecha]
  });

  const cargadosNums = new Set();
  let totalCargadoBs = 0;
  const movIds = [];

  for (const m of movsRes.rows) {
    let num = m.numero_factura_numerico;
    if (!num && m.numero_documento) {
      const match = String(m.numero_documento).match(/(\d+)/);
      if (match) num = parseInt(match[1], 10);
    }

    if (num && num >= desdeNum && num <= hastaNum) {
      cargadosNums.add(num);
      totalCargadoBs += Number(m.total_bs) || 0;
      movIds.push(m.id);
    }
  }

  // Parsear facturas anuladas para excluirlas de faltantes
  const anuladasSet = new Set();
  if (z.facturas_anuladas_lista) {
    const anulNums = String(z.facturas_anuladas_lista).match(/\d+/g) || [];
    anulNums.forEach(n => anuladasSet.add(parseInt(n, 10)));
  }

  const faltantes = esperados.filter(num => !cargadosNums.has(num) && !anuladasSet.has(num));
  const diffBs = Number(((Number(z.total_bs) || 0) - totalCargadoBs).toFixed(2));

  let estatus = 'PENDIENTE_DG67';
  let obs = '';

  if (faltantes.length === 0) {
    if (Math.abs(diffBs) <= 2.00) {
      estatus = 'CONCILIADO';
      obs = `✅ Conciliación exitosa. Todas las ${esperados.length} facturas detalladas por DG67 cuadran con el Reporte Z.`;
    } else {
      estatus = 'DISCREPANCIA';
      obs = `⚠️ Rango completo de facturas pero existe una diferencia de Bs. ${diffBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}.`;
    }
  } else {
    estatus = 'PENDIENTE_DG67';
    obs = `⏳ Pendiente: DG67 ha cargado ${cargadosNums.size} facturas de ${esperados.length}. Faltan ${faltantes.length} facturas por detallar ítem por ítem.`;
  }

  const faltantesStr = faltantes.map(f => String(f).padStart(8, '0')).join(', ');

  // Actualizar libro_ventas
  await db.execute({
    sql: `UPDATE libro_ventas 
          SET estatus_conciliacion = ?,
              facturas_faltantes = ?,
              cantidad_facturas_cargadas = ?,
              total_facturas_cargadas_bs = ?,
              diferencia_bs = ?,
              observaciones_cruce = ?
          WHERE id = ?`,
    args: [estatus, faltantesStr, cargadosNums.size, totalCargadoBs, diffBs, obs, z.id]
  });

  // Desvincular cualquier movimiento previo que apuntara a este Reporte Z pero ya no corresponda a su fecha o rango
  if (movIds.length > 0) {
    const placeholders = movIds.map(() => '?').join(',');
    await db.execute({
      sql: `UPDATE movimientos SET libro_ventas_id = NULL, estatus_conciliacion = 'PENDIENTE_UCG' 
            WHERE libro_ventas_id = ? AND (fecha != ? OR id NOT IN (${placeholders}))`,
      args: [z.id, z.fecha, ...movIds]
    });
  } else {
    await db.execute({
      sql: `UPDATE movimientos SET libro_ventas_id = NULL, estatus_conciliacion = 'PENDIENTE_UCG' WHERE libro_ventas_id = ?`,
      args: [z.id]
    });
  }

  // Actualizar movimientos vinculados estrictamente a este Reporte Z
  if (movIds.length > 0) {
    const movEstatus = estatus === 'CONCILIADO' ? 'CONCILIADO' : 'PARCIAL';
    for (const id of movIds) {
      await db.execute({
        sql: "UPDATE movimientos SET libro_ventas_id = ?, estatus_conciliacion = ? WHERE id = ?",
        args: [z.id, movEstatus, id]
      });
    }
  }

  return {
    reporte_z_id: z.id,
    fecha: z.fecha,
    rango: `${z.factura_desde} ➔ ${z.factura_hasta}`,
    esperados_cant: esperados.length,
    cargados_cant: cargadosNums.size,
    faltantes_cant: faltantes.length,
    faltantes_lista: faltantes.map(f => String(f).padStart(8, '0')),
    total_z_bs: Number(z.total_bs) || 0,
    total_cargado_bs: totalCargadoBs,
    diferencia_bs: diffBs,
    estatus,
    observaciones: obs
  };
}

export async function conciliarTodosReportesZ(periodo, db) {
  let sql = "SELECT id FROM libro_ventas WHERE 1=1";
  const args = [];
  if (periodo && periodo !== 'TODOS') {
    sql += " AND periodo = ?";
    args.push(periodo);
  }
  sql += " ORDER BY fecha ASC, id ASC";

  const rows = await db.execute({ sql, args });
  const resultados = [];
  for (const r of rows.rows) {
    const res = await conciliarReporteZ(r.id, db);
    if (res) resultados.push(res);
  }
  return resultados;
}

export async function conciliarVentaIndividual(movimientoId, db) {
  const movRes = await db.execute({
    sql: "SELECT id, fecha, numero_documento, numero_factura_numerico FROM movimientos WHERE id = ? AND tipo = 'SALIDA_VENTA'",
    args: [movimientoId]
  });
  if (movRes.rows.length === 0) return null;
  const mov = movRes.rows[0];

  let num = mov.numero_factura_numerico;
  if (!num && mov.numero_documento) {
    const match = String(mov.numero_documento).match(/(\d+)/);
    if (match) {
      num = parseInt(match[1], 10);
      await db.execute({
        sql: "UPDATE movimientos SET numero_factura_numerico = ? WHERE id = ?",
        args: [num, mov.id]
      });
    }
  }

  // Buscar Reporte Z que cubra este número o fecha
  const zRes = await db.execute({
    sql: "SELECT id, factura_desde, factura_hasta, fecha FROM libro_ventas WHERE fecha = ? OR (factura_desde IS NOT NULL AND factura_hasta IS NOT NULL)",
    args: [mov.fecha]
  });

  let matchingZId = null;
  for (const z of zRes.rows) {
    const d = z.factura_desde ? parseInt(String(z.factura_desde).replace(/\D/g, ''), 10) : null;
    const h = z.factura_hasta ? parseInt(String(z.factura_hasta).replace(/\D/g, ''), 10) : null;
    if (d && h && num && num >= d && num <= h) {
      matchingZId = z.id;
      break;
    }
    if (z.fecha === mov.fecha) {
      matchingZId = z.id;
    }
  }

  if (matchingZId) {
    return await conciliarReporteZ(matchingZId, db);
  } else {
    await db.execute({
      sql: "UPDATE movimientos SET estatus_conciliacion = 'PENDIENTE_UCG' WHERE id = ?",
      args: [mov.id]
    });
    return { movimiento_id: mov.id, estatus: 'PENDIENTE_UCG', mensaje: 'Esperando Reporte Z de UCG' };
  }
}

export async function getResumenCruceDobleVia(periodo, db) {
  // 1. Reportes Z con estatus (Lectura directa optimizada de alta velocidad)
  let zSql = `
    SELECT 
      id, periodo, fecha, numero_reporte_z, serial_impresora, factura_desde, factura_hasta,
      cantidad_comprobantes, cantidad_anuladas, total_anulaciones_bs,
      base_imponible_bs, iva_bs, total_bs, total_divisa, tasa_bcv,
      estatus_conciliacion, facturas_faltantes, cantidad_facturas_cargadas,
      total_facturas_cargadas_bs, diferencia_bs, observaciones_cruce
    FROM libro_ventas
    WHERE 1=1
  `;
  const zArgs = [];
  if (periodo && periodo !== 'TODOS') {
    zSql += " AND periodo = ?";
    zArgs.push(periodo);
  }
  zSql += " ORDER BY fecha DESC, id DESC";
  const zRes = await db.execute({ sql: zSql, args: zArgs });

  // 2. Extraer lista desglosada de facturas pendientes por cargar por DG67
  const facturasPendientesDG67 = [];
  for (const z of zRes.rows) {
    if (z.facturas_faltantes && z.estatus_conciliacion === 'PENDIENTE_DG67') {
      const nums = z.facturas_faltantes.split(',').map(s => s.trim()).filter(Boolean);
      for (const num of nums) {
        facturasPendientesDG67.push({
          reporte_z_id: z.id,
          periodo: z.periodo,
          fecha: z.fecha,
          numero_reporte_z: z.numero_reporte_z || 'Z-' + z.id,
          serial_impresora: z.serial_impresora || 'Z0A0000176',
          factura_numero: num,
          tasa_bcv: z.tasa_bcv
        });
      }
    }
  }

  // 3. Salidas de DG67 huérfanas (sin Reporte Z o PENDIENTE_UCG)
  let movOrfSql = `
    SELECT 
      m.id, m.fecha, m.numero_documento, m.numero_factura_numerico, m.estatus_conciliacion, m.observaciones,
      COUNT(md.id) AS total_items,
      COALESCE(SUM(NULLIF(md.total_linea_bs, 0)), SUM(md.cantidad * md.precio_unitario_bs), 0) AS total_bs,
      COALESCE(SUM(NULLIF(md.total_linea_divisa, 0)), SUM(md.cantidad * md.precio_unitario_divisa), 0) AS total_usd
    FROM movimientos m
    LEFT JOIN movimiento_detalles md ON m.id = md.movimiento_id
    WHERE m.tipo = 'SALIDA_VENTA' AND (m.libro_ventas_id IS NULL OR m.estatus_conciliacion = 'PENDIENTE_UCG')
  `;
  const movOrfArgs = [];
  if (periodo && periodo !== 'TODOS') {
    movOrfSql += " AND strftime('%Y-%m', m.fecha) = ?";
    movOrfArgs.push(periodo);
  }
  movOrfSql += " GROUP BY m.id ORDER BY m.fecha DESC, m.id DESC";
  const movOrfRes = await db.execute({ sql: movOrfSql, args: movOrfArgs });

  // 4. Cruce de Compras (Libro Compras vs Almacén)
  let compSql = `
    SELECT 
      lc.id AS libro_compra_id, lc.periodo, lc.fecha, lc.rif, lc.razon_social, lc.nro_factura, lc.nro_control,
      lc.tipo_servicio, lc.aplica_inventario, lc.base_imponible_bs, lc.iva_bs, lc.total_bs, lc.total_divisa, lc.tasa_bcv,
      lc.estatus_conciliacion, lc.movimiento_id, lc.observaciones_cruce,
      m.id AS movimiento_almacen_id, m.fecha AS fecha_almacen, m.numero_documento AS doc_almacen
    FROM libro_compras lc
    LEFT JOIN movimientos m ON lc.movimiento_id = m.id
    WHERE 1=1
  `;
  const compArgs = [];
  if (periodo && periodo !== 'TODOS') {
    compSql += " AND lc.periodo = ?";
    compArgs.push(periodo);
  }
  compSql += " ORDER BY lc.fecha DESC, lc.id DESC";
  const compRes = await db.execute({ sql: compSql, args: compArgs });

  // 5. Entradas de Almacén sin Factura Fiscal (Pendiente UCG)
  let entSinFacSql = `
    SELECT 
      m.id, m.fecha, m.numero_documento, m.observaciones, m.estatus_conciliacion,
      COUNT(md.id) AS total_items,
      SUM(md.cantidad) AS total_unidades,
      SUM(md.cantidad * md.costo_unitario_ves) AS costo_bs,
      SUM(md.cantidad * md.costo_unitario_usd) AS costo_usd
    FROM movimientos m
    JOIN movimiento_detalles md ON m.id = md.movimiento_id
    WHERE m.tipo = 'ENTRADA_COMPRA' AND (m.libro_compras_id IS NULL OR m.estatus_conciliacion = 'PENDIENTE_UCG')
  `;
  const entSinFacArgs = [];
  if (periodo && periodo !== 'TODOS') {
    entSinFacSql += " AND strftime('%Y-%m', m.fecha) = ?";
    entSinFacArgs.push(periodo);
  }
  entSinFacSql += " GROUP BY m.id ORDER BY m.fecha DESC, m.id DESC";
  const entSinFacRes = await db.execute({ sql: entSinFacSql, args: entSinFacArgs });

  // Métricas ejecutivas de ventas
  let totalReportesZ = zRes.rows.length;
  let totalFacturasEsperadas = 0;
  let totalFacturasCargadas = 0;
  let totalFacturasFaltantes = facturasPendientesDG67.length;
  let totalMontoZBs = 0;
  let totalMontoZUsd = 0;
  let totalMontoDetalladoBs = 0;
  let countConciliados = 0;

  for (const z of zRes.rows) {
    totalFacturasEsperadas += Number(z.cantidad_comprobantes) || 0;
    totalFacturasCargadas += Number(z.cantidad_facturas_cargadas) || 0;
    totalMontoZBs += Number(z.total_bs) || 0;
    totalMontoZUsd += Number(z.total_divisa) || 0;
    totalMontoDetalladoBs += Number(z.total_facturas_cargadas_bs) || 0;
    if (z.estatus_conciliacion === 'CONCILIADO') countConciliados++;
  }

  // Métricas ejecutivas de compras
  let totalComprasFiscales = compRes.rows.length;
  let comprasMercancia = compRes.rows.filter(c => c.aplica_inventario === 1).length;
  let comprasGastos = compRes.rows.filter(c => c.aplica_inventario === 0).length;
  let comprasConciliadas = compRes.rows.filter(c => c.estatus_conciliacion === 'CONCILIADO').length;
  let comprasPendientesAlmacen = compRes.rows.filter(c => c.aplica_inventario === 1 && c.estatus_conciliacion !== 'CONCILIADO').length;
  let entradasPendientesFiscal = entSinFacRes.rows.length;

  return {
    periodo,
    ventas: {
      reportes_z: zRes.rows,
      facturas_pendientes_dg67: facturasPendientesDG67,
      salidas_pendientes_ucg: movOrfRes.rows,
      kpis: {
        total_reportes_z: totalReportesZ,
        reportes_conciliados: countConciliados,
        porcentaje_conciliado: totalReportesZ > 0 ? Number(((countConciliados / totalReportesZ) * 100).toFixed(1)) : 0,
        total_facturas_esperadas: totalFacturasEsperadas,
        total_facturas_cargadas: totalFacturasCargadas,
        total_facturas_faltantes: totalFacturasFaltantes,
        total_monto_z_bs: totalMontoZBs,
        total_monto_z_usd: totalMontoZUsd,
        total_monto_detallado_bs: totalMontoDetalladoBs,
        diferencia_total_bs: Number((totalMontoZBs - totalMontoDetalladoBs).toFixed(2))
      }
    },
    compras: {
      resumen_compras: compRes.rows,
      entradas_pendientes_fiscal: entSinFacRes.rows,
      kpis: {
        total_compras_fiscales: totalComprasFiscales,
        compras_mercancia: comprasMercancia,
        compras_gastos: comprasGastos,
        compras_conciliadas: comprasConciliadas,
        compras_pendientes_almacen: comprasPendientesAlmacen,
        entradas_pendientes_fiscal: entradasPendientesFiscal
      }
    }
  };
}

/**
 * Verifica si una factura de compra ya se encuentra registrada en el Libro de Compras
 * Evita duplicados fiscales por Proveedor (RIF) + Número de Factura o Número de Control (Art. 75-76 RLIVA)
 */
export async function verificarDuplicadoLibroCompras(rif, nroFactura, nroControl, excludeId, db) {
  if (!rif || !nroFactura) return { duplicado: false };
  const cleanRif = String(rif).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cleanFactura = String(nroFactura).trim();
  const matchNum = cleanFactura.match(/\d+/);
  const numInt = matchNum ? parseInt(matchNum[0], 10) : null;
  const exclude = excludeId ? Number(excludeId) : 0;

  // 1. Verificación por RIF del Proveedor y Número de Factura (exacto o correlativo numérico)
  let sql = `
    SELECT id, periodo, fecha, fecha_recepcion, rif, razon_social, nro_factura, nro_control, 
           total_bs, total_divisa, base_imponible_bs, iva_bs, estatus_conciliacion
    FROM libro_compras
    WHERE id != ?
      AND UPPER(REPLACE(REPLACE(REPLACE(rif, '-', ''), '.', ''), ' ', '')) = ?
      AND (
        UPPER(TRIM(nro_factura)) = UPPER(?)
        ${numInt ? 'OR (CAST(nro_factura AS INTEGER) > 0 AND CAST(nro_factura AS INTEGER) = ?)' : ''}
      )
    LIMIT 1
  `;
  const args = [exclude, cleanRif, cleanFactura];
  if (numInt) args.push(numInt);

  const res = await db.execute({ sql, args });
  if (res.rows.length > 0) {
    const f = res.rows[0];
    const totalBsFmt = Number(f.total_bs).toLocaleString('es-VE', { minimumFractionDigits: 2 });
    const totalDivFmt = Number(f.total_divisa).toLocaleString('en-US', { minimumFractionDigits: 2 });
    return {
      duplicado: true,
      tipo: 'MISMO_PROVEEDOR_Y_FACTURA',
      mensaje: `⚠️ FACTURA DUPLICADA EN LIBRO DE COMPRAS: La factura N° ${cleanFactura} del proveedor ${f.razon_social} (${f.rif}) ya se encuentra registrada en el período ${f.periodo} (Fecha: ${f.fecha}, Total: Bs. ${totalBsFmt} / $${totalDivFmt} USD). Por normativa fiscal SENIAT, no se permite registrar una factura duplicada.`,
      factura: f
    };
  }

  // 2. Verificación por RIF del Proveedor y Número de Control SENIAT
  if (nroControl && String(nroControl).trim()) {
    const ctrlNorm = String(nroControl).trim();
    const isGenericCtrl = /^(00-|00|0|s\/c|s\/ctrl|sin control)$/i.test(ctrlNorm);
    if (!isGenericCtrl && ctrlNorm.length >= 4) {
      const ctrlRes = await db.execute({
        sql: `SELECT id, periodo, fecha, rif, razon_social, nro_factura, nro_control, total_bs, total_divisa
              FROM libro_compras
              WHERE id != ?
                AND UPPER(REPLACE(REPLACE(REPLACE(rif, '-', ''), '.', ''), ' ', '')) = ?
                AND UPPER(TRIM(nro_control)) = UPPER(?)
              LIMIT 1`,
        args: [exclude, cleanRif, ctrlNorm]
      });
      if (ctrlRes.rows.length > 0) {
        const f = ctrlRes.rows[0];
        return {
          duplicado: true,
          tipo: 'MISMO_NUMERO_CONTROL',
          mensaje: `⚠️ CONTROL FISCAL DUPLICADO: El N° de Control Fiscal "${ctrlNorm}" del proveedor ${f.razon_social} ya fue registrado en la Factura N° ${f.nro_factura} del período ${f.periodo}.`,
          factura: f
        };
      }
    }
  }

  return { duplicado: false };
}

/**
 * Verifica si ya existe una entrada física de almacén para ese mismo Proveedor y Número de Factura/Documento
 */
export async function verificarDuplicadoEntradaAlmacen(proveedorId, nroDocumento, excludeId, db) {
  if (!proveedorId || !nroDocumento) return { duplicado: false };
  const provId = parseInt(proveedorId, 10);
  const cleanDoc = String(nroDocumento).trim();
  const matchNum = cleanDoc.match(/\d+/);
  const numInt = matchNum ? parseInt(matchNum[0], 10) : null;
  const exclude = excludeId ? Number(excludeId) : 0;

  if (/^(control|inventario|ajuste|s\/n|s\/d)/i.test(cleanDoc)) {
    return { duplicado: false };
  }

  let sql = `
    SELECT m.id, m.fecha, m.numero_documento, m.nro_control, p.razon_social, p.rif,
           (SELECT COUNT(*) FROM movimiento_detalles md WHERE md.movimiento_id = m.id) as items_cant,
           COALESCE(
             (SELECT SUM(total_linea_bs) FROM movimiento_detalles md WHERE md.movimiento_id = m.id),
             0
           ) as total_bs
    FROM movimientos m
    LEFT JOIN proveedores p ON m.proveedor_id = p.id
    WHERE m.id != ?
      AND m.tipo = 'ENTRADA_COMPRA'
      AND m.proveedor_id = ?
      AND (
        UPPER(TRIM(m.numero_documento)) = UPPER(?)
        ${numInt ? 'OR (m.numero_factura_numerico > 0 AND m.numero_factura_numerico = ?)' : ''}
      )
    ORDER BY m.id DESC
    LIMIT 1
  `;
  const args = [exclude, provId, cleanDoc];
  if (numInt) args.push(numInt);

  const res = await db.execute({ sql, args });
  if (res.rows.length > 0) {
    const m = res.rows[0];
    const totalBsFmt = Number(m.total_bs).toLocaleString('es-VE', { minimumFractionDigits: 2 });
    return {
      duplicado: true,
      tipo: 'ENTRADA_ALMACEN_EXISTENTE',
      mensaje: `⚠️ ENTRADA YA REGISTRADA EN ALMACÉN: Ya existe una entrada física registrada para la factura N° ${cleanDoc} del proveedor ${m.razon_social || provId} (Fecha: ${m.fecha}, Movimiento #${m.id}, ${m.items_cant} repuestos, Total: Bs. ${totalBsFmt}). No se permite duplicar el ingreso físico al inventario.`,
      movimiento: m
    };
  }
  return { duplicado: false };
}

/**
 * Calcula la próxima factura correlativa esperada para el Libro de Ventas (Reportes Z)
 * y cruza automáticamente con las ventas registradas por DG67 en esa fecha
 */
export async function getProximaFacturaZ(periodo, fecha, db) {
  const targetFecha = fecha || (periodo ? `${periodo}-01` : '2026-10-01');
  const targetPeriodo = periodo || targetFecha.slice(0, 7);

  // 1. Buscar el último Reporte Z registrado con fecha anterior a esta fecha
  const prevZ = await db.execute({
    sql: `
      SELECT id, fecha, factura_hasta, periodo
      FROM libro_ventas 
      WHERE fecha < ? AND factura_hasta IS NOT NULL AND factura_hasta != ''
      ORDER BY fecha DESC, id DESC 
      LIMIT 1
    `,
    args: [targetFecha]
  });

  let ultimaFacturaHasta = null;
  let ultimaFecha = null;
  let proxFactNum = 1;

  if (prevZ.rows.length > 0) {
    ultimaFacturaHasta = prevZ.rows[0].factura_hasta;
    ultimaFecha = prevZ.rows[0].fecha;
    const match = String(ultimaFacturaHasta).match(/(\d+)/);
    if (match) {
      proxFactNum = parseInt(match[1], 10) + 1;
    }
  } else {
    // Si no hay reporte antes de esa fecha, buscar el máximo de cualquier período anterior
    const prevPer = await db.execute({
      sql: `
        SELECT factura_hasta, fecha
        FROM libro_ventas
        WHERE periodo < ? AND factura_hasta IS NOT NULL AND factura_hasta != ''
        ORDER BY periodo DESC, id DESC
        LIMIT 1
      `,
      args: [targetPeriodo]
    });
    if (prevPer.rows.length > 0) {
      ultimaFacturaHasta = prevPer.rows[0].factura_hasta;
      ultimaFecha = prevPer.rows[0].fecha;
      const match = String(ultimaFacturaHasta).match(/(\d+)/);
      if (match) {
        proxFactNum = parseInt(match[1], 10) + 1;
      }
    }
  }

  const proximaFacturaStr = String(proxFactNum).padStart(8, '0');

  // 2. Verificar si DG67 ya tiene salidas registradas en esta fecha
  const movsDia = await db.execute({
    sql: `
      SELECT m.id, m.numero_documento, m.observaciones,
             COALESCE(SUM(NULLIF(md.total_linea_bs, 0)), SUM(md.cantidad * md.precio_unitario_bs), 0) AS total_bs,
             COALESCE(SUM(md.cantidad), 0) AS total_unds
      FROM movimientos m
      LEFT JOIN movimiento_detalles md ON m.id = md.movimiento_id
      WHERE m.tipo = 'SALIDA_VENTA' AND m.fecha = ?
      GROUP BY m.id
      ORDER BY m.id ASC
    `,
    args: [targetFecha]
  });

  let sugerenciaSalidas = null;
  if (movsDia.rows.length > 0) {
    const factNums = [];
    let totalBs = 0;
    let totalUnds = 0;

    for (const r of movsDia.rows) {
      totalBs += Number(r.total_bs) || 0;
      totalUnds += Number(r.total_unds) || 0;
      const match = String(r.numero_documento).match(/(\d+)/) || String(r.observaciones).match(/(\d+)/);
      if (match) factNums.push(parseInt(match[1], 10));
    }

    if (factNums.length > 0) {
      const minF = Math.min(...factNums);
      const maxF = Math.max(...factNums);
      const cantFact = movsDia.rows.length;
      const totalBsRounded = Number(totalBs.toFixed(2));
      const baseBs = Number((totalBsRounded / 1.16).toFixed(2));
      const ivaBs = Number((totalBsRounded - baseBs).toFixed(2));

      sugerenciaSalidas = {
        tiene_salidas: true,
        cantidad_facturas: cantFact,
        factura_desde: String(minF).padStart(8, '0'),
        factura_hasta: String(maxF).padStart(8, '0'),
        total_bs: totalBsRounded,
        base_imponible_bs: baseBs,
        iva_bs: ivaBs,
        total_repuestos: totalUnds
      };
    }
  }

  return {
    fecha: targetFecha,
    periodo: targetPeriodo,
    proxima_factura: proximaFacturaStr,
    ultima_factura_anterior: ultimaFacturaHasta,
    fecha_ultima_anterior: ultimaFecha,
    sugerencia_salidas: sugerenciaSalidas
  };
}

/**
 * Consulta el estado de conciliación de compras (Libro de Compras Fiscal ↔ Entradas de Almacén)
 */
export async function getCruceComprasEntradas(periodo, db) {
  const targetPeriodo = periodo || '2026-10';

  // 1. Facturas de compra cargadas en Libro de Compras (aplica_inventario = 1)
  let sqlLC = `
    SELECT 
      lc.id AS libro_compra_id, lc.periodo, lc.fecha, lc.rif, lc.razon_social,
      lc.nro_factura, lc.nro_control, lc.tipo_servicio, lc.aplica_inventario,
      lc.base_imponible_bs, lc.iva_bs, lc.total_bs, lc.total_divisa, lc.tasa_bcv,
      lc.estatus_conciliacion, lc.movimiento_id, lc.observaciones_cruce,
      m.id AS movimiento_almacen_id, m.fecha AS fecha_almacen, m.numero_documento AS doc_almacen
    FROM libro_compras lc
    LEFT JOIN movimientos m ON lc.movimiento_id = m.id
    WHERE lc.aplica_inventario = 1
  `;
  const argsLC = [];
  if (targetPeriodo !== 'TODOS') {
    sqlLC += " AND lc.periodo = ?";
    argsLC.push(targetPeriodo);
  }
  sqlLC += " ORDER BY lc.fecha DESC, lc.id DESC";
  const resLC = await db.execute({ sql: sqlLC, args: argsLC });

  const pendientesAlmacen = [];
  const conciliadas = [];

  for (const r of resLC.rows) {
    if (r.estatus_conciliacion === 'CONCILIADO' && r.movimiento_id) {
      conciliadas.push(r);
    } else {
      pendientesAlmacen.push(r);
    }
  }

  // 2. Entradas de almacén registradas por DG67
  let sqlEnt = `
    SELECT 
      m.id AS movimiento_id, m.fecha, m.numero_documento, m.observaciones,
      m.estatus_conciliacion, m.libro_compras_id,
      p.razon_social AS proveedor_nombre, p.rif AS proveedor_rif,
      COUNT(md.id) AS total_items,
      COALESCE(SUM(md.cantidad), 0) AS total_unidades,
      COALESCE(SUM(md.total_linea_bs), SUM(md.cantidad * md.costo_unitario_ves), 0) AS total_costo_bs,
      COALESCE(SUM(md.total_linea_divisa), SUM(md.cantidad * md.costo_unitario_usd), 0) AS total_costo_usd
    FROM movimientos m
    LEFT JOIN proveedores p ON m.proveedor_id = p.id
    LEFT JOIN movimiento_detalles md ON m.id = md.movimiento_id
    WHERE m.tipo = 'ENTRADA_COMPRA'
  `;
  const argsEnt = [];
  if (targetPeriodo !== 'TODOS') {
    sqlEnt += " AND strftime('%Y-%m', m.fecha) = ?";
    argsEnt.push(targetPeriodo);
  }
  sqlEnt += " GROUP BY m.id ORDER BY m.fecha DESC, m.id DESC";
  const resEnt = await db.execute({ sql: sqlEnt, args: argsEnt });

  const entradasSinFiscal = [];
  for (const e of resEnt.rows) {
    if (!e.libro_compras_id || e.estatus_conciliacion === 'PENDIENTE_UCG') {
      entradasSinFiscal.push(e);
    }
  }

  return {
    periodo: targetPeriodo,
    kpis: {
      total_facturas_compras: resLC.rows.length,
      pendientes_almacen_cant: pendientesAlmacen.length,
      conciliadas_cant: conciliadas.length,
      entradas_sin_fiscal_cant: entradasSinFiscal.length,
      porcentaje_cruce: resLC.rows.length > 0 
        ? Number(((conciliadas.length / resLC.rows.length) * 100).toFixed(1)) 
        : 0
    },
    facturas_pendientes_almacen: pendientesAlmacen,
    compras_conciliadas: conciliadas,
    entradas_sin_factura_fiscal: entradasSinFiscal
  };
}

/**
 * Consulta el estado de conciliación de ventas y salidas (Reportes Z Fiscales ↔ Salidas de Almacén)
 */
export async function getCruceVentasSalidas(periodo, db) {
  const targetPeriodo = periodo || '2026-10';

  // 1. Reportes Z
  let zSql = `
    SELECT 
      id, periodo, fecha, numero_reporte_z, serial_impresora, factura_desde, factura_hasta,
      cantidad_comprobantes, cantidad_anuladas, total_anulaciones_bs, facturas_anuladas_lista,
      base_imponible_bs, iva_bs, total_bs, total_divisa, tasa_bcv,
      estatus_conciliacion, facturas_faltantes, cantidad_facturas_cargadas,
      total_facturas_cargadas_bs, diferencia_bs, observaciones_cruce
    FROM libro_ventas
    WHERE 1=1
  `;
  const zArgs = [];
  if (targetPeriodo !== 'TODOS') {
    zSql += " AND periodo = ?";
    zArgs.push(targetPeriodo);
  }
  zSql += " ORDER BY fecha DESC, id DESC";
  const zRes = await db.execute({ sql: zSql, args: zArgs });

  const pendientesSalida = [];
  const conciliados = [];

  for (const z of zRes.rows) {
    if (z.estatus_conciliacion === 'CONCILIADO') {
      conciliados.push(z);
    }
    if (z.facturas_faltantes && z.estatus_conciliacion !== 'CONCILIADO') {
      const nums = z.facturas_faltantes.split(',').map(s => s.trim()).filter(Boolean);
      for (const num of nums) {
        pendientesSalida.push({
          reporte_z_id: z.id,
          periodo: z.periodo,
          fecha: z.fecha,
          numero_reporte_z: z.numero_reporte_z || ('Z-' + z.id),
          serial_impresora: z.serial_impresora || 'Z0A0000176',
          factura_numero: num,
          tasa_bcv: z.tasa_bcv
        });
      }
    }
  }

  // 2. Salidas huérfanas sin Reporte Z
  let movOrfSql = `
    SELECT 
      m.id, m.fecha, m.numero_documento, m.numero_factura_numerico, m.estatus_conciliacion, m.observaciones,
      COUNT(md.id) AS total_items,
      COALESCE(SUM(NULLIF(md.total_linea_bs, 0)), SUM(md.cantidad * md.precio_unitario_bs), 0) AS total_bs,
      COALESCE(SUM(NULLIF(md.total_linea_divisa, 0)), SUM(md.cantidad * md.precio_unitario_divisa), 0) AS total_usd
    FROM movimientos m
    LEFT JOIN movimiento_detalles md ON m.id = md.movimiento_id
    WHERE m.tipo = 'SALIDA_VENTA' AND (m.libro_ventas_id IS NULL OR m.estatus_conciliacion = 'PENDIENTE_UCG')
  `;
  const movOrfArgs = [];
  if (targetPeriodo !== 'TODOS') {
    movOrfSql += " AND strftime('%Y-%m', m.fecha) = ?";
    movOrfArgs.push(targetPeriodo);
  }
  movOrfSql += " GROUP BY m.id ORDER BY m.fecha DESC, m.id DESC";
  const movOrfRes = await db.execute({ sql: movOrfSql, args: movOrfArgs });

  return {
    periodo: targetPeriodo,
    kpis: {
      total_reportes_z: zRes.rows.length,
      reportes_z_cerrados: conciliados.length,
      pendientes_salida_cant: pendientesSalida.length,
      salidas_huerfanas_cant: movOrfRes.rows.length,
      porcentaje_cierre: zRes.rows.length > 0 ? Number(((conciliados.length / zRes.rows.length) * 100).toFixed(1)) : 0
    },
    facturas_pendientes_salida: pendientesSalida,
    reportes_z_conciliados: conciliados,
    salidas_sin_reporte_z: movOrfRes.rows
  };
}

/**
 * Consulta las salidas de DG67 agrupadas en subgrupos por día, con desglose de comprobantes
 */
export async function getSalidasTiendaAgrupadas(periodo, fecha, q, db) {
  let sql = `
    SELECT 
      m.id,
      m.fecha,
      strftime('%Y-%m', m.fecha) as periodo,
      m.numero_documento,
      m.numero_factura_numerico,
      m.observaciones,
      m.estatus_conciliacion,
      m.tasa_bcv,
      m.libro_ventas_id,
      COUNT(md.id) as items_cant,
      COALESCE(SUM(md.cantidad), 0) as unidades_cant,
      COALESCE(SUM(NULLIF(md.total_linea_bs, 0)), SUM(md.cantidad * md.precio_unitario_bs), 0) as total_bs,
      COALESCE(SUM(NULLIF(md.total_linea_divisa, 0)), SUM(md.cantidad * md.precio_unitario_divisa), 0) as total_usd,
      GROUP_CONCAT(COALESCE(p.descripcion, p.codigo), ' • ') as resumen_productos
    FROM movimientos m
    LEFT JOIN movimiento_detalles md ON m.id = md.movimiento_id
    LEFT JOIN productos p ON md.producto_id = p.id
    WHERE m.tipo = 'SALIDA_VENTA'
  `;
  const args = [];
  if (periodo && periodo !== 'TODOS') {
    sql += " AND strftime('%Y-%m', m.fecha) = ?";
    args.push(periodo);
  }
  if (fecha) {
    sql += " AND m.fecha = ?";
    args.push(fecha);
  }
  if (q) {
    sql += " AND (m.numero_documento LIKE ? OR m.observaciones LIKE ?)";
    args.push(`%${q}%`, `%${q}%`);
  }
  sql += " GROUP BY m.id ORDER BY m.fecha DESC, m.numero_factura_numerico ASC, m.id ASC LIMIT 250";

  const res = await db.execute({ sql, args });

  // 1. Obtener los Reportes Z fiscales del período para contrastar y mapear cada día estrictamente por su fecha fiscal
  let lvSql = "SELECT id, fecha, numero_reporte_z, factura_desde, factura_hasta, estatus_conciliacion FROM libro_ventas WHERE 1=1";
  const lvArgs = [];
  if (periodo && periodo !== 'TODOS') {
    lvSql += " AND (periodo = ? OR strftime('%Y-%m', fecha) = ?)";
    lvArgs.push(periodo, periodo);
  }
  const lvRes = await db.execute({ sql: lvSql, args: lvArgs });
  const zPorFecha = {};
  for (const z of lvRes.rows) {
    if (z.fecha) zPorFecha[z.fecha] = z;
  }

  // Agrupar en subgrupos por día
  const diasMap = {};
  for (const r of res.rows) {
    const f = r.fecha;
    if (!diasMap[f]) {
      const zDelDia = zPorFecha[f];
      diasMap[f] = {
        fecha: f,
        periodo: r.periodo,
        cantidad_comprobantes: 0,
        total_unidades_despachadas: 0,
        total_bs: 0,
        total_usd: 0,
        factura_desde: null,
        factura_hasta: null,
        facturas_nums: [],
        libro_venta_id: zDelDia ? zDelDia.id : null,
        numero_reporte_z: zDelDia ? zDelDia.numero_reporte_z : null,
        estatus_conciliacion: zDelDia ? zDelDia.estatus_conciliacion : 'PENDIENTE_EN_LIBRO',
        facturas: []
      };
    }
    const dia = diasMap[f];
    dia.cantidad_comprobantes++;
    dia.total_unidades_despachadas += Number(r.unidades_cant || 0);
    dia.total_bs += Number(r.total_bs || 0);
    dia.total_usd += Number(r.total_usd || 0);

    // Normalizar número de factura limpio
    let num = r.numero_factura_numerico;
    if (!num) {
      const match = String(r.numero_documento).match(/(\d+)/) || String(r.observaciones).match(/(\d+)/);
      if (match) num = parseInt(match[1], 10);
    }
    if (num) dia.facturas_nums.push(num);
    const numPad = num ? String(num).padStart(8, '0') : (r.numero_documento || 'S/N');

    dia.facturas.push({
      movimiento_id: r.id,
      numero_documento: r.numero_documento,
      numero_factura: numPad,
      numero_factura_numerico: num,
      items_cant: r.items_cant,
      unidades_cant: r.unidades_cant,
      total_bs: Number(Number(r.total_bs || 0).toFixed(2)),
      total_usd: Number(Number(r.total_usd || 0).toFixed(2)),
      resumen_productos: r.resumen_productos || '',
      estatus_conciliacion: r.estatus_conciliacion
    });
  }

  // Finalizar cálculos por día asegurando vinculación exacta
  const listaDias = Object.values(diasMap).map(d => {
    const zDelDia = zPorFecha[d.fecha];
    d.libro_venta_id = zDelDia ? zDelDia.id : null;
    d.numero_reporte_z = zDelDia ? zDelDia.numero_reporte_z : null;
    d.estatus_conciliacion = zDelDia ? zDelDia.estatus_conciliacion : 'PENDIENTE_EN_LIBRO';

    if (d.facturas_nums.length > 0) {
      d.factura_desde = String(Math.min(...d.facturas_nums)).padStart(8, '0');
      d.factura_hasta = String(Math.max(...d.facturas_nums)).padStart(8, '0');
    } else {
      d.factura_desde = '00000001';
      d.factura_hasta = '00000001';
    }
    d.total_bs = Number(d.total_bs.toFixed(2));
    d.total_usd = Number(d.total_usd.toFixed(2));
    d.base_imponible_bs = Number((d.total_bs / 1.16).toFixed(2));
    d.iva_bs = Number((d.total_bs - d.base_imponible_bs).toFixed(2));
    return d;
  });

  return listaDias;
}


