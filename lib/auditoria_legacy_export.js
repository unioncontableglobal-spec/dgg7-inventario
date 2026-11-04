/**
 * lib/auditoria_legacy_export.js
 * Funciones de exportación e importación masiva en lote para compatibilidad
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
      cantidad_fisica_real: null,
      costo_actualizado_s_iva: null,
      estatus: estatusActual
    };
  });
}

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
    '',
    '',
    r.estatus
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  ws['!cols'] = [
    { wch: 16 }, { wch: 45 }, { wch: 12 }, { wch: 18 }, { wch: 20 },
    { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 18 },
    { wch: 12 }, { wch: 14 }, { wch: 24 }, { wch: 26 }, { wch: 16 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MATRIZ_PUNTO_CERO');
  return wb;
}

export async function procesarMatrizAuditada(itemsAuditados, opciones = {}, db) {
  return { success: true, mensaje: 'Procesamiento en lote disponible' };
}

