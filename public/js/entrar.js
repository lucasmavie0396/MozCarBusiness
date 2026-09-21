/* ---------- Login único: vendedor (e-mail) ou administrador ---------- */
const SELLER_KEY = 'mcb_seller_token';
const ADMIN_KEY = 'mcb_admin_token';

function alertBox() { return document.getElementById('alertBox'); }
function showAlert(msg) {
  const a = alertBox();
  a.className = 'alert alert-error show';
  a.textContent = msg || '';
}

function showSetup() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('setupForm').style.display = 'block';
  document.getElementById('pageTitle').textContent = 'Primeiro acesso';
  document.getElementById('pageSub').textContent = 'Não existe nenhuma conta de administrador. Crie as credenciais de acesso ao painel.';
  showAlert('');
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  showAlert('');
  btn.disabled = true;
  btn.textContent = 'A entrar...';
  const user = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  try {
    const next = new URLSearchParams(location.search).get('next') || '/minha-conta';

    const sr = await fetch('/api/sellers/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user, password }),
    });
    if (sr.ok) {
      const d = await sr.json();
      localStorage.setItem(SELLER_KEY, d.token);
      location.href = next;
      return;
    }

    const ar = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password }),
    });
    const ad = await ar.json().catch(() => ({}));
    if (ar.ok) {
      localStorage.setItem(ADMIN_KEY, ad.token);
      location.href = '/admin';
      return;
    }
    if (ar.status === 409 && ad.needsSetup) { showSetup(); return; }

    throw new Error('E-mail/utilizador ou palavra-passe incorretos.');
  } catch (err) {
    showAlert(err.message);
    btn.disabled = false;
    btn.textContent = 'Iniciar sessão';
  }
});

document.getElementById('setupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const alert = document.getElementById('alertBox');
  alert.className = 'alert alert-error';
  alert.textContent = '';
  const btn = document.getElementById('setupBtn');
  btn.disabled = true;
  btn.textContent = 'A criar...';
  const email = document.getElementById('setupEmail').value.trim();
  const pass = document.getElementById('setupPass').value;
  const pass2 = document.getElementById('setupPass2').value;
  try {
    if (pass !== pass2) throw new Error('As palavras-passe não coincidem.');
    const r = await fetch('/api/admin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Não foi possível criar a conta de administrador.');
    localStorage.setItem(ADMIN_KEY, d.token);
    location.href = '/admin';
  } catch (err) {
    alert.className = 'alert alert-error show';
    alert.textContent = err.message;
    btn.disabled = false;
    btn.textContent = 'Criar administrador';
  }
});

(async () => {
  try {
    const r = await fetch('/api/admin/status');
    const d = await r.json();
    if (d && d.adminExists === false) showSetup();
  } catch (e) { /* offline: manter o login normal */ }
})();