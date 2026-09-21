/* ---------- Painel do administrador ---------- */

let token = localStorage.getItem('mcb_admin_token') || '';
let currentStatus = 'review';

const money = (v) => Number(v).toLocaleString('pt-MZ') + ' MT';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function authHeaders(extra = {}) {
  return { 'x-admin-token': token, ...extra };
}

async function api(url, opts = {}) {
  const o = { ...opts, headers: { ...(opts.headers || {}), ...authHeaders() } };
  const r = await fetch(url, o);
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.error) || `Erro (${r.status})`);
  return data;
}

/* ---------- Sessao ---------- */

function showView(view) {
  document.getElementById('dashView').classList.toggle('visible', view === 'dash');
}

async function checkSession() {
  if (!token) { location.href = '/entrar'; return; }
  try {
    const s = await api('/api/admin/session');
    document.getElementById('whoAmI').textContent = '👤 ' + s.username + (s.email ? ' · ' + s.email : '');
    showView('dash');
    await refresh();
  } catch (e) {
    token = localStorage.removeItem('mcb_admin_token') || '';
    location.href = '/entrar';
  }
}

function logout() {
  fetch('/api/admin/logout', { method: 'POST', headers: { 'x-admin-token': token } }).catch(() => {});
  token = '';
  localStorage.removeItem('mcb_admin_token');
  location.href = '/entrar';
}

/* ---------- Dashboard ---------- */

async function refresh() {
  await loadStats();
  await loadList();
  loadSellers();
  loadAds();
  loadPlans();
}

async function loadStats() {
  try {
    const s = await api('/api/admin/stats');
    const row = document.getElementById('statsRow');
    const mk = (label, num, cls, go) =>
      `<div class="stat ${cls || ''}${go ? ' clickable' : ''}"${go ? ` data-go="${go}" role="button" tabindex="0" title="Ver lista"` : ''}><div class="num">${num}</div><div class="lbl">${label}</div></div>`;
    row.innerHTML =
      mk('Vendedores em revisão (pagos)', s.sellersPaidAwaitingReview, 'warn', 'sellers:review') +
      mk('Vendedores sem pagamento', s.sellersAwaitingPayment, '', 'sellers:unpaid') +
      mk('Vendedores aprovados', s.sellersApproved, '', 'sellers:approved') +
      mk('Anúncios em revisão', s.postsPending, '', 'cars:review') +
      mk('Anúncios publicados', s.postsApproved, '', 'cars:approved') +
      mk('Recusados (anúncios)', s.postsRejected, '', 'cars:rejected') +
      mk('Receita (subscrições)', money(s.revenue), 'rev', 'sellers:all');
  } catch (e) { /* ignora */ }
}

function switchSection(sec) {
  document.querySelectorAll('#secTabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.sec === sec));
  document.getElementById('carsSection').style.display = sec === 'cars' ? 'block' : 'none';
  document.getElementById('sellersSection').style.display = sec === 'sellers' ? 'block' : 'none';
  document.getElementById('adsSection').style.display = sec === 'ads' ? 'block' : 'none';
  document.getElementById('plansSection').style.display = sec === 'plans' ? 'block' : 'none';
  document.getElementById('accountSection').style.display = sec === 'account' ? 'block' : 'none';
  if (sec === 'account') loadAccount();
}

function gotoStat(go) {
  const [sec, status] = go.split(':');
  switchSection(sec);
  if (sec === 'sellers') {
    sellerStatus = status;
    document.querySelectorAll('#sellerTabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.sstatus === status));
    if (!sellers.length) loadSellers(); else renderSellers();
  } else {
    currentStatus = status;
    document.querySelectorAll('#tabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.status === status));
    renderList();
  }
  document.querySelector('#dashView .container').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.getElementById('statsRow').addEventListener('click', (e) => {
  const st = e.target.closest('.stat[data-go]');
  if (st) gotoStat(st.dataset.go);
});
document.getElementById('statsRow').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const st = e.target.closest('.stat[data-go]');
  if (st) { e.preventDefault(); gotoStat(st.dataset.go); }
});

let allPosts = [];
async function loadList() {
  try {
    const d = await api('/api/admin/posts?status=all');
    allPosts = d.posts;
    renderList();
  } catch (e) {
    document.getElementById('list').innerHTML = `<div class="alert alert-error show">${esc(e.message)}</div>`;
  }
}

function filterFor(status) {
  if (status === 'review') return allPosts.filter((p) => p.status === 'pending');
  if (status === 'approved') return allPosts.filter((p) => p.status === 'approved');
  if (status === 'rejected') return allPosts.filter((p) => p.status === 'rejected');
  return allPosts;
}

function renderList() {
  const list = document.getElementById('list');
  const empty = document.getElementById('adminEmpty');
  const items = filterFor(currentStatus);
  list.innerHTML = '';
  empty.style.display = items.length ? 'none' : 'block';

  items.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'admin-item';
    const cover = p.photos.length ? p.photos[0] : '';
    const payBadge = '';
    const statusBadge =
      p.status === 'approved' ? '<span class="badge approved">✔ Publicado</span>' :
      p.status === 'rejected' ? '<span class="badge rejected">✖ Recusado</span>' :
      '<span class="badge pending">🕐 Em revisão</span>';
    const sellerLine = p.seller
      ? `👤 ${esc(p.seller.fullName)} · 📞 ${esc(p.seller.phone)}${p.seller.city ? ' · ' + esc(p.seller.city) : ''}`
      : '👤 (anúncio antigo, sem vendedor)';

    el.innerHTML = `
      ${cover ? `<img class="thumb" src="${cover}" alt="" onclick="viewPost(${p.id})" />` : '<div class="thumb" style="display:grid;place-items:center;font-size:1.8rem">🚗</div>'}
      <div class="info" onclick="viewPost(${p.id})" style="cursor:pointer">
        <div class="top">
          <strong>${esc(p.brand)} ${esc(p.model)}</strong>
          <span class="price">${money(p.price)}</span>
          ${statusBadge}
        </div>
        <div class="meta">
          <span class="badge paypaid">✆ Vendedor registado</span>
          ${p.year ? `\u2022 ${p.year} ano` : ''}
          ${p.mileage != null ? ` \u2022 ${Number(p.mileage).toLocaleString('pt-MZ')} km` : ''}
          ${p.fuel ? ` \u2022 ${esc(p.fuel)}` : ''}
          ${p.transmission ? ` \u2022 ${esc(p.transmission)}` : ''}
          ${p.city ? ` \u2022 ${esc(p.city)}` : ''}
          <br/>
          ${sellerLine}
          ${p.status === 'rejected' && p.rejectionReason ? `<br/><span class="badge rejected">Motivo: ${esc(p.rejectionReason)}</span>` : ''}
        </div>
      </div>
      <div class="actions">
        ${p.status === 'pending'
          ? `<button class="btn btn-green btn-sm" onclick="approve(${p.id})">✔ Aprovar e publicar</button>
             <button class="btn btn-danger btn-sm" onclick="askReject(${p.id})">✖ Recusar</button>`
          : ''}
        <button class="btn btn-ghost btn-sm" onclick="viewPost(${p.id})">👁 Detalhes</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="del(${p.id})">🗑 Apagar</button>
      </div>
    `;
    list.appendChild(el);
  });
}

document.getElementById('tabs').addEventListener('click', (e) => {
  const t = e.target.closest('.tab');
  if (!t) return;
  document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
  t.classList.add('active');
  currentStatus = t.dataset.status;
  renderList();
});

/* ---------- Aprovacao / recusa / eliminar ---------- */

function approve(id) {
  api(`/api/admin/posts/${id}/approve`, { method: 'POST' })
    .then((d) => { alert(d.message); refresh(); })
    .catch((e) => alert(e.message));
}

let actionTarget = null;
function askReject(id) {
  actionTarget = id;
  document.getElementById('actionTitle').textContent = 'Recusar anúncio';
  document.getElementById('actionBody').innerHTML = 'Vai recusar este anúncio. Indique o motivo (o vendedor verá ao consultar a referência).';
  document.getElementById('reasonField').style.display = 'block';
  document.getElementById('reasonText').value = '';
  document.getElementById('confirmBtn').className = 'btn btn-danger';
  document.getElementById('confirmBtn').textContent = '✖ Confirmar recusa';
  document.getElementById('confirmBtn').onclick = () => doReject(actionTarget);
  document.getElementById('actionBackdrop').classList.add('open');
}

function doReject(id) {
  const reason = document.getElementById('reasonText').value.trim();
  api(`/api/admin/posts/${id}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': token }, body: JSON.stringify({ reason }) })
    .then((d) => { closeAction(); alert(d.message); refresh(); })
    .catch((e) => alert(e.message));
}

function closeAction() {
  document.getElementById('actionBackdrop').classList.remove('open');
}

function del(id) {
  if (!confirm('Apagar este anúncio permanentemente?')) return;
  api(`/api/admin/posts/${id}`, { method: 'DELETE' })
    .then(() => refresh())
    .catch((e) => alert(e.message));
}

/* ---------- Detalhe (modal) ---------- */

function viewPost(id) {
  api('/api/admin/posts/' + id)
    .then((p) => {
      const b = document.getElementById('actionBody');
      const spec = (k, v) => (v == null || v === '' ? '' : `<div class="spec-box"><div class="k">${k}</div><div class="v">${v}</div></div>`);
      b.innerHTML = `
        ${p.photos.length ? `<div class="thumbs" style="padding:0 0 12px">${p.photos.map((s, i) => `<img src="${s}" alt="" ${i === 0 ? 'class="active"' : ''} data-full="${s}" />`).join('')}</div>` : ''}
        <img id="bigPhoto" src="${p.photos[0] || ''}" style="width:100%;height:280px;object-fit:cover;border-radius:10px;margin-bottom:16px;background:#dfe4ee" />
        <div class="detail-title" style="margin-bottom:12px">
          <div>${esc(p.brand)} ${esc(p.model)}</div>
          <div class="price">${money(p.price)}</div>
        </div>
        <div class="spec-grid" style="margin:0">
          ${spec('Ano', p.year)}
          ${spec('Quilometragem', p.mileage != null ? Number(p.mileage).toLocaleString('pt-MZ') + ' km' : '')}
          ${spec('Combustível', p.fuel)}
          ${spec('Transmissão', p.transmission)}
          ${spec('Cor', p.color)}
          ${spec('Portas', p.doors)}
          ${spec('Lugares', p.seats)}
          ${spec('Cidade', p.city)}
        </div>
        ${p.description ? `<div class="detail-desc" style="margin-top:12px">${esc(p.description)}</div>` : ''}
        ${p.seller
          ? `<div class="contact-box" style="margin-top:16px">
              <div style="font-size:1.5rem">👤</div>
              <div>
                <div class="who">${esc(p.seller.fullName)} <span class="badge approved" style="font-size:.72rem">Vendedor registado</span></div>
                <div>📞 <strong>${esc(p.seller.phone)}</strong>${p.seller.email ? ' · ' + esc(p.seller.email) : ''}</div>
                <div style="opacity:.8;font-size:.9rem">Plano: ${esc(p.seller.plan.label)} por trimestre · ${p.seller.plan.postsUsed}/${p.seller.plan.posts} usadas</div>
              </div>
            </div>`
          : `<div class="contact-box" style="margin-top:16px">
              <div style="font-size:1.5rem">👤</div>
              <div>
                <div class="who">Anúncio antigo (sem vendedor)</div>
                <div style="opacity:.8;font-size:.85rem">Criado em ${new Date(p.createdAt).toLocaleString('pt-MZ')}</div>
              </div>
            </div>`}
      `;
      document.getElementById('actionTitle').textContent = 'Anúncio #' + p.id;
      document.getElementById('reasonField').style.display = 'none';
      document.getElementById('confirmBtn').style.display = 'none';
      document.getElementById('actionBackdrop').classList.add('open');
    })
    .catch((e) => alert(e.message));
}

document.getElementById('actionBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'actionBackdrop') closeAction();
  const t = e.target.closest('img[data-full]');
  if (t) {
    document.getElementById('actionBackdrop').querySelectorAll('.thumbs img').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    const big = document.getElementById('bigPhoto');
    if (big) big.src = t.dataset.full;
  }
});

/* ---------- Secoes do painel (carros / publicidade) ---------- */

document.getElementById('secTabs').addEventListener('click', (e) => {
  const t = e.target.closest('.tab');
  if (!t) return;
  switchSection(t.dataset.sec);
  if (t.dataset.sec === 'sellers') loadSellers();
  if (t.dataset.sec === 'ads') loadAds();
  if (t.dataset.sec === 'plans') loadPlans();
});

/* ---------- Gestao de vendedores ---------- */

let sellers = [];
let sellerStatus = 'review';

document.getElementById('sellerTabs').addEventListener('click', (e) => {
  const t = e.target.closest('.tab');
  if (!t) return;
  document.querySelectorAll('#sellerTabs .tab').forEach((x) => x.classList.remove('active'));
  t.classList.add('active');
  sellerStatus = t.dataset.sstatus;
  renderSellers();
});

async function loadSellers() {
  try {
    const d = await api('/api/admin/sellers?status=all');
    sellers = d.sellers;
    renderSellers();
  } catch (e) {
    $('sellersList').innerHTML = `<div class="alert alert-error show">${esc(e.message)}</div>`;
  }
}

function sellerFilter() {
  if (sellerStatus === 'review') return sellers.filter((s) => s.status === 'pending' && s.paymentStatus === 'paid');
  if (sellerStatus === 'unpaid') return sellers.filter((s) => s.status === 'pending' && s.paymentStatus !== 'paid');
  if (sellerStatus === 'approved') return sellers.filter((s) => s.status === 'approved');
  if (sellerStatus === 'rejected') return sellers.filter((s) => s.status === 'rejected');
  return sellers;
}

function subBadge(s) {
  const sub = s.subscription || {};
  if (sub.renewalPending) return '<span class="badge pending">🔁 Renovação em curso</span>';
  if (sub.subStatus === 'active') return '<span class="badge approved">✔ Subscrição activa</span>';
  if (sub.subStatus === 'expired') return '<span class="badge rejected">🔒 Subscrição expirada</span>';
  if (sub.subStatus === 'inactive') return '<span class="badge paypending">💤 Subscrição inactiva</span>';
  return '';
}

function quarterLine(s) {
  const sub = s.subscription || {};
  if (!sub.quarterStart) return '';
  const d = (iso) => new Date(iso).toLocaleDateString('pt-MZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `<br/>🕒 Trimestre: ${d(sub.quarterStart)} → ${d(sub.quarterEnd)}`;
}

function renewalLine(s) {
  const sub = s.subscription || {};
  if (!sub.renewalPending) return '';
  const plan = sub.renewalPlan ? `${esc(sub.renewalPlan.label)} · ${sub.renewalPlan.posts} posts` : '';
  const paid = sub.renewalTransaction
    ? `<br/><span class="badge paypaid">💳 Pagamento recebido (${esc(sub.renewalTransaction)})</span>`
    : '<br/><span class="badge paypending">💤 A aguardar pagamento do vendedor</span>';
  return `<br/>🔁 Renovação: <strong>${plan || '—'}</strong> · Ref ${esc(sub.renewalReference)}${paid}`;
}

function renewalActionButtons(s) {
  const sub = s.subscription || {};
  if (!sub.renewalPending) return '';
  const confirmBtn = sub.renewalTransaction
    ? `<button class="btn btn-green btn-sm" onclick="confirmRenewal(${s.id})">✔ Confirmar renovação</button>`
    : '';
  return `${confirmBtn}<button class="btn btn-danger btn-sm" onclick="cancelRenewal(${s.id})">✖ Cancelar renovação</button>`;
}

function renderSellers() {
  const list = $('sellersList');
  const empty = $('sellersEmpty');
  const items = sellerFilter();
  list.innerHTML = '';
  empty.style.display = items.length ? 'none' : 'block';

  items.forEach((s) => {
    const el = document.createElement('div');
    el.className = 'admin-item';
    const payBadge = s.paymentStatus === 'paid'
      ? '<span class="badge paypaid">💳 Pago</span>'
      : '<span class="badge paypending">💤 Pagamento pendente</span>';
    const stBadge =
      s.status === 'approved' ? '<span class="badge approved">✔ Aprovado</span>' :
      s.status === 'rejected' ? '<span class="badge rejected">✖ Recusado</span>' :
      '<span class="badge pending">🕐 Em revisão</span>';

    el.innerHTML = `
      ${s.photoSelfie ? `<img class="thumb" src="${s.photoSelfie}" alt="" onclick="viewSeller(${s.id})" style="border-radius:50%;object-fit:cover;width:88px;height:88px" />` : '<div class="thumb" style="display:grid;place-items:center;font-size:1.8rem">👤</div>'}
      <div class="info" onclick="viewSeller(${s.id})" style="cursor:pointer">
        <div class="top">
          <strong>${esc(s.fullName)}</strong>
          ${stBadge} ${payBadge} ${subBadge(s)}
        </div>
        <div class="meta">
          📞 ${esc(s.phone)}${s.email ? ' · ✉ ' + esc(s.email) : ''}
          ${s.city ? '<br/>📍 ' + esc(s.city) : ''}
          <br/>Plano: <strong>${esc(s.plan.label)}</strong> por trimestre · ${s.plan.postsUsed}/${s.plan.posts} publicações usadas
          ${quarterLine(s)}
          ${s.paymentReference ? `<br/>🏷 Ref: <strong>${esc(s.paymentReference)}</strong>` : ''}
          ${s.paymentTransaction ? ` · 🧾 ${esc(s.paymentTransaction)}` : ''}
          ${renewalLine(s)}
          ${s.status === 'rejected' && s.rejectionReason ? `<br/><span class="badge rejected">Motivo: ${esc(s.rejectionReason)}</span>` : ''}
        </div>
      </div>
      <div class="actions">
        ${s.status === 'pending' && s.paymentStatus === 'paid'
          ? `<button class="btn btn-green btn-sm" onclick="approveSeller(${s.id})">✔ Aprovar registo</button>
             <button class="btn btn-danger btn-sm" onclick="askRejectSeller(${s.id})">✖ Recusar</button>`
          : ''}
        ${s.status === 'pending' && s.paymentStatus !== 'paid'
          ? `<button class="btn btn-danger btn-sm" onclick="askRejectSeller(${s.id})">✖ Recusar</button>`
          : ''}
        ${renewalActionButtons(s)}
        <button class="btn btn-ghost btn-sm" onclick="viewSeller(${s.id})">👁 Documentos</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="delSeller(${s.id})">🗑 Apagar</button>
      </div>
    `;
    list.appendChild(el);
  });
}

function approveSeller(id) {
  api(`/api/admin/sellers/${id}/approve`, { method: 'POST' })
    .then((d) => { alert(d.message); refresh(); loadSellers(); })
    .catch((e) => alert(e.message));
}

function confirmRenewal(id) {
  if (!confirm('Confirmar a renovação e iniciar um novo trimestre de 3 meses para este vendedor? As publicações voltam a ficar visíveis.')) return;
  api(`/api/admin/sellers/${id}/renewal-confirm`, { method: 'POST' })
    .then((d) => { alert(d.message); refresh(); loadSellers(); })
    .catch((e) => alert(e.message));
}

function cancelRenewal(id) {
  if (!confirm('Cancelar a renovação deste vendedor?')) return;
  api(`/api/admin/sellers/${id}/renewal-reject`, { method: 'POST' })
    .then((d) => { alert(d.message); refresh(); loadSellers(); })
    .catch((e) => alert(e.message));
}

function askRejectSeller(id) {
  actionTarget = { type: 'seller', id };
  $('actionTitle').textContent = 'Recusar registo de vendedor';
  $('actionBody').innerHTML = 'Vai recusar este registo. Indique o motivo (visível para o vendedor).';
  $('reasonField').style.display = 'block';
  $('reasonText').value = '';
  $('confirmBtn').className = 'btn btn-danger';
  $('confirmBtn').textContent = '✖ Confirmar recusa';
  $('confirmBtn').onclick = () => doRejectSeller(actionTarget.id);
  $('actionBackdrop').classList.add('open');
}

function doRejectSeller(id) {
  const reason = $('reasonText').value.trim();
  api(`/api/admin/sellers/${id}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': token }, body: JSON.stringify({ reason }) })
    .then((d) => { closeAction(); alert(d.message); refresh(); loadSellers(); })
    .catch((e) => alert(e.message));
}

function delSeller(id) {
  if (!confirm('Apagar este vendedor? Os anúncios dele e os ficheiros também serão apagados.')) return;
  api(`/api/admin/sellers/${id}`, { method: 'DELETE' })
    .then(() => { refresh(); loadSellers(); })
    .catch((e) => alert(e.message));
}

function viewSeller(id) {
  api(`/api/admin/sellers/${id}`)
    .then(({ seller, posts }) => {
      const b = $('actionBody');
      const labels = {
        approved: ['badge approved', '✔ Aprovado'],
        pending: ['badge pending', '🕐 Em revisão'],
        rejected: ['badge rejected', '✖ Recusado'],
      }[seller.status] || ['badge pending', seller.status];
      b.innerHTML = `
        <div class="doc-grid">
          <figure><img src="${seller.photoIdFront}" alt="documento frente" /><figcaption>Doc — FRENTE</figcaption></figure>
          <figure><img src="${seller.photoIdBack}" alt="documento verso" /><figcaption>Doc — VERSO</figcaption></figure>
          <figure><img src="${seller.photoSelfie}" alt="selfie" /><figcaption>Selfie (rosto)</figcaption></figure>
        </div>
        <div class="detail-title" style="margin:14px 0 8px">
          <div>${esc(seller.fullName)}</div>
          <div><span class="badge" style="font-size:.85rem">${labels[1]}</span></div>
        </div>
        <div class="spec-grid" style="margin:0">
          ${seller.birthDate ? `<div class="spec-box"><div class="k">Nascimento</div><div class="v">${seller.birthDate}</div></div>` : ''}
          <div class="spec-box"><div class="k">Documento</div><div class="v">${esc(seller.idType || '—')} · ${esc(seller.idNumber || '—')}</div></div>
          <div class="spec-box"><div class="k">Telefone</div><div class="v">${esc(seller.phone)}</div></div>
          ${seller.email ? `<div class="spec-box"><div class="k">E-mail</div><div class="v">${esc(seller.email)}</div></div>` : ''}
          <div class="spec-box"><div class="k">Cidade</div><div class="v">${esc(seller.city || '—')}</div></div>
          <div class="spec-box"><div class="k">Endereço</div><div class="v">${esc(seller.address || '—')}</div></div>
          ${seller.location ? `<div class="spec-box"><div class="k">Localização</div><div class="v"><a href="https://www.google.com/maps?q=${seller.location.lat},${seller.location.lng}" target="_blank" rel="noopener">Ver no mapa ↗</a></div></div>` : ''}
          <div class="spec-box"><div class="k">Plano</div><div class="v">${esc(seller.plan.label)} por trimestre · ${seller.plan.posts} posts</div></div>
          <div class="spec-box"><div class="k">Utilização</div><div class="v">${seller.plan.postsUsed}/${seller.plan.posts} publicações</div></div>
        </div>
        <div class="fee-note" style="margin-top:14px">
          🏷 Ref: <strong>${esc(seller.paymentReference || '—')}</strong> · ${Number(seller.plan.fee).toLocaleString('pt-MZ')} MT ·
          Pagamento: ${seller.paymentStatus === 'paid' ? '<strong style="color:var(--green)">PAGO</strong>' : 'PENDENTE'}${seller.paymentTransaction ? ' · Transação: ' + esc(seller.paymentTransaction) : ''}
          ${seller.status === 'rejected' && seller.rejectionReason ? `<br/>Motivo da recusa: ${esc(seller.rejectionReason)}` : ''}
        </div>
        <div class="fee-note" style="margin-top:10px">${subBadge(seller)} ${quarterLine(seller)}
          ${seller.subscription && seller.subscription.renewalPending
            ? `<br/><strong>🔁 Renovação em curso</strong>${seller.subscription.renewalPlan ? ` · ${esc(seller.subscription.renewalPlan.label)} (${seller.subscription.renewalPlan.posts} posts)` : ''}
               · Ref ${esc(seller.subscription.renewalReference)}
               ${seller.subscription.renewalTransaction ? `<br/>💳 Transação de renovação: ${esc(seller.subscription.renewalTransaction)}` : '<br/>💤 A aguardar pagamento do vendedor'}`
            : ''}
        </div>
        ${seller.subscription && seller.subscription.renewalPending ? `<div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">${renewalActionButtons(seller)}</div>` : ''}
        ${posts.length ? `<div style="margin-top:12px;font-size:.9rem"><strong>🗒 ${posts.length} anúncio(s):</strong> ${posts.map((p) => esc(p.brand) + ' ' + esc(p.model)).join(', ')}</div>` : ''}
      `;
      $('actionTitle').textContent = 'Vendedor #' + seller.id;
      $('reasonField').style.display = 'none';
      $('confirmBtn').style.display = 'none';
      $('actionBackdrop').classList.add('open');
    })
    .catch((e) => alert(e.message));
}

/* ---------- Gestao de publicidade ---------- */

let ads = [];
let editingAdId = null;

const $ = (id) => document.getElementById(id);

async function loadAds() {
  try {
    const d = await api('/api/admin/ads');
    ads = d.ads;
    renderAds();
  } catch (e) {
    $('adsList').innerHTML = `<div class="alert alert-error show">${esc(e.message)}</div>`;
  }
}

function renderAds() {
  const list = $('adsList');
  const empty = $('adsEmpty');
  list.innerHTML = '';
  empty.style.display = ads.length ? 'none' : 'block';
  $('adCount').textContent = ads.length + (ads.length === 1 ? ' publicidade' : ' publicidades');

  ads.forEach((a, i) => {
    const el = document.createElement('div');
    el.className = 'admin-item';
    el.innerHTML = `
      <img class="thumb" src="${a.image}" alt="${esc(a.title)}" style="height:auto;max-height:120px;width:200px;object-fit:cover" />
      <div class="info">
        <div class="top">
          <strong>${esc(a.title)}</strong>
          ${a.active ? '<span class="badge approved">● Ativa</span>' : '<span class="badge rejected">● Inativa</span>'}
        </div>
        <div class="meta">
          ${a.link ? '🔗 ' + esc(a.link) + '<br/>' : ''}
          Ordem: <strong>${i + 1}</strong> · Criada em ${new Date(a.createdAt).toLocaleDateString('pt-MZ')}
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" title="Mover para cima" onclick="moveAd(${a.id}, 'up')" ${i === 0 ? 'disabled' : ''}>⬆</button>
        <button class="btn btn-ghost btn-sm" title="Mover para baixo" onclick="moveAd(${a.id}, 'down')" ${i === ads.length - 1 ? 'disabled' : ''}>⬇</button>
        <button class="btn btn-outline btn-sm" onclick="editAd(${a.id})">✏ Editar</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleAd(${a.id})">${a.active ? '⏸ Desativar' : '▶ Ativar'}</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="delAd(${a.id})">🗑 Apagar</button>
      </div>
    `;
    list.appendChild(el);
  });
}

function moveAd(id, dir) {
  api(`/api/admin/ads/${id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir }) })
    .then((d) => { alert(d.message); loadAds(); })
    .catch((e) => alert(e.message));
}

function toggleAd(id) {
  api(`/api/admin/ads/${id}/toggle`, { method: 'POST' })
    .then((d) => { alert(d.message); loadAds(); })
    .catch((e) => alert(e.message));
}

function delAd(id) {
  if (!confirm('Apagar esta publicidade?')) return;
  api(`/api/admin/ads/${id}`, { method: 'DELETE' })
    .then(() => { if (editingAdId === id) resetAdForm(); loadAds(); })
    .catch((e) => alert(e.message));
}

/* --- Formulario de publicidade --- */

function showAdAlert(msg, ok) {
  const a = $('adAlert');
  a.textContent = msg || '';
  a.className = 'alert ' + (msg ? 'show ' + (ok ? 'alert-success' : 'alert-error') : '');
}

$('adImage').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (!/^image\//.test(f.type)) { showAdAlert('Apenas imagens são permitidas.', false); e.target.value = ''; return; }
  const label = $('adUploader').querySelector('p');
  label.innerHTML = `<strong>${f.name}</strong> selecionado — clique para trocar`;
});

function resetAdForm() {
  editingAdId = null;
  $('adFormTitle').textContent = '➕ Nova publicidade';
  $('adTitle').value = '';
  $('adLink').value = '';
  $('adActive').checked = true;
  $('adImage').value = '';
  $('adUploader').querySelector('p').innerHTML = '<strong>Clique para selecionar</strong> — JPG, PNG, WEBP ou GIF · máx. 5 MB';
  $('adCancel').style.display = 'none';
  $('adSubmit').textContent = 'Salvar publicidade';
}

function editAd(id) {
  const a = ads.find((x) => x.id === id);
  if (!a) return;
  editingAdId = id;
  $('adFormTitle').textContent = '✏ Editar publicidade #' + id;
  $('adTitle').value = a.title;
  $('adLink').value = a.link;
  $('adActive').checked = a.active;
  $('adImage').value = '';
  $('adUploader').querySelector('p').innerHTML = `<strong>Imagem atual:</strong> <a href="${a.image}" target="_blank" style="color:var(--red)">ver</a> — clique para trocar`;
  $('adCancel').style.display = 'inline-flex';
  $('adSubmit').textContent = 'Atualizar publicidade';
  $('adsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveAd() {
  const title = $('adTitle').value.trim();
  const link = $('adLink').value.trim();
  const image = $('adImage').files[0];
  const active = $('adActive').checked;

  if (!title) return showAdAlert('Adicione um título.', false);
  const isEdit = editingAdId != null;
  if (!isEdit && !image) return showAdAlert('Adicione uma imagem de publicidade.', false);

  const fd = new FormData();
  fd.append('title', title);
  fd.append('link', link);
  fd.append('active', active ? '1' : '0');
  if (image) fd.append('image', image);

  const btn = $('adSubmit');
  btn.disabled = true;
  btn.textContent = 'A guardar...';
  try {
    const url = isEdit ? `/api/admin/ads/${editingAdId}` : '/api/admin/ads';
    const r = await fetch(url, { method: 'POST', headers: { 'x-admin-token': token }, body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Erro ao guardar publicidade.');
    showAdAlert(d.message || 'Guardado!', true);
    resetAdForm();
    loadAds();
  } catch (e) {
    showAdAlert(e.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = isEdit ? 'Atualizar publicidade' : 'Salvar publicidade';
  }
}

/* ---------- Gestao de pacotes (planos de subscricao) ---------- */

let plans = [];
let editingPlanCode = null;

async function loadPlans() {
  try {
    const d = await api('/api/admin/plans');
    plans = d.plans;
    renderPlans();
  } catch (e) {
    $('plansList').innerHTML = `<div class="alert alert-error show">${esc(e.message)}</div>`;
  }
}

function showPlanAlert(msg, ok) {
  const a = $('planAlert');
  a.textContent = msg || '';
  a.className = 'alert ' + (msg ? 'show ' + (ok ? 'alert-success' : 'alert-error') : '');
}

function renderPlans() {
  const list = $('plansList');
  const empty = $('plansEmpty');
  list.innerHTML = '';
  empty.style.display = plans.length ? 'none' : 'block';
  $('plansCount').textContent = plans.length + (plans.length === 1 ? ' pacote' : ' pacotes');

  plans.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'admin-item';
    const stateBadge = p.active
      ? '<span class="badge approved">● Activo</span>'
      : '<span class="badge rejected">● Desactivado</span>';
    const usageNote = p.usage
      ? `${p.usage} vendedor(es) subscrito(s)`
      : 'sem vendedores subscritos';
    el.innerHTML = `
      <div class="info" style="flex:1">
        <div class="top">
          <strong>${esc(p.label)}</strong>
          ${stateBadge}
        </div>
        <div class="meta">
          💳 Taxa: <strong>${money(p.fee)}</strong> /trimestre · 🚗 <strong>${p.posts}</strong> publicações
          <br/>Código: <code>${esc(p.code)}</code> · ${usageNote}
          ${p.pendingRefs ? `<br/><span class="badge pending">Referenciado em renovação/upgrade em curso</span>` : ''}
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-outline btn-sm" onclick="editPlan('${p.code}')">✏ Editar</button>
        <button class="btn btn-ghost btn-sm" onclick="togglePlan('${p.code}')">${p.active ? '⏸ Desactivar' : '▶ Activar'}</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="delPlan('${p.code}')">🗑 Apagar</button>
      </div>
    `;
    list.appendChild(el);
  });
}

function resetPlanForm() {
  editingPlanCode = null;
  $('planFormTitle').textContent = '➕ Novo pacote';
  $('planCode').value = '';
  $('planCode').disabled = false;
  $('planLabel').value = '';
  $('planFee').value = '';
  $('planPosts').value = '';
  $('planActive').checked = true;
  $('planCancel').style.display = 'none';
  $('planSubmit').textContent = 'Criar pacote';
}

function editPlan(code) {
  const p = plans.find((x) => x.code === code);
  if (!p) return;
  editingPlanCode = p.code;
  $('planFormTitle').textContent = '✏ Editar pacote ' + p.code;
  $('planCode').value = p.code;
  $('planCode').disabled = true;
  $('planLabel').value = p.label;
  $('planFee').value = p.fee;
  $('planPosts').value = p.posts;
  $('planActive').checked = p.active;
  $('planCancel').style.display = 'inline-flex';
  $('planSubmit').textContent = 'Atualizar pacote';
  $('plansSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function togglePlan(code) {
  api(`/api/admin/plans/${code}/toggle`, { method: 'POST' })
    .then((d) => { showPlanAlert(d.message, true); loadPlans(); })
    .catch((e) => showPlanAlert(e.message, false));
}

function delPlan(code) {
  const p = plans.find((x) => x.code === code);
  if (!p) return;
  if (!confirm(`Apagar o pacote "${p.label}"?\nSó é possível se nenhum vendedor estiver subscrito.`)) return;
  api(`/api/admin/plans/${code}`, { method: 'DELETE' })
    .then(() => { showPlanAlert('Pacote apagado.', true); if (editingPlanCode === code) resetPlanForm(); loadPlans(); })
    .catch((e) => showPlanAlert(e.message, false));
}

async function savePlan() {
  const code = $('planCode').value.trim();
  const label = $('planLabel').value.trim();
  const fee = $('planFee').value.trim();
  const posts = $('planPosts').value.trim();
  const active = $('planActive').checked;

  if (!code) return showPlanAlert('Indique o código do pacote.', false);
  if (!label) return showPlanAlert('Indique a etiqueta (ex.: "3 000 MT").', false);
  if (!fee || Number(fee) <= 0) return showPlanAlert('Indique a taxa trimestral em MT.', false);
  if (!posts || Number(posts) < 1) return showPlanAlert('Indique o número de publicações.', false);

  const btn = $('planSubmit');
  const isEdit = editingPlanCode != null;
  btn.disabled = true;
  btn.textContent = 'A guardar...';
  try {
    const url = isEdit ? `/api/admin/plans/${editingPlanCode}` : '/api/admin/plans';
    const d = await api(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, label, fee: Number(fee), posts: Number(posts), active }),
    });
    showPlanAlert(d.message, true);
    resetPlanForm();
    loadPlans();
  } catch (e) {
    showPlanAlert(e.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = isEdit ? 'Atualizar pacote' : 'Criar pacote';
  }
}

/* ---------- Conta de administrador ---------- */

function showAccAlert(msg, ok) {
  const a = document.getElementById('accAlert');
  a.textContent = msg || '';
  a.className = 'alert ' + (msg ? 'show ' + (ok ? 'alert-success' : 'alert-error') : '');
}

function loadAccount() {
  api('/api/admin/session')
    .then((s) => {
      document.getElementById('accUsername').value = s.username;
      document.getElementById('accEmail').value = s.email || '';
      document.getElementById('accCurPass').value = '';
      document.getElementById('accNewPass').value = '';
      document.getElementById('accNewPass2').value = '';
      showAccAlert('');
    })
    .catch((e) => showAccAlert(e.message));
}

async function saveAccount(btn) {
  const email = document.getElementById('accEmail').value.trim();
  const currentPassword = document.getElementById('accCurPass').value;
  const newPassword = document.getElementById('accNewPass').value;
  const newPassword2 = document.getElementById('accNewPass2').value;
  if (!email) return showAccAlert('O e-mail de acesso e obrigatorio.', false);
  if (newPassword && newPassword !== newPassword2) return showAccAlert('As palavras-passe novas nao coincidem.', false);
  if (newPassword && newPassword.length < 6) return showAccAlert('A nova palavra-passe deve ter pelo menos 6 caracteres.', false);

  btn.disabled = true;
  btn.textContent = 'A guardar...';
  try {
    const d = await api('/api/admin/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, currentPassword, newPassword }),
    });
    showAccAlert(d.message, true);
    document.getElementById('accCurPass').value = '';
    document.getElementById('accNewPass').value = '';
    document.getElementById('accNewPass2').value = '';
    document.getElementById('whoAmI').textContent = '👤 ' + d.username + (d.email ? ' · ' + d.email : '');
  } catch (e) {
    showAccAlert(e.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Guardar alterações';
  }
}

document.addEventListener('DOMContentLoaded', checkSession);