# Directrices de Diseño y Visualización Monetaria (SISCON-ES DG67)

## 1. Doble Expresión Monetaria Simultánea (Obligatoria)
* **Moneda Principal:** Todos los importes, costos, totales, saldos y flujos deben presentarse prioritariamente en **Bolívares (Bs.)**.
* **Referencia en Dólares ($ USD):** Todo saldo o monto en Bolívares debe mostrar simultáneamente su contravalor equivalente en Dólares, calculado con la tasa oficial BCV correspondiente.
* **Sin Pestañas ni Botones Excluyentes de Moneda:** En el Dashboard y vistas principales, **NO** colocar selectores o pestañas tipo toggle ("Solo Bs" vs "Solo USD") que oculten una moneda. La cifra en Bs. debe mostrarse de forma prominente con su referencia en $ USD colocada al lado o en un subtexto inferior (`<div class="sub-ref-usd">$X.XX USD</div>`).

## 2. Estructura Limpia del Dashboard de Inicio
* El Dashboard debe ser ejecutivo, simple y visualmente despejado:
  1. **Tasa Oficial BCV del Día:** Widget de actualización diaria visible y editable.
  2. **5 KPIs Ejecutivos:** Valor del Inventario (Bs. + USD), Unidades en Stock, Rotación Anual, Disponibilidad de Stock y Total de Alertas.
  3. **Detalle Mensual de Ventas vs Compras:** Tabla bimonetaria limpia donde cada mes muestra sus compras y ventas en Bs. con su referencia en USD.
  4. **Top 10 Productos Más Vendidos:** Con ranking visual, unidades y monto facturado (Bs. + USD).
* **Exclusiones y Claridad del Inicio:**
  * **Sin Balance Neto Confuso:** No incluir conceptos contables complejos o abstractos en el Dashboard como *"Balance Neto (Bs. / USD)"* ni fórmulas/deltas de compras menos ventas que confundan a la tienda. Utilizar conceptos comerciales directos, claros y positivos: Total Compras, Total Ventas, Promedio Mensual de Facturación y Unidades en Almacén.
  * No incluir tablas operativas densas de alertas de stock como *"⚠️ Radar de Repuestos en Punto de Reorden (Quiebre)"* en el Dashboard inicial. Las alertas operativas detalladas pertenecen al módulo de *"Inventario al Día"*.

## 3. Estándar de Nomenclatura y Vocabulario Corporativo (Estándar ERP / SAP / Oracle)
* **Prohibición de Términos Informales o Coloquiales:**
  - Queda estrictamente prohibido el uso del vocablo *"Sinceración"* o derivados en cualquier parte del sistema (código visual, títulos, botones, alertas, reportes o base de datos visual).
  - En su lugar, emplear exclusivamente terminología contable y de ERP formal:
    - *"Toma Física de Inventario"* (para el conteo o auditoría física en almacén).
    - *"Ajuste de Inventario"* o *"Ajuste de Stock"* (para movimientos de sobrantes/faltantes en Kardex).
    - *"Conciliación de Stock"* (para el contraste entre stock teórico y físico).
* **Estandarización de Términos Técnicos Universales:**
  - *"Maestro de Artículos"* o *"Maestro de Productos"*.
  - *"Gestión de Inventario"*.
  - *"Entradas de Mercancía"* y *"Salidas de Mercancía"*.
  - *"Conciliación Fiscal"*.
  - *"Datos Maestros"* y *"Estructura de Costos / Precios"*.
* **Redacción Ejecutiva y Puntual:**
  - Los títulos, subtítulos, etiquetas y mensajes del sistema deben ser concisos, directos y auto-descriptivos.
  - Eliminar textos explicativos redundantes, informales o de tono tutorial en la interfaz de usuario.

## 4. Política de Persistencia Integral, Versionado Git y Despliegue Obligatorio
* **Persistencia Integral de Cambios:** Al culminar cualquier desarrollo, corrección de errores, auditoría o ajuste funcional en el sistema, es de carácter obligatorio guardar, respaldar y versionar todos los cambios realizados en el repositorio Git (`git add`, `git commit` y `git push origin main`).
* **Despliegue Continuo a Producción:** Inmediatamente tras confirmar los cambios en Git, ejecutar el despliegue automático del proyecto hacia Cloudflare Pages (`npx wrangler pages deploy public --project-name=dgg7-inventario`) para garantizar que la plataforma en línea (`https://dg67.unioncontableglobal.com`) refleje siempre la última versión estable sin retrasos ni discrepancias locales vs producción.
* **Árbol de Trabajo Limpio (`working tree clean`):** No dejar archivos de código, hojas de cálculo de respaldo o comprobantes modificados sin confirmar en el control de versiones al finalizar las tareas.

## 5. Regla de Unicidad y Continuidad del Acta de Toma Física en Ejecución
* **No Re-solicitud de Acta en Progreso:** Mientras exista un acta de Toma Física de Inventario en ejecución (estatus `ABIERTA`), el sistema **NUNCA** debe solicitar al auditor generar una nueva acta ni desplegar ventanas modales emergentes automáticas de apertura.
* **Continuidad del Expediente:** El sistema debe reconocer directamente el expediente activo en ejecución (`ACTA-INV-YYYYMM-01`) y mantener el Paso 1 marcado como listo (`✓ LISTO: APERTURADA`), permitiendo el trabajo directo en tienda.
* **Bloqueo hasta Cierre Formal:** Únicamente tras el sellado y cierre formal de la toma física (estatus `CERRADA`), o previa reapertura explícita autorizada, se podrá iniciar un nuevo ciclo de levantamiento físico.



