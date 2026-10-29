(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var video = $('player');
  var bigPlay = $('big-play');
  var note = $('note');
  var nextBtn = $('next-overlay');
  var qWrap = $('quality-wrap');
  var qSel = $('quality');

  // 选集数据只写在 HTML 里,这里读出来
  var eps = Array.prototype.slice.call(document.querySelectorAll('.ep')).map(function (a, i) {
    var txt = function (sel) { return a.querySelector(sel).textContent.trim(); };
    return {
      i: i, id: 'ep' + (i + 1), el: a,
      src: a.getAttribute('data-src'),
      poster: a.getAttribute('data-poster'),
      accent: a.getAttribute('data-accent'),
      points: a.getAttribute('data-points').split('|'),
      no: txt('.ep-no'), title: txt('.ep-title'), style: txt('.ep-style'), blurb: txt('.ep-blurb')
    };
  });

  // 苹果设备用系统自带的 HLS 播放,其余浏览器用 hls.js
  var ua = navigator.userAgent;
  var appleWebKit = /iP(hone|ad|od)/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ||
    (/Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Android|Edg\/|OPR/.test(ua));
  var nativeHls = !!video.canPlayType('application/vnd.apple.mpegurl');
  var hlsJs = !!(window.Hls && window.Hls.isSupported());
  var mode = nativeHls && (appleWebKit || !hlsJs) ? 'native' : (hlsJs ? 'hlsjs' : 'none');

  var hls = null, cur = -1, pendingSeek = 0, started = false, manifestReady = false, retries = 0, lastSave = 0;

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) {
    try { if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch (e) {}
  }
  function fmt(t) { t = Math.max(0, Math.floor(t)); return Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2); }

  function setNote(text, btnText, onBtn) {
    note.textContent = text;
    if (btnText) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = btnText;
      b.addEventListener('click', onBtn);
      note.appendChild(document.createTextNode(' '));
      note.appendChild(b);
    }
    note.hidden = false;
  }
  function clearNote() { note.hidden = true; note.textContent = ''; }

  // ---------- 清晰度 ----------
  function addOpt(v, t) {
    var o = document.createElement('option');
    o.value = String(v);
    o.textContent = t;
    qSel.appendChild(o);
  }
  function buildQuality() {
    qSel.textContent = '';
    addOpt(-1, '自动');
    hls.levels
      .map(function (l, idx) { return { idx: idx, h: l.height }; })
      .sort(function (a, b) { return b.h - a.h; })
      .forEach(function (it) { addOpt(it.idx, it.h + 'p'); });
    qSel.value = '-1';
    qWrap.hidden = hls.levels.length < 2;
  }
  function autoLabel() {
    if (!hls || !hls.autoLevelEnabled || !qSel.options.length) return;
    var lv = hls.levels[hls.currentLevel];
    qSel.options[0].textContent = lv ? '自动（' + lv.height + 'p）' : '自动';
  }
  qSel.addEventListener('change', function () {
    if (!hls) return;
    var v = parseInt(qSel.value, 10);
    hls.currentLevel = v; // -1 = 自动
    if (v !== -1) qSel.options[0].textContent = '自动';
  });

  // ---------- 播放 ----------
  function onHlsError(evt, data) {
    if (!data.fatal) return;
    var ep = eps[cur];
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retries < 3) {
      retries++;
      setTimeout(function () {
        if (!hls) return;
        if (manifestReady) hls.startLoad(); else hls.loadSource(ep.src);
      }, 1500 * retries);
    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && retries < 3) {
      retries++;
      hls.recoverMediaError();
    } else {
      setNote('视频加载失败，请检查网络后刷新页面再试。');
    }
  }

  // 卸下当前视频,回到"封面 + 大播放键"
  function teardown() {
    if (hls) { hls.destroy(); hls = null; }
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.controls = false;
    bigPlay.hidden = mode === 'none';
    qWrap.hidden = true;
    started = manifestReady = false;
    retries = 0;
  }

  // 用户点了播放才开始加载
  function start() {
    var ep = eps[cur];
    if (!ep || started || mode === 'none') return;
    started = true;
    bigPlay.hidden = true;
    video.controls = true;
    if (mode === 'hlsjs') {
      // 最多预读 60 秒,免得只看几秒也把整集下完
      hls = new Hls({
        startPosition: pendingSeek || -1, capLevelToPlayerSize: true, abrEwmaDefaultEstimate: 1500000,
        maxBufferLength: 30, maxMaxBufferLength: 60
      });
      pendingSeek = 0;
      hls.on(Hls.Events.MANIFEST_PARSED, function () { manifestReady = true; buildQuality(); });
      hls.on(Hls.Events.LEVEL_SWITCHED, autoLabel);
      hls.on(Hls.Events.ERROR, onHlsError);
      hls.loadSource(ep.src);
      hls.attachMedia(video);
    } else {
      video.src = ep.src; // 续播位置在 loadedmetadata 里跳
    }
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
  }

  function load(i, play) {
    var ep = eps[i];
    if (!ep) return;
    cur = i;

    document.documentElement.style.setProperty('--accent', ep.accent);
    $('now-title').textContent = ep.no + ' · ' + ep.title;
    $('now-style').textContent = ep.style;
    $('now-blurb').textContent = ep.blurb;
    var ul = $('now-points');
    ul.textContent = '';
    ep.points.forEach(function (p) {
      var li = document.createElement('li');
      li.textContent = p;
      ul.appendChild(li);
    });
    eps.forEach(function (e) { e.el.setAttribute('aria-current', e.i === i ? 'true' : 'false'); });
    $('prev').disabled = i === 0;
    $('next').disabled = i === eps.length - 1;
    nextBtn.hidden = true;
    bigPlay.setAttribute('aria-label', '播放' + ep.no + ' · ' + ep.title);
    document.title = ep.no + ' · ' + ep.title + ' — 期货法律法规 · 教学动画';
    clearNote();

    teardown();
    video.poster = ep.poster;
    setMediaSession(ep);

    if (mode === 'none') {
      setNote('这个浏览器播放不了视频，请换用最新版的 Chrome、Edge、Safari，或在微信里打开。');
      return;
    }
    var saved = parseFloat(lsGet('t:' + ep.id) || '0');
    pendingSeek = saved > 10 ? saved : 0;
    if (pendingSeek) {
      setNote('上次看到 ' + fmt(pendingSeek) + '，点播放会从这里继续。', '从头看', function () {
        lsSet('t:' + ep.id, null);
        clearNote();
        if (started) video.currentTime = 0; else pendingSeek = 0;
      });
    }
    if (play) start();
  }

  function setMediaSession(ep) {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: ep.no + ' · ' + ep.title,
        artist: '期货法律法规 · 教学动画',
        artwork: [{ src: new URL(ep.poster, location.href).href, sizes: '1280x720', type: 'image/jpeg' }]
      });
    } catch (e) {}
  }

  // ---------- 播放器事件 ----------
  bigPlay.addEventListener('click', start);
  video.addEventListener('play', function () {
    nextBtn.hidden = true;
    if (!note.hidden && !retries) clearNote();
  });
  video.addEventListener('loadedmetadata', function () {
    if (mode === 'native' && pendingSeek) {
      video.currentTime = pendingSeek;
      pendingSeek = 0;
    }
  });
  video.addEventListener('timeupdate', function () {
    var ep = eps[cur];
    var d = video.duration;
    if (!ep || !started || !d || !isFinite(d)) return;
    var now = Date.now();
    if (now - lastSave < 4000) return;
    lastSave = now;
    var t = video.currentTime;
    if (t > 10 && t < d - 10) lsSet('t:' + ep.id, t.toFixed(1));
    else if (t >= d - 10) lsSet('t:' + ep.id, null);
  });
  video.addEventListener('ended', function () {
    var ep = eps[cur];
    if (ep) lsSet('t:' + ep.id, null);
    var nx = eps[cur + 1];
    if (nx) {
      nextBtn.textContent = '下一章：' + nx.title + '  ▶';
      nextBtn.hidden = false;
    }
  });
  video.addEventListener('error', function () {
    if (mode === 'native' && started) setNote('视频加载失败，请检查网络后刷新页面再试。');
  });

  // ---------- 选集 ----------
  var smooth = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function select(i, play, scroll) {
    if (!eps[i]) return;
    load(i, play);
    if (window.history && history.replaceState) history.replaceState(null, '', '#' + eps[i].id);
    if (scroll) {
      var watch = $('watch');
      var top = watch.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.35) {
        watch.scrollIntoView(smooth ? { behavior: 'smooth', block: 'start' } : true);
      }
    }
  }
  function fromHash() {
    var m = /^#ep(\d+)$/.exec(location.hash);
    var i = m ? parseInt(m[1], 10) - 1 : -1;
    return i >= 0 && i < eps.length ? i : -1;
  }

  eps.forEach(function (ep) {
    ep.el.addEventListener('click', function (e) {
      e.preventDefault();
      select(ep.i, true, true);
    });
  });
  $('prev').addEventListener('click', function () { select(cur - 1, true, false); });
  $('next').addEventListener('click', function () { select(cur + 1, true, false); });
  nextBtn.addEventListener('click', function () { select(cur + 1, true, false); });
  $('cta').addEventListener('click', function (e) {
    e.preventDefault();
    select(0, true, true);
  });
  window.addEventListener('hashchange', function () {
    var i = fromHash();
    if (i >= 0 && i !== cur) select(i, false, true);
  });

  var first = fromHash();
  load(first >= 0 ? first : 0, false);
  if (first >= 0) $('watch').scrollIntoView(true);
})();
