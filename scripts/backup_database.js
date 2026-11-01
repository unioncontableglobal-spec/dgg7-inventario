import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbFile = path.join(__dirname, '..', 'inventario_dg67.db');
const backupDir = path.join(__dirname, '..', 'backups');

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

export async function createBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFile = path.join(backupDir, `backup_dg67_${timestamp}.db`);
  const metaFile = path.join(backupDir, `backup_dg67_${timestamp}_metadata.json`);

  console.log(`[BACKUP] Generando respaldo de seguridad: ${backupFile}`);

  // 1. Respaldo físico de SQLite local
  if (fs.existsSync(dbFile)) {
    fs.copyFileSync(dbFile, backupFile);
    console.log(`[BACKUP] Archivo SQLite respaldado con éxito (${(fs.statSync(backupFile).size / 1024).toFixed(1)} KB).`);
  }

  // 2. Respaldo de integridad desde base de datos
  const client = createClient({ url: 'file:inventario_dg67.db' });
  const [prodCount, movCount, empRes] = await Promise.all([
    client.execute("SELECT count(*) as c FROM productos"),
    client.execute("SELECT count(*) as c FROM movimientos"),
    client.execute("SELECT razon_social, rif FROM empresas WHERE id = 1")
  ]);

  const metadata = {
    fecha: new Date().toISOString(),
    empresa: empRes.rows[0]?.razon_social || 'INVERSIONES DG 67, C.A.',
    rif: empRes.rows[0]?.rif || 'J-50700865-7',
    total_productos: prodCount.rows[0].c,
    total_movimientos: movCount.rows[0].c,
    archivo_db: path.basename(backupFile),
    tamano_bytes: fs.existsSync(backupFile) ? fs.statSync(backupFile).size : 0,
    nube_turso_sincronizada: !!process.env.TURSO_DATABASE_URL
  };

  fs.writeFileSync(metaFile, JSON.stringify(metadata, null, 2));
  console.log(`[BACKUP] Metadatos guardados con éxito: ${metaFile}`);

  // 3. Rotación de respaldos: conservar los últimos 30
  const files = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('backup_dg67_') && f.endsWith('.db'))
    .sort()
    .reverse();

  if (files.length > 30) {
    const toDelete = files.slice(30);
    for (const f of toDelete) {
      try {
        fs.unlinkSync(path.join(backupDir, f));
        const m = f.replace('.db', '_metadata.json');
        if (fs.existsSync(path.join(backupDir, m))) fs.unlinkSync(path.join(backupDir, m));
        console.log(`[BACKUP] Respaldo antiguo depurado: ${f}`);
      } catch (e) {}
    }
  }

  return metadata;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createBackup().then(() => console.log('[BACKUP] Proceso finalizado.')).catch(console.error);
}
