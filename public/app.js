// ==========================================================================
// INVERSIONES DG 67, C.A. - FRONTEND LOGIC (TURSO CLOUD)
// ==========================================================================

const state = {
  products: [],
  suppliers: [],
  categories: [],
  warehouses: [],
  tasasBcv: [],
  metodoValoracionKardex: 'CPP',
  dashboard: null,
  activeTab: 'tab-dashboard'
};

// --------------------------------------------------------------------------
// CONTROL DE ACCESO CORPORATIVO Y AUTENTICACIÓN (UNIÓN CONTABLE GLOBAL)
// --------------------------------------------------------------------------
const AUTH_STORAGE_KEY = 'dg67_auth_session';

document.addEventListener('DOMContentLoaded', () => {
  checkAuthSession();
});

function checkAuthSession() {
  const sessionData = localStorage.getItem(AUTH_STORAGE_KEY) || sessionStorage.getItem(AUTH_STORAGE_KEY);
  if (sessionData) {
    try {
      const session = JSON.parse(sessionData);
      if (session && session.usuario) {
        showApp(session.usuario);
        initApp();
        return;
      }
    } catch (e) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }
  showLogin();
}

function showLogin() {
  const loginScreen = document.getElementById('login-screen');
  const appLayout = document.getElementById('app-layout');
  if (loginScreen) loginScreen.style.display = 'flex';
  if (appLayout) appLayout.style.display = 'none';
  const userInput = document.getElementById('login-username');
  if (userInput) userInput.focus();
}

function showApp(user) {
  const loginScreen = document.getElementById('login-screen');
  const appLayout = document.getElementById('app-layout');
  if (loginScreen) loginScreen.style.display = 'none';
  if (appLayout) appLayout.style.display = 'flex';

  // Actualizar Ficha de Usuario en la Barra Lateral
  if (user) {
    const nameEl = document.getElementById('user-name-display');
    const roleEl = document.getElementById('user-role-display');
    const avatarEl = document.getElementById('user-avatar');
    
    if (nameEl) nameEl.textContent = user.nombre || user.usuario;
    if (roleEl) roleEl.textContent = (user.rol || 'USUARIO').toUpperCase();
    if (avatarEl) {
      const initials = (user.nombre || user.usuario || 'DG')
        .split(' ')
        .map(w => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();
      avatarEl.textContent = initials || 'DG';
    }
  }
}

async function handleLoginSubmit(event) {
  if (event) event.preventDefault();
  
  const userEl = document.getElementById('login-username');
  const pwdEl = document.getElementById('login-password');
  const alertEl = document.getElementById('login-error-alert');
  const alertText = document.getElementById('login-error-text');
  const btnSubmit = document.getElementById('btn-login-submit');
  const btnText = document.getElementById('login-btn-text');

  const usuario = (userEl?.value || '').trim();
  const password = pwdEl?.value || '';

  if (!usuario || !password) {
    if (alertEl && alertText) {
      alertText.textContent = 'Por favor ingrese su usuario y contraseña.';
      alertEl.style.display = 'flex';
    }
    return;
  }

  // Ocultar error previo y poner estado de carga
  if (alertEl) alertEl.style.display = 'none';
  if (btnSubmit) btnSubmit.disabled = true;
  if (btnText) btnText.textContent = 'Verificando credenciales...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password })
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(text || `Error de comunicación con el servidor (${res.status})`);
    }

    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Credenciales inválidas.');
    }

    // Guardar sesión si el checkbox está activo
    const remember = document.getElementById('login-remember')?.checked !== false;
    if (remember) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
    } else {
      sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
    }

    showToast(`Bienvenido, ${data.usuario.nombre || data.usuario.usuario}`, 'success');
    showApp(data.usuario);
    initApp();

  } catch (error) {
    if (alertEl && alertText) {
      alertText.textContent = error.message;
      alertEl.style.display = 'flex';
    }
    if (pwdEl) {
      pwdEl.value = '';
      pwdEl.focus();
    }
  } finally {
    if (btnSubmit) btnSubmit.disabled = false;
    if (btnText) btnText.textContent = 'Ingresar al Sistema';
  }
}

function logoutSession() {
  if (!confirm('¿Desea cerrar la sesión de trabajo segura?')) return;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  const pwdEl = document.getElementById('login-password');
  if (pwdEl) pwdEl.value = '';
  showLogin();
  showToast('Sesión finalizada correctamente', 'info');
}

function togglePasswordVisibility() {
  const pwdInput = document.getElementById('login-password');
  const eyeShow = document.getElementById('eye-icon-show');
  const eyeHide = document.getElementById('eye-icon-hide');
  if (!pwdInput) return;

  if (pwdInput.type === 'password') {
    pwdInput.type = 'text';
    if (eyeShow) eyeShow.style.display = 'none';
    if (eyeHide) eyeHide.style.display = 'inline';
  } else {
    pwdInput.type = 'password';
    if (eyeShow) eyeShow.style.display = 'inline';
    if (eyeHide) eyeHide.style.display = 'none';
  }
}

function fillQuickLogin(user, pwd) {
  const userEl = document.getElementById('login-username');
  const pwdEl = document.getElementById('login-password');
  const alertEl = document.getElementById('login-error-alert');
  if (userEl) userEl.value = user;
  if (pwdEl) pwdEl.value = pwd;
  if (alertEl) alertEl.style.display = 'none';
  handleLoginSubmit();
}

let appInitialized = false;
async function initApp() {
  if (appInitialized) return;
  appInitialized = true;
  setupNavigation();
  setupEventListeners();
  
  // Set default dates to today
  const today = new Date().toISOString().split('T')[0];
  ['ent-fecha', 'ent-fecha-factura', 'sal-fecha', 'ent-fecha-tasa', 'sal-fecha-tasa'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = today;
  });

  // Predefinir modo de carga en Bolívares con referencia en Dólares por normativa
  if (document.getElementById('ent-modo-moneda')) document.getElementById('ent-modo-moneda').value = 'BS';
  if (document.getElementById('sal-modo-moneda')) document.getElementById('sal-modo-moneda').value = 'BS';

  // Initial Data Loads
  await Promise.all([
    checkHealth(),
    loadTasasBcvPeriodo(),
    loadDashboard(),
    loadCatalogs(),
    loadProducts()
  ]);

  // Add initial rows in forms
  addEntryRow();
  addExitRow();
}

async function loadTasasBcvPeriodo() {
  try {
    const res = await fetch('/api/tasas-bcv');
    const data = await res.json();
    if (Array.isArray(data.tasas)) {
      state.tasasBcv = data.tasas;
    }
    if (data.metodo_valoracion_kardex) {
      state.metodoValoracionKardex = data.metodo_valoracion_kardex;
      const salMet = document.getElementById('sal-metodo-val');
      const karMet = document.getElementById('kardex-metodo-select');
      const tabMet = document.getElementById('cfg-metodo-kardex-tab');
      if (salMet) salMet.value = data.metodo_valoracion_kardex;
      if (karMet) karMet.value = data.metodo_valoracion_kardex;
      if (tabMet) tabMet.value = data.metodo_valoracion_kardex;
    }

    // Actualizar Widget Ejecutivo del Dashboard y formularios con la tasa activa
    const tasaActiva = data.tasa_activa || (state.tasasBcv && state.tasasBcv[state.tasasBcv.length - 1]);
    if (tasaActiva) {
      state.tasaActiva = tasaActiva;
      const displayRate = document.getElementById('dashboard-tasa-bcv-display');
      const displayFecha = document.getElementById('dashboard-tasa-bcv-fecha');
      const inputRate = document.getElementById('daily-bcv-input');
      const inputFecha = document.getElementById('daily-bcv-fecha-input');

      const rateNum = Number(tasaActiva.tasa_bcv || 0);
      if (displayRate) displayRate.textContent = `Bs. ${rateNum.toFixed(4)}`;
      if (displayFecha) displayFecha.textContent = `Vigencia Oficial: ${tasaActiva.fecha || tasaActiva.fecha_cierre || 'Al día'}`;
      if (inputRate && !inputRate.value) inputRate.value = rateNum.toFixed(4);
      if (inputFecha && !inputFecha.value) inputFecha.value = tasaActiva.fecha || tasaActiva.fecha_cierre || new Date().toISOString().split('T')[0];

      // Asignar tasa BCV por defecto en Entrada (Factura) y Salida (Venta)
      const entTasa = document.getElementById('ent-tasa');
      const salTasa = document.getElementById('sal-tasa');
      if (entTasa && !entTasa.value) entTasa.value = rateNum.toFixed(4);
      if (salTasa && !salTasa.value) salTasa.value = rateNum.toFixed(4);
      calculateEntryTotals();
      calculateExitTotals();
    }
  } catch (err) {
    console.error('Error cargando tasas BCV:', err);
  }
}

function getTasaBcvPorFechaOPeriodo(fechaOPeriodo) {
  const per = String(fechaOPeriodo || '').slice(0, 7);
  const found = (state.tasasBcv || []).find(t => t.periodo === per);
  if (found) return Number(found.tasa_bcv);
  if (state.tasaActiva && Number(state.tasaActiva.tasa_bcv) > 0) {
    return Number(state.tasaActiva.tasa_bcv);
  }
  if (state.tasasBcv && state.tasasBcv.length > 0) {
    return Number(state.tasasBcv[state.tasasBcv.length - 1].tasa_bcv);
  }
  return 889.58;
}

function onCambioFechaFacturaEntrada() {
  const fFacturaEl = document.getElementById('ent-fecha-factura');
  const fTasaEl = document.getElementById('ent-fecha-tasa');
  const tasaEl = document.getElementById('ent-tasa');
  if (!fFacturaEl) return;
  const valFecha = fFacturaEl.value;
  if (fTasaEl) fTasaEl.value = valFecha;
  if (tasaEl && valFecha) {
    tasaEl.value = getTasaBcvPorFechaOPeriodo(valFecha).toFixed(4);
  }
  calculateEntryTotals();
}

function onCambioFechaAlmacenEntrada() {
  calculateEntryTotals();
}

function onCambioFechaMovimiento(prefijo) {
  const fechaEl = document.getElementById(`${prefijo}-fecha`);
  const tasaEl = document.getElementById(`${prefijo}-tasa`);
  const fechaTasaEl = document.getElementById(`${prefijo}-fecha-tasa`);
  if (!fechaEl) return;
  const valFecha = fechaEl.value;
  if (fechaTasaEl) fechaTasaEl.value = valFecha;
  if (tasaEl && valFecha) {
    tasaEl.value = getTasaBcvPorFechaOPeriodo(valFecha).toFixed(4);
  }
  if (prefijo === 'ent') calculateEntryTotals();
  else calculateExitTotals();
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

  // Update dynamic topbar breadcrumb title
  const tabTitles = {
    'tab-dashboard': 'Panel de Control de Inventario',
    'tab-inventario': 'Inventario al Día',
    'tab-entrada': 'Registrar Entrada',
    'tab-salida': 'Registrar Salida',
    'tab-kardex': 'Kardex por Repuesto',
    'tab-libro-compras': 'Libro de Compras Fiscal SENIAT',
    'tab-libro-ventas': 'Libro de Ventas Fiscal SENIAT',
    'tab-declaraciones': 'Declaración Mensual IVA (Forma 30)',
    'tab-retenciones-islr': 'Comprobantes de Retención ISLR (PA SNAT/2026/00093)',
    'tab-proveedores': 'Directorio y Panel de Proveedores',
    'tab-fiscal': 'Auditoría y Cruce Fiscal (IVA vs Almacén)',
    'tab-mensual': 'Cierre Físico Mes a Mes',
    'tab-movimientos': 'Auditoría de Movimientos',
    'tab-configuracion': 'Configuración del Sistema y Parámetros Contables'
  };
  const topbarTitleEl = document.getElementById('topbar-section-title');
  if (topbarTitleEl && tabTitles[tabId]) {
    topbarTitleEl.textContent = tabTitles[tabId];
  }

  // Lazy refresh based on tab
  if (tabId === 'tab-dashboard') loadDashboard();
  if (tabId === 'tab-inventario') loadProducts();
  if (tabId === 'tab-mensual') loadMonthlyReport();
  if (tabId === 'tab-movimientos') loadMovements();
  if (tabId === 'tab-fiscal') loadFiscalReconciliation();
  if (tabId === 'tab-libro-compras') loadLibroCompras();
  if (tabId === 'tab-libro-ventas') loadLibroVentas();
  if (tabId === 'tab-declaraciones') loadDeclaracionDetalle();
  if (tabId === 'tab-retenciones-islr') loadModuloRetencionesISLR();
  if (tabId === 'tab-proveedores') loadProveedoresDirectorio();
  if (tabId === 'tab-configuracion') loadConfiguracionTab();
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

let dashboardModoMoneda = 'BS';

function toggleDashboardMoneda(modo) {
  dashboardModoMoneda = modo;
  const btnBs = document.getElementById('btn-dash-mon-bs');
  const btnUsd = document.getElementById('btn-dash-mon-usd');
  if (btnBs && btnUsd) {
    if (modo === 'BS') {
      btnBs.style.background = '#0B2447';
      btnBs.style.color = '#ffffff';
      btnUsd.style.background = 'transparent';
      btnUsd.style.color = '#475569';
    } else {
      btnUsd.style.background = '#0B2447';
      btnUsd.style.color = '#ffffff';
      btnBs.style.background = 'transparent';
      btnBs.style.color = '#475569';
    }
  }
  const thTop = document.getElementById('th-top-facturado');
  if (thTop) thTop.textContent = modo === 'BS' ? 'FACTURADO (BS.)' : 'FACTURADO ($ USD)';

  if (state.dashboard) {
    renderDashboardMonthly(state.dashboard);
    renderDashboardTopProducts(state.dashboard);
  }
}

function filtrarStockAlerta() {
  switchTab('tab-inventario');
  const sel = document.getElementById('inv-filter-estado');
  if (sel) {
    sel.value = 'SOLICITAR MATERIAL';
    loadProducts();
  }
}

function renderDashboardMonthly(data) {
  const tbody = document.getElementById('tbody-dashboard-monthly');
  if (!tbody) return;

  const fmtBs = v => Number(v || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtUsd = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const isBs = dashboardModoMoneda === 'BS';

  const meses = data.flujoMensual || [];
  if (meses.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 16px;">No hay movimientos registrados.</td></tr>`;
    return;
  }

  tbody.innerHTML = meses.map(m => {
    const comprasMonto = isBs ? `Bs. ${fmtBs(m.compras_bs)}` : `$${fmtUsd(m.compras_usd)}`;
    const ventasMonto = isBs ? `Bs. ${fmtBs(m.ventas_bs)}` : `$${fmtUsd(m.ventas_usd)}`;
    const balanceUnd = Number(m.unidades_compradas || 0) - Number(m.unidades_vendidas || 0);
    const balanceColor = balanceUnd >= 0 ? '#059669' : '#dc2626';
    const balanceIcon = balanceUnd >= 0 ? '▲ +' : '▼ ';
    const labelMes = NOMBRES_MESES_CIERRE[m.periodo] || m.periodo;

    const totVolume = Number(m.unidades_compradas || 0) + Number(m.unidades_vendidas || 0);
    const pctVentas = totVolume > 0 ? Math.round((Number(m.unidades_vendidas || 0) / totVolume) * 100) : 0;
    const pctCompras = totVolume > 0 ? 100 - pctVentas : 0;

    return `
      <tr>
        <td style="padding: 9px 12px;">
          <div class="font-bold" style="color: #0B2447;">${m.periodo}</div>
          <div style="font-size: 0.72rem; color: #64748b;">${labelMes}</div>
        </td>
        <td class="text-right font-mono font-bold" style="padding: 9px 12px; color: #0284c7;">
          Bs. ${Number(m.tasa_bcv || 0).toFixed(4)}
        </td>
        <td class="text-right font-mono" style="padding: 9px 12px;">
          <div class="font-bold" style="color: #0369a1;">${comprasMonto}</div>
          <div style="font-size: 0.72rem; color: #64748b;">${m.unidades_compradas} und (${m.cant_compras} docs)</div>
        </td>
        <td class="text-right font-mono" style="padding: 9px 12px;">
          <div class="font-bold" style="color: #059669;">${ventasMonto}</div>
          <div style="font-size: 0.72rem; color: #64748b;">${m.unidades_vendidas} und (${m.cant_ventas} ZOA)</div>
        </td>
        <td class="text-right font-mono font-bold" style="padding: 9px 12px; color: ${balanceColor};">
          ${balanceIcon}${Math.abs(balanceUnd)} und
        </td>
        <td style="padding: 9px 12px;">
          <div style="display:flex; justify-content:space-between; font-size: 0.68rem; color:#64748b; margin-bottom: 2px;">
            <span>V: ${pctVentas}%</span>
            <span>C: ${pctCompras}%</span>
          </div>
          <div class="mini-flow-bar">
            <div class="mini-flow-ventas" style="width: ${pctVentas}%;" title="Ventas: ${pctVentas}%"></div>
            <div class="mini-flow-compras" style="width: ${pctCompras}%;" title="Compras: ${pctCompras}%"></div>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderDashboardTopProducts(data) {
  const tbody = document.getElementById('tbody-top-vendidos');
  if (!tbody) return;

  const fmtBs = v => Number(v || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtUsd = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const isBs = dashboardModoMoneda === 'BS';

  const prods = data.topProductosVendidos || [];
  if (prods.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 16px;">No hay datos de ventas registradas.</td></tr>`;
    return;
  }

  tbody.innerHTML = prods.map((p, idx) => {
    const rankClass = idx === 0 ? 'rank-1' : (idx === 1 ? 'rank-2' : (idx === 2 ? 'rank-3' : 'rank-default'));
    const facturado = isBs ? `Bs. ${fmtBs(p.total_ventas_bs)}` : `$${fmtUsd(p.total_ventas_usd)}`;
    const stockColor = p.stock_actual > 0 ? '#059669' : '#dc2626';

    return `
      <tr>
        <td class="text-center" style="padding: 8px 6px;">
          <span class="rank-badge ${rankClass}">${idx + 1}</span>
        </td>
        <td style="padding: 8px 10px;">
          <div class="font-bold" style="color: #0B2447; font-size: 0.82rem;">${p.codigo}</div>
          <div style="font-size: 0.72rem; color: #475569; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${p.descripcion}">${p.descripcion}</div>
        </td>
        <td class="text-right font-mono font-bold" style="padding: 8px 10px; color: #059669;">
          ${p.unidades_vendidas}
        </td>
        <td class="text-right font-mono font-bold" style="padding: 8px 10px; color: #0B2447;">
          ${facturado}
        </td>
        <td class="text-right font-mono font-bold" style="padding: 8px 10px; color: ${stockColor};">
          ${p.stock_actual}
        </td>
        <td class="text-center" style="padding: 8px 6px;">
          <button class="btn btn-sm btn-secondary" onclick="viewKardex('${p.codigo}')" style="padding: 2px 7px; font-size: 10px;" title="Ver Kardex">
            🔍
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderDashboardCritical(data) {
  const tbody = document.getElementById('tbody-criticos-reorden');
  if (!tbody) return;

  const prods = data.productosCriticos || [];
  if (prods.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding: 16px; color: #059669; font-weight: 700;">✅ Todo el inventario se encuentra por encima del stock mínimo.</td></tr>`;
    return;
  }

  tbody.innerHTML = prods.map(p => {
    return `
      <tr>
        <td style="padding: 8px 10px;">
          <div class="font-bold" style="color: #0B2447; font-size: 0.82rem;">${p.codigo}</div>
          <div style="font-size: 0.72rem; color: #475569; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${p.descripcion}">${p.descripcion}</div>
        </td>
        <td class="text-right font-mono font-bold" style="padding: 8px 10px; color: ${p.stock_actual <= 0 ? '#dc2626' : '#d97706'};">
          ${p.stock_actual}
        </td>
        <td class="text-right font-mono" style="padding: 8px 10px; color: #64748b;">
          ${p.stock_minimo}
        </td>
        <td class="text-right font-mono font-bold" style="padding: 8px 10px; color: #dc2626;">
          -${p.deficit}
        </td>
        <td class="text-center" style="padding: 8px 6px;">
          <button class="btn btn-sm btn-emerald" onclick="switchTab('tab-entrada')" style="padding: 3px 8px; font-size: 11px;" title="Registrar Entrada">
            + Reponer
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// 4. Dashboard KPIs & Distribution
async function loadDashboard() {
  try {
    const res = await fetch('/api/dashboard');
    const data = await res.json();
    state.dashboard = data;

    const fmtBs = v => Number(v || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtUsd = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // 5 KPI Cards
    const valUsdDash = Number(data.valorTotalUsd || 0);
    const valBsDash = Number(data.valorTotalBs || 0);
    const tasaAct = Number(data.tasaBcvActiva || 889.26);

    const elValBs = document.getElementById('kpi-dash-valor-bs');
    const elValUsd = document.getElementById('kpi-dash-valor-usd');
    if (elValBs) elValBs.textContent = `Bs. ${fmtBs(valBsDash)}`;
    if (elValUsd) elValUsd.textContent = `$${fmtUsd(valUsdDash)} USD • Tasa BCV: Bs. ${tasaAct.toFixed(2)}`;

    const elStock = document.getElementById('kpi-dash-stock-unidades');
    const elCatSub = document.getElementById('kpi-dash-cat-count');
    if (elStock) elStock.textContent = `${Math.round(data.stockTotalUnidades).toLocaleString()} und`;
    if (elCatSub) elCatSub.textContent = `${data.totalProductos} repuestos en catálogo`;

    const elRot = document.getElementById('kpi-dash-rotacion');
    const elDiasCob = document.getElementById('kpi-dash-dias-cobertura');
    if (elRot) elRot.textContent = `${data.rotacionInventario}x anual`;
    if (elDiasCob) elDiasCob.textContent = `Cobertura media: ${data.diasInventario} días de stock`;

    const elDisp = document.getElementById('kpi-dash-disponibilidad');
    const elOptSub = document.getElementById('kpi-dash-stock-optimo');
    if (elDisp) elDisp.textContent = `${data.nivelServicio}%`;
    if (elOptSub) elOptSub.textContent = `${data.stockOptimo} productos con stock óptimo`;

    const elAlertas = document.getElementById('kpi-dash-alertas');
    const elAlertDet = document.getElementById('kpi-dash-alertas-detalle');
    if (elAlertas) elAlertas.textContent = `${data.productosEnAlerta} alertas`;
    if (elAlertDet) elAlertDet.textContent = `${data.productosAgotados} agotados (${data.productosEnAlerta - data.productosAgotados} bajo mín.)`;

    // Resumen Anual Compras vs Ventas
    const tot = data.totalesAnio || {};
    const elTotCompM = document.getElementById('dash-tot-compras-monto');
    const elTotCompU = document.getElementById('dash-tot-compras-und');
    if (elTotCompM) elTotCompM.textContent = `Bs. ${fmtBs(tot.totComprasBs)} ($${fmtUsd(tot.totComprasUsd)})`;
    if (elTotCompU) elTotCompU.textContent = `${(tot.totUnidadesCompradas || 0).toLocaleString()} unidades adquiridas`;

    const elTotVentM = document.getElementById('dash-tot-ventas-monto');
    const elTotVentU = document.getElementById('dash-tot-ventas-und');
    if (elTotVentM) elTotVentM.textContent = `Bs. ${fmtBs(tot.totVentasBs)} ($${fmtUsd(tot.totVentasUsd)})`;
    if (elTotVentU) elTotVentU.textContent = `${(tot.totUnidadesVendidas || 0).toLocaleString()} unidades despachadas`;

    const elTotBalM = document.getElementById('dash-tot-balance-monto');
    const elTotBalU = document.getElementById('dash-tot-balance-und');
    const balNeto = (tot.totUnidadesCompradas || 0) - (tot.totUnidadesVendidas || 0);
    if (elTotBalM) elTotBalM.textContent = `${balNeto >= 0 ? '+' : ''}${balNeto.toLocaleString()} unidades`;
    if (elTotBalU) elTotBalU.textContent = `Saldo físico neto en almacén`;

    // Render Subsections
    renderDashboardMonthly(data);
    renderDashboardTopProducts(data);
    renderDashboardCritical(data);

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
    const data = await res.json();
    if (!res.ok || !Array.isArray(data)) {
      throw new Error(data?.error || 'Error al obtener productos del servidor');
    }
    const products = data;
    state.products = products;

    // Update Counter & Title Badge
    const countBadge = document.getElementById('inv-count-badge');
    const bcvBadge = document.getElementById('inv-bcv-summary-badge');

    const tasaAplicada = Number(products[0]?.tasa_bcv_aplicada || (fechaCorte === '2025-12-31' ? 52.02 : 92.00));
    const fechaTasaAplicada = products[0]?.fecha_tasa_bcv || (fechaCorte || '31/10/2026');

    let sumValorUsd = 0;
    let sumValorBs = 0;
    products.forEach(p => {
      if (Number(p.stock_actual || 0) > 0) {
        const vUsd = Number(p.valor_total_usd || 0);
        const vBs = Number(p.valor_total_bs || (vUsd * tasaAplicada));
        sumValorUsd += vUsd;
        sumValorBs += vBs;
      }
    });

    const rateFormatted = tasaAplicada.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    const valorBsFormatted = sumValorBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const valorUsdFormatted = sumValorUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    if (countBadge) {
      if (fechaCorte === '2025-12-31') {
        countBadge.innerHTML = `🏁 Inventario Inicial (31/12/2025): <strong>${products.length} Productos</strong>`;
      } else if (fechaCorte) {
        countBadge.innerHTML = `📅 Inventario al Corte (${fechaCorte}): <strong>${products.length} Productos</strong>`;
      } else {
        countBadge.innerHTML = `📌 Catálogo al Día: <strong>${products.length} Productos</strong>`;
      }
    }

    // Actualizar elementos dedicados del Banner Ejecutivo Bimonetario
    const rateEl = document.getElementById('inv-bcv-rate-text');
    const dateEl = document.getElementById('inv-bcv-date-text');
    const totBsEl = document.getElementById('inv-bcv-total-bs');
    const totUsdEl = document.getElementById('inv-bcv-total-usd');

    if (rateEl) rateEl.innerHTML = `Bs. ${rateFormatted} <span class="inv-bcv-unit">/ USD</span>`;
    if (dateEl) dateEl.innerHTML = `Vigencia Oficial: <strong>${fechaTasaAplicada || 'Al día'}</strong>`;
    if (totBsEl) totBsEl.textContent = `Bs. ${valorBsFormatted}`;
    if (totUsdEl) totUsdEl.textContent = `$${valorUsdFormatted} USD`;

    if (bcvBadge) {
      bcvBadge.innerHTML = `💱 <strong>Tasa Oficial BCV: Bs. ${rateFormatted} por USD</strong> (${fechaTasaAplicada}) &nbsp;|&nbsp; Valor Total: <strong style="color:#059669;">Bs. ${valorBsFormatted}</strong> <span style="color:#0369a1;">($${valorUsdFormatted} USD)</span>`;
    }

    const tbody = document.getElementById('tbody-inventario');
    if (!tbody) return;

    if (products.length === 0) {
      tbody.innerHTML = `<tr><td colspan="13" class="text-center">No se encontraron productos coincidentes</td></tr>`;
      return;
    }

    tbody.innerHTML = products.map(p => {
      const isLow = p.estado_stock === 'SOLICITAR MATERIAL';
      const statusBadge = isLow
        ? `<span class="badge-status badge-solicitar">⚠️ Solicitar</span>`
        : `<span class="badge-status badge-suficiente">✅ Suficiente</span>`;
      
      const stockColor = isLow ? 'color: #fb7185; font-weight: 800;' : 'font-weight: 700;';
      const costoUsd = Number(p.costo_referencial_usd || 0);
      const valUsd = Number(p.valor_total_usd || 0);
      const tasaProd = Number(p.tasa_bcv_aplicada || tasaAplicada);
      const costoBs = Number(p.costo_unitario_bs !== undefined ? p.costo_unitario_bs : (costoUsd * tasaProd));
      const valBs = Number(p.valor_total_bs !== undefined ? p.valor_total_bs : (valUsd * tasaProd));

      return `
        <tr>
          <td><span class="badge-code">${p.codigo}</span></td>
          <td class="font-bold">${p.descripcion}</td>
          <td>${p.unidad_medida}</td>
          <td><span class="meta-tag">${p.categoria}</span></td>
          <td><span class="meta-tag">${p.almacen}</span></td>
          <td class="text-right font-mono">${p.stock_minimo}</td>
          <td class="text-right font-mono" style="${stockColor}">${p.stock_actual}</td>
          <td class="text-right font-mono" style="color:#0369a1;">$${costoUsd.toFixed(2)}</td>
          <td class="text-right font-mono font-bold" style="color:#0B2447;">Bs. ${costoBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
          <td class="text-right font-mono" style="color:#0369a1;">$${valUsd.toFixed(2)}</td>
          <td class="text-right font-mono font-bold" style="color:#059669;">Bs. ${valBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
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
    const tbody = document.getElementById('tbody-inventario');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="11" class="text-center" style="color: #dc2626; padding: 16px;">Error al cargar inventario: ${err.message}</td></tr>`;
    }
  }
}

// 6. Dynamic Form Rows: ENTRADA (COMPRAS) — Doble Expresión Monetaria Bs./USD
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
      <input type="number" class="ent-qty-input text-right font-mono" min="0.1" step="any" value="1" oninput="calculateEntryTotals()" required>
    </td>
    <td>
      <input type="number" class="ent-cost-input text-right font-mono" min="0" step="0.01" value="0.00" oninput="onEntryCostInput('${rowId}', 'DIVISA')" required>
    </td>
    <td>
      <input type="number" class="ent-cost-bs-input text-right font-mono" min="0" step="0.01" value="0.00" oninput="onEntryCostInput('${rowId}', 'BS')" required>
    </td>
    <td class="text-right font-mono ent-base-cell" style="font-size:0.78rem;">Bs. 0,00<br><span style="color:#64748b;">$0.00</span></td>
    <td class="text-right font-mono ent-iva-cell" style="font-size:0.76rem; color:#0369a1;">Bs. 0,00<br><span style="color:#64748b;">$0.00</span></td>
    <td class="text-right font-mono font-bold ent-subtotal" style="font-size:0.8rem; color:#0B2447;">Bs. 0,00<br><span style="color:#059669;">$0.00</span></td>
    <td class="text-center">
      <button type="button" class="btn-remove-row" onclick="removeRow('${rowId}', calculateEntryTotals)">&times;</button>
    </td>
  `;

  tbody.appendChild(tr);
  calculateEntryTotals();
}

function onEntryProductChange(rowId) {
  const tr = document.getElementById(rowId);
  if (!tr) return;
  const select = tr.querySelector('.ent-prod-select');
  const selectedOpt = select.options[select.selectedIndex];
  const costInput = tr.querySelector('.ent-cost-input');
  const costBsInput = tr.querySelector('.ent-cost-bs-input');
  const tasa = parseFloat(document.getElementById('ent-tasa')?.value || '') || getTasaBcvPorFechaOPeriodo();
  
  if (selectedOpt && selectedOpt.dataset.cost) {
    const cUsd = parseFloat(selectedOpt.dataset.cost) || 0;
    costInput.value = cUsd.toFixed(2);
    if (costBsInput) costBsInput.value = (cUsd * tasa).toFixed(2);
  }
  calculateEntryTotals();
}

function onEntryCostInput(rowId, editedCurrency) {
  const tr = document.getElementById(rowId);
  if (!tr) return;
  const tasa = parseFloat(document.getElementById('ent-tasa')?.value || '') || getTasaBcvPorFechaOPeriodo();
  const costUsdInput = tr.querySelector('.ent-cost-input');
  const costBsInput = tr.querySelector('.ent-cost-bs-input');

  if (editedCurrency === 'DIVISA') {
    const valUsd = parseFloat(costUsdInput?.value || 0);
    if (costBsInput) costBsInput.value = (valUsd * tasa).toFixed(2);
  } else {
    const valBs = parseFloat(costBsInput?.value || 0);
    if (costUsdInput) costUsdInput.value = (tasa > 0 ? valBs / tasa : 0).toFixed(2);
  }
  calculateEntryTotals(true);
}

function calculateEntryTotals(skipInputSync = false) {
  const tasaFactura = parseFloat(document.getElementById('ent-tasa')?.value || '') || getTasaBcvPorFechaOPeriodo();
  const fechaFactura = document.getElementById('ent-fecha-factura')?.value || '';
  const fechaAlmacen = document.getElementById('ent-fecha')?.value || '';
  const tasaAlmacen = getTasaBcvPorFechaOPeriodo(fechaAlmacen);
  const modoMoneda = document.getElementById('ent-modo-moneda')?.value || 'BS';
  const fmtBsLocal = v => Number(v || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const legendText = `🏛️ Factura Fiscal: Bs. ${fmtBsLocal(tasaFactura)} (${fechaFactura || 'Hoy'}) | 📦 Entrada Almacén: Bs. ${fmtBsLocal(tasaAlmacen)} (${fechaAlmacen || 'Hoy'})`;
  const banner = document.getElementById('ent-bcv-legend-banner');
  if (banner) banner.textContent = legendText;
  const footLegend = document.getElementById('ent-footer-legend');
  if (footLegend) footLegend.textContent = `🏛️ Tasa BCV Factura Fiscal: Bs. ${fmtBsLocal(tasaFactura)} por USD:`;

  let totBaseUsd = 0, totBaseBs = 0, totIvaUsd = 0, totIvaBs = 0, totTotalUsd = 0, totTotalBs = 0;
  const rows = document.querySelectorAll('#tbody-items-entrada tr');

  rows.forEach(r => {
    const qty = parseFloat(r.querySelector('.ent-qty-input')?.value || 0);
    const costUsdInput = r.querySelector('.ent-cost-input');
    const costBsInput = r.querySelector('.ent-cost-bs-input');

    let unitUsd = parseFloat(costUsdInput?.value || 0);
    let unitBs = parseFloat(costBsInput?.value || 0);

    if (!skipInputSync) {
      if (modoMoneda === 'BS' && unitBs > 0) {
        unitUsd = Number((tasaFactura > 0 ? unitBs / tasaFactura : 0).toFixed(2));
        if (costUsdInput) costUsdInput.value = unitUsd.toFixed(2);
      } else if (unitUsd > 0) {
        unitBs = Number((unitUsd * tasaFactura).toFixed(2));
        if (costBsInput) costBsInput.value = unitBs.toFixed(2);
      }
    }

    const baseUsd = Number((qty * unitUsd).toFixed(2));
    const baseBs = Number((qty * unitBs).toFixed(2));
    const ivaUsd = Number((baseUsd * 0.16).toFixed(2));
    const ivaBs = Number((baseBs * 0.16).toFixed(2));
    const totalUsd = Number((baseUsd + ivaUsd).toFixed(2));
    const totalBs = Number((baseBs + ivaBs).toFixed(2));

    const baseCell = r.querySelector('.ent-base-cell');
    const ivaCell = r.querySelector('.ent-iva-cell');
    const subElem = r.querySelector('.ent-subtotal');

    if (baseCell) baseCell.innerHTML = `Bs. ${fmtBsLocal(baseBs)}<br><span style="color:#64748b;">$${baseUsd.toFixed(2)}</span>`;
    if (ivaCell) ivaCell.innerHTML = `Bs. ${fmtBsLocal(ivaBs)}<br><span style="color:#64748b;">$${ivaUsd.toFixed(2)}</span>`;
    if (subElem) subElem.innerHTML = `Bs. ${fmtBsLocal(totalBs)}<br><span style="color:#059669;">$${totalUsd.toFixed(2)}</span>`;

    totBaseUsd += baseUsd;
    totBaseBs += baseBs;
    totIvaUsd += ivaUsd;
    totIvaBs += ivaBs;
    totTotalUsd += totalUsd;
    totTotalBs += totalBs;
  });

  const elBase = document.getElementById('total-entrada-base');
  const elIva = document.getElementById('total-entrada-iva');
  const elTot = document.getElementById('total-entrada-usd');
  if (elBase) elBase.textContent = `Bs. ${fmtBsLocal(totBaseBs)} ($${totBaseUsd.toFixed(2)})`;
  if (elIva) elIva.textContent = `Bs. ${fmtBsLocal(totIvaBs)} ($${totIvaUsd.toFixed(2)})`;
  if (elTot) elTot.textContent = `Bs. ${fmtBsLocal(totTotalBs)} ($${totTotalUsd.toFixed(2)})`;
}

// 7. Dynamic Form Rows: SALIDA (VENTAS) — Validación en Tiempo Real Kardex + Doble Expresión
function addExitRow() {
  const tbody = document.getElementById('tbody-items-salida');
  if (!tbody) return;

  const rowId = `sal-row-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
  const tr = document.createElement('tr');
  tr.id = rowId;

  const productOptions = state.products.map(p => 
    `<option value="${p.producto_id}" data-stock="${p.stock_actual}" data-cost="${p.costo_referencial_usd}" data-desc="${p.descripcion}">${p.codigo} - ${p.descripcion} (Stock: ${p.stock_actual})</option>`
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
      <input type="number" class="sal-qty-input text-right font-mono" min="0.1" step="any" value="1" oninput="validateExitRow('${rowId}')" required>
    </td>
    <td>
      <input type="number" class="sal-price-usd-input text-right font-mono" min="0" step="0.01" value="0.00" oninput="onExitPriceInput('${rowId}', 'DIVISA')" required>
    </td>
    <td>
      <input type="number" class="sal-price-bs-input text-right font-mono" min="0" step="0.01" value="0.00" oninput="onExitPriceInput('${rowId}', 'BS')" required>
    </td>
    <td class="text-right font-mono sal-base-cell" style="font-size:0.78rem;">Bs. 0,00<br><span style="color:#64748b;">$0.00</span></td>
    <td class="text-right font-mono font-bold sal-total-cell" style="font-size:0.8rem; color:#0B2447;">Bs. 0,00<br><span style="color:#be123c;">$0.00</span></td>
    <td class="text-center">
      <button type="button" class="btn-remove-row" onclick="removeRow('${rowId}', calculateExitTotals)">&times;</button>
    </td>
  `;

  tbody.appendChild(tr);
  calculateExitTotals();
}

function onExitProductChange(rowId) {
  const tr = document.getElementById(rowId);
  if (!tr) return;
  const select = tr.querySelector('.sal-prod-select');
  const selectedOpt = select.options[select.selectedIndex];
  const stockElem = tr.querySelector('.sal-stock-disp');
  const priceUsdInput = tr.querySelector('.sal-price-usd-input');
  const priceBsInput = tr.querySelector('.sal-price-bs-input');
  const tasa = parseFloat(document.getElementById('sal-tasa')?.value || '') || getTasaBcvPorFechaOPeriodo();

  if (selectedOpt && selectedOpt.dataset.stock !== undefined) {
    const stock = parseFloat(selectedOpt.dataset.stock);
    stockElem.textContent = `${stock} und`;
    stockElem.style.color = stock <= 0 ? '#dc2626' : '#059669';
    const refCost = parseFloat(selectedOpt.dataset.cost || 0);
    if (priceUsdInput) priceUsdInput.value = refCost.toFixed(2);
    if (priceBsInput) priceBsInput.value = (refCost * tasa).toFixed(2);
  } else {
    stockElem.textContent = '--';
  }
  validateExitRow(rowId);
}

function onExitPriceInput(rowId, editedCurrency) {
  const tr = document.getElementById(rowId);
  if (!tr) return;
  const tasa = parseFloat(document.getElementById('sal-tasa')?.value || '') || getTasaBcvPorFechaOPeriodo();
  const priceUsdInput = tr.querySelector('.sal-price-usd-input');
  const priceBsInput = tr.querySelector('.sal-price-bs-input');

  if (editedCurrency === 'DIVISA') {
    const valUsd = parseFloat(priceUsdInput?.value || 0);
    if (priceBsInput) priceBsInput.value = (valUsd * tasa).toFixed(2);
  } else {
    const valBs = parseFloat(priceBsInput?.value || 0);
    if (priceUsdInput) priceUsdInput.value = (tasa > 0 ? valBs / tasa : 0).toFixed(2);
  }
  calculateExitTotals(true);
}

function validateExitRow(rowId) {
  const tr = document.getElementById(rowId);
  if (!tr) return;
  const select = tr.querySelector('.sal-prod-select');
  const selectedOpt = select.options[select.selectedIndex];
  const qtyInput = tr.querySelector('.sal-qty-input');
  const stockElem = tr.querySelector('.sal-stock-disp');
  
  if (selectedOpt && selectedOpt.dataset.stock !== undefined) {
    const stock = parseFloat(selectedOpt.dataset.stock);
    const qty = parseFloat(qtyInput.value || 0);
    if (qty > stock || stock <= 0) {
      qtyInput.style.borderColor = '#dc2626';
      qtyInput.style.background = '#fef2f2';
      qtyInput.title = `BLOQUEO DE KARDEX: Stock físico (${stock} und) insuficiente para despachar ${qty} und.`;
      if (stockElem) stockElem.innerHTML = `<span style="color:#dc2626; font-weight:900;">⛔ ${stock} und (INSUFICIENTE)</span>`;
    } else {
      qtyInput.style.borderColor = '';
      qtyInput.style.background = '';
      qtyInput.title = '';
      if (stockElem) stockElem.innerHTML = `<span style="color:#059669; font-weight:800;">✅ ${stock} und</span>`;
    }
  }
  calculateExitTotals(true);
}

function calculateExitTotals(skipInputSync = false) {
  const tasa = parseFloat(document.getElementById('sal-tasa')?.value || '') || getTasaBcvPorFechaOPeriodo();
  const fechaTasa = document.getElementById('sal-fecha-tasa')?.value || document.getElementById('sal-fecha')?.value || '';
  const modoMoneda = document.getElementById('sal-modo-moneda')?.value || 'BS';
  const fmtBsLocal = v => Number(v || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const legendText = `🏛️ Tasa Oficial BCV Aplicable: Bs. ${fmtBsLocal(tasa)} por USD (Fecha: ${fechaTasa || 'Hoy'})`;
  const banner = document.getElementById('sal-bcv-legend-banner');
  if (banner) banner.textContent = legendText;
  const footLegend = document.getElementById('sal-footer-legend');
  if (footLegend) footLegend.textContent = `${legendText}:`;

  let totBaseUsd = 0, totBaseBs = 0, totTotalUsd = 0, totTotalBs = 0;
  const rows = document.querySelectorAll('#tbody-items-salida tr');

  rows.forEach(r => {
    const qty = parseFloat(r.querySelector('.sal-qty-input')?.value || 0);
    const priceUsdInput = r.querySelector('.sal-price-usd-input');
    const priceBsInput = r.querySelector('.sal-price-bs-input');

    let unitUsd = parseFloat(priceUsdInput?.value || 0);
    let unitBs = parseFloat(priceBsInput?.value || 0);

    if (!skipInputSync) {
      if (modoMoneda === 'BS' && unitBs > 0) {
        unitUsd = Number((tasa > 0 ? unitBs / tasa : 0).toFixed(2));
        if (priceUsdInput) priceUsdInput.value = unitUsd.toFixed(2);
      } else if (unitUsd > 0) {
        unitBs = Number((unitUsd * tasa).toFixed(2));
        if (priceBsInput) priceBsInput.value = unitBs.toFixed(2);
      }
    }

    const baseUsd = Number((qty * unitUsd).toFixed(2));
    const baseBs = Number((qty * unitBs).toFixed(2));
    const totalUsd = Number((baseUsd * 1.16).toFixed(2));
    const totalBs = Number((baseBs * 1.16).toFixed(2));

    const baseCell = r.querySelector('.sal-base-cell');
    const totCell = r.querySelector('.sal-total-cell');
    if (baseCell) baseCell.innerHTML = `Bs. ${fmtBsLocal(baseBs)}<br><span style="color:#64748b;">$${baseUsd.toFixed(2)}</span>`;
    if (totCell) totCell.innerHTML = `Bs. ${fmtBsLocal(totalBs)}<br><span style="color:#be123c;">$${totalUsd.toFixed(2)}</span>`;

    totBaseUsd += baseUsd;
    totBaseBs += baseBs;
    totTotalUsd += totalUsd;
    totTotalBs += totalBs;
  });

  const elBase = document.getElementById('total-salida-base');
  const elTot = document.getElementById('total-salida-total');
  if (elBase) elBase.textContent = `Bs. ${fmtBsLocal(totBaseBs)} ($${totBaseUsd.toFixed(2)})`;
  if (elTot) elTot.textContent = `Bs. ${fmtBsLocal(totTotalBs)} ($${totTotalUsd.toFixed(2)})`;
}

function removeRow(rowId, callback) {
  const row = document.getElementById(rowId);
  if (row) row.remove();
  if (callback) callback();
}

// 8. Movement Submission Handler (with Real-Time Kardex Stock Lock & Dual-Currency PA SNAT/2026/00093)
async function handleMovementSubmit(event, tipo) {
  event.preventDefault();
  const isEntrada = tipo === 'ENTRADA_COMPRA';

  const fecha = document.getElementById(isEntrada ? 'ent-fecha' : 'sal-fecha').value;
  const fechaFactura = isEntrada ? (document.getElementById('ent-fecha-factura')?.value || fecha) : fecha;
  const doc = document.getElementById(isEntrada ? 'ent-factura' : 'sal-factura').value.trim();
  const nroControl = document.getElementById(isEntrada ? 'ent-control' : 'sal-control')?.value.trim() || '';
  const usuarioResp = document.getElementById(isEntrada ? 'ent-usuario' : 'sal-usuario')?.value.trim() || 'ASISTENTE_TIENDA';
  const subtipo = document.getElementById(isEntrada ? 'ent-subtipo' : 'sal-subtipo')?.value || (isEntrada ? 'COMPRA_NACIONAL' : 'VENTA');
  const tasaFactura = parseFloat(document.getElementById(isEntrada ? 'ent-tasa' : 'sal-tasa')?.value || '') || getTasaBcvPorFechaOPeriodo(fechaFactura);
  const tasaAlmacen = getTasaBcvPorFechaOPeriodo(fecha);
  const tasaBcv = isEntrada ? tasaFactura : (parseFloat(document.getElementById('sal-tasa')?.value || '') || getTasaBcvPorFechaOPeriodo(fecha));
  const fechaTasaBcv = document.getElementById(isEntrada ? 'ent-fecha-tasa' : 'sal-fecha-tasa')?.value || fechaFactura;
  const metodoVal = isEntrada ? (state.metodoValoracionKardex || 'CPP') : (document.getElementById('sal-metodo-val')?.value || 'CPP');
  const obs = document.getElementById(isEntrada ? 'ent-obs' : 'sal-obs').value.trim();
  const provId = isEntrada ? document.getElementById('ent-proveedor').value : null;

  if (!doc || !nroControl || !usuarioResp) {
    showToast('Todo movimiento debe tener Documento Fuente, N° Control Fiscal y Usuario Responsable (Art. 177 RISLR).', 'error');
    return;
  }

  // Gather items & validate stock in real time for Salidas
  const items = [];
  const rows = document.querySelectorAll(isEntrada ? '#tbody-items-entrada tr' : '#tbody-items-salida tr');
  const stockAcumulado = {};

  for (const r of rows) {
    const selEl = r.querySelector(isEntrada ? '.ent-prod-select' : '.sal-prod-select');
    const prodId = selEl?.value;
    const qty = parseFloat(r.querySelector(isEntrada ? '.ent-qty-input' : '.sal-qty-input')?.value || 0);

    if (!prodId || qty <= 0) continue;

    if (!isEntrada) {
      const opt = selEl.options[selEl.selectedIndex];
      const stockDisp = parseFloat(opt?.dataset?.stock || 0);
      const descProd = opt?.dataset?.desc || prodId;
      stockAcumulado[prodId] = (stockAcumulado[prodId] || 0) + qty;
      if (stockAcumulado[prodId] > stockDisp || stockDisp <= 0) {
        showToast(`⛔ BLOQUEO DE KARDEX (PA SNAT/2026/00093): Prohibido emitir salida/factura de "${descProd}". Existencia física disponible (${stockDisp} und) es menor a la cantidad solicitada (${stockAcumulado[prodId]} und).`, 'error');
        return;
      }
    }

    const unitUsd = parseFloat(r.querySelector(isEntrada ? '.ent-cost-input' : '.sal-price-usd-input')?.value || 0);
    const unitBs = parseFloat(r.querySelector(isEntrada ? '.ent-cost-bs-input' : '.sal-price-bs-input')?.value || Number((unitUsd * tasaBcv).toFixed(2)));
    const baseUsd = Number((qty * unitUsd).toFixed(2));
    const baseBs = Number((qty * unitBs).toFixed(2));
    const ivaUsd = Number((baseUsd * 0.16).toFixed(2));
    const ivaBs = Number((baseBs * 0.16).toFixed(2));

    items.push({
      producto_id: parseInt(prodId, 10),
      cantidad: qty,
      costo_unitario_usd: unitUsd,
      costo_unitario_ves: unitBs,
      costo_unitario_divisa: unitUsd,
      tasa_bcv_operacion: tasaBcv,
      costo_unitario_bs: unitBs,
      precio_unitario_divisa: unitUsd,
      precio_unitario_bs: unitBs,
      base_imponible_divisa: baseUsd,
      base_imponible_bs: baseBs,
      monto_iva_divisa: ivaUsd,
      monto_iva_bs: ivaBs,
      total_linea_divisa: Number((baseUsd + ivaUsd).toFixed(2)),
      total_linea_bs: Number((baseBs + ivaBs).toFixed(2))
    });
  }

  if (items.length === 0) {
    showToast('Debe agregar al menos un ítem válido.', 'error');
    return;
  }

  const tipoFinal = (subtipo.includes('AJUSTE')) ? 'AJUSTE' : tipo;

  const payload = {
    tipo: tipoFinal,
    subtipo,
    fecha,
    fecha_factura: fechaFactura,
    tasa_bcv: isEntrada ? tasaAlmacen : tasaBcv,
    tasa_bcv_factura: tasaFactura,
    fecha_tasa_bcv: fechaTasaBcv,
    numero_documento: doc,
    nro_control: nroControl,
    usuario_responsable: usuarioResp,
    moneda_operacion: (document.getElementById(isEntrada ? 'ent-modo-moneda' : 'sal-modo-moneda')?.value === 'BS' ? 'BS' : 'USD'),
    metodo_valoracion: metodoVal,
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

    showToast(data.message || 'Movimiento registrado con trazabilidad SENIAT!', 'success');

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
    submitBtn.textContent = isEntrada ? 'Guardar Entrada con Trazabilidad SENIAT' : 'Guardar Salida con Trazabilidad SENIAT';
  }
}

function resetForm(formId) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.reset();
  const today = new Date().toISOString().split('T')[0];
  const dateInput = form.querySelector('input[type="date"]');
  if (dateInput) dateInput.value = today;

  const currentRateStr = (getTasaBcvPorFechaOPeriodo() || 889.58).toFixed(4);

  if (formId === 'form-entrada') {
    document.getElementById('tbody-items-entrada').innerHTML = '';
    if (document.getElementById('ent-control')) document.getElementById('ent-control').value = '00-';
    if (document.getElementById('ent-fecha-factura')) document.getElementById('ent-fecha-factura').value = today;
    if (document.getElementById('ent-fecha')) document.getElementById('ent-fecha').value = today;
    if (document.getElementById('ent-fecha-tasa')) document.getElementById('ent-fecha-tasa').value = today;
    if (document.getElementById('ent-tasa')) document.getElementById('ent-tasa').value = currentRateStr;
    if (document.getElementById('ent-modo-moneda')) document.getElementById('ent-modo-moneda').value = 'BS';
    if (document.getElementById('ent-usuario')) document.getElementById('ent-usuario').value = 'ASISTENTE_ALMACEN_TIENDA';
    calculateEntryTotals();
  } else if (formId === 'form-salida') {
    document.getElementById('tbody-items-salida').innerHTML = '';
    if (document.getElementById('sal-control')) document.getElementById('sal-control').value = 'ZOA0000176';
    if (document.getElementById('sal-fecha')) document.getElementById('sal-fecha').value = today;
    if (document.getElementById('sal-fecha-tasa')) document.getElementById('sal-fecha-tasa').value = today;
    if (document.getElementById('sal-tasa')) document.getElementById('sal-tasa').value = currentRateStr;
    if (document.getElementById('sal-modo-moneda')) document.getElementById('sal-modo-moneda').value = 'BS';
    if (document.getElementById('sal-usuario')) document.getElementById('sal-usuario').value = 'CAJA_DESPACHO_TIENDA';
    calculateExitTotals();
  }
}

// 9. Kardex Ledger Viewer (Costo Promedio Ponderado / PEPS Art. 177 RISLR)
async function viewKardex(codigo) {
  switchTab('tab-kardex');
  document.getElementById('kardex-search-input').value = codigo;
  executeKardexSearch(codigo);
}

let currentKardexData = null;

function formatSubtipoBadge(tipo, subtipo) {
  const sub = String(subtipo || tipo || '').toUpperCase();
  if (sub === 'INVENTARIO_INICIAL') return `<span class="badge-status badge-suficiente">🏁 Inv. Inicial</span>`;
  if (sub.includes('COMPRA') || sub.includes('RECEPCION') || sub.includes('DEVOLUCION')) return `<span class="badge-status badge-suficiente">📥 ${sub.replace(/_/g, ' ')}</span>`;
  if (sub.includes('POSITIVO')) return `<span class="badge-status badge-suficiente">⚖️ Ajuste Sobrante</span>`;
  if (sub === 'VENTA') return `<span class="badge-status badge-solicitar">📤 Venta Fiscal</span>`;
  if (sub.includes('AUTOCONSUMO')) return `<span class="badge-status" style="background:#fef3c7;color:#92400e;">🔧 Autoconsumo</span>`;
  if (sub.includes('RETIRO')) return `<span class="badge-status" style="background:#f3e8ff;color:#6b21a8;">👤 Retiro Socios</span>`;
  if (sub.includes('MUESTRA')) return `<span class="badge-status" style="background:#e0f2fe;color:#0369a1;">🎁 Muestra</span>`;
  if (sub.includes('MERMA') || sub.includes('DANO')) return `<span class="badge-status badge-solicitar">⚠️ Merma / Daño</span>`;
  return `<span class="badge-status badge-solicitar">⚖️ ${sub.replace(/_/g, ' ')}</span>`;
}

async function executeKardexSearch(codeOverride) {
  const code = codeOverride || document.getElementById('kardex-search-input').value.trim();
  if (!code) return;

  const metodo = document.getElementById('kardex-metodo-select')?.value || state.metodoKardex || 'CPP';

  try {
    const res = await fetch(`/api/kardex/${encodeURIComponent(code)}?metodo=${encodeURIComponent(metodo)}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Producto no encontrado');
    currentKardexData = data;

    // Header Card
    document.getElementById('kardex-product-info').style.display = 'flex';
    document.getElementById('kardex-table-container').style.display = 'block';

    const cppVes = Number(data.producto.cpp_actual_ves || (data.producto.costo_referencial_usd * 68.50));
    const cppUsd = Number(data.producto.cpp_actual_usd || data.producto.costo_referencial_usd || 0);

    document.getElementById('kardex-code').textContent = data.producto.codigo;
    document.getElementById('kardex-desc').textContent = data.producto.descripcion;
    document.getElementById('kardex-cat').textContent = `Categoría: ${data.producto.categoria}`;
    document.getElementById('kardex-alm').textContent = `Almacén: ${data.producto.almacen}`;
    document.getElementById('kardex-und').textContent = `Unidad: ${data.producto.unidad_medida}`;
    const metodoBadge = document.getElementById('kardex-metodo-badge');
    if (metodoBadge) {
      metodoBadge.textContent = data.producto.metodo_valoracion === 'PEPS' ? 'Método: PEPS / FIFO' : 'Método: Costo Promedio Ponderado (CPP)';
    }
    document.getElementById('kardex-stock').textContent = `${data.producto.stock_actual} ${data.producto.unidad_medida}`;
    document.getElementById('kardex-cost').textContent = `Bs. ${cppVes.toLocaleString('es-VE', { minimumFractionDigits: 2 })} ($${cppUsd.toFixed(2)})`;
    
    const isLow = data.producto.estado_stock === 'SOLICITAR MATERIAL';
    const statusElem = document.getElementById('kardex-status');
    statusElem.textContent = isLow ? '⚠️ Solicitar Material' : '✅ Hay Suficiente';
    statusElem.style.color = isLow ? '#fb7185' : '#34d399';

    // Ledger Table (12 Columns including Costo Divisa, Tasa BCV Operacion, Costo Unit Bs, Valor Saldo Bs/$)
    const tbody = document.getElementById('tbody-kardex');
    if (data.historial.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" class="text-center">Sin movimientos registrados</td></tr>`;
      return;
    }

    tbody.innerHTML = data.historial.map(h => {
      const typeBadge = formatSubtipoBadge(h.tipo, h.subtipo);
      const costoDiv = Number(h.costo_unitario_divisa || h.costo_unitario_usd || 0);
      const tasaOp = Number(h.tasa_bcv_operacion || h.tasa_bcv || 68.50);
      const costoUnitBs = Number(h.costo_unitario_bs || h.cpp_resultante_ves || 0);
      const valSaldoVes = Number(h.valor_saldo_ves || 0);
      const valSaldoUsd = Number(h.valor_saldo_usd || 0);

      return `
        <tr>
          <td class="font-mono">${h.fecha}</td>
          <td>${typeBadge}</td>
          <td class="font-mono font-bold" style="color:var(--ucg-navy);">${h.numero_documento}</td>
          <td class="font-mono" style="font-size:0.76rem;">${h.nro_control || '-'}</td>
          <td>
            <div style="font-weight:600;">${h.tercero}</div>
            <div style="font-size:0.7rem; color:#64748b;">👤 ${h.usuario_responsable || 'ADMIN'}</div>
          </td>
          <td class="text-right font-mono font-bold" style="color: ${h.entrada > 0 ? '#059669' : ''}">${h.entrada > 0 ? '+' + h.entrada : '-'}</td>
          <td class="text-right font-mono font-bold" style="color: ${h.salida > 0 ? '#e11d48' : ''}">${h.salida > 0 ? '-' + h.salida : '-'}</td>
          <td class="text-right font-mono font-bold" style="color: var(--ucg-navy);">${h.saldo}</td>
          <td class="text-right font-mono" style="color:#0369a1; font-weight:700;">$${costoDiv.toFixed(2)}</td>
          <td class="text-right font-mono" style="font-size:0.76rem; color:#475569;">Bs. ${tasaOp.toFixed(2)}</td>
          <td class="text-right font-mono font-bold">Bs. ${costoUnitBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
          <td class="text-right font-mono font-bold" style="color: var(--ucg-navy);">
            <div>Bs. ${valSaldoVes.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
            <div style="font-size:0.72rem; color:#059669;">($${valSaldoUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })})</div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    showToast(err.message, 'error');
  }
}

function imprimirKardexProducto() {
  if (!currentKardexData || !currentKardexData.producto) {
    showToast('Primero consulta un repuesto por su código para imprimir su Ficha Kardex.', 'error');
    return;
  }

  const p = currentKardexData.producto;
  const hist = currentKardexData.historial || [];
  const cppUsd = Number(p.cpp_actual_usd || p.costo_referencial_usd || 0);
  const cppVes = Number(p.cpp_actual_ves || (cppUsd * 68.50));
  const metodoLabel = p.metodo_valoracion === 'PEPS' ? 'PEPS / FIFO (PRIMERAS ENTRADAS, PRIMERAS SALIDAS)' : 'COSTO PROMEDIO PONDERADO (CPP)';

  const fmtBs = (v) => Number(v || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const rowsHtml = hist.map((h, i) => {
    const isEnt = h.entrada > 0;
    const isSal = h.salida > 0;
    const costoDiv = Number(h.costo_unitario_divisa || h.costo_unitario_usd || 0);
    const tasaOp = Number(h.tasa_bcv_operacion || h.tasa_bcv || 68.50);
    return `
      <tr>
        <td style="text-align:center;">${i + 1}</td>
        <td style="text-align:center; font-family:monospace;">${h.fecha}</td>
        <td style="font-weight:700; font-size:7.5px;">${(h.subtipo || h.tipo || '').replace(/_/g, ' ')}</td>
        <td style="font-family:monospace; font-weight:700;">${h.numero_documento || '-'}</td>
        <td style="font-family:monospace; font-size:7.5px;">${h.nro_control || '-'}</td>
        <td>${h.tercero || '-'}</td>
        <td style="text-align:right; font-family:monospace;">$${costoDiv.toFixed(2)}</td>
        <td style="text-align:right; font-family:monospace;">${fmtBs(tasaOp)}</td>
        <!-- Entradas -->
        <td style="text-align:right; font-family:monospace; font-weight:700; color:#065f46;">${isEnt ? '+' + h.entrada : '0'}</td>
        <td style="text-align:right; font-family:monospace;">${isEnt ? fmtBs(h.monto_operacion_ves) : '0,00'}</td>
        <!-- Salidas -->
        <td style="text-align:right; font-family:monospace; font-weight:700; color:#9f1239;">${isSal ? '-' + h.salida : '0'}</td>
        <td style="text-align:right; font-family:monospace;">${isSal ? fmtBs(h.monto_operacion_ves) : '0,00'}</td>
        <!-- Saldo -->
        <td style="text-align:right; font-family:monospace; font-weight:800; color:#000080;">${h.saldo}</td>
        <td style="text-align:right; font-family:monospace;">${fmtBs(h.cpp_resultante_ves)}</td>
        <td style="text-align:right; font-family:monospace; font-weight:800; color:#000080;">${fmtBs(h.valor_saldo_ves)} ($${Number(h.valor_saldo_usd || 0).toFixed(2)})</td>
      </tr>
    `;
  }).join('');

  const printHtml = `
    <div class="print-preview-container seniat-official-doc">
      <div class="print-preview-header seniat-official-header">
        <div><img src="LOGOUCG.png" alt="Logo UCG" style="height: 50px; object-fit: contain;" onerror="this.style.display='none'"></div>
        <div style="text-align: center;">
          <div style="font-size: 9px; font-weight: 800; color: #334155;">REPÚBLICA BOLIVARIANA DE VENEZUELA • SENIAT • PA SNAT/2026/00093</div>
          <div style="font-size: 13px; font-weight: 900; color: #000080; margin: 2px 0;">TARJETA MAYOR AUXILIAR DE INVENTARIO BIMONETARIA (KARDEX ART. 177 RISLR)</div>
          <div style="font-size: 9px; font-weight: 800;">CONTRIBUYENTE: INVERSIONES DG 67, C.A. • RIF: J-50700865-7 • MÉTODO: ${metodoLabel}</div>
        </div>
        <div style="text-align: right; font-size: 8.5px; border-left: 1px solid #cbd5e1; padding-left: 10px;">
          <div style="font-weight:900; color:#000080;">CÓDIGO: ${p.codigo}</div>
          <div>Almacén: <strong>${p.almacen}</strong></div>
          <div>Fecha: ${new Date().toLocaleDateString('es-VE')}</div>
        </div>
      </div>

      <table class="seniat-f30-header-grid">
        <tr>
          <td><strong>CÓDIGO REPUESTO:</strong> <span style="font-family:monospace; color:#000080; font-weight:900;">${p.codigo}</span></td>
          <td colspan="2"><strong>DESCRIPCIÓN DE LA MERCANCÍA:</strong> ${p.descripcion}</td>
          <td><strong>CATEGORÍA:</strong> ${p.categoria}</td>
        </tr>
        <tr>
          <td><strong>UNIDAD DE MEDIDA:</strong> ${p.unidad_medida}</td>
          <td><strong>COSTO UNITARIO ACTUAL:</strong> Bs. ${fmtBs(cppVes)} ($${cppUsd.toFixed(2)})</td>
          <td><strong>EXISTENCIA ACTUAL:</strong> <strong style="color:#000080;">${p.stock_actual} ${p.unidad_medida}</strong></td>
          <td><strong>VALOR TOTAL EN LIBROS:</strong> <strong style="color:#000080;">Bs. ${fmtBs(p.valor_total_ves)} ($${Number(p.valor_total_usd || 0).toFixed(2)})</strong></td>
        </tr>
      </table>

      <table class="print-preview-table seniat-grid-table">
        <thead>
          <tr class="seniat-group-header">
            <th colspan="6">TRAZABILIDAD DEL DOCUMENTO FUENTE (ART. 177 RISLR)</th>
            <th colspan="2" style="background:#0B2447 !important; color:#fff;">DOBLE EXPRESIÓN BCV</th>
            <th colspan="2" style="background:#065f46 !important;">ENTRADAS (COMPRAS)</th>
            <th colspan="2" style="background:#9f1239 !important;">SALIDAS TIPIFICADAS</th>
            <th colspan="3" style="background:#000080 !important;">SALDO VALORADO (${p.metodo_valoracion || 'CPP'})</th>
          </tr>
          <tr>
            <th>#</th>
            <th>FECHA</th>
            <th>TIPIFICACIÓN</th>
            <th>DOC. FUENTE</th>
            <th>N° CONTROL</th>
            <th>PROVEEDOR / TERCERO</th>
            <th>COSTO ($)</th>
            <th>TASA BCV</th>
            <th>CANT.</th>
            <th>COSTO (BS)</th>
            <th>CANT.</th>
            <th>COSTO (BS)</th>
            <th>SALDO UND</th>
            <th>COSTO UNIT. (BS)</th>
            <th>VALOR SALDO (BS / $)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="print-footer-signatures seniat-3-signatures">
        <div>
          <div class="sig-line">RESPONSABLE DE ALMACÉN</div>
          <div style="font-size: 8px; color:#475569;">Control Físico y Soportes</div>
        </div>
        <div>
          <div class="sig-line">CONTADOR PÚBLICO (AUDITORÍA)</div>
          <div style="font-size: 8px; color:#475569;">UNIÓN CONTABLE GLOBAL</div>
        </div>
        <div>
          <div class="sig-line">INVERSIONES DG 67, C.A.</div>
          <div style="font-size: 8px; color:#475569;">Representante Legal • RIF J-50700865-7</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-print-title').textContent = `Ficha Kardex Oficial Bimonetaria Art. 177 RISLR - Repuesto ${p.codigo}`;
  document.getElementById('modal-print-body').innerHTML = printHtml;
  document.getElementById('modal-impresion-fiscal').style.display = 'flex';
}

// 10. Historical Movements Table (Zero Orphan Movements - Full Traceability)
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
      tbody.innerHTML = `<tr><td colspan="9" class="text-center">No se encontraron movimientos con los filtros seleccionados</td></tr>`;
      return;
    }

    tbody.innerHTML = movements.map(m => {
      const typeBadge = formatSubtipoBadge(m.tipo, m.subtipo);
      const totVes = Number(m.total_ves || 0);
      const totUsd = Number(m.total_usd || 0);

      return `
        <tr>
          <td class="font-mono">${m.fecha}</td>
          <td>${typeBadge}</td>
          <td class="font-mono font-bold" style="color:var(--ucg-navy);">${m.numero_documento}</td>
          <td class="font-mono" style="font-size:0.76rem;">${m.nro_control || '-'}</td>
          <td>${m.proveedor_nombre}</td>
          <td style="font-size:0.75rem; color:#334155; font-weight:600;">👤 ${m.usuario_responsable || 'ADMIN_SISTEMA'}</td>
          <td class="text-right font-mono font-bold">${m.total_unidades} (${m.total_items} ít.)</td>
          <td class="text-right font-mono font-bold" style="color:var(--ucg-navy);">
            <div>Bs. ${totVes.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
            <div style="font-size:0.72rem; color:#059669;">($${totUsd.toFixed(2)} • Tasa ${Number(m.tasa_bcv || 68.50).toFixed(2)})</div>
          </td>
          <td class="text-center">
            <button class="btn btn-sm btn-secondary" onclick="viewMovementDetail(${m.id})">Ver Soporte</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading movements:', err);
  }
}

// 11. Movement Detail Modal (with Full Traceability & Dual Currency PA SNAT/2026/00093)
async function viewMovementDetail(id) {
  const modal = document.getElementById('modal-mov-detail');
  const modalBody = document.getElementById('modal-mov-body');
  const modalTitle = document.getElementById('modal-mov-title');

  modal.style.display = 'flex';
  modalBody.innerHTML = `<div class="loading-spinner">Cargando comprobante bimonetario y soportes...</div>`;

  try {
    const res = await fetch(`/api/movimientos/${id}`);
    const data = await res.json();
    const h = data.header;

    modalTitle.textContent = `Comprobante Bimonetario #${h.id} • ${h.numero_documento} (${h.fecha})`;

    let sumBaseBs = 0, sumBaseDiv = 0, sumIvaBs = 0, sumIvaDiv = 0, sumTotBs = 0, sumTotDiv = 0;

    const rowsHtml = data.items.map(it => {
      const pUnitBs = Number(it.precio_unitario_bs || it.costo_unitario_bs || it.costo_ves_efectivo || 0);
      const pUnitDiv = Number(it.precio_unitario_divisa || it.costo_unitario_divisa || it.costo_unitario_usd || 0);
      const baseBs = Number(it.base_imponible_bs || it.subtotal_ves || 0);
      const baseDiv = Number(it.base_imponible_divisa || it.subtotal_usd || 0);
      const ivaBs = Number(it.monto_iva_bs || (baseBs * 0.16));
      const ivaDiv = Number(it.monto_iva_divisa || (baseDiv * 0.16));
      const totBs = Number(it.total_linea_bs || (baseBs + ivaBs));
      const totDiv = Number(it.total_linea_divisa || (baseDiv + ivaDiv));

      sumBaseBs += baseBs; sumBaseDiv += baseDiv;
      sumIvaBs += ivaBs; sumIvaDiv += ivaDiv;
      sumTotBs += totBs; sumTotDiv += totDiv;

      return `
        <tr>
          <td><span class="badge-code">${it.codigo}</span></td>
          <td>${it.descripcion}</td>
          <td class="text-right font-mono font-bold">${it.cantidad} ${it.unidad_medida}</td>
          <td class="text-right font-mono">
            <div>Bs. ${pUnitBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
            <div style="font-size:0.72rem; color:#0369a1;">($${pUnitDiv.toFixed(2)})</div>
          </td>
          <td class="text-right font-mono">
            <div>Bs. ${baseBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
            <div style="font-size:0.72rem; color:#0369a1;">($${baseDiv.toFixed(2)})</div>
          </td>
          <td class="text-right font-mono">
            <div>Bs. ${ivaBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
            <div style="font-size:0.72rem; color:#64748b;">($${ivaDiv.toFixed(2)})</div>
          </td>
          <td class="text-right font-mono font-bold" style="color:var(--ucg-navy);">
            <div>Bs. ${totBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
            <div style="font-size:0.72rem; color:#059669;">($${totDiv.toFixed(2)})</div>
          </td>
        </tr>
      `;
    }).join('');

    const leyendaBcv = h.leyenda_tasa_bcv || `Tasa Oficial BCV Aplicable: Bs. ${Number(h.tasa_bcv || 68.50).toLocaleString('es-VE', { minimumFractionDigits: 2 })} por ${h.moneda_operacion || 'USD'} (Fecha Tasa: ${h.fecha_tasa_bcv || h.fecha})`;

    modalBody.innerHTML = `
      <div style="margin-bottom: 12px; padding: 10px 14px; background: #0B2447; color: #FFFFFF; border-left: 4px solid #19A7CE; border-radius: 6px; font-size: 0.84rem; display: flex; justify-content: space-between; align-items: center;">
        <div><strong>💱 DOBLE EXPRESIÓN MONETARIA SENIAT:</strong> ${leyendaBcv}</div>
        <span class="badge" style="background:#19A7CE; color:#0B2447; font-weight:800;">Método: ${h.metodo_valoracion || 'CPP'}</span>
      </div>
      <div style="margin-bottom: 14px; padding: 10px 14px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.82rem; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
        <div><strong>Tipificación Art. 177:</strong> ${(h.subtipo || h.tipo || '').replace(/_/g, ' ')}</div>
        <div><strong>Documento Fuente:</strong> <span class="font-mono font-bold" style="color:var(--ucg-navy);">${h.numero_documento}</span></div>
        <div><strong>N° Control Fiscal:</strong> <span class="font-mono">${h.nro_control || '-'}</span></div>
        <div><strong>Proveedor / Tercero:</strong> ${h.proveedor_nombre} (${h.proveedor_rif})</div>
        <div><strong>Usuario Responsable:</strong> 👤 ${h.usuario_responsable || 'ADMIN_SISTEMA'}</div>
        <div><strong>Tasa BCV Operación:</strong> Bs. ${Number(h.tasa_bcv || 68.50).toFixed(2)} / ${h.moneda_operacion || 'USD'}</div>
        <div style="grid-column: span 3;"><strong>Observaciones / Soporte Legal:</strong> ${h.observaciones || 'Registro auditado conforme al Art. 177 RISLR y PA SNAT/2026/00093'}</div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>CÓDIGO</th>
            <th>DESCRIPCIÓN</th>
            <th class="text-right">CANTIDAD</th>
            <th class="text-right">PRECIO / COSTO UNIT. (BS / $)</th>
            <th class="text-right">BASE IMPONIBLE (BS / $)</th>
            <th class="text-right">IVA 16% (BS / $)</th>
            <th class="text-right">TOTAL LÍNEA (BS / $)</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
        <tfoot>
          <tr style="background:#f1f5f9; font-weight:800; border-top:2px solid #0B2447;">
            <td colspan="4" class="text-right">TOTALES DEL DOCUMENTO (DOBLE EXPRESIÓN MONETARIA):</td>
            <td class="text-right font-mono">Bs. ${sumBaseBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })} ($${sumBaseDiv.toFixed(2)})</td>
            <td class="text-right font-mono">Bs. ${sumIvaBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })} ($${sumIvaDiv.toFixed(2)})</td>
            <td class="text-right font-mono" style="color:#0B2447;">Bs. ${sumTotBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })} ($${sumTotDiv.toFixed(2)})</td>
          </tr>
        </tfoot>
      </table>
      <div style="margin-top: 10px; font-size: 0.78rem; color: #334155; text-align: right; font-weight: 700;">
        📌 ${leyendaBcv}
      </div>
    `;
  } catch (err) {
    modalBody.innerHTML = `<div style="color: #fb7185; padding: 20px;">Error al cargar detalles: ${err.message}</div>`;
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'none';
}

let currentMonthlyReportData = [];

// 11.1 Monthly Report Loader (with Closing BCV Rate & Bs. Valuation)
async function loadMonthlyReport() {
  const tbody = document.getElementById('tbody-mensual');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="10" class="text-center">Cargando reconciliación mensual bimonetaria...</td></tr>`;

  try {
    const res = await fetch('/api/reportes/mes-a-mes');
    const data = await res.json();
    currentMonthlyReportData = Array.isArray(data) ? data : [];

    if (!Array.isArray(data) || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-center">No hay datos mensuales registrados</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(m => {
      const isInitial = m.periodo === '2025-12';
      const nameBadge = isInitial 
        ? `<strong style="color: #0284c7;">🏁 ${m.nombre}</strong>`
        : `<strong>📅 ${m.nombre}</strong>`;

      const comprasText = isInitial 
        ? `<span class="badge-code" style="background: rgba(16, 185, 129, 0.15); color: #059669;">${m.entradasInicial} und (Inicial)</span>` 
        : (m.compras > 0 ? `+${m.compras} und` : '-');

      const tasaCierre = Number(m.tasa_bcv_cierre || 68.50);
      const comprasUsdText = isInitial 
        ? `$${Number(m.comprasUsd || m.inicialUsd || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} (Inicial)` 
        : (m.comprasUsd > 0 ? `$${Number(m.comprasUsd).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '-');
      const comprasBsText = isInitial
        ? `Bs. ${Number(m.comprasBs || m.inicialBs || 0).toLocaleString('es-VE', { minimumFractionDigits: 2 })} (Inicial)`
        : (m.comprasBs > 0 ? `Bs. ${Number(m.comprasBs).toLocaleString('es-VE', { minimumFractionDigits: 2 })}` : '-');

      const ventasText = m.ventas > 0 ? `-${m.ventas} und` : '-';

      return `
        <tr>
          <td>${nameBadge}</td>
          <td class="text-right font-mono font-bold">${m.saldoInicial}</td>
          <td class="text-right font-mono font-bold" style="color: #059669;">${comprasText}</td>
          <td class="text-right font-mono" style="color: #0B2447; font-weight: 700;">Bs. ${tasaCierre.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
          <td class="text-right font-mono font-bold" style="color: #0369a1;">${comprasUsdText}</td>
          <td class="text-right font-mono font-bold" style="color: #059669;">${comprasBsText}</td>
          <td class="text-right font-mono font-bold" style="color: #e11d48;">${ventasText}</td>
          <td class="text-right font-mono font-bold" style="color: #000080; font-size: 0.95rem;">${m.saldoFinal}</td>
          <td class="text-center font-mono">${m.totalDocs}</td>
          <td class="text-center">
            <div style="display:flex; gap:4px; justify-content:center;">
              <button class="btn btn-sm btn-secondary" onclick="filtrarPorFechaCorte('${m.fechaCorte}')" title="Ver catálogo de productos a esta fecha">
                Ver al Corte
              </button>
              <a href="/reporte-seniat.html?periodo=${m.periodo}" target="_blank" class="btn btn-sm btn-outline-pdf" style="padding:3px 8px; font-size:11px;" title="Imprimir Libro Art. 177 de este mes">
                🖨️ PDF Mes
              </a>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading monthly report:', err);
    tbody.innerHTML = `<tr><td colspan="10" class="text-center" style="color: #fb7185;">Error al cargar datos mensuales</td></tr>`;
  }
}

async function imprimirCierreMensualInventario() {
  if (!currentMonthlyReportData || currentMonthlyReportData.length === 0) {
    await loadMonthlyReport();
  }

  let totComprasUnd = 0;
  let totComprasUsd = 0;
  let totVentasUnd = 0;
  let totDocs = 0;

  const rowsHtml = currentMonthlyReportData.map((m, idx) => {
    const isInitial = m.periodo === '2025-12';
    if (!isInitial) {
      totComprasUnd += Number(m.compras || 0);
      totComprasUsd += Number(m.comprasUsd || 0);
      totVentasUnd += Number(m.ventas || 0);
    }
    totDocs += Number(m.totalDocs || 0);

    return `
      <tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td style="font-weight:800;">${m.nombre}</td>
        <td style="text-align:center; font-family:monospace;">${m.fechaCorte}</td>
        <td style="text-align:right; font-family:monospace; font-weight:700;">${Number(m.saldoInicial || 0).toLocaleString('es-VE')}</td>
        <td style="text-align:right; font-family:monospace; font-weight:700; color:#065f46;">${isInitial ? Number(m.entradasInicial).toLocaleString('es-VE') + ' (Inicial)' : '+' + Number(m.compras || 0).toLocaleString('es-VE')}</td>
        <td style="text-align:right; font-family:monospace;">${isInitial ? '-' : '$' + Number(m.comprasUsd || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        <td style="text-align:right; font-family:monospace; font-weight:700; color:#9f1239;">-${Number(m.ventas || 0).toLocaleString('es-VE')}</td>
        <td style="text-align:right; font-family:monospace; font-weight:900; color:#000080;">${Number(m.saldoFinal || 0).toLocaleString('es-VE')}</td>
        <td style="text-align:center; font-family:monospace;">${m.totalDocs}</td>
      </tr>
    `;
  }).join('');

  const printHtml = `
    <div class="print-preview-container seniat-official-doc">
      <div class="print-preview-header seniat-official-header">
        <div><img src="LOGOUCG.png" alt="Logo UCG" style="height: 50px; object-fit: contain;" onerror="this.style.display='none'"></div>
        <div style="text-align: center;">
          <div style="font-size: 9px; font-weight: 800; color: #334155;">REPÚBLICA BOLIVARIANA DE VENEZUELA • SENIAT</div>
          <div style="font-size: 13.5px; font-weight: 900; color: #000080; margin: 2px 0;">RESUMEN ANUAL DE CONCILIACIÓN Y CIERRE MENSUAL DE INVENTARIOS</div>
          <div style="font-size: 9.5px; font-weight: 800;">CONTRIBUYENTE: INVERSIONES DG 67, C.A. • RIF: J-50700865-7</div>
          <div style="font-size: 8px; color: #475569;">Av. Sur 11 entre esquinas Bolívar y Miranda, Casa N° 112, Urb. San Agustín del Norte, Caracas</div>
        </div>
        <div style="text-align: right; font-size: 8.5px; border-left: 1px solid #cbd5e1; padding-left: 10px;">
          <div style="font-weight:900; color:#000080;">UNIÓN CONTABLE GLOBAL</div>
          <div>Control Continuo Art. 177 ISLR</div>
          <div>Emisión: ${new Date().toLocaleDateString('es-VE')}</div>
        </div>
      </div>

      <table class="print-preview-table seniat-grid-table">
        <thead>
          <tr class="seniat-group-header">
            <th colspan="3">PERÍODO FISCAL AUDITADO</th>
            <th colspan="3">ENTRADAS DE ALMACÉN</th>
            <th colspan="1">SALIDAS</th>
            <th colspan="2">CIERRE DEL MES</th>
          </tr>
          <tr>
            <th>#</th>
            <th>PERÍODO / MES</th>
            <th>FECHA DE CORTE</th>
            <th>SALDO INICIAL (UND)</th>
            <th>ENTRADAS / COMPRAS (UND)</th>
            <th>VALOR COMPRAS ($ USD)</th>
            <th>SALIDAS / VENTAS (UND)</th>
            <th>EXISTENCIA FINAL (UND)</th>
            <th>N° DOCS</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
        <tfoot>
          <tr style="background:#e2e8f0; font-weight:900;">
            <td colspan="4" style="text-align:right;">MOVIMIENTO ACUMULADO DEL EJERCICIO 2026:</td>
            <td style="text-align:right; font-family:monospace; color:#065f46;">+${totComprasUnd.toLocaleString('es-VE')} und</td>
            <td style="text-align:right; font-family:monospace;">$${totComprasUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            <td style="text-align:right; font-family:monospace; color:#9f1239;">-${totVentasUnd.toLocaleString('es-VE')} und</td>
            <td style="text-align:right; font-family:monospace; color:#000080;">${currentMonthlyReportData.length > 0 ? Number(currentMonthlyReportData[currentMonthlyReportData.length - 1].saldoFinal).toLocaleString('es-VE') : 0} und</td>
            <td style="text-align:center; font-family:monospace;">${totDocs}</td>
          </tr>
        </tfoot>
      </table>

      <div class="print-footer-signatures seniat-3-signatures">
        <div>
          <div class="sig-line">RESPONSABLE DE ALMACÉN</div>
          <div style="font-size: 8px; color:#475569;">Control de Entradas y Salidas</div>
        </div>
        <div>
          <div class="sig-line">CONTADOR PÚBLICO (AUDITORÍA)</div>
          <div style="font-size: 8px; color:#475569;">UNIÓN CONTABLE GLOBAL</div>
        </div>
        <div>
          <div class="sig-line">INVERSIONES DG 67, C.A.</div>
          <div style="font-size: 8px; color:#475569;">Representante Legal • RIF J-50700865-7</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-print-title').textContent = `Resumen Oficial de Cierre Mensual de Inventarios (Art. 177 ISLR)`;
  document.getElementById('modal-print-body').innerHTML = printHtml;
  document.getElementById('modal-impresion-fiscal').style.display = 'flex';
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
    if (!res.ok || !Array.isArray(compras)) {
      throw new Error(compras?.error || 'Error al cargar libro de compras');
    }
    fiscalState.compras = compras;
    renderComprasFiscal(compras);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="color: #dc2626;">Error al cargar libro de compras: ${err.message}</td></tr>`;
  }
}

function renderComprasFiscal(compras) {
  const tbody = document.getElementById('tbody-compras-fiscal');
  if (!tbody) return;

  if (!Array.isArray(compras) || compras.length === 0) {
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
        <td><span style="font-size: 0.73rem; background: #eff6ff; color: #1e40af; padding: 2px 6px; border-radius: 4px; font-weight: 700;">${String(c.tipo_servicio || '').replace(/_/g, ' ')}</span></td>
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
    if (!res.ok || !Array.isArray(ventas)) {
      throw new Error(ventas?.error || 'Error al cargar libro de ventas');
    }
    fiscalState.ventas = ventas;
    renderVentasFiscal(ventas);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="color: #dc2626;">Error al cargar libro de ventas: ${err.message}</td></tr>`;
  }
}

function renderVentasFiscal(ventas) {
  const tbody = document.getElementById('tbody-ventas-fiscal');
  if (!tbody) return;

  if (!Array.isArray(ventas) || ventas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center">No se encontraron registros de ventas.</td></tr>`;
    return;
  }

  tbody.innerHTML = ventas.map(v => {
    const undsAlmacen = Number(v.almacen_unidades || 0);
    const docsAlmacen = Number(v.almacen_comprobantes || 0);
    const tieneSalida = undsAlmacen > 0;
    const statusBadge = tieneSalida
      ? `<span class="badge-status in-stock">✅ Cruza con Tienda (${undsAlmacen} unds)</span>`
      : `<span class="badge-status low-stock">⚠️ Sin Descarga en Almacén</span>`;
    const rangoTienda = tieneSalida
      ? `<span class="font-mono" style="font-size:0.75rem;">${v.almacen_desde || '-'} ➔ ${v.almacen_hasta || '-'} (${docsAlmacen} facs)</span>`
      : `<span style="color:var(--text-muted); font-size:0.75rem;">0 salidas registradas</span>`;

    return `
      <tr>
        <td class="font-bold">${v.periodo}</td>
        <td>${v.fecha || '-'}</td>
        <td class="font-mono font-bold" style="color: var(--ucg-navy);">${v.factura_desde || '0'} ➔ ${v.factura_hasta || '0'}</td>
        <td class="text-center font-bold">${v.cantidad_comprobantes || 1}</td>
        <td class="text-center">${rangoTienda}</td>
        <td class="text-center">${statusBadge}</td>
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

function syncMonthPills(barId, activePeriodo) {
  const bar = document.getElementById(barId);
  if (!bar) return;
  bar.querySelectorAll('.month-pill-btn').forEach(btn => {
    const isAct = btn.dataset.periodo === activePeriodo;
    btn.style.background = isAct ? 'var(--ucg-navy)' : '#ffffff';
    btn.style.color = isAct ? '#ffffff' : 'var(--ucg-navy)';
    btn.style.boxShadow = isAct ? '0 2px 6px rgba(10,92,245,0.25)' : 'none';
  });
}

function seleccionarMesRapido(modulo, periodo) {
  if (modulo === 'compras') {
    const sel = document.getElementById('compras-periodo-select');
    if (sel) sel.value = periodo;
    loadLibroCompras();
  } else if (modulo === 'ventas') {
    const sel = document.getElementById('ventas-periodo-select');
    if (sel) sel.value = periodo;
    loadLibroVentas();
  } else if (modulo === 'decl') {
    const sel = document.getElementById('decl-periodo-select');
    if (sel) sel.value = periodo;
    loadDeclaracionDetalle();
  }
}

// 1. SUBMÓDULO: LIBRO DE COMPRAS SENIAT
// --------------------------------------------------------------------------
async function loadLibroCompras() {
  const tbody = document.getElementById('tbody-libro-compras');
  if (!tbody) return;

  const periodo = document.getElementById('compras-periodo-select')?.value || '2026-09';
  const tipo = document.getElementById('compras-tipo-select')?.value || 'TODOS';
  syncMonthPills('pills-compras-bar', periodo);

  document.getElementById('kpi-compras-periodo-sub').textContent = periodo === 'TODOS' ? 'Histórico Consolidado 2026' : `Período Fiscal: ${periodo}`;

  try {
    let url = `/api/fiscal/libro-compras?`;
    if (periodo !== 'TODOS') url += `periodo=${periodo}&`;
    if (tipo !== 'TODOS') url += `tipo_servicio=${tipo}&`;

    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || !Array.isArray(data)) {
      throw new Error(data?.error || 'Error obteniendo Libro de Compras');
    }
    fiscalStateNew.compras = data;
    renderLibroCompras(data);
  } catch (err) {
    console.error('Error cargando libro de compras:', err);
    tbody.innerHTML = `<tr><td colspan="13" class="text-center" style="color: #dc2626;">Error cargando libro de compras: ${err.message}</td></tr>`;
  }
}

function renderLibroCompras(compras) {
  const tbody = document.getElementById('tbody-libro-compras');
  if (!tbody) return;

  if (!Array.isArray(compras) || compras.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13" class="text-center" style="padding: 24px; color: var(--text-muted);">No hay facturas registradas para el período y filtro seleccionados. Usa <strong>"+ Cargar Factura / Gasto Manual"</strong> o <strong>"🔗 Llamar Factura de Entrada (Tienda)"</strong> para registrar.</td></tr>`;
    document.getElementById('kpi-compras-count').textContent = '0';
    document.getElementById('kpi-compras-base').textContent = '0,00 Bs. ($0.00)';
    document.getElementById('kpi-compras-iva').textContent = '0,00 Bs. ($0.00)';
    document.getElementById('kpi-compras-ret').textContent = '0,00 Bs. ($0.00)';
    document.getElementById('tot-compras-base').textContent = '0,00';
    document.getElementById('tot-compras-iva').textContent = '0,00';
    document.getElementById('tot-compras-total').textContent = '0,00';
    document.getElementById('tot-compras-ret').textContent = '0,00';
    return;
  }

  let totBase = 0, totBaseUsd = 0;
  let totIva = 0, totIvaUsd = 0;
  let totTotal = 0, totTotalUsd = 0;
  let totRet = 0, totRetUsd = 0;

  tbody.innerHTML = compras.map((c, index) => {
    const baseBs = Number(c.base_imponible_bs || 0);
    const ivaBs = Number(c.iva_bs || 0);
    const totalBs = Number(c.total_bs || 0);
    const retBs = Number(c.iva_retenido_bs || 0);
    const tasa = Number(c.tasa_bcv || c.tasa_bcv_cierre || 68.50);

    const baseUsd = Number(c.base_imponible_divisa || (tasa > 0 ? baseBs / tasa : 0));
    const ivaUsd = Number(c.monto_iva_divisa || (tasa > 0 ? ivaBs / tasa : 0));
    const totalUsd = Number(c.total_divisa || (tasa > 0 ? totalBs / tasa : 0));
    const retUsd = Number(c.iva_retenido_divisa || (tasa > 0 ? retBs / tasa : 0));

    totBase += baseBs; totBaseUsd += baseUsd;
    totIva += ivaBs; totIvaUsd += ivaUsd;
    totTotal += totalBs; totTotalUsd += totalUsd;
    totRet += retBs; totRetUsd += retUsd;

    const isGastos = c.aplica_inventario === 0;
    const isConciliado = c.estatus_conciliacion === 'CONCILIADO' || Boolean(c.movimiento_id);
    const tipoStr = String(c.tipo_servicio || 'MERCANCIA_REPUESTOS').replace(/_/g, ' ');
    const tipoBadge = isGastos 
      ? `<span class="badge" style="background:#fef3c7; color:#92400e; font-size:10px;">📑 ${tipoStr}</span>`
      : (isConciliado 
          ? `<span class="badge" style="background:#dcfce7; color:#166534; font-size:10px;">✅ INV. CRUZADO (TIENDA)</span>`
          : `<span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:10px;">📦 REPUESTOS / MERCANCÍA</span>`);

    return `
      <tr>
        <td class="text-center font-bold">${c.nro_operacion || (index + 1)}</td>
        <td>
          <div>${c.fecha || '-'}</div>
          <div style="font-size:0.68rem; color:#64748b;">BCV: Bs. ${tasa.toFixed(2)}</div>
        </td>
        <td class="font-mono font-bold" style="color: var(--ucg-navy);">${c.rif}</td>
        <td><strong>${c.razon_social}</strong></td>
        <td class="font-mono font-bold">${c.nro_factura || '-'}</td>
        <td class="font-mono">${c.nro_control || '-'}</td>
        <td class="text-right font-mono font-bold">
          <div>Bs. ${baseBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
          <div style="font-size:0.72rem; color:#0369a1;">($${baseUsd.toFixed(2)})</div>
        </td>
        <td class="text-center font-mono">16%</td>
        <td class="text-right font-mono" style="color: #166534; font-weight: 700;">
          <div>Bs. ${ivaBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
          <div style="font-size:0.72rem; color:#64748b;">($${ivaUsd.toFixed(2)})</div>
        </td>
        <td class="text-right font-mono font-bold" style="color: var(--ucg-navy);">
          <div>Bs. ${totalBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
          <div style="font-size:0.72rem; color:#059669;">($${totalUsd.toFixed(2)})</div>
        </td>
        <td class="text-right font-mono" style="color: #b45309;">
          <div>Bs. ${retBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
          <div style="font-size:0.72rem; color:#92400e;">($${retUsd.toFixed(2)})</div>
        </td>
        <td>${tipoBadge}</td>
        <td class="text-center" style="white-space:nowrap;">
          <button class="btn btn-sm" title="Emitir Comprobante de Retención ISLR (PA SNAT/2026/00093) a esta factura" onclick="emitirISLRDesdeFacturaCompra(${c.id})" style="padding: 3px 7px; font-size: 10.5px; background:#0B2447; color:#19A7CE; font-weight:800; margin-right:3px;">
            🧾 Ret. ISLR
          </button>
          <button class="btn btn-sm btn-secondary" title="Eliminar Factura" onclick="eliminarFacturaCompra(${c.id})" style="padding: 3px 8px; font-size: 11px; color:#be123c;">
            ✕
          </button>
        </td>
      </tr>
    `;
  }).join('');

  document.getElementById('kpi-compras-count').textContent = compras.length.toString();
  document.getElementById('kpi-compras-base').innerHTML = `Bs. ${totBase.toLocaleString('es-VE', { minimumFractionDigits: 2 })} <span style="font-size:0.78rem; color:#0369a1;">($${totBaseUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })})</span>`;
  document.getElementById('kpi-compras-iva').innerHTML = `Bs. ${totIva.toLocaleString('es-VE', { minimumFractionDigits: 2 })} <span style="font-size:0.78rem; color:#166534;">($${totIvaUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })})</span>`;
  document.getElementById('kpi-compras-ret').innerHTML = `Bs. ${totRet.toLocaleString('es-VE', { minimumFractionDigits: 2 })} <span style="font-size:0.78rem; color:#b45309;">($${totRetUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })})</span>`;

  document.getElementById('tot-compras-base').innerHTML = `<div>Bs. ${totBase.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div><div style="font-size:0.72rem; color:#0369a1;">($${totBaseUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })})</div>`;
  document.getElementById('tot-compras-iva').innerHTML = `<div>Bs. ${totIva.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div><div style="font-size:0.72rem; color:#166534;">($${totIvaUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })})</div>`;
  document.getElementById('tot-compras-total').innerHTML = `<div>Bs. ${totTotal.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div><div style="font-size:0.72rem; color:#059669;">($${totTotalUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })})</div>`;
  document.getElementById('tot-compras-ret').innerHTML = `<div>Bs. ${totRet.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div><div style="font-size:0.72rem; color:#b45309;">($${totRetUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })})</div>`;
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

let entradasTiendaCache = [];
let salidasTiendaCache = [];
let entradasTiendaPendientesCache = [];
let entradasTiendaPendientesFiltradas = [];

function openModalNuevaCompra(modo = 'MERCANCIA') {
  document.getElementById('form-nueva-compra').reset();
  document.getElementById('m-comp-movimiento-id').value = '';
  const badge = document.getElementById('badge-entrada-vinculada');
  if (badge) badge.style.display = 'none';

  const periodoActivo = document.getElementById('compras-periodo-select')?.value;
  const targetPeriodo = (periodoActivo && periodoActivo !== 'TODOS') ? periodoActivo : '2026-10';
  document.getElementById('m-comp-periodo').value = targetPeriodo;
  
  const today = new Date().toISOString().slice(0, 10);
  const targetFecha = (targetPeriodo === '2026-10') ? '2026-10-15' : (targetPeriodo ? `${targetPeriodo}-15` : today);
  
  document.getElementById('m-comp-fecha').value = targetFecha;
  if (document.getElementById('m-comp-fecha-recepcion')) {
    document.getElementById('m-comp-fecha-recepcion').value = targetFecha;
  }
  if (document.getElementById('m-comp-fecha-tasa')) {
    document.getElementById('m-comp-fecha-tasa').value = targetFecha;
  }

  // Tasa BCV Oficial por defecto: usa la configurada o la oficial del período/fecha
  const tasaVal = getTasaBcvPorFechaOPeriodo(targetFecha);
  if (document.getElementById('m-comp-tasa-bcv')) {
    document.getElementById('m-comp-tasa-bcv').value = Number(tasaVal).toFixed(4);
  }

  if (document.getElementById('m-comp-modo-moneda')) {
    document.getElementById('m-comp-modo-moneda').value = 'BS';
  }

  setModoModalCompra(modo);
  calcularIvaCompra('BS');
  cargarEntradasPendientesTienda();
  document.getElementById('modal-nueva-compra').style.display = 'flex';
}

function onCambioPeriodoModalCompra() {
  const per = document.getElementById('m-comp-periodo')?.value;
  if (!per) return;
  const targetFecha = `${per}-15`;
  const fFac = document.getElementById('m-comp-fecha');
  const fRec = document.getElementById('m-comp-fecha-recepcion');
  const fTasa = document.getElementById('m-comp-fecha-tasa');
  const tasaInput = document.getElementById('m-comp-tasa-bcv');

  if (fFac && !fFac.value.startsWith(per)) fFac.value = targetFecha;
  if (fRec && !fRec.value.startsWith(per)) fRec.value = targetFecha;
  if (fTasa) fTasa.value = fFac ? fFac.value : targetFecha;

  const tasaVal = getTasaBcvPorFechaOPeriodo(fFac ? fFac.value : targetFecha);
  if (tasaInput) tasaInput.value = Number(tasaVal).toFixed(4);

  calcularIvaCompra();
  cargarEntradasPendientesTienda();
}

function onCambioFechaFacturaCompra() {
  const fFac = document.getElementById('m-comp-fecha')?.value;
  if (!fFac) return;
  const fTasa = document.getElementById('m-comp-fecha-tasa');
  const tasaInput = document.getElementById('m-comp-tasa-bcv');
  const fRec = document.getElementById('m-comp-fecha-recepcion');

  if (fTasa) fTasa.value = fFac;
  if (fRec && !fRec.value) fRec.value = fFac;

  const tasaVal = getTasaBcvPorFechaOPeriodo(fFac);
  if (tasaInput) tasaInput.value = Number(tasaVal).toFixed(4);

  const per = fFac.slice(0, 7);
  const selPer = document.getElementById('m-comp-periodo');
  if (selPer && Array.from(selPer.options).some(o => o.value === per)) {
    selPer.value = per;
  }

  calcularIvaCompra();
}

function onCambioFechaRecepcionCompra() {
  calcularIvaCompra();
}

function onCambioModoMonedaCompra() {
  const modo = document.getElementById('m-comp-modo-moneda')?.value || 'BS';
  if (modo === 'DIVISA') {
    document.getElementById('m-comp-base-divisa')?.focus();
    calcularIvaCompra('USD');
  } else {
    document.getElementById('m-comp-base')?.focus();
    calcularIvaCompra('BS');
  }
}

function setModoModalCompra(modo) {
  const boxBuscador = document.getElementById('box-buscador-entrada-tienda');
  const btnMerc = document.getElementById('btn-modo-mercancia');
  const btnGasto = document.getElementById('btn-modo-gasto');
  const btnActivo = document.getElementById('btn-modo-activo');
  const chkInv = document.getElementById('m-comp-aplica-inv');
  const chkIslr = document.getElementById('m-comp-ir-islr');
  const selTipo = document.getElementById('m-comp-tipo');

  [btnMerc, btnGasto, btnActivo].forEach(b => {
    if (b) {
      b.style.background = '#f8fafc';
      b.style.borderColor = '#cbd5e1';
      b.style.color = '#1e293b';
      b.classList.remove('active');
    }
  });

  if (modo === 'GASTO') {
    if (boxBuscador) boxBuscador.style.display = 'none';
    if (btnGasto) {
      btnGasto.style.background = 'var(--ucg-navy)';
      btnGasto.style.borderColor = 'var(--ucg-navy)';
      btnGasto.style.color = '#ffffff';
      btnGasto.classList.add('active');
    }
    if (chkInv) chkInv.checked = false;
    if (chkIslr) chkIslr.checked = true;
    if (selTipo) selTipo.value = 'SERVICIOS_CONTABLES_Y_LEGALES';
    desvincularEntradaTienda();
  } else if (modo === 'ACTIVO') {
    if (boxBuscador) boxBuscador.style.display = 'none';
    if (btnActivo) {
      btnActivo.style.background = 'var(--ucg-navy)';
      btnActivo.style.borderColor = 'var(--ucg-navy)';
      btnActivo.style.color = '#ffffff';
      btnActivo.classList.add('active');
    }
    if (chkInv) chkInv.checked = false;
    if (chkIslr) chkIslr.checked = false;
    if (selTipo) selTipo.value = 'ACTIVO_FIJO_EQUIPOS';
    desvincularEntradaTienda();
  } else {
    if (boxBuscador) boxBuscador.style.display = 'block';
    if (btnMerc) {
      btnMerc.style.background = 'var(--ucg-navy)';
      btnMerc.style.borderColor = 'var(--ucg-navy)';
      btnMerc.style.color = '#ffffff';
      btnMerc.classList.add('active');
    }
    if (chkInv) chkInv.checked = true;
    if (chkIslr) chkIslr.checked = false;
    if (selTipo) selTipo.value = 'MERCANCIA_REPUESTOS';
  }
}

async function cargarEntradasPendientesTienda() {
  const tbody = document.getElementById('tbody-entradas-pendientes-tienda');
  const badgeContador = document.getElementById('badge-contador-pendientes');
  const perFiltro = document.getElementById('m-comp-filtro-periodo')?.value || 'TODOS';

  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 12px; color: #64748b;">Consultando entradas pendientes...</td></tr>`;

  try {
    const url = `/api/fiscal/entradas-tienda?soloPendientes=true&periodo=${encodeURIComponent(perFiltro)}`;
    const res = await fetch(url);
    const rows = await res.json();
    entradasTiendaPendientesCache = rows || [];
    entradasTiendaPendientesFiltradas = [...entradasTiendaPendientesCache];

    if (badgeContador) {
      badgeContador.textContent = `${entradasTiendaPendientesCache.length} pendientes`;
    }

    renderTablaEntradasPendientesModal();
  } catch (err) {
    console.error('Error al cargar entradas pendientes:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 12px; color: #dc2626;">Error al cargar lista de entradas de almacén</td></tr>`;
  }
}

function filtrarEntradasPendientesTienda(query = '') {
  const q = query.trim().toLowerCase();
  if (!q) {
    entradasTiendaPendientesFiltradas = [...entradasTiendaPendientesCache];
  } else {
    entradasTiendaPendientesFiltradas = entradasTiendaPendientesCache.filter(r => {
      const matchDoc = (r.nro_factura_tienda || r.numero_documento || '').toLowerCase().includes(q);
      const matchRif = (r.rif || '').toLowerCase().includes(q);
      const matchProv = (r.razon_social || '').toLowerCase().includes(q);
      const matchProds = (r.resumen_productos || '').toLowerCase().includes(q);
      return matchDoc || matchRif || matchProv || matchProds;
    });
  }
  renderTablaEntradasPendientesModal();
}

function renderTablaEntradasPendientesModal() {
  const tbody = document.getElementById('tbody-entradas-pendientes-tienda');
  if (!tbody) return;

  if (entradasTiendaPendientesFiltradas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 14px; color: #64748b;">No hay entradas pendientes en este período o filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = entradasTiendaPendientesFiltradas.map((r, idx) => {
    const baseBs = Number(r.base_imponible_bs || (r.base_imponible_divisa * r.tasa_bcv) || 0);
    const baseUsd = Number(r.base_imponible_divisa || r.total_usd || 0);
    const tasa = Number(r.tasa_bcv_factura || r.tasa_bcv || 0);

    return `
      <tr style="cursor: pointer; border-bottom: 1px solid #e2e8f0;" onmouseover="this.style.background='#f0fdf4'" onmouseout="this.style.background='#ffffff'">
        <td class="font-mono" style="padding: 6px 10px; font-weight: 600;">${r.fecha_recepcion || r.fecha}</td>
        <td class="font-mono font-bold" style="padding: 6px 10px; color: #0B2447;">${r.nro_factura_tienda || r.numero_documento}</td>
        <td style="padding: 6px 10px;">
          <strong style="color: #1e293b;">${r.razon_social}</strong>
          <div style="font-size: 0.7rem; color: #64748b; font-family: monospace;">${r.rif}</div>
        </td>
        <td class="text-center" style="padding: 6px 10px;">
          <span class="badge" style="background: #e0f2fe; color: #0369a1; font-size: 10px; font-weight: 700;">${r.total_unidades} unds</span>
          <div style="font-size: 0.68rem; color: #64748b; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.resumen_productos || ''}">${r.resumen_productos || ''}</div>
        </td>
        <td style="padding: 6px 10px; text-align: right;">
          <div style="font-family: monospace; font-weight: 700; color: #0B2447;">Bs. ${fmtBs(baseBs)}</div>
          <div style="font-size: 0.7rem; color: #166534; font-family: monospace;">$${baseUsd.toFixed(2)} USD (BCV: ${tasa.toFixed(2)})</div>
        </td>
        <td class="text-center" style="padding: 6px 10px;">
          <button type="button" class="btn btn-sm btn-emerald" onclick="seleccionarEntradaPendienteTienda(${idx})" style="padding: 4px 10px; font-size: 11px; font-weight: 700; white-space: nowrap;">
            📥 Incorporar
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function seleccionarEntradaPendienteTienda(idx) {
  const item = entradasTiendaPendientesFiltradas[idx];
  if (!item) return;

  document.getElementById('m-comp-movimiento-id').value = item.movimiento_id || '';
  if (item.periodo) {
    const selPer = document.getElementById('m-comp-periodo');
    if (selPer && Array.from(selPer.options).some(o => o.value === item.periodo)) {
      selPer.value = item.periodo;
    }
  }

  const fFac = item.fecha_factura || item.fecha;
  const fRec = item.fecha_recepcion || item.fecha;
  document.getElementById('m-comp-fecha').value = fFac;
  if (document.getElementById('m-comp-fecha-recepcion')) {
    document.getElementById('m-comp-fecha-recepcion').value = fRec;
  }
  if (document.getElementById('m-comp-fecha-tasa')) {
    document.getElementById('m-comp-fecha-tasa').value = item.fecha_tasa_bcv || fFac;
  }

  if (item.rif && item.rif !== 'S/RIF') document.getElementById('m-comp-rif').value = item.rif;
  if (item.razon_social) document.getElementById('m-comp-razon').value = item.razon_social;

  const numFac = (item.nro_factura_tienda || item.numero_documento || '').replace(/^FACT\s*/i, '').trim();
  document.getElementById('m-comp-factura').value = numFac;
  if (document.getElementById('m-comp-control')) {
    document.getElementById('m-comp-control').value = item.nro_control || '00-';
  }

  // Tasa BCV Oficial
  const tasaAplicar = Number(item.tasa_bcv_factura || item.tasa_bcv || getTasaBcvPorFechaOPeriodo(fFac));
  if (document.getElementById('m-comp-tasa-bcv')) {
    document.getElementById('m-comp-tasa-bcv').value = tasaAplicar.toFixed(4);
  }

  // Base Imponible
  const baseBs = Number(item.base_imponible_bs || (item.base_imponible_divisa * tasaAplicar) || 0);
  const baseUsd = Number(item.base_imponible_divisa || (tasaAplicar > 0 ? baseBs / tasaAplicar : 0));

  if (document.getElementById('m-comp-base')) {
    document.getElementById('m-comp-base').value = baseBs > 0 ? baseBs.toFixed(2) : '';
  }
  if (document.getElementById('m-comp-base-divisa')) {
    document.getElementById('m-comp-base-divisa').value = baseUsd > 0 ? baseUsd.toFixed(2) : '';
  }

  document.getElementById('m-comp-tipo').value = item.tipo_servicio || 'MERCANCIA_REPUESTOS';
  document.getElementById('m-comp-aplica-inv').checked = true;
  document.getElementById('m-comp-obs').value = `Cruzado con Entrada de Almacén #${item.movimiento_id} (${item.total_unidades} repuestos ingresados en tienda)`;

  calcularIvaCompra('BS');

  // Mostrar Banner de vinculación
  const badge = document.getElementById('badge-entrada-vinculada');
  const texto = document.getElementById('texto-entrada-vinculada');
  if (badge && texto) {
    texto.innerHTML = `<strong>✅ Entrada #${item.movimiento_id} vinculada:</strong> Doc. <strong>${item.nro_factura_tienda || item.numero_documento}</strong> • Proveedor: <strong>${item.razon_social}</strong> (${item.total_unidades} repuestos). Base: Bs. ${fmtBs(baseBs)} ($${baseUsd.toFixed(2)} USD).`;
    badge.style.display = 'flex';
  }

  // Minimizar lista de pendientes para que el usuario vea el formulario listo
  const wrapper = document.getElementById('wrapper-lista-entradas-pendientes');
  if (wrapper) wrapper.style.display = 'none';
  const btnToggle = document.getElementById('btn-toggle-pendientes');
  if (btnToggle) btnToggle.textContent = '👁️ Mostrar Lista de Pendientes';

  document.getElementById('m-comp-base')?.focus();
}

function desvincularEntradaTienda() {
  document.getElementById('m-comp-movimiento-id').value = '';
  const badge = document.getElementById('badge-entrada-vinculada');
  if (badge) badge.style.display = 'none';

  const wrapper = document.getElementById('wrapper-lista-entradas-pendientes');
  if (wrapper) wrapper.style.display = 'block';
  const btnToggle = document.getElementById('btn-toggle-pendientes');
  if (btnToggle) btnToggle.textContent = '👁️ Ocultar Lista';
}

function toggleVistaEntradasPendientes() {
  const wrapper = document.getElementById('wrapper-lista-entradas-pendientes');
  const btnToggle = document.getElementById('btn-toggle-pendientes');
  if (!wrapper) return;
  const isHidden = wrapper.style.display === 'none';
  wrapper.style.display = isHidden ? 'block' : 'none';
  if (btnToggle) {
    btnToggle.textContent = isHidden ? '👁️ Ocultar Lista' : '👁️ Mostrar Lista';
  }
}

async function buscarEntradasTiendaParaCompra(query = '') {
  filtrarEntradasPendientesTienda(query);
}

function seleccionarEntradaTiendaEnCompra(idx, fromFullModal = false) {
  const item = entradasTiendaCache[idx];
  if (!item) return;

  if (fromFullModal) {
    closeModal('modal-cruce-entradas-tienda');
    openModalNuevaCompra('MERCANCIA');
  }

  document.getElementById('m-comp-movimiento-id').value = item.movimiento_id || '';
  if (item.periodo) {
    const selPer = document.getElementById('m-comp-periodo');
    if (selPer && Array.from(selPer.options).some(o => o.value === item.periodo)) {
      selPer.value = item.periodo;
    }
  }

  const fFac = item.fecha_factura || item.fecha;
  const fRec = item.fecha_recepcion || item.fecha;
  document.getElementById('m-comp-fecha').value = fFac;
  if (document.getElementById('m-comp-fecha-recepcion')) {
    document.getElementById('m-comp-fecha-recepcion').value = fRec;
  }
  if (document.getElementById('m-comp-fecha-tasa')) {
    document.getElementById('m-comp-fecha-tasa').value = item.fecha_tasa_bcv || fFac;
  }

  if (item.rif && item.rif !== 'S/RIF') document.getElementById('m-comp-rif').value = item.rif;
  if (item.razon_social) document.getElementById('m-comp-razon').value = item.razon_social;

  const numFac = (item.nro_factura_tienda || item.numero_documento || '').replace(/^FACT\s*/i, '').trim();
  document.getElementById('m-comp-factura').value = numFac;
  if (document.getElementById('m-comp-control')) {
    document.getElementById('m-comp-control').value = item.nro_control || '00-';
  }

  const tasaAplicar = Number(item.tasa_bcv_factura || item.tasa_bcv || getTasaBcvPorFechaOPeriodo(fFac));
  if (document.getElementById('m-comp-tasa-bcv')) {
    document.getElementById('m-comp-tasa-bcv').value = tasaAplicar.toFixed(4);
  }

  const baseBs = Number(item.base_imponible_bs || (item.base_imponible_divisa * tasaAplicar) || 0);
  const baseUsd = Number(item.base_imponible_divisa || (tasaAplicar > 0 ? baseBs / tasaAplicar : 0));

  if (document.getElementById('m-comp-base')) {
    document.getElementById('m-comp-base').value = baseBs > 0 ? baseBs.toFixed(2) : '';
  }
  if (document.getElementById('m-comp-base-divisa')) {
    document.getElementById('m-comp-base-divisa').value = baseUsd > 0 ? baseUsd.toFixed(2) : '';
  }

  document.getElementById('m-comp-tipo').value = item.tipo_servicio || 'MERCANCIA_REPUESTOS';
  document.getElementById('m-comp-aplica-inv').checked = true;
  document.getElementById('m-comp-obs').value = `Cruzado con Entrada de Tienda #${item.movimiento_id} (${item.total_unidades} unds ingresadas por asistente)`;

  calcularIvaCompra('BS');

  const badge = document.getElementById('badge-entrada-vinculada');
  const texto = document.getElementById('texto-entrada-vinculada');
  if (badge && texto) {
    texto.innerHTML = `<strong>✅ Entrada #${item.movimiento_id} vinculada:</strong> Doc. <strong>${item.nro_factura_tienda || item.numero_documento}</strong> • Proveedor: <strong>${item.razon_social}</strong> (${item.total_unidades} repuestos). Base: Bs. ${fmtBs(baseBs)} ($${baseUsd.toFixed(2)} USD).`;
    badge.style.display = 'flex';
  }

  document.getElementById('m-comp-base')?.focus();
}

async function openModalImportarEntradaTienda() {
  openModalNuevaCompra('MERCANCIA');
}

async function cargarTablaEntradasTiendaModal() {
  const tbody = document.getElementById('tbody-modal-entradas-tienda');
  if (!tbody) return;

  const periodo = document.getElementById('filtro-tienda-ent-periodo')?.value || 'TODOS';
  const q = document.getElementById('filtro-tienda-ent-q')?.value || '';

  try {
    let url = `/api/fiscal/entradas-tienda?periodo=${encodeURIComponent(periodo)}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    let rows = await res.json();

    if ((!rows || rows.length === 0) && periodo !== 'TODOS' && !q) {
      const resAll = await fetch(`/api/fiscal/entradas-tienda?periodo=TODOS`);
      rows = await resAll.json();
    }

    entradasTiendaCache = rows || [];

    if (entradasTiendaCache.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center">No se encontraron entradas de almacén con ese filtro.</td></tr>`;
      return;
    }

    tbody.innerHTML = entradasTiendaCache.map((r, idx) => {
      const yaConciliada = Boolean(r.libro_compra_id);
      const statusBadge = yaConciliada
        ? `<span class="badge" style="background:#dcfce7; color:#166534;">✅ En Libro Compras</span>`
        : `<span class="badge" style="background:#fef3c7; color:#92400e;">⏳ Pendiente en Libro</span>`;

      return `
        <tr>
          <td class="font-mono">${r.fecha_recepcion || r.fecha}</td>
          <td class="font-mono font-bold" style="color: var(--ucg-navy);">${r.nro_factura_tienda || r.numero_documento}</td>
          <td>
            <strong>${r.razon_social}</strong>
            <div style="font-size: 0.72rem; color: var(--text-muted);">${r.rif}</div>
          </td>
          <td class="text-center">
            <span class="badge" style="background:#e0f2fe; color:#0369a1;">${r.total_unidades} unds (${r.total_items} ítems)</span>
            <div style="font-size: 0.7rem; color: var(--text-muted); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.resumen_productos || ''}">${r.resumen_productos || ''}</div>
          </td>
          <td class="text-center">${statusBadge}</td>
          <td class="text-center">
            <button class="btn btn-sm btn-emerald" onclick="seleccionarEntradaTiendaEnCompra(${idx}, true)" style="padding: 4px 10px; font-size: 11px;">
              📥 Llamar a Libro Compras
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="color:#dc2626;">Error cargando entradas de tienda</td></tr>`;
  }
}

function calcularIvaCompra(editedField = 'BS') {
  const fFac = document.getElementById('m-comp-fecha')?.value || '';
  const tasa = parseFloat(document.getElementById('m-comp-tasa-bcv')?.value) || getTasaBcvPorFechaOPeriodo(fFac);
  const fechaTasa = document.getElementById('m-comp-fecha-tasa')?.value || fFac;
  const ali = parseFloat(document.getElementById('m-comp-alicuota')?.value) || 0.16;
  const retPct = parseFloat(document.getElementById('m-comp-ret-pct')?.value) || 0.75;

  const baseBsInput = document.getElementById('m-comp-base');
  const baseDivInput = document.getElementById('m-comp-base-divisa');

  let baseBs = parseFloat(baseBsInput?.value) || 0;
  let baseDiv = parseFloat(baseDivInput?.value) || 0;

  if (editedField === 'USD') {
    baseBs = Number((baseDiv * tasa).toFixed(2));
    if (baseBsInput) baseBsInput.value = baseBs > 0 ? baseBs.toFixed(2) : '';
  } else {
    baseDiv = tasa > 0 ? Number((baseBs / tasa).toFixed(2)) : 0;
    if (baseDivInput && document.activeElement !== baseDivInput) {
      baseDivInput.value = baseDiv > 0 ? baseDiv.toFixed(2) : '';
    }
  }

  const iva = Number((baseBs * ali).toFixed(2));
  const total = Number((baseBs + iva).toFixed(2));
  const ret = Number((iva * retPct).toFixed(2));

  if (document.getElementById('m-comp-iva')) document.getElementById('m-comp-iva').value = iva.toFixed(2);
  if (document.getElementById('m-comp-total')) document.getElementById('m-comp-total').value = total.toFixed(2);
  if (document.getElementById('m-comp-ret')) document.getElementById('m-comp-ret').value = ret.toFixed(2);

  const ivaDiv = tasa > 0 ? (iva / tasa) : 0;
  const totDiv = tasa > 0 ? (total / tasa) : 0;
  const retDiv = tasa > 0 ? (ret / tasa) : 0;

  const lblIvaDiv = document.getElementById('m-comp-iva-divisa-lbl');
  if (lblIvaDiv) lblIvaDiv.textContent = `Ref: $${ivaDiv.toFixed(2)} USD`;

  const lblTotDiv = document.getElementById('m-comp-total-divisa-lbl');
  if (lblTotDiv) lblTotDiv.textContent = `Equivalente: $${totDiv.toFixed(2)} USD`;

  const lblRetDiv = document.getElementById('m-comp-ret-divisa-lbl');
  if (lblRetDiv) lblRetDiv.textContent = `Ref. Retenido: $${retDiv.toFixed(2)} USD`;

  const legend = document.getElementById('m-comp-bcv-legend');
  if (legend) {
    legend.textContent = `🏛️ Tasa BCV Factura: Bs. ${fmtBs(tasa)} por USD (Fecha: ${fechaTasa || 'Hoy'}) • Equiv: Base $${baseDiv.toFixed(2)} + IVA $${ivaDiv.toFixed(2)} = Total $${totDiv.toFixed(2)}`;
  }
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

  const fFac = document.getElementById('m-comp-fecha').value;
  const fRec = document.getElementById('m-comp-fecha-recepcion')?.value || fFac;
  const tasa = parseFloat(document.getElementById('m-comp-tasa-bcv')?.value) || getTasaBcvPorFechaOPeriodo(fFac);
  const baseBs = parseFloat(document.getElementById('m-comp-base').value) || 0;
  const baseDiv = parseFloat(document.getElementById('m-comp-base-divisa')?.value) || (tasa > 0 ? Number((baseBs / tasa).toFixed(2)) : 0);
  const ivaBs = parseFloat(document.getElementById('m-comp-iva').value) || 0;
  const totalBs = parseFloat(document.getElementById('m-comp-total').value) || 0;
  const retBs = parseFloat(document.getElementById('m-comp-ret').value) || 0;

  const data = {
    periodo: document.getElementById('m-comp-periodo').value,
    fecha: fFac,
    fecha_recepcion: fRec,
    rif: document.getElementById('m-comp-rif').value.trim().toUpperCase(),
    razon_social: document.getElementById('m-comp-razon').value.trim(),
    nro_factura: document.getElementById('m-comp-factura').value.trim(),
    nro_control: document.getElementById('m-comp-control')?.value.trim() || null,
    tipo_transaccion: '01-reg',
    tasa_bcv: tasa,
    fecha_tasa_bcv: document.getElementById('m-comp-fecha-tasa')?.value || fFac,
    moneda_operacion: 'USD',
    base_imponible_bs: baseBs,
    base_imponible_divisa: baseDiv,
    alicuota: parseFloat(document.getElementById('m-comp-alicuota').value) || 0.16,
    iva_bs: ivaBs,
    monto_iva_divisa: tasa > 0 ? Number((ivaBs / tasa).toFixed(2)) : 0,
    total_bs: totalBs,
    total_divisa: tasa > 0 ? Number((totalBs / tasa).toFixed(2)) : 0,
    iva_retenido_bs: retBs,
    iva_retenido_divisa: tasa > 0 ? Number((retBs / tasa).toFixed(2)) : 0,
    tipo_servicio: document.getElementById('m-comp-tipo').value,
    aplica_inventario: document.getElementById('m-comp-aplica-inv').checked ? 1 : 0,
    movimiento_id: document.getElementById('m-comp-movimiento-id')?.value || null,
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
    const irAIslr = document.getElementById('m-comp-ir-islr')?.checked;
    const newCompraId = result.id;
    closeModal('modal-nueva-compra');
    await loadCatalogs(); // refresh supplier list
    await loadLibroCompras();
    if (irAIslr && newCompraId) {
      await emitirISLRDesdeFacturaCompra(newCompraId);
    }
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

function getNombrePeriodoFormal(periodo) {
  const map = {
    '2026-01': 'ENERO 2026 (DESDE EL 01/01/2026 AL 31/01/2026)',
    '2026-02': 'FEBRERO 2026 (DESDE EL 01/02/2026 AL 28/02/2026)',
    '2026-03': 'MARZO 2026 (DESDE EL 01/03/2026 AL 31/03/2026)',
    '2026-04': 'ABRIL 2026 (DESDE EL 01/04/2026 AL 30/04/2026)',
    '2026-05': 'MAYO 2026 (DESDE EL 01/05/2026 AL 31/05/2026)',
    '2026-06': 'JUNIO 2026 (DESDE EL 01/06/2026 AL 30/06/2026)',
    '2026-07': 'JULIO 2026 (DESDE EL 01/07/2026 AL 31/07/2026)',
    '2026-08': 'AGOSTO 2026 (DESDE EL 01/08/2026 AL 31/08/2026)',
    '2026-09': 'SEPTIEMBRE 2026 (DESDE EL 01/09/2026 AL 30/09/2026)',
    '2026-10': 'OCTUBRE 2026 (DESDE EL 01/10/2026 AL 31/10/2026)',
    'TODOS': 'ACUMULADO EJERCICIO FISCAL 2026 (ENERO A OCTUBRE 2026)'
  };
  return map[periodo] || `PERÍODO IMPOSITIVO ${periodo}`;
}

function fmtBs(val) {
  return Number(val || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function imprimirLibroCompras() {
  const periodo = document.getElementById('compras-periodo-select')?.value || '2026-10';
  const compras = fiscalStateNew.compras || [];
  const decl = (fiscalStateNew.declaraciones || []).find(d => d.periodo === periodo) || {};

  let rowsHtml = '';
  let totBase = 0, totIva = 0, totTotal = 0, totRet = 0;

  compras.forEach((c, idx) => {
    const base = Number(c.base_imponible_bs || 0);
    const iva = Number(c.iva_bs || 0);
    const total = Number(c.total_bs || (base + iva));
    const ret = Number(c.iva_retenido_bs || 0);

    totBase += base;
    totIva += iva;
    totTotal += total;
    totRet += ret;

    rowsHtml += `
      <tr>
        <td style="text-align:center; font-weight:700;">${c.nro_operacion || (idx + 1)}</td>
        <td style="text-align:center; font-family:monospace;">${c.fecha || '-'}</td>
        <td style="text-align:center; font-family:monospace; font-weight:700;">${c.rif || 'S/RIF'}</td>
        <td style="font-weight:600;">${c.razon_social || '-'}</td>
        <td style="text-align:center;">P / Domiciliado</td>
        <td style="text-align:center; font-family:monospace; font-weight:700;">${c.nro_factura || '-'}</td>
        <td style="text-align:center; font-family:monospace;">${c.nro_control || '-'}</td>
        <td style="text-align:center;">-</td>
        <td style="text-align:center;">-</td>
        <td style="text-align:center; font-family:monospace;">${c.tipo_transaccion || '01-reg'}</td>
        <td style="text-align:center;">-</td>
        <td style="text-align:right; font-family:monospace; font-weight:700;">${fmtBs(total)}</td>
        <td style="text-align:right; font-family:monospace;">0,00</td>
        <td style="text-align:right; font-family:monospace; font-weight:700;">${fmtBs(base)}</td>
        <td style="text-align:center; font-weight:700;">16%</td>
        <td style="text-align:right; font-family:monospace; font-weight:700; color:#000080;">${fmtBs(iva)}</td>
        <td style="text-align:right; font-family:monospace;">${fmtBs(ret)}</td>
      </tr>
    `;
  });

  const excAnt = Number(decl.excedente_anterior_bs || 0);
  const totCreditosConExcedente = totIva + excAnt;

  const printHtml = `
    <div class="print-preview-container seniat-landscape">
      <!-- Encabezado Formal SENIAT -->
      <div class="seniat-official-header">
        <div class="seniat-header-left">
          <img src="LOGOUCG.png" alt="Logo" style="height: 46px; object-fit: contain; margin-bottom:4px;">
          <div style="font-size: 11px; font-weight: 900; color: #000080;">INVERSIONES DG 67, C.A.</div>
          <div style="font-size: 9.5px; font-weight: 800; color: #0f172a;">RIF: J-50700865-7</div>
          <div style="font-size: 8px; color: #475569; max-width: 280px; line-height: 1.25;">
            Domicilio Fiscal: Av. Sur 11 entre Esq. Bolívar y Miranda, Casa N° 112, Local S/N, San Agustín del Norte, Caracas D.C.
          </div>
        </div>

        <div class="seniat-header-center">
          <div style="font-size: 8.5px; font-weight: 800; letter-spacing: 0.08em; color: #475569; text-transform: uppercase;">
            REPÚBLICA BOLIVARIANA DE VENEZUELA • SENIAT • REGIÓN CAPITAL
          </div>
          <h2 style="font-size: 14px; font-weight: 900; color: #000080; margin: 3px 0; text-transform: uppercase; letter-spacing: 0.02em;">
            LIBRO ESPECIAL DE COMPRAS DEL IMPUESTO AL VALOR AGREGADO (IVA)
          </h2>
          <div style="font-size: 9px; font-weight: 700; color: #1e293b;">
            Cumplimiento Artículos 75 y 76 del Reglamento General de la Ley que establece el Impuesto al Valor Agregado
          </div>
          <div style="margin-top: 5px; display: inline-block; padding: 3px 12px; background: #eff6ff; border: 1px solid #93c5fd; border-radius: 4px; font-size: 9.5px; font-weight: 900; color: #000080;">
            PERÍODO IMPOSITIVO: ${getNombrePeriodoFormal(periodo)}
          </div>
        </div>

        <div class="seniat-header-right">
          <div style="font-weight: 800; color: #000080;">CONTRIBUYENTE ORDINARIO</div>
          <div>Sujeto a Retención: 75%</div>
          <div>Fecha Emisión: ${new Date().toLocaleDateString('es-VE')}</div>
          <div>Total Operaciones: ${compras.length}</div>
          <div>Folio: Pág. 1 de 1</div>
        </div>
      </div>

      <!-- Tabla Formal Libro de Compras SENIAT (17 Columnas Oficiales) -->
      <table class="print-preview-table seniat-grid-table">
        <thead>
          <tr class="seniat-group-header">
            <th colspan="7" style="text-align:center; background:#e2e8f0; color:#0f172a;">IDENTIFICACIÓN DE LA OPERACIÓN Y DEL PROVEEDOR</th>
            <th colspan="4" style="text-align:center; background:#e2e8f0; color:#0f172a;">DOCUMENTOS Y NOTAS</th>
            <th colspan="2" style="text-align:center; background:#dbeafe; color:#000080;">COMPRAS TOTALES E INTERNAS NO GRAVADAS</th>
            <th colspan="4" style="text-align:center; background:#dcfce7; color:#14532d;">COMPRAS INTERNAS GRAVADAS (DERECHO A CRÉDITO FISCAL)</th>
          </tr>
          <tr>
            <th style="width: 26px; text-align:center;">N° OP</th>
            <th style="width: 62px; text-align:center;">FECHA FACTURA</th>
            <th style="width: 72px; text-align:center;">RIF PROVEEDOR</th>
            <th>NOMBRE O RAZÓN SOCIAL DEL PROVEEDOR</th>
            <th style="width: 64px; text-align:center;">TIPO PROV.</th>
            <th style="width: 66px; text-align:center;">N° FACTURA</th>
            <th style="width: 68px; text-align:center;">N° CONTROL</th>
            <th style="width: 38px; text-align:center;">N. DÉB.</th>
            <th style="width: 38px; text-align:center;">N. CRÉD.</th>
            <th style="width: 44px; text-align:center;">TIPO TRANS.</th>
            <th style="width: 48px; text-align:center;">FACT. AFECT.</th>
            <th style="width: 82px; text-align:right;">TOTAL COMPRAS INCL. IVA (BS)</th>
            <th style="width: 70px; text-align:right;">SIN DERECHO CRÉD. / EXENTO</th>
            <th style="width: 82px; text-align:right;">BASE IMPONIBLE INTERNA (BS)</th>
            <th style="width: 34px; text-align:center;">% ALÍC.</th>
            <th style="width: 78px; text-align:right;">CRÉDITO FISCAL IVA (BS)</th>
            <th style="width: 72px; text-align:right;">IVA RETENIDO AL VENDEDOR</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="17" style="text-align:center; padding: 14px;">Sin operaciones de compra registradas para este período impositivo.</td></tr>'}
        </tbody>
        <tfoot>
          <tr style="background:#f1f5f9; font-weight:900; border-top: 2px solid #000080;">
            <td colspan="11" style="text-align:right; font-size: 9px; color:#000080;">TOTALES LIBRO DE COMPRAS DEL PERÍODO (${periodo}):</td>
            <td style="text-align:right; font-family:monospace;">Bs. ${fmtBs(totTotal)}</td>
            <td style="text-align:right; font-family:monospace;">0,00</td>
            <td style="text-align:right; font-family:monospace; color:#000080;">Bs. ${fmtBs(totBase)}</td>
            <td style="text-align:center;">16%</td>
            <td style="text-align:right; font-family:monospace; color:#000080;">Bs. ${fmtBs(totIva)}</td>
            <td style="text-align:right; font-family:monospace;">Bs. ${fmtBs(totRet)}</td>
          </tr>
        </tfoot>
      </table>

      <!-- Cuadro Oficial de Resumen del Libro de Compras (Cruce Forma 30 SENIAT) -->
      <div class="seniat-summary-boxes">
        <div class="seniat-summary-box">
          <div class="seniat-box-title">RESUMEN DEL LIBRO DE COMPRAS (BASE PARA AUTOLIQUIDACIÓN FORMA 30 SENIAT)</div>
          <table class="print-preview-table" style="margin-bottom:0; font-size: 8.5px;">
            <thead>
              <tr>
                <th style="width: 40px; text-align:center;">ÍTEM F-30</th>
                <th>CONCEPTO TRIBUTARIO (COMPRAS INTERNAS E IMPORTACIONES)</th>
                <th style="width: 130px; text-align:right;">BASE IMPONIBLE (BS)</th>
                <th style="width: 130px; text-align:right;">CRÉDITO FISCAL IVA (BS)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="text-align:center; font-weight:700;">30</td>
                <td>Compras No Gravadas y/o Sin Derecho a Crédito Fiscal</td>
                <td style="text-align:right; font-family:monospace;">0,00</td>
                <td style="text-align:right; font-family:monospace;">0,00</td>
              </tr>
              <tr>
                <td style="text-align:center; font-weight:700;">31 / 32</td>
                <td>Importaciones Gravadas por Alícuota General / Reducida</td>
                <td style="text-align:right; font-family:monospace;">0,00</td>
                <td style="text-align:right; font-family:monospace;">0,00</td>
              </tr>
              <tr>
                <td style="text-align:center; font-weight:700;">33</td>
                <td><strong>Compras Internas Gravadas sólo por Alícuota General (16%)</strong></td>
                <td style="text-align:right; font-family:monospace; font-weight:800;">Bs. ${fmtBs(totBase)}</td>
                <td style="text-align:right; font-family:monospace; font-weight:800; color:#000080;">Bs. ${fmtBs(totIva)}</td>
              </tr>
              <tr>
                <td style="text-align:center; font-weight:700;">34 / 342</td>
                <td>Compras Internas Gravadas por Alícuota Adicional (31%) / Reducida (8%)</td>
                <td style="text-align:right; font-family:monospace;">0,00</td>
                <td style="text-align:right; font-family:monospace;">0,00</td>
              </tr>
              <tr style="background:#f8fafc; font-weight:800;">
                <td style="text-align:center;">35 / 36</td>
                <td>TOTAL COMPRAS Y CRÉDITOS FISCALES DEL PERÍODO</td>
                <td style="text-align:right; font-family:monospace;">Bs. ${fmtBs(totBase)}</td>
                <td style="text-align:right; font-family:monospace; color:#000080;">Bs. ${fmtBs(totIva)}</td>
              </tr>
              <tr>
                <td style="text-align:center; font-weight:700;">38</td>
                <td>Excedente de Créditos Fiscales del Período Anterior (Arrastre Forma 30)</td>
                <td style="text-align:right; font-family:monospace;">-</td>
                <td style="text-align:right; font-family:monospace; font-weight:700;">Bs. ${fmtBs(excAnt)}</td>
              </tr>
              <tr style="background:#eff6ff; font-weight:900; color:#000080;">
                <td style="text-align:center;">37</td>
                <td>TOTAL CRÉDITOS FISCALES DEDUCIBLES DEL PERÍODO</td>
                <td style="text-align:right; font-family:monospace;">Bs. ${fmtBs(totBase)}</td>
                <td style="text-align:right; font-family:monospace;">Bs. ${fmtBs(totCreditosConExcedente)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Firmas y Certificación -->
      <div class="print-footer-signatures seniat-3-signatures">
        <div>
          <div class="sig-line">ELABORADO POR ADMINISTRACIÓN</div>
          <div style="font-size: 8.5px; color:#475569; margin-top:2px;">Control Interno & Conciliación Tributaria</div>
        </div>
        <div>
          <div class="sig-line">REVISADO POR CONTADOR PÚBLICO</div>
          <div style="font-size: 8.5px; color:#475569; margin-top:2px;">UNIÓN CONTABLE GLOBAL • CPC N°</div>
        </div>
        <div>
          <div class="sig-line">REPRESENTANTE LEGAL / SELLO HÚMEDO</div>
          <div style="font-size: 8.5px; color:#475569; margin-top:2px;">INVERSIONES DG 67, C.A. • RIF: J-50700865-7</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-print-title').textContent = `Libro Oficial de Compras SENIAT (Art. 75 Reglamento IVA) - ${periodo}`;
  document.getElementById('modal-print-body').innerHTML = printHtml;
  document.getElementById('modal-impresion-fiscal').style.display = 'flex';
}


// 2. SUBMÓDULO: LIBRO DE VENTAS SENIAT
// --------------------------------------------------------------------------
async function loadLibroVentas() {
  const tbody = document.getElementById('tbody-libro-ventas');
  if (!tbody) return;

  const periodo = document.getElementById('ventas-periodo-select')?.value || '2026-09';
  syncMonthPills('pills-ventas-bar', periodo);
  document.getElementById('kpi-ventas-periodo-sub').textContent = periodo === 'TODOS' ? 'Histórico Consolidado 2026' : `Período Fiscal: ${periodo}`;

  try {
    let url = `/api/fiscal/libro-ventas?`;
    if (periodo !== 'TODOS') url += `periodo=${periodo}&`;

    const res = await fetch(url);
    const ventas = await res.json();
    if (!res.ok || !Array.isArray(ventas)) {
      throw new Error(ventas?.error || 'Error obteniendo Libro de Ventas');
    }
    fiscalStateNew.ventas = ventas;
    renderLibroVentas(ventas);
  } catch (err) {
    console.error('Error cargando libro de ventas:', err);
    tbody.innerHTML = `<tr><td colspan="11" class="text-center" style="color: #dc2626;">Error cargando libro de ventas: ${err.message}</td></tr>`;
  }
}

function renderLibroVentas(ventas) {
  const tbody = document.getElementById('tbody-libro-ventas');
  if (!tbody) return;

  if (!Array.isArray(ventas) || ventas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center" style="padding: 24px; color: var(--text-muted);">No hay ventas registradas para este período. Usa <strong>"+ Registrar Venta / Reporte Z"</strong> para registrar.</td></tr>`;
    document.getElementById('kpi-ventas-count').textContent = '0';
    document.getElementById('kpi-ventas-comprobantes').textContent = '0';
    document.getElementById('kpi-ventas-base').textContent = '0,00 Bs. ($0.00)';
    document.getElementById('kpi-ventas-iva').textContent = '0,00 Bs. ($0.00)';
    document.getElementById('tot-ventas-cant').textContent = '0';
    document.getElementById('tot-ventas-exento').textContent = '0,00';
    document.getElementById('tot-ventas-base').textContent = '0,00';
    document.getElementById('tot-ventas-iva').textContent = '0,00';
    document.getElementById('tot-ventas-total').textContent = '0,00';
    return;
  }

  let totCant = 0;
  let totExento = 0;
  let totBase = 0, totBaseUsd = 0;
  let totIva = 0, totIvaUsd = 0;
  let totTotal = 0, totTotalUsd = 0;

  tbody.innerHTML = ventas.map((v, index) => {
    const baseBs = Number(v.base_imponible_bs || 0);
    const ivaBs = Number(v.iva_bs || 0);
    const totalBs = Number(v.total_bs || 0);
    const tasa = Number(v.tasa_bcv || v.tasa_bcv_cierre || 68.50);

    const baseUsd = Number(v.base_imponible_divisa || (tasa > 0 ? baseBs / tasa : 0));
    const ivaUsd = Number(v.monto_iva_divisa || (tasa > 0 ? ivaBs / tasa : 0));
    const totalUsd = Number(v.total_divisa || (tasa > 0 ? totalBs / tasa : 0));

    totCant += Number(v.cantidad_comprobantes || 1);
    totExento += Number(v.exento_bs || 0);
    totBase += baseBs; totBaseUsd += baseUsd;
    totIva += ivaBs; totIvaUsd += ivaUsd;
    totTotal += totalBs; totTotalUsd += totalUsd;

    return `
      <tr>
        <td class="text-center font-bold">${index + 1}</td>
        <td>
          <div>${v.fecha || '-'}</div>
          <div style="font-size:0.68rem; color:#64748b;">BCV: Bs. ${tasa.toFixed(2)}</div>
        </td>
        <td class="font-mono font-bold" style="color: var(--ucg-navy);">${v.factura_desde || '00000001'}</td>
        <td class="font-mono font-bold" style="color: var(--ucg-navy);">${v.factura_hasta || '00000001'}</td>
        <td class="text-center font-bold">${v.cantidad_comprobantes || 1}</td>
        <td class="text-right font-mono">Bs. ${Number(v.exento_bs || 0).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
        <td class="text-right font-mono font-bold">
          <div>Bs. ${baseBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
          <div style="font-size:0.72rem; color:#0369a1;">($${baseUsd.toFixed(2)})</div>
        </td>
        <td class="text-center font-mono">16%</td>
        <td class="text-right font-mono" style="color: #0A5CF5; font-weight: 700;">
          <div>Bs. ${ivaBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
          <div style="font-size:0.72rem; color:#64748b;">($${ivaUsd.toFixed(2)})</div>
        </td>
        <td class="text-right font-mono font-bold" style="color: var(--ucg-navy);">
          <div>Bs. ${totalBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
          <div style="font-size:0.72rem; color:#059669;">($${totalUsd.toFixed(2)})</div>
        </td>
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
  document.getElementById('kpi-ventas-base').innerHTML = `Bs. ${totBase.toLocaleString('es-VE', { minimumFractionDigits: 2 })} <span style="font-size:0.78rem; color:#0369a1;">($${totBaseUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })})</span>`;
  document.getElementById('kpi-ventas-iva').innerHTML = `Bs. ${totIva.toLocaleString('es-VE', { minimumFractionDigits: 2 })} <span style="font-size:0.78rem; color:#0A5CF5;">($${totIvaUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })})</span>`;

  document.getElementById('tot-ventas-cant').textContent = totCant.toString();
  document.getElementById('tot-ventas-exento').textContent = `Bs. ${totExento.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
  document.getElementById('tot-ventas-base').innerHTML = `<div>Bs. ${totBase.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div><div style="font-size:0.72rem; color:#0369a1;">($${totBaseUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })})</div>`;
  document.getElementById('tot-ventas-iva').innerHTML = `<div>Bs. ${totIva.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div><div style="font-size:0.72rem; color:#0A5CF5;">($${totIvaUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })})</div>`;
  document.getElementById('tot-ventas-total').innerHTML = `<div>Bs. ${totTotal.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div><div style="font-size:0.72rem; color:#059669;">($${totTotalUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })})</div>`;
}

function openModalNuevaVenta() {
  document.getElementById('form-nueva-venta').reset();
  const badge = document.getElementById('badge-salida-vinculada');
  if (badge) badge.style.display = 'none';
  const list = document.getElementById('lista-resultados-salida-tienda');
  if (list) list.style.display = 'none';

  const periodoActivo = document.getElementById('ventas-periodo-select')?.value;
  const targetPeriodo = (periodoActivo && periodoActivo !== 'TODOS') ? periodoActivo : '2026-10';
  document.getElementById('m-vent-periodo').value = targetPeriodo;
  const targetFecha = targetPeriodo === '2026-10' ? '2026-10-15' : `${targetPeriodo}-01`;
  document.getElementById('m-vent-fecha').value = targetFecha;
  if (document.getElementById('m-vent-fecha-tasa')) document.getElementById('m-vent-fecha-tasa').value = targetFecha;

  const rateObj = (state.tasasBcvPeriodo || []).find(t => t.periodo === targetPeriodo);
  if (document.getElementById('m-vent-tasa-bcv')) {
    document.getElementById('m-vent-tasa-bcv').value = rateObj ? Number(rateObj.tasa_bcv).toFixed(2) : '92.00';
  }
  calcularIvaVenta('BS');
  document.getElementById('modal-nueva-venta').style.display = 'flex';
}

async function buscarSalidasTiendaParaVenta(query = '') {
  const listEl = document.getElementById('lista-resultados-salida-tienda');
  if (!listEl) return;

  try {
    const res = await fetch(`/api/fiscal/salidas-tienda?q=${encodeURIComponent(query.trim())}`);
    const rows = await res.json();
    salidasTiendaCache = rows || [];

    if (salidasTiendaCache.length === 0) {
      listEl.style.display = 'block';
      listEl.innerHTML = `<div style="padding: 8px 12px; font-size: 0.78rem; color: var(--text-muted);">No se encontraron despachos de venta con ese criterio.</div>`;
      return;
    }

    listEl.style.display = 'block';
    listEl.innerHTML = salidasTiendaCache.slice(0, 20).map((r, idx) => `
      <div style="padding: 7px 10px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-size: 0.78rem;"
           onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'"
           onclick="seleccionarSalidaTiendaEnVenta(${idx})">
        <div>
          <strong style="color: var(--ucg-navy);">📅 ${r.fecha}</strong>
          <span style="margin-left: 8px; font-family: monospace; font-weight: 700;">Facturas: ${r.factura_desde || '-'} ➔ ${r.factura_hasta || '-'}</span>
          <div style="font-size: 0.72rem; color: #475569;">${r.cantidad_comprobantes} facturas de venta • ${r.total_unidades_despachadas} repuestos despachados</div>
        </div>
        <span class="badge" style="background: #dcfce7; color: #166534; font-size: 10px;">Seleccionar ➔</span>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error buscando salidas de tienda:', err);
  }
}

function seleccionarSalidaTiendaEnVenta(idx, fromFullModal = false) {
  const item = salidasTiendaCache[idx];
  if (!item) return;

  if (fromFullModal) {
    closeModal('modal-cruce-salidas-tienda');
    openModalNuevaVenta();
  }

  if (item.periodo) {
    const selPer = document.getElementById('m-vent-periodo');
    if (selPer && Array.from(selPer.options).some(o => o.value === item.periodo)) {
      selPer.value = item.periodo;
    }
  }
  if (item.fecha) document.getElementById('m-vent-fecha').value = item.fecha;

  const padFactura = (val) => {
    if (!val) return '';
    const digits = String(val).replace(/\D/g, '');
    return digits ? digits.padStart(8, '0') : String(val).trim();
  };

  document.getElementById('m-vent-desde').value = padFactura(item.factura_desde);
  document.getElementById('m-vent-hasta').value = padFactura(item.factura_hasta);
  document.getElementById('m-vent-cant').value = item.cantidad_comprobantes || 1;

  const listEl = document.getElementById('lista-resultados-salida-tienda');
  if (listEl) listEl.style.display = 'none';

  const badge = document.getElementById('badge-salida-vinculada');
  if (badge) {
    badge.style.display = 'block';
    badge.innerHTML = `✅ Vinculado con Salidas de Tienda del <strong>${item.fecha}</strong>: Rango <strong>${padFactura(item.factura_desde)} ➔ ${padFactura(item.factura_hasta)}</strong> (${item.cantidad_comprobantes} comprobantes / ${item.total_unidades_despachadas} unds despachadas). Ingresa la Base Imponible del Reporte Z en Bs.`;
  }

  document.getElementById('m-vent-base')?.focus();
}

async function openModalImportarSalidaTienda() {
  const periodoActivo = document.getElementById('ventas-periodo-select')?.value || 'TODOS';
  const selPeriodo = document.getElementById('filtro-tienda-sal-periodo');
  if (selPeriodo) {
    selPeriodo.value = (periodoActivo && periodoActivo !== 'TODOS') ? periodoActivo : 'TODOS';
  }
  document.getElementById('filtro-tienda-sal-q').value = '';
  document.getElementById('modal-cruce-salidas-tienda').style.display = 'flex';
  await cargarTablaSalidasTiendaModal();
}

async function cargarTablaSalidasTiendaModal() {
  const tbody = document.getElementById('tbody-modal-salidas-tienda');
  if (!tbody) return;

  const periodo = document.getElementById('filtro-tienda-sal-periodo')?.value || 'TODOS';
  const q = document.getElementById('filtro-tienda-sal-q')?.value || '';

  try {
    let url = `/api/fiscal/salidas-tienda?periodo=${encodeURIComponent(periodo)}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    let rows = await res.json();

    if ((!rows || rows.length === 0) && periodo !== 'TODOS' && !q) {
      const resAll = await fetch(`/api/fiscal/salidas-tienda?periodo=TODOS`);
      rows = await resAll.json();
    }

    salidasTiendaCache = rows || [];

    if (salidasTiendaCache.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center">No se encontraron salidas de venta en tienda con ese filtro.</td></tr>`;
      return;
    }

    tbody.innerHTML = salidasTiendaCache.map((r, idx) => {
      const yaEnLibro = Boolean(r.libro_venta_id);
      const statusBadge = yaEnLibro
        ? `<span class="badge" style="background:#dcfce7; color:#166534;">✅ En Libro Ventas</span>`
        : `<span class="badge" style="background:#fef3c7; color:#92400e;">⏳ Pendiente en Libro</span>`;

      return `
        <tr>
          <td class="font-mono font-bold">${r.fecha}</td>
          <td class="font-mono font-bold" style="color: var(--ucg-navy);">${r.factura_desde || '-'} ➔ ${r.factura_hasta || '-'}</td>
          <td class="text-center font-bold">${r.cantidad_comprobantes} facturas</td>
          <td class="text-center">
            <span class="badge" style="background:#ffe4e6; color:#be123c;">-${r.total_unidades_despachadas} repuestos</span>
          </td>
          <td class="text-center">${statusBadge}</td>
          <td class="text-center">
            <button class="btn btn-sm btn-emerald" onclick="seleccionarSalidaTiendaEnVenta(${idx}, true)" style="padding: 4px 10px; font-size: 11px;">
              📤 Llamar a Libro Ventas
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="color:#dc2626;">Error cargando salidas de tienda</td></tr>`;
  }
}

function calcularIvaVenta(editedField = 'BS') {
  const tasa = parseFloat(document.getElementById('m-vent-tasa-bcv')?.value) || 92.00;
  const fechaTasa = document.getElementById('m-vent-fecha-tasa')?.value || document.getElementById('m-vent-fecha')?.value || '';
  const baseBsInput = document.getElementById('m-vent-base');
  const baseDivInput = document.getElementById('m-vent-base-divisa');

  let base = parseFloat(baseBsInput?.value) || 0;
  let baseDiv = parseFloat(baseDivInput?.value) || 0;

  if (editedField === 'USD') {
    base = Number((baseDiv * tasa).toFixed(2));
    if (baseBsInput) baseBsInput.value = base.toFixed(2);
  } else {
    baseDiv = tasa > 0 ? Number((base / tasa).toFixed(2)) : 0;
    if (baseDivInput && document.activeElement !== baseDivInput) {
      baseDivInput.value = baseDiv.toFixed(2);
    }
  }

  const ex = parseFloat(document.getElementById('m-vent-exento').value) || 0;
  const iva = Number((base * 0.16).toFixed(2));
  const total = Number((base + iva + ex).toFixed(2));

  document.getElementById('m-vent-iva').value = iva.toFixed(2);
  document.getElementById('m-vent-total').value = total.toFixed(2);

  const legend = document.getElementById('m-vent-bcv-legend');
  if (legend) {
    const ivaDiv = tasa > 0 ? (iva / tasa) : 0;
    const totDiv = tasa > 0 ? (total / tasa) : 0;
    legend.textContent = `Tasa Oficial BCV Aplicable: Bs. ${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2 })} por USD (Fecha: ${fechaTasa || 'Del Día'}) • Equiv: Base $${baseDiv.toFixed(2)} + IVA $${ivaDiv.toFixed(2)} = Total $${totDiv.toFixed(2)}`;
  }
}

async function guardarNuevaVenta(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save-venta');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const tasa = parseFloat(document.getElementById('m-vent-tasa-bcv')?.value) || 92.00;
  const baseBs = parseFloat(document.getElementById('m-vent-base').value) || 0;
  const baseDiv = parseFloat(document.getElementById('m-vent-base-divisa')?.value) || (tasa > 0 ? Number((baseBs / tasa).toFixed(2)) : 0);
  const ivaBs = parseFloat(document.getElementById('m-vent-iva').value) || 0;
  const totalBs = parseFloat(document.getElementById('m-vent-total').value) || 0;

  const data = {
    periodo: document.getElementById('m-vent-periodo').value,
    fecha: document.getElementById('m-vent-fecha').value,
    factura_desde: document.getElementById('m-vent-desde').value.trim() || null,
    factura_hasta: document.getElementById('m-vent-hasta').value.trim() || null,
    cantidad_comprobantes: parseInt(document.getElementById('m-vent-cant').value, 10) || 1,
    tasa_bcv: tasa,
    fecha_tasa_bcv: document.getElementById('m-vent-fecha-tasa')?.value || document.getElementById('m-vent-fecha').value,
    moneda_operacion: 'USD',
    base_imponible_bs: baseBs,
    base_imponible_divisa: baseDiv,
    exento_bs: parseFloat(document.getElementById('m-vent-exento').value) || 0,
    alicuota: 0.16,
    iva_bs: ivaBs,
    monto_iva_divisa: tasa > 0 ? Number((ivaBs / tasa).toFixed(2)) : 0,
    total_bs: totalBs,
    total_divisa: tasa > 0 ? Number((totalBs / tasa).toFixed(2)) : 0
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
  const decl = (fiscalStateNew.declaraciones || []).find(d => d.periodo === periodo) || {};

  let rowsHtml = '';
  let totCant = 0, totExento = 0, totBase = 0, totIva = 0, totTotal = 0;

  ventas.forEach((v, idx) => {
    const cant = Number(v.cantidad_comprobantes || 1);
    const ex = Number(v.exento_bs || 0);
    const base = Number(v.base_imponible_bs || 0);
    const iva = Number(v.iva_bs || 0);
    const total = Number(v.total_bs || (base + iva + ex));

    totCant += cant;
    totExento += ex;
    totBase += base;
    totIva += iva;
    totTotal += total;

    rowsHtml += `
      <tr>
        <td style="text-align:center; font-weight:700;">${idx + 1}</td>
        <td style="text-align:center; font-family:monospace;">${v.fecha || '-'}</td>
        <td style="text-align:center; font-family:monospace; font-weight:700; color:#000080;">ZOA0000176</td>
        <td style="text-align:center; font-family:monospace;">${String(idx + 1).padStart(4, '0')}</td>
        <td style="text-align:center;">CONSUMIDOR FINAL (RESUMEN DIARIO Z)</td>
        <td style="text-align:center; font-family:monospace; font-weight:700;">${v.factura_desde || '-'}</td>
        <td style="text-align:center; font-family:monospace; font-weight:700;">${v.factura_hasta || '-'}</td>
        <td style="text-align:center; font-weight:700;">${cant}</td>
        <td style="text-align:right; font-family:monospace; font-weight:700;">${fmtBs(total)}</td>
        <td style="text-align:right; font-family:monospace;">${fmtBs(ex)}</td>
        <td style="text-align:right; font-family:monospace;">0,00</td>
        <td style="text-align:right; font-family:monospace; font-weight:700;">${fmtBs(base)}</td>
        <td style="text-align:center; font-weight:700;">16%</td>
        <td style="text-align:right; font-family:monospace; font-weight:700; color:#0A5CF5;">${fmtBs(iva)}</td>
        <td style="text-align:right; font-family:monospace;">0,00</td>
      </tr>
    `;
  });

  const retPeriodo = Number(decl.iva_retenido_bs || 0);

  const printHtml = `
    <div class="print-preview-container seniat-landscape">
      <!-- Encabezado Formal SENIAT -->
      <div class="seniat-official-header">
        <div class="seniat-header-left">
          <img src="LOGOUCG.png" alt="Logo" style="height: 46px; object-fit: contain; margin-bottom:4px;">
          <div style="font-size: 11px; font-weight: 900; color: #000080;">INVERSIONES DG 67, C.A.</div>
          <div style="font-size: 9.5px; font-weight: 800; color: #0f172a;">RIF: J-50700865-7</div>
          <div style="font-size: 8px; color: #475569; max-width: 280px; line-height: 1.25;">
            Domicilio Fiscal: Av. Sur 11 entre Esq. Bolívar y Miranda, Casa N° 112, Local S/N, San Agustín del Norte, Caracas D.C.
          </div>
        </div>

        <div class="seniat-header-center">
          <div style="font-size: 8.5px; font-weight: 800; letter-spacing: 0.08em; color: #475569; text-transform: uppercase;">
            REPÚBLICA BOLIVARIANA DE VENEZUELA • SENIAT • REGIÓN CAPITAL
          </div>
          <h2 style="font-size: 14px; font-weight: 900; color: #000080; margin: 3px 0; text-transform: uppercase; letter-spacing: 0.02em;">
            LIBRO ESPECIAL DE VENTAS DEL IMPUESTO AL VALOR AGREGADO (IVA)
          </h2>
          <div style="font-size: 9px; font-weight: 700; color: #1e293b;">
            Artículos 77 y 78 del Reglamento General de la Ley del IVA • Registro Fiscal de Máquina Fiscal <strong>ZOA0000176</strong>
          </div>
          <div style="margin-top: 5px; display: inline-block; padding: 3px 12px; background: #eff6ff; border: 1px solid #93c5fd; border-radius: 4px; font-size: 9.5px; font-weight: 900; color: #000080;">
            PERÍODO IMPOSITIVO: ${getNombrePeriodoFormal(periodo)}
          </div>
        </div>

        <div class="seniat-header-right">
          <div style="font-weight: 800; color: #000080;">MÁQUINA FISCAL: ZOA0000176</div>
          <div>Días Reportados: ${ventas.length}</div>
          <div>Comprobantes Emitidos: ${totCant}</div>
          <div>Fecha Emisión: ${new Date().toLocaleDateString('es-VE')}</div>
          <div>Folio: Pág. 1 de 1</div>
        </div>
      </div>

      <!-- Tabla Formal Libro de Ventas SENIAT (15 Columnas Oficiales) -->
      <table class="print-preview-table seniat-grid-table">
        <thead>
          <tr class="seniat-group-header">
            <th colspan="8" style="text-align:center; background:#e2e8f0; color:#0f172a;">IDENTIFICACIÓN DEL REPORTE DIARIO "Z" Y NUMERACIÓN FISCAL</th>
            <th colspan="3" style="text-align:center; background:#dbeafe; color:#000080;">VENTAS TOTALES, EXENTAS Y EXPORTACIONES</th>
            <th colspan="4" style="text-align:center; background:#dcfce7; color:#14532d;">VENTAS INTERNAS GRAVADAS (ALÍCUOTA GENERAL 16%)</th>
          </tr>
          <tr>
            <th style="width: 28px; text-align:center;">N° OP</th>
            <th style="width: 64px; text-align:center;">FECHA REPORTE Z</th>
            <th style="width: 74px; text-align:center;">SERIAL MÁQ. FISCAL</th>
            <th style="width: 50px; text-align:center;">N° REP. Z</th>
            <th>CONCEPTO / ADQUIRIENTE</th>
            <th style="width: 76px; text-align:center;">DESDE FACTURA N°</th>
            <th style="width: 76px; text-align:center;">HASTA FACTURA N°</th>
            <th style="width: 48px; text-align:center;">CANT. COMP.</th>
            <th style="width: 86px; text-align:right;">TOTAL VENTAS INCL. IVA (BS)</th>
            <th style="width: 72px; text-align:right;">VENTAS EXENTAS / NO GRAV.</th>
            <th style="width: 66px; text-align:right;">EXPORTACIONES (0%)</th>
            <th style="width: 86px; text-align:right;">BASE IMPONIBLE INTERNA (BS)</th>
            <th style="width: 38px; text-align:center;">% ALÍC.</th>
            <th style="width: 82px; text-align:right;">DÉBITO FISCAL IVA (BS)</th>
            <th style="width: 72px; text-align:right;">IVA RETENIDO POR CLIENTE</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="15" style="text-align:center; padding: 14px;">Sin operaciones de venta registradas para este período impositivo.</td></tr>'}
        </tbody>
        <tfoot>
          <tr style="background:#f1f5f9; font-weight:900; border-top: 2px solid #000080;">
            <td colspan="7" style="text-align:right; font-size: 9px; color:#000080;">TOTALES MÁQUINA FISCAL ZOA0000176 (${periodo}):</td>
            <td style="text-align:center;">${totCant}</td>
            <td style="text-align:right; font-family:monospace;">Bs. ${fmtBs(totTotal)}</td>
            <td style="text-align:right; font-family:monospace;">Bs. ${fmtBs(totExento)}</td>
            <td style="text-align:right; font-family:monospace;">0,00</td>
            <td style="text-align:right; font-family:monospace; color:#000080;">Bs. ${fmtBs(totBase)}</td>
            <td style="text-align:center;">16%</td>
            <td style="text-align:right; font-family:monospace; color:#0A5CF5;">Bs. ${fmtBs(totIva)}</td>
            <td style="text-align:right; font-family:monospace;">Bs. ${fmtBs(retPeriodo)}</td>
          </tr>
        </tfoot>
      </table>

      <!-- Cuadro Oficial de Resumen del Libro de Ventas (Cruce Forma 30 SENIAT) -->
      <div class="seniat-summary-boxes">
        <div class="seniat-summary-box">
          <div class="seniat-box-title">RESUMEN DEL LIBRO DE VENTAS (BASE PARA AUTOLIQUIDACIÓN FORMA 30 SENIAT)</div>
          <table class="print-preview-table" style="margin-bottom:0; font-size: 8.5px;">
            <thead>
              <tr>
                <th style="width: 40px; text-align:center;">ÍTEM F-30</th>
                <th>CONCEPTO TRIBUTARIO (VENTAS INTERNAS Y EXPORTACIONES)</th>
                <th style="width: 130px; text-align:right;">BASE IMPONIBLE (BS)</th>
                <th style="width: 130px; text-align:right;">DÉBITO FISCAL IVA (BS)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="text-align:center; font-weight:700;">40</td>
                <td>Ventas Internas No Gravadas / Exentas</td>
                <td style="text-align:right; font-family:monospace;">Bs. ${fmtBs(totExento)}</td>
                <td style="text-align:right; font-family:monospace;">0,00</td>
              </tr>
              <tr>
                <td style="text-align:center; font-weight:700;">41</td>
                <td>Ventas de Exportación (Alícuota 0%)</td>
                <td style="text-align:right; font-family:monospace;">0,00</td>
                <td style="text-align:right; font-family:monospace;">0,00</td>
              </tr>
              <tr>
                <td style="text-align:center; font-weight:700;">42</td>
                <td><strong>Ventas Internas Gravadas por Alícuota General (16%) — Contribuyentes y No Contribuyentes</strong></td>
                <td style="text-align:right; font-family:monospace; font-weight:800;">Bs. ${fmtBs(totBase)}</td>
                <td style="text-align:right; font-family:monospace; font-weight:800; color:#0A5CF5;">Bs. ${fmtBs(totIva)}</td>
              </tr>
              <tr>
                <td style="text-align:center; font-weight:700;">442 / 443</td>
                <td>Ventas Internas Gravadas por Alícuota Adicional (31%) / Reducida (8%)</td>
                <td style="text-align:right; font-family:monospace;">0,00</td>
                <td style="text-align:right; font-family:monospace;">0,00</td>
              </tr>
              <tr style="background:#eff6ff; font-weight:900; color:#000080;">
                <td style="text-align:center;">46 / 47</td>
                <td>TOTAL VENTAS Y DÉBITOS FISCALES DEL PERÍODO IMPOSITIVO</td>
                <td style="text-align:right; font-family:monospace;">Bs. ${fmtBs(totBase + totExento)}</td>
                <td style="text-align:right; font-family:monospace; color:#0A5CF5;">Bs. ${fmtBs(totIva)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Firmas y Certificación -->
      <div class="print-footer-signatures seniat-3-signatures">
        <div>
          <div class="sig-line">ELABORADO POR ADMINISTRACIÓN</div>
          <div style="font-size: 8.5px; color:#475569; margin-top:2px;">Control Interno & Máquina Fiscal ZOA0000176</div>
        </div>
        <div>
          <div class="sig-line">REVISADO POR CONTADOR PÚBLICO</div>
          <div style="font-size: 8.5px; color:#475569; margin-top:2px;">UNIÓN CONTABLE GLOBAL • CPC N°</div>
        </div>
        <div>
          <div class="sig-line">REPRESENTANTE LEGAL / SELLO HÚMEDO</div>
          <div style="font-size: 8.5px; color:#475569; margin-top:2px;">INVERSIONES DG 67, C.A. • RIF: J-50700865-7</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-print-title').textContent = `Libro Oficial de Ventas SENIAT (Art. 77 Reglamento IVA) - ${periodo}`;
  document.getElementById('modal-print-body').innerHTML = printHtml;
  document.getElementById('modal-impresion-fiscal').style.display = 'flex';
}


// 3. SUBMÓDULO: DECLARACIONES Y RESUMEN IVA FORMA 30
// --------------------------------------------------------------------------
async function loadDeclaracionDetalle() {
  const periodo = document.getElementById('decl-periodo-select')?.value || '2026-10';
  syncMonthPills('pills-decl-bar', periodo);

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

    const vBase = Number(d.ventas_base_bs !== undefined ? d.ventas_base_bs : (v.total_base || 0));
    const vDeb = Number(d.debito_fiscal_bs !== undefined ? d.debito_fiscal_bs : (v.total_iva || 0));
    const vDias = Number(d.total_ventas_dias !== undefined ? d.total_ventas_dias : (v.count_lotes || 0));

    const cBase = Number(d.compras_base_bs !== undefined ? d.compras_base_bs : (c.total_base || 0));
    const cCred = Number(d.credito_fiscal_bs !== undefined ? d.credito_fiscal_bs : (c.total_iva || 0));
    const cFacs = Number(d.total_compras_facturas !== undefined ? d.total_compras_facturas : (c.count_facturas || 0));
    const excAnt = Number(d.excedente_anterior_bs || 0);
    const excSig = Number(d.excedente_siguiente_bs || 0);
    const aPagar = Number(d.total_a_pagar_bs || 0);
    const cRet = Number(d.iva_retenido_bs !== undefined ? d.iva_retenido_bs : (c.total_retenido || 0));

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

function seleccionarPeriodoDeclaracion(periodo) {
  const sel = document.getElementById('decl-periodo-select');
  if (sel) {
    sel.value = periodo;
    loadDeclaracionDetalle();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function irALibroDesdeForma30(tipoLibro, periodoParam) {
  const periodo = periodoParam || document.getElementById('decl-periodo-select')?.value || '2026-10';
  if (tipoLibro === 'compras') {
    const sel = document.getElementById('compras-periodo-select');
    if (sel) sel.value = periodo;
    switchTab('tab-libro-compras');
    loadLibroCompras();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (tipoLibro === 'ventas') {
    const sel = document.getElementById('ventas-periodo-select');
    if (sel) sel.value = periodo;
    switchTab('tab-libro-ventas');
    loadLibroVentas();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function renderDeclaracionesHistorico(declaraciones) {
  const tbody = document.getElementById('tbody-declaraciones-historico');
  if (!tbody) return;

  if (!declaraciones || declaraciones.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center">No hay declaraciones registradas.</td></tr>`;
    return;
  }

  const currentSelected = document.getElementById('decl-periodo-select')?.value || '2026-10';
  const nombresMes = {
    '2026-01': '01 - Enero 2026',
    '2026-02': '02 - Febrero 2026',
    '2026-03': '03 - Marzo 2026',
    '2026-04': '04 - Abril 2026',
    '2026-05': '05 - Mayo 2026',
    '2026-06': '06 - Junio 2026',
    '2026-07': '07 - Julio 2026',
    '2026-08': '08 - Agosto 2026',
    '2026-09': '09 - Septiembre 2026',
    '2026-10': '10 - Octubre 2026 (Manual)'
  };

  tbody.innerHTML = declaraciones.map(d => {
    const isEnProceso = d.periodo === '2026-10' || d.estatus === 'EN_PROCESO';
    const isSelected = d.periodo === currentSelected;
    const statusPill = isEnProceso
      ? `<span class="badge" style="background:#dbeafe; color:#1e40af;">EN PREPARACIÓN</span>`
      : `<span class="badge" style="background:#dcfce7; color:#15803d;">DECLARADO</span>`;

    const aPagarNum = Number(d.total_a_pagar_bs || 0);
    const excSigNum = Number(d.excedente_siguiente_bs || 0);

    return `
      <tr style="cursor: pointer; ${isSelected ? 'background: #eff6ff; border-left: 3px solid #0A5CF5;' : ''}" onclick="seleccionarPeriodoDeclaracion('${d.periodo}')" title="Haz clic para ver el detalle de Forma 30 de ${d.periodo}">
        <td class="font-bold" style="color: var(--ucg-navy); white-space: nowrap;">${nombresMes[d.periodo] || d.periodo}</td>
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
        <td class="text-center" style="white-space: nowrap;" onclick="event.stopPropagation();">
          <button class="btn btn-sm btn-secondary" style="padding: 2px 7px; font-size: 10.5px;" onclick="irALibroDesdeForma30('compras', '${d.periodo}')" title="Ver Libro de Compras de ${d.periodo}">📥 Compras (${d.total_compras_facturas || 0})</button>
          <button class="btn btn-sm btn-secondary" style="padding: 2px 7px; font-size: 10.5px;" onclick="irALibroDesdeForma30('ventas', '${d.periodo}')" title="Ver Libro de Ventas de ${d.periodo}">📤 Ventas (${d.total_ventas_dias || 0})</button>
        </td>
      </tr>
    `;
  }).join('');
}

function imprimirDeclaracionForma30() {
  const periodo = document.getElementById('decl-periodo-select')?.value || '2026-09';
  const d = fiscalStateNew.declaraciones.find(x => x.periodo === periodo) || {};
  const [yr, mo] = periodo.split('-');

  const vBase = Number(d.ventas_base_bs || 0);
  const vDeb = Number(d.debito_fiscal_bs || 0);
  const cBase = Number(d.compras_base_bs || 0);
  const cCred = Number(d.credito_fiscal_bs || 0);
  const excAnt = Number(d.excedente_anterior_bs || 0);
  const excSig = Number(d.excedente_siguiente_bs || 0);
  const retPer = Number(d.iva_retenido_bs || 0);
  const aPagar = Number(d.total_a_pagar_bs || 0);
  const totCred = cCred + excAnt;
  const cuotaTributaria = vDeb > totCred ? Number((vDeb - totCred).toFixed(2)) : 0.0;
  const excedenteCredito = totCred > vDeb ? Number((totCred - vDeb).toFixed(2)) : 0.0;

  const printHtml = `
    <div class="print-preview-container seniat-portrait-f30">
      <!-- Encabezado Oficial Forma 30 SENIAT (3 columnas: Logo | Títulos | Caja Forma 30) -->
      <div class="seniat-f30-top-banner">
        <div class="seniat-f30-banner-logo">
          <img src="LOGOUCG.png" alt="Logo" style="height: 44px; max-width: 115px; object-fit: contain;">
        </div>
        <div class="seniat-f30-banner-center">
          <div style="font-size: 8.5px; font-weight: 800; color: #334155; letter-spacing: 0.04em; text-transform: uppercase;">
            REPÚBLICA BOLIVARIANA DE VENEZUELA • MINISTERIO DEL PODER POPULAR DE ECONOMÍA Y FINANZAS
          </div>
          <div style="font-size: 11.5px; font-weight: 900; color: #000080; margin: 2px 0; line-height: 1.2;">
            SERVICIO NACIONAL INTEGRADO DE ADMINISTRACIÓN ADUANERA Y TRIBUTARIA (SENIAT)
          </div>
          <div style="font-size: 10px; font-weight: 800; color: #0f172a;">
            DECLARACIÓN Y PAGO DEL IMPUESTO AL VALOR AGREGADO (IVA)
          </div>
        </div>
        <div class="seniat-f30-banner-box">
          <div style="font-size: 14px; font-weight: 900; color: #000080; line-height: 1.1;">FORMA 30</div>
          <div style="font-size: 8.5px; font-weight: 800; color: #1e293b; margin-top: 2px;">PERÍODO: ${mo || '09'} / ${yr || '2026'}</div>
          <div style="font-size: 7.5px; font-weight: 700; color: #475569;">N° PLANILLA INTERNA: F30-${yr || '2026'}${mo || '09'}</div>
        </div>
      </div>

      <!-- Sección A: Datos de Identificación del Contribuyente -->
      <table class="print-preview-table seniat-f30-id-table" style="margin-bottom: 8px; font-size: 9px;">
        <tbody>
          <tr>
            <td style="width: 22%; background:#f1f5f9; font-weight:800;">1. N° DE RIF:</td>
            <td style="width: 28%; font-family:monospace; font-weight:900; font-size:10.5px; color:#000080;">J-50700865-7</td>
            <td style="width: 22%; background:#f1f5f9; font-weight:800;">2. PERÍODO IMPOSITIVO:</td>
            <td style="width: 28%; font-family:monospace; font-weight:900;">MES: ${mo || '09'} &nbsp;|&nbsp; AÑO: ${yr || '2026'}</td>
          </tr>
          <tr>
            <td style="background:#f1f5f9; font-weight:800;">3. RAZÓN SOCIAL:</td>
            <td style="font-weight:900; color:#0f172a;">INVERSIONES DG 67, C.A.</td>
            <td style="background:#f1f5f9; font-weight:800;">4. TIPO CONTRIBUYENTE:</td>
            <td style="font-weight:800;">ORDINARIO DEL IVA (SUJETO RET. 75%)</td>
          </tr>
          <tr>
            <td style="background:#f1f5f9; font-weight:800;">5. DOMICILIO FISCAL:</td>
            <td colspan="2" style="font-size: 8.2px;">AV. SUR 11 ENTRE ESQUINAS BOLÍVAR Y MIRANDA, CASA N° 112, LOCAL S/N, URB. SAN AGUSTÍN DEL NORTE, CARACAS (ZONA POSTAL 1010)</td>
            <td style="font-weight:800; text-align:center; background:${periodo === '2026-10' ? '#eff6ff' : '#f0fdf4'}; color:${periodo === '2026-10' ? '#1e40af' : '#15803d'};">
              ${periodo === '2026-10' ? 'BORRADOR / EN PROCESO' : 'DECLARADA ANTE SENIAT'}
            </td>
          </tr>
        </tbody>
      </table>

      <!-- SECCIÓN I: DÉBITOS FISCALES -->
      <table class="print-preview-table seniat-f30-main-table" style="font-size: 9px; margin-bottom: 8px;">
        <thead>
          <tr>
            <th colspan="2" style="background:#000080; color:#fff; text-align:left; padding-left:8px;">A. DÉBITOS FISCALES (VENTAS E INGRESOS DEL PERÍODO)</th>
            <th style="width: 58px; background:#000080; color:#fff; text-align:center;">ÍTEM BASE</th>
            <th style="width: 120px; background:#000080; color:#fff; text-align:right;">BASE IMPONIBLE (BS)</th>
            <th style="width: 58px; background:#000080; color:#fff; text-align:center;">ÍTEM DÉB.</th>
            <th style="width: 120px; background:#000080; color:#fff; text-align:right;">DÉBITO FISCAL (BS)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="width: 24px; text-align:center; font-weight:700;">1</td>
            <td>Ventas Internas No Gravadas (Exentas / Exoneradas / No Sujetas)</td>
            <td style="text-align:center; font-family:monospace; background:#f8fafc; font-weight:700;">[40]</td>
            <td style="text-align:right; font-family:monospace;">0,00</td>
            <td style="text-align:center; background:#f8fafc;">-</td>
            <td style="text-align:right; font-family:monospace;">-</td>
          </tr>
          <tr>
            <td style="text-align:center; font-weight:700;">2</td>
            <td>Ventas de Exportación (Alícuota 0%)</td>
            <td style="text-align:center; font-family:monospace; background:#f8fafc; font-weight:700;">[41]</td>
            <td style="text-align:right; font-family:monospace;">0,00</td>
            <td style="text-align:center; background:#f8fafc;">-</td>
            <td style="text-align:right; font-family:monospace;">-</td>
          </tr>
          <tr>
            <td style="text-align:center; font-weight:700;">3</td>
            <td><strong>Ventas Internas Gravadas por Alícuota General (16%)</strong></td>
            <td style="text-align:center; font-family:monospace; font-weight:700; background:#f8fafc;">[42]</td>
            <td style="text-align:right; font-family:monospace; font-weight:800;">Bs. ${fmtBs(vBase)}</td>
            <td style="text-align:center; font-family:monospace; font-weight:700; background:#f8fafc;">[43]</td>
            <td style="text-align:right; font-family:monospace; font-weight:800; color:#000080;">Bs. ${fmtBs(vDeb)}</td>
          </tr>
          <tr>
            <td style="text-align:center; font-weight:700;">4</td>
            <td>Ventas Internas Gravadas por Alícuota General más Adicional (31%)</td>
            <td style="text-align:center; font-family:monospace; background:#f8fafc; font-weight:700;">[442]</td>
            <td style="text-align:right; font-family:monospace;">0,00</td>
            <td style="text-align:center; font-family:monospace; background:#f8fafc; font-weight:700;">[452]</td>
            <td style="text-align:right; font-family:monospace;">0,00</td>
          </tr>
          <tr>
            <td style="text-align:center; font-weight:700;">5</td>
            <td>Ventas Internas Gravadas por Alícuota Reducida (8%)</td>
            <td style="text-align:center; font-family:monospace; background:#f8fafc; font-weight:700;">[443]</td>
            <td style="text-align:right; font-family:monospace;">0,00</td>
            <td style="text-align:center; font-family:monospace; background:#f8fafc; font-weight:700;">[453]</td>
            <td style="text-align:right; font-family:monospace;">0,00</td>
          </tr>
          <tr style="background:#eff6ff; font-weight:900;">
            <td style="text-align:center;">6</td>
            <td>TOTAL VENTAS Y DÉBITOS FISCALES PARA EFECTOS DE DETERMINACIÓN</td>
            <td style="text-align:center; font-family:monospace;">[46]</td>
            <td style="text-align:right; font-family:monospace;">Bs. ${fmtBs(vBase)}</td>
            <td style="text-align:center; font-family:monospace;">[47]</td>
            <td style="text-align:right; font-family:monospace; color:#000080;">Bs. ${fmtBs(vDeb)}</td>
          </tr>
          <tr>
            <td style="text-align:center; font-weight:700;">7</td>
            <td>Ajustes a los Débitos Fiscales de Períodos Anteriores</td>
            <td style="text-align:center; background:#f8fafc;">-</td>
            <td style="text-align:right;">-</td>
            <td style="text-align:center; font-family:monospace; background:#f8fafc; font-weight:700;">[48]</td>
            <td style="text-align:right; font-family:monospace;">0,00</td>
          </tr>
          <tr style="background:#dbeafe; font-weight:900; color:#000080;">
            <td style="text-align:center;">8</td>
            <td colspan="3">TOTAL DÉBITOS FISCALES DEL PERÍODO (Ítem 47 + Ítem 48)</td>
            <td style="text-align:center; font-family:monospace;">[49]</td>
            <td style="text-align:right; font-family:monospace;">Bs. ${fmtBs(vDeb)}</td>
          </tr>
        </tbody>
      </table>

      <!-- SECCIÓN II: CRÉDITOS FISCALES -->
      <table class="print-preview-table seniat-f30-main-table" style="font-size: 9px; margin-bottom: 8px;">
        <thead>
          <tr>
            <th colspan="2" style="background:#14532d; color:#fff; text-align:left; padding-left:8px;">B. CRÉDITOS FISCALES (COMPRAS DEL PERÍODO Y EXCEDENTES)</th>
            <th style="width: 58px; background:#14532d; color:#fff; text-align:center;">ÍTEM BASE</th>
            <th style="width: 120px; background:#14532d; color:#fff; text-align:right;">BASE IMPONIBLE (BS)</th>
            <th style="width: 58px; background:#14532d; color:#fff; text-align:center;">ÍTEM CRÉD.</th>
            <th style="width: 120px; background:#14532d; color:#fff; text-align:right;">CRÉDITO FISCAL (BS)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="width: 24px; text-align:center; font-weight:700;">9</td>
            <td>Compras No Gravadas y/o Sin Derecho a Crédito Fiscal</td>
            <td style="text-align:center; font-family:monospace; background:#f8fafc; font-weight:700;">[30]</td>
            <td style="text-align:right; font-family:monospace;">0,00</td>
            <td style="text-align:center; background:#f8fafc;">-</td>
            <td style="text-align:right; font-family:monospace;">-</td>
          </tr>
          <tr>
            <td style="text-align:center; font-weight:700;">10</td>
            <td>Importaciones Gravadas por Alícuota General (16%)</td>
            <td style="text-align:center; font-family:monospace; background:#f8fafc; font-weight:700;">[31]</td>
            <td style="text-align:right; font-family:monospace;">0,00</td>
            <td style="text-align:center; font-family:monospace; background:#f8fafc; font-weight:700;">[32]</td>
            <td style="text-align:right; font-family:monospace;">0,00</td>
          </tr>
          <tr>
            <td style="text-align:center; font-weight:700;">11</td>
            <td><strong>Compras Internas Gravadas por Alícuota General (16%)</strong></td>
            <td style="text-align:center; font-family:monospace; font-weight:700; background:#f8fafc;">[33]</td>
            <td style="text-align:right; font-family:monospace; font-weight:800;">Bs. ${fmtBs(cBase)}</td>
            <td style="text-align:center; font-family:monospace; font-weight:700; background:#f8fafc;">[34]</td>
            <td style="text-align:right; font-family:monospace; font-weight:800; color:#14532d;">Bs. ${fmtBs(cCred)}</td>
          </tr>
          <tr style="background:#f0fdf4; font-weight:900;">
            <td style="text-align:center;">12</td>
            <td>TOTAL COMPRAS Y CRÉDITOS FISCALES DEL PERÍODO</td>
            <td style="text-align:center; font-family:monospace;">[35]</td>
            <td style="text-align:right; font-family:monospace;">Bs. ${fmtBs(cBase)}</td>
            <td style="text-align:center; font-family:monospace;">[36]</td>
            <td style="text-align:right; font-family:monospace; color:#14532d;">Bs. ${fmtBs(cCred)}</td>
          </tr>
          <tr>
            <td style="text-align:center; font-weight:700;">13</td>
            <td><strong>Excedente de Créditos Fiscales del Mes Anterior (Ítem 60 de declaración previa)</strong></td>
            <td style="text-align:center; background:#f8fafc;">-</td>
            <td style="text-align:right;">-</td>
            <td style="text-align:center; font-family:monospace; font-weight:700; background:#f8fafc;">[38]</td>
            <td style="text-align:right; font-family:monospace; font-weight:800; color:#0284c7;">Bs. ${fmtBs(excAnt)}</td>
          </tr>
          <tr style="background:#dcfce7; font-weight:900; color:#14532d;">
            <td style="text-align:center;">14</td>
            <td colspan="3">TOTAL CRÉDITOS FISCALES DEDUCIBLES (Ítem 36 + Ítem 38)</td>
            <td style="text-align:center; font-family:monospace;">[37]</td>
            <td style="text-align:right; font-family:monospace;">Bs. ${fmtBs(totCred)}</td>
          </tr>
        </tbody>
      </table>

      <!-- SECCIÓN III: AUTOLIQUIDACIÓN Y DETERMINACIÓN DE CUOTA TRIBUTARIA -->
      <table class="print-preview-table seniat-f30-main-table" style="font-size: 9px; margin-bottom: 10px;">
        <thead>
          <tr>
            <th colspan="2" style="background:#1e293b; color:#fff; text-align:left; padding-left:8px;">C. AUTOLIQUIDACIÓN DEL IMPUESTO DEL PERÍODO</th>
            <th style="width: 65px; background:#1e293b; color:#fff; text-align:center;">ÍTEM</th>
            <th style="width: 155px; background:#1e293b; color:#fff; text-align:right;">MONTO EN BOLÍVARES (BS)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="width: 24px; text-align:center; font-weight:700;">15</td>
            <td>Total Cuota Tributaria del Período (Si Débitos Ítem 49 &gt; Créditos Ítem 37)</td>
            <td style="text-align:center; font-family:monospace; font-weight:700; background:#f8fafc;">[50]</td>
            <td style="text-align:right; font-family:monospace; font-weight:800;">Bs. ${fmtBs(cuotaTributaria)}</td>
          </tr>
          <tr>
            <td style="text-align:center; font-weight:700;">16</td>
            <td>Excedente de Crédito Fiscal para el Mes Siguiente (Si Créditos Ítem 37 &gt; Débitos Ítem 49)</td>
            <td style="text-align:center; font-family:monospace; font-weight:700; background:#f8fafc;">[51 / 60]</td>
            <td style="text-align:right; font-family:monospace; font-weight:800; color:#15803d;">Bs. ${fmtBs(excSig > 0 ? excSig : excedenteCredito)}</td>
          </tr>
          <tr>
            <td style="text-align:center; font-weight:700;">17</td>
            <td>Menos: Retenciones de IVA Descontables del Período (Soportadas de Clientes)</td>
            <td style="text-align:center; font-family:monospace; font-weight:700; background:#f8fafc;">[54 / 66]</td>
            <td style="text-align:right; font-family:monospace; font-weight:700;">Bs. ${fmtBs(retPer)}</td>
          </tr>
          <tr style="background:${aPagar > 0 ? '#fef2f2' : '#f0fdf4'}; font-weight:900; font-size:10px;">
            <td style="text-align:center;">18</td>
            <td>${aPagar > 0 ? 'TOTAL IMPUESTO A PAGAR AL TESORO NACIONAL (SENIAT)' : 'TOTAL A PAGAR (SALDO A FAVOR DEL CONTRIBUYENTE PARA EL MES SIGUIENTE)'}</td>
            <td style="text-align:center; font-family:monospace;">[90]</td>
            <td style="text-align:right; font-family:monospace; color:${aPagar > 0 ? '#be123c' : '#15803d'};">
              Bs. ${fmtBs(aPagar)}
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Declaración Jurada y Firmas -->
      <div style="border: 1px solid #94a3b8; background: #f8fafc; padding: 6px 10px; border-radius: 4px; font-size: 8px; color: #334155; margin-bottom: 18px; text-align: justify; line-height: 1.35;">
        <strong>DECLARACIÓN JURADA:</strong> Juro que los datos contenidos en este Resumen de Declaración Forma 30 han sido extraídos fielmente de los Libros Especiales de Compras y Ventas llevados conforme a la Ley que establece el Impuesto al Valor Agregado y su Reglamento General para el período impositivo <strong>${periodo}</strong>.
      </div>

      <div class="print-footer-signatures seniat-3-signatures" style="margin-top: 22px;">
        <div>
          <div class="sig-line">ELABORADO POR ADMINISTRACIÓN</div>
          <div style="font-size: 8px; color:#475569; margin-top:2px;">Control Interno & Impuestos</div>
        </div>
        <div>
          <div class="sig-line">REVISADO POR CONTADOR PÚBLICO</div>
          <div style="font-size: 8px; color:#475569; margin-top:2px;">UNIÓN CONTABLE GLOBAL • CPC N°</div>
        </div>
        <div>
          <div class="sig-line">REPRESENTANTE LEGAL / SELLO HÚMEDO</div>
          <div style="font-size: 8px; color:#475569; margin-top:2px;">INVERSIONES DG 67, C.A. • RIF: J-50700865-7</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-print-title').textContent = `Planilla Oficial Forma 30 SENIAT - Período ${periodo}`;
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
      const tpEl = document.getElementById('m-prov-tipo-persona');
      if (tpEl) tpEl.value = prov.tipo_persona || 'PJ-D';
      const dirEl = document.getElementById('m-prov-direccion');
      if (dirEl) dirEl.value = prov.direccion_fiscal || '';
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
    email: document.getElementById('m-prov-email').value.trim() || null,
    tipo_persona: document.getElementById('m-prov-tipo-persona')?.value || 'PJ-D',
    direccion_fiscal: document.getElementById('m-prov-direccion')?.value.trim() || ''
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

// ==========================================================================
// 5. SUBMÓDULO: COMPROBANTES DE RETENCIÓN DE ISLR (SENIAT PA SNAT/2026/00093)
//    Unión Contable Global, Asesores Contables ("Unimos números, contamos éxitos")
//    Paleta Oficial: #0B2447, #3F5B8F, #19A7CE, #FFFFFF, #F3F4F6, #6B7280
// ==========================================================================

const islrState = {
  comprobantes: [],
  conceptos: [],
  facturasDisponibles: [],
  config: {
    agente_razon_social: 'INVERSIONES DG 67, C.A.',
    agente_rif: 'J-50700865-7',
    agente_direccion: 'AV. SUR 11 ENTRE LAS ESQUINAS BOLÍVAR Y MIRANDA, CASA NRO. 112, LOCAL S/N, URB. SAN AGUSTÍN DEL NORTE, CARACAS',
    agente_telefono: '0212-5771122',
    agente_email: 'administracion@inversionesdg67.com.ve',
    valor_ut_bs: 43.00,
    factor_sustraendo: 83.3334,
    aplica_imprenta_digital: 1,
    imprenta_razon_social: 'UNIÓN CONTABLE GLOBAL SISTEMAS DIGITALES, C.A.',
    imprenta_rif: 'J-50714716-9',
    imprenta_providencia: 'SNAT/2026/00093-AUT-00418',
    imprenta_fecha_asignacion: '01/01/2026 08:00:00'
  }
};

async function loadModuloRetencionesISLR() {
  try {
    const [cfgRes, concRes] = await Promise.all([
      fetch('/api/islr/config'),
      fetch('/api/islr/conceptos')
    ]);
    if (cfgRes.ok) {
      islrState.config = await cfgRes.json();
      const utLbl = document.getElementById('lbl-ut-vigente');
      if (utLbl) utLbl.textContent = Number(islrState.config.valor_ut_bs || 43).toLocaleString('es-VE', { minimumFractionDigits: 2 });
    }
    if (concRes.ok) {
      islrState.conceptos = await concRes.json();
    }
  } catch (err) {
    console.error('Error inicializando catálogos ISLR:', err);
  }
  await loadComprobantesISLR();
}

function seleccionarMesRapidoISLR(periodo) {
  const sel = document.getElementById('islr-periodo-select');
  if (sel) sel.value = periodo;
  loadComprobantesISLR();
}

async function loadComprobantesISLR() {
  const tbody = document.getElementById('tbody-retenciones-islr');
  if (!tbody) return;

  const periodo = document.getElementById('islr-periodo-select')?.value || '2026-09';
  const q = document.getElementById('islr-search-input')?.value?.trim() || '';
  syncMonthPills('pills-islr-bar', periodo);

  const subEl = document.getElementById('kpi-islr-periodo-sub');
  if (subEl) subEl.textContent = periodo === 'TODOS' ? 'Histórico Consolidado 2026' : `Período Fiscal: ${periodo.replace('-', ' - ')}`;

  try {
    const params = new URLSearchParams();
    if (periodo) params.append('periodo', periodo);
    if (q) params.append('q', q);

    const res = await fetch(`/api/islr/comprobantes?${params.toString()}`);
    const rows = await res.json();
    if (!res.ok || !Array.isArray(rows)) {
      throw new Error(rows?.error || 'Error cargando comprobantes ISLR');
    }

    islrState.comprobantes = rows;
    renderComprobantesISLR(rows);
  } catch (err) {
    console.error('Error cargando comprobantes ISLR:', err);
    tbody.innerHTML = `<tr><td colspan="11" class="text-center" style="color:#dc2626;">Error cargando comprobantes ISLR: ${err.message}</td></tr>`;
  }
}

function renderComprobantesISLR(rows) {
  const tbody = document.getElementById('tbody-retenciones-islr');
  if (!tbody) return;

  if (!Array.isArray(rows) || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center" style="padding: 24px; color: #6B7280;">No hay comprobantes de retención ISLR emitidos para este período. Haz clic en <strong>"+ Emitir Comprobante ISLR"</strong> para generar uno con numeración de 14 caracteres.</td></tr>`;
    document.getElementById('kpi-islr-count').textContent = '0';
    document.getElementById('kpi-islr-doc-total').textContent = 'Bs. 0,00';
    document.getElementById('kpi-islr-base-total').textContent = 'Bs. 0,00';
    document.getElementById('kpi-islr-retenido-total').textContent = 'Bs. 0,00';
    document.getElementById('tot-islr-doc').textContent = 'Bs. 0,00';
    document.getElementById('tot-islr-base').textContent = 'Bs. 0,00';
    document.getElementById('tot-islr-sust').textContent = 'Bs. 0,00';
    document.getElementById('tot-islr-ret').textContent = 'Bs. 0,00';
    return;
  }

  let totDoc = 0;
  let totBase = 0;
  let totSust = 0;
  let totRet = 0;

  tbody.innerHTML = rows.map((r, idx) => {
    const docBs = Number(r.total_documento_bs || 0);
    const baseBs = Number(r.total_base_imponible_bs || 0);
    const sustBs = Number(r.total_sustraendo_bs || 0);
    const retBs = Number(r.total_islr_retenido_bs || 0);

    totDoc += docBs;
    totBase += baseBs;
    totSust += sustBs;
    totRet += retBs;

    const bgRow = idx % 2 === 1 ? 'background:#F3F4F6;' : 'background:#FFFFFF;';
    const divisaBadge = r.es_multimoneda
      ? `<span class="badge" style="background:#e0f2fe; color:#0B2447; border:1px solid #19A7CE; font-size:9.5px; margin-left:4px;">💱 ${r.moneda_divisa || 'USD'} @ ${Number(r.tasa_bcv || 68.5).toFixed(2)}</span>`
      : '';

    return `
      <tr style="${bgRow}">
        <td class="font-mono font-bold" style="color: #0B2447; font-size: 0.82rem;">
          <span style="border-bottom: 2px solid #19A7CE; padding-bottom: 1px;">${r.nro_comprobante}</span>
        </td>
        <td class="font-mono" style="font-size: 0.76rem; color: #3F5B8F;">
          <strong>${r.fecha_emision}</strong>
          <div style="font-size: 0.68rem; color: #6B7280;">🕒 ${r.hora_emision || '12:00:00'}</div>
        </td>
        <td class="font-mono font-bold" style="color: #0B2447;">${String(r.periodo || '').replace('-', ' - ')}</td>
        <td>
          <div style="font-weight: 800; color: #0B2447;">${r.sujeto_razon_social}</div>
          <div style="font-size: 0.72rem; color: #6B7280; font-family: monospace;">RIF: ${r.sujeto_rif} • ${r.concepto_general || ''} ${divisaBadge}</div>
        </td>
        <td style="font-size: 0.74rem; color: #3F5B8F; font-weight: 600;">
          📧 ${r.sujeto_email || '<span style="color:#dc2626;">Falta Correo</span>'}
        </td>
        <td class="text-center">
          <span class="badge" style="background:#0B2447; color:#FFFFFF; font-size: 10px;">${r.sujeto_tipo_persona || 'PJ-D'}</span>
          <span class="badge" style="background:#e0f2fe; color:#0B2447; border:1px solid #19A7CE; font-size: 10px;">Cód. ${r.codigo_concepto_principal || '055'}</span>
        </td>
        <td class="text-right font-mono">Bs. ${fmtBs(docBs)}</td>
        <td class="text-right font-mono font-bold" style="color: #3F5B8F;">Bs. ${fmtBs(baseBs)}</td>
        <td class="text-right font-mono" style="color: #6B7280;">Bs. ${fmtBs(sustBs)}</td>
        <td class="text-right font-mono font-bold" style="color: #0B2447; font-size: 0.85rem;">Bs. ${fmtBs(retBs)}</td>
        <td class="text-center" style="white-space: nowrap;">
          <button class="btn btn-sm" style="background: #0B2447; color: #FFFFFF; border: 1px solid #19A7CE; padding: 4px 9px; font-size: 11px; font-weight: 700;" onclick="verComprobanteISLRPDF(${r.id})" title="Ver e Imprimir Comprobante Oficial PA SNAT/2026/00093">
            🖨️ PDF Oficial
          </button>
          <button class="btn btn-sm btn-secondary" style="padding: 4px 7px; font-size: 11px; color: #be123c;" onclick="eliminarComprobanteISLR(${r.id})" title="Eliminar Comprobante">
            ✕
          </button>
        </td>
      </tr>
    `;
  }).join('');

  document.getElementById('kpi-islr-count').textContent = rows.length.toString();
  document.getElementById('kpi-islr-doc-total').textContent = `Bs. ${fmtBs(totDoc)}`;
  document.getElementById('kpi-islr-base-total').textContent = `Bs. ${fmtBs(totBase)}`;
  document.getElementById('kpi-islr-retenido-total').textContent = `Bs. ${fmtBs(totRet)}`;

  document.getElementById('tot-islr-doc').textContent = `Bs. ${fmtBs(totDoc)}`;
  document.getElementById('tot-islr-base').textContent = `Bs. ${fmtBs(totBase)}`;
  document.getElementById('tot-islr-sust').textContent = `Bs. ${fmtBs(totSust)}`;
  document.getElementById('tot-islr-ret').textContent = `Bs. ${fmtBs(totRet)}`;
}

async function emitirISLRDesdeFacturaCompra(libroCompraId) {
  await openModalEmitirRetencionISLR();
  const idx = (islrState.facturasDisponibles || []).findIndex(f => Number(f.id) === Number(libroCompraId));
  if (idx !== -1) {
    const sel = document.getElementById('islr-select-factura-compra');
    if (sel) sel.value = String(idx);
    cargarFacturaCompraEnModalISLR(String(idx));
  }
}

async function openModalEmitirRetencionISLR() {
  const form = document.getElementById('form-emitir-islr');
  if (form) form.reset();

  const periodoActivo = document.getElementById('islr-periodo-select')?.value;
  const targetPeriodo = (periodoActivo && periodoActivo !== 'TODOS') ? periodoActivo : '2026-10';
  document.getElementById('m-islr-periodo').value = targetPeriodo;

  // Sello de fecha y hora exacta con segundos (DD/MM/AAAA y HH:MM:SS)
  const now = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  document.getElementById('m-islr-fecha-emision').value = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}`;
  document.getElementById('m-islr-hora-emision').value = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;

  const utVal = Number(islrState.config?.valor_ut_bs || 43.00);
  const utLbl = document.getElementById('m-islr-ut-label');
  if (utLbl) utLbl.textContent = utVal.toLocaleString('es-VE', { minimumFractionDigits: 2 });

  document.getElementById('box-islr-multimoneda-fields').style.display = 'none';

  // Cargar proveedores y facturas disponibles del Libro de Compras
  try {
    const [provRes, facRes] = await Promise.all([
      fetch('/api/proveedores'),
      fetch('/api/islr/facturas-disponibles')
    ]);
    const provs = await provRes.json();
    const facs = await facRes.json();
    state.suppliers = provs;
    islrState.facturasDisponibles = Array.isArray(facs) ? facs : [];

    const selProv = document.getElementById('m-islr-select-proveedor');
    if (selProv && Array.isArray(provs)) {
      selProv.innerHTML = `<option value="">-- Autocompletar desde Directorio de Proveedores (${provs.length}) --</option>` +
        provs.map(p => `<option value="${p.id}">${p.razon_social} (${p.rif})</option>`).join('');
    }

    const selFac = document.getElementById('islr-select-factura-compra');
    if (selFac && Array.isArray(facs)) {
      selFac.innerHTML = `<option value="">-- Seleccionar factura del Libro de Compras (${facs.length} disponibles) --</option>` +
        facs.map((f, i) => {
          const tagTipo = f.aplica_inventario === 0 ? '⚖️ SERVICIO/GASTO' : '📦 COMPRA';
          const yaEmitido = f.comprobante_islr_emitido ? ` [Ya Retenido: ${f.comprobante_islr_emitido}]` : '';
          return `<option value="${i}">[${f.periodo}] ${tagTipo} • ${f.razon_social} • Fact: ${f.nro_factura || 'S/N'} • Base: Bs. ${fmtBs(f.base_imponible_bs)}${yaEmitido}</option>`;
        }).join('');
    }
  } catch (err) {
    console.error('Error cargando listas para modal ISLR:', err);
  }

  await actualizarProximoNumeroISLR();

  const tbodyItems = document.getElementById('tbody-modal-islr-items');
  if (tbodyItems) tbodyItems.innerHTML = '';
  agregarFilaDetalleISLR();

  document.getElementById('modal-emitir-islr').style.display = 'flex';
}

async function actualizarProximoNumeroISLR() {
  const periodo = document.getElementById('m-islr-periodo')?.value || '2026-10';
  try {
    const res = await fetch(`/api/islr/proximo-numero?periodo=${encodeURIComponent(periodo)}`);
    const data = await res.json();
    if (data.nro_comprobante) {
      document.getElementById('m-islr-nro-comprobante').value = data.nro_comprobante;
    }
  } catch (err) {
    const yyyymm = periodo.replace('-', '');
    document.getElementById('m-islr-nro-comprobante').value = `${yyyymm}00000001`;
  }
}

function detectarTipoPersonaPorRifISLR(rifVal) {
  const clean = String(rifVal || '').trim().toUpperCase();
  if (!clean) return;
  const selTipo = document.getElementById('m-islr-tipo-persona');
  if (selTipo) {
    if (clean.startsWith('V') || clean.startsWith('E')) {
      selTipo.value = 'PN-R';
    } else if (clean.startsWith('J') || clean.startsWith('G')) {
      selTipo.value = 'PJ-D';
    }
  }
  recalcularLineasISLR();
}

function seleccionarProveedorEnModalISLR(provId) {
  if (!provId) return;
  const p = (state.suppliers || []).find(x => String(x.id) === String(provId));
  if (!p) return;

  document.getElementById('m-islr-rif').value = p.rif || '';
  document.getElementById('m-islr-razon').value = p.razon_social || '';
  document.getElementById('m-islr-tipo-persona').value = p.tipo_persona || ((String(p.rif || '').startsWith('V') || String(p.rif || '').startsWith('E')) ? 'PN-R' : 'PJ-D');
  document.getElementById('m-islr-direccion').value = p.direccion_fiscal || 'CARACAS, DISTRITO CAPITAL';
  document.getElementById('m-islr-email').value = p.email || '';
  recalcularLineasISLR();
}

function cargarFacturaCompraEnModalISLR(idxStr) {
  if (idxStr === '' || idxStr === null || idxStr === undefined) return;
  const f = islrState.facturasDisponibles[Number(idxStr)];
  if (!f) return;

  if (f.periodo) {
    document.getElementById('m-islr-periodo').value = f.periodo;
    actualizarProximoNumeroISLR();
  }

  document.getElementById('m-islr-rif').value = f.rif || '';
  document.getElementById('m-islr-razon').value = f.razon_social || '';
  const tipoPers = f.tipo_persona || ((String(f.rif || '').startsWith('V') || String(f.rif || '').startsWith('E')) ? 'PN-R' : 'PJ-D');
  document.getElementById('m-islr-tipo-persona').value = tipoPers;
  document.getElementById('m-islr-direccion').value = f.direccion_fiscal || 'ESQ. QUESERA A NIQUITAO, EDIF. PARQUE CARABOBO PLAZA, TORRE A PISO 15, CARACAS';
  document.getElementById('m-islr-email').value = f.email || 'facturacion@unioncontableglobal.com';
  document.getElementById('m-islr-concepto-general').value = f.tipo_servicio === 'SERVICIOS_CONTABLES_Y_LEGALES'
    ? 'ASESORIA ADMINISTRATIVA'
    : 'EJECUCIÓN DE OBRAS Y PRESTACIÓN DE SERVICIOS';

  // Formatear fecha de la factura a DD/MM/AAAA
  let fechaDoc = f.fecha || '30/09/2026';
  if (/^\d{4}-\d{2}-\d{2}$/.test(fechaDoc)) {
    const [y, m, d] = fechaDoc.split('-');
    fechaDoc = `${d}/${m}/${y}`;
  }

  const codConcepto = f.codigo_concepto_islr || (tipoPers === 'PN-R' ? '001' : '055');
  const tbodyItems = document.getElementById('tbody-modal-islr-items');
  if (tbodyItems) tbodyItems.innerHTML = '';

  agregarFilaDetalleISLR({
    libro_compra_id: f.id,
    fecha_factura: fechaDoc,
    nro_factura: f.nro_factura || '000001',
    nro_control: f.nro_control || '00-00000001',
    codigo_concepto: codConcepto,
    descripcion_concepto: f.rif === 'J-50714716-9' ? 'ASESORIA 360 GLOBAL - CFT' : (f.observaciones_cruce || 'PRESTACIÓN DE SERVICIOS PROFESIONALES'),
    monto_total_bs: Number(f.total_bs || 0),
    base_imponible_bs: Number(f.base_imponible_bs || 0)
  });
}

function toggleBloqueMultimonedaISLR() {
  const checked = document.getElementById('m-islr-multimoneda')?.checked;
  const box = document.getElementById('box-islr-multimoneda-fields');
  if (box) box.style.display = checked ? 'flex' : 'none';
  recalcularLineasISLR();
}

function agregarFilaDetalleISLR(prefill = null) {
  const tbody = document.getElementById('tbody-modal-islr-items');
  if (!tbody) return;

  const rowCount = tbody.querySelectorAll('tr').length + 1;
  const fechaEmision = document.getElementById('m-islr-fecha-emision')?.value || '30/10/2026';
  const tipoPers = document.getElementById('m-islr-tipo-persona')?.value || 'PJ-D';

  const defaultCod = prefill?.codigo_concepto || (tipoPers === 'PN-R' ? '001' : '055');
  const conceptosList = islrState.conceptos.length > 0 ? islrState.conceptos : [
    { codigo: '001', descripcion: 'Honorarios Profesionales No Mercantiles (PN-R)', pct_base: 100, pct_tarifa: 3, aplica_sustraendo: 1 },
    { codigo: '003', descripcion: 'Honorarios Profesionales No Mercantiles (PJ-D)', pct_base: 100, pct_tarifa: 5, aplica_sustraendo: 0 },
    { codigo: '039', descripcion: 'Fletes y Transporte Nacional (PN-R)', pct_base: 100, pct_tarifa: 1, aplica_sustraendo: 1 },
    { codigo: '041', descripcion: 'Fletes y Transporte Nacional (PJ-D)', pct_base: 100, pct_tarifa: 3, aplica_sustraendo: 0 },
    { codigo: '053', descripcion: 'Ejecución de Obras y Servicios (PN-R)', pct_base: 100, pct_tarifa: 1, aplica_sustraendo: 1 },
    { codigo: '055', descripcion: 'Ejecución de Obras, Servicios y Asesoría (PJ-D)', pct_base: 100, pct_tarifa: 2, aplica_sustraendo: 0 }
  ];

  const foundConcept = conceptosList.find(c => c.codigo === defaultCod) || conceptosList[conceptosList.length - 1];

  const tr = document.createElement('tr');
  tr.className = 'islr-item-row';
  tr.dataset.libroCompraId = prefill?.libro_compra_id || '';

  tr.innerHTML = `
    <td class="text-center font-bold row-op-num">${rowCount}</td>
    <td><input type="text" class="form-control font-mono islr-f-fecha" value="${prefill?.fecha_factura || fechaEmision}" style="padding:4px 6px; font-size:0.75rem;" required></td>
    <td><input type="text" class="form-control font-mono font-bold islr-f-factura" value="${prefill?.nro_factura || ''}" placeholder="000013" style="padding:4px 6px; font-size:0.75rem;" required></td>
    <td><input type="text" class="form-control font-mono islr-f-control" value="${prefill?.nro_control || ''}" placeholder="00-00000014" style="padding:4px 6px; font-size:0.75rem;" required></td>
    <td><input type="text" class="form-control font-mono islr-f-ndnc" value="${prefill?.nro_nota_credito || ''}" placeholder="01-REG" style="padding:4px 6px; font-size:0.73rem;"></td>
    <td>
      <select class="form-control islr-f-concepto" style="padding:3px 6px; font-size:0.73rem; margin-bottom:3px; font-weight:700;" onchange="onCambioConceptoFilaISLR(this)">
        ${conceptosList.map(c => `<option value="${c.codigo}" data-base="${c.pct_base}" data-tarifa="${c.pct_tarifa}" data-sust="${c.aplica_sustraendo}" ${c.codigo === defaultCod ? 'selected' : ''}>[${c.codigo}] ${c.descripcion} (${c.pct_tarifa}%)</option>`).join('')}
      </select>
      <input type="text" class="form-control islr-f-desc" value="${prefill?.descripcion_concepto || 'ASESORIA 360 GLOBAL - CFT'}" placeholder="Descripción en comprobante" style="padding:3px 6px; font-size:0.72rem;">
    </td>
    <td><input type="number" step="0.01" class="form-control font-mono text-right islr-f-total" value="${prefill?.monto_total_bs !== undefined ? prefill.monto_total_bs : ''}" placeholder="0.00" style="padding:4px 6px; font-size:0.76rem;" oninput="recalcularLineasISLR()" required></td>
    <td><input type="number" step="0.01" class="form-control font-mono font-bold text-right islr-f-base" value="${prefill?.base_imponible_bs !== undefined ? prefill.base_imponible_bs : ''}" placeholder="0.00" style="padding:4px 6px; font-size:0.76rem; color:#0B2447;" oninput="recalcularLineasISLR()" required></td>
    <td><input type="number" step="0.01" class="form-control font-mono text-center islr-f-pct-base" value="${foundConcept.pct_base || 100}" style="padding:4px 4px; font-size:0.75rem;" oninput="recalcularLineasISLR()"></td>
    <td><input type="number" step="0.01" class="form-control font-mono font-bold text-center islr-f-pct-tarifa" value="${foundConcept.pct_tarifa || 2}" style="padding:4px 4px; font-size:0.75rem; color:#0B2447;" oninput="recalcularLineasISLR()"></td>
    <td><input type="number" step="0.01" class="form-control font-mono text-right islr-f-sustraendo" value="0.00" style="padding:4px 6px; font-size:0.75rem; background:#f8fafc;" readonly></td>
    <td><input type="number" step="0.01" class="form-control font-mono font-bold text-right islr-f-retenido" value="0.00" style="padding:4px 6px; font-size:0.78rem; background:#f0f9ff; color:#0B2447; border-color:#19A7CE;" readonly></td>
    <td class="text-center">
      <button type="button" class="btn btn-sm btn-secondary" style="padding:2px 6px; color:#be123c;" onclick="eliminarFilaDetalleISLR(this)">✕</button>
    </td>
  `;

  tbody.appendChild(tr);
  recalcularLineasISLR();
}

function eliminarFilaDetalleISLR(btn) {
  const tbody = document.getElementById('tbody-modal-islr-items');
  if (!tbody || tbody.querySelectorAll('tr').length <= 1) return;
  btn.closest('tr').remove();
  tbody.querySelectorAll('tr').forEach((r, i) => {
    const cell = r.querySelector('.row-op-num');
    if (cell) cell.textContent = i + 1;
  });
  recalcularLineasISLR();
}

function onCambioConceptoFilaISLR(selectEl) {
  const tr = selectEl.closest('tr');
  const opt = selectEl.options[selectEl.selectedIndex];
  if (!tr || !opt) return;

  const pctBase = parseFloat(opt.dataset.base) || 100;
  const pctTarifa = parseFloat(opt.dataset.tarifa) || 2;
  tr.querySelector('.islr-f-pct-base').value = pctBase;
  tr.querySelector('.islr-f-pct-tarifa').value = pctTarifa;
  recalcularLineasISLR();
}

function recalcularLineasISLR() {
  const tbody = document.getElementById('tbody-modal-islr-items');
  if (!tbody) return;

  const tipoPers = document.getElementById('m-islr-tipo-persona')?.value || 'PJ-D';
  const utBs = Number(islrState.config?.valor_ut_bs || 43.00);
  const factorSust = Number(islrState.config?.factor_sustraendo || 83.3334);

  let totDoc = 0;
  let totBase = 0;
  let totSust = 0;
  let totRet = 0;

  tbody.querySelectorAll('tr.islr-item-row').forEach(tr => {
    const docBs = parseFloat(tr.querySelector('.islr-f-total')?.value) || 0;
    const baseBs = parseFloat(tr.querySelector('.islr-f-base')?.value) || 0;
    const pctBase = parseFloat(tr.querySelector('.islr-f-pct-base')?.value) || 100;
    const pctTarifa = parseFloat(tr.querySelector('.islr-f-pct-tarifa')?.value) || 0;

    // Sustraendo automático para PN-R cuando aplique (1% o 3%): UT * 83.3334 * %Tarifa
    let sustraendo = 0.0;
    if (tipoPers === 'PN-R' && (pctTarifa === 1 || pctTarifa === 3)) {
      sustraendo = Number((utBs * factorSust * (pctTarifa / 100)).toFixed(2));
    }

    const baseObjeto = baseBs * (pctBase / 100);
    const retBruta = baseObjeto * (pctTarifa / 100);
    const retNeta = baseBs > 0 ? Math.max(0, Number((retBruta - sustraendo).toFixed(2))) : 0.0;

    tr.querySelector('.islr-f-sustraendo').value = sustraendo.toFixed(2);
    tr.querySelector('.islr-f-retenido').value = retNeta.toFixed(2);

    totDoc += docBs;
    totBase += baseBs;
    totSust += sustraendo;
    totRet += retNeta;
  });

  document.getElementById('m-islr-tot-doc').textContent = `Bs. ${fmtBs(totDoc)}`;
  document.getElementById('m-islr-tot-base').textContent = `Bs. ${fmtBs(totBase)}`;
  document.getElementById('m-islr-tot-sust').textContent = `Bs. ${fmtBs(totSust)}`;
  document.getElementById('m-islr-tot-ret').textContent = `Bs. ${fmtBs(totRet)}`;

  const esMulti = document.getElementById('m-islr-multimoneda')?.checked;
  const divisaLbl = document.getElementById('m-islr-resumen-divisa');
  if (divisaLbl) {
    if (esMulti) {
      const mon = document.getElementById('m-islr-moneda')?.value || 'USD';
      const tasa = parseFloat(document.getElementById('m-islr-tasa-bcv')?.value) || 68.50;
      const eqDoc = tasa > 0 ? (totDoc / tasa) : 0;
      const eqBase = tasa > 0 ? (totBase / tasa) : 0;
      const eqRet = tasa > 0 ? (totRet / tasa) : 0;
      divisaLbl.innerHTML = `💱 <strong>Equivalente en ${mon} (Tasa BCV Bs. ${fmtBs(tasa)}):</strong> Total Doc: <strong>${mon} ${fmtBs(eqDoc)}</strong> • Base Imp.: <strong>${mon} ${fmtBs(eqBase)}</strong> • ISLR Retenido: <strong>${mon} ${fmtBs(eqRet)}</strong>`;
    } else {
      divisaLbl.innerHTML = `Valor Unidad Tributaria (UT) aplicado: <strong>Bs. ${fmtBs(utBs)}</strong> • Factor Sustraendo PN-R: <strong>83,3334 UT</strong>`;
    }
  }
}

async function guardarComprobanteISLR(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-submit-islr');
  btn.disabled = true;

  const nroComprobante = document.getElementById('m-islr-nro-comprobante').value.trim();
  if (!/^\d{14}$/.test(nroComprobante)) {
    showToast('El N° de Comprobante debe tener exactamente 14 dígitos numéricos (AAAAMM + 8 dígitos).', 'error');
    btn.disabled = false;
    return;
  }

  const email = document.getElementById('m-islr-email').value.trim();
  if (!email) {
    showToast('El Correo Electrónico del Proveedor es obligatorio según la PA SNAT/2026/00093.', 'error');
    btn.disabled = false;
    return;
  }

  const detalles = [];
  document.querySelectorAll('#tbody-modal-islr-items tr.islr-item-row').forEach((tr, idx) => {
    const ndncVal = tr.querySelector('.islr-f-ndnc')?.value?.trim() || '';
    detalles.push({
      libro_compra_id: tr.dataset.libroCompraId ? Number(tr.dataset.libroCompraId) : null,
      nro_operacion: idx + 1,
      fecha_factura: tr.querySelector('.islr-f-fecha').value.trim(),
      nro_factura: tr.querySelector('.islr-f-factura').value.trim(),
      nro_control: tr.querySelector('.islr-f-control').value.trim(),
      nro_nota_debito: ndncVal.startsWith('ND') ? ndncVal : '',
      nro_nota_credito: ndncVal.startsWith('NC') ? ndncVal : '',
      tipo_transaccion: ndncVal || '01-REG',
      codigo_concepto: tr.querySelector('.islr-f-concepto').value,
      descripcion_concepto: tr.querySelector('.islr-f-desc').value.trim(),
      monto_total_bs: parseFloat(tr.querySelector('.islr-f-total').value) || 0,
      base_imponible_bs: parseFloat(tr.querySelector('.islr-f-base').value) || 0,
      pct_base: parseFloat(tr.querySelector('.islr-f-pct-base').value) || 100,
      pct_tarifa: parseFloat(tr.querySelector('.islr-f-pct-tarifa').value) || 2,
      sustraendo_bs: parseFloat(tr.querySelector('.islr-f-sustraendo').value) || 0,
      impuesto_retenido_bs: parseFloat(tr.querySelector('.islr-f-retenido').value) || 0
    });
  });

  const payload = {
    nro_comprobante: nroComprobante,
    periodo: document.getElementById('m-islr-periodo').value,
    fecha_emision: document.getElementById('m-islr-fecha-emision').value.trim(),
    hora_emision: document.getElementById('m-islr-hora-emision').value.trim(),
    proveedor_id: document.getElementById('m-islr-select-proveedor').value || null,
    sujeto_rif: document.getElementById('m-islr-rif').value.trim().toUpperCase(),
    sujeto_razon_social: document.getElementById('m-islr-razon').value.trim(),
    sujeto_tipo_persona: document.getElementById('m-islr-tipo-persona').value,
    sujeto_direccion: document.getElementById('m-islr-direccion').value.trim(),
    sujeto_email: email,
    concepto_general: document.getElementById('m-islr-concepto-general').value.trim(),
    es_multimoneda: document.getElementById('m-islr-multimoneda').checked ? 1 : 0,
    moneda_divisa: document.getElementById('m-islr-moneda').value,
    tasa_bcv: parseFloat(document.getElementById('m-islr-tasa-bcv').value) || 68.50,
    valor_ut_aplicado: Number(islrState.config?.valor_ut_bs || 43.00),
    detalles
  };

  try {
    const res = await fetch('/api/islr/comprobantes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Error al emitir comprobante ISLR');

    showToast(result.message || 'Comprobante ISLR emitido con éxito', 'success');
    closeModal('modal-emitir-islr');

    // Cambiar filtro al período recién emitido y mostrar vista PDF
    const selPer = document.getElementById('islr-periodo-select');
    if (selPer) selPer.value = payload.periodo;
    await loadComprobantesISLR();

    if (result.id) {
      await verComprobanteISLRPDF(result.id);
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function eliminarComprobanteISLR(id) {
  if (!confirm('¿Estás seguro de eliminar este Comprobante de Retención de ISLR?')) return;
  try {
    const res = await fetch(`/api/islr/comprobantes/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error eliminando comprobante');
    showToast('Comprobante ISLR eliminado', 'success');
    await loadComprobantesISLR();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openModalConfigISLR() {
  const c = islrState.config || {};
  document.getElementById('cfg-islr-razon').value = c.agente_razon_social || 'INVERSIONES DG 67, C.A.';
  document.getElementById('cfg-islr-rif').value = c.agente_rif || 'J-50700865-7';
  document.getElementById('cfg-islr-dir').value = c.agente_direccion || 'AV. SUR 11 ENTRE LAS ESQUINAS BOLÍVAR Y MIRANDA, CASA NRO. 112, LOCAL S/N, URB. SAN AGUSTÍN DEL NORTE, CARACAS';
  document.getElementById('cfg-islr-tel').value = c.agente_telefono || '0212-5771122';
  document.getElementById('cfg-islr-email').value = c.agente_email || 'administracion@inversionesdg67.com.ve';
  document.getElementById('cfg-islr-ut').value = Number(c.valor_ut_bs || 43.00).toFixed(2);
  document.getElementById('cfg-islr-factor').value = Number(c.factor_sustraendo || 83.3334).toFixed(4);
  document.getElementById('cfg-islr-aplica-imprenta').checked = Boolean(c.aplica_imprenta_digital);
  document.getElementById('cfg-islr-imp-razon').value = c.imprenta_razon_social || 'UNIÓN CONTABLE GLOBAL SISTEMAS DIGITALES, C.A.';
  document.getElementById('cfg-islr-imp-rif').value = c.imprenta_rif || 'J-50714716-9';
  document.getElementById('cfg-islr-imp-prov').value = c.imprenta_providencia || 'SNAT/2026/00093-AUT-00418';
  document.getElementById('cfg-islr-imp-fecha').value = c.imprenta_fecha_asignacion || '01/01/2026 08:00:00';

  document.getElementById('modal-config-islr').style.display = 'flex';
}

async function guardarConfigISLR(e) {
  e.preventDefault();
  const payload = {
    agente_razon_social: document.getElementById('cfg-islr-razon').value.trim(),
    agente_rif: document.getElementById('cfg-islr-rif').value.trim().toUpperCase(),
    agente_direccion: document.getElementById('cfg-islr-dir').value.trim(),
    agente_telefono: document.getElementById('cfg-islr-tel').value.trim(),
    agente_email: document.getElementById('cfg-islr-email').value.trim(),
    valor_ut_bs: parseFloat(document.getElementById('cfg-islr-ut').value) || 43.00,
    factor_sustraendo: parseFloat(document.getElementById('cfg-islr-factor').value) || 83.3334,
    aplica_imprenta_digital: document.getElementById('cfg-islr-aplica-imprenta').checked ? 1 : 0,
    imprenta_razon_social: document.getElementById('cfg-islr-imp-razon').value.trim(),
    imprenta_rif: document.getElementById('cfg-islr-imp-rif').value.trim().toUpperCase(),
    imprenta_providencia: document.getElementById('cfg-islr-imp-prov').value.trim(),
    imprenta_fecha_asignacion: document.getElementById('cfg-islr-imp-fecha').value.trim()
  };

  try {
    const res = await fetch('/api/islr/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error guardando configuración');
    islrState.config = { ...islrState.config, ...payload };
    const utLbl = document.getElementById('lbl-ut-vigente');
    if (utLbl) utLbl.textContent = Number(payload.valor_ut_bs).toLocaleString('es-VE', { minimumFractionDigits: 2 });
    showToast('Parámetros fiscales ISLR actualizados', 'success');
    closeModal('modal-config-islr');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function exportarXMLSeniatISLR() {
  const periodo = document.getElementById('islr-periodo-select')?.value || '2026-09';
  const targetPeriodo = periodo === 'TODOS' ? '2026-09' : periodo;
  window.open(`/api/islr/export-xml?periodo=${encodeURIComponent(targetPeriodo)}`, '_blank');
}

function exportarExcelISLR() {
  const periodo = document.getElementById('islr-periodo-select')?.value || 'TODOS';
  window.open(`/api/islr/export-excel?periodo=${encodeURIComponent(periodo)}`, '_blank');
}

// ==========================================================================
// PLANTILLA OFICIAL DE IMPRESIÓN PDF: COMPROBANTE DE RETENCIÓN DE ISLR
// Providencia Administrativa SNAT/2026/00093 (G.O. N° 43.484) y Decreto 1.808
// Identidad Corporativa: Unión Contable Global (#0B2447, #3F5B8F, #19A7CE)
// ==========================================================================
async function verComprobanteISLRPDF(id) {
  try {
    const res = await fetch(`/api/islr/comprobantes/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cargar el comprobante');

    const r = data.comprobante;
    const detalles = data.detalles || [];
    const cfg = data.config || islrState.config || {};

    const [yr, mo] = String(r.periodo || '2026-09').split('-');
    const tasa = Number(r.tasa_bcv || 67.40);
    const moneda = r.moneda_divisa || 'USD';

    const labelsTipoPersona = {
      'PJ-D': 'PERSONA JURÍDICA DOMICILIADA (PJ-D)',
      'PN-R': 'PERSONA NATURAL RESIDENTE (PN-R)',
      'PN-NR': 'PERSONA NATURAL NO RESIDENTE (PN-NR)',
      'PJ-ND': 'PERSONA JURÍDICA NO DOMICILIADA (PJ-ND)'
    };

    let totDocBs = 0;
    let totBaseBs = 0;
    let totSustBs = 0;
    let totRetBs = 0;

    const rowsHtml = detalles.map((d, idx) => {
      const docBs = Number(d.monto_total_bs || 0);
      const baseBs = Number(d.base_imponible_bs || 0);
      const sustBs = Number(d.sustraendo_bs || 0);
      const retBs = Number(d.impuesto_retenido_bs || 0);

      totDocBs += docBs;
      totBaseBs += baseBs;
      totSustBs += sustBs;
      totRetBs += retBs;

      const bgRow = idx % 2 === 1 ? '#F3F4F6' : '#FFFFFF';
      const ndNcTrans = [d.nro_nota_debito, d.nro_nota_credito, d.tipo_transaccion || '01-REG'].filter(Boolean).join(' / ');

      return `
        <tr style="background: ${bgRow};">
          <td style="text-align:center; font-weight:800; color:#0B2447;">${d.nro_operacion || (idx + 1)}</td>
          <td style="text-align:center; font-family:monospace; font-weight:700;">${d.fecha_factura}</td>
          <td style="text-align:center; font-family:monospace; font-weight:800; color:#0B2447;">${d.nro_factura}</td>
          <td style="text-align:center; font-family:monospace;">${d.nro_control}</td>
          <td style="text-align:center; font-family:monospace; font-size:8px; color:#6B7280;">${ndNcTrans}</td>
          <td>
            <span style="display:inline-block; background:#0B2447; color:#FFFFFF; font-family:monospace; font-weight:800; font-size:8px; padding:1px 5px; border-radius:3px; margin-right:4px;">${d.codigo_concepto}</span>
            <span style="font-weight:700; color:#0f172a;">${d.descripcion_concepto}</span>
          </td>
          <td style="text-align:right; font-family:monospace; font-weight:700;">Bs. ${fmtBs(docBs)}</td>
          <td style="text-align:right; font-family:monospace; font-weight:800; color:#3F5B8F;">Bs. ${fmtBs(baseBs)}</td>
          <td style="text-align:center; font-family:monospace; font-weight:700;">${Number(d.pct_base || 100).toFixed(0)}%</td>
          <td style="text-align:center; font-family:monospace; font-weight:800; color:#0B2447;">${Number(d.pct_tarifa || 2).toFixed(2)}%</td>
          <td style="text-align:right; font-family:monospace; color:#6B7280;">Bs. ${fmtBs(sustBs)}</td>
          <td style="text-align:right; font-family:monospace; font-weight:900; color:#0B2447; background:#f0f9ff;">Bs. ${fmtBs(retBs)}</td>
        </tr>
      `;
    }).join('');

    const eqDocUsd = tasa > 0 ? (totDocBs / tasa) : 0;
    const eqBaseUsd = tasa > 0 ? (totBaseBs / tasa) : 0;
    const eqRetUsd = tasa > 0 ? (totRetBs / tasa) : 0;

    // Bloque Multimonedas (si aplica o referencial según Excel Retenciones ISLR.xlsx)
    const multimonedaHtml = `
      <div style="margin-top: 8px; margin-bottom: 10px; border: 1.5px solid #19A7CE; border-radius: 5px; background: #F3F4F6; padding: 7px 12px; display: flex; justify-content: space-between; align-items: center; font-size: 8.5px;">
        <div>
          <strong style="color: #0B2447; text-transform: uppercase;">💱 BLOQUE MULTIMONEDAS / REFERENCIA CAMBIARIA BCV (${r.es_multimoneda ? 'FACTURA EMITIDA EN DIVISAS' : ' EQUIVALENTE REFERENCIAL EN DIVISAS'}):</strong>
          <div style="color: #6B7280; margin-top: 1px;">Tasa de Cambio Oficial BCV Aplicada: <strong style="color:#0B2447; font-family:monospace;">Bs. ${fmtBs(tasa)} / ${moneda}</strong> • Unidad Tributaria Vigente: <strong style="color:#0B2447; font-family:monospace;">Bs. ${fmtBs(r.valor_ut_aplicado || 43)}</strong></div>
        </div>
        <div style="display: flex; gap: 16px; text-align: right; font-family: monospace;">
          <div>
            <div style="font-size: 7.5px; color: #6B7280; font-weight: 700;">MONTO TOTAL (${moneda})</div>
            <div style="font-weight: 800; color: #3F5B8F; font-size: 9.5px;">${moneda} ${fmtBs(eqDocUsd)}</div>
          </div>
          <div>
            <div style="font-size: 7.5px; color: #6B7280; font-weight: 700;">BASE IMPONIBLE (${moneda})</div>
            <div style="font-weight: 800; color: #3F5B8F; font-size: 9.5px;">${moneda} ${fmtBs(eqBaseUsd)}</div>
          </div>
          <div style="background: #0B2447; color: #FFFFFF; padding: 3px 9px; border-radius: 4px; border: 1px solid #19A7CE;">
            <div style="font-size: 7px; color: #19A7CE; font-weight: 800;">TOTAL ISLR RETENIDO (${moneda})</div>
            <div style="font-weight: 900; color: #FFFFFF; font-size: 9.5px;">${moneda} ${fmtBs(eqRetUsd)}</div>
          </div>
        </div>
      </div>
    `;

    // Sección Parametrizable de Imprenta Digital Autorizada (PA SNAT/2026/00093)
    const imprentaHtml = cfg.aplica_imprenta_digital ? `
      <div style="margin-top: 8px; border: 1px solid #3F5B8F; background: #F3F4F6; border-radius: 4px; padding: 5px 10px; font-size: 7.8px; color: #0B2447; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong>TRAZABILIDAD DE IMPRENTA DIGITAL AUTORIZADA (PA SNAT/2026/00093):</strong>
          ${cfg.imprenta_razon_social || 'UNIÓN CONTABLE GLOBAL SISTEMAS DIGITALES, C.A.'} • <strong>RIF:</strong> ${cfg.imprenta_rif || 'J-50714716-9'}
        </div>
        <div style="font-family: monospace; font-weight: 800;">
          Providencia: ${cfg.imprenta_providencia || 'SNAT/2026/00093-AUT-00418'} • Asignación: ${cfg.imprenta_fecha_asignacion || `${r.fecha_emision} ${r.hora_emision}`}
        </div>
      </div>
    ` : '';

    const printHtml = `
      <div class="print-preview-container islr-official-sheet" style="max-width: 1040px; padding: 18px 22px; border-top: 5px solid #0B2447;">
        <!-- 1. ENCABEZADO CORPORATIVO UNIÓN CONTABLE GLOBAL & NUMERACIÓN PA SNAT/2026/00093 -->
        <div style="display: grid; grid-template-columns: 220px 1fr 235px; align-items: center; gap: 12px; border-bottom: 2.5px solid #0B2447; padding-bottom: 10px; margin-bottom: 10px;">
          <!-- Firma Asesora -->
          <div style="display: flex; align-items: center; gap: 9px;">
            <img src="LOGOUCG.png" alt="Unión Contable Global" style="height: 44px; object-fit: contain;">
            <div>
              <div style="font-size: 9.5px; font-weight: 900; color: #0B2447; line-height: 1.15;">UNIÓN CONTABLE GLOBAL</div>
              <div style="font-size: 8px; font-weight: 700; color: #3F5B8F;">Asesores Contables</div>
              <div style="font-size: 7.2px; font-style: italic; color: #19A7CE; font-weight: 700;">«Unimos números, contamos éxitos»</div>
            </div>
          </div>

          <!-- Título Central Normativo -->
          <div style="text-align: center;">
            <div style="font-size: 8px; font-weight: 800; color: #6B7280; letter-spacing: 0.05em;">
              REPÚBLICA BOLIVARIANA DE VENEZUELA • SERVICIO NACIONAL INTEGRADO DE ADMINISTRACIÓN ADUANERA Y TRIBUTARIA (SENIAT)
            </div>
            <div style="font-size: 13px; font-weight: 900; color: #0B2447; margin: 2px 0; letter-spacing: 0.01em;">
              COMPROBANTE DE RETENCIÓN DE IMPUESTO SOBRE LA RENTA (I.S.L.R.)
            </div>
            <div style="font-size: 8px; font-weight: 700; color: #3F5B8F;">
              Providencia Administrativa SNAT/2026/00093 (Gaceta Oficial N° 43.484) • Decreto N° 1.808 de fecha 23/04/1997 (G.O. N° 36.203)
            </div>
          </div>

          <!-- Caja de Numeración 14 Dígitos y Sello de Tiempo Exacto -->
          <div style="border: 2px solid #0B2447; border-left: 5px solid #19A7CE; border-radius: 5px; background: #F3F4F6; padding: 6px 10px; text-align: right;">
            <div style="font-size: 7.5px; font-weight: 800; color: #3F5B8F; text-transform: uppercase;">N° DE COMPROBANTE (14 DÍGITOS)</div>
            <div style="font-size: 13.5px; font-weight: 900; font-family: monospace; color: #0B2447; letter-spacing: 0.04em;">${r.nro_comprobante}</div>
            <div style="display: flex; justify-content: space-between; font-size: 7.8px; color: #0f172a; border-top: 1px solid #cbd5e1; margin-top: 3px; padding-top: 3px;">
              <span><strong>PERÍODO:</strong> ${yr} - ${mo}</span>
              <span><strong>EMISIÓN:</strong> ${r.fecha_emision} ${r.hora_emision || '12:00:00'}</span>
            </div>
          </div>
        </div>

        <!-- 2. DATOS DEL AGENTE DE RETENCIÓN Y DEL SUJETO RETENIDO -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
          <!-- Agente de Retención (Cliente Emisor) -->
          <div style="border: 1px solid #3F5B8F; border-radius: 4px; overflow: hidden; background: #FFFFFF;">
            <div style="background: #0B2447; color: #FFFFFF; font-size: 8px; font-weight: 800; padding: 4px 8px; border-bottom: 2px solid #19A7CE; text-transform: uppercase;">
              1. DATOS DEL AGENTE DE RETENCIÓN (CONTRIBUYENTE EMISOR)
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 8.3px;">
              <tbody>
                <tr>
                  <td style="padding: 4px 7px; border-bottom: 1px solid #e2e8f0; width: 28%; color: #6B7280; font-weight: 700;">RAZÓN SOCIAL:</td>
                  <td style="padding: 4px 7px; border-bottom: 1px solid #e2e8f0; font-weight: 900; color: #0B2447;" colspan="3">${cfg.agente_razon_social || 'INVERSIONES DG 67, C.A.'}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 7px; border-bottom: 1px solid #e2e8f0; color: #6B7280; font-weight: 700;">N° DE RIF:</td>
                  <td style="padding: 4px 7px; border-bottom: 1px solid #e2e8f0; font-family: monospace; font-weight: 900; color: #0B2447;">${cfg.agente_rif || 'J-50700865-7'}</td>
                  <td style="padding: 4px 7px; border-bottom: 1px solid #e2e8f0; color: #6B7280; font-weight: 700;">TELÉFONO:</td>
                  <td style="padding: 4px 7px; border-bottom: 1px solid #e2e8f0; font-family: monospace;">${cfg.agente_telefono || '0212-5771122'}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 7px; border-bottom: 1px solid #e2e8f0; color: #6B7280; font-weight: 700;">DIRECCIÓN FISCAL:</td>
                  <td style="padding: 4px 7px; border-bottom: 1px solid #e2e8f0; font-size: 7.8px;" colspan="3">${cfg.agente_direccion || 'AV. SUR 11 ENTRE LAS ESQUINAS BOLÍVAR Y MIRANDA, CASA NRO. 112, LOCAL S/N, SAN AGUSTÍN DEL NORTE, CARACAS'}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 7px; color: #6B7280; font-weight: 700;">CORREO EMISOR:</td>
                  <td style="padding: 4px 7px; font-family: monospace; color: #3F5B8F; font-weight: 700;" colspan="3">${cfg.agente_email || 'administracion@inversionesdg67.com.ve'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Sujeto Retenido (Proveedor / Beneficiario) -->
          <div style="border: 1px solid #3F5B8F; border-radius: 4px; overflow: hidden; background: #FFFFFF;">
            <div style="background: #3F5B8F; color: #FFFFFF; font-size: 8px; font-weight: 800; padding: 4px 8px; border-bottom: 2px solid #19A7CE; text-transform: uppercase; display: flex; justify-content: space-between;">
              <span>2. DATOS DEL SUJETO RETENIDO (PROVEEDOR / BENEFICIARIO)</span>
              <span style="color: #19A7CE;">CÓD. RETENCIÓN: ${r.codigo_concepto_principal || '055'}</span>
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 8.3px;">
              <tbody>
                <tr>
                  <td style="padding: 4px 7px; border-bottom: 1px solid #e2e8f0; width: 28%; color: #6B7280; font-weight: 700;">RAZÓN SOCIAL:</td>
                  <td style="padding: 4px 7px; border-bottom: 1px solid #e2e8f0; font-weight: 900; color: #0B2447;" colspan="3">${r.sujeto_razon_social}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 7px; border-bottom: 1px solid #e2e8f0; color: #6B7280; font-weight: 700;">N° DE RIF:</td>
                  <td style="padding: 4px 7px; border-bottom: 1px solid #e2e8f0; font-family: monospace; font-weight: 900; color: #0B2447;">${r.sujeto_rif}</td>
                  <td style="padding: 4px 7px; border-bottom: 1px solid #e2e8f0; color: #6B7280; font-weight: 700;">TIPO PERSONA:</td>
                  <td style="padding: 4px 7px; border-bottom: 1px solid #e2e8f0; font-weight: 800; color: #3F5B8F; font-size: 7.8px;">${labelsTipoPersona[r.sujeto_tipo_persona] || r.sujeto_tipo_persona}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 7px; border-bottom: 1px solid #e2e8f0; color: #6B7280; font-weight: 700;">DIRECCIÓN FISCAL:</td>
                  <td style="padding: 4px 7px; border-bottom: 1px solid #e2e8f0; font-size: 7.8px;" colspan="3">${r.sujeto_direccion}</td>
                </tr>
                <tr style="background: #f0f9ff;">
                  <td style="padding: 4px 7px; color: #0B2447; font-weight: 800;">CORREO (PA 00093):</td>
                  <td style="padding: 4px 7px; font-family: monospace; font-weight: 800; color: #0B2447;">${r.sujeto_email}</td>
                  <td style="padding: 4px 7px; color: #6B7280; font-weight: 700;">CONCEPTO:</td>
                  <td style="padding: 4px 7px; font-weight: 800; color: #0B2447; font-size: 7.8px;">${r.concepto_general || 'ASESORIA ADMINISTRATIVA'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 3. TABLA DE DETALLE DE LA OPERACIÓN (12 COLUMNAS REGLAMENTARIAS) -->
        <table class="print-preview-table" style="width: 100%; border-collapse: collapse; font-size: 8.3px; margin-bottom: 6px;">
          <thead>
            <tr>
              <th style="background:#0B2447; color:#FFFFFF; border-color:#3F5B8F; width:30px;">N° OP</th>
              <th style="background:#0B2447; color:#FFFFFF; border-color:#3F5B8F; width:64px;">FECHA DOC.</th>
              <th style="background:#0B2447; color:#FFFFFF; border-color:#3F5B8F; width:68px;">N° FACTURA</th>
              <th style="background:#0B2447; color:#FFFFFF; border-color:#3F5B8F; width:76px;">N° CONTROL</th>
              <th style="background:#0B2447; color:#FFFFFF; border-color:#3F5B8F; width:64px;">N.D. / N.C. / TRANS.</th>
              <th style="background:#0B2447; color:#FFFFFF; border-color:#3F5B8F; text-align:left; padding-left:6px;">CÓDIGO CONCEPTO SENIAT Y DESCRIPCIÓN DE LA OPERACIÓN</th>
              <th style="background:#3F5B8F; color:#FFFFFF; border-color:#3F5B8F; width:92px; text-align:right;">MONTO TOTAL DOC. (BS)</th>
              <th style="background:#3F5B8F; color:#FFFFFF; border-color:#3F5B8F; width:92px; text-align:right;">BASE IMPONIBLE OBJETO RET. (BS)</th>
              <th style="background:#3F5B8F; color:#FFFFFF; border-color:#3F5B8F; width:42px;">% BASE</th>
              <th style="background:#3F5B8F; color:#FFFFFF; border-color:#3F5B8F; width:46px;">% TARIFA</th>
              <th style="background:#3F5B8F; color:#FFFFFF; border-color:#3F5B8F; width:76px; text-align:right;">SUSTRAENDO (BS)</th>
              <th style="background:#0B2447; color:#19A7CE; border-color:#0B2447; width:96px; text-align:right;">IMPUESTO ISLR RETENIDO (BS)</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr style="background: #F3F4F6; font-weight: 900; border-top: 2px solid #0B2447;">
              <td colspan="6" style="text-align: right; color: #0B2447; font-size: 8.5px; padding: 5px 8px;">TOTALES DEL COMPROBANTE DE RETENCIÓN ISLR (EN BOLÍVARES):</td>
              <td style="text-align: right; font-family: monospace; color: #0B2447;">Bs. ${fmtBs(totDocBs)}</td>
              <td style="text-align: right; font-family: monospace; color: #3F5B8F;">Bs. ${fmtBs(totBaseBs)}</td>
              <td colspan="2" style="text-align: center; color: #6B7280;">-</td>
              <td style="text-align: right; font-family: monospace; color: #6B7280;">Bs. ${fmtBs(totSustBs)}</td>
              <td style="text-align: right; font-family: monospace; font-size: 9.5px; background: #0B2447; color: #FFFFFF;">Bs. ${fmtBs(totRetBs)}</td>
            </tr>
          </tfoot>
        </table>

        <!-- 4. BLOQUE MULTIMONEDAS (TASA BCV Y EQUIVALENTES EN DIVISAS) -->
        ${multimonedaHtml}

        <!-- 5. PIE DE PÁGINA LEGAL OBLIGATORIO Y TRAZABILIDAD DE IMPRENTA DIGITAL -->
        <div style="border: 1px solid #cbd5e1; border-left: 4px solid #0B2447; background: #FFFFFF; padding: 6px 10px; border-radius: 4px; font-size: 8px; color: #0B2447; text-align: justify; line-height: 1.35;">
          <strong>LEYENDA LEGAL OBLIGATORIA:</strong> <em>"Comprobante emitido conforme a lo establecido en la Providencia Administrativa SNAT/2026/00093 (Gaceta Oficial N° 43.484) y el Decreto 1.808 en materia de Retenciones de ISLR."</em> El monto retenido será enterado oportunamente ante el Tesoro Nacional a nombre del Sujeto Retenido.
        </div>

        ${imprentaHtml}

        <!-- 6. FIRMAS Y SELLOS (AGENTE DE RETENCIÓN Y SUJETO RETENIDO) -->
        <div class="print-footer-signatures seniat-3-signatures" style="margin-top: 26px;">
          <div>
            <div class="sig-line" style="border-top-color: #0B2447; color: #0B2447;">FIRMA Y SELLO AGENTE DE RETENCIÓN</div>
            <div style="font-size: 8px; color: #3F5B8F; font-weight: 700; margin-top: 2px;">${cfg.agente_razon_social || 'INVERSIONES DG 67, C.A.'} • RIF: ${cfg.agente_rif || 'J-50700865-7'}</div>
            <div style="font-size: 7.5px; color: #6B7280;">Fecha de Entrega: ${r.fecha_emision}</div>
          </div>
          <div>
            <div class="sig-line" style="border-top-color: #3F5B8F; color: #3F5B8F;">REVISIÓN Y ASESORÍA TRIBUTARIA</div>
            <div style="font-size: 8px; color: #0B2447; font-weight: 800; margin-top: 2px;">UNIÓN CONTABLE GLOBAL, ASESORES CONTABLES</div>
            <div style="font-size: 7.5px; color: #19A7CE; font-weight: 700;">«Unimos números, contamos éxitos»</div>
          </div>
          <div>
            <div class="sig-line" style="border-top-color: #0B2447; color: #0B2447;">FIRMA Y SELLO SUJETO RETENIDO (RECIBÍ CONFORME)</div>
            <div style="font-size: 8px; color: #3F5B8F; font-weight: 700; margin-top: 2px;">${r.sujeto_razon_social} • RIF: ${r.sujeto_rif}</div>
            <div style="font-size: 7.5px; color: #6B7280;">Notificado a: ${r.sujeto_email}</div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('modal-print-title').textContent = `Comprobante Oficial de Retención ISLR N° ${r.nro_comprobante} (PA SNAT/2026/00093)`;
    document.getElementById('modal-print-body').innerHTML = printHtml;
    document.getElementById('modal-impresion-fiscal').style.display = 'flex';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// 15. MÓDULO DE TASAS OFICIALES BCV DE CIERRE MENSUAL Y REVALORIZACIÓN BIMONETARIA
// ============================================================================
const NOMBRES_MESES_CIERRE = {
  '2025-12': 'Diciembre 2025 (Inventario Inicial Base)',
  '2026-01': 'Enero 2026 (Mes Declarado)',
  '2026-02': 'Febrero 2026 (Mes Declarado)',
  '2026-03': 'Marzo 2026 (Mes Declarado)',
  '2026-04': 'Abril 2026 (Mes Declarado)',
  '2026-05': 'Mayo 2026 (Mes Declarado)',
  '2026-06': 'Junio 2026 (Mes Declarado)',
  '2026-07': 'Julio 2026 (Mes Declarado)',
  '2026-08': 'Agosto 2026 (Mes Declarado)',
  '2026-09': 'Septiembre 2026 (Mes Declarado)',
  '2026-10': 'Octubre 2026 (Mes Activo en Curso)'
};

async function openModalTasasCierreBCV() {
  const modal = document.getElementById('modal-tasas-bcv');
  const tbody = document.getElementById('tbody-tasas-bcv-cierre');
  if (!modal || !tbody) return;

  modal.style.display = 'flex';
  tbody.innerHTML = `<tr><td colspan="5" class="text-center">Consultando tasas oficiales BCV de cierre mensual...</td></tr>`;

  try {
    const res = await fetch('/api/tasas-bcv');
    const data = await res.json();
    const tasas = Array.isArray(data.tasas) ? data.tasas : [];
    state.tasasBcvPeriodo = tasas;
    state.metodoKardex = data.metodo_valoracion_kardex || 'CPP';

    const selMetodo = document.getElementById('cfg-metodo-kardex-global');
    if (selMetodo) selMetodo.value = state.metodoKardex;

    tbody.innerHTML = tasas.map((t, idx) => {
      const label = NOMBRES_MESES_CIERRE[t.periodo] || t.periodo;
      const isOct = t.periodo === '2026-10';
      const numTasa = Number(t.tasa_bcv || 0);
      return `
        <tr data-periodo="${t.periodo}" style="${isOct ? 'background:#eff6ff;' : ''}">
          <td class="font-mono font-bold" style="color:#0B2447;">${t.periodo}</td>
          <td style="font-weight:700;">${label}</td>
          <td>
            <input type="date" class="form-input tasa-cierre-fecha font-mono" value="${t.fecha_cierre || (t.periodo + '-28')}" style="padding:4px 8px; font-size:0.8rem;">
          </td>
          <td>
            <input type="number" step="any" min="0.0001" class="form-input tasa-cierre-valor font-mono font-bold text-right" value="${numTasa > 0 ? numTasa.toFixed(4) : ''}" style="padding:4px 8px; font-size:0.86rem; color:#0B2447; border-color:#19A7CE;" required placeholder="0.0000">
          </td>
          <td style="font-size:0.75rem; color:#047857; font-weight:700;">
            ✅ Multiplica USD×Tasa en Kardex y divide Bs÷Tasa en Libros IVA
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="color:#dc2626;">Error cargando tasas BCV: ${err.message}</td></tr>`;
  }
}

async function guardarYRevalorizarTasasBCV(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-revalorizar-bcv');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Revalorizando Kardex y Libros Fiscales...';
  }

  try {
    const rows = Array.from(document.querySelectorAll('#tbody-tasas-bcv-cierre tr[data-periodo]'));
    const tasas = rows.map(tr => ({
      periodo: tr.dataset.periodo,
      fecha_cierre: tr.querySelector('.tasa-cierre-fecha')?.value || `${tr.dataset.periodo}-28`,
      tasa_bcv: parseFloat(tr.querySelector('.tasa-cierre-valor')?.value) || 0,
      moneda: 'USD'
    }));

    for (const t of tasas) {
      if (!t.tasa_bcv || t.tasa_bcv <= 0) {
        throw new Error(`Por favor ingrese una tasa válida mayor a cero para el período ${t.periodo}`);
      }
    }

    const metodoVal = document.getElementById('cfg-metodo-kardex-global')?.value || 'CPP';

    const res = await fetch('/api/tasas-bcv/revalorizar-cierre', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tasas,
        metodo_valoracion_kardex: metodoVal
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al revalorizar cierres mensuales');

    showToast(data.message || 'Cierres mensuales revalorizados exitosamente con tasa BCV!', 'success');
    closeModal('modal-tasas-bcv');

    await loadTasasBcvPeriodo();
    await Promise.all([
      loadDashboard(),
      loadProducts(),
      loadMonthlyReport(),
      loadLibroCompras(),
      loadLibroVentas()
    ]);
    if (currentKardexData?.producto?.codigo) {
      await executeKardexSearch(currentKardexData.producto.codigo);
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💱 Guardar Tasas BCV y Revalorizar Todos los Cierres Mensuales (Bs. ↔ USD)';
    }
  }
}

// ============================================================================
// 16. MÓDULO DE CONFIGURACIÓN & ACTUALIZACIÓN DIARIA DE TASA OFICIAL BCV
// ============================================================================

async function loadConfiguracionTab() {
  const tbody = document.getElementById('tbody-config-tasas-bcv');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding: 24px;">Consultando tasas oficiales BCV de cierre mensual...</td></tr>`;

  try {
    const res = await fetch('/api/tasas-bcv');
    const data = await res.json();
    const tasas = Array.isArray(data.tasas) ? data.tasas : [];
    state.tasasBcv = tasas;
    state.metodoValoracionKardex = data.metodo_valoracion_kardex || 'CPP';

    const selMetodo = document.getElementById('cfg-metodo-kardex-tab');
    if (selMetodo) selMetodo.value = state.metodoValoracionKardex;

    if (tasas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding: 20px;">No hay tasas configuradas.</td></tr>`;
      return;
    }

    tbody.innerHTML = tasas.map(t => {
      const label = NOMBRES_MESES_CIERRE[t.periodo] || t.periodo;
      const isOct = t.periodo === '2026-10';
      const numTasa = Number(t.tasa_bcv || 0);
      return `
        <tr data-periodo="${t.periodo}" style="${isOct ? 'background: #eff6ff; font-weight: 600;' : ''}">
          <td class="font-mono font-bold" style="color:#0B2447; padding: 10px 14px;">${t.periodo}</td>
          <td style="padding: 10px 14px;">
            <div style="font-weight: 700; color: #0B2447;">${label}</div>
            <div style="font-size: 0.72rem; color: #64748b;">${t.fuente || 'BCV Oficial Cierre Mensual'}</div>
          </td>
          <td style="padding: 10px 14px;">
            <input type="date" class="form-input config-tasa-fecha font-mono" value="${t.fecha_cierre || (t.periodo + '-28')}" style="padding: 5px 8px; font-size: 0.8rem; width: 100%;">
          </td>
          <td style="padding: 10px 14px;">
            <div style="display: flex; align-items: center; justify-content: flex-end; gap: 4px;">
              <span style="font-size: 0.76rem; font-weight: 800; color: #64748b;">Bs.</span>
              <input type="number" step="any" min="0.0001" class="form-input config-tasa-valor font-mono font-bold text-right" value="${numTasa > 0 ? numTasa.toFixed(4) : ''}" style="padding: 5px 8px; font-size: 0.88rem; color:#0B2447; border-color:#19A7CE; width: 135px;" required placeholder="0.0000">
            </div>
          </td>
          <td style="padding: 10px 14px; font-size: 0.75rem; color: #047857; font-weight: 700;">
            ✅ Kardex USD×Tasa | Libros IVA Bs÷Tasa
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="color: #dc2626; padding: 20px;">Error al cargar tasas de configuración: ${err.message}</td></tr>`;
  }
}

async function guardarTasasBcvConfig(e) {
  if (e && e.preventDefault) e.preventDefault();
  const btn = document.getElementById('btn-save-config-tasas');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Revalorizando Kardex y Libros Fiscales...';
  }

  try {
    const rows = Array.from(document.querySelectorAll('#tbody-config-tasas-bcv tr[data-periodo]'));
    const tasas = rows.map(tr => ({
      periodo: tr.dataset.periodo,
      fecha_cierre: tr.querySelector('.config-tasa-fecha')?.value || `${tr.dataset.periodo}-28`,
      tasa_bcv: parseFloat(tr.querySelector('.config-tasa-valor')?.value) || 0,
      moneda: 'USD'
    }));

    for (const t of tasas) {
      if (!t.tasa_bcv || t.tasa_bcv <= 0) {
        throw new Error(`Por favor ingrese una tasa válida mayor a 0 para el período ${t.periodo}`);
      }
    }

    const metodoVal = document.getElementById('cfg-metodo-kardex-tab')?.value || 'CPP';

    const res = await fetch('/api/tasas-bcv/revalorizar-cierre', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tasas,
        metodo_valoracion_kardex: metodoVal
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al revalorizar cierres mensuales');

    showToast(data.message || 'Tasas BCV guardadas y cierres mensuales revalorizados con éxito!', 'success');

    await loadTasasBcvPeriodo();
    await Promise.all([
      loadDashboard(),
      loadProducts(),
      loadMonthlyReport(),
      loadLibroCompras(),
      loadLibroVentas()
    ]);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💾 Guardar Tasas BCV y Revalorizar Inventario y Libros Fiscales (Bs. ↔ USD)';
    }
  }
}

async function guardarTasaBcvDiaria(e) {
  if (e && e.preventDefault) e.preventDefault();
  const inputTasa = document.getElementById('daily-bcv-input');
  const inputFecha = document.getElementById('daily-bcv-fecha-input');
  const btn = document.getElementById('btn-save-daily-bcv');

  const tasaVal = parseFloat(inputTasa?.value);
  if (!tasaVal || tasaVal <= 0) {
    showToast('Por favor ingrese un monto válido para la Tasa Oficial BCV.', 'error');
    return;
  }

  const fechaVal = inputFecha?.value || new Date().toISOString().split('T')[0];

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>Guardando...</span>`;
  }

  try {
    const res = await fetch('/api/tasas-bcv/diaria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tasa_bcv: tasaVal,
        fecha: fechaVal,
        moneda: 'USD'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar la tasa BCV diaria');

    showToast(data.mensaje || `Tasa BCV del día guardada: Bs. ${tasaVal.toFixed(4)}`, 'success');

    // Actualizar datos de tasa en el sistema
    await loadTasasBcvPeriodo();

    // Sincronizar campos de entrada o salida si coinciden con la fecha
    const entFecha = document.getElementById('ent-fecha')?.value;
    const salFecha = document.getElementById('sal-fecha')?.value;
    if (entFecha === fechaVal) {
      const entTasa = document.getElementById('ent-tasa');
      if (entTasa) {
        entTasa.value = tasaVal.toFixed(4);
        calculateEntryTotals();
      }
    }
    if (salFecha === fechaVal) {
      const salTasa = document.getElementById('sal-tasa');
      if (salTasa) {
        salTasa.value = tasaVal.toFixed(4);
        calculateExitTotals();
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
        <span>Actualizar Tasa Hoy</span>
      `;
    }
  }
}




