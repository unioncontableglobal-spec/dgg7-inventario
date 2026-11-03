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
  console.log(`Aplicando índices anti-duplicados en ${isTurso ? 'Turso Cloud' : 'SQLite Local'}...`);
  
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_lc_rif_fact ON libro_compras(rif, nro_factura)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_lc_nro_ctrl ON libro_compras(nro_control)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_mov_prov_doc ON movimientos(proveedor_id, numero_documento)`);

  console.log('✅ Índices anti-duplicados creados con éxito.');
}

migrar().catch(console.error);
