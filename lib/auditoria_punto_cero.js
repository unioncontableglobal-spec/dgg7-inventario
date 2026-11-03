/**
 * lib/auditoria_punto_cero.js
 * Sub-módulo de Auditoría y Sinceración de Inventario (Punto Cero)
 * Compatible con @libsql/client (SQLite local y Turso Cloud)
 * Cumple con Providencia Administrativa SENIAT PA SNAT/2026/00093 y Art. 177 RISLR
 * Alimenta y ajusta costos, precios de venta y cantidades en el mes de Octubre 2026
 */

/**
 * Fase 1: Genera la matriz completa de productos para auditoría física
 * Estructura exacta de 15 columnas requerida por la administración
 */
export async function getMatrizAuditoriaProductos(db) {
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
      COALESCE(p.inactivo, 0) AS inactivo,
      COALESCE(p.activo, 1) AS activo,
      -- Precio de venta referencial prioritario: 1) precio_venta_usd de catálogo, 2) última venta, 3) costo + 30%
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

  // Mapear filas con la estructura matemática exacta solicitada
  return res.rows.map(r => {
    const costoHist = Number(Number(r.costo_historico_s_iva).toFixed(2));
    const ivaCosto = Number((costoHist * 0.16).toFixed(2));
    const totalCosto = Number((costoHist + ivaCosto).toFixed(2));

    const precioVenta = Number(Number(r.precio_venta_s_iva).toFixed(2));
    const ivaVenta = Number((precioVenta * 0.16).toFixed(2));
    const precioTotal = Number((precioVenta + ivaVenta).toFixed(2));

    const estatusActual = (r.inactivo === 1 || r.activo === 0) ? 'Inactivo' : 'Activo';

    return {
      producto_id: r.producto_id,
      codigo: r.codigo,
      descripcion: r.descripcion,
      unidad_medida: r.unidad_medida,
      almacen: r.almacen,
      categoria: r.categoria,
      stock_actual: Number(r.stock_actual) || 0,
      costo_historico_s_iva: costoHist,
      iva_costo: ivaCosto,
      total_costo: totalCosto,
      precio_venta_s_iva: precioVenta,
      iva_venta: ivaVenta,
      precio_total: precioTotal,
      // Columnas para llenado en tienda:
      cantidad_fisica_real: null,
      costo_actualizado_s_iva: null,
      estatus: estatusActual
    };
  });
}

/**
 * Convierte la matriz de productos en un libro de trabajo Excel (XLSX) con diseño profesional
 */
export function generarExcelMatrizAuditoria(matriz, XLSX) {
  const headers = [
    'Código de Producto',
    'Descripción',
    'Unidad de Medida',
    'Almacén',
    'Categoría',
    'Stock Actual',
    'Costo Histórico S/IVA',
    'IVA',
    'Total Costo',
    'Precio de Venta S/IVA',
    'IVA Venta',
    'Precio Total',
    'CANTIDAD FÍSICA REAL',
    'COSTO ACTUALIZADO S/IVA',
    'ESTATUS'
  ];

  const dataRows = matriz.map(r => [
    r.codigo,
    r.descripcion,
    r.unidad_medida,
    r.almacen,
    r.categoria,
    r.stock_actual,
    r.costo_historico_s_iva,
    r.iva_costo,
    r.total_costo,
    r.precio_venta_s_iva,
    r.iva_venta,
    r.precio_total,
    '', // CANTIDAD FÍSICA REAL (vacía para llenar en tienda)
    '', // COSTO ACTUALIZADO S/IVA (vacía para llenar en tienda)
    r.estatus // Activo por defecto
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);

  // Anchos de columnas ajustados
  ws['!cols'] = [
    { wch: 16 }, // Código
    { wch: 45 }, // Descripción
    { wch: 12 }, // Unidad
    { wch: 18 }, // Almacén
    { wch: 20 }, // Categoría
    { wch: 14 }, // Stock Actual
    { wch: 18 }, // Costo Histórico
    { wch: 12 }, // IVA
    { wch: 14 }, // Total Costo
    { wch: 18 }, // Precio Venta
    { wch: 12 }, // IVA Venta
    { wch: 14 }, // Precio Total
    { wch: 24 }, // CANTIDAD FÍSICA REAL
    { wch: 26 }, // COSTO ACTUALIZADO S/IVA
    { wch: 16 }  // ESTATUS
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MATRIZ_PUNTO_CERO');

  return wb;
}

/**
 * Fase 2: Procesa la matriz auditada subida por la tienda
 * - Aplica ajustes en el mes de Octubre 2026 (por defecto '2026-10-31')
 * - Calcula diferencias de Kardex (Salida por Ajuste si teórico > real, Entrada por Sinceración si teórico < real)
 * - Actualiza costo promedio ponderado en el maestro
 * - Actualiza precio de venta en el catálogo maestro
 * - Aplica Soft Delete (inactivo=1, activo=0) sin eliminar registros relacionales
 */
export async function procesarMatrizAuditada(itemsAuditados, opciones = {}, db) {
  const {
    fecha = '2026-10-31', // Ajuste oficial al corte de Octubre 2026
    tasa_bcv = 889.58,
    usuario_responsable = 'AUDITOR_SISTEMA_DG67',
    observaciones = 'Sinceración y Auditoría General de Inventario (Punto Cero Octubre 2026)',
    simular = false
  } = opciones;

  // 1. Obtener estado actual de todos los productos
  const matrizActual = await getMatrizAuditoriaProductos(db);
  const mapaProductos = new Map();
  for (const p of matrizActual) {
    mapaProductos.set(String(p.codigo).trim().toUpperCase(), p);
  }

  const tasaNum = Number(tasa_bcv) > 0 ? Number(tasa_bcv) : 889.58;

  const sobrantesEntrada = []; // Teórico < Real -> Entrada por Ajuste (Sinceración)
  const faltantesSalida = [];   // Teórico > Real -> Salida por Ajuste (Merma / Descuadre)
  const actualizacionesCosto = [];
  const actualizacionesPrecioVenta = [];
  const softDeletes = [];
  const reactivados = [];
  const sinCambios = [];
  const noEncontrados = [];

  for (const item of itemsAuditados) {
    const rawCod = String(item.codigo || item['Código de Producto'] || item['Codigo'] || '').trim().toUpperCase();
    if (!rawCod) continue;

    const prodActual = mapaProductos.get(rawCod);
    if (!prodActual) {
      noEncontrados.push(rawCod);
      continue;
    }

    // Leer valores provistos por la tienda en la matriz
    const rawFisico = item.cantidad_fisica_real ?? item['CANTIDAD FÍSICA REAL'] ?? item['CANTIDAD FISICA REAL'] ?? item['Cantidad Real'];
    const rawCosto = item.costo_actualizado_s_iva ?? item['COSTO ACTUALIZADO S/IVA'] ?? item['COSTO ACTUALIZADO'] ?? item['Nuevo Costo'];
    const rawPrecioVenta = item.precio_venta_s_iva ?? item['Precio de Venta S/IVA'] ?? item['PRECIO DE VENTA S/IVA'] ?? item['Precio Venta'] ?? item['Precio ($)'] ?? null;
    const rawEstatus = String(item.estatus ?? item['ESTATUS'] ?? '').trim().toLowerCase();

    const stockActual = Number(prodActual.stock_actual);
    const tieneConteoFisico = (rawFisico !== null && rawFisico !== undefined && rawFisico !== '' && !isNaN(Number(rawFisico)));
    const cantidadReal = tieneConteoFisico ? Number(Number(rawFisico).toFixed(2)) : stockActual;

    const tieneNuevoCosto = (rawCosto !== null && rawCosto !== undefined && rawCosto !== '' && !isNaN(Number(rawCosto)) && Number(rawCosto) >= 0);
    const nuevoCosto = tieneNuevoCosto ? Number(Number(rawCosto).toFixed(2)) : prodActual.costo_historico_s_iva;

    const tieneNuevoPrecioVenta = (rawPrecioVenta !== null && rawPrecioVenta !== undefined && rawPrecioVenta !== '' && !isNaN(Number(rawPrecioVenta)) && Number(rawPrecioVenta) > 0);
    const nuevoPrecioVenta = tieneNuevoPrecioVenta ? Number(Number(rawPrecioVenta).toFixed(2)) : prodActual.precio_venta_s_iva;

    // A. Evaluar Soft Delete
    let nuevoInactivo = prodActual.inactivo;
    if (rawEstatus === 'inactivo' || rawEstatus === 'baja' || rawEstatus === 'desincorporado') {
      nuevoInactivo = 1;
      softDeletes.push({
        producto_id: prodActual.producto_id,
        codigo: prodActual.codigo,
        descripcion: prodActual.descripcion,
        motivo: 'Marcado Inactivo en Auditoría de Inventario'
      });
    } else if (rawEstatus === 'activo') {
      if (prodActual.inactivo === 1) {
        reactivados.push({
          producto_id: prodActual.producto_id,
          codigo: prodActual.codigo,
          descripcion: prodActual.descripcion
        });
      }
      nuevoInactivo = 0;
    }

    // B. Evaluar Actualización de Costos
    if (tieneNuevoCosto && nuevoCosto !== prodActual.costo_historico_s_iva) {
      actualizacionesCosto.push({
        producto_id: prodActual.producto_id,
        codigo: prodActual.codigo,
        descripcion: prodActual.descripcion,
        costo_anterior_usd: prodActual.costo_historico_s_iva,
        costo_nuevo_usd: nuevoCosto,
        costo_nuevo_bs: Number((nuevoCosto * tasaNum).toFixed(2))
      });
    }

    // C. Evaluar Actualización de Precios de Venta
    if (tieneNuevoPrecioVenta && nuevoPrecioVenta !== prodActual.precio_venta_s_iva) {
      actualizacionesPrecioVenta.push({
        producto_id: prodActual.producto_id,
        codigo: prodActual.codigo,
        descripcion: prodActual.descripcion,
        precio_anterior_usd: prodActual.precio_venta_s_iva,
        precio_nuevo_usd: nuevoPrecioVenta,
        precio_nuevo_bs: Number((nuevoPrecioVenta * tasaNum).toFixed(2))
      });
    }

    // D. Evaluar Diferencias de Stock
    if (tieneConteoFisico) {
      const diff = Number((cantidadReal - stockActual).toFixed(2));
      if (diff > 0) {
        // Stock Actual < Cantidad Real -> Entrada por Sinceración
        sobrantesEntrada.push({
          producto_id: prodActual.producto_id,
          codigo: prodActual.codigo,
          descripcion: prodActual.descripcion,
          stock_anterior: stockActual,
          stock_real: cantidadReal,
          diferencia: diff,
          costo_unitario_usd: nuevoCosto,
          costo_unitario_bs: Number((nuevoCosto * tasaNum).toFixed(2)),
          total_linea_usd: Number((diff * nuevoCosto).toFixed(2)),
          total_linea_bs: Number((diff * nuevoCosto * tasaNum).toFixed(2))
        });
      } else if (diff < 0) {
        // Stock Actual > Cantidad Real -> Salida por Ajuste (Faltante / Merma)
        const absDiff = Math.abs(diff);
        const costoAplicar = nuevoCosto > 0 ? nuevoCosto : prodActual.costo_historico_s_iva;
        faltantesSalida.push({
          producto_id: prodActual.producto_id,
          codigo: prodActual.codigo,
          descripcion: prodActual.descripcion,
          stock_anterior: stockActual,
          stock_real: cantidadReal,
          diferencia: absDiff,
          costo_unitario_usd: costoAplicar,
          costo_unitario_bs: Number((costoAplicar * tasaNum).toFixed(2)),
          total_linea_usd: Number((absDiff * costoAplicar).toFixed(2)),
          total_linea_bs: Number((absDiff * costoAplicar * tasaNum).toFixed(2))
        });
      } else {
        sinCambios.push(prodActual.codigo);
      }
    } else {
      sinCambios.push(prodActual.codigo);
    }
  }

  // Totales de auditoría
  const totalEntradaUsd = sobrantesEntrada.reduce((sum, item) => sum + item.total_linea_usd, 0);
  const totalEntradaBs = sobrantesEntrada.reduce((sum, item) => sum + item.total_linea_bs, 0);
  const totalSalidaUsd = faltantesSalida.reduce((sum, item) => sum + item.total_linea_usd, 0);
  const totalSalidaBs = faltantesSalida.reduce((sum, item) => sum + item.total_linea_bs, 0);

  const resumen = {
    fecha,
    tasa_bcv: tasaNum,
    total_auditados: itemsAuditados.length,
    productos_sin_diferencias: sinCambios.length,
    entradas_sinceracion: {
      cantidad_productos: sobrantesEntrada.length,
      unidades_totales: sobrantesEntrada.reduce((sum, i) => sum + i.diferencia, 0),
      total_usd: Number(totalEntradaUsd.toFixed(2)),
      total_bs: Number(totalEntradaBs.toFixed(2)),
      detalle: sobrantesEntrada
    },
    salidas_ajuste: {
      cantidad_productos: faltantesSalida.length,
      unidades_totales: faltantesSalida.reduce((sum, i) => sum + i.diferencia, 0),
      total_usd: Number(totalSalidaUsd.toFixed(2)),
      total_bs: Number(totalSalidaBs.toFixed(2)),
      detalle: faltantesSalida
    },
    actualizaciones_costo: {
      cantidad: actualizacionesCosto.length,
      detalle: actualizacionesCosto
    },
    actualizaciones_precio_venta: {
      cantidad: actualizacionesPrecioVenta.length,
      detalle: actualizacionesPrecioVenta
    },
    depuracion_soft_delete: {
      inactivados: softDeletes.length,
      reactivados: reactivados.length,
      detalle_inactivados: softDeletes
    },
    no_encontrados: noEncontrados
  };

  // Si solo era simulación / vista previa, devolver sin modificar la base de datos
  if (simular) {
    return {
      simulacion: true,
      mensaje: 'Simulación de Auditoría (Punto Cero Octubre 2026) calculada exitosamente. No se han aplicado cambios definitivos.',
      resumen
    };
  }

  // --- EJECUCIÓN DEFINITIVA DE LA AUDITORÍA (PUNTO CERO OCTUBRE 2026) ---
  const batchStatements = [];
  const timestamp = Date.now().toString().slice(-6);

  // 1. Crear Asiento Consolidado de ENTRADA por Ajuste (Sinceración / Sobrantes)
  let movimientoEntradaId = null;
  if (sobrantesEntrada.length > 0) {
    const headerEntrada = await db.execute({
      sql: `INSERT INTO movimientos 
            (tipo, subtipo, fecha, numero_documento, nro_control, usuario_responsable, 
             observaciones, tasa_bcv, fecha_tasa_bcv, moneda_operacion, metodo_valoracion, estatus_conciliacion)
            VALUES ('AJUSTE', 'AJUSTE_POSITIVO_SINCERACION', ?, ?, 'CTRL-AUD-OCT26', ?, ?, ?, ?, 'USD', 'CPP', 'CONCILIADO')
            RETURNING id`,
      args: [
        fecha,
        `ACTA-SINCERACION-ENTRADA-${timestamp}`,
        usuario_responsable,
        `${observaciones} - Entrada por Sinceración (${sobrantesEntrada.length} productos con sobrante físico)`,
        tasaNum,
        fecha
      ]
    });
    movimientoEntradaId = Number(headerEntrada.rows[0]?.id || headerEntrada.lastInsertRowid);

    for (const it of sobrantesEntrada) {
      batchStatements.push({
        sql: `INSERT INTO movimiento_detalles 
              (movimiento_id, producto_id, cantidad, costo_unitario_usd, costo_unitario_ves,
               costo_unitario_divisa, costo_unitario_bs, tasa_bcv_operacion,
               base_imponible_bs, base_imponible_divisa, total_linea_bs, total_linea_divisa)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          movimientoEntradaId,
          it.producto_id,
          it.diferencia,
          it.costo_unitario_usd,
          it.costo_unitario_bs,
          it.costo_unitario_usd,
          it.costo_unitario_bs,
          tasaNum,
          it.total_linea_bs,
          it.total_linea_usd,
          it.total_linea_bs,
          it.total_linea_usd
        ]
      });
    }
  }

  // 2. Crear Asiento Consolidado de SALIDA por Ajuste (Faltantes / Mermas)
  let movimientoSalidaId = null;
  if (faltantesSalida.length > 0) {
    const headerSalida = await db.execute({
      sql: `INSERT INTO movimientos 
            (tipo, subtipo, fecha, numero_documento, nro_control, usuario_responsable, 
             observaciones, tasa_bcv, fecha_tasa_bcv, moneda_operacion, metodo_valoracion, estatus_conciliacion)
            VALUES ('AJUSTE', 'AJUSTE_NEGATIVO_AUDITORIA', ?, ?, 'CTRL-AUD-OCT26', ?, ?, ?, ?, 'USD', 'CPP', 'CONCILIADO')
            RETURNING id`,
      args: [
        fecha,
        `ACTA-AUDITORIA-SALIDA-${timestamp}`,
        usuario_responsable,
        `${observaciones} - Salida por Ajuste Faltante (${faltantesSalida.length} productos con merma/faltante)`,
        tasaNum,
        fecha
      ]
    });
    movimientoSalidaId = Number(headerSalida.rows[0]?.id || headerSalida.lastInsertRowid);

    for (const it of faltantesSalida) {
      batchStatements.push({
        sql: `INSERT INTO movimiento_detalles 
              (movimiento_id, producto_id, cantidad, costo_unitario_usd, costo_unitario_ves,
               costo_unitario_divisa, costo_unitario_bs, tasa_bcv_operacion,
               base_imponible_bs, base_imponible_divisa, total_linea_bs, total_linea_divisa)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          movimientoSalidaId,
          it.producto_id,
          it.diferencia,
          it.costo_unitario_usd,
          it.costo_unitario_bs,
          it.costo_unitario_usd,
          it.costo_unitario_bs,
          tasaNum,
          it.total_linea_bs,
          it.total_linea_usd,
          it.total_linea_bs,
          it.total_linea_usd
        ]
      });
    }
  }

  // 3. Actualizar Maestro de Productos (Costos, Precios de Venta, Stock Físico Auditado, Fecha Punto Cero)
  for (const it of itemsAuditados) {
    const rawCod = String(it.codigo || it['Código de Producto'] || it['Codigo'] || '').trim().toUpperCase();
    const prodActual = mapaProductos.get(rawCod);
    if (!prodActual) continue;

    const rawFisico = it.cantidad_fisica_real ?? it['CANTIDAD FÍSICA REAL'] ?? it['CANTIDAD FISICA REAL'] ?? it['Cantidad Real'];
    const rawCosto = it.costo_actualizado_s_iva ?? it['COSTO ACTUALIZADO S/IVA'] ?? it['COSTO ACTUALIZADO'] ?? it['Nuevo Costo'];
    const rawPrecioVenta = it.precio_venta_s_iva ?? it['Precio de Venta S/IVA'] ?? it['PRECIO DE VENTA S/IVA'] ?? it['Precio Venta'] ?? it['Precio ($)'] ?? null;
    const rawEstatus = String(it.estatus ?? it['ESTATUS'] ?? '').trim().toLowerCase();

    const tieneConteo = (rawFisico !== null && rawFisico !== undefined && rawFisico !== '' && !isNaN(Number(rawFisico)));
    const tieneCosto = (rawCosto !== null && rawCosto !== undefined && rawCosto !== '' && !isNaN(Number(rawCosto)) && Number(rawCosto) >= 0);
    const tienePrecioVenta = (rawPrecioVenta !== null && rawPrecioVenta !== undefined && rawPrecioVenta !== '' && !isNaN(Number(rawPrecioVenta)) && Number(rawPrecioVenta) > 0);

    const fReal = tieneConteo ? Number(rawFisico) : prodActual.stock_actual;
    const cNuevo = tieneCosto ? Number(rawCosto) : prodActual.costo_historico_s_iva;
    const pVNuevo = tienePrecioVenta ? Number(rawPrecioVenta) : (prodActual.precio_venta_guardado || prodActual.precio_venta_s_iva);
    const isInactivo = (rawEstatus === 'inactivo' || rawEstatus === 'baja' || rawEstatus === 'desincorporado') ? 1 : (rawEstatus === 'activo' ? 0 : prodActual.inactivo);
    const isActivo = isInactivo === 1 ? 0 : 1;

    batchStatements.push({
      sql: `UPDATE productos 
            SET costo_referencial_usd = ?,
                costo_auditado_usd = ?,
                precio_venta_usd = ?,
                stock_auditado_fisico = ?,
                fecha_auditoria_punto_cero = ?,
                conteo_fisico_cierre = ?,
                fecha_conteo_fisico = ?,
                inactivo = ?,
                activo = ?,
                observacion_auditoria = ?
            WHERE id = ?`,
      args: [
        cNuevo,
        cNuevo,
        pVNuevo,
        fReal,
        fecha,
        fReal,
        fecha,
        isInactivo,
        isActivo,
        `Auditado y Sincerado en Punto Cero (${fecha}) por ${usuario_responsable}`,
        prodActual.producto_id
      ]
    });
  }

  // Ejecutar statements en lotes de 100 para no exceder límites de payload de red
  const CHUNK_SIZE = 100;
  for (let i = 0; i < batchStatements.length; i += CHUNK_SIZE) {
    const chunk = batchStatements.slice(i, i + CHUNK_SIZE);
    await db.batch(chunk, 'write');
  }

  return {
    success: true,
    mensaje: `✅ Auditoría y Sinceración de Inventario (Punto Cero Octubre 2026) completada con éxito. Se generaron los asientos de ajuste en Kardex para Octubre y se sincronizaron costos, precios de venta y existencias.`,
    movimiento_entrada_id: movimientoEntradaId,
    movimiento_salida_id: movimientoSalidaId,
    resumen
  };
}
