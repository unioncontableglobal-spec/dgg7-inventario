import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config();

const TURSO_URL = 'libsql://inventario-dg67-unioncontableglobal-spec.aws-us-east-1.turso.io';
const TURSO_AUTH_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTI3NzEzNTEsImlkIjoiMDFhMTY5N2YtYTAwMS03MjNlLWI5NTYtNWExYjA0Yjk2OGI5Iiwia2lkIjoiUVl1M2JpWWk5QUZtZXY4TmZod0x4Z0FDMG9RQ0VGNXBfemt5MmxMZHdkVSIsInJpZCI6ImM4YzJkOTQzLTFmMjctNDBkYi1iNTk1LTI1OTAyNGRkYzUzOSJ9.kYMvoWFHgysur-aq2okfAawMCpTmjCa8wld7JH9kkN9esWS9sZSRNMU0RfnUABAr9mq_WHBw2_ps2LueRoH-Aw';

async function migrarBase(url, authToken, nombre) {
  console.log(`\n========================================`);
  console.log(`MIGRANDO AUDITORÍA EN TIEMPO REAL: ${nombre}`);
  console.log(`========================================`);

  const client = createClient(authToken ? { url, authToken } : { url });

  const tableInfo = await client.execute("PRAGMA table_info(productos)");
  const cols = new Set(tableInfo.rows.map(r => r.name));

  const nuevasColumnas = [
    { name: 'auditado', type: 'BOOLEAN DEFAULT 0' },
    { name: 'fecha_auditoria', type: 'TEXT' },
    { name: 'usuario_auditoria', type: 'TEXT' }
  ];

  for (const c of nuevasColumnas) {
    if (!cols.has(c.name)) {
      console.log(`Agregando columna ${c.name} a productos...`);
      await client.execute(`ALTER TABLE productos ADD COLUMN ${c.name} ${c.type}`);
    } else {
      console.log(`Columna ${c.name} ya existe.`);
    }
  }

  // Crear índice
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_prod_auditado ON productos(auditado)`);

  // Actualizar vista_inventario_actual para exponer auditado
  console.log(`Actualizando vista_inventario_actual...`);
  await client.execute(`DROP VIEW IF EXISTS vista_inventario_actual`);
  await client.execute(`
    CREATE VIEW vista_inventario_actual AS
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
        COALESCE(p.auditado, 0) AS auditado,
        p.fecha_auditoria,
        COALESCE(p.inactivo, 0) AS inactivo,
        COALESCE(p.activo, 1) AS activo,
        ROUND(COALESCE(SUM(CASE 
            WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_AJUSTE') 
                 OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%POSITIVO%' OR m.subtipo LIKE '%ENTRADA%' OR m.subtipo LIKE '%SOBRANTE%' OR m.subtipo LIKE '%SINCERACION%')) 
                 THEN md.cantidad 

            WHEN m.tipo IN ('SALIDA_VENTA', 'SALIDA_AJUSTE') 
                 OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%NEGATIVO%' OR m.subtipo LIKE '%SALIDA%' OR m.subtipo LIKE '%MERMA%' OR m.subtipo LIKE '%DANO%' OR m.subtipo = 'AJUSTE_INVENTARIO')) 
                 THEN -md.cantidad 

            ELSE 0 
        END), 0), 2) AS stock_actual,

        ROUND(COALESCE(SUM(CASE 
            WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_AJUSTE') 
                 OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%POSITIVO%' OR m.subtipo LIKE '%ENTRADA%' OR m.subtipo LIKE '%SOBRANTE%' OR m.subtipo LIKE '%SINCERACION%')) 
                 THEN md.cantidad 

            WHEN m.tipo IN ('SALIDA_VENTA', 'SALIDA_AJUSTE') 
                 OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%NEGATIVO%' OR m.subtipo LIKE '%SALIDA%' OR m.subtipo LIKE '%MERMA%' OR m.subtipo LIKE '%DANO%' OR m.subtipo = 'AJUSTE_INVENTARIO')) 
                 THEN -md.cantidad 

            ELSE 0 
        END), 0) * p.costo_referencial_usd, 2) AS valor_total_usd,

        CASE 
            WHEN COALESCE(p.inactivo, 0) = 1 OR COALESCE(p.activo, 1) = 0 THEN 'INACTIVO'
            WHEN ROUND(COALESCE(SUM(CASE 
                WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_AJUSTE') 
                     OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%POSITIVO%' OR m.subtipo LIKE '%ENTRADA%' OR m.subtipo LIKE '%SOBRANTE%' OR m.subtipo LIKE '%SINCERACION%')) 
                     THEN md.cantidad 

                WHEN m.tipo IN ('SALIDA_VENTA', 'SALIDA_AJUSTE') 
                     OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%NEGATIVO%' OR m.subtipo LIKE '%SALIDA%' OR m.subtipo LIKE '%MERMA%' OR m.subtipo LIKE '%DANO%' OR m.subtipo = 'AJUSTE_INVENTARIO')) 
                     THEN -md.cantidad 
                ELSE 0 
            END), 0), 2) <= p.stock_minimo THEN 'SOLICITAR MATERIAL'
            ELSE 'HAY SUFICIENTE'
        END AS estado_stock
    FROM productos p
    LEFT JOIN categorias c ON p.categoria_id = c.id
    LEFT JOIN almacenes a ON p.almacen_id = a.id
    LEFT JOIN movimiento_detalles md ON p.id = md.producto_id
    LEFT JOIN movimientos m ON md.movimiento_id = m.id
    GROUP BY p.id
  `);

  console.log(`✅ Base de datos ${nombre} migrada con éxito.`);
}

async function main() {
  await migrarBase('file:inventario_dg67.db', null, 'SQLITE LOCAL');
  if (process.env.TARGET === 'turso' || process.argv.includes('--turso')) {
    await migrarBase(TURSO_URL, TURSO_AUTH_TOKEN, 'TURSO CLOUD');
  }
}

main().catch(err => {
  console.error("Error en migración:", err);
  process.exit(1);
});

