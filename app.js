/* 1. "The section": a background photo is drawn behind the whole
      page, cross-faded via the slider 
   2. Page niceties: nav highlighting, section reveals, topic
      pop-ups, email.
 */

(() => {
'use strict';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/*  noise  */

const imul = Math.imul;

function hash2(x, y, s){
  let h = imul(x | 0, 374761393) + imul(y | 0, 668265263) + imul(s | 0, 2654435761);
  h = imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise2(x, y, s){
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi,     yi,     s);
  const b = hash2(xi + 1, yi,     s);
  const c = hash2(xi,     yi + 1, s);
  const d = hash2(xi + 1, yi + 1, s);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, s, oct){
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < (oct || 4); i++){
    v += amp * noise2(x * f, y * f, s + i * 101);
    f *= 2; amp *= 0.5;
  }
  return v;
}

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth  = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

/* colour */

/* viridis, matplotlib anchor points */
const VIRIDIS = [[68,1,84],[72,40,120],[62,74,137],[49,104,142],[38,130,142],
                 [31,158,137],[53,183,121],[109,205,89],[253,231,37]];

function rampAt(stops, t){
  const x = clamp01(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i, a = stops[i], b = stops[i + 1];
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f
  ];
}

const cssRamp = stops =>
  'linear-gradient(90deg,' + stops.map(c => `rgb(${c[0]},${c[1]},${c[2]})`).join(',') + ')';

/* the section */

const canvas = document.getElementById('tissue');

if (canvas && canvas.getContext){
  const ctx = canvas.getContext('2d');

  const state = {
    seed: (Math.random() * 100000) | 0,
    zoom: 1,          /* 0.6 wide field → 2.0 close field */
    mix: 0,           /* 0 = stain, 1 = counts */
    allBins: false,   
    W: 0, H: 0, S: 1
  };

  const heLayer = document.createElement('canvas');
  const umiLayer = document.createElement('canvas');
  let field = null;

  /* background photo */
  const bgImage = new Image();
  bgImage.src = window.BG_IMAGE_DATA_URI || '1-A-Sea-of-Flowers.jpg';
  bgImage.onload = () => { if (state.W && state.H) render('field'); };

  function drawCover(g, img, W, H){
    const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
    g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  /*  tissue outline */
  function coverage(x, y, W, H, seed){
    const n  = fbm(x * 0.0017, y * 0.0017, seed + 31, 4);
    const ex = Math.min(x, W - x) / (W * 0.11);
    const ey = Math.min(y, H - y) / (H * 0.13);
    const edge = Math.min(1, Math.min(ex, ey));
    const v = 0.55 * n + 0.42 * edge + 0.17;

    /* the tear across the middle of the section */
    const fy = H * 0.52
             + H * 0.05 * Math.sin((x / W) * 4.6 + seed * 0.37)
             + 34 * (fbm(x * 0.0029, 11.5, seed + 5, 3) - 0.5);
    const fw = 4 + 26 * Math.max(0, fbm(x * 0.0032, 99.5, seed + 13, 3) * 1.9 - 0.55);
    const tear = smooth(fw, fw + 7, Math.abs(y - fy));

    return smooth(0.50, 0.56, v) * tear;
  }

  /*  photo loading */
  function samplePhoto(W, H){
    if (!(bgImage.complete && bgImage.naturalWidth)) return null;
    try {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      drawCover(g, bgImage, W, H);
      return g.getImageData(0, 0, W, H).data;
    } catch {
      console.warn('UMI counts view: the background photo could not be read, so every bin ' +
        'shows as zero. Keep bg-image.js next to index.html (or serve the site over http).');
      return null;
    }
  }

  function binLuminance(px, W, x0, y0, x1, y1){
    let sum = 0, n = 0;
    for (let y = y0; y < y1; y++){
      const row = y * W;
      for (let x = x0; x < x1; x++){
        const i = (row + x) * 4;
        sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        n++;
      }
    }
    return n ? clamp01(sum / n / 255) : 0;
  }

  /* tissue silhouette from */
  function buildField(W, H, seed, zoom){
    let bin = Math.max(6, Math.min(20, Math.round(9 * zoom)));
    while ((W / bin) * (H / bin) > 46000) bin += 1;

    const cols = Math.ceil(W / bin), rows = Math.ceil(H / bin);
    const val = new Float32Array(cols * rows);
    const cov = new Float32Array(cols * rows);
    const px = samplePhoto(W, H);

    for (let r = 0; r < rows; r++){
      const y0 = r * bin, y1 = Math.min(H, y0 + bin);
      const y = (r + 0.5) * bin;
      for (let c = 0; c < cols; c++){
        const x0 = c * bin, x1 = Math.min(W, x0 + bin);
        const x = (c + 0.5) * bin;
        const idx = r * cols + c;

        cov[idx] = coverage(x, y, W, H, seed);
        val[idx] = px ? binLuminance(px, W, x0, y0, x1, y1) : 0;
      }
    }
    return { cols, rows, bin, val, cov, W, H };
  }

  /* small canvas at bin resolution, used by both layers */
  function binCanvas(fd, paint){
    const c = document.createElement('canvas');
    c.width = fd.cols; c.height = fd.rows;
    const cc = c.getContext('2d');
    const img = cc.createImageData(fd.cols, fd.rows);
    const d = img.data;
    for (let i = 0; i < fd.cols * fd.rows; i++){
      const rgb = paint(fd.val[i], fd.cov[i], i);
      d[i * 4]     = rgb[0];
      d[i * 4 + 1] = rgb[1];
      d[i * 4 + 2] = rgb[2];
      d[i * 4 + 3] = 255;
    }
    cc.putImageData(img, 0, 0);
    return c;
  }

  /* first layer (background photo) */
  function drawHE(){
    const { W, H, S } = state;
    heLayer.width = Math.round(W * S);
    heLayer.height = Math.round(H * S);
    const g = heLayer.getContext('2d');
    g.setTransform(S, 0, 0, S, 0, 0);

    g.fillStyle = 'rgb(26,18,48)';
    g.fillRect(0, 0, W, H);
    if (bgImage.complete && bgImage.naturalWidth){
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      drawCover(g, bgImage, W, H);
    }
  }

  /* second layer (binned counts) */
  function drawUMI(fd){
    const { W, H, S } = state;
    umiLayer.width = Math.round(W * S);
    umiLayer.height = Math.round(H * S);
    const g = umiLayer.getContext('2d');
    g.setTransform(S, 0, 0, S, 0, 0);

    const stops = VIRIDIS;
    const off = state.allBins;
    const small = binCanvas(fd, (v, cv, i) => {
      if (cv > 0.45) return rampAt(stops, v * (0.35 + 0.65 * cv));
      if (off) return rampAt(stops, 0.015 + 0.05 * hash2(i, 3, 11));
      return [10, 6, 19];
    });

    g.fillStyle = 'rgb(10,6,19)';
    g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;
    g.drawImage(small, 0, 0, W, H);
  }

  /*  cross-fade  */
  function compose(){
    const { W, H, S, mix } = state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.drawImage(heLayer, 0, 0);
    if (mix > 0){
      ctx.globalAlpha = mix;
      ctx.drawImage(umiLayer, 0, 0);
      ctx.globalAlpha = 1;
    }
  }

  function render(what){
    if (!field || what === 'field'){
      field = buildField(state.W, state.H, state.seed, state.zoom);
      drawHE();
      drawUMI(field);
    } else if (what === 'umi'){
      drawUMI(field);
    }
    compose();
  }

  function resize(hard){
    const W = window.innerWidth;
    const H = window.innerHeight;
    state.S = Math.min(2, window.devicePixelRatio || 1);
    state.W = W; state.H = H;
    canvas.width = Math.round(W * state.S);
    canvas.height = Math.round(H * state.S);
    render(hard ? 'field' : 'field');
  }

  /*  controls */

  const mixEl   = document.getElementById('mix');
  const barEl   = document.getElementById('bar');
  const barRamp = document.getElementById('barRamp');
  const lens    = document.getElementById('lens');
  const toggle  = document.getElementById('lensToggle');
  const root    = document.documentElement;

  function paintSite(){
    const stops = VIRIDIS;
    const a = [192, 53, 122];
    const b = rampAt(stops, 0.78);
    const c = [30, 138, 133];
    const d = rampAt(stops, 0.95);
    const m = state.mix;
    const mixc = (p, q) => `rgb(${Math.round(p[0] + (q[0] - p[0]) * m)},` +
                               `${Math.round(p[1] + (q[1] - p[1]) * m)},` +
                               `${Math.round(p[2] + (q[2] - p[2]) * m)})`;
    /*root.style.setProperty('--live', mixc(a, b));
    root.style.setProperty('--live-2', mixc(c, d));*/
  }

  function setMix(v){
    state.mix = clamp01(v / 100);
    compose();
    paintSite();
    if (barEl) barEl.classList.toggle('is-on', state.mix > 0.02);
    if (mixEl) mixEl.setAttribute('aria-valuetext',
      state.mix < 0.02 ? 'Tissue image'
      : state.mix > 0.98 ? '8 µm bin UMI counts'
      : `${Math.round(state.mix * 100)}% UMI counts`);
  }

  if (mixEl){
    mixEl.addEventListener('input', () => setMix(+mixEl.value));
  }

  if (barRamp) barRamp.style.background = cssRamp(VIRIDIS);

  const zoomIn  = document.getElementById('zoomIn');
  const zoomOut = document.getElementById('zoomOut');
  const reseed  = document.getElementById('reseed');

  if (zoomIn)  zoomIn.addEventListener('click',  () => {
    state.zoom = Math.min(2.1, +(state.zoom * 1.25).toFixed(3)); render('field');
  });
  if (zoomOut) zoomOut.addEventListener('click', () => {
    state.zoom = Math.max(0.6, +(state.zoom / 1.25).toFixed(3)); render('field');
  });
  if (reseed)  reseed.addEventListener('click',  () => {
    state.seed = (Math.random() * 100000) | 0; render('field');
  });

  if (toggle && lens){
    toggle.addEventListener('click', () => {
      const shut = lens.classList.toggle('is-shut');
      toggle.setAttribute('aria-expanded', String(!shut));
    });
  }

  /*  lifecycle */

  let lastW = 0, lastH = 0, timer = null;
  window.addEventListener('resize', () => {
    if (Math.abs(window.innerWidth - lastW) < 40 &&
        Math.abs(window.innerHeight - lastH) < 140) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      lastW = window.innerWidth; lastH = window.innerHeight;
      resize(true);
    }, 220);
  });

  /* generate after first paint so the text is never blocked */
  requestAnimationFrame(() => {
    lastW = window.innerWidth; lastH = window.innerHeight;
    resize(true);
    setMix(mixEl ? +mixEl.value : 0);
    canvas.classList.add('is-on');
  });
}

/*  page: nav, reveals, topics, email  */

const links = Array.from(document.querySelectorAll('.topnav a'));
const sections = links
  .map(a => document.querySelector(a.getAttribute('href')))
  .filter(Boolean);

if ('IntersectionObserver' in window && sections.length){
  const spy = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      links.forEach(a =>
        a.classList.toggle('is-here', a.getAttribute('href') === '#' + e.target.id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach(s => spy.observe(s));
}

const panes = document.querySelectorAll('.band .sheet');
if ('IntersectionObserver' in window && !reduced && panes.length){
  panes.forEach(el => el.classList.add('reveal'));
  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach(e => {
      if (e.isIntersecting){ e.target.classList.add('in'); obs.unobserve(e.target); }
    });
  }, { rootMargin: '-40px' });
  panes.forEach(el => io.observe(el));
}

/* hide the control bar while the footer is visible, so it doesn't cover it */
const foot = document.getElementById('foot');
const lensBar = document.getElementById('lens');
if ('IntersectionObserver' in window && foot && lensBar){
  new IntersectionObserver(([e]) => {
    lensBar.classList.toggle('is-away', e.isIntersecting);
  }).observe(foot);
}

/* topic pop-up */
const topic = document.getElementById('topic');
if (topic){
  const tTag   = document.getElementById('topicTag');
  const tTitle = document.getElementById('topicTitle');
  const tBody  = document.getElementById('topicBody');

  document.querySelectorAll('.card').forEach(card => {
    const open = card.querySelector('.card__open');
    if (!open) return;
    open.addEventListener('click', () => {
      const tag = card.querySelector('.card__tag');
      const detail = card.querySelector('.card__detail');
      tTag.textContent   = tag ? tag.textContent : '';
      tTitle.textContent = open.textContent.trim();
      tBody.innerHTML    = detail ? detail.innerHTML : '';
      if (typeof topic.showModal === 'function') topic.showModal();
      else topic.setAttribute('open', '');
      topic.scrollTop = 0;
    });
  });

  /* click on the dimmed backdrop closes it (but not a click on its scrollbar) */
  topic.addEventListener('click', e => {
    if (e.target !== topic) return;
    const r = topic.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right &&
                   e.clientY >= r.top  && e.clientY <= r.bottom;
    if (!inside) topic.close();
  });
}

/* retreats gallery + photo viewer */
const shots  = Array.from(document.querySelectorAll('.gallery .shot'));
const viewer = document.getElementById('viewer');
const GALLERY_LIMIT = 8;   /* thumbnails shown before "Show all" */

if (shots.length > GALLERY_LIMIT){
  shots.slice(GALLERY_LIMIT).forEach(s => s.hidden = true);
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'gallery__more';
  more.textContent = `Show all ${shots.length} photos`;
  more.addEventListener('click', () => {
    shots.forEach(s => s.hidden = false);
    more.remove();
  });
  document.querySelector('.gallery').after(more);
}

if (viewer && shots.length){
  const vImg   = document.getElementById('viewerImg');
  const vCap   = document.getElementById('viewerCap');
  const vDesc  = document.getElementById('viewerDesc');
  const vCount = document.getElementById('viewerCount');
  const vPrev  = document.getElementById('viewerPrev');
  const vNext  = document.getElementById('viewerNext');
  let current = 0;

  function show(i){
    current = (i + shots.length) % shots.length;
    const shot  = shots[current];
    const btn   = shot.querySelector('.shot__open');
    const thumb = btn.querySelector('img');
    const cap   = shot.querySelector('.shot__cap');
    const desc  = shot.querySelector('.shot__desc');
    vImg.src = btn.dataset.full || thumb.src;
    vImg.alt = thumb.alt;
    vCap.textContent   = cap ? cap.textContent : '';
    vDesc.textContent  = desc ? desc.textContent.trim() : '';
    vCount.textContent = `${current + 1} / ${shots.length}`;
  }

  const single = shots.length < 2;
  vPrev.hidden = vNext.hidden = single;
  vPrev.addEventListener('click', () => show(current - 1));
  vNext.addEventListener('click', () => show(current + 1));

  shots.forEach((shot, i) => {
    shot.querySelector('.shot__open').addEventListener('click', () => {
      show(i);
      if (typeof viewer.showModal === 'function') viewer.showModal();
      else viewer.setAttribute('open', '');
    });
  });

  viewer.addEventListener('keydown', e => {
    if (single) return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); show(current - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(current + 1); }
  });

  /* click on the dimmed backdrop closes it */
  viewer.addEventListener('click', e => {
    if (e.target !== viewer) return;
    const r = viewer.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right &&
                   e.clientY >= r.top  && e.clientY <= r.bottom;
    if (!inside) viewer.close();
  });
}

document.querySelectorAll('.mail').forEach(mail => {
  const addr = `${mail.dataset.user}@${mail.dataset.domain}`;
  mail.href = 'mailto:' + addr;
  mail.textContent = `${mail.dataset.user} [at] ${mail.dataset.domain}`;
  mail.addEventListener('copy', e => {
    e.clipboardData.setData('text/plain', addr);
    e.preventDefault();
  });
});

})();
