import { createClient } from "@libsql/client";
const db = createClient({ url: "file:inventario_dg67.db" });

async function run() {
  const sinConciliar = await db.execute(`
    SELECT periodo, fecha, rif, razon_social, nro_factura, nro_control, 
           base_imponible_bs, iva_bs, total_bs, tasa_bcv, total_divisa, estatus_conciliacion, movimiento_id
    FROM libro_compras
    WHERE aplica_inventario = 1 AND (movimiento_id IS NULL OR estatus_conciliacion != 'CONCILIADO')
    ORDER BY periodo, fecha
  `);
  console.log(`=== TOTAL FACTURAS MERCANCIA NO CONCILIADAS: ${sinConciliar.rows.length} ===`);
  sinConciliar.rows.forEach((r, idx) => {
    console.log(`${idx+1}. [${r.periodo}] Fecha: ${r.fecha} | Fac: ${r.nro_factura} (Ctrl: ${r.nro_control}) | Prov: ${r.razon_social} (${r.rif}) | Base Bs: ${Number(r.base_imponible_bs).toLocaleString('es-VE')} | IVA: ${Number(r.iva_bs).toLocaleString('es-VE')} | Total Bs: ${Number(r.total_bs).toLocaleString('es-VE')} | USD: $${Number(r.total_divisa).toFixed(2)} | Tasa: ${r.tasa_bcv}`);
  });

  const totalesLibro = await db.execute(`
    SELECT periodo,
           COUNT(CASE WHEN aplica_inventario = 1 THEN 1 END) as cant_mercancia,
           ROUND(SUM(CASE WHEN aplica_inventario = 1 THEN total_bs ELSE 0 END), 2) as total_mercancia_bs,
           ROUND(SUM(CASE WHEN aplica_inventario = 1 THEN total_divisa ELSE 0 END), 2) as total_mercancia_usd,
           COUNT(CASE WHEN aplica_inventario = 0 THEN 1 END) as cant_servicios,
           ROUND(SUM(CASE WHEN aplica_inventario = 0 THEN total_bs ELSE 0 END), 2) as total_servicios_bs,
           ROUND(SUM(CASE WHEN aplica_inventario = 0 THEN total_divisa ELSE 0 END), 2) as total_servicios_usd
    FROM libro_compras
    GROUP BY periodo
    ORDER BY periodo
  `);
  console.log("\n=== TOTALES LIBRO DE COMPRAS POR MES ===");
  console.table(totalesLibro.rows);

  const totalesMov = await db.execute(`
    SELECT strftime('%Y-%m', m.fecha) as mes,
           m.tipo,
           COUNT(DISTINCT m.id) as cant_movimientos,
           SUM(d.cantidad) as total_unidades,
           ROUND(SUM(d.cantidad * d.costo_unitario_ves), 2) as total_costo_bs,
           ROUND(SUM(d.cantidad * d.costo_unitario_usd), 2) as total_costo_usd
    FROM movimientos m
    JOIN movimiento_detalles d ON m.id = d.movimiento_id
    WHERE m.tipo IN ('ENTRADA_COMPRA', 'INVENTARIO_INICIAL')
    GROUP BY strftime('%Y-%m', m.fecha), m.tipo
    ORDER BY mes
  `);
  console.log("\n=== TOTALES ENTRADAS Y SALDOS FISICOS ALMACEN POR MES ===");
  console.table(totalesMov.rows);

  const febDetalles = await db.execute(`
    SELECT m.numero_documento, m.observaciones, p.razon_social as prov, COUNT(d.id) as lineas,
           SUM(d.cantidad) as total_unidades,
           ROUND(SUM(d.cantidad * d.costo_unitario_ves), 2) as total_bs,
           ROUND(SUM(d.cantidad * d.costo_unitario_usd), 2) as total_usd
    FROM movimientos m
    LEFT JOIN proveedores p ON m.proveedor_id = p.id
    JOIN movimiento_detalles d ON m.id = d.movimiento_id
    WHERE m.tipo = 'ENTRADA_COMPRA' AND m.fecha LIKE '2026-02%'
    GROUP BY m.id
    ORDER BY total_bs DESC
  `);
  console.log(`\n=== ENTRADAS FISICAS DE FEBRERO (TOTAL: ${febDetalles.rows.length}) ===`);
  febDetalles.rows.forEach((r, idx) => {
    console.log(`${idx+1}. Doc: ${r.numero_documento} | Prov: ${r.prov} | Obs: ${r.observaciones} | Unids: ${r.total_unidades} | Total Bs: ${Number(r.total_bs).toLocaleString('es-VE')} | Total USD: $${r.total_usd}`);
  });
}
run();
