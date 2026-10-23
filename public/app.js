// ==========================================================================
// INVERSIONES DG 67, C.A. - FRONTEND LOGIC (TURSO CLOUD)
// ==========================================================================

const state = {
  products: [],
  suppliers: [],
  categories: [],
  warehouses: [],
  dashboard: null,
  activeTab: 'tab-dashboard'
};

// DOM Content Loaded
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  setupNavigation();
  setupEventListeners();
  
  // Set default dates to today
  const today = new Date().toISOString().split('T')[0];
  const entFecha = document.getElementById('ent-fecha');
  const salFecha = document.getElementById('sal-fecha');
  if (entFecha) entFecha.value = today;
  if (salFecha) salFecha.value = today;

  // Initial Data Loads
  await Promise.all([
    checkHealth(),
    loadDashboard(),
    loadCatalogs(),
    loadProducts()
  ]);

  // Add initial rows in forms
  addEntryRow();
  addExitRow();
}

// 1. Navigation & Tabs
function setupNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.tab;
      switchTab(targetId);
    });
  });

  // Mobile sidebar toggle & backdrop
  const toggleBtn = document.getElementById('btn-toggle-sidebar');
  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');

  if (toggleBtn && sidebar && backdrop) {
    toggleBtn.addEventListener('click', () => {
      const isOpen = sidebar.classList.toggle('sidebar-open');
      backdrop.classList.toggle('active', isOpen);
    });

    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('sidebar-open');
      backdrop.classList.remove('active');
    });
  }
}

function switchTab(tabId) {
  state.activeTab = tabId;
  
  // Close mobile sidebar if open
  document.getElementById('app-sidebar')?.classList.remove('sidebar-open');
  document.getElementById('sidebar-backdrop')?.classList.remove('active');

  // Update buttons
  document.querySelectorAll('.nav-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });

  // Update panes
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === tabId);
  });

  // Lazy refresh based on tab
  if (tabId === 'tab-dashboard') loadDashboard();
  if (tabId === 'tab-inventario') loadProducts();
  if (tabId === 'tab-mensual') loadMonthlyReport();
  if (tabId === 'tab-movimientos') loadMovements();
  if (tabId === 'tab-fiscal') loadFiscalReconciliation();
  if (tabId === 'tab-libro-compras') loadLibroCompras();
  if (tabId === 'tab-libro-ventas') loadLibroVentas();
  if (tabId === 'tab-declaraciones') loadDeclaracionDetalle();
  if (tabId === 'tab-proveedores') loadProveedoresDirectorio();
}

// 2. Health & Cloud Status
async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    const badge = document.getElementById('cloud-badge');
    if (data.status === 'online') {
      badge.innerHTML = `<span class="status-pulse"></span> Turso Cloud Activo`;
    }
  } catch (err) {
    const badge = document.getElementById('cloud-badge');
    badge.innerHTML = `<span style="color: #fb7185;">● Error Cloud</span>`;
  }
}

// 3. Catalogs (Suppliers, Categories, Warehouses)
async function loadCatalogs() {
  try {
    const [provRes, catRes, almRes] = await Promise.all([
      fetch('/api/proveedores'),
      fetch('/api/categorias'),
      fetch('/api/almacenes')
    ]);

    state.suppliers = await provRes.json();
    state.categories = await catRes.json();
    state.warehouses = await almRes.json();

    // Populate Supplier Dropdown
    const entProv = document.getElementById('ent-proveedor');
    if (entProv) {
      entProv.innerHTML = '<option value="">Seleccione Proveedor...</option>';
      state.suppliers.forEach(p => {
        entProv.innerHTML += `<option value="${p.id}">${p.razon_social} (${p.rif})</option>`;
      });
    }

    // Populate Category Filter
    const filterCat = document.getElementById('inv-filter-cat');
    if (filterCat) {
      filterCat.innerHTML = '<option value="TODAS">Todas las Categorías</option>';
      state.categories.forEach(c => {
        filterCat.innerHTML += `<option value="${c.nombre}">${c.nombre}</option>`;
      });
    }

    // Populate Warehouse Filter
    const filterAlm = document.getElementById('inv-filter-alm');
    if (filterAlm) {
      filterAlm.innerHTML = '<option value="TODOS">Todos los Almacenes</option>';
      state.warehouses.forEach(a => {
        filterAlm.innerHTML += `<option value="${a.nombre}">${a.nombre}</option>`;
      });
    }
  } catch (err) {
    console.error('Error loading catalogs:', err);
  }
}

// 4. Dashboard KPIs & Distribution
async function loadDashboard() {
  try {
    const res = await fetch('/api/dashboard');
    const data = await res.json();
    state.dashboard = data;

    // Set KPI cards
    document.getElementById('kpi-total-productos').textContent = data.totalProductos.toLocaleString();
    document.getElementById('kpi-stock-unidades').textContent = Math.round(data.stockTotalUnidades).toLocaleString();
    document.getElementById('kpi-valor-total').textContent = `$${data.valorTotalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('kpi-alertas-stock').textContent = data.productosEnAlerta;

    // Render Category Distribution
    const categoryBars = document.getElementById('category-bars');
    if (categoryBars && data.topCategorias) {
      const maxUnidades = Math.max(...data.topCategorias.map(c => c.unidades_stock), 1);
      categoryBars.innerHTML = data.topCategorias.map(cat => {
        const pct = Math.round((cat.unidades_stock / maxUnidades) * 100);
        return `
          <div class="category-item">
            <div class="category-label-flex">
              <span class="category-name">${cat.categoria} (${cat.productos_count} repuestos)</span>
              <span class="category-count">${cat.unidades_stock} und • $${cat.valor_usd.toLocaleString()}</span>
            </div>
            <div class="bar-bg">
              <div class="bar-fill" style="width: ${pct}%"></div>
            </div>
          </div>
        `;
      }).join('');
    }

    // Render Recent Movements
    const tbodyRecent = document.querySelector('#table-recent-movs tbody');
    if (tbodyRecent && data.recientes) {
      tbodyRecent.innerHTML = data.recientes.map(m => {
        const isEntrada = m.tipo === 'ENTRADA_COMPRA' || m.tipo === 'INVENTARIO_INICIAL';
        const typeBadge = isEntrada 
          ? `<span class="badge-status badge-suficiente">📥 ${m.tipo === 'INVENTARIO_INICIAL' ? 'Inicial' : 'Compra'}</span>`
          : `<span class="badge-status badge-solicitar">📤 Venta</span>`;
        return `
          <tr>
            <td class="font-mono">${m.fecha}</td>
            <td>${typeBadge}</td>
            <td class="font-bold">${m.numero_documento}</td>
            <td>${m.proveedor_nombre}</td>
            <td class="font-mono font-bold">${m.total_unidades}</td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Error loading dashboard:', err);
  }
}

// 5. Products & Inventory Table
async function loadProducts() {
  try {
    const q = document.getElementById('inv-search')?.value.trim() || '';
    const cat = document.getElementById('inv-filter-cat')?.value || 'TODAS';
    const alm = document.getElementById('inv-filter-alm')?.value || 'TODOS';
    const estado = document.getElementById('inv-filter-estado')?.value || 'TODOS';
    const fechaCorte = document.getElementById('inv-periodo-corte')?.value || '';

    const params = new URLSearchParams();
    if (q) params.append('q', q);
    if (cat !== 'TODAS') params.append('categoria', cat);
    if (alm !== 'TODOS') params.append('almacen', alm);
    if (estado !== 'TODOS') params.append('estado', estado);
    if (fechaCorte) params.append('fecha_corte', fechaCorte);

    // Update Export links to match active cutoff
    const exportExcelBtn = document.getElementById('btn-export-excel');
    const tabExportExcelBtn = document.getElementById('btn-tab-export-excel');
    const exportPdfBtn = document.getElementById('btn-export-pdf');
    const tabExportPdfBtn = document.getElementById('btn-tab-export-pdf');

    const excelUrl = `/api/export/excel${fechaCorte ? `?fecha_corte=${fechaCorte}` : ''}`;
    const pdfUrl = `/reporte-seniat.html${fechaCorte ? `?fecha_corte=${fechaCorte}` : ''}`;

    if (exportExcelBtn) exportExcelBtn.href = excelUrl;
    if (tabExportExcelBtn) tabExportExcelBtn.href = excelUrl;
    if (exportPdfBtn) exportPdfBtn.href = pdfUrl;
    if (tabExportPdfBtn) tabExportPdfBtn.href = pdfUrl;

    const res = await fetch(`/api/productos?${params.toString()}`);
    const products = await res.json();
    state.products = products;

    // Update Counter & Title Badge
    const countBadge = document.getElementById('inv-count-badge');
    if (countBadge) {
      if (fechaCorte === '2025-12-31') {
        countBadge.innerHTML = `🏁 <strong>Inventario Inicial al Cierre 31/12/2025:</strong> ${products.length} productos`;
      } else if (fechaCorte) {
        countBadge.innerHTML = `📅 <strong>Inventario al Corte (${fechaCorte}):</strong> ${products.length} productos`;
      } else {
        countBadge.textContent = `Mostrando ${products.length} de 731 productos (Existencias en Vivo)`;
      }
    }

    const tbody = document.getElementById('tbody-inventario');
    if (!tbody) return;

    if (products.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" class="text-center">No se encontraron productos coincidentes</td></tr>`;
      return;
    }

    tbody.innerHTML = products.map(p => {
      const isLow = p.estado_stock === 'SOLICITAR MATERIAL';
      const statusBadge = isLow
        ? `<span class="badge-status badge-solicitar">⚠️ Solicitar</span>`
        : `<span class="badge-status badge-suficiente">✅ Suficiente</span>`;
      
      const stockColor = isLow ? 'color: #fb7185; font-weight: 800;' : 'font-weight: 700;';

      return `
        <tr>
          <td><span class="badge-code">${p.codigo}</span></td>
          <td class="font-bold">${p.descripcion}</td>
          <td>${p.unidad_medida}</td>
          <td><span class="meta-tag">${p.categoria}</span></td>
          <td><span class="meta-tag">${p.almacen}</span></td>
          <td class="text-right font-mono">${p.stock_minimo}</td>
          <td class="text-right font-mono" style="${stockColor}">${p.stock_actual}</td>
          <td class="text-right font-mono">$${p.costo_referencial_usd.toFixed(2)}</td>
          <td class="text-right font-mono font-bold">$${p.valor_total_usd.toFixed(2)}</td>
          <td class="text-center">${statusBadge}</td>
          <td class="text-center">
            <button class="btn btn-sm btn-secondary" onclick="viewKardex('${p.codigo}')" title="Ver Historial Kardex">
              Kardex
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading products:', err);
  }
}

// 6. Dynamic Form Rows: ENTRADA (COMPRAS)
function addEntryRow() {
  const tbody = document.getElementById('tbody-items-entrada');
  if (!tbody) return;

  const rowId = `ent-row-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
  const tr = document.createElement('tr');
  tr.id = rowId;

  const productOptions = state.products.map(p => 
    `<option value="${p.producto_id}" data-cost="${p.costo_referencial_usd}" data-desc="${p.descripcion}">${p.codigo} - ${p.descripcion}</option>`
  ).join('');

  tr.innerHTML = `
    <td>
      <select class="ent-prod-select" onchange="onEntryProductChange('${rowId}')" required>
        <option value="">Seleccione Producto...</option>
        ${productOptions}
      </select>
    </td>
    <td>
      <input type="number" class="ent-qty-input text-right" min="0.1" step="any" value="1" oninput="calculateEntryTotals()" required>
    </td>
    <td>
      <input type="number" class="ent-cost-input text-right" min="0" step="0.01" value="0.00" oninput="calculateEntryTotals()" required>
    </td>
    <td class="text-right font-mono font-bold ent-subtotal">$0.00</td>
    <td class="text-center">
      <button type="button" class="btn-remove-row" onclick="removeRow('${rowId}', calculateEntryTotals)">&times;</button>
    </td>
  `;

  tbody.appendChild(tr);
}

function onEntryProductChange(rowId) {
  const tr = document.getElementById(rowId);
  if (!tr) return;
  const select = tr.querySelector('.ent-prod-select');
  const selectedOpt = select.options[select.selectedIndex];
  const costInput = tr.querySelector('.ent-cost-input');
  
  if (selectedOpt && selectedOpt.dataset.cost) {
    costInput.value = parseFloat(selectedOpt.dataset.cost).toFixed(2);
  }
  calculateEntryTotals();
}

function calculateEntryTotals() {
  let totalUsd = 0;
  const rows = document.querySelectorAll('#tbody-items-entrada tr');
  rows.forEach(r => {
    const qty = parseFloat(r.querySelector('.ent-qty-input')?.value || 0);
    const cost = parseFloat(r.querySelector('.ent-cost-input')?.value || 0);
    const sub = qty * cost;
    const subElem = r.querySelector('.ent-subtotal');
    if (subElem) subElem.textContent = `$${sub.toFixed(2)}`;
    totalUsd += sub;
  });

  const totalElem = document.getElementById('total-entrada-usd');
  if (totalElem) totalElem.textContent = `$${totalUsd.toFixed(2)}`;
}

// 7. Dynamic Form Rows: SALIDA (VENTAS)
function addExitRow() {
  const tbody = document.getElementById('tbody-items-salida');
  if (!tbody) return;

  const rowId = `sal-row-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
  const tr = document.createElement('tr');
  tr.id = rowId;

  const productOptions = state.products.map(p => 
    `<option value="${p.producto_id}" data-stock="${p.stock_actual}" data-desc="${p.descripcion}">${p.codigo} - ${p.descripcion} (Stock: ${p.stock_actual})</option>`
  ).join('');

  tr.innerHTML = `
    <td>
      <select class="sal-prod-select" onchange="onExitProductChange('${rowId}')" required>
        <option value="">Seleccione Producto...</option>
        ${productOptions}
      </select>
    </td>
    <td class="text-center font-mono font-bold sal-stock-disp">--</td>
    <td>
      <input type="number" class="sal-qty-input text-right" min="0.1" step="any" value="1" oninput="validateExitRow('${rowId}')" required>
    </td>
    <td class="text-center">
      <button type="button" class="btn-remove-row" onclick="removeRow('${rowId}')">&times;</button>
    </td>
  `;

  tbody.appendChild(tr);
}

function onExitProductChange(rowId) {
  const tr = document.getElementById(rowId);
  if (!tr) return;
  const select = tr.querySelector('.sal-prod-select');
  const selectedOpt = select.options[select.selectedIndex];
  const stockElem = tr.querySelector('.sal-stock-disp');

  if (selectedOpt && selectedOpt.dataset.stock !== undefined) {
    const stock = parseFloat(selectedOpt.dataset.stock);
    stockElem.textContent = `${stock} und`;
    if (stock <= 0) {
      stockElem.style.color = '#fb7185';
    } else {
      stockElem.style.color = '#34d399';
    }
  } else {
    stockElem.textContent = '--';
  }
  validateExitRow(rowId);
}

function validateExitRow(rowId) {
  const tr = document.getElementById(rowId);
  if (!tr) return;
  const select = tr.querySelector('.sal-prod-select');
  const selectedOpt = select.options[select.selectedIndex];
  const qtyInput = tr.querySelector('.sal-qty-input');
  
  if (selectedOpt && selectedOpt.dataset.stock !== undefined) {
    const stock = parseFloat(selectedOpt.dataset.stock);
    const qty = parseFloat(qtyInput.value || 0);
    if (qty > stock) {
      qtyInput.style.borderColor = '#fb7185';
      qtyInput.title = '¡Advertencia! La cantidad supera el stock disponible.';
    } else {
      qtyInput.style.borderColor = '';
      qtyInput.title = '';
    }
  }
}

function removeRow(rowId, callback) {
  const row = document.getElementById(rowId);
  if (row) row.remove();
  if (callback) callback();
}

// 8. Movement Submission Handler
async function handleMovementSubmit(event, tipo) {
  event.preventDefault();
  const isEntrada = tipo === 'ENTRADA_COMPRA';

  const fecha = document.getElementById(isEntrada ? 'ent-fecha' : 'sal-fecha').value;
  const doc = document.getElementById(isEntrada ? 'ent-factura' : 'sal-factura').value.trim();
  const obs = document.getElementById(isEntrada ? 'ent-obs' : 'sal-obs').value.trim();
  const provId = isEntrada ? document.getElementById('ent-proveedor').value : null;

  // Gather items
  const items = [];
  const rows = document.querySelectorAll(isEntrada ? '#tbody-items-entrada tr' : '#tbody-items-salida tr');

  for (const r of rows) {
    const prodId = r.querySelector(isEntrada ? '.ent-prod-select' : '.sal-prod-select')?.value;
    const qty = parseFloat(r.querySelector(isEntrada ? '.ent-qty-input' : '.sal-qty-input')?.value || 0);
    const cost = isEntrada ? parseFloat(r.querySelector('.ent-cost-input')?.value || 0) : 0;

    if (!prodId || qty <= 0) continue;

    items.push({
      producto_id: parseInt(prodId, 10),
      cantidad: qty,
      costo_unitario_usd: cost
    });
  }

  if (items.length === 0) {
    showToast('Debe agregar al menos un ítem válido.', 'error');
    return;
  }

  const payload = {
    tipo,
    fecha,
    numero_documento: doc,
    proveedor_id: provId ? parseInt(provId, 10) : null,
    observaciones: obs,
    items
  };

  const submitBtn = document.getElementById(isEntrada ? 'btn-submit-entrada' : 'btn-submit-salida');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Guardando en Turso...';

  try {
    const res = await fetch('/api/movimientos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');

    showToast(data.message || 'Movimiento registrado con éxito en Turso Cloud!', 'success');

    // Reset Form
    resetForm(isEntrada ? 'form-entrada' : 'form-salida');
    if (isEntrada) addEntryRow();
    else addExitRow();

    // Refresh Live Data
    await Promise.all([loadDashboard(), loadProducts()]);
    switchTab('tab-inventario');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = isEntrada ? 'Guardar Entrada en Turso Cloud' : 'Guardar Salida en Turso Cloud';
  }
}

function resetForm(formId) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.reset();
  const today = new Date().toISOString().split('T')[0];
  const dateInput = form.querySelector('input[type="date"]');
  if (dateInput) dateInput.value = today;

  if (formId === 'form-entrada') {
    document.getElementById('tbody-items-entrada').innerHTML = '';
    calculateEntryTotals();
  } else if (formId === 'form-salida') {
    document.getElementById('tbody-items-salida').innerHTML = '';
  }
}

// 9. Kardex Ledger Viewer
async function viewKardex(codigo) {
  switchTab('tab-kardex');
  document.getElementById('kardex-search-input').value = codigo;
  executeKardexSearch(codigo);
}

async function executeKardexSearch(codeOverride) {
  const code = codeOverride || document.getElementById('kardex-search-input').value.trim();
  if (!code) return;

  try {
    const res = await fetch(`/api/kardex/${encodeURIComponent(code)}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Producto no encontrado');

    // Header Card
    document.getElementById('kardex-product-info').style.display = 'flex';
    document.getElementById('kardex-table-container').style.display = 'block';

    document.getElementById('kardex-code').textContent = data.producto.codigo;
    document.getElementById('kardex-desc').textContent = data.producto.descripcion;
    document.getElementById('kardex-cat').textContent = `Categoría: ${data.producto.categoria}`;
    document.getElementById('kardex-alm').textContent = `Almacén: ${data.producto.almacen}`;
    document.getElementById('kardex-und').textContent = `Unidad: ${data.producto.unidad_medida}`;
    document.getElementById('kardex-stock').textContent = `${data.producto.stock_actual} ${data.producto.unidad_medida}`;
    document.getElementById('kardex-cost').textContent = `$${data.producto.costo_referencial_usd.toFixed(2)}`;
    
    const isLow = data.producto.estado_stock === 'SOLICITAR MATERIAL';
    const statusElem = document.getElementById('kardex-status');
    statusElem.textContent = isLow ? '⚠️ Solicitar Material' : '✅ Hay Suficiente';
    statusElem.style.color = isLow ? '#fb7185' : '#34d399';

    // Ledger Table
    const tbody = document.getElementById('tbody-kardex');
    if (data.historial.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center">Sin movimientos registrados</td></tr>`;
      return;
    }

    tbody.innerHTML = data.historial.map(h => {
      const isEntrada = h.entrada > 0;
      const typeBadge = h.tipo === 'INVENTARIO_INICIAL'
        ? `<span class="badge-status badge-suficiente">🏁 Inicial</span>`
        : isEntrada 
          ? `<span class="badge-status badge-suficiente">📥 Compra</span>`
          : `<span class="badge-status badge-solicitar">📤 Venta</span>`;

      return `
        <tr>
          <td class="font-mono">${h.fecha}</td>
          <td>${typeBadge}</td>
          <td class="font-bold">${h.numero_documento}</td>
          <td>${h.tercero}</td>
          <td class="text-right font-mono font-bold" style="color: ${h.entrada > 0 ? '#34d399' : ''}">${h.entrada > 0 ? h.entrada : '-'}</td>
          <td class="text-right font-mono font-bold" style="color: ${h.salida > 0 ? '#fb7185' : ''}">${h.salida > 0 ? h.salida : '-'}</td>
          <td class="text-right font-mono font-bold" style="color: #6366f1;">${h.saldo}</td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    showToast(err.message, 'error');
  }
}

// 10. Historical Movements Table
async function loadMovements() {
  try {
    const q = document.getElementById('mov-search')?.value.trim() || '';
    const tipo = document.getElementById('mov-filter-tipo')?.value || 'TODOS';
    const desde = document.getElementById('mov-filter-desde')?.value || '';
    const hasta = document.getElementById('mov-filter-hasta')?.value || '';

    const params = new URLSearchParams();
    if (q) params.append('q', q);
    if (tipo !== 'TODOS') params.append('tipo', tipo);
    if (desde) params.append('desde', desde);
    if (hasta) params.append('hasta', hasta);

    const res = await fetch(`/api/movimientos?${params.toString()}`);
    const movements = await res.json();

    const tbody = document.getElementById('tbody-movimientos');
    if (!tbody) return;

    if (movements.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center">No se encontraron movimientos con los filtros seleccionados</td></tr>`;
      return;
    }

    tbody.innerHTML = movements.map(m => {
      const isEntrada = m.tipo === 'ENTRADA_COMPRA' || m.tipo === 'INVENTARIO_INICIAL';
      const typeBadge = isEntrada 
        ? `<span class="badge-status badge-suficiente">📥 ${m.tipo === 'INVENTARIO_INICIAL' ? 'Inicial' : 'Compra'}</span>`
        : `<span class="badge-status badge-solicitar">📤 Venta</span>`;

      return `
        <tr>
          <td class="font-mono">${m.fecha}</td>
          <td>${typeBadge}</td>
          <td class="font-bold">${m.numero_documento}</td>
          <td>${m.proveedor_nombre}</td>
          <td class="text-right font-mono">${m.total_items}</td>
          <td class="text-right font-mono font-bold">${m.total_unidades}</td>
          <td style="color: var(--text-muted); font-size: 0.78rem;">${m.observaciones || '-'}</td>
          <td class="text-center">
            <button class="btn btn-sm btn-secondary" onclick="viewMovementDetail(${m.id})">Ver Ítems</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading movements:', err);
  }
}

// 11. Movement Detail Modal
async function viewMovementDetail(id) {
  const modal = document.getElementById('modal-mov-detail');
  const modalBody = document.getElementById('modal-mov-body');
  const modalTitle = document.getElementById('modal-mov-title');

  modal.style.display = 'flex';
  modalBody.innerHTML = `<div class="loading-spinner">Cargando detalles...</div>`;

  try {
    const res = await fetch(`/api/movimientos/${id}`);
    const data = await res.json();

    modalTitle.textContent = `${data.header.tipo.replace('_', ' ')} - ${data.header.numero_documento} (${data.header.fecha})`;

    modalBody.innerHTML = `
      <div style="margin-bottom: 16px; font-size: 0.85rem; color: var(--text-secondary);">
        <strong>Proveedor / Cliente:</strong> ${data.header.proveedor_nombre} (${data.header.proveedor_rif})<br>
        <strong>Observaciones:</strong> ${data.header.observaciones || 'Ninguna'}
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>CÓDIGO</th>
            <th>DESCRIPCIÓN</th>
            <th class="text-right">CANTIDAD</th>
            <th class="text-right">COSTO ($)</th>
            <th class="text-right">SUBTOTAL ($)</th>
          </tr>
        </thead>
        <tbody>
          ${data.items.map(it => `
            <tr>
              <td><span class="badge-code">${it.codigo}</span></td>
              <td>${it.descripcion}</td>
              <td class="text-right font-mono font-bold">${it.cantidad} ${it.unidad_medida}</td>
              <td class="text-right font-mono">$${it.costo_unitario_usd.toFixed(2)}</td>
              <td class="text-right font-mono font-bold">$${it.subtotal_usd.toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    modalBody.innerHTML = `<div style="color: #fb7185; padding: 20px;">Error al cargar detalles: ${err.message}</div>`;
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'none';
}

// 11.1 Monthly Report Loader
async function loadMonthlyReport() {
  const tbody = document.getElementById('tbody-mensual');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="8" class="text-center">Cargando reconciliación mensual desde Turso...</td></tr>`;

  try {
    const res = await fetch('/api/reportes/mes-a-mes');
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center">No hay datos mensuales registrados</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(m => {
      const isInitial = m.periodo === '2025-12';
      const nameBadge = isInitial 
        ? `<strong style="color: #67e8f9;">🏁 ${m.nombre}</strong>`
        : `<strong>📅 ${m.nombre}</strong>`;

      const comprasText = isInitial 
        ? `<span class="badge-code" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">${m.entradasInicial} und (Inicial)</span>` 
        : (m.compras > 0 ? `+${m.compras} und` : '-');

      const comprasUsdText = isInitial 
        ? '-' 
        : (m.comprasUsd > 0 ? `$${m.comprasUsd.toLocaleString()}` : '-');

      const ventasText = m.ventas > 0 ? `-${m.ventas} und` : '-';

      return `
        <tr>
          <td>${nameBadge}</td>
          <td class="text-right font-mono font-bold">${m.saldoInicial}</td>
          <td class="text-right font-mono font-bold" style="color: #34d399;">${comprasText}</td>
          <td class="text-right font-mono font-bold">${comprasUsdText}</td>
          <td class="text-right font-mono font-bold" style="color: #fb7185;">${ventasText}</td>
          <td class="text-right font-mono font-bold" style="color: #818cf8; font-size: 0.95rem;">${m.saldoFinal}</td>
          <td class="text-center font-mono">${m.totalDocs}</td>
          <td class="text-center">
            <button class="btn btn-sm btn-secondary" onclick="filtrarPorFechaCorte('${m.fechaCorte}')" title="Ver catálogo de productos a esta fecha">
              Ver Productos al Corte
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading monthly report:', err);
    tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="color: #fb7185;">Error al cargar datos mensuales</td></tr>`;
  }
}

function filtrarPorFechaCorte(fechaCorte) {
  const select = document.getElementById('inv-periodo-corte');
  if (select) {
    select.value = fechaCorte;
  }
  switchTab('tab-inventario');
  loadProducts();
}

// 12. Setup Event Listeners
function setupEventListeners() {
  // Inventory Filters
  document.getElementById('inv-search')?.addEventListener('input', debounce(loadProducts, 250));
  document.getElementById('inv-periodo-corte')?.addEventListener('change', loadProducts);
  document.getElementById('inv-filter-cat')?.addEventListener('change', loadProducts);
  document.getElementById('inv-filter-alm')?.addEventListener('change', loadProducts);
  document.getElementById('inv-filter-estado')?.addEventListener('change', loadProducts);

  // Forms Row Buttons
  document.getElementById('btn-add-item-ent')?.addEventListener('click', addEntryRow);
  document.getElementById('btn-add-item-sal')?.addEventListener('click', addExitRow);

  // Form Submits
  document.getElementById('form-entrada')?.addEventListener('submit', e => handleMovementSubmit(e, 'ENTRADA_COMPRA'));
  document.getElementById('form-salida')?.addEventListener('submit', e => handleMovementSubmit(e, 'SALIDA_VENTA'));

  // Kardex Search Button
  document.getElementById('btn-search-kardex')?.addEventListener('click', () => executeKardexSearch());
  document.getElementById('kardex-search-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') executeKardexSearch();
  });

  // Movements Filters
  document.getElementById('mov-search')?.addEventListener('input', debounce(loadMovements, 300));
  document.getElementById('mov-filter-tipo')?.addEventListener('change', loadMovements);
  document.getElementById('mov-filter-desde')?.addEventListener('change', loadMovements);
  document.getElementById('mov-filter-hasta')?.addEventListener('change', loadMovements);
}

// Helper: Toast Notifications
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : '❌'}</span>
    <div>${message}</div>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Helper: Debounce
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ==========================================================================
// 11. MÓDULO DE CRUCE FISCAL & CLASIFICACIÓN DE PROVEEDORES
// ==========================================================================

let fiscalState = {
  proveedores: [],
  compras: [],
  ventas: [],
  resumen: null
};

async function loadFiscalReconciliation() {
  await Promise.all([
    loadFiscalKPIs(),
    loadProveedoresFiscal(),
    loadComprasFiscal(),
    loadVentasFiscal()
  ]);
}

async function loadFiscalKPIs() {
  try {
    const res = await fetch('/api/fiscal/resumen-cruce');
    const data = await res.json();
    fiscalState.resumen = data;

    let totFacturas = 0;
    let totCuadradas = 0;
    let totPendientes = 0;
    let totGastos = 0;

    if (data.compras) {
      data.compras.forEach(m => {
        totFacturas += m.total_facturas_compras || 0;
        totCuadradas += m.facturas_cuadradas || 0;
        totPendientes += m.facturas_pendientes_inventario || 0;
        totGastos += m.facturas_gastos || 0;
      });
    }

    const elTot = document.getElementById('kpi-fiscal-total-facturas');
    const elCuad = document.getElementById('kpi-fiscal-cuadradas');
    const elPend = document.getElementById('kpi-fiscal-pendientes');
    const elGast = document.getElementById('kpi-fiscal-gastos');

    if (elTot) elTot.textContent = totFacturas;
    if (elCuad) elCuad.textContent = totCuadradas;
    if (elPend) elPend.textContent = totPendientes;
    if (elGast) elGast.textContent = totGastos;
  } catch (err) {
    console.error('Error cargando KPIs fiscales:', err);
  }
}

function switchFiscalSubtab(subtabId) {
  document.querySelectorAll('.fiscal-subtab').forEach(b => {
    const btnTarget = b.getAttribute('onclick') || '';
    b.classList.toggle('active', btnTarget.includes(subtabId));
  });
  document.querySelectorAll('.fiscal-subpane').forEach(p => {
    p.style.display = p.id === subtabId ? 'block' : 'none';
  });
}

// SUBTAB 1: Proveedores & Clasificación
async function loadProveedoresFiscal() {
  const tbody = document.getElementById('tbody-proveedores-fiscal');
  if (!tbody) return;
  
  try {
    const res = await fetch('/api/proveedores');
    const provs = await res.json();
    fiscalState.proveedores = provs;
    renderProveedoresFiscal(provs);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="color: #dc2626;">Error al cargar proveedores</td></tr>`;
  }
}

function renderProveedoresFiscal(provs) {
  const tbody = document.getElementById('tbody-proveedores-fiscal');
  if (!tbody) return;

  if (!provs || provs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center">No se encontraron proveedores.</td></tr>`;
    return;
  }

  tbody.innerHTML = provs.map(p => {
    const tipo = p.tipo_servicio || 'MERCANCIA_REPUESTOS';
    const aplicaInv = p.aplica_inventario === 1;

    return `
      <tr id="row-prov-${p.id}">
        <td class="font-mono font-bold" style="color: var(--ucg-navy);">${p.rif || 'S/RIF'}</td>
        <td class="font-bold">${p.razon_social}</td>
        <td>
          <select class="prov-select-type" onchange="saveProveedorClasificacion(${p.id}, this)">
            <option value="MERCANCIA_REPUESTOS" ${tipo === 'MERCANCIA_REPUESTOS' ? 'selected' : ''}>📦 Repuestos / Mercancía (Inventario)</option>
            <option value="SERVICIOS_CONTABLES_Y_LEGALES" ${tipo === 'SERVICIOS_CONTABLES_Y_LEGALES' ? 'selected' : ''}>⚖️ Servicios Contables / Honorarios</option>
            <option value="SERVICIOS_TECNICOS_Y_SISTEMAS" ${tipo === 'SERVICIOS_TECNICOS_Y_SISTEMAS' ? 'selected' : ''}>💻 Máquinas Fiscales y Sistemas</option>
            <option value="GASTOS_MANTENIMIENTO_FERRETERIA" ${tipo === 'GASTOS_MANTENIMIENTO_FERRETERIA' ? 'selected' : ''}>🔧 Mantenimiento / Ferretería</option>
            <option value="GASTOS_CONSUMO_ALIMENTOS" ${tipo === 'GASTOS_CONSUMO_ALIMENTOS' ? 'selected' : ''}>☕ Consumo y Alimentación</option>
            <option value="ACTIVO_FIJO_EQUIPOS" ${tipo === 'ACTIVO_FIJO_EQUIPOS' ? 'selected' : ''}>🏢 Activo Fijo y Mobiliario</option>
            <option value="GASTOS_OPERATIVOS_VARIOS" ${tipo === 'GASTOS_OPERATIVOS_VARIOS' ? 'selected' : ''}>📑 Otros Gastos Operativos</option>
          </select>
        </td>
        <td class="text-center" id="badge-inv-${p.id}">
          ${aplicaInv ? '<span class="badge-inv-si">● SÍ APLICA</span>' : '<span class="badge-inv-no">○ NO (GASTO)</span>'}
        </td>
      </tr>
    `;
  }).join('');
}

async function saveProveedorClasificacion(provId, selectElem) {
  const newTipo = selectElem.value;
  const aplicaInv = newTipo === 'MERCANCIA_REPUESTOS';

  // Optimistic UI update
  const badgeCell = document.getElementById(`badge-inv-${provId}`);
  if (badgeCell) {
    badgeCell.innerHTML = aplicaInv ? '<span class="badge-inv-si">● SÍ APLICA</span>' : '<span class="badge-inv-no">○ NO (GASTO)</span>';
  }

  try {
    const res = await fetch(`/api/proveedores/${provId}/clasificacion`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo_servicio: newTipo, aplica_inventario: aplicaInv })
    });
    const result = await res.json();
    if (result.success) {
      showToast('Clasificación guardada con éxito en Turso Cloud');
      loadFiscalKPIs();
      loadComprasFiscal();
    } else {
      showToast(result.error || 'Error al guardar clasificación', 'error');
    }
  } catch (err) {
    showToast('Error de red al clasificar proveedor', 'error');
  }
}

function filterProveedoresFiscalTable() {
  const search = document.getElementById('prov-fiscal-search')?.value.toLowerCase().trim() || '';
  const filterTipo = document.getElementById('prov-filter-tipo')?.value || 'TODOS';

  const filtered = fiscalState.proveedores.filter(p => {
    const matchText = (p.razon_social || '').toLowerCase().includes(search) || (p.rif || '').toLowerCase().includes(search);
    const matchTipo = filterTipo === 'TODOS' || (p.tipo_servicio || 'MERCANCIA_REPUESTOS') === filterTipo;
    return matchText && matchTipo;
  });

  renderProveedoresFiscal(filtered);
}

// SUBTAB 2: Libro de Compras & Cruce con Inventario
async function loadComprasFiscal() {
  const tbody = document.getElementById('tbody-compras-fiscal');
  if (!tbody) return;

  const periodo = document.getElementById('compras-filter-periodo')?.value || 'TODOS';
  const estatus = document.getElementById('compras-filter-estatus')?.value || 'TODOS';

  try {
    let url = `/api/fiscal/libro-compras?`;
    if (periodo !== 'TODOS') url += `periodo=${periodo}&`;
    if (estatus !== 'TODOS') url += `estatus=${estatus}&`;

    const res = await fetch(url);
    const compras = await res.json();
    fiscalState.compras = compras;
    renderComprasFiscal(compras);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="color: #dc2626;">Error al cargar libro de compras</td></tr>`;
  }
}

function renderComprasFiscal(compras) {
  const tbody = document.getElementById('tbody-compras-fiscal');
  if (!tbody) return;

  if (!compras || compras.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center">No se encontraron facturas con los filtros seleccionados.</td></tr>`;
    return;
  }

  tbody.innerHTML = compras.map(c => {
    let statusBadge = '';
    if (c.estatus_conciliacion === 'CONCILIADO') {
      statusBadge = `<span class="badge-status in-stock">✅ Cuadrado con Inventario</span>`;
    } else if (c.estatus_conciliacion === 'NO_APLICA_GASTO') {
      statusBadge = `<span class="badge-status" style="background: #f1f5f9; color: #475569; border-color: #cbd5e1;">📑 Gasto / Servicio</span>`;
    } else {
      statusBadge = `<span class="badge-status low-stock">❌ No Registrado en Entradas</span>`;
    }

    return `
      <tr>
        <td class="font-bold">${c.periodo}</td>
        <td>${c.fecha || '-'}</td>
        <td class="font-mono font-bold" style="color: var(--ucg-navy);">${c.nro_factura || 'S/N'}</td>
        <td>
          <div class="font-bold">${c.razon_social}</div>
          <div style="font-size: 0.72rem; color: var(--text-muted);">${c.rif || ''}</div>
        </td>
        <td><span style="font-size: 0.73rem; background: #eff6ff; color: #1e40af; padding: 2px 6px; border-radius: 4px; font-weight: 700;">${(c.tipo_servicio || '').replace(/_/g, ' ')}</span></td>
        <td class="text-right font-mono font-bold">Bs. ${Number(c.base_imponible_bs).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
        <td class="text-right font-mono" style="color: var(--text-secondary);">Bs. ${Number(c.iva_bs).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
        <td class="text-center">${statusBadge}</td>
        <td style="font-size: 0.75rem; color: var(--text-secondary); max-width: 200px;">${c.observaciones_cruce || '-'}</td>
      </tr>
    `;
  }).join('');
}

function filterComprasFiscalTable() {
  const search = document.getElementById('compras-fiscal-search')?.value.toLowerCase().trim() || '';
  if (!search) {
    renderComprasFiscal(fiscalState.compras);
    return;
  }

  const filtered = fiscalState.compras.filter(c => {
    return (c.razon_social || '').toLowerCase().includes(search) ||
           (c.rif || '').toLowerCase().includes(search) ||
           (c.nro_factura || '').toLowerCase().includes(search);
  });
  renderComprasFiscal(filtered);
}

// SUBTAB 3: Ventas Fiscales
async function loadVentasFiscal() {
  const tbody = document.getElementById('tbody-ventas-fiscal');
  if (!tbody) return;

  const periodo = document.getElementById('ventas-filter-periodo')?.value || 'TODOS';

  try {
    let url = `/api/fiscal/libro-ventas?`;
    if (periodo !== 'TODOS') url += `periodo=${periodo}&`;

    const res = await fetch(url);
    const ventas = await res.json();
    fiscalState.ventas = ventas;
    renderVentasFiscal(ventas);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="color: #dc2626;">Error al cargar libro de ventas</td></tr>`;
  }
}

function renderVentasFiscal(ventas) {
  const tbody = document.getElementById('tbody-ventas-fiscal');
  if (!tbody) return;

  if (!ventas || ventas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center">No se encontraron registros de ventas.</td></tr>`;
    return;
  }

  tbody.innerHTML = ventas.map(v => {
    return `
      <tr>
        <td class="font-bold">${v.periodo}</td>
        <td>${v.fecha || '-'}</td>
        <td class="font-mono font-bold" style="color: var(--ucg-navy);">${v.factura_desde || '0'} ➔ ${v.factura_hasta || '0'}</td>
        <td class="text-center font-bold">${v.cantidad_comprobantes || 1}</td>
        <td class="text-right font-mono">Bs. ${Number(v.exento_bs).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
        <td class="text-right font-mono font-bold">Bs. ${Number(v.base_imponible_bs).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
        <td class="text-right font-mono" style="color: #166534; font-weight: 700;">Bs. ${Number(v.iva_bs).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
        <td class="text-right font-mono font-bold" style="color: var(--ucg-navy);">Bs. ${Number(v.total_bs).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
      </tr>
    `;
  }).join('');
}

// ==========================================================================
// SUBMÓDULOS DE CONTROL FISCAL SENIAT (LIBRO COMPRAS, VENTAS, FORMA 30 Y PROV)
// ==========================================================================

const fiscalStateNew = {
  compras: [],
  ventas: [],
  proveedores: [],
  declaraciones: []
};

// 1. SUBMÓDULO: LIBRO DE COMPRAS SENIAT
// --------------------------------------------------------------------------
async function loadLibroCompras() {
  const tbody = document.getElementById('tbody-libro-compras');
  if (!tbody) return;

  const periodo = document.getElementById('compras-periodo-select')?.value || '2026-10';
  const tipo = document.getElementById('compras-tipo-select')?.value || 'TODOS';

  document.getElementById('kpi-compras-periodo-sub').textContent = periodo === 'TODOS' ? 'Histórico Consolidado 2026' : `Período Fiscal: ${periodo}`;

  try {
    let url = `/api/fiscal/libro-compras?`;
    if (periodo !== 'TODOS') url += `periodo=${periodo}&`;
    if (tipo !== 'TODOS') url += `tipo_servicio=${tipo}&`;

    const res = await fetch(url);
    const compras = await res.json();
    fiscalStateNew.compras = compras;
    renderLibroCompras(compras);
  } catch (err) {
    console.error('Error cargando libro de compras:', err);
    tbody.innerHTML = `<tr><td colspan="13" class="text-center" style="color: #dc2626;">Error cargando libro de compras</td></tr>`;
  }
}

function renderLibroCompras(compras) {
  const tbody = document.getElementById('tbody-libro-compras');
  if (!tbody) return;

  if (!compras || compras.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13" class="text-center" style="padding: 24px; color: var(--text-muted);">No hay facturas registradas para el período y filtro seleccionados. Usa <strong>"+ Nueva Factura de Compra"</strong> para registrar.</td></tr>`;
    document.getElementById('kpi-compras-count').textContent = '0';
    document.getElementById('kpi-compras-base').textContent = '0,00 Bs.';
    document.getElementById('kpi-compras-iva').textContent = '0,00 Bs.';
    document.getElementById('kpi-compras-ret').textContent = '0,00 Bs.';
    document.getElementById('tot-compras-base').textContent = '0,00';
    document.getElementById('tot-compras-iva').textContent = '0,00';
    document.getElementById('tot-compras-total').textContent = '0,00';
    document.getElementById('tot-compras-ret').textContent = '0,00';
    return;
  }

  let totBase = 0;
  let totIva = 0;
  let totTotal = 0;
  let totRet = 0;

  tbody.innerHTML = compras.map((c, index) => {
    totBase += Number(c.base_imponible_bs || 0);
    totIva += Number(c.iva_bs || 0);
    totTotal += Number(c.total_bs || 0);
    totRet += Number(c.iva_retenido_bs || 0);

    const isGastos = c.aplica_inventario === 0;
    const tipoBadge = isGastos 
      ? `<span class="badge" style="background:#fef3c7; color:#92400e; font-size:10px;">${c.tipo_servicio.replace(/_/g, ' ')}</span>`
      : `<span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:10px;">REPUESTOS / MERCANCÍA</span>`;

    return `
      <tr>
        <td class="text-center font-bold">${c.nro_operacion || (index + 1)}</td>
        <td>${c.fecha || '-'}</td>
        <td class="font-mono font-bold" style="color: var(--ucg-navy);">${c.rif}</td>
        <td><strong>${c.razon_social}</strong></td>
        <td class="font-mono font-bold">${c.nro_factura || '-'}</td>
        <td class="font-mono">${c.nro_control || '-'}</td>
        <td class="text-right font-mono font-bold">Bs. ${Number(c.base_imponible_bs).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
        <td class="text-center font-mono">16%</td>
        <td class="text-right font-mono" style="color: #166534; font-weight: 700;">Bs. ${Number(c.iva_bs).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
        <td class="text-right font-mono font-bold" style="color: var(--ucg-navy);">Bs. ${Number(c.total_bs).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
        <td class="text-right font-mono" style="color: #b45309;">Bs. ${Number(c.iva_retenido_bs || 0).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
        <td>${tipoBadge}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-secondary" title="Eliminar Factura" onclick="eliminarFacturaCompra(${c.id})" style="padding: 3px 8px; font-size: 11px; color:#be123c;">
            ✕
          </button>
        </td>
      </tr>
    `;
  }).join('');

  document.getElementById('kpi-compras-count').textContent = compras.length.toString();
  document.getElementById('kpi-compras-base').textContent = `Bs. ${totBase.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
  document.getElementById('kpi-compras-iva').textContent = `Bs. ${totIva.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
  document.getElementById('kpi-compras-ret').textContent = `Bs. ${totRet.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;

  document.getElementById('tot-compras-base').textContent = `Bs. ${totBase.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
  document.getElementById('tot-compras-iva').textContent = `Bs. ${totIva.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
  document.getElementById('tot-compras-total').textContent = `Bs. ${totTotal.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
  document.getElementById('tot-compras-ret').textContent = `Bs. ${totRet.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
}

function filterLibroComprasLocal() {
  const search = (document.getElementById('compras-search')?.value || '').toLowerCase();
  if (!search) {
    renderLibroCompras(fiscalStateNew.compras);
    return;
  }
  const filtered = fiscalStateNew.compras.filter(c => {
    return (c.razon_social || '').toLowerCase().includes(search) ||
           (c.rif || '').toLowerCase().includes(search) ||
           (c.nro_factura || '').toLowerCase().includes(search);
  });
  renderLibroCompras(filtered);
}

function openModalNuevaCompra() {
  document.getElementById('form-nueva-compra').reset();
  document.getElementById('m-comp-fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('m-comp-periodo').value = '2026-10';
  document.getElementById('modal-nueva-compra').style.display = 'flex';
}

function calcularIvaCompra() {
  const base = parseFloat(document.getElementById('m-comp-base').value) || 0;
  const ali = parseFloat(document.getElementById('m-comp-alicuota').value) || 0.16;
  const retPct = parseFloat(document.getElementById('m-comp-ret-pct').value) || 0.75;

  const iva = base * ali;
  const total = base + iva;
  const ret = iva * retPct;

  document.getElementById('m-comp-iva').value = iva.toFixed(2);
  document.getElementById('m-comp-total').value = total.toFixed(2);
  document.getElementById('m-comp-ret').value = ret.toFixed(2);
}

function autoCompletarProveedorPorRif(rif) {
  if (!rif) return;
  const clean = rif.trim().toUpperCase();
  const prov = state.suppliers.find(s => (s.rif || '').toUpperCase() === clean);
  if (prov) {
    document.getElementById('m-comp-razon').value = prov.razon_social || '';
    if (prov.tipo_servicio) document.getElementById('m-comp-tipo').value = prov.tipo_servicio;
    document.getElementById('m-comp-aplica-inv').checked = (prov.aplica_inventario === 1);
  }
}

async function guardarNuevaCompra(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save-compra');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const data = {
    periodo: document.getElementById('m-comp-periodo').value,
    fecha: document.getElementById('m-comp-fecha').value,
    rif: document.getElementById('m-comp-rif').value.trim().toUpperCase(),
    razon_social: document.getElementById('m-comp-razon').value.trim(),
    nro_factura: document.getElementById('m-comp-factura').value.trim(),
    nro_control: document.getElementById('m-comp-control').value.trim() || null,
    tipo_transaccion: '01-reg',
    base_imponible_bs: parseFloat(document.getElementById('m-comp-base').value) || 0,
    alicuota: parseFloat(document.getElementById('m-comp-alicuota').value) || 0.16,
    iva_bs: parseFloat(document.getElementById('m-comp-iva').value) || 0,
    total_bs: parseFloat(document.getElementById('m-comp-total').value) || 0,
    iva_retenido_bs: parseFloat(document.getElementById('m-comp-ret').value) || 0,
    tipo_servicio: document.getElementById('m-comp-tipo').value,
    aplica_inventario: document.getElementById('m-comp-aplica-inv').checked ? 1 : 0,
    observaciones_cruce: document.getElementById('m-comp-obs').value.trim()
  };

  try {
    const res = await fetch('/api/fiscal/libro-compras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Error al guardar factura');

    showToast('Factura registrada con éxito en el Libro de Compras', 'success');
    closeModal('modal-nueva-compra');
    await loadCatalogs(); // refresh supplier list
    await loadLibroCompras();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar en Libro de Compras';
  }
}

async function eliminarFacturaCompra(id) {
  if (!confirm('¿Estás seguro de que deseas eliminar esta factura del Libro de Compras? Los totales se recalcularán automáticamente.')) {
    return;
  }
  try {
    const res = await fetch(`/api/fiscal/libro-compras/${id}`, { method: 'DELETE' });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Error al eliminar factura');
    showToast('Factura eliminada del libro de compras', 'success');
    await loadLibroCompras();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function exportarLibroComprasExcel() {
  const periodo = document.getElementById('compras-periodo-select')?.value || '2026-10';
  window.open(`/api/export/libro-compras?periodo=${periodo}`, '_blank');
}

function imprimirLibroCompras() {
  const periodo = document.getElementById('compras-periodo-select')?.value || '2026-10';
  const compras = fiscalStateNew.compras || [];

  let rowsHtml = '';
  let totBase = 0, totIva = 0, totTotal = 0, totRet = 0;

  compras.forEach((c, idx) => {
    totBase += Number(c.base_imponible_bs || 0);
    totIva += Number(c.iva_bs || 0);
    totTotal += Number(c.total_bs || 0);
    totRet += Number(c.iva_retenido_bs || 0);

    rowsHtml += `
      <tr>
        <td style="text-align:center;">${c.nro_operacion || (idx + 1)}</td>
        <td>${c.fecha || '-'}</td>
        <td style="font-family:monospace; font-weight:700;">${c.rif}</td>
        <td>${c.razon_social}</td>
        <td style="font-family:monospace;">${c.nro_factura || '-'}</td>
        <td style="font-family:monospace;">${c.nro_control || '-'}</td>
        <td style="text-align:right; font-family:monospace;">Bs. ${Number(c.total_bs).toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
        <td style="text-align:right; font-family:monospace;">0,00</td>
        <td style="text-align:right; font-family:monospace; font-weight:700;">Bs. ${Number(c.base_imponible_bs).toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
        <td style="text-align:center;">16%</td>
        <td style="text-align:right; font-family:monospace; font-weight:700;">Bs. ${Number(c.iva_bs).toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
        <td style="text-align:right; font-family:monospace;">Bs. ${Number(c.iva_retenido_bs || 0).toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
      </tr>
    `;
  });

  const printHtml = `
    <div class="print-preview-container">
      <div class="print-preview-header">
        <div>
          <img src="LOGOUCG.png" alt="Logo" style="height: 52px; object-fit: contain;">
        </div>
        <div style="text-align: center;">
          <h2 style="font-size: 14px; font-weight: 900; color: #000080; margin-bottom: 2px;">INVERSIONES DG 67, C.A.</h2>
          <div style="font-size: 11px; font-weight: 800; color: #334155;">RIF: J-50700865-7 • CONTRIBUYENTE ORDINARIO DEL IVA</div>
          <div style="font-size: 9.5px; color: #64748b;">AV. SUR 11 ENTRE ESQUINAS BOLÍVAR Y MIRANDA, CASA N° 112, LOCAL S/N, SAN AGUSTÍN DEL NORTE, CARACAS</div>
          <div style="font-size: 12px; font-weight: 900; margin-top: 6px; color: #000080; text-transform: uppercase;">LIBRO OFICIAL DE COMPRAS - PERÍODO: ${periodo}</div>
        </div>
        <div style="text-align: right; font-size: 9px; color: #64748b;">
          <div>Art. 75 y 76 Ley IVA</div>
          <div>Fecha: ${new Date().toLocaleDateString('es-VE')}</div>
          <div>Pág: 1 de 1</div>
        </div>
      </div>

      <table class="print-preview-table">
        <thead>
          <tr>
            <th style="width: 30px; text-align:center;">OP</th>
            <th>FECHA</th>
            <th>RIF</th>
            <th>NOMBRE O RAZÓN SOCIAL</th>
            <th>N° FACTURA</th>
            <th>N° CONTROL</th>
            <th style="text-align:right;">TOTAL COMPRA (BS)</th>
            <th style="text-align:right;">EXENTO (BS)</th>
            <th style="text-align:right;">BASE IMPONIBLE (BS)</th>
            <th style="text-align:center;">%</th>
            <th style="text-align:right;">IMPUESTO IVA (BS)</th>
            <th style="text-align:right;">IVA RETENIDO (BS)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="12" style="text-align:center;">Sin operaciones para el período.</td></tr>'}
        </tbody>
        <tfoot style="background:#f1f5f9; font-weight:900;">
          <tr>
            <td colspan="6" style="text-align:right;">TOTALES GENERALES:</td>
            <td style="text-align:right; font-family:monospace;">Bs. ${totTotal.toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
            <td style="text-align:right; font-family:monospace;">0,00</td>
            <td style="text-align:right; font-family:monospace;">Bs. ${totBase.toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
            <td></td>
            <td style="text-align:right; font-family:monospace;">Bs. ${totIva.toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
            <td style="text-align:right; font-family:monospace;">Bs. ${totRet.toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
          </tr>
        </tfoot>
      </table>

      <div class="print-footer-signatures">
        <div>
          <div class="sig-line">REPRESENTANTE LEGAL / ADMINISTRADOR</div>
          <div style="font-size: 9.5px; color:#64748b; margin-top:2px;">INVERSIONES DG 67, C.A. • RIF: J-50700865-7</div>
        </div>
        <div>
          <div class="sig-line">CONTADOR PÚBLICO COLEGIADO</div>
          <div style="font-size: 9.5px; color:#64748b; margin-top:2px;">UNIÓN CONTABLE GLOBAL • CPC N°</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-print-title').textContent = `Libro de Compras Fiscal SENIAT - ${periodo}`;
  document.getElementById('modal-print-body').innerHTML = printHtml;
  document.getElementById('modal-impresion-fiscal').style.display = 'flex';
}


// 2. SUBMÓDULO: LIBRO DE VENTAS SENIAT
// --------------------------------------------------------------------------
async function loadLibroVentas() {
  const tbody = document.getElementById('tbody-libro-ventas');
  if (!tbody) return;

  const periodo = document.getElementById('ventas-periodo-select')?.value || '2026-10';
  document.getElementById('kpi-ventas-periodo-sub').textContent = periodo === 'TODOS' ? 'Histórico Consolidado 2026' : `Período Fiscal: ${periodo}`;

  try {
    let url = `/api/fiscal/libro-ventas?`;
    if (periodo !== 'TODOS') url += `periodo=${periodo}&`;

    const res = await fetch(url);
    const ventas = await res.json();
    fiscalStateNew.ventas = ventas;
    renderLibroVentas(ventas);
  } catch (err) {
    console.error('Error cargando libro de ventas:', err);
    tbody.innerHTML = `<tr><td colspan="11" class="text-center" style="color: #dc2626;">Error cargando libro de ventas</td></tr>`;
  }
}

function renderLibroVentas(ventas) {
  const tbody = document.getElementById('tbody-libro-ventas');
  if (!tbody) return;

  if (!ventas || ventas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center" style="padding: 24px; color: var(--text-muted);">No hay ventas registradas para este período. Usa <strong>"+ Registrar Venta / Reporte Z"</strong> para registrar.</td></tr>`;
    document.getElementById('kpi-ventas-count').textContent = '0';
    document.getElementById('kpi-ventas-comprobantes').textContent = '0';
    document.getElementById('kpi-ventas-base').textContent = '0,00 Bs.';
    document.getElementById('kpi-ventas-iva').textContent = '0,00 Bs.';
    document.getElementById('tot-ventas-cant').textContent = '0';
    document.getElementById('tot-ventas-exento').textContent = '0,00';
    document.getElementById('tot-ventas-base').textContent = '0,00';
    document.getElementById('tot-ventas-iva').textContent = '0,00';
    document.getElementById('tot-ventas-total').textContent = '0,00';
    return;
  }

  let totCant = 0;
  let totExento = 0;
  let totBase = 0;
  let totIva = 0;
  let totTotal = 0;

  tbody.innerHTML = ventas.map((v, index) => {
    totCant += Number(v.cantidad_comprobantes || 1);
    totExento += Number(v.exento_bs || 0);
    totBase += Number(v.base_imponible_bs || 0);
    totIva += Number(v.iva_bs || 0);
    totTotal += Number(v.total_bs || 0);

    return `
      <tr>
        <td class="text-center font-bold">${index + 1}</td>
        <td>${v.fecha || '-'}</td>
        <td class="font-mono font-bold" style="color: var(--ucg-navy);">${v.factura_desde || '00000001'}</td>
        <td class="font-mono font-bold" style="color: var(--ucg-navy);">${v.factura_hasta || '00000001'}</td>
        <td class="text-center font-bold">${v.cantidad_comprobantes || 1}</td>
        <td class="text-right font-mono">Bs. ${Number(v.exento_bs || 0).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
        <td class="text-right font-mono font-bold">Bs. ${Number(v.base_imponible_bs).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
        <td class="text-center font-mono">16%</td>
        <td class="text-right font-mono" style="color: #0A5CF5; font-weight: 700;">Bs. ${Number(v.iva_bs).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
        <td class="text-right font-mono font-bold" style="color: var(--ucg-navy);">Bs. ${Number(v.total_bs).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-secondary" title="Eliminar Registro" onclick="eliminarVenta(${v.id})" style="padding: 3px 8px; font-size: 11px; color:#be123c;">
            ✕
          </button>
        </td>
      </tr>
    `;
  }).join('');

  document.getElementById('kpi-ventas-count').textContent = ventas.length.toString();
  document.getElementById('kpi-ventas-comprobantes').textContent = totCant.toString();
  document.getElementById('kpi-ventas-base').textContent = `Bs. ${totBase.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
  document.getElementById('kpi-ventas-iva').textContent = `Bs. ${totIva.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;

  document.getElementById('tot-ventas-cant').textContent = totCant.toString();
  document.getElementById('tot-ventas-exento').textContent = `Bs. ${totExento.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
  document.getElementById('tot-ventas-base').textContent = `Bs. ${totBase.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
  document.getElementById('tot-ventas-iva').textContent = `Bs. ${totIva.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
  document.getElementById('tot-ventas-total').textContent = `Bs. ${totTotal.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
}

function openModalNuevaVenta() {
  document.getElementById('form-nueva-venta').reset();
  document.getElementById('m-vent-fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('m-vent-periodo').value = '2026-10';
  document.getElementById('modal-nueva-venta').style.display = 'flex';
}

function calcularIvaVenta() {
  const base = parseFloat(document.getElementById('m-vent-base').value) || 0;
  const ex = parseFloat(document.getElementById('m-vent-exento').value) || 0;
  const iva = base * 0.16;
  const total = base + iva + ex;

  document.getElementById('m-vent-iva').value = iva.toFixed(2);
  document.getElementById('m-vent-total').value = total.toFixed(2);
}

async function guardarNuevaVenta(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save-venta');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const data = {
    periodo: document.getElementById('m-vent-periodo').value,
    fecha: document.getElementById('m-vent-fecha').value,
    factura_desde: document.getElementById('m-vent-desde').value.trim() || null,
    factura_hasta: document.getElementById('m-vent-hasta').value.trim() || null,
    cantidad_comprobantes: parseInt(document.getElementById('m-vent-cant').value, 10) || 1,
    base_imponible_bs: parseFloat(document.getElementById('m-vent-base').value) || 0,
    exento_bs: parseFloat(document.getElementById('m-vent-exento').value) || 0,
    alicuota: 0.16,
    iva_bs: parseFloat(document.getElementById('m-vent-iva').value) || 0,
    total_bs: parseFloat(document.getElementById('m-vent-total').value) || 0
  };

  try {
    const res = await fetch('/api/fiscal/libro-ventas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Error al guardar venta');

    showToast('Registro de venta agregado al Libro de Ventas', 'success');
    closeModal('modal-nueva-venta');
    await loadLibroVentas();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar en Libro de Ventas';
  }
}

async function eliminarVenta(id) {
  if (!confirm('¿Deseas eliminar este registro del Libro de Ventas?')) return;
  try {
    const res = await fetch(`/api/fiscal/libro-ventas/${id}`, { method: 'DELETE' });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Error al eliminar');
    showToast('Registro de venta eliminado', 'success');
    await loadLibroVentas();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function exportarLibroVentasExcel() {
  const periodo = document.getElementById('ventas-periodo-select')?.value || '2026-10';
  window.open(`/api/export/libro-ventas?periodo=${periodo}`, '_blank');
}

function imprimirLibroVentas() {
  const periodo = document.getElementById('ventas-periodo-select')?.value || '2026-10';
  const ventas = fiscalStateNew.ventas || [];

  let rowsHtml = '';
  let totCant = 0, totExento = 0, totBase = 0, totIva = 0, totTotal = 0;

  ventas.forEach((v, idx) => {
    totCant += Number(v.cantidad_comprobantes || 1);
    totExento += Number(v.exento_bs || 0);
    totBase += Number(v.base_imponible_bs || 0);
    totIva += Number(v.iva_bs || 0);
    totTotal += Number(v.total_bs || 0);

    rowsHtml += `
      <tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td>${v.fecha || '-'}</td>
        <td style="font-family:monospace; font-weight:700;">${v.factura_desde || '-'}</td>
        <td style="font-family:monospace; font-weight:700;">${v.factura_hasta || '-'}</td>
        <td style="text-align:center; font-weight:700;">${v.cantidad_comprobantes || 1}</td>
        <td style="text-align:right; font-family:monospace;">Bs. ${Number(v.exento_bs || 0).toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
        <td style="text-align:right; font-family:monospace; font-weight:700;">Bs. ${Number(v.base_imponible_bs).toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
        <td style="text-align:center;">16%</td>
        <td style="text-align:right; font-family:monospace; font-weight:700; color:#0A5CF5;">Bs. ${Number(v.iva_bs).toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
        <td style="text-align:right; font-family:monospace; font-weight:700;">Bs. ${Number(v.total_bs).toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
      </tr>
    `;
  });

  const printHtml = `
    <div class="print-preview-container">
      <div class="print-preview-header">
        <div>
          <img src="LOGOUCG.png" alt="Logo" style="height: 52px; object-fit: contain;">
        </div>
        <div style="text-align: center;">
          <h2 style="font-size: 14px; font-weight: 900; color: #000080; margin-bottom: 2px;">INVERSIONES DG 67, C.A.</h2>
          <div style="font-size: 11px; font-weight: 800; color: #334155;">RIF: J-50700865-7 • CONTRIBUYENTE ORDINARIO DEL IVA</div>
          <div style="font-size: 9.5px; color: #64748b;">AV. SUR 11 ENTRE ESQUINAS BOLÍVAR Y MIRANDA, CASA N° 112, LOCAL S/N, SAN AGUSTÍN DEL NORTE, CARACAS</div>
          <div style="font-size: 12px; font-weight: 900; margin-top: 6px; color: #000080; text-transform: uppercase;">LIBRO OFICIAL DE VENTAS (MÁQUINA FISCAL ZOA0000176) - PERÍODO: ${periodo}</div>
        </div>
        <div style="text-align: right; font-size: 9px; color: #64748b;">
          <div>Art. 77 Ley IVA</div>
          <div>Fecha: ${new Date().toLocaleDateString('es-VE')}</div>
          <div>Pág: 1 de 1</div>
        </div>
      </div>

      <table class="print-preview-table">
        <thead>
          <tr>
            <th style="width: 30px; text-align:center;">OP</th>
            <th>FECHA REPORTE</th>
            <th>DESDE FACTURA</th>
            <th>HASTA FACTURA</th>
            <th style="text-align:center;">COMPROBANTES</th>
            <th style="text-align:right;">EXENTO (BS)</th>
            <th style="text-align:right;">BASE IMPONIBLE (BS)</th>
            <th style="text-align:center;">%</th>
            <th style="text-align:right;">DÉBITO FISCAL (BS)</th>
            <th style="text-align:right;">TOTAL VENTAS (BS)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="10" style="text-align:center;">Sin operaciones para el período.</td></tr>'}
        </tbody>
        <tfoot style="background:#f1f5f9; font-weight:900;">
          <tr>
            <td colspan="4" style="text-align:right;">TOTALES GENERALES:</td>
            <td style="text-align:center;">${totCant}</td>
            <td style="text-align:right; font-family:monospace;">Bs. ${totExento.toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
            <td style="text-align:right; font-family:monospace;">Bs. ${totBase.toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
            <td></td>
            <td style="text-align:right; font-family:monospace;">Bs. ${totIva.toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
            <td style="text-align:right; font-family:monospace;">Bs. ${totTotal.toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
          </tr>
        </tfoot>
      </table>

      <div class="print-footer-signatures">
        <div>
          <div class="sig-line">REPRESENTANTE LEGAL / ADMINISTRADOR</div>
          <div style="font-size: 9.5px; color:#64748b; margin-top:2px;">INVERSIONES DG 67, C.A. • RIF: J-50700865-7</div>
        </div>
        <div>
          <div class="sig-line">CONTADOR PÚBLICO COLEGIADO</div>
          <div style="font-size: 9.5px; color:#64748b; margin-top:2px;">UNIÓN CONTABLE GLOBAL • CPC N°</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-print-title').textContent = `Libro de Ventas Fiscal SENIAT - ${periodo}`;
  document.getElementById('modal-print-body').innerHTML = printHtml;
  document.getElementById('modal-impresion-fiscal').style.display = 'flex';
}


// 3. SUBMÓDULO: DECLARACIONES Y RESUMEN IVA FORMA 30
// --------------------------------------------------------------------------
async function loadDeclaracionDetalle() {
  const periodo = document.getElementById('decl-periodo-select')?.value || '2026-10';

  try {
    const [detailRes, historyRes] = await Promise.all([
      fetch(`/api/fiscal/declaracion/${periodo}`),
      fetch('/api/fiscal/declaraciones-iva')
    ]);

    const detailData = await detailRes.json();
    const historyData = await historyRes.json();

    fiscalStateNew.declaraciones = historyData;

    // Render Cards
    const d = detailData.declaracion || {};
    const c = detailData.compras || {};
    const v = detailData.ventas || {};

    const vBase = Number(d.ventas_base_bs || v.total_base || 0);
    const vDeb = Number(d.debito_fiscal_bs || v.total_iva || 0);
    const vDias = Number(d.total_ventas_dias || v.count_lotes || 0);

    const cBase = Number(d.compras_base_bs || c.total_base || 0);
    const cCred = Number(d.credito_fiscal_bs || c.total_iva || 0);
    const cFacs = Number(d.total_compras_facturas || c.count_facturas || 0);
    const excAnt = Number(d.excedente_anterior_bs || 0);
    const excSig = Number(d.excedente_siguiente_bs || 0);
    const aPagar = Number(d.total_a_pagar_bs || 0);
    const cRet = Number(c.total_retenido || d.iva_retenido_bs || 0);

    const totCredDeducible = cCred + excAnt;

    // Débitos
    document.getElementById('f30-ventas-base').textContent = `Bs. ${vBase.toLocaleString('es-VE', {minimumFractionDigits:2})}`;
    document.getElementById('f30-ventas-debito').textContent = `Bs. ${vDeb.toLocaleString('es-VE', {minimumFractionDigits:2})}`;
    document.getElementById('f30-ventas-exento').textContent = `0,00 Bs.`;
    document.getElementById('f30-ventas-dias').textContent = `${vDias} días facturados`;
    document.getElementById('f30-total-debitos').textContent = `Bs. ${vDeb.toLocaleString('es-VE', {minimumFractionDigits:2})}`;

    // Créditos
    document.getElementById('f30-compras-base').textContent = `Bs. ${cBase.toLocaleString('es-VE', {minimumFractionDigits:2})}`;
    document.getElementById('f30-compras-credito').textContent = `Bs. ${cCred.toLocaleString('es-VE', {minimumFractionDigits:2})}`;
    document.getElementById('f30-excedente-anterior').textContent = `Bs. ${excAnt.toLocaleString('es-VE', {minimumFractionDigits:2})}`;
    document.getElementById('f30-compras-facs').textContent = `${cFacs} facturas`;
    document.getElementById('f30-total-creditos').textContent = `Bs. ${totCredDeducible.toLocaleString('es-VE', {minimumFractionDigits:2})}`;

    // Resultado
    document.getElementById('f30-res-debitos').textContent = `Bs. ${vDeb.toLocaleString('es-VE', {minimumFractionDigits:2})}`;
    document.getElementById('f30-res-creditos').textContent = `- Bs. ${totCredDeducible.toLocaleString('es-VE', {minimumFractionDigits:2})}`;
    document.getElementById('f30-res-retenciones').textContent = `- Bs. ${cRet.toLocaleString('es-VE', {minimumFractionDigits:2})}`;

    const badge = document.getElementById('decl-status-badge');
    const resBox = document.getElementById('f30-box-resultado');
    const resLbl = document.getElementById('f30-lbl-resultado');
    const resVal = document.getElementById('f30-val-resultado');

    if (periodo === '2026-10') {
      badge.textContent = 'MES ACTUAL EN PREPARACIÓN';
      badge.style.background = '#dbeafe';
      badge.style.color = '#1e40af';
    } else {
      badge.textContent = 'DECLARADO ANTE SENIAT';
      badge.style.background = '#dcfce7';
      badge.style.color = '#15803d';
    }

    if (aPagar > 0) {
      resBox.className = 'highlight-box-pagar';
      resLbl.textContent = 'TOTAL IMPUESTO A PAGAR AL SENIAT:';
      resVal.textContent = `Bs. ${aPagar.toLocaleString('es-VE', {minimumFractionDigits:2})}`;
    } else {
      resBox.className = 'highlight-box-favor';
      resLbl.textContent = 'EXCEDENTE DE CRÉDITO PARA EL MES SIGUIENTE:';
      resVal.textContent = `Bs. ${excSig.toLocaleString('es-VE', {minimumFractionDigits:2})}`;
    }

    // Render Historical Table
    renderDeclaracionesHistorico(historyData);
  } catch (err) {
    console.error('Error cargando detalle de declaración:', err);
  }
}

function renderDeclaracionesHistorico(declaraciones) {
  const tbody = document.getElementById('tbody-declaraciones-historico');
  if (!tbody) return;

  if (!declaraciones || declaraciones.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center">No hay declaraciones registradas.</td></tr>`;
    return;
  }

  tbody.innerHTML = declaraciones.map(d => {
    const isEnProceso = d.periodo === '2026-10' || d.estatus === 'EN_PROCESO';
    const statusPill = isEnProceso
      ? `<span class="badge" style="background:#dbeafe; color:#1e40af;">EN PREPARACIÓN</span>`
      : `<span class="badge" style="background:#dcfce7; color:#15803d;">DECLARADO</span>`;

    const aPagarNum = Number(d.total_a_pagar_bs || 0);
    const excSigNum = Number(d.excedente_siguiente_bs || 0);

    return `
      <tr>
        <td class="font-bold" style="color: var(--ucg-navy);">${d.periodo}</td>
        <td class="text-right font-mono">Bs. ${Number(d.ventas_base_bs).toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
        <td class="text-right font-mono font-bold" style="color: #0A5CF5;">Bs. ${Number(d.debito_fiscal_bs).toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
        <td class="text-right font-mono">Bs. ${Number(d.compras_base_bs).toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
        <td class="text-right font-mono font-bold" style="color: #166534;">Bs. ${Number(d.credito_fiscal_bs).toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
        <td class="text-right font-mono" style="color: #0284c7;">Bs. ${Number(d.excedente_anterior_bs || 0).toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
        <td class="text-right font-mono font-bold" style="color: #166534;">Bs. ${excSigNum.toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
        <td class="text-right font-mono font-bold" style="color: ${aPagarNum > 0 ? '#be123c' : '#64748b'};">
          ${aPagarNum > 0 ? `Bs. ${aPagarNum.toLocaleString('es-VE', {minimumFractionDigits:2})}` : '0,00 Bs.'}
        </td>
        <td class="text-center">${statusPill}</td>
      </tr>
    `;
  }).join('');
}

function imprimirDeclaracionForma30() {
  const periodo = document.getElementById('decl-periodo-select')?.value || '2026-10';
  const d = fiscalStateNew.declaraciones.find(x => x.periodo === periodo) || {};

  const vBase = Number(d.ventas_base_bs || 0);
  const vDeb = Number(d.debito_fiscal_bs || 0);
  const cBase = Number(d.compras_base_bs || 0);
  const cCred = Number(d.credito_fiscal_bs || 0);
  const excAnt = Number(d.excedente_anterior_bs || 0);
  const excSig = Number(d.excedente_siguiente_bs || 0);
  const aPagar = Number(d.total_a_pagar_bs || 0);
  const totCred = cCred + excAnt;

  const printHtml = `
    <div class="print-preview-container">
      <div class="print-preview-header">
        <div>
          <img src="LOGOUCG.png" alt="Logo" style="height: 52px; object-fit: contain;">
        </div>
        <div style="text-align: center;">
          <h2 style="font-size: 14px; font-weight: 900; color: #000080; margin-bottom: 2px;">INVERSIONES DG 67, C.A.</h2>
          <div style="font-size: 11px; font-weight: 800; color: #334155;">RIF: J-50700865-7 • CONTRIBUYENTE ORDINARIO DEL IVA</div>
          <div style="font-size: 9.5px; color: #64748b;">AV. SUR 11 ENTRE ESQUINAS BOLÍVAR Y MIRANDA, CASA N° 112, LOCAL S/N, SAN AGUSTÍN DEL NORTE, CARACAS</div>
          <div style="font-size: 12px; font-weight: 900; margin-top: 6px; color: #000080; text-transform: uppercase;">FORMA 30 - RESUMEN DE DECLARACIÓN MENSUAL DE IVA (${periodo})</div>
        </div>
        <div style="text-align: right; font-size: 9px; color: #64748b;">
          <div>SENIAT FORMA 30</div>
          <div>Emisión: ${new Date().toLocaleDateString('es-VE')}</div>
        </div>
      </div>

      <div style="margin-bottom: 18px; padding: 10px 14px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 11px;">
        <strong>Período Impositivo:</strong> ${periodo} &nbsp;|&nbsp; <strong>Estatus Tributario:</strong> ${periodo === '2026-10' ? 'EN PROCESO DE DETERMINACIÓN' : 'DECLARADO'}
      </div>

      <table class="print-preview-table" style="font-size: 11px;">
        <thead>
          <tr>
            <th colspan="2" style="background:#000080; color:#fff;">I. DÉBITOS FISCALES (VENTAS DEL PERÍODO)</th>
            <th style="background:#000080; color:#fff; text-align:right;">BASE IMPONIBLE (BS)</th>
            <th style="background:#000080; color:#fff; text-align:right;">DÉBITO FISCAL (BS)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="width: 40px; text-align:center;">40</td>
            <td>Ventas Internas No Gravadas / Exentas</td>
            <td style="text-align:right; font-family:monospace;">0,00</td>
            <td style="text-align:right; font-family:monospace;">0,00</td>
          </tr>
          <tr>
            <td style="text-align:center;">42</td>
            <td>Ventas Internas Gravadas por Alícuota General (16%)</td>
            <td style="text-align:right; font-family:monospace; font-weight:700;">Bs. ${vBase.toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
            <td style="text-align:right; font-family:monospace; font-weight:700; color:#0A5CF5;">Bs. ${vDeb.toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
          </tr>
          <tr style="background:#f1f5f9; font-weight:800;">
            <td style="text-align:center;">49</td>
            <td>TOTAL VENTAS Y DÉBITOS FISCALES</td>
            <td style="text-align:right; font-family:monospace;">Bs. ${vBase.toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
            <td style="text-align:right; font-family:monospace; color:#0A5CF5;">Bs. ${vDeb.toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
          </tr>
        </tbody>
      </table>

      <table class="print-preview-table" style="font-size: 11px; margin-top: 14px;">
        <thead>
          <tr>
            <th colspan="2" style="background:#166534; color:#fff;">II. CRÉDITOS FISCALES (COMPRAS Y ARRASTRES)</th>
            <th style="background:#166534; color:#fff; text-align:right;">BASE IMPONIBLE (BS)</th>
            <th style="background:#166534; color:#fff; text-align:right;">CRÉDITO FISCAL (BS)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="width: 40px; text-align:center;">60</td>
            <td>Compras Internas No Gravadas / Exentas</td>
            <td style="text-align:right; font-family:monospace;">0,00</td>
            <td style="text-align:right; font-family:monospace;">0,00</td>
          </tr>
          <tr>
            <td style="text-align:center;">62</td>
            <td>Compras Internas Gravadas por Alícuota General (16%)</td>
            <td style="text-align:right; font-family:monospace; font-weight:700;">Bs. ${cBase.toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
            <td style="text-align:right; font-family:monospace; font-weight:700; color:#166534;">Bs. ${cCred.toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
          </tr>
          <tr>
            <td style="text-align:center;">67</td>
            <td>Excedente de Créditos Fiscales del Mes Anterior</td>
            <td style="text-align:right; font-family:monospace;">-</td>
            <td style="text-align:right; font-family:monospace; color:#0284c7;">Bs. ${excAnt.toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
          </tr>
          <tr style="background:#f1f5f9; font-weight:800;">
            <td style="text-align:center;">69</td>
            <td>TOTAL CRÉDITOS FISCALES DEDUCIBLES</td>
            <td style="text-align:right; font-family:monospace;">Bs. ${cBase.toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
            <td style="text-align:right; font-family:monospace; color:#166534;">Bs. ${totCred.toLocaleString('es-VE', {minimumFractionDigits:2})}</td>
          </tr>
        </tbody>
      </table>

      <table class="print-preview-table" style="font-size: 11px; margin-top: 14px;">
        <thead>
          <tr>
            <th colspan="2" style="background:#000080; color:#fff;">III. DETERMINACIÓN DEL IMPUESTO DEL PERÍODO</th>
            <th style="background:#000080; color:#fff; text-align:right;">MONTO EN BOLÍVARES (BS)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="width: 40px; text-align:center;">72</td>
            <td>Subtotal Impuesto Determinado (Débito - Créditos Deducibles)</td>
            <td style="text-align:right; font-family:monospace; font-weight:700;">
              Bs. ${(vDeb - totCred).toLocaleString('es-VE', {minimumFractionDigits:2})}
            </td>
          </tr>
          <tr>
            <td style="text-align:center;">74</td>
            <td>Retenciones de IVA soportadas en el período</td>
            <td style="text-align:right; font-family:monospace;">0,00 Bs.</td>
          </tr>
          <tr style="background:${aPagar > 0 ? '#fef2f2' : '#f0fdf4'}; font-weight:900; font-size:12px;">
            <td style="text-align:center;">${aPagar > 0 ? '78' : '82'}</td>
            <td>${aPagar > 0 ? 'TOTAL IMPUESTO A PAGAR AL SENIAT' : 'EXCEDENTE DE CRÉDITO FISCAL PARA EL MES SIGUIENTE'}</td>
            <td style="text-align:right; font-family:monospace; color:${aPagar > 0 ? '#be123c' : '#166534'};">
              Bs. ${(aPagar > 0 ? aPagar : excSig).toLocaleString('es-VE', {minimumFractionDigits:2})}
            </td>
          </tr>
        </tbody>
      </table>

      <div class="print-footer-signatures">
        <div>
          <div class="sig-line">REPRESENTANTE LEGAL / ADMINISTRADOR</div>
          <div style="font-size: 9.5px; color:#64748b; margin-top:2px;">INVERSIONES DG 67, C.A. • RIF: J-50700865-7</div>
        </div>
        <div>
          <div class="sig-line">CONTADOR PÚBLICO COLEGIADO</div>
          <div style="font-size: 9.5px; color:#64748b; margin-top:2px;">UNIÓN CONTABLE GLOBAL • CPC N°</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-print-title').textContent = `Forma 30 SENIAT - Resumen Mensual ${periodo}`;
  document.getElementById('modal-print-body').innerHTML = printHtml;
  document.getElementById('modal-impresion-fiscal').style.display = 'flex';
}


// 4. SUBMÓDULO: PANEL DE DIRECTORIO DE PROVEEDORES
// --------------------------------------------------------------------------
async function loadProveedoresDirectorio() {
  const tbody = document.getElementById('tbody-proveedores-panel');
  if (!tbody) return;

  try {
    const res = await fetch('/api/proveedores');
    const proveedores = await res.json();
    fiscalStateNew.proveedores = proveedores;
    state.suppliers = proveedores; // update global
    renderProveedoresDirectorio(proveedores);
  } catch (err) {
    console.error('Error cargando proveedores:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="color: #dc2626;">Error al cargar proveedores</td></tr>`;
  }
}

function renderProveedoresDirectorio(proveedores) {
  const tbody = document.getElementById('tbody-proveedores-panel');
  if (!tbody) return;

  if (!proveedores || proveedores.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center">No se encontraron proveedores.</td></tr>`;
    return;
  }

  tbody.innerHTML = proveedores.map(p => {
    const isInv = p.aplica_inventario === 1;
    const invBadge = isInv
      ? `<span class="badge" style="background:#e0f2fe; color:#0369a1; cursor:pointer;" onclick="toggleAplicaInventarioDirecto(${p.id}, 1)">✅ SÍ (Afecta Almacén)</span>`
      : `<span class="badge" style="background:#fef3c7; color:#92400e; cursor:pointer;" onclick="toggleAplicaInventarioDirecto(${p.id}, 0)">❌ NO (Gasto/Servicio)</span>`;

    return `
      <tr>
        <td class="font-mono font-bold" style="color: var(--ucg-navy);">${p.rif || 'S/RIF'}</td>
        <td>
          <strong>${p.razon_social}</strong>
          ${p.telefono ? `<div style="font-size: 11px; color: var(--text-muted);">📞 ${p.telefono}</div>` : ''}
        </td>
        <td>
          <select class="form-control" style="font-size: 11px; padding: 4px 8px;" onchange="cambiarTipoServicioDirecto(${p.id}, this.value, ${p.aplica_inventario})">
            <option value="MERCANCIA_REPUESTOS" ${p.tipo_servicio === 'MERCANCIA_REPUESTOS' ? 'selected' : ''}>📦 Repuestos / Mercancía</option>
            <option value="SERVICIOS_CONTABLES_Y_LEGALES" ${p.tipo_servicio === 'SERVICIOS_CONTABLES_Y_LEGALES' ? 'selected' : ''}>⚖️ Servicios Contables / Asesoría</option>
            <option value="SERVICIOS_TECNICOS_Y_SISTEMAS" ${p.tipo_servicio === 'SERVICIOS_TECNICOS_Y_SISTEMAS' ? 'selected' : ''}>💻 Sistemas / Máquinas Fiscales</option>
            <option value="GASTOS_MANTENIMIENTO_FERRETERIA" ${p.tipo_servicio === 'GASTOS_MANTENIMIENTO_FERRETERIA' ? 'selected' : ''}>🔧 Ferretería y Mantenimiento</option>
            <option value="GASTOS_CONSUMO_ALIMENTOS" ${p.tipo_servicio === 'GASTOS_CONSUMO_ALIMENTOS' ? 'selected' : ''}>☕ Consumo y Alimentación</option>
            <option value="ACTIVO_FIJO_EQUIPOS" ${p.tipo_servicio === 'ACTIVO_FIJO_EQUIPOS' ? 'selected' : ''}>🏢 Activo Fijo y Equipos</option>
            <option value="GASTOS_OPERATIVOS_VARIOS" ${p.tipo_servicio === 'GASTOS_OPERATIVOS_VARIOS' ? 'selected' : ''}>📑 Otros Gastos Operativos</option>
          </select>
        </td>
        <td class="text-center">${invBadge}</td>
        <td class="text-center font-bold font-mono" style="color: var(--ucg-navy);">${p.porcentaje_retencion || 75}%</td>
        <td class="text-center">
          <button class="btn btn-sm btn-secondary" onclick="openModalNuevoProveedor(${p.id})" style="padding: 4px 10px; font-size: 11px;">
            ✏️ Editar
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterProveedoresPanel() {
  const search = (document.getElementById('prov-panel-search')?.value || '').toLowerCase();
  const tipo = document.getElementById('prov-panel-tipo')?.value || 'TODOS';

  let filtered = fiscalStateNew.proveedores;

  if (tipo !== 'TODOS') {
    filtered = filtered.filter(p => p.tipo_servicio === tipo);
  }
  if (search) {
    filtered = filtered.filter(p => {
      return (p.razon_social || '').toLowerCase().includes(search) ||
             (p.rif || '').toLowerCase().includes(search);
    });
  }
  renderProveedoresDirectorio(filtered);
}

function openModalNuevoProveedor(id = null) {
  const form = document.getElementById('form-nuevo-proveedor');
  form.reset();

  if (id) {
    const prov = fiscalStateNew.proveedores.find(p => p.id === id);
    if (prov) {
      document.getElementById('modal-prov-title').textContent = '✏️ Editar Proveedor Fiscal';
      document.getElementById('m-prov-id').value = prov.id;
      document.getElementById('m-prov-rif').value = prov.rif || '';
      document.getElementById('m-prov-razon').value = prov.razon_social || '';
      document.getElementById('m-prov-tipo').value = prov.tipo_servicio || 'MERCANCIA_REPUESTOS';
      document.getElementById('m-prov-ret-pct').value = String(prov.porcentaje_retencion || '75.0');
      document.getElementById('m-prov-telefono').value = prov.telefono || '';
      document.getElementById('m-prov-email').value = prov.email || '';
      document.getElementById('m-prov-aplica-inv').checked = (prov.aplica_inventario === 1);
    }
  } else {
    document.getElementById('modal-prov-title').textContent = '🏢 Registrar Nuevo Proveedor';
    document.getElementById('m-prov-id').value = '';
    document.getElementById('m-prov-aplica-inv').checked = true;
  }

  document.getElementById('modal-nuevo-proveedor').style.display = 'flex';
}

async function guardarProveedor(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save-prov');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const id = document.getElementById('m-prov-id').value;
  const data = {
    rif: document.getElementById('m-prov-rif').value.trim().toUpperCase(),
    razon_social: document.getElementById('m-prov-razon').value.trim(),
    tipo_servicio: document.getElementById('m-prov-tipo').value,
    aplica_inventario: document.getElementById('m-prov-aplica-inv').checked ? 1 : 0,
    porcentaje_retencion: parseFloat(document.getElementById('m-prov-ret-pct').value) || 75.0,
    telefono: document.getElementById('m-prov-telefono').value.trim() || null,
    email: document.getElementById('m-prov-email').value.trim() || null
  };

  try {
    const url = id ? `/api/proveedores/${id}` : `/api/proveedores`;
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Error al guardar proveedor');

    showToast('Proveedor guardado correctamente', 'success');
    closeModal('modal-nuevo-proveedor');
    await loadProveedoresDirectorio();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar Proveedor';
  }
}

async function toggleAplicaInventarioDirecto(id, actual) {
  const nuevoAplica = actual === 1 ? 0 : 1;
  const prov = fiscalStateNew.proveedores.find(p => p.id === id);
  if (!prov) return;

  try {
    const res = await fetch(`/api/proveedores/${id}/clasificacion`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo_servicio: prov.tipo_servicio || 'MERCANCIA_REPUESTOS',
        aplica_inventario: nuevoAplica
      })
    });
    if (!res.ok) throw new Error('Error al actualizar');
    showToast('Afectación de inventario actualizada', 'success');
    await loadProveedoresDirectorio();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function cambiarTipoServicioDirecto(id, tipo, aplica) {
  try {
    const res = await fetch(`/api/proveedores/${id}/clasificacion`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo_servicio: tipo,
        aplica_inventario: aplica
      })
    });
    if (!res.ok) throw new Error('Error al actualizar');
    showToast('Clasificación de servicio actualizada', 'success');
    await loadProveedoresDirectorio();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

