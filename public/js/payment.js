/* ---------- Pagamento do registo / renovação da subscrição ---------- */

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const renewMode = params.get('renew') === '1';
const upgradeMode = params.get('upgrade') === '1';
const sellerId = params.get('id');
const reference = params.get('ref') || '';
const amount = params.get('amount') || '';

const alertBox = $('alertBox');
const okBox = $('okBox');

function showAlert(msg, ok) {
  alertBox.textContent = '';
  okBox.textContent = '';
  alertBox.className = 'alert';
  okBox.className = 'alert';
  if (!msg) return;
  (ok ? okBox : alertBox).textContent = msg;
  (ok ? okBox : alertBox).className = 'alert show ' + (ok ? 'alert-success' : 'alert-error');
}

const moneyMT = (v) => Number(v).toLocaleString('pt-MZ') + ' MT';

if (renewMode) {
  $('payTitle').textContent = 'Renovar a subscrição 💳';
  $('paySub').textContent = 'O seu trimestre de subscrição terminou. Pague a renovação (3 meses) e o administrador confirma — as suas publicações voltam a ficar visíveis.';
  $('periodLabel').textContent = 'Referência de renovação';
  $('amountLabel').textContent = 'VALOR DA RENOVAÇÃO (TRIMESTRE)';
  $('statusTitle').textContent = '📋 Estado da sua renovação';
} else if (upgradeMode) {
  $('payTitle').textContent = 'Atualizar o pacote ▲';
  $('paySub').textContent = 'Está a mudar para um pacote com mais publicações neste trimestre. Pague apenas a diferença do valor — a atualização é aplicada de imediato após o pagamento.';
  $('periodLabel').textContent = 'Referência de upgrade';
  $('amountLabel').textContent = 'VALOR A PAGAR (DIFERENÇA DO PACOTE)';
  $('statusTitle').textContent = '📋 Resultado do upgrade';
  $('step3').innerHTML = 'Submeta. A atualização do pacote é aplicada <strong>de imediato</strong> e pode voltar a publicar.';
}

$('refValue').textContent = reference || '---';
$('amountValue').textContent = reference ? moneyMT(amount) : '---';

fetch('/api/config')
  .then((r) => r.json())
  .then((c) => {
    $('mpesaNum').textContent = c.contactPhone;
    $('emolaNum').textContent = c.contactPhone.replace(/^84/, '82');
    if (!reference) $('amountValue').textContent = moneyMT(c.plans[0].fee);
  })
  .catch(() => {});

if (!sellerId && reference && !renewMode) trackReference(reference);

const renewTx = () => localStorage.getItem('mcb_seller_token') || '';

async function trackReference(ref) {
  try {
    const r = await fetch('/api/track?reference=' + encodeURIComponent(ref));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Erro na consulta.');
    renderStatus(d);
    $('refValue').textContent = d.paymentReference;
    $('amountValue').textContent = moneyMT(d.paymentAmount);
  } catch (e) {
    showAlert(e.message, false);
  }
}

$('payBtn').addEventListener('click', async () => {
  const tx = $('transaction').value.trim();
  if (!tx) { showAlert('Indique o número/ID da transação M-Pesa ou E-Mola.'); return; }
  const btn = $('payBtn');
  btn.disabled = true;
  btn.textContent = 'A confirmar...';
  showAlert('', true);

  if (renewMode) {
    const token = renewTx();
    if (!token) {
      showAlert('Inicie sessão como vendedor para concluir a renovação.', false);
      btn.disabled = false;
      btn.textContent = 'Confirmar pagamento ✔';
      return;
    }
    try {
      const r = await fetch('/api/sellers/renew/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-seller-token': token },
        body: JSON.stringify({ reference, transaction: tx }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Erro ao confirmar pagamento.');
      btn.textContent = '✔ Confirmado';
      showAlert(d.message || 'Pagamento recebido!', true);
      renderRenewalStatus(d);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      showAlert(e.message, false);
      btn.disabled = false;
      btn.textContent = 'Confirmar pagamento ✔';
    }
    return;
  }

  if (upgradeMode) {
    const token = renewTx();
    if (!token) {
      showAlert('Inicie sessão como vendedor para concluir a atualização do pacote.', false);
      btn.disabled = false;
      btn.textContent = 'Confirmar pagamento ✔';
      return;
    }
    try {
      const r = await fetch('/api/sellers/upgrade/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-seller-token': token },
        body: JSON.stringify({ reference, transaction: tx }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Erro ao confirmar pagamento.');
      btn.textContent = '✔ Confirmado';
      showAlert(d.message || 'Pacote atualizado!', true);
      renderUpgradeStatus(d);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      showAlert(e.message, false);
      btn.disabled = false;
      btn.textContent = 'Confirmar pagamento ✔';
    }
    return;
  }

  try {
    const r = await fetch(`/api/sellers/${sellerId}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: tx }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Erro ao confirmar pagamento.');
    btn.textContent = '✔ Confirmado';
    showAlert(d.message || 'Pagamento confirmado!', true);
    trackReference(reference).catch(() => {});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    showAlert(e.message, false);
    btn.disabled = false;
    btn.textContent = 'Confirmar pagamento ✔';
  }
});

function renderRenewalStatus() {
  const card = $('statusCard');
  const body = $('statusBody');
  body.innerHTML = `
    <div style="margin:10px 0"><span class="badge paypaid">💳 Pagamento da renovação confirmado</span> <span class="badge pending">🕐 A aguardar aprovação do administrador</span></div>
    <p style="color:var(--muted);font-size:.9rem">Assim que a administração confirmar, um novo trimestre inicia e as suas publicações voltam a ficar visíveis na loja.</p>
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
      <a href="/minha-conta" class="btn btn-primary btn-sm">Ir para a minha conta</a>
    </div>
  `;
  card.style.display = 'block';
}

function renderUpgradeStatus(d) {
  const card = $('statusCard');
  const body = $('statusBody');
  const p = d.plan || {};
  body.innerHTML = `
    <div><span class="badge paypaid">✔ Pacote atualizado</span></div>
    <div style="margin-top:10px">Agora no plano <strong>${p.label || ''}</strong> · até <strong>${p.posts || ''}</strong> publicações/trimestre</div>
    <div style="color:var(--muted);font-size:.9rem;margin-top:6px">${p.postsLeft != null ? `Publicações disponíveis neste trimestre: <strong>${p.postsLeft}</strong>` : ''}</div>
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
      <a href="/sell" class="btn btn-primary btn-sm">Continuar a publicar ▶</a>
      <a href="/minha-conta" class="btn btn-outline btn-sm">Ir para a minha conta</a>
    </div>
  `;
  card.style.display = 'block';
}

function renderStatus(t) {
  const card = $('statusCard');
  const body = $('statusBody');
  const ok = [];
  if (t.paymentStatus === 'paid') ok.push('<span class="badge paypaid">💳 Pagamento confirmado</span>');
  else ok.push('<span class="badge paypending">💤 Pagamento pendente</span>');

  if (t.status === 'approved') ok.push('<span class="badge approved">✔ Registo aprovado</span>');
  else if (t.status === 'rejected') ok.push(`<span class="badge rejected">✖ Registo recusado${t.rejectionReason ? ': ' + t.rejectionReason : ''}</span>`);
  else ok.push('<span class="badge pending">🕐 Em análise</span>');

  body.innerHTML = `
    <div>Nome: <strong>${t.name || ''}</strong></div>
    <div style="margin-top:6px">Plano: <strong>${t.planLabel || ''}</strong></div>
    <div style="margin:10px 0">${ok.join(' ')}</div>
    ${t.paymentStatus === 'paid' && t.status !== 'approved'
      ? '<p style="color:var(--muted);font-size:.9rem">Aguarde a aprovação do administrador. Pode acompanhar o estado entrando na sua conta.</p>'
      : ''}
  `;
  card.style.display = 'block';
}

function askRef(e) {
  const ref = prompt('Indique a referência de pagamento:');
  if (ref) location.href = '/payment?ref=' + encodeURIComponent(ref.trim());
  e.preventDefault();
  return false;
}