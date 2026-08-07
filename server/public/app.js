let token = localStorage.getItem('cerebro_token') || '';
let currentTab = 'orders';

const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['x-session-token'] = token;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401 && path !== '/api/v1/admin/login') {
    token = '';
    localStorage.removeItem('cerebro_token');
    showLogin();
    throw new Error('Sesión expirada');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error ' + res.status);
  return data;
}

function showLogin() {
  $('app-view').style.display = 'none';
  $('login-view').style.display = 'flex';
}
function showApp() {
  $('login-view').style.display = 'none';
  $('app-view').style.display = 'block';
  refreshAll();
}

function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
function fmtAmount(n) {
  const num = Number(n);
  if (isNaN(num)) return '—';
  if (num === 0) return '0';
  return num.toPrecision(8).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
function speedPill(s) { return `<span class="speed-pill speed-${esc(s)}">${esc(s)}</span>`; }
function statusPill(s) { return `<span class="status-pill status-${esc(s)}">${esc(s)}</span>`; }
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('es', { dateStyle: 'short', timeStyle: 'medium' });
}

function orderCard(o, mode) {
  const isPending = mode === 'pending';
  const isApproved = mode === 'approved';
  const actions = [];
  if (isPending) {
    actions.push(`<button class="btn btn-primary" data-action="approve" data-id="${esc(o.id)}">✅ Aceptar</button>`);
    actions.push(`<button class="btn btn-danger" data-action="reject" data-id="${esc(o.id)}">❌ Rechazar</button>`);
  }
  if (isApproved) {
    actions.push(`
      <div class="tx-box">
        <input class="input" placeholder="Hash envío al usuario (opcional)" id="txp-${esc(o.id)}" style="min-width:240px">
        <input class="input" placeholder="Hash recepción del usuario (opcional)" id="txr-${esc(o.id)}" style="min-width:240px">
        <button class="btn btn-primary" data-action="complete" data-id="${esc(o.id)}">✔ Marcar completada</button>
      </div>`);
  }
  return `
  <div class="card">
    <div class="card-header">
      <div>
        <span class="card-title">${esc(o.fromSymbol)} ${fmtAmount(o.fromAmount)} → ${esc(o.toSymbol)}</span>
        <div class="card-sub">${fmtDate(o.createdAt)} · ${speedPill(o.speed)} ${statusPill(o.status)}</div>
      </div>
      <span class="badge">${esc(o.id).slice(0, 12)}…</span>
    </div>
    <div class="detail-grid">
      <div><span class="k">Monto a enviar</span><span class="v">${fmtAmount(o.fromAmount)} ${esc(o.fromSymbol)}</span></div>
      <div><span class="k">Moneda a recibir</span><span class="v">${esc(o.toSymbol)}${o.toNetwork ? ' (' + esc(o.toNetwork) + ')' : ''}</span></div>
      <div><span class="k">Dirección destino del usuario</span><span class="v">${esc(o.toAddress)}${o.toExtraId ? ' · ' + esc(o.toExtraId) : ''}</span></div>
      <div><span class="k">Velocidad</span><span class="v">${esc(o.speed)}</span></div>
      ${o.userLabel ? `<div><span class="k">Usuario</span><span class="v">${esc(o.userLabel)}</span></div>` : ''}
      ${o.commissionUsd ? `<div><span class="k">Comisión aplicada</span><span class="v">$${o.commissionUsd.toFixed(2)} USD</span></div>` : ''}
      ${o.netToAmount ? `<div><span class="k">Monto neto a entregar</span><span class="v">${fmtAmount(o.netToAmount)} ${esc(o.toSymbol)}</span></div>` : ''}
      ${o.adminNote ? `<div><span class="k">Nota</span><span class="v">${esc(o.adminNote)}</span></div>` : ''}
      ${o.completedAt ? `<div><span class="k">Completada</span><span class="v">${fmtDate(o.completedAt)}</span></div>` : ''}
    </div>
    <div class="actions">${actions.join('')}</div>
  </div>`;
}

async function refreshOrders() {
  const [pending, approved, recent] = await Promise.all([
    api('/api/v1/report/dashboard'),
    api('/api/v1/orders?status=approved'),
    api('/api/v1/orders'),
  ]);
  $('pending-count').textContent = pending.summary.pending || 0;
  $('pending-list').innerHTML = (pending.pending && pending.pending.length)
    ? pending.pending.map((o) => orderCard(o, 'pending')).join('')
    : '<div class="empty">No hay órdenes pendientes ✅</div>';
  $('approved-list').innerHTML = (approved && approved.length)
    ? approved.map((o) => orderCard(o, 'approved')).join('')
    : '<div class="empty">No hay órdenes aprobadas</div>';
  const hist = (recent || []).filter((o) => !['pending', 'approved'].includes(o.status));
  $('history-list').innerHTML = hist.length
    ? hist.map((o) => orderCard(o, 'history')).join('')
    : '<div class="empty">Sin historial todavía</div>';
}

async function refreshReserves() {
  const reserves = await api('/api/v1/reserves');
  if (!reserves.length) {
    $('reserve-list').innerHTML = '<div class="empty">No hay reservas configuradas.</div>';
    return;
  }
  const rows = reserves.map((r) => `
    <tr>
      <td><b>${esc(r.symbol)}</b>${r.network ? ' · ' + esc(r.network) : ''}</td>
      <td>${esc(r.address)}</td>
      <td>${r.receiveAddress ? esc(r.receiveAddress) : '—'}</td>
      <td>${r.payoutAddress ? esc(r.payoutAddress) : '—'}</td>
      <td>${r.enabled ? '✅' : '❌'}</td>
      <td><button class="btn btn-ghost btn-sm" data-action="del-reserve" data-symbol="${esc(r.symbol)}">Eliminar</button></td>
    </tr>`).join('');
  $('reserve-list').innerHTML = `<table class="table"><thead><tr>
    <th>Moneda</th><th>Reserva (envío)</th><th>Recepción</th><th>Pago</th><th>Activa</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

async function refreshReports() {
  const params = new URLSearchParams();
  const sym = $('f-symbol').value.trim().toUpperCase();
  const from = $('f-from').value;
  const to = $('f-to').value;
  if (sym) params.set('symbol', sym);
  if (from) params.set('from', new Date(from + 'T00:00:00').toISOString());
  if (to) params.set('to', new Date(to + 'T23:59:59').toISOString());
  const q = params.toString();
  const rep = await api('/api/v1/report/commissions' + (q ? '?' + q : ''));
  $('report-totals').innerHTML = `
    <div class="total-card"><div class="k">Órdenes</div><div class="v">${rep.totals.count}</div></div>
    <div class="total-card"><div class="k">Total comisiones</div><div class="v">$${rep.totals.totalCommissionUsd.toFixed(2)}</div></div>
    <div class="total-card"><div class="k">Ahorro fees proveedor</div><div class="v">$${rep.totals.totalProviderFeeSavedUsd.toFixed(2)}</div></div>`;
  if (!rep.events.length) {
    $('report-list').innerHTML = '<div class="empty">Sin comisiones registradas</div>';
    return;
  }
  const rows = rep.events.map((e) => `
    <tr>
      <td>${esc(e.fromSymbol)}→${esc(e.toSymbol)}</td>
      <td>${speedPill(e.speed)}</td>
      <td>$${e.commissionUsd.toFixed(2)}</td>
      <td>${fmtAmount(e.commissionAmount)} ${esc(e.commissionSymbol)}</td>
      <td>${fmtAmount(e.grossFromAmount)}</td>
      <td>${fmtAmount(e.netToAmount)}</td>
      <td>${fmtDate(e.createdAt)}</td>
    </tr>`).join('');
  $('report-list').innerHTML = `<table class="table"><thead><tr>
    <th>Par</th><th>Velocidad</th><th>Comisión USD</th><th>Comisión cripto</th>
    <th>Bruto origen</th><th>Neto entregado</th><th>Fecha</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

function refreshAll() {
  refreshOrders().catch((e) => toast(e.message, true));
  refreshReserves().catch((e) => toast(e.message, true));
  refreshReports().catch((e) => toast(e.message, true));
}

document.addEventListener('DOMContentLoaded', () => {
  $('login-btn').addEventListener('click', async () => {
    const password = $('login-pass').value;
    try {
      const res = await api('/api/v1/admin/login', {
        method: 'POST', body: JSON.stringify({ password }),
      });
      token = res.token;
      localStorage.setItem('cerebro_token', token);
      $('login-msg').textContent = '';
      showApp();
    } catch (e) {
      $('login-msg').textContent = e.message;
      $('login-msg').className = 'msg error';
    }
  });
  $('login-pass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('login-btn').click();
  });
  $('logout-btn').addEventListener('click', () => {
    token = '';
    localStorage.removeItem('cerebro_token');
    showLogin();
  });

  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      currentTab = t.dataset.tab;
      $('tab-' + currentTab).classList.add('active');
      if (currentTab === 'orders' || currentTab === 'approved' || currentTab === 'history') refreshOrders();
      if (currentTab === 'reports') refreshReports();
      if (currentTab === 'reserves') refreshReserves();
    });
  });

  // Acciones de botones (delegación de eventos)
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id;
    try {
      if (action === 'approve') {
        const r = await api(`/api/v1/orders/${id}/approve`, { method: 'POST', body: '{}' });
        toast(`Orden aprobada. Entrega ${fmtAmount(r.netToAmount)} ${r.toSymbol} al usuario.`);
        refreshOrders();
      } else if (action === 'reject') {
        if (!confirm('¿Rechazar esta orden? El usuario verá el mensaje del mínimo oficial.')) return;
        await api(`/api/v1/orders/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason: 'Rechazada por el admin' }) });
        toast('Orden rechazada.');
        refreshOrders();
      } else if (action === 'complete') {
        const txp = $(`txp-${id}`)?.value || '';
        const txr = $(`txr-${id}`)?.value || '';
        const r = await api(`/api/v1/orders/${id}/complete`, {
          method: 'POST', body: JSON.stringify({ txHashPayout: txp, txHashRefund: txr }),
        });
        toast(`Orden completada. Comisión registrada en categoría separada.`);
        refreshOrders();
      } else if (action === 'del-reserve') {
        const sym = el.dataset.symbol;
        if (!confirm(`¿Eliminar reserva de ${sym}?`)) return;
        await api(`/api/v1/reserves/${sym}`, { method: 'DELETE' });
        refreshReserves();
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('reserve-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/v1/reserves', {
        method: 'POST',
        body: JSON.stringify({
          symbol: $('r-symbol').value.trim().toUpperCase(),
          network: $('r-network').value.trim(),
          address: $('r-address').value.trim(),
          receiveAddress: $('r-receive').value.trim(),
          payoutAddress: $('r-payout').value.trim(),
        }),
      });
      $('reserve-form').reset();
      toast('Reserva guardada');
      refreshReserves();
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('f-apply').addEventListener('click', refreshReports);
  $('f-export').addEventListener('click', () => {
    const params = new URLSearchParams();
    const sym = $('f-symbol').value.trim().toUpperCase();
    const from = $('f-from').value;
    const to = $('f-to').value;
    if (sym) params.set('symbol', sym);
    if (from) params.set('from', new Date(from + 'T00:00:00').toISOString());
    if (to) params.set('to', new Date(to + 'T23:59:59').toISOString());
    const q = params.toString();
    window.location.href = '/api/v1/report/export' + (q ? '?' + q : '');
  });

  if (token) {
    showApp();
  } else {
    showLogin();
  }
});
