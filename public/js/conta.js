/* ---------- Minha conta (vendedor) ---------- */
const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'mcb_seller_token';
const token = localStorage.getItem(TOKEN_KEY) || '';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function sapi(url, opts = {}) {
  const o = { ...opts, headers: { ...(opts.headers || {}), 'x-seller-token': token } };
  return fetch(url, o);
}

const statusText = (s) => ({
  pending: '🕐 Em revisão',
  approved: '✔ Publicado',
  rejected: '✖ Recusado',
}[s] || s);

const statusClass = (s) => ({ pending: 'badge pending', approved: 'badge approved', rejected: 'badge rejected' }[s] || 'badge');

async function load() {
  try {
    const r = await sapi('/api/sellers/me/posts');
    if (r.status === 401) return showLoggedOut();
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erro ao carregar a conta.');
    currentSeller = d.seller;
    renderAccount(d.seller, d.posts);
  } catch (e) {
    showLoggedOut();
  }
}

function showLoggedOut() {
  $('account').style.display = 'none';
  $('notLogged').style.display = 'block';
}

function datePT(iso) {
  return iso ? new Date(iso).toLocaleDateString('pt-MZ', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
}

function renderAccount(seller, posts) {
  $('notLogged').style.display = 'none';
  $('account').style.display = 'block';
  $('acctName').textContent = seller.fullName;
  $('acctPhone').textContent = `📞 ${seller.phone} · ${seller.city || ''}`;
  $('planLabel').textContent = `${seller.plan.label} por trimestre · até ${seller.plan.posts} publicações`;
  $('meterText').textContent = `${seller.plan.postsUsed} de ${seller.plan.posts} publicações usadas`;
  $('meterFill').style.width = Math.min(100, (seller.plan.postsUsed / seller.plan.posts) * 100) + '%';
  $('subUsed').textContent = `${seller.plan.postsUsed} / ${seller.plan.posts}`;
  $('subLeft').textContent = seller.plan.postsLeft;

  const sub = seller.subscription || {};
  const badge = $('planBadge');
  if (sub.subStatus === 'active') {
    badge.textContent = '✔ Activo';
    badge.style.color = 'var(--green)';
  } else if (sub.subStatus === 'expired') {
    badge.textContent = '🔒 Expirado';
    badge.style.color = 'var(--red)';
  } else {
    badge.textContent = '—';
    badge.style.color = 'var(--muted)';
  }
  if (sub.renewalPending) badge.textContent = '🔁 Em renovação';

  const line = $('subLine');
  if (sub.quarterStart) {
    line.innerHTML = `🕒 <strong>Trimestre actual:</strong> ${datePT(sub.quarterStart)} → ${datePT(sub.quarterEnd)} (${sub.periodMonths || 3} meses, conta a partir do dia da aprovação)`;
  } else {
    line.textContent = '';
  }
  const sd = $('subDate');
  if (sub.quarterStart) sd.textContent = `${datePT(sub.quarterStart)} → ${datePT(sub.quarterEnd)}`;
  else sd.textContent = '—';

  const upBtn = $('subUpgradeBtn');
  const effPosts = sub.upgradePending && sub.upgradePlan ? sub.upgradePlan.posts : seller.plan.posts;
  const higher = seller.status === 'approved' && sub.subStatus === 'active' && effPosts < 100;
  upBtn.style.display = higher ? 'inline-block' : 'none';
  if (sub.upgradePending) upBtn.textContent = '▲ Pagamento de upgrade pendente — concluir';
  else upBtn.textContent = '▲ Migrar para pacote superior';

  const renewBanner = $('renewBanner');
  const renewPaidBanner = $('renewPaidBanner');
  renewBanner.style.display = sub.subStatus === 'expired' && !sub.renewalPending ? 'block' : 'none';
  renewPaidBanner.style.display = sub.renewalPending ? 'block' : 'none';

  const box = $('statusBox');
  box.style.display = 'block';
  if (seller.status === 'approved') {
    box.className = 'alert alert-success show';
    box.textContent = sub.subStatus === 'expired'
      ? '✔ Conta aprovada, mas a subscrição trimestral terminou — renove para as suas publicações voltarem à loja.'
      : '✔ Conta aprovada. As suas publicações estão visíveis na loja durante o trimestre.';
  } else if (seller.status === 'rejected') {
    box.className = 'alert alert-error show';
    box.textContent = '✖ O seu registo foi recusado. ' + (seller.rejectionReason ? `Motivo: ${seller.rejectionReason}` : 'Contacte a administração.');
  } else {
    box.className = 'alert show';
    box.style.color = 'var(--amber)';
    box.style.background = '#fff8ec';
    box.style.borderColor = '#ffe0b2';
    box.textContent = seller.paymentStatus === 'paid'
      ? '🕐 Pagamento confirmado. Aguardando aprovação do administrador.'
      : '💳 Conclua o pagamento da subscrição para que o registo seja analisado.';
  }

  const list = $('postsList');
  const no = $('noPosts');
  list.innerHTML = '';
  no.style.display = posts.length ? 'none' : 'block';

  posts.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'admin-item';
    const cover = p.photos.length ? p.photos[0] : '';
    const hiddenBadge = p.hidden && p.status === 'approved'
      ? '<span class="badge rejected">🔒 Ocultado — subscrição expirada</span>'
      : `<span class="${statusClass(p.status)}">${statusText(p.status)}</span>`;
    el.innerHTML = `
      ${cover ? `<img class="thumb" src="${cover}" />` : '<div class="thumb"></div>'}
      <div class="info">
        <div class="top">
          <strong>${esc(p.brand)} ${esc(p.model)}</strong>
          <span class="price">${Number(p.price).toLocaleString('pt-MZ')} MT</span>
          ${hiddenBadge}
        </div>
        <div class="meta">
          ${p.year || ''}${p.year ? ' · ' : ''}${p.mileage != null ? Number(p.mileage).toLocaleString('pt-MZ') + ' km' : ''}
          ${p.fuel ? ' · ' + esc(p.fuel) : ''} ${p.transmission ? ' · ' + esc(p.transmission) : ''}
          ${p.city ? ' · ' + esc(p.city) : ''}
          ${p.status === 'rejected' && p.rejectionReason ? `<br/><span class="badge rejected">Motivo: ${esc(p.rejectionReason)}</span>` : ''}
        </div>
      </div>
      ${p.status === 'approved' && !p.hidden ? `<a href="/?car=${p.id}" class="btn btn-outline btn-sm">Ver na loja</a>` : ''}
    `;
    list.appendChild(el);
  });
}

/* ---------- Modal de renovação ---------- */

let renewPlans = [];
let renewSelected = null;

function openRenewModal() {
  $('renewPlans').innerHTML = '<p style="color:var(--muted)">A carregar planos...</p>';
  $('renewNote').textContent = '';
  $('renewBackdrop').classList.add('open');
  fetch('/api/config')
    .then((r) => r.json())
    .then((cfg) => {
      renewPlans = cfg.plans;
      renderRenewPlans();
    })
    .catch(() => { $('renewPlans').innerHTML = '<p style="color:var(--red)">Não foi possível carregar os planos.</p>'; });
}

function renderRenewPlans() {
  const list = $('renewPlans');
  list.innerHTML = '';
  renewPlans.forEach((p, i) => {
    const el = document.createElement('label');
    el.className = 'plan-card' + (i === 0 ? ' selected' : '');
    el.innerHTML = `
      <input type="radio" name="renewPlan" value="${p.code}" ${i === 0 ? 'checked' : ''} />
      <div class="plan-fee">${p.label}</div>
      <div class="plan-posts">até <strong>${p.posts}</strong> publicações/trimestre</div>
    `;
    el.querySelector('input').addEventListener('change', () => {
      list.querySelectorAll('.plan-card').forEach((c, j) => c.classList.toggle('selected', j === i));
    });
    list.appendChild(el);
  });
  renewSelected = renewPlans[0].code;
}

function closeRenewModal() {
  $('renewBackdrop').classList.remove('open');
}

async function startRenew(btn) {
  const sel = $('renewPlans').querySelector('input[name="renewPlan"]:checked');
  if (!sel) return $('renewNote').textContent = 'Selecione um plano.';
  btn.disabled = true;
  btn.textContent = 'A gerar referência...';
  try {
    const r = await sapi('/api/sellers/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: sel.value }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Erro ao criar a renovação.');
    location.href = `/payment?renew=1&ref=${encodeURIComponent(d.reference)}&amount=${d.amount}`;
  } catch (e) {
    $('renewNote').textContent = e.message;
    btn.disabled = false;
    btn.textContent = 'Gerar referência de renovação →';
  }
}

$('renewBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'renewBackdrop') closeRenewModal();
});

/* ---------- Modal de upgrade de pacote ---------- */

let upPlans = [];
let currentSeller = null;

function openUpgradeModal() {
  $('upPlans').innerHTML = '<p style="color:var(--muted)">A carregar planos...</p>';
  $('upNote').textContent = '';
  $('upBackdrop').classList.add('open');
  if (currentSeller) {
    $('upCurrent').textContent = `${currentSeller.plan.label} · ${currentSeller.plan.posts} publicações`;
    $('upUsed').textContent = currentSeller.plan.postsUsed;
    if (currentSeller.subscription && currentSeller.subscription.upgradePending && currentSeller.subscription.upgradeReference) {
      $('upIntro').textContent = 'Já tem uma referência de upgrade em curso. Confirme o pagamento ou gere uma nova referência.';
    }
  }
  fetch('/api/config')
    .then((r) => r.json())
    .then((cfg) => {
      upPlans = cfg.plans.filter((p) => (currentSeller ? p.posts > currentSeller.plan.posts : true));
      renderUpgradePlans();
    })
    .catch(() => { $('upPlans').innerHTML = '<p style="color:var(--red)">Não foi possível carregar os planos.</p>'; });
}

function renderUpgradePlans() {
  const list = $('upPlans');
  list.innerHTML = '';
  if (!upPlans.length) {
    $('upIntro').textContent = 'Já está no pacote máximo disponível. Entre em contacto com a administração para necessidades especiais.';
    $('upBtn').style.display = 'none';
    return;
  }
  $('upBtn').style.display = '';
  upPlans.forEach((p, i) => {
    const diff = Number(p.fee) - Number(currentSeller.plan.fee);
    const el = document.createElement('label');
    el.className = 'plan-card' + (i === 0 ? ' selected' : '');
    el.innerHTML = `
      <input type="radio" name="upPlan" value="${p.code}" ${i === 0 ? 'checked' : ''} />
      <div class="plan-fee">${p.label}</div>
      <div class="plan-posts">até <strong>${p.posts}</strong> publicações/trimestre</div>
      <div class="plan-posts" style="color:var(--green)">paga apenas +${Number(diff).toLocaleString('pt-MZ')} MT</div>
    `;
    el.querySelector('input').addEventListener('change', () => {
      list.querySelectorAll('.plan-card').forEach((c, j) => c.classList.toggle('selected', j === i));
    });
    list.appendChild(el);
  });
}

function closeUpgradeModal() {
  $('upBackdrop').classList.remove('open');
}

async function startUpgrade(btn) {
  const sel = $('upPlans').querySelector('input[name="upPlan"]:checked');
  if (!sel) return ($('upNote').textContent = 'Selecione um pacote.');
  btn.disabled = true;
  btn.textContent = 'A gerar referência...';
  try {
    const r = await sapi('/api/sellers/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: sel.value }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Erro ao criar a referência de upgrade.');
    location.href = `/payment?upgrade=1&ref=${encodeURIComponent(d.reference)}&amount=${d.amount}`;
  } catch (e) {
    $('upNote').textContent = e.message;
    btn.disabled = false;
    btn.textContent = 'Gerar referência de upgrade →';
  }
}

$('upBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'upBackdrop') closeUpgradeModal();
});

/* ---------- Modal de troca de palavra-passe ---------- */

function openPwdModal() {
  $('pwdBox').style.display = 'none';
  $('pwdBox').textContent = '';
  $('curPass').value = '';
  $('newPass').value = '';
  $('confPass').value = '';
  $('pwdBackdrop').classList.add('open');
  setTimeout(() => $('curPass').focus(), 100);
}

function closePwdModal() {
  $('pwdBackdrop').classList.remove('open');
}

$('pwdBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'pwdBackdrop') closePwdModal();
});

$('pwdForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const box = $('pwdBox');
  const btn = $('pwdBtn');
  const cur = $('curPass').value, npw = $('newPass').value, cnf = $('confPass').value;
  box.style.display = 'none';
  if (npw.length < 6) return showPwd('A nova palavra-passe deve ter pelo menos 6 caracteres.', false);
  if (npw !== cnf) return showPwd('As palavras-passe não coincidem.', false);
  btn.disabled = true; btn.textContent = 'A guardar…';
  try {
    const r = await sapi('/api/sellers/me/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: cur, password: npw }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Falha ao guardar.');
    showPwd('Palavra-passe atualizada com sucesso.', true);
    $('curPass').value = $('newPass').value = $('confPass').value = '';
    setTimeout(closePwdModal, 1100);
  } catch (err) {
    showPwd(err.message, false);
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar palavra-passe';
  }
});

function showPwd(msg, ok) {
  const box = $('pwdBox');
  box.style.display = 'block';
  box.textContent = (ok ? '✔ ' : '✖ ') + msg;
  box.className = 'alert show ' + (ok ? 'alert-success' : 'alert-error');
}

function logout() {
  fetch('/api/sellers/logout', { method: 'POST', headers: { 'x-seller-token': token } }).catch(() => {});
  localStorage.removeItem(TOKEN_KEY);
  location.href = '/entrar';
}

document.addEventListener('DOMContentLoaded', load);