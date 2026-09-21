/* ---------- Registo de vendedor ---------- */

const $ = (id) => document.getElementById(id);
const alertBox = $('alertBox');

function showAlert(msg, ok) {
  alertBox.textContent = msg || '';
  alertBox.className = 'alert ' + (msg ? 'show ' + (ok ? 'alert-success' : 'alert-error') : '');
}

/* --- Planos --- */
let plans = [];
function renderPlans() {
  const list = $('planList');
  list.innerHTML = '';
  plans.forEach((p, i) => {
    const el = document.createElement('label');
    el.className = 'plan-card' + (i === 0 ? ' selected' : '');
    el.innerHTML = `
      <input type="radio" name="plan" value="${p.code}" ${i === 0 ? 'checked' : ''} />
      <div class="plan-fee">${p.label}</div>
      <div class="plan-posts">até <strong>${p.posts}</strong> publicações/trimestre</div>
    `;
    el.querySelector('input').addEventListener('change', () => {
      list.querySelectorAll('.plan-card').forEach((c, j) => c.classList.toggle('selected', j === i));
    });
    list.appendChild(el);
  });
}

fetch('/api/config')
  .then((r) => r.json())
  .then((cfg) => { plans = cfg.plans; renderPlans(); })
  .catch(() => {});

/* --- Localizacao --- */
let locationShared = null;
$('locBtn').addEventListener('click', () => {
  if (!navigator.geolocation) return showAlert('O seu navegador não suporta partilha de localização.');
  const btn = $('locBtn');
  btn.disabled = true;
  btn.textContent = 'A obter localização...';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      locationShared = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      $('locResult').style.display = 'block';
      $('locCoords').textContent = `Latitude ${pos.coords.latitude.toFixed(5)}, Longitude ${pos.coords.longitude.toFixed(5)}`;
      btn.textContent = '📍 Localização partilhada ✔';
      btn.style.borderColor = 'var(--green)';
      showAlert('', true);
    },
    (err) => {
      showAlert('Não foi possível obter a localização. Active o GPS e tente novamente.', false);
      btn.disabled = false;
      btn.textContent = '📍 Partilhar localização agora';
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

/* --- Pre-visualizacao --- */
function wirePreview(inputId, previewId) {
  const input = $(inputId);
  const preview = $(previewId);
  input.addEventListener('change', () => {
    const f = input.files[0];
    preview.innerHTML = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) { showAlert('Apenas imagens são permitidas.', false); input.value = ''; return; }
    const img = document.createElement('img');
    img.src = URL.createObjectURL(f);
    preview.appendChild(img);
  });
}
wirePreview('idFront', 'prevFront');
wirePreview('idBack', 'prevBack');
wirePreview('selfie', 'prevSelfie');

/* --- Submissao --- */
$('regForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);

  const pwd = fd.get('password');
  if (pwd !== fd.get('password2')) return showAlert('As palavras-passe não coincidem.', false);
  const planInput = form.querySelector('input[name="plan"]:checked');
  if (!planInput) return showAlert('Selecione um plano.', false);
  if (!locationShared) return showAlert('Partilhe a sua localização.', false);

  fd.set('plan', planInput.value);
  fd.set('location_lat', String(locationShared.lat));
  fd.set('location_lng', String(locationShared.lng));
  fd.delete('password2');

  if (!fd.get('id_front') || !fd.get('id_back') || !fd.get('selfie')) {
    return showAlert('Adicione o documento (frente e verso) e a selfie.', false);
  }

  const btn = $('submitBtn');
  btn.disabled = true;
  btn.textContent = 'A submeter...';
  showAlert('', true);

  try {
    const r = await fetch('/api/sellers', { method: 'POST', body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Erro ao submeter o registo.');
    showAlert(`Registo criado! Referência ${d.paymentReference}. A redirecionar para o pagamento...`, true);
    setTimeout(() => {
      location.href = `/payment?id=${d.sellerId}&ref=${encodeURIComponent(d.paymentReference)}&amount=${d.paymentAmount}`;
    }, 900);
  } catch (err) {
    showAlert(err.message, false);
    btn.disabled = false;
    btn.textContent = 'Submeter registo e gerar referência de pagamento →';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});