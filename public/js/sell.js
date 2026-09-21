/* ---------- Pagina de publicacao de carro (vendedor) ---------- */

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'mcb_seller_token';
const token = localStorage.getItem(TOKEN_KEY) || '';

const alertBox = $('alertBox');
function showAlert(msg, ok) {
  alertBox.textContent = msg || '';
  alertBox.className = 'alert ' + (msg ? 'show ' + (ok ? 'alert-success' : 'alert-error') : '');
}

function sapi(url, opts = {}) {
  const o = { ...opts, headers: { ...(opts.headers || {}), 'x-seller-token': token } };
  return fetch(url, o);
}

let currentSeller = null;

async function checkAccess() {
  try {
    const r = await sapi('/api/sellers/me');
    if (r.status === 401) throw new Error('nao-autenticado');
    const d = await r.json();
    currentSeller = d;

    var gateOut = $('gateLoggedOut'), gateStatus = $('gateStatus'), wrap = $('sellFormWrap');

    if (d.status === 'approved') {
      if (d.subscription && d.subscription.subStatus === 'expired') {
        gateOut.style.display = 'none';
        wrap.style.display = 'none';
        gateStatus.style.display = 'block';
        $('gateIcon').textContent = '🔔';
        $('gateTitle').textContent = 'Subscrição terminada';
        $('gateMsg').textContent = 'O seu trimestre de subscrição terminou e as suas publicações foram ocultadas da loja. Renove o seu pacote para voltar a publicar e a ser visto.';
        return;
      }
      if (d.plan.postsLeft <= 0) {
        gateOut.style.display = 'none';
        wrap.style.display = 'none';
        gateStatus.style.display = 'block';
        $('gateIcon').textContent = '📦';
        $('gateTitle').textContent = 'Plano esgotado';
        $('gateMsg').textContent = `O seu plano ${d.plan.label} permite ${d.plan.posts} publicações por trimestre e já foram todas usadas (${d.subscription.quarterStart ? 'até ' + new Date(d.subscription.quarterEnd).toLocaleDateString('pt-MZ') : 'este trimestre'}). Migre para um pacote superior e continue a publicar agora mesmo.`;
        $('gateUpBtn').style.display = 'inline-block';
        setTimeout(openUpgradeModal, 400);
        return;
      }
      gateOut.style.display = 'none';
      gateStatus.style.display = 'none';
      wrap.style.display = 'block';
      $('planBadge').textContent = `SEU PLANO: ${d.plan.label} por trimestre · ${d.plan.postsLeft} de ${d.plan.posts} publicações disponíveis`;
      loadBrands();
      return;
    }

    gateOut.style.display = 'none';
    wrap.style.display = 'none';
    gateStatus.style.display = 'block';
    if (d.status === 'rejected') {
      $('gateIcon').textContent = '✖';
      $('gateTitle').textContent = 'Registo recusado';
      $('gateMsg').textContent = (d.rejectionReason ? `Motivo: ${d.rejectionReason}. ` : '') + 'Contacte a administração.';
    } else if (d.paymentStatus !== 'paid') {
      $('gateIcon').textContent = '💳';
      $('gateTitle').textContent = 'Pagamento pendente';
      $('gateMsg').textContent = `Conclua o pagamento da subscrição (${d.plan.label}) para que o administrador analise o seu registo.`;
    } else {
      $('gateIcon').textContent = '🕐';
      $('gateTitle').textContent = 'Conta em aprovação';
      $('gateMsg').textContent = 'O seu pagamento foi confirmado. O administrador está a analisar o seu registo.';
    }
  } catch (e) {
    gateStatus.style.display = 'none';
    $('sellFormWrap').style.display = 'none';
    $('gateLoggedOut').style.display = 'block';
  }
}

/* ---------- Modal de upgrade de pacote ---------- */

let upPlans = [];

function openUpgradeModal() {
  $('upPlans').innerHTML = '<p style="color:var(--muted)">A carregar planos...</p>';
  $('upNote').textContent = '';
  $('upBackdrop').classList.add('open');
  if (currentSeller) {
    $('upCurrent').textContent = `${currentSeller.plan.label} · ${currentSeller.plan.posts} publicações`;
    $('upUsed').textContent = `${currentSeller.plan.postsUsed} utilizadas`;
  }
  fetch('/api/config')
    .then((r) => r.json())
    .then((cfg) => {
      upPlans = cfg.plans.filter((p) => currentSeller ? p.posts > currentSeller.plan.posts : true);
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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('upBackdrop').classList.contains('open')) closeUpgradeModal();
});

/* ---------- Fotografias ---------- */
const MAX_FILES = 8;
let selected = [];

const fileInput = $('photos');
const previewGrid = $('previewGrid');
const uploader = $('uploader');

function renderPreviews() {
  previewGrid.innerHTML = '';
  selected.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = 'p';
    d.innerHTML = `<img src="${URL.createObjectURL(f)}" alt="foto ${i + 1}" />${i === 0 ? '<span style="position:absolute;left:4px;bottom:4px;background:var(--red);color:#fff;font-size:.66rem;padding:2px 6px;border-radius:5px;font-weight:700">CAPA</span>' : ''}<button class="x" type="button">✕</button>`;
    d.querySelector('.x').onclick = () => { selected.splice(i, 1); renderPreviews(); };
    previewGrid.appendChild(d);
  });
  const lbl = uploader.querySelector('p');
  lbl.innerHTML = selected.length
    ? `<strong>${selected.length} foto(s) selecionada(s)</strong> — clique para adicionar mais`
    : '<strong>Clique para selecionar</strong> ou arraste as fotos aqui<br />JPG, PNG, WEBP ou GIF · máx. 5 MB cada';
}

fileInput.addEventListener('change', () => addFiles(Array.from(fileInput.files)));
uploader.addEventListener('dragover', (e) => e.preventDefault());
uploader.addEventListener('drop', (e) => {
  e.preventDefault();
  addFiles(Array.from(e.dataTransfer.files));
});

function addFiles(files) {
  for (const f of files) {
    if (!/^image\//.test(f.type)) { showAlert('Apenas imagens são permitidas (JPG, PNG, WEBP, GIF).'); continue; }
    if (f.size > 5 * 1024 * 1024) { showAlert(`A foto "${f.name}" excede 5 MB.`); continue; }
    if (selected.length >= MAX_FILES) { showAlert(`Máximo de ${MAX_FILES} fotos.`); break; }
    selected.push(f);
  }
  renderPreviews();
}

function loadBrands() {
  fetch('/api/brands')
    .then((r) => r.json())
    .then((brands) => {
      const dl = $('brandOptions');
      brands.forEach((b) => {
        const o = document.createElement('option');
        o.value = b;
        dl.appendChild(o);
      });
    })
    .catch(() => {});
}

/* ---------- Submissao ---------- */
$('sellForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  if (!selected.length) { showAlert('Adicione pelo menos uma foto do carro.'); return; }
  selected.forEach((f) => fd.append('photos', f));

  const btn = $('submitBtn');
  btn.disabled = true;
  btn.textContent = 'A submeter...';
  showAlert('', true);

  try {
    const r = await sapi('/api/cars', { method: 'POST', body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw d;
    showAlert('Anúncio submetido! Aguarde a aprovação do administrador.', true);
    setTimeout(() => (location.href = '/minha-conta'), 1200);
  } catch (err) {
    if (err && err.needUpgrade) {
      showAlert(err.error || 'Plano esgotado.', false);
      openUpgradeModal();
    } else {
      showAlert((err && err.error) || (err && err.message) || 'Erro ao submeter o anúncio.', false);
    }
    btn.disabled = false;
    btn.textContent = 'Submeter anúncio para aprovação';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

document.addEventListener('DOMContentLoaded', checkAccess);