import dotenv from 'dotenv';
import { createClient } from '@libsql/client';

dotenv.config();

const localDb = createClient({
  url: 'file:inventario_dg67.db'
});

const remoteUrl = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!remoteUrl || !authToken) {
  console.error('Error: TURSO_DATABASE_URL y TURSO_AUTH_TOKEN requeridos en .env');
  process.exit(1);
}

const remoteDb = createClient({ url: remoteUrl, authToken });

async function sync() {
  console.log('--- INICIANDO SINCRONIZACIÓN DE LOCAL SQLITE A TURSO CLOUD ---');

  // 1. Obtener lista de tablas locales
  const tablesRes = await localDb.execute("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  const tables = tablesRes.rows;

  for (const table of tables) {
    console.log(`Procesando tabla: ${table.name}...`);
    // Verificar si la tabla existe en Turso
    const checkRes = await remoteDb.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
      args: [table.name]
    });

    if (checkRes.rows.length === 0) {
      console.log(`  -> Creando tabla en Turso: ${table.name}`);
      await remoteDb.execute(table.sql);
    } else {
      // Verificar columnas faltantes
      const localColsRes = await localDb.execute(`PRAGMA table_info(${table.name})`);
      const localCols = localColsRes.rows;
      let remoteCols = [];
      try {
        const rInfo = await remoteDb.execute(`PRAGMA table_info(${table.name})`);
        remoteCols = rInfo.rows.map(r => r.name);
      } catch (err) {
        console.warn(`  No se pudo leer columnas remotas de ${table.name}:`, err.message);
      }

      for (const col of localCols) {
        if (!remoteCols.includes(col.name)) {
          console.log(`  -> Agregando columna faltante ${col.name} (${col.type}) a ${table.name}`);
          const defaultVal = (col.dflt_value !== null && col.dflt_value !== undefined) ? `DEFAULT ${col.dflt_value}` : '';
          try {
            await remoteDb.execute(`ALTER TABLE ${table.name} ADD COLUMN ${col.name} ${col.type} ${defaultVal}`);
          } catch (altErr) {
            console.warn(`     Error agregando columna: ${altErr.message}`);
          }
        }
      }
    }

    // Sincronizar datos si la tabla remota tiene menos registros que la local
    const countLocalRes = await localDb.execute(`SELECT COUNT(*) as count FROM ${table.name}`);
    const countLocal = countLocalRes.rows[0].count;
    const countRemoteRes = await remoteDb.execute(`SELECT COUNT(*) as count FROM ${table.name}`);
    const countRemote = countRemoteRes.rows[0].count;

    console.log(`  Local: ${countLocal} registros | Remoto: ${countRemote} registros`);

    if (countLocal > countRemote) {
      console.log(`  -> Sincronizando registros faltantes para ${table.name}...`);
      const rowsRes = await localDb.execute(`SELECT * FROM ${table.name}`);
      const rows = rowsRes.rows;
      
      const BATCH_SIZE = 50;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const stmts = batch.map(row => {
          const keys = Object.keys(row);
          const placeholders = keys.map(() => '?').join(', ');
          const values = keys.map(k => row[k]);
          return {
            sql: `INSERT OR REPLACE INTO ${table.name} (${keys.join(', ')}) VALUES (${placeholders})`,
            args: values
          };
        });
        await remoteDb.batch(stmts, 'write');
      }
      console.log(`  -> Sincronización completada para ${table.name}.`);
    }
  }

  console.log('--- SINCRONIZACIÓN EXITOSA CON TURSO CLOUD ---');
}

sync().catch(err => {
  console.error('Error durante sincronización:', err);
  process.exit(1);
});
