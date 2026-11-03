/**
 * functions/lib/auditoria_punto_cero.js
 * Sub-módulo de Auditoría y Sinceración de Inventario (Punto Cero) en Tiempo Real
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
    inactivo = 0,
    auditado = 1,
    fecha = '2026-10-31',
    tasa_bcv = 889.58,
    usuario = 'ADMIN_DG67',
    observaciones = 'Auditoría interactiva en tiempo real (Punto Cero Octubre 2026)'
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

  const tieneCosto = (costo_s_iva_usd !== null && costo_s_iva_usd !== undefined && costo_s_iva_usd !== '' && !isNaN(Number(costo_s_iva_usd)) && Number(costo_s_iva_usd) >= 0);
  const nuevoCosto = tieneCosto ? Number(Number(costo_s_iva_usd).toFixed(2)) : Number(p.costo_referencial_usd || 0);

  const tienePrecio = (precio_venta_s_iva_usd !== null && precio_venta_s_iva_usd !== undefined && precio_venta_s_iva_usd !== '' && !isNaN(Number(precio_venta_s_iva_usd)) && Number(precio_venta_s_iva_usd) > 0);
  const nuevoPrecio = tienePrecio ? Number(Number(precio_venta_s_iva_usd).toFixed(2)) : Number(p.precio_venta_usd || (nuevoCosto * 1.30));

  const isInactive = Number(inactivo) === 1 ? 1 : 0;
  const isActivo = isInactive === 1 ? 0 : 1;
  const isAuditado = Number(auditado) === 1 ? 1 : 0;

  let movimientoGenerado = null;
  const diff = Number((cantReal - stockActual).toFixed(2));
  const timestamp = Date.now().toString().slice(-6);

  if (tieneFisico && diff !== 0) {
    const isSobrante = diff > 0;
    const tipo = 'AJUSTE';
    const subtipo = isSobrante ? 'AJUSTE_POSITIVO_SINCERACION' : 'AJUSTE_NEGATIVO_AUDITORIA';
    const docPrefix = isSobrante ? 'SINCERACION-ENTRADA' : 'AUDITORIA-SALIDA';
    const nroDoc = `${docPrefix}-${p.codigo}-${timestamp}`;
    const diffAbs = Math.abs(diff);

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
        `${observaciones} - [${p.codigo}] ${p.descripcion}. Diff: ${diff > 0 ? '+' : ''}${diff} unds`,
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
