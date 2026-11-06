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
    codigo,
    descripcion,
    unidad_medida,
    categoria,
    almacen,
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
        p.id, p.codigo, p.descripcion, p.unidad_medida, p.categoria_id, p.almacen_id,
        p.costo_referencial_usd, p.precio_venta_usd,
        p.inactivo, p.activo, COALESCE(v.stock_actual, 0) as stock_actual,
        COALESCE(c.nombre, 'GENERAL') as categoria_nombre,
        COALESCE(a.nombre, 'AUTOPERIQUITOS') as almacen_nombre
      FROM productos p
      LEFT JOIN vista_inventario_actual v ON p.id = v.producto_id
      LEFT JOIN categorias c ON p.categoria_id = c.id
      LEFT JOIN almacenes a ON p.almacen_id = a.id
      WHERE p.id = ?
    `,
    args: [productoId]
  });

  if (prodRes.rows.length === 0) {
    throw new Error(`Producto con ID ${productoId} no encontrado en la base de datos.`);
  }

  const periodo = fecha.slice(0, 7);
  const estatusActa = await db.execute({
    sql: "SELECT estatus FROM actas_toma_fisica WHERE periodo = ? LIMIT 1",
    args: [periodo]
  }).catch(() => ({ rows: [] }));
  if (estatusActa.rows && estatusActa.rows[0] && estatusActa.rows[0].estatus === 'CERRADA') {
    throw new Error(`La Toma Física del período ${periodo} está formalmente CERRADA y sellada. No se admiten modificaciones.`);
  }

  const p = prodRes.rows[0];

  // Actualización de código (si cambió y no colisiona)
  let nuevoCodigo = p.codigo;
  if (codigo && String(codigo).trim() !== '' && String(codigo).trim().toUpperCase() !== String(p.codigo).toUpperCase()) {
    const codTrim = String(codigo).trim().toUpperCase();
    const checkCod = await db.execute({
      sql: 'SELECT id FROM productos WHERE UPPER(codigo) = ? AND id != ? LIMIT 1',
      args: [codTrim, productoId]
    });
    if (checkCod.rows && checkCod.rows.length > 0) {
      throw new Error(`El código "${codTrim}" ya se encuentra asignado a otro producto.`);
    }
    nuevoCodigo = codTrim;
  }

  const nuevaDescripcion = (descripcion && String(descripcion).trim() !== '') ? String(descripcion).trim() : p.descripcion;
  const nuevaUnidad = (unidad_medida && String(unidad_medida).trim() !== '') ? String(unidad_medida).trim().toUpperCase() : (p.unidad_medida || 'UND');

  // Categoría
  let nuevaCatId = p.categoria_id;
  let nuevaCatNombre = p.categoria_nombre;
  if (categoria && String(categoria).trim() !== '') {
    const catNom = String(categoria).trim().toUpperCase();
    const catRes = await db.execute({
      sql: 'SELECT id, nombre FROM categorias WHERE UPPER(nombre) = ? LIMIT 1',
      args: [catNom]
    });
    if (catRes.rows && catRes.rows.length > 0) {
      nuevaCatId = catRes.rows[0].id;
      nuevaCatNombre = catRes.rows[0].nombre;
    } else {
      const insCat = await db.execute({
        sql: 'INSERT INTO categorias (nombre) VALUES (?) RETURNING id',
        args: [catNom]
      });
      nuevaCatId = Number(insCat.rows[0]?.id || insCat.lastInsertRowid);
      nuevaCatNombre = catNom;
    }
  }

  // Almacén
  let nuevoAlmId = p.almacen_id;
  let nuevoAlmNombre = p.almacen_nombre;
  if (almacen && String(almacen).trim() !== '') {
    const almNom = String(almacen).trim().toUpperCase();
    const almRes = await db.execute({
      sql: 'SELECT id, nombre FROM almacenes WHERE UPPER(codigo) = ? OR UPPER(nombre) = ? LIMIT 1',
      args: [almNom, almNom]
    });
    if (almRes.rows && almRes.rows.length > 0) {
      nuevoAlmId = almRes.rows[0].id;
      nuevoAlmNombre = almRes.rows[0].nombre;
    }
  }
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
      SET codigo = ?,
          descripcion = ?,
          unidad_medida = ?,
          categoria_id = COALESCE(?, categoria_id),
          almacen_id = COALESCE(?, almacen_id),
          costo_referencial_usd = ?,
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
      nuevoCodigo,
      nuevaDescripcion,
      nuevaUnidad,
      nuevaCatId,
      nuevoAlmId,
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
    mensaje: `✅ [${nuevoCodigo}] actualizado y marcado como Auditado.`,
    producto_id: p.id,
    codigo: nuevoCodigo,
    movimiento_ajuste: movimientoGenerado,
    producto_actualizado: {
      producto_id: p.id,
      codigo: nuevoCodigo,
      descripcion: nuevaDescripcion,
      unidad_medida: nuevaUnidad,
      categoria: nuevaCatNombre,
      almacen: nuevoAlmNombre,
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

export async function crearProductoAuditoria(payload, db) {
  const {
    codigo,
    descripcion,
    unidad_medida = 'UND',
    categoria = 'GENERAL',
    almacen = 'AUTOPERIQUITOS',
    cantidad_fisica_real = 0,
    costo_s_iva_bs,
    precio_venta_s_iva_bs,
    costo_s_iva_usd,
    precio_venta_s_iva_usd,
    fecha = '2026-10-31',
    tasa_bcv = 889.58,
    usuario = 'ADMIN_DG67',
    motivo_ajuste = 'SOBRANTE_AUDITORIA',
    justificacion_detalle = '',
    acta_vinculada = 'ACTA-INV-202610-01'
  } = payload;

  const cleanCodigo = String(codigo || '').trim().toUpperCase();
  if (!cleanCodigo) {
    throw new Error('El Código del repuesto es obligatorio.');
  }

  const cleanDesc = String(descripcion || '').trim();
  if (!cleanDesc) {
    throw new Error('El Nombre / Descripción del repuesto es obligatorio.');
  }

  const periodo = fecha.slice(0, 7);
  const estatusActa = await db.execute({
    sql: "SELECT estatus FROM actas_toma_fisica WHERE periodo = ? LIMIT 1",
    args: [periodo]
  }).catch(() => ({ rows: [] }));
  if (estatusActa.rows && estatusActa.rows[0] && estatusActa.rows[0].estatus === 'CERRADA') {
    throw new Error(`La Toma Física del período ${periodo} está formalmente CERRADA y sellada. No se admiten altas de repuestos.`);
  }

  // Verificar que el código no exista
  const checkCod = await db.execute({
    sql: "SELECT id, codigo FROM productos WHERE UPPER(codigo) = ? LIMIT 1",
    args: [cleanCodigo]
  });
  if (checkCod.rows && checkCod.rows.length > 0) {
    throw new Error(`El código "${cleanCodigo}" ya existe en el inventario.`);
  }

  const tasaNum = Number(tasa_bcv) > 0 ? Number(tasa_bcv) : 889.58;
  const cantReal = (!isNaN(Number(cantidad_fisica_real)) && Number(cantidad_fisica_real) >= 0)
    ? Number(Number(cantidad_fisica_real).toFixed(2))
    : 0;

  const tieneCostoBs = (costo_s_iva_bs !== null && costo_s_iva_bs !== undefined && costo_s_iva_bs !== '' && !isNaN(Number(costo_s_iva_bs)) && Number(costo_s_iva_bs) >= 0);
  const tieneCostoUsd = (costo_s_iva_usd !== null && costo_s_iva_usd !== undefined && costo_s_iva_usd !== '' && !isNaN(Number(costo_s_iva_usd)) && Number(costo_s_iva_usd) >= 0);
  const nuevoCostoUsd = tieneCostoBs
    ? Number((Number(costo_s_iva_bs) / tasaNum).toFixed(2))
    : (tieneCostoUsd ? Number(Number(costo_s_iva_usd).toFixed(2)) : 0);

  const tienePrecioBs = (precio_venta_s_iva_bs !== null && precio_venta_s_iva_bs !== undefined && precio_venta_s_iva_bs !== '' && !isNaN(Number(precio_venta_s_iva_bs)) && Number(precio_venta_s_iva_bs) > 0);
  const tienePrecioUsd = (precio_venta_s_iva_usd !== null && precio_venta_s_iva_usd !== undefined && precio_venta_s_iva_usd !== '' && !isNaN(Number(precio_venta_s_iva_usd)) && Number(precio_venta_s_iva_usd) > 0);
  const nuevoPrecioUsd = tienePrecioBs
    ? Number((Number(precio_venta_s_iva_bs) / tasaNum).toFixed(2))
    : (tienePrecioUsd ? Number(Number(precio_venta_s_iva_usd).toFixed(2)) : Number((nuevoCostoUsd * 1.30).toFixed(2)));

  const cleanUnidad = (unidad_medida && String(unidad_medida).trim() !== '')
    ? String(unidad_medida).trim().toUpperCase()
    : 'UND';

  // Categoría
  let catId = null;
  let catNombre = 'GENERAL';
  if (categoria && String(categoria).trim() !== '') {
    catNombre = String(categoria).trim().toUpperCase();
    const catRes = await db.execute({
      sql: "SELECT id, nombre FROM categorias WHERE UPPER(nombre) = ? LIMIT 1",
      args: [catNombre]
    });
    if (catRes.rows && catRes.rows.length > 0) {
      catId = catRes.rows[0].id;
      catNombre = catRes.rows[0].nombre;
    } else {
      const insCat = await db.execute({
        sql: "INSERT INTO categorias (nombre) VALUES (?) RETURNING id",
        args: [catNombre]
      });
      catId = Number(insCat.rows[0]?.id || insCat.lastInsertRowid);
    }
  }

  // Almacén
  let almId = 1;
  let almNombre = 'AUTOPERIQUITOS';
  if (almacen && String(almacen).trim() !== '') {
    const cleanAlm = String(almacen).trim().toUpperCase();
    const almRes = await db.execute({
      sql: "SELECT id, nombre FROM almacenes WHERE UPPER(codigo) = ? OR UPPER(nombre) = ? LIMIT 1",
      args: [cleanAlm, cleanAlm]
    });
    if (almRes.rows && almRes.rows.length > 0) {
      almId = almRes.rows[0].id;
      almNombre = almRes.rows[0].nombre;
    }
  }

  // Insertar producto
  const insProd = await db.execute({
    sql: `
      INSERT INTO productos (
        codigo, descripcion, unidad_medida, categoria_id, almacen_id,
        stock_minimo, costo_referencial_usd, costo_auditado_usd, precio_venta_usd,
        stock_auditado_fisico, conteo_fisico_cierre, fecha_conteo_fisico,
        auditado, fecha_auditoria, usuario_auditoria, fecha_auditoria_punto_cero,
        observacion_auditoria, inactivo, activo
      ) VALUES (
        ?, ?, ?, ?, ?,
        1.0, ?, ?, ?,
        ?, ?, ?,
        1, ?, ?, ?,
        ?, 0, 1
      ) RETURNING id
    `,
    args: [
      cleanCodigo,
      cleanDesc,
      cleanUnidad,
      catId,
      almId,
      nuevoCostoUsd,
      nuevoCostoUsd,
      nuevoPrecioUsd,
      cantReal,
      cantReal,
      fecha,
      fecha,
      usuario,
      fecha,
      `Alta en Toma Física (${fecha}) por ${usuario} [${acta_vinculada || 'ACTA-INV-202610-01'}]`
    ]
  });

  const nuevoProdId = Number(insProd.rows[0]?.id || insProd.lastInsertRowid);

  // Si tiene stock inicial físico > 0, registrar movimiento de ajuste en Kardex
  let movGenerado = null;
  const timestamp = Date.now().toString().slice(-6);

  if (cantReal > 0) {
    const docNum = `ALTA-TF-${cleanCodigo}-${timestamp}`;
    const costoBs = Number((nuevoCostoUsd * tasaNum).toFixed(2));
    const totalDivisa = Number((cantReal * nuevoCostoUsd).toFixed(2));
    const totalBs = Number((cantReal * costoBs).toFixed(2));

    let subtipoMov = 'AJUSTE_POSITIVO_SOBRANTE';
    if (motivo_ajuste === 'OMISION_COMPRA') subtipoMov = 'AJUSTE_POSITIVO_OMISION';
    else if (motivo_ajuste === 'INVENTARIO_INICIAL') subtipoMov = 'AJUSTE_POSITIVO_STOCK';
    else if (motivo_ajuste === 'RECLASIFICACION_CODIGO') subtipoMov = 'AJUSTE_POSITIVO_RECLASIF';

    const detalleSoporte = (justificacion_detalle || payload?.justificacionDetalle || '').trim();
    const obs = `[Alta en Toma Física] [Acta: ${acta_vinculada || 'ACTA-INV-202610-01'}] - [${cleanCodigo}] ${cleanDesc}. Conteo inicial en tienda: ${cantReal} ${cleanUnidad} (Art. 177 RISLR)${detalleSoporte ? ' - ' + detalleSoporte : ''}`;

    const movRes = await db.execute({
      sql: `
        INSERT INTO movimientos 
        (tipo, subtipo, fecha, numero_documento, nro_control, usuario_responsable, 
         observaciones, tasa_bcv, fecha_tasa_bcv, moneda_operacion, metodo_valoracion, estatus_conciliacion)
        VALUES ('AJUSTE', ?, ?, ?, 'CTRL-AUD-OCT26', ?, ?, ?, ?, 'USD', 'CPP', 'CONCILIADO')
        RETURNING id
      `,
      args: [
        subtipoMov,
        fecha,
        docNum,
        usuario,
        obs,
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
        nuevoProdId,
        cantReal,
        nuevoCostoUsd,
        costoBs,
        nuevoCostoUsd,
        costoBs,
        tasaNum,
        totalBs,
        totalDivisa,
        totalBs,
        totalDivisa
      ]
    });

    movGenerado = {
      id: movId,
      tipo: 'AJUSTE',
      subtipo: subtipoMov,
      numero_documento: docNum,
      cantidad: cantReal,
      costo_unitario_usd: nuevoCostoUsd,
      impacto_bs: totalBs,
      impacto_usd: totalDivisa
    };
  }

  // Recalcular métricas globales de auditoría
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

  const costoIVA = Number((nuevoCostoUsd * 0.16).toFixed(2));
  const costoTotal = Number((nuevoCostoUsd + costoIVA).toFixed(2));
  const precioIVA = Number((nuevoPrecioUsd * 0.16).toFixed(2));
  const precioTotal = Number((nuevoPrecioUsd + precioIVA).toFixed(2));

  return {
    success: true,
    mensaje: `✅ Repuesto [${cleanCodigo}] creado y registrado en la Toma Física.`,
    producto_creado: {
      producto_id: nuevoProdId,
      codigo: cleanCodigo,
      descripcion: cleanDesc,
      unidad_medida: cleanUnidad,
      almacen: almNombre,
      categoria: catNombre,
      stock_actual: cantReal,
      stock_fisico: cantReal,
      diferencia: 0,
      costo_s_iva_usd: nuevoCostoUsd,
      costo_iva_usd: costoIVA,
      costo_total_usd: costoTotal,
      precio_venta_s_iva_usd: nuevoPrecioUsd,
      precio_venta_iva_usd: precioIVA,
      precio_venta_total_usd: precioTotal,
      auditado: 1,
      fecha_auditoria: fecha,
      usuario_auditoria: usuario,
      inactivo: 0,
      activo: 1
    },
    movimiento_ajuste: movGenerado,
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
