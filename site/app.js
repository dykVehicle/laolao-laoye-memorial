(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const toastEl = $("#toast");
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("toast--show");
    window.clearTimeout(toastEl._t);
    toastEl._t = window.setTimeout(() => toastEl.classList.remove("toast--show"), 1800);
  }

  function safeText(s) {
    return (s || "").toString();
  }

  function formatDateLabel(dateStr, year) {
    const s = safeText(dateStr).trim();
    if (!s) return `${year} 年`;
    // 支持 "YYYY-MM-DD HH:MM:SS" / "YYYY-MM-DD"
    const parts = s.split(" ");
    const ymd = parts[0] || "";
    const hms = parts[1] || "";
    const ys = ymd.split("-");
    if (ys.length !== 3) return `${year} 年`;
    const mmdd = `${ys[1]}-${ys[2]}`;
    if (hms && hms.length >= 5) return `${mmdd} ${hms.slice(0, 5)}`;
    return mmdd;
  }

  function byYearDesc(a, b) {
    return b.year - a.year;
  }

  function buildTimeline(data) {
    const root = $("#timelineRoot");
    if (!root) return;
    root.innerHTML = "";

    if (!data || !Array.isArray(data.years) || data.years.length === 0) {
      root.innerHTML =
        '<div class="card"><div class="card__title">没有找到照片数据</div><div class="card__text card__text--dim">请先生成 data/gallery.json 并确保 assets/photos 已存在。</div></div>';
      return;
    }

    const years = data.years.slice().sort(byYearDesc);
    const flat = [];

    for (const y of years) {
      const year = y.year;
      const items = Array.isArray(y.items) ? y.items : [];
      for (const it of items) flat.push({ year, ...it });
    }

    let globalIndex = 0;
    for (const y of years) {
      const year = y.year;
      const items = Array.isArray(y.items) ? y.items : [];

      const section = document.createElement("section");
      section.className = "year";
      section.setAttribute("aria-label", `${year} 年照片`);

      const head = document.createElement("div");
      head.className = "year__head";
      head.innerHTML = `
        <h3 class="year__title">${year}</h3>
        <div class="year__count">${items.length} 张</div>
      `;

      const grid = document.createElement("div");
      grid.className = "grid";

      for (const it of items) {
        const idx = globalIndex++;
        const label = formatDateLabel(it.date, year);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "photo";
        btn.setAttribute("data-idx", String(idx));
        btn.setAttribute("aria-label", `${year} 年照片：${label}，点击放大查看`);

        const img = document.createElement("img");
        img.className = "photo__img";
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = `回忆照片 ${label}`;
        img.src = it.thumb || it.src;
        if (it.tw && it.th) {
          img.width = it.tw;
          img.height = it.th;
        }

        const chip = document.createElement("div");
        chip.className = "photo__label";
        chip.textContent = label;

        btn.appendChild(img);
        btn.appendChild(chip);
        grid.appendChild(btn);
      }

      section.appendChild(head);
      section.appendChild(grid);
      root.appendChild(section);
    }

    return flat;
  }

  function createLightbox(flatItems) {
    const box = $("#lightbox");
    const imgEl = $("#lightboxImg");
    const dateEl = $("#lightboxDate");
    const metaEl = $("#lightboxMeta");
    if (!box || !imgEl) return () => {};

    let current = -1;

    function setVisible(v) {
      if (v) {
        box.hidden = false;
        box.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";
      } else {
        box.hidden = true;
        box.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";
      }
    }

    function show(i) {
      if (!flatItems || !flatItems[i]) return;
      current = i;
      const it = flatItems[i];
      imgEl.src = it.src || it.thumb;
      imgEl.alt = `回忆照片 ${formatDateLabel(it.date, it.year)}`;
      if (dateEl) dateEl.textContent = `${it.year} · ${formatDateLabel(it.date, it.year)}`;
      if (metaEl) metaEl.textContent = it.name ? `文件：${it.name}` : "";
      setVisible(true);
    }

    function close() {
      setVisible(false);
    }

    function prev() {
      if (current <= 0) return;
      show(current - 1);
    }

    function next() {
      if (current >= flatItems.length - 1) return;
      show(current + 1);
    }

    box.addEventListener("click", (e) => {
      const t = e.target;
      if (!t) return;
      if (t.dataset && (t.dataset.close === "1")) close();
      if (t.dataset && (t.dataset.prev === "1")) prev();
      if (t.dataset && (t.dataset.next === "1")) next();
    });

    window.addEventListener("keydown", (e) => {
      if (box.hidden) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    });

    return (idx) => show(idx);
  }

  // ---- 温柔“钢琴”合成：WebAudio 轻音乐（无外部音频，避免版权问题） ----
  function createPianoEngine() {
    let ctx = null;
    let master = null;
    let convolver = null;
    let intervalId = null;
    let isPlaying = false;
    let nextBarAt = 0;

    function impulseResponse(seconds, decay) {
      const rate = ctx.sampleRate;
      const length = rate * seconds;
      const buffer = ctx.createBuffer(2, length, rate);
      for (let c = 0; c < 2; c++) {
        const ch = buffer.getChannelData(c);
        for (let i = 0; i < length; i++) {
          const t = i / length;
          ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        }
      }
      return buffer;
    }

    function ensure() {
      if (ctx) return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      ctx = new AudioCtx();
      master = ctx.createGain();
      master.gain.value = 0.26;

      const dry = ctx.createGain();
      dry.gain.value = 0.82;
      const wet = ctx.createGain();
      wet.gain.value = 0.24;

      convolver = ctx.createConvolver();
      convolver.buffer = impulseResponse(2.3, 2.2);

      master.connect(dry);
      master.connect(convolver);
      convolver.connect(wet);
      dry.connect(ctx.destination);
      wet.connect(ctx.destination);
    }

    function midiToFreq(m) {
      return 440 * Math.pow(2, (m - 69) / 12);
    }

    function playNote(midi, when, dur, vel) {
      const f = midiToFreq(midi);

      const osc1 = ctx.createOscillator();
      osc1.type = "triangle";
      osc1.frequency.value = f;

      const osc2 = ctx.createOscillator();
      osc2.type = "sine";
      osc2.frequency.value = f * 2;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(1700, when);
      filter.Q.value = 0.85;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vel), when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(g);
      g.connect(master);

      const end = when + dur + 0.08;
      osc1.start(when);
      osc2.start(when);
      osc1.stop(end);
      osc2.stop(end);
    }

    // 4小节循环：Cmaj7 → Am7 → Fmaj7 → Gadd9（温柔、回忆感）
    const bars = [
      [60, 64, 67, 71],
      [57, 60, 64, 67],
      [53, 57, 60, 64],
      [55, 59, 62, 67],
    ];
    const barLen = 3.2; // seconds

    function scheduleBar(barIndex, t0) {
      const chord = bars[barIndex % bars.length];
      // 轻柔琶音：低→高→中→高（更像“钢琴手感”）
      const order = [0, 2, 1, 3, 2];
      for (let i = 0; i < order.length; i++) {
        const n = chord[order[i]];
        const when = t0 + i * 0.42;
        playNote(n, when, 1.6, 0.16);
        // 添一点点“高音闪光”
        if (i === 1 || i === 3) playNote(n + 12, when + 0.02, 1.2, 0.08);
      }
    }

    function scheduler() {
      if (!isPlaying) return;
      const now = ctx.currentTime;
      const ahead = 0.8;
      while (nextBarAt < now + ahead) {
        const barIndex = Math.floor((nextBarAt - startAt) / barLen);
        scheduleBar(barIndex, nextBarAt);
        nextBarAt += barLen;
      }
    }

    let startAt = 0;
    async function start() {
      ensure();
      if (ctx.state === "suspended") await ctx.resume();
      if (isPlaying) return;
      isPlaying = true;
      startAt = ctx.currentTime + 0.08;
      nextBarAt = startAt;
      scheduler();
      intervalId = window.setInterval(scheduler, 160);
    }

    function stop() {
      isPlaying = false;
      if (intervalId) window.clearInterval(intervalId);
      intervalId = null;
      // 不强制close context，避免频繁创建导致兼容问题
    }

    function setVolume(v) {
      ensure();
      master.gain.value = Math.max(0, Math.min(0.6, v));
    }

    return {
      start,
      stop,
      toggle: async () => {
        if (isPlaying) stop();
        else await start();
        return isPlaying;
      },
      setVolume,
      get playing() {
        return isPlaying;
      },
    };
  }

  async function load() {
    const engine = createPianoEngine();

    const btnHero = $("#musicToggle");
    const btnFab = $("#floatingMusic");
    function syncButtons(playing) {
      const label = playing ? "关闭音乐" : "开启音乐";
      if (btnHero) {
        btnHero.textContent = label;
        btnHero.setAttribute("aria-pressed", playing ? "true" : "false");
      }
      if (btnFab) {
        btnFab.setAttribute("aria-pressed", playing ? "true" : "false");
        btnFab.style.borderColor = playing ? "rgba(201, 133, 118, 0.55)" : "rgba(42, 37, 35, 0.12)";
      }
    }

    async function toggleMusic() {
      const playing = await engine.toggle();
      syncButtons(playing);
      toast(playing ? "音乐已开启" : "音乐已关闭");
    }

    if (btnHero) btnHero.addEventListener("click", toggleMusic);
    if (btnFab) btnFab.addEventListener("click", toggleMusic);

    // 轻微降噪：若用户系统偏好“减少动态”，默认不提示自动播放
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      engine.setVolume(0.18);
    }

    // 加载照片数据
    let data = null;
    try {
      const res = await fetch("./data/gallery.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (e) {
      console.warn("gallery load failed", e);
    }

    const flat = buildTimeline(data) || [];
    const open = createLightbox(flat);

    // 绑定点击事件（事件代理）
    const root = $("#timelineRoot");
    if (root) {
      root.addEventListener("click", (e) => {
        const t = e.target;
        const card = t && t.closest ? t.closest(".photo") : null;
        if (!card) return;
        const idx = Number(card.getAttribute("data-idx"));
        if (Number.isFinite(idx)) open(idx);
      });
    }

    // 初次渲染后做一个“无横向溢出”的小自检（主要给手机端）
    window.requestAnimationFrame(() => {
      const overflow = document.documentElement.scrollWidth - window.innerWidth;
      if (overflow > 2) {
        console.warn("Potential horizontal overflow:", overflow);
      }
    });
  }

  window.addEventListener("DOMContentLoaded", load);
})();


