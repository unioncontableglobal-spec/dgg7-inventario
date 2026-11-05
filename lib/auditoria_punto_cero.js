/**
 * functions/lib/auditoria_punto_cero.js
 * Sub-módulo de Toma Física y Ajuste de Inventario (Punto Cero) en Tiempo Real
 * Compatible con Cloudflare Pages Functions (@libsql/client / Turso Cloud)
 * Cumple con Providencia Administrativa SENIAT PA SNAT/2026/00093 y Art. 177 RISLR
 * Doble Expresión Monetaria: Bolívares (Bs.) prominente y Dólares ($ USD) de referencia
 */

export async function getListadoAuditoriaEnVivo(db) {
  const sql = `
    SELECT 
      p.id AS producto_id,
      p.codigo,
      p.descripcion,
      COALESCE(p.unidad_medida, 'UND') AS unidad_medida,
      COALESCE(a.nombre, 'PRINCIPAL') AS almacen,
      COALESCE(c.nombre, 'GENERAL') AS categoria,
      COALESCE(v.stock_actual, 0) AS stock_actual,
      COALESCE(p.costo_referencial_usd, 0) AS costo_historico_s_iva,
      COALESCE(p.precio_venta_usd, 0) AS precio_venta_guardado,
      COALESCE(p.stock_auditado_fisico, v.stock_actual, 0) AS stock_auditado_fisico,
      COALESCE(p.auditado, 0) AS auditado,
      p.fecha_auditoria,
      p.usuario_auditoria,
      COALESCE(p.inactivo, 0) AS inactivo,
      COALESCE(p.activo, 1) AS activo,
      COALESCE(
        NULLIF(p.precio_venta_usd, 0),
        (SELECT md.precio_unitario_divisa 
         FROM movimiento_detalles md 
         JOIN movimientos m ON md.movimiento_id = m.id 
         WHERE md.producto_id = p.id AND m.tipo = 'SALIDA_VENTA' AND md.precio_unitario_divisa > 0 
         ORDER BY m.fecha DESC, m.id DESC LIMIT 1),
        ROUND(COALESCE(p.costo_referencial_usd, 0) * 1.30, 2)
      ) AS precio_venta_s_iva
    FROM productos p
    LEFT JOIN vista_inventario_actual v ON p.id = v.producto_id
    LEFT JOIN categorias c ON p.categoria_id = c.id
    LEFT JOIN almacenes a ON p.almacen_id = a.id
    ORDER BY p.codigo ASC
  `;

  const res = await db.execute(sql);

  let totalProductos = 0;
  let totalAuditados = 0;
  let totalInactivos = 0;
  let conDiferencia = 0;

  const productos = res.rows.map(r => {
    totalProductos++;
    const isAuditado = Number(r.auditado) === 1;
    const isInactive = Number(r.inactivo) === 1 || Number(r.activo) === 0;

    if (isAuditado) totalAuditados++;
    if (isInactive) totalInactivos++;

    const stockActual = Number(Number(r.stock_actual).toFixed(2)) || 0;
    const stockFisico = (r.stock_auditado_fisico !== null && r.stock_auditado_fisico !== undefined)
      ? Number(Number(r.stock_auditado_fisico).toFixed(2))
      : stockActual;

    const diff = Number((stockFisico - stockActual).toFixed(2));
    if (diff !== 0 && isAuditado) conDiferencia++;

    const costoSIVA = Number(Number(r.costo_historico_s_iva).toFixed(2)) || 0;
    const costoIVA = Number((costoSIVA * 0.16).toFixed(2));
    const costoTotal = Number((costoSIVA + costoIVA).toFixed(2));

    const precioVentaSIVA = Number(Number(r.precio_venta_s_iva).toFixed(2)) || 0;
    const precioVentaIVA = Number((precioVentaSIVA * 0.16).toFixed(2));
    const precioVentaTotal = Number((precioVentaSIVA + precioVentaIVA).toFixed(2));

    return {
      producto_id: r.producto_id,
      codigo: r.codigo,
      descripcion: r.descripcion,
      unidad_medida: r.unidad_medida,
      almacen: r.almacen,
      categoria: r.categoria,
      stock_actual: stockActual,
      stock_fisico: stockFisico,
      diferencia: diff,
      costo_s_iva_usd: costoSIVA,
      costo_iva_usd: costoIVA,
      costo_total_usd: costoTotal,
      precio_venta_s_iva_usd: precioVentaSIVA,
      precio_venta_iva_usd: precioVentaIVA,
      precio_venta_total_usd: precioVentaTotal,
      auditado: isAuditado ? 1 : 0,
      fecha_auditoria: r.fecha_auditoria || null,
      usuario_auditoria: r.usuario_auditoria || null,
      inactivo: isInactive ? 1 : 0,
      activo: isInactive ? 0 : 1
    };
  });

  const totalPendientes = Math.max(0, totalProductos - totalAuditados);
  const porcentaje = totalProductos > 0 ? Number(((totalAuditados / totalProductos) * 100).toFixed(1)) : 0;

  return {
    estadisticas: {
      total_productos: totalProductos,
      auditados: totalAuditados,
      pendientes: totalPendientes,
      porcentaje_auditado: porcentaje,
      con_diferencia_stock: conDiferencia,
      inactivos: totalInactivos
    },
    productos
  };
}

export async function actualizarProductoAuditoria(productoId, payload, db) {
  const {
    cantidad_fisica_real,
    costo_s_iva_usd,
    precio_venta_s_iva_usd,
    costo_s_iva_bs,
    precio_venta_s_iva_bs,
    inactivo = 0,
    auditado = 1,
    fecha = '2026-10-31',
    tasa_bcv = 889.58,
    usuario = 'ADMIN_DG67',
    observaciones = 'Toma física y ajuste de inventario (Octubre 2026)',
    motivo_ajuste = '',
    justificacion_detalle = '',
    acta_vinculada = 'ACTA-INV-202610-01'
  } = payload;

  const tasaNum = Number(tasa_bcv) > 0 ? Number(tasa_bcv) : 889.58;

  const prodRes = await db.execute({
    sql: `
      SELECT 
        p.id, p.codigo, p.descripcion, p.unidad_medida, p.costo_referencial_usd, p.precio_venta_usd,
        p.inactivo, p.activo, COALESCE(v.stock_actual, 0) as stock_actual
      FROM productos p
      LEFT JOIN vista_inventario_actual v ON p.id = v.producto_id
      WHERE p.id = ?
    `,
    args: [productoId]
  });

  if (prodRes.rows.length === 0) {
    throw new Error(`Producto con ID ${productoId} no encontrado en la base de datos.`);
  }

  const p = prodRes.rows[0];
  const stockActual = Number(Number(p.stock_actual).toFixed(2)) || 0;

  const tieneFisico = (cantidad_fisica_real !== null && cantidad_fisica_real !== undefined && cantidad_fisica_real !== '' && !isNaN(Number(cantidad_fisica_real)));
  const cantReal = tieneFisico ? Number(Number(cantidad_fisica_real).toFixed(2)) : stockActual;

  const tieneCostoBs = (costo_s_iva_bs !== null && costo_s_iva_bs !== undefined && costo_s_iva_bs !== '' && !isNaN(Number(costo_s_iva_bs)) && Number(costo_s_iva_bs) >= 0);
  const tieneCostoUsd = (costo_s_iva_usd !== null && costo_s_iva_usd !== undefined && costo_s_iva_usd !== '' && !isNaN(Number(costo_s_iva_usd)) && Number(costo_s_iva_usd) >= 0);
  const nuevoCosto = tieneCostoBs
    ? Number((Number(costo_s_iva_bs) / tasaNum).toFixed(2))
    : (tieneCostoUsd ? Number(Number(costo_s_iva_usd).toFixed(2)) : Number(p.costo_referencial_usd || 0));

  const tienePrecioBs = (precio_venta_s_iva_bs !== null && precio_venta_s_iva_bs !== undefined && precio_venta_s_iva_bs !== '' && !isNaN(Number(precio_venta_s_iva_bs)) && Number(precio_venta_s_iva_bs) > 0);
  const tienePrecioUsd = (precio_venta_s_iva_usd !== null && precio_venta_s_iva_usd !== undefined && precio_venta_s_iva_usd !== '' && !isNaN(Number(precio_venta_s_iva_usd)) && Number(precio_venta_s_iva_usd) > 0);
  const nuevoPrecio = tienePrecioBs
    ? Number((Number(precio_venta_s_iva_bs) / tasaNum).toFixed(2))
    : (tienePrecioUsd ? Number(Number(precio_venta_s_iva_usd).toFixed(2)) : Number(p.precio_venta_usd || (nuevoCosto * 1.30)));

  const isInactive = Number(inactivo) === 1 ? 1 : 0;
  const isActivo = isInactive === 1 ? 0 : 1;
  const isAuditado = Number(auditado) === 1 ? 1 : 0;

  let movimientoGenerado = null;
  const diff = Number((cantReal - stockActual).toFixed(2));
  const timestamp = Date.now().toString().slice(-6);

  if (tieneFisico && diff !== 0) {
    const isSobrante = diff > 0;
    const tipo = 'AJUSTE';

    // Tipificación legal contable (Art. 177 RISLR / Art. 27 LISLR)
    let subtipo = isSobrante ? 'AJUSTE_POSITIVO_STOCK' : 'AJUSTE_NEGATIVO_STOCK';
    let motivoTexto = '';

    if (!isSobrante) {
      if (motivo_ajuste === 'MERCANCIA_DANADA') {
        subtipo = 'AJUSTE_NEGATIVO_DANO';
        motivoTexto = 'Mercancía Dañada / Deterioro';
      } else if (motivo_ajuste === 'MERMA_OPERATIVA') {
        subtipo = 'AJUSTE_NEGATIVO_MERMA';
        motivoTexto = 'Merma Operativa Normal';
      } else if (motivo_ajuste === 'OBSOLESCENCIA') {
        subtipo = 'AJUSTE_NEGATIVO_OBSOLESCENCIA';
        motivoTexto = 'Obsolescencia / Descontinuado';
      } else if (motivo_ajuste === 'RETIRO_AUTOCONSUMO') {
        subtipo = 'AJUSTE_NEGATIVO_AUTOCONSUMO';
        motivoTexto = 'Retiro de Socios / Autoconsumo (Art. 4 LIVA)';
      } else if (motivo_ajuste === 'EXTRAVIO_FALTANTE') {
        subtipo = 'AJUSTE_NEGATIVO_FALTANTE';
        motivoTexto = 'Faltante en Toma Física';
      } else if (motivo_ajuste === 'ERROR_CONTEO_PREVIO') {
        subtipo = 'AJUSTE_NEGATIVO_CORRECCION';
        motivoTexto = 'Corrección Conteo Previo';
      } else {
        motivoTexto = motivo_ajuste || 'Ajuste Negativo de Stock';
      }
    } else {
      if (motivo_ajuste === 'SOBRANTE_AUDITORIA') {
        subtipo = 'AJUSTE_POSITIVO_SOBRANTE';
        motivoTexto = 'Sobrante Físico en Almacén';
      } else if (motivo_ajuste === 'OMISION_COMPRA') {
        subtipo = 'AJUSTE_POSITIVO_OMISION';
        motivoTexto = 'Omisión Histórica de Factura Compra';
      } else if (motivo_ajuste === 'DEVOLUCION_CLIENTE') {
        subtipo = 'AJUSTE_POSITIVO_DEVOLUCION';
        motivoTexto = 'Reingreso por Devolución / Garantía';
      } else if (motivo_ajuste === 'RECLASIFICACION_CODIGO') {
        subtipo = 'AJUSTE_POSITIVO_RECLASIF';
        motivoTexto = 'Reclasificación de Código';
      } else if (motivo_ajuste === 'ERROR_CONTEO_PREVIO') {
        subtipo = 'AJUSTE_POSITIVO_CORRECCION';
        motivoTexto = 'Corrección Conteo Previo';
      } else {
        motivoTexto = motivo_ajuste || 'Ajuste Positivo de Stock';
      }
    }

    const docPrefix = isSobrante ? 'AJUSTE-ENTRADA' : 'AJUSTE-SALIDA';
    const nroDoc = `${docPrefix}-${p.codigo}-${timestamp}`;
    const diffAbs = Math.abs(diff);

    const detalleSoporte = (justificacion_detalle || acta_vinculada)
      ? ` [${acta_vinculada ? 'Acta: ' + acta_vinculada : ''}${justificacion_detalle ? ' - ' + justificacion_detalle : ''}]`
      : '';
    const obsCompleta = `[${motivoTexto}]${detalleSoporte} - [${p.codigo}] ${p.descripcion}. Diff: ${diff > 0 ? '+' : ''}${diff} unds (Art. 177 RISLR)`;

    const costoAplicar = nuevoCosto > 0 ? nuevoCosto : Number(p.costo_referencial_usd || 0);
    const costoBs = Number((costoAplicar * tasaNum).toFixed(2));
    const totalDivisa = Number((diffAbs * costoAplicar).toFixed(2));
    const totalBs = Number((diffAbs * costoBs).toFixed(2));

    const movRes = await db.execute({
      sql: `
        INSERT INTO movimientos 
        (tipo, subtipo, fecha, numero_documento, nro_control, usuario_responsable, 
         observaciones, tasa_bcv, fecha_tasa_bcv, moneda_operacion, metodo_valoracion, estatus_conciliacion)
        VALUES (?, ?, ?, ?, 'CTRL-AUD-OCT26', ?, ?, ?, ?, 'USD', 'CPP', 'CONCILIADO')
        RETURNING id
      `,
      args: [
        tipo,
        subtipo,
        fecha,
        nroDoc,
        usuario,
        obsCompleta,
        tasaNum,
        fecha
      ]
    });

    const movId = Number(movRes.rows[0]?.id || movRes.lastInsertRowid);

    await db.execute({
      sql: `
        INSERT INTO movimiento_detalles 
        (movimiento_id, producto_id, cantidad, costo_unitario_usd, costo_unitario_ves,
         costo_unitario_divisa, costo_unitario_bs, tasa_bcv_operacion,
         base_imponible_bs, base_imponible_divisa, total_linea_bs, total_linea_divisa)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        movId,
        p.id,
        diffAbs,
        costoAplicar,
        costoBs,
        costoAplicar,
        costoBs,
        tasaNum,
        totalBs,
        totalDivisa,
        totalBs,
        totalDivisa
      ]
    });

    movimientoGenerado = {
      id: movId,
      tipo,
      subtipo,
      diferencia: diff,
      numero_documento: nroDoc,
      impacto_usd: totalDivisa,
      impacto_bs: totalBs
    };
  }

  await db.execute({
    sql: `
      UPDATE productos 
      SET costo_referencial_usd = ?,
          costo_auditado_usd = ?,
          precio_venta_usd = ?,
          stock_auditado_fisico = ?,
          fecha_auditoria_punto_cero = ?,
          auditado = ?,
          fecha_auditoria = ?,
          usuario_auditoria = ?,
          inactivo = ?,
          activo = ?,
          conteo_fisico_cierre = ?,
          fecha_conteo_fisico = ?,
          observacion_auditoria = ?
      WHERE id = ?
    `,
    args: [
      nuevoCosto,
      nuevoCosto,
      nuevoPrecio,
      cantReal,
      fecha,
      isAuditado,
      fecha,
      usuario,
      isInactive,
      isActivo,
      cantReal,
      fecha,
      `Auditado interactivo (${fecha}) por ${usuario}`,
      p.id
    ]
  });

  const statsRes = await db.execute(`
    SELECT 
      COUNT(*) AS total,
      SUM(CASE WHEN auditado = 1 THEN 1 ELSE 0 END) AS auditados,
      SUM(CASE WHEN inactivo = 1 OR activo = 0 THEN 1 ELSE 0 END) AS inactivos
    FROM productos
  `);

  const total = Number(statsRes.rows[0]?.total || 0);
  const auditados = Number(statsRes.rows[0]?.auditados || 0);
  const pendientes = Math.max(0, total - auditados);
  const porcentaje = total > 0 ? Number(((auditados / total) * 100).toFixed(1)) : 0;

  return {
    success: true,
    mensaje: `✅ [${p.codigo}] actualizado y marcado como Auditado.`,
    producto_id: p.id,
    codigo: p.codigo,
    movimiento_ajuste: movimientoGenerado,
    producto_actualizado: {
      producto_id: p.id,
      codigo: p.codigo,
      stock_actual: cantReal,
      stock_fisico: cantReal,
      diferencia: 0,
      costo_s_iva_usd: nuevoCosto,
      costo_iva_usd: Number((nuevoCosto * 0.16).toFixed(2)),
      costo_total_usd: Number((nuevoCosto * 1.16).toFixed(2)),
      precio_venta_s_iva_usd: nuevoPrecio,
      precio_venta_iva_usd: Number((nuevoPrecio * 0.16).toFixed(2)),
      precio_venta_total_usd: Number((nuevoPrecio * 1.16).toFixed(2)),
      auditado: isAuditado,
      inactivo: isInactive
    },
    estadisticas: {
      total_productos: total,
      auditados,
      pendientes,
      porcentaje_auditado: porcentaje,
      inactivos: Number(statsRes.rows[0]?.inactivos || 0)
    }
  };
}

export async function toggleAuditadoProducto(productoId, auditado, db) {
  const isAuditado = Number(auditado) === 1 ? 1 : 0;
  const fecha = isAuditado ? new Date().toISOString().slice(0, 10) : null;

  await db.execute({
    sql: `UPDATE productos SET auditado = ?, fecha_auditoria = ? WHERE id = ?`,
    args: [isAuditado, fecha, productoId]
  });

  const statsRes = await db.execute(`
    SELECT 
      COUNT(*) AS total,
      SUM(CASE WHEN auditado = 1 THEN 1 ELSE 0 END) AS auditados
    FROM productos
  `);

  const total = Number(statsRes.rows[0]?.total || 0);
  const auditados = Number(statsRes.rows[0]?.auditados || 0);
  const pendientes = Math.max(0, total - auditados);
  const porcentaje = total > 0 ? Number(((auditados / total) * 100).toFixed(1)) : 0;

  return {
    success: true,
    producto_id: productoId,
    auditado: isAuditado,
    estadisticas: {
      total_productos: total,
      auditados,
      pendientes,
      porcentaje_auditado: porcentaje
    }
  };
}

export { getMatrizAuditoriaProductos, generarExcelMatrizAuditoria, procesarMatrizAuditada } from './auditoria_legacy_export.js';
