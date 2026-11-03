import { createClient } from "@libsql/client";
import dotenv from "dotenv";
dotenv.config();

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

async function run() {
  const res = await client.execute(`
    SELECT 
      p.id, p.codigo, p.descripcion, COALESCE(c.nombre, 'GENERAL') as categoria,
      p.stock_minimo,
      v.stock_actual,
      COALESCE(SUM(md.cantidad), 0) as unidades_vendidas,
      ROUND(COALESCE(SUM(COALESCE(md.total_linea_divisa, md.cantidad * p.costo_referencial_usd)), 0), 2) as total_ventas_usd,
      ROUND(COALESCE(SUM(COALESCE(md.total_linea_bs, md.cantidad * p.costo_referencial_usd * 889.58)), 0), 2) as total_ventas_bs
    FROM productos p
    JOIN vista_inventario_actual v ON p.id = v.producto_id
    LEFT JOIN categorias c ON p.categoria_id = c.id
    JOIN movimiento_detalles md ON p.id = md.producto_id
    JOIN movimientos m ON md.movimiento_id = m.id
    WHERE m.tipo = 'SALIDA_VENTA'
    GROUP BY p.id
    ORDER BY unidades_vendidas DESC
    LIMIT 5
  `);
  console.log("Turso Cloud Top Sales:", res.rows);
}
run();

