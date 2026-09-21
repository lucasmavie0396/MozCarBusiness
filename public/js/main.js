/* ---------- Utilidades ---------- */
const money = (v) => Number(v).toLocaleString('pt-MZ') + ' MT';

async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.error) || `Erro (${r.status})`);
  return data;
}

/* ---------- Sessao do vendedor na loja ---------- */
const SELLER_TOKEN_KEY = 'mcb_seller_token';

async function loadSellerNav() {
  const token = localStorage.getItem(SELLER_TOKEN_KEY);
  if (!token) { syncMineToggle(); return; }
  try {
    const r = await fetch('/api/sellers/me', { headers: { 'x-seller-token': token } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.fullName) throw new Error();
    document.getElementById('navGuest').style.display = 'none';
    const ns = document.getElementById('navSeller');
    ns.style.display = 'inline-flex';
    document.getElementById('sellerName').textContent = '👤 ' + d.fullName;
    if (d.subscription && d.subscription.subStatus === 'expired' && !d.subscription.renewalPending) setTimeout(openRenew, 600);
  } catch {
    localStorage.removeItem(SELLER_TOKEN_KEY);
  }
  syncMineToggle();
}

function sellerLogout(e) {
  e.preventDefault();
  const token = localStorage.getItem(SELLER_TOKEN_KEY);
  if (token) fetch('/api/sellers/logout', { method: 'POST', headers: { 'x-seller-token': token } }).catch(() => {});
  localStorage.removeItem(SELLER_TOKEN_KEY);
  location.href = '/entrar';
}

/* ---------- Popup de renovação da subscrição ---------- */
const renewState = { plans: [] };

function openRenew() {
  document.getElementById('renewPlans').innerHTML = '<p style="color:var(--muted)">A carregar planos...</p>';
  document.getElementById('renewNote').textContent = '';
  document.getElementById('renewBackdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
  fetch('/api/config')
    .then((r) => r.json())
    .then((cfg) => {
      renewState.plans = cfg.plans;
      renderRenewPlans();
    })
    .catch(() => { document.getElementById('renewPlans').innerHTML = '<p style="color:var(--red)">Não foi possível carregar os planos.</p>'; });
}

function closeRenew() {
  document.getElementById('renewBackdrop').classList.remove('open');
  document.body.style.overflow = '';
}

function renderRenewPlans() {
  const list = document.getElementById('renewPlans');
  list.innerHTML = '';
  renewState.plans.forEach((p, i) => {
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
}

async function startRenew(btn) {
  const sel = document.getElementById('renewPlans').querySelector('input[name="renewPlan"]:checked');
  if (!sel) { document.getElementById('renewNote').textContent = 'Selecione um plano.'; return; }
  const token = localStorage.getItem(SELLER_TOKEN_KEY);
  if (!token) { location.href = '/entrar'; return; }
  btn.disabled = true;
  btn.textContent = 'A gerar referência...';
  try {
    const r = await fetch('/api/sellers/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-seller-token': token },
      body: JSON.stringify({ plan: sel.value }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Erro ao criar a renovação.');
    location.href = `/payment?renew=1&ref=${encodeURIComponent(d.reference)}&amount=${d.amount}`;
  } catch (e) {
    document.getElementById('renewNote').textContent = e.message;
    btn.disabled = false;
    btn.textContent = '🔁 Renovar agora →';
  }
}

/* ---------- Loja publica ---------- */
const state = { brands: [] };

async function loadBrands() {
  try {
    state.brands = await api('/api/brands');
    const sel = document.getElementById('fBrand');
    state.brands.forEach((b) => {
      const o = document.createElement('option');
      o.value = b;
      o.textContent = b;
      sel.appendChild(o);
    });
  } catch (e) { /* sem marcas ainda */ }
}

function renderGrid(cars) {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('emptyState');
  const meta = document.getElementById('countMeta');
  grid.innerHTML = '';

  if (!cars.length) {
    empty.style.display = 'block';
    meta.textContent = '0 resultados';
    return;
  }
  empty.style.display = 'none';
  meta.textContent = cars.length + (cars.length === 1 ? ' anúncio' : ' anúncios');

  cars.forEach((c) => {
    const card = document.createElement('article');
    card.className = 'card';
    card.onclick = () => openCar(c.id);
    const cover = c.photos && c.photos.length ? c.photos[0] : '';
    const yearBadge = c.year ? ` · ${c.year}` : '';
    card.innerHTML = `
      <div class="thumb">
        ${cover ? `<img src="${cover}" alt="${c.brand} ${c.model}" loading="lazy" />` : '<div style="width:100%;height:100%;display:grid;place-items:center;font-size:2.2rem">🚗</div>'}
        ${c.city ? `<span class="sell-tag">📍 ${escapeHtml(c.city)}</span>` : ''}
        ${c.photos.length > 1 ? `<span class="photo-count">📷 ${c.photos.length}</span>` : ''}
      </div>
      <div class="body">
        <div class="car-name">${escapeHtml(c.brand)} ${escapeHtml(c.model)}<small>${yearBadge}</small></div>
        <div class="specs">
          ${c.mileage != null ? `<span>⛽ ${Number(c.mileage).toLocaleString('pt-MZ')} km</span>` : ''}
          ${c.fuel ? `<span>⚡ ${escapeHtml(c.fuel)}</span>` : ''}
          ${c.transmission ? `<span>⚙ ${escapeHtml(c.transmission)}</span>` : ''}
        </div>
        <div class="price">${money(c.price)}</div>
      </div>
    `;
    grid.appendChild(card);
  });
}

async function loadCars() {
  const params = new URLSearchParams();
  const q = document.getElementById('q').value.trim();
  const brand = document.getElementById('fBrand').value;
  const fuel = document.getElementById('fFuel').value;
  const trans = document.getElementById('fTrans').value;
  const sort = document.getElementById('fSort').value;
  const priceMin = document.getElementById('fPriceMin').value.trim();
  const priceMax = document.getElementById('fPriceMax').value.trim();
  if (q) params.set('search', q);
  if (brand) params.set('brand', brand);
  if (fuel) params.set('fuel', fuel);
  if (trans) params.set('transmission', trans);
  if (priceMin) params.set('price_min', priceMin);
  if (priceMax) params.set('price_max', priceMax);
  params.set('sort', sort);

  try {
    let cars;
    if (mineActive) {
      const token = localStorage.getItem(SELLER_TOKEN_KEY);
      if (!token) { mineActive = false; syncMineToggle(); loadCars(); return; }
      const r = await fetch('/api/sellers/me/posts', { headers: { 'x-seller-token': token } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !Array.isArray(d.posts)) { renderGrid([]); return; }
      cars = d.posts.filter((p) => p.status === 'approved' && !p.hidden);
    } else {
      const d = await api('/api/cars?' + params.toString());
      cars = d.cars;
    }
    renderGrid(cars);
  } catch (e) {
    renderGrid([]);
  }
}

let mineActive = false;

function syncMineToggle() {
  const mt = document.getElementById('mineToggle');
  if (!mt) return;
  mt.classList.toggle('active', mineActive);
  mt.textContent = mineActive ? '🌐 Todos os anúncios' : '🔑 Os meus publicados';
  mt.style.display = mineActive || localStorage.getItem(SELLER_TOKEN_KEY) ? 'inline-flex' : 'none';
}

function showMine(e) {
  mineActive = !mineActive;
  syncMineToggle();
  loadCars();
}

function applyFilters() { loadCars(); return false; }

let priceTimer = null;
function debounceLoad() {
  clearTimeout(priceTimer);
  priceTimer = setTimeout(loadCars, 400);
}

/* ---------- Slideshow de publicidade ---------- */
const SLIDE_INTERVAL = 7000; /* 7 segundos */
const slider = { ads: [], idx: 0, timer: null, paused: false };

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

async function loadAds() {
  try {
    const d = await api('/api/ads');
    renderSlider(d.ads);
  } catch (e) {
    renderSlider([]);
  }
}

function renderSlider(ads) {
  const section = document.getElementById('sliderSection');
  const track = document.getElementById('slideTrack');
  const dots = document.getElementById('slideDots');
  const heroFallback = document.getElementById('fallbackHero');
  const searchbar = document.querySelector('.searchbar');

  slider.ads = ads;
  slider.idx = 0;
  stopSlider();

  if (!ads.length) {
    section.style.display = 'none';
    heroFallback.style.display = 'block';
    if (searchbar) searchbar.style.marginTop = '';
    track.innerHTML = '';
    dots.innerHTML = '';
    return;
  }

  heroFallback.style.display = 'none';
  section.style.display = 'block';
  if (searchbar) searchbar.style.marginTop = '24px';
  track.innerHTML = '';
  dots.innerHTML = '';

  ads.forEach((ad, i) => {
    const slide = document.createElement('div');
    slide.className = 'slide' + (i === 0 ? ' active' : '');
    let url = ad.link || '';
    if (url && !/^https?:\/\//i.test(url) && !url.startsWith('/')) url = 'https://' + url;
    slide.innerHTML = `
      <img src="${ad.image}" alt="${escapeHtml(ad.title)}" />
      <div class="slide-content">
        <h2>${escapeHtml(ad.title)}</h2>
        ${url ? `<a class="btn btn-primary slide-cta" href="${escapeHtml(url)}" target="_blank" rel="noopener">Ver oferta →</a>` : ''}
      </div>
    `;
    track.appendChild(slide);

    const dot = document.createElement('button');
    dot.className = 'sl-dot' + (i === 0 ? ' active' : '');
    dot.setAttribute('aria-label', 'Ir para publicidade ' + (i + 1));
    dot.onclick = () => { goToSlide(i); restartSlider(); };
    dots.appendChild(dot);
  });

  startSlider();
}

function goToSlide(i) {
  slider.idx = (i + slider.ads.length) % slider.ads.length;
  const track = document.getElementById('slideTrack');
  Array.from(track.children).forEach((s, j) => s.classList.toggle('active', j === slider.idx));
  const dots = document.getElementById('slideDots');
  Array.from(dots.children).forEach((d, j) => d.classList.toggle('active', j === slider.idx));
}

function slideNav(dir) {
  goToSlide(slider.idx + dir);
  restartSlider();
}

function startSlider() {
  stopSlider();
  if (slider.ads.length < 2) return;
  slider.timer = setInterval(() => {
    if (!slider.paused) goToSlide(slider.idx + 1);
  }, SLIDE_INTERVAL);
}

function stopSlider() {
  if (slider.timer) clearInterval(slider.timer);
  slider.timer = null;
}

function restartSlider() { startSlider(); }

function bindSliderHover() {
  const section = document.getElementById('sliderSection');
  if (!section) return;
  section.addEventListener('mouseenter', () => { slider.paused = true; });
  section.addEventListener('mouseleave', () => { slider.paused = false; });
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSellerNav();
  loadBrands();
  loadAds();
  bindSliderHover();
  const url = new URLSearchParams(location.search);
  if (url.get('q')) { document.getElementById('q').value = url.get('q'); }
  loadCars();
  document.getElementById('fPriceMin').addEventListener('input', debounceLoad);
  document.getElementById('fPriceMax').addEventListener('input', debounceLoad);
  const openId = Number(url.get('car'));
  if (openId) setTimeout(() => openCar(openId), 100);
});

/* ---------- Modal de detalhe ---------- */
let detailIdx = 0;
let detailCar = null;
let galleryImages = [];

function openCar(id) {
  api('/api/cars/' + id)
    .then((car) => {
      detailCar = car;
      galleryImages = car.photos && car.photos.length ? car.photos : [];
      detailIdx = 0;
      document.getElementById('modalTitle').textContent = 'Detalhes do carro';
      renderCarBody();
      document.getElementById('modalBackdrop').classList.add('open');
      document.body.style.overflow = 'hidden';
    })
    .catch((e) => alert(e.message));
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
  document.body.style.overflow = '';
}

function galleryNav(dir) {
  if (!galleryImages.length) return;
  detailIdx = (detailIdx + dir + galleryImages.length) % galleryImages.length;
  renderGallery();
}

function renderGallery() {
  const root = document.getElementById('modalBody');
  const wrap = document.getElementById('galleryWrap');
  if (!wrap) return;
  const main = root.querySelector('.g-main');
  const thumbs = root.querySelector('.thumbs');
  const count = root.querySelector('.g-count');
  if (!galleryImages.length) {
    wrap.innerHTML = '<div class="detail-title" style="padding:22px">Sem fotos</div>';
    return;
  }
  main.src = galleryImages[detailIdx];
  if (count) count.textContent = (detailIdx + 1) + ' / ' + galleryImages.length;
  if (thumbs) {
    thumbs.innerHTML = '';
    galleryImages.forEach((src, i) => {
      const t = document.createElement('img');
      t.src = src;
      t.className = i === detailIdx ? 'active' : '';
      t.onclick = () => { detailIdx = i; renderGallery(); };
      thumbs.appendChild(t);
    });
  }
}

function renderCarBody() {
  const c = detailCar;
  const body = document.getElementById('modalBody');
  const spec = (k, v) => (v == null || v === '' ? '' : `<div class="spec-box"><div class="k">${k}</div><div class="v">${v}</div></div>`);
  body.innerHTML = `
    <div id="galleryWrap" class="gallery">
      <img class="g-main" src="${galleryImages[0] || ''}" alt="${escapeHtml(c.brand)} ${escapeHtml(c.model)}" />
      ${galleryImages.length > 1 ? `
        <button class="g-nav prev" onclick="galleryNav(-1)">‹</button>
        <button class="g-nav next" onclick="galleryNav(1)">›</button>
        <span class="g-count">1 / ${galleryImages.length}</span>
      ` : ''}
    </div>
    <div class="thumbs" style="${galleryImages.length > 1 ? '' : 'display:none'}"></div>
    <div class="detail-body">
      <div class="detail-title">
        <div>${escapeHtml(c.brand)} ${escapeHtml(c.model)}<div class="detail-loc">${c.city ? '📍 ' + escapeHtml(c.city) : ''}</div></div>
        <div class="price">${money(c.price)}</div>
      </div>
      <div class="spec-grid">
        ${spec('Ano', c.year)}
        ${spec('Quilometragem', c.mileage != null ? Number(c.mileage).toLocaleString('pt-MZ') + ' km' : '')}
        ${spec('Combustível', c.fuel)}
        ${spec('Transmissão', c.transmission)}
        ${spec('Cor', c.color)}
        ${spec('Portas', c.doors)}
        ${spec('Lugares', c.seats)}
      </div>
      ${c.description ? `<div class="detail-desc">${escapeHtml(c.description)}</div>` : ''}
      ${sellerBox(c)}
    </div>
  `;
  renderGallery();
}

function sellerBox(c) {
  const s = c.seller;
  const name = escapeHtml((c.contact && c.contact.name) || (s && s.name) || 'Vendedor');
  const phone = escapeHtml((c.contact && c.contact.phone) || '—');
  const email = c.contact && c.contact.email ? `<div style="opacity:.8;font-size:.88rem;margin-top:2px">✉ ${escapeHtml(c.contact.email)}</div>` : '';
  const datePT = (iso) => iso ? new Date(iso).toLocaleDateString('pt-MZ', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  let extras = '';
  if (s) {
    const bits = [];
    if (s.verified) bits.push('<span class="badge approved" style="font-size:.72rem">✔ Verificado</span>');
    if (s.activePosts != null) bits.push(`<span style="opacity:.85">🚗 ${s.activePosts} anúncio(s) activo(s)</span>`);
    if (s.memberSince) bits.push(`<span style="opacity:.85">🗓 Vende na plataforma desde ${datePT(s.memberSince)}</span>`);
    if (bits.length) extras = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px;font-size:.85rem">${bits.join(' ')}</div>`;
  }
  return `
    <div class="contact-box">
      <div style="font-size:1.6rem">👤</div>
      <div style="flex:1">
        <div class="who">${name}</div>
        ${s && s.verified ? '<div style="opacity:.75;font-size:.84rem;margin-bottom:2px">Vendedor registado</div>' : ''}
        <div class="ph">📞 ${phone}</div>
        ${email}
        ${extras}
      </div>
      ${s && s.id ? `<button class="btn btn-outline btn-sm" style="align-self:center;white-space:nowrap" onclick="openSeller(${s.id})">👤 Ver Vendedor</button>` : ''}
    </div>
  `;
}

/* ---------- Perfil publico do vendedor ---------- */
const datePT = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-MZ', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

function openSeller(id) {
  api('/api/sellers/' + id + '/profile')
    .then((d) => {
      renderSellerBody(d);
      document.getElementById('modalTitle').textContent = 'Perfil do vendedor';
    })
    .catch((e) => alert(e.message));
}

function backToCar() {
  if (!detailCar) return closeModal();
  document.getElementById('modalTitle').textContent = 'Detalhes do carro';
  renderCarBody();
}

function renderSellerBody(d) {
  const body = document.getElementById('modalBody');
  const s = d.seller;
  const initials = escapeHtml((s.name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase());
  const cards = d.cars.length
    ? d.cars.map((c) => `
        <button type="button" class="seller-car" onclick="openCar(${c.id})">
          ${c.photos && c.photos.length ? `<img src="${c.photos[0]}" alt="" />` : '<span class="noimg">🚗</span>'}
          <span class="sc-body">
            <strong>${escapeHtml(c.brand)} ${escapeHtml(c.model)}</strong>
            <span class="sc-meta">${c.year || ''}${c.mileage != null ? ' · ' + Number(c.mileage).toLocaleString('pt-MZ') + ' km' : ''}</span>
            <span class="sc-price">${money(c.price)}</span>
          </span>
        </button>`).join('')
    : '<p style="color:var(--muted)">Este vendedor não tem anúncios activos neste momento.</p>';

  body.innerHTML = `
    <div class="detail-body">
      <button class="btn btn-ghost btn-sm" onclick="backToCar()">‹ Voltar ao carro</button>
      <div class="seller-head">
        <div class="seller-avatar">${initials}</div>
        <div style="flex:1">
          <h2 style="font-size:1.35rem">${escapeHtml(s.name)}
            ${s.verified ? '<span class="badge approved" style="font-size:.72rem;vertical-align:middle">✔ Verificado</span>' : ''}
          </h2>
          <div style="color:var(--muted);font-size:.92rem">
            ${s.city ? '📍 ' + escapeHtml(s.city) + ' · ' : ''}🗓 Vendedor desde ${datePT(s.memberSince)}
          </div>
        </div>
      </div>

      <div class="spec-grid" style="margin-top:16px">
        <div class="spec-box"><div class="k">Anúncios activos</div><div class="v">${s.activePosts}</div></div>
        <div class="spec-box"><div class="k">Telefone</div><div class="v">${escapeHtml(s.phone || '—')}</div></div>
        ${s.email ? `<div class="spec-box"><div class="k">E-mail</div><div class="v">${escapeHtml(s.email)}</div></div>` : ''}
        <div class="spec-box"><div class="k">Estado</div><div class="v">Vendedor verificado pela administração</div></div>
      </div>

      <div class="contact-box" style="margin-top:4px">
        <div style="font-size:1.6rem">📞</div>
        <div>
          <div class="who">Contactar ${escapeHtml(s.name)}</div>
          <div class="ph">${escapeHtml(s.phone || '—')}</div>
          ${s.email ? `<div style="opacity:.8;font-size:.88rem;margin-top:2px">✉ ${escapeHtml(s.email)}</div>` : ''}
        </div>
      </div>

      <h3 style="margin:20px 0 10px;font-size:1.1rem">🚗 Carros de ${escapeHtml(s.name)}</h3>
      <div class="seller-cars">${cards}</div>
    </div>
  `;
  body.scrollTop = 0;
}

document.getElementById('modalBackdrop') &&
  document.getElementById('modalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modalBackdrop') closeModal();
  });

document.getElementById('renewBackdrop') &&
  document.getElementById('renewBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'renewBackdrop') closeRenew();
  });

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('renewBackdrop').classList.contains('open')) { closeRenew(); return; }
  if (document.getElementById('modalBackdrop').classList.contains('open')) closeModal();
});