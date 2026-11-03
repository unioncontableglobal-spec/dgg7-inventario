/**
 * functions/lib/cruce_engine.js
 * Motor de Conciliación de Doble Vía (Cruce de Información DG67 ↔ UCG)
 * Compatible con Cloudflare Pages y Node.js (@libsql/client)
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

  // Buscar salidas cargadas por DG67
  const movsRes = await db.execute({
    sql: `SELECT m.id, m.numero_documento, m.numero_factura_numerico, m.fecha,
                 COALESCE(SUM(NULLIF(md.total_linea_bs, 0)), SUM(md.cantidad * md.precio_unitario_bs), 0) AS total_bs
          FROM movimientos m
          LEFT JOIN movimiento_detalles md ON m.id = md.movimiento_id
          WHERE m.tipo = 'SALIDA_VENTA' 
            AND (m.numero_factura_numerico BETWEEN ? AND ? OR m.fecha = ?)
          GROUP BY m.id`,
    args: [desdeNum, hastaNum, z.fecha]
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

  const faltantes = esperados.filter(num => !cargadosNums.has(num));
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

  // Actualizar movimientos vinculados
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
  // Asegurar conciliación de los Reportes Z del período
  await conciliarTodosReportesZ(periodo, db);

  // 1. Reportes Z con estatus
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
