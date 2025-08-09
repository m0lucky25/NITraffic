'use strict';

// Config
const DATA_URL = 'cam.json';

// State
let cameras = [];
let view = {
  regions: new Set(),
  activeRegions: new Set(),
  query: '',
  showFavouritesOnly: false,
  nearActive: false,
  userPos: null,
  rollingIdx: 0,
  rollingCycleTimer: null,
  countdownTimer: null,
  radiusMi: null,
};

// Elements
const el = {
  grid: document.getElementById('grid'),
  template: document.getElementById('cardTemplate'),
  camCount: document.getElementById('camCount'),
  statusText: document.getElementById('statusText'),
  searchInput: document.getElementById('searchInput'),
  btnNearMe: document.getElementById('btnNearMe'),
  btnRolling: document.getElementById('btnRolling'),
  btnRegions: document.getElementById('btnRegions'),
  btnFavs: document.getElementById('btnFavs'),
  regionModal: new bootstrap.Modal(document.getElementById('regionModal')),
  regionList: document.getElementById('regionList'),
  applyRegions: document.getElementById('applyRegions'),
  imageModal: new bootstrap.Modal(document.getElementById('imageModal')),
  modalImg: document.getElementById('modalImg'),
  modalTitle: document.getElementById('modalTitle'),
  modalSub: document.getElementById('modalSub'),
  btnFsToggle: document.getElementById('btnFsToggle'),
  btnSnapshot: document.getElementById('btnSnapshot'),
  btnFavToggle: document.getElementById('btnFavToggle'),
  rollingGrid: document.getElementById('rollingGrid'),
  rollingSection: document.getElementById('rollingSection'),
  rollCountdown: document.getElementById('rollCountdown'),
  gridSection: document.getElementById('grid'),
  mapSection: document.getElementById('mapSection'),
  btnMap: document.getElementById('btnMap'),
  btnRegions: document.getElementById('btnRegions'),
  radiusSelect: document.getElementById('radiusSelect'),
};

// Utilities
const favKey = 'lvni:favs';
const getFavs = () => new Set(JSON.parse(localStorage.getItem(favKey) || '[]'));
const setFavs = (s) => localStorage.setItem(favKey, JSON.stringify([...s]));

function kmDistance(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI/180;
  const dLon = (b.lon - a.lon) * Math.PI/180;
  const sLat1 = Math.sin(dLat/2);
  const sLon1 = Math.sin(dLon/2);
  const lat1 = a.lat * Math.PI/180;
  const lat2 = b.lat * Math.PI/180;
  const h = sLat1*sLat1 + Math.cos(lat1)*Math.cos(lat2)*sLon1*sLon1;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toMiles(km) { return km * 0.621371; }

// Fullscreen helpers
function enterFs(elm){
  if (elm.requestFullscreen) return elm.requestFullscreen();
  if (elm.webkitRequestFullscreen) return elm.webkitRequestFullscreen();
  if (elm.msRequestFullscreen) return elm.msRequestFullscreen();
}
function exitFs(){
  if (document.exitFullscreen) return document.exitFullscreen();
  if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
  if (document.msExitFullscreen) return document.msExitFullscreen();
}

function buildRegions() {
  view.regions = new Set(cameras.map(c => c.region).filter(Boolean));
  el.regionList.innerHTML = '';
  for (const r of [...view.regions].sort()) {
    const id = `region-${r.replace(/[^a-z0-9]/gi,'_')}`;
    const wrap = document.createElement('div');
    wrap.className = 'form-check form-check-inline';
    wrap.innerHTML = `
      <input class="form-check-input" type="checkbox" id="${id}" value="${r}" ${view.activeRegions.size===0 || view.activeRegions.has(r) ? 'checked' : ''}>
      <label class="form-check-label" for="${id}">${r}</label>
    `;
    el.regionList.appendChild(wrap);
  }
}

function cardNode(cam) {
  const node = el.template.content.firstElementChild.cloneNode(true);
  const img = node.querySelector('.cam-img');
  const title = node.querySelector('.cam-title');
  const region = node.querySelector('.cam-region');
  const distance = node.querySelector('.cam-distance');
  const distanceWrap = node.querySelector('.cam-distance-wrap');
  const favBtn = node.querySelector('.btn-fav');
  const openBtn = node.querySelector('.btn-open');
  const snapBtn = node.querySelector('.btn-snap-card');

  title.textContent = cam.camera_name;
  region.textContent = cam.region || '—';
  distance.textContent = cam.distanceMi != null ? `${cam.distanceMi.toFixed(1)} mi` : '—';
  if (view.nearActive && cam.distanceMi != null) {
    distanceWrap.classList.remove('d-none');
  } else {
    distanceWrap.classList.add('d-none');
  }
  img.dataset.src = cam.url;
  img.src = bust(cam.url);
  img.alt = cam.camera_name;
  img.classList.add('loading');
  img.addEventListener('load', () => img.classList.remove('loading'));

  function openImage() {
    el.modalTitle.textContent = cam.camera_name;
    el.modalImg.dataset.src = cam.url;
    el.modalImg.src = bust(cam.url);
    el.modalSub.textContent = cam.region || '';
    // Reflect favourite state in modal
    const favsNow = getFavs();
    const isFav = favsNow.has(cam.id);
    el.btnFavToggle.querySelector('i').classList.toggle('bi-star-fill', isFav);
    el.btnFavToggle.querySelector('i').classList.toggle('bi-star', !isFav);
    el.imageModal.show();
  }
  openBtn.addEventListener('click', openImage);
  img.addEventListener('click', openImage);

  // Snapshot from card
  snapBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try{
      const res = await fetch(bust(cam.url), {cache:'no-store'});
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g,'-');
      a.href = url;
      a.download = `${(cam.camera_name||'camera').replace(/[^a-z0-9-_ ]/gi,'_')}_${ts}.jpg`;
      document.body.appendChild(a);
      a.click(); a.remove(); URL.revokeObjectURL(url);
    }catch(err){ console.warn('Snapshot failed', err); window.open(cam.url, '_blank'); }
  });

  const favs = getFavs();
  if (favs.has(cam.id)) favBtn.firstElementChild.classList.replace('bi-star', 'bi-star-fill');

  favBtn.addEventListener('click', () => {
    const f = getFavs();
    if (f.has(cam.id)) {
      f.delete(cam.id);
      favBtn.firstElementChild.classList.replace('bi-star-fill', 'bi-star');
    } else {
      f.add(cam.id);
      favBtn.firstElementChild.classList.replace('bi-star', 'bi-star-fill');
    }
    setFavs(f);
    if (view.showFavouritesOnly) render();
  });

  return node;
}

function applyUserDistance() {
  if (!view.userPos) { cameras.forEach(c => { c.distanceKm = null; c.distanceMi = null; }); return; }
  const user = { lat: view.userPos.coords.latitude, lon: view.userPos.coords.longitude };
  cameras.forEach(c => {
    c.distanceKm = kmDistance(user, { lat: c.latitude, lon: c.longitude });
    c.distanceMi = toMiles(c.distanceKm);
  });

  // Modal favourite toggle
  el.btnFavToggle.addEventListener('click', () => {
    const title = el.modalTitle.textContent;
    const cam = cameras.find(c => c.camera_name === title);
    if (!cam) return;
    const f = getFavs();
    const isFav = f.has(cam.id);
    if (isFav) f.delete(cam.id); else f.add(cam.id);
    setFavs(f);
    // reflect icon
    el.btnFavToggle.querySelector('i').classList.toggle('bi-star-fill', !isFav);
    el.btnFavToggle.querySelector('i').classList.toggle('bi-star', isFav);
    render();
  });
}

function filtered() {
  let list = cameras.slice();
  if (view.activeRegions && view.activeRegions.size) {
    list = list.filter(c => view.activeRegions.has(c.region));
  }
  if (view.query) {
    const q = view.query.toLowerCase();
    list = list.filter(c => (c.camera_name||'').toLowerCase().includes(q) || (c.region||'').toLowerCase().includes(q));
  }
  if (view.showFavouritesOnly) {
    const f = getFavs();
    list = list.filter(c => f.has(c.id));
  }
  if (view.nearActive && view.userPos) {
    list = list.slice().sort((a,b)=> (a.distanceKm??Infinity)-(b.distanceKm??Infinity));
    if (view.radiusMi != null) list = list.filter(c => c.distanceMi != null && c.distanceMi <= view.radiusMi);
  }
  return list;
}

function render() {
  el.grid.innerHTML = '';
  const list = filtered();
  el.camCount.textContent = list.length;
  const frag = document.createDocumentFragment();
  list.forEach(cam => frag.appendChild(cardNode(cam)));
  el.grid.appendChild(frag);
}

// Cache-bust helper to keep images updating
function bust(url){
  try {
    const u = new URL(url, location.href);
    u.searchParams.set('t', Date.now());
    return u.toString();
  } catch { return url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(); }
}

function refreshAllImages() {
  const crossfade = (img) => {
    const base = img.dataset && img.dataset.src ? img.dataset.src : (img.src ? img.src.split('?')[0] : '');
    if (!base) return;
    const container = img.parentElement;
    if (!container) { img.src = base + '?t=' + Date.now(); return; }
    // Ensure container can host an absolute overlay
    const prevPos = getComputedStyle(container).position;
    if (prevPos === 'static' || !prevPos) container.style.position = 'relative';
    const ghost = new Image();
    ghost.className = 'img-ghost';
    // Style overlay to fully cover the original image area
    ghost.style.position = 'absolute';
    ghost.style.inset = '0';
    ghost.style.width = '100%';
    ghost.style.height = '100%';
    ghost.style.objectFit = img.style.objectFit || 'cover';
    ghost.style.opacity = '0';
    ghost.style.transition = 'opacity .35s ease';
    ghost.alt = img.alt || '';
    ghost.onload = () => {
      container.appendChild(ghost);
      // Trigger fade-in
      requestAnimationFrame(() => { ghost.style.opacity = '1'; });
      setTimeout(() => {
        img.src = ghost.src;
        img.dataset.src = base; // keep base
        ghost.remove();
      }, 350);
    };
    ghost.src = base + '?t=' + Date.now();
  };
  document.querySelectorAll('img.cam-img').forEach(crossfade);
  const m = document.getElementById('modalImg');
  if (m && document.getElementById('imageModal').classList.contains('show')) crossfade(m);
  document.querySelectorAll('img.rg-img').forEach(crossfade);
}

async function loadData() {
  try {
    el.statusText.textContent = 'Loading cameras…';
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to fetch cam.json');
    const data = await res.json();
    // Expecting flat array of objects with id, camera_name, region, url, latitude, longitude
    cameras = data.map(x => ({...x}));
    buildRegions();
    applyUserDistance();
    render();
    el.statusText.textContent = 'Loaded';
  } catch (err) {
    console.error(err);
    el.statusText.textContent = 'Error loading cameras';
  }
}

function setupEvents() {
  el.searchInput.addEventListener('input', (e) => {
    view.query = e.target.value.trim();
    render();
  });

  el.btnFavs.addEventListener('click', () => {
    view.showFavouritesOnly = !view.showFavouritesOnly;
    el.btnFavs.classList.toggle('btn-neo', view.showFavouritesOnly);
    el.btnFavs.classList.toggle('btn-neo-subtle', !view.showFavouritesOnly);
    render();
  });

  el.btnRegions.addEventListener('click', () => {
    buildRegions();
    el.regionModal.show();
  });

  // Toggle Map view
  el.btnMap.addEventListener('click', () => {
    const showing = !el.mapSection.hasAttribute('hidden');
    if (showing) {
      el.mapSection.setAttribute('hidden','');
      el.gridSection.removeAttribute('hidden');
      el.btnMap.classList.remove('btn-neo');
      el.btnMap.classList.add('btn-neo-subtle');
    } else {
      el.gridSection.setAttribute('hidden','');
      el.rollingSection.setAttribute('hidden','');
      el.mapSection.removeAttribute('hidden');
      sizeMap();
      initMap();
      el.btnMap.classList.add('btn-neo');
      el.btnMap.classList.remove('btn-neo-subtle');
    }
  });

  // Reactive region filtering (apply immediately)
  el.regionList.addEventListener('change', () => {
    const selected = new Set([...el.regionList.querySelectorAll('input:checked')].map(i => i.value));
    view.activeRegions = selected; // empty set means all
    render();
  });

  el.btnNearMe.addEventListener('click', () => {
    if (!('geolocation' in navigator)) {
      el.statusText.textContent = 'Geolocation not supported';
      return;
    }
    // Toggle near me on/off
    if (view.nearActive) {
      view.nearActive = false;
      el.btnNearMe.classList.remove('btn-neo');
      el.btnNearMe.classList.add('btn-neo-subtle');
      view.userPos = view.userPos; // keep cached but stop sorting
      render();
      el.statusText.textContent = 'Showing all cameras';
      // hide radius selector
      if (el.radiusSelect) { el.radiusSelect.classList.add('d-none'); el.radiusSelect.value = ''; view.radiusMi = null; }
      return;
    }
    el.statusText.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition(pos => {
      view.userPos = pos;
      view.nearActive = true;
      applyUserDistance();
      render();
      el.btnNearMe.classList.add('btn-neo');
      el.btnNearMe.classList.remove('btn-neo-subtle');
      el.statusText.textContent = 'Sorted by distance';
      // show radius selector
      if (el.radiusSelect) { el.radiusSelect.classList.remove('d-none'); }
    }, err => {
      console.warn(err);
      el.statusText.textContent = 'Location permission denied';
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });

  // Radius change
  if (el.radiusSelect) {
    el.radiusSelect.addEventListener('change', () => {
      const v = el.radiusSelect.value;
      view.radiusMi = v ? Number(v) : null;
      render();
    });
  }

  // Rolling Grid 2x2 inline cycling
  function renderRollingFrame() {
    const imgs = el.rollingGrid.querySelectorAll('img.rg-img');
    const list = filtered();
    for (let i=0;i<4;i++) {
      const cam = list[(view.rollingIdx + i) % list.length];
      const img = imgs[i];
      img.classList.add('hide');
      setTimeout(() => {
        img.dataset.src = cam.url;
        img.src = bust(cam.url);
        img.alt = cam.camera_name;
        img.classList.remove('hide');
      }, 200);
    }
    view.rollingIdx = (view.rollingIdx + 4) % Math.max(4, list.length);
  }
  function startRolling() {
    renderRollingFrame();
    if (view.rollingCycleTimer) clearInterval(view.rollingCycleTimer);
    view.rollingCycleTimer = setInterval(renderRollingFrame, 10000);
    // countdown
    let remain = 10;
    el.rollCountdown.textContent = remain;
    if (view.countdownTimer) clearInterval(view.countdownTimer);
    view.countdownTimer = setInterval(() => {
      remain = remain <= 1 ? 10 : remain - 1;
      el.rollCountdown.textContent = remain;
    }, 1000);
  }
  function stopRolling() {
    if (view.rollingCycleTimer) clearInterval(view.rollingCycleTimer);
    view.rollingCycleTimer = null;
    if (view.countdownTimer) clearInterval(view.countdownTimer);
    view.countdownTimer = null;
  }
  el.btnRolling.addEventListener('click', () => {
    const showing = !el.rollingSection.hasAttribute('hidden');
    if (showing) {
      el.rollingSection.setAttribute('hidden','');
      el.gridSection.removeAttribute('hidden');
      stopRolling();
      el.btnRolling.classList.remove('btn-neo');
      el.btnRolling.classList.add('btn-neo-subtle');
    } else {
      el.gridSection.setAttribute('hidden','');
      el.rollingSection.removeAttribute('hidden');
      sizeRollingGrid();
      startRolling();
      el.btnRolling.classList.add('btn-neo');
      el.btnRolling.classList.remove('btn-neo-subtle');
    }
  });
  // stop rolling when navigating away (best-effort)
  window.addEventListener('visibilitychange', () => { if (document.hidden) stopRolling(); });

  // Responsive sizing for rolling grid so it never overflows viewport
  function sizeRollingGrid() {
    if (el.rollingSection.hasAttribute('hidden')) return;
    const top = el.rollingGrid.getBoundingClientRect().top;
    const available = Math.max(200, Math.floor(window.innerHeight - top - 16));
    el.rollingGrid.style.height = available + 'px';
  }
  window.addEventListener('resize', sizeRollingGrid);
  window.addEventListener('resize', sizeMap);

  // Google Maps integration
  window.initMap = function initMap() {
    if (view._map) return; // init once
    const mapEl = document.getElementById('map');
    if (!mapEl) return;
    const center = { lat: 54.607868, lng: -5.926437 }; // Belfast default
    const darkStyles = [
      { elementType: 'geometry', stylers: [{ color: '#0b1117' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#0b1117' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
      { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#a7b4c8' }] },
      { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
      { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0f1720' }] },
      { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a242f' }] },
      { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0f1720' }] },
      { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
      { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#16202a' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d131a' }] },
      { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] }
    ];
    const map = new google.maps.Map(mapEl, { center, zoom: 8, styles: darkStyles, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
    view._map = map;
    populateMapMarkers();
  };

  function populateMapMarkers() {
    if (!view._map || !Array.isArray(cameras) || cameras.length === 0) return;
    if (view._mapMarkersAdded) return;
    view._mapMarkersAdded = true;
    const map = view._map;
    const infowindow = new google.maps.InfoWindow();
    cameras.forEach(cam => {
      if (!cam.latitude || !cam.longitude) return;
      const marker = new google.maps.Marker({ position: { lat: Number(cam.latitude), lng: Number(cam.longitude) }, map, title: cam.camera_name });
      marker.addListener('click', () => {
        const imgUrl = (cam.url || '').split('?')[0] + '?t=' + Date.now();
        const html = `
          <div style="min-width:220px;max-width:260px">
            <div style=\"font-weight:700\" class=\"mb-1\">${cam.camera_name||''}</div>
            <div class=\"text-secondary mb-2\" style=\"font-size:.85rem\">${cam.region||''}</div>
            <img src=\"${imgUrl}\" alt=\"${cam.camera_name||'camera'}\" style=\"width:100%;height:140px;object-fit:cover;border-radius:8px;border:1px solid rgba(57,255,20,.25)\"/>
            <div class=\"mt-2 d-flex gap-2\">
              <button id=\"gm-open\" class=\"btn btn-sm btn-outline-neo\">Open</button>
              <a id=\"gm-snap\" class=\"btn btn-sm btn-outline-neo\" href=\"${imgUrl}\" download>Snapshot</a>
            </div>
          </div>`;
        infowindow.setContent(html);
        infowindow.open(map, marker);
        google.maps.event.addListenerOnce(infowindow, 'domready', () => {
          const openBtn = document.getElementById('gm-open');
          if (openBtn) openBtn.addEventListener('click', () => {
            el.modalTitle.textContent = cam.camera_name;
            el.modalSub.textContent = cam.region || '';
            el.modalImg.dataset.src = cam.url;
            el.modalImg.src = bust(cam.url);
            el.imageModal.show();
          });
        });
      });
    });
  }

  function sizeMap() {
    const mapEl = document.getElementById('map');
    if (!mapEl || el.mapSection.hasAttribute('hidden')) return;
    const top = mapEl.getBoundingClientRect().top;
    const available = Math.max(240, Math.floor(window.innerHeight - top - 16));
    mapEl.style.height = available + 'px';
    if (view._map) google.maps.event.trigger(view._map, 'resize');
  }

  // Fullscreen toggle button inside modal
  el.btnFsToggle.addEventListener('click', () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      exitFs();
    } else {
      enterFs(el.modalImg);
    }
  });

  // Click image in overlay to go fullscreen
  el.modalImg.addEventListener('click', () => {
    enterFs(el.modalImg);
  });

  // Click image in rolling grid to go fullscreen
  el.rollingGrid.addEventListener('click', (e) => {
    const img = e.target.closest('img.rg-img');
    if (!img) return;
    enterFs(img);
  });

  // Snapshot download
  el.btnSnapshot.addEventListener('click', async () => {
    try{
      const src = el.modalImg.src.split('?')[0];
      const res = await fetch(bust(src), {cache:'no-store'});
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g,'-');
      a.href = url;
      a.download = `${(el.modalTitle.textContent||'camera').replace(/[^a-z0-9-_ ]/gi,'_')}_${ts}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }catch(err){
      console.warn('Snapshot failed, opening in new tab', err);
      window.open(el.modalImg.src, '_blank');
    }
  });
}

// Init
setupEvents();
loadData();
setInterval(refreshAllImages, 2000);
