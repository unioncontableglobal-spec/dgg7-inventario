import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config();

const TURSO_URL = 'libsql://inventario-dg67-unioncontableglobal-spec.aws-us-east-1.turso.io';
const TURSO_AUTH_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTI3NzEzNTEsImlkIjoiMDFhMTY5N2YtYTAwMS03MjNlLWI5NTYtNWExYjA0Yjk2OGI5Iiwia2lkIjoiUVl1M2JpWWk5QUZtZXY4TmZod0x4Z0FDMG9RQ0VGNXBfemt5MmxMZHdkVSIsInJpZCI6ImM4YzJkOTQzLTFmMjctNDBkYi1iNTk1LTI1OTAyNGRkYzUzOSJ9.kYMvoWFHgysur-aq2okfAawMCpTmjCa8wld7JH9kkN9esWS9sZSRNMU0RfnUABAr9mq_WHBw2_ps2LueRoH-Aw';

const isTurso = process.env.TARGET === 'turso';
const client = createClient(
  isTurso
    ? { url: TURSO_URL, authToken: TURSO_AUTH_TOKEN }
    : { url: 'file:inventario_dg67.db' }
);

async function migrar() {
  console.log(`=== INICIANDO MIGRACIÓN AUDITORÍA Y SINCERACIÓN (PUNTO CERO) [${isTurso ? 'TURSO' : 'SQLITE LOCAL'}] ===`);

  // 1. Agregar columnas a productos si no existen
  const cols = await client.execute("PRAGMA table_info(productos)");
  const existingCols = new Set(cols.rows.map(c => c.name));

  const newCols = [
    { name: 'inactivo', type: 'BOOLEAN DEFAULT 0' },
    { name: 'costo_auditado_usd', type: 'REAL' },
    { name: 'stock_auditado_fisico', type: 'REAL' },
    { name: 'fecha_auditoria_punto_cero', type: 'TEXT' }
  ];

  for (const col of newCols) {
    if (!existingCols.has(col.name)) {
      console.log(`Agregando columna ${col.name} a tabla productos...`);
      await client.execute(`ALTER TABLE productos ADD COLUMN ${col.name} ${col.type}`);
    } else {
      console.log(`Columna ${col.name} ya existe en productos.`);
    }
  }

  // 2. Crear índices de rendimiento
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_prod_codigo ON productos(codigo)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_prod_inactivo ON productos(inactivo)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_mov_tipo_subtipo ON movimientos(tipo, subtipo)`);

  // 3. Actualizar vista_inventario_actual para reflejar con exactitud matemática los ajustes de inventario
  console.log("Actualizando vista_inventario_actual...");
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
        COALESCE(p.inactivo, 0) AS inactivo,
        COALESCE(p.activo, 1) AS activo,
        ROUND(COALESCE(SUM(CASE 
            -- ENTRADAS QUE SUMAN AL STOCK:
            WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_AJUSTE') 
                 OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%POSITIVO%' OR m.subtipo LIKE '%ENTRADA%' OR m.subtipo LIKE '%SOBRANTE%' OR m.subtipo LIKE '%SINCERACION%')) 
                 THEN md.cantidad 

            -- SALIDAS QUE RESTAN AL STOCK:
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

  console.log("✅ Migración completada exitosamente.");
}

migrar().catch(console.error);
