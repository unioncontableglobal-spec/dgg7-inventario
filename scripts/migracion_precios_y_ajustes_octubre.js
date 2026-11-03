import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

dotenv.config();

const TURSO_URL = 'libsql://inventario-dg67-unioncontableglobal-spec.aws-us-east-1.turso.io';
const TURSO_AUTH_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTI3NzEzNTEsImlkIjoiMDFhMTY5N2YtYTAwMS03MjNlLWI5NTYtNWExYjA0Yjk2OGI5Iiwia2lkIjoiUVl1M2JpWWk5QUZtZXY4TmZod0x4Z0FDMG9RQ0VGNXBfemt5MmxMZHdkVSIsInJpZCI6ImM4YzJkOTQzLTFmMjctNDBkYi1iNTk1LTI1OTAyNGRkYzUzOSJ9.kYMvoWFHgysur-aq2okfAawMCpTmjCa8wld7JH9kkN9esWS9sZSRNMU0RfnUABAr9mq_WHBw2_ps2LueRoH-Aw';

async function migrarBase(url, authToken, nombre) {
  console.log(`\n========================================`);
  console.log(`MIGRANDO PRECIO DE VENTA Y AJUSTES: ${nombre}`);
  console.log(`========================================`);

  const client = createClient(authToken ? { url, authToken } : { url });

  // 1. Agregar columna precio_venta_usd si no existe
  const tableInfo = await client.execute("PRAGMA table_info(productos)");
  const cols = new Set(tableInfo.rows.map(r => r.name));

  if (!cols.has('precio_venta_usd')) {
    console.log(`Agregando columna precio_venta_usd a productos...`);
    await client.execute(`ALTER TABLE productos ADD COLUMN precio_venta_usd REAL DEFAULT NULL`);
  } else {
    console.log(`Columna precio_venta_usd ya existe en productos.`);
  }

  // 2. Recrear vista_inventario_actual con precio_venta_usd y soporte completo de ajustes
  console.log(`Recreando vista_inventario_actual...`);
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

  // 3. Poblar precio_venta_usd inicial desde Sheet 3 (BASE DE DATOS) del archivo Excel si existe
  try {
    const wb = XLSX.readFile('1. SISTEMA DE INVENTARIO - DG67CA sep y oct 26.xlsx');
    const ws3 = wb.Sheets['3. BASE DE DATOS'];
    if (ws3) {
      const rows = XLSX.utils.sheet_to_json(ws3);
      console.log(`Poblando precios de venta desde Sheet 3 (${rows.length} registros)...`);
      const statements = [];
      for (const r of rows) {
        const cod = String(r['CODIGO'] || r['Codigo'] || '').trim();
        const rawP = r['Precio ($)'] ?? r['Precio ($) '] ?? r['Precio'];
        if (cod && rawP !== undefined && rawP !== null && !isNaN(Number(rawP)) && Number(rawP) > 0) {
          statements.push({
            sql: `UPDATE productos SET precio_venta_usd = ? WHERE UPPER(TRIM(codigo)) = UPPER(TRIM(?)) AND (precio_venta_usd IS NULL OR precio_venta_usd = 0)`,
            args: [Number(Number(rawP).toFixed(2)), cod]
          });
        }
      }
      if (statements.length > 0) {
        for (let i = 0; i < statements.length; i += 100) {
          await client.batch(statements.slice(i, i + 100), 'write');
        }
        console.log(`Se actualizaron precios de venta para ${statements.length} productos.`);
      }
    }
  } catch (err) {
    console.log(`Nota: No se leyó archivo Excel local para precios base:`, err.message);
  }

  console.log(`✅ Migración finalizada con éxito en ${nombre}.`);
}

async function main() {
  await migrarBase('file:inventario_dg67.db', null, 'SQLITE LOCAL');
  await migrarBase(TURSO_URL, TURSO_AUTH_TOKEN, 'TURSO CLOUD');
}

main().catch(err => {
  console.error("Error en migración:", err);
  process.exit(1);
});
