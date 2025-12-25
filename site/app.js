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
    const fallbackYear = safeText(year).trim();
    if (!s) return fallbackYear ? `${fallbackYear}` : "";
    // 支持 "YYYY-MM-DD HH:MM:SS" / "YYYY-MM-DD"
    const parts = s.split(" ");
    const ymd = parts[0] || "";
    const hms = parts[1] || "";
    const ys = ymd.split("-");
    if (ys.length !== 3) return fallbackYear ? `${fallbackYear}` : "";
    const yyyy = ys[0] || fallbackYear;
    const mm = ys[1] || "01";
    const dd = ys[2] || "01";
    if (hms && hms.length >= 5) return `${yyyy}.${mm}.${dd}.${hms.slice(0, 5)}`;
    return `${yyyy}.${mm}.${dd}`;
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
    const loadingEl = $("#lightboxLoading");
    if (!box || !imgEl) return () => {};

    let current = -1;
    let loadToken = 0;

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

    function setLoading(v) {
      if (loadingEl) loadingEl.hidden = !v;
      if (v) imgEl.classList.add("lightbox__img--soft");
      else imgEl.classList.remove("lightbox__img--soft");
    }

    function prefetch(i) {
      const it = flatItems && flatItems[i];
      if (!it) return;
      const src = it.src || it.thumb;
      if (!src) return;
      const im = new Image();
      im.decoding = "async";
      im.loading = "eager";
      im.src = src;
    }

    function show(i) {
      if (!flatItems || !flatItems[i]) return;
      current = i;
      const it = flatItems[i];
      const label = formatDateLabel(it.date, it.year);

      // 先用缩略图“秒开”，再在后台加载清晰大图，减少感知等待
      const thumbSrc = it.thumb || it.src;
      const fullSrc = it.src || it.thumb;
      const token = ++loadToken;

      imgEl.decoding = "async";
      imgEl.alt = `回忆照片 ${label || it.year}`;
      if (thumbSrc) imgEl.src = thumbSrc;
      if (dateEl) dateEl.textContent = label || `${it.year}`;
      if (metaEl) metaEl.textContent = it.name ? `文件：${it.name}` : "";
      setVisible(true);

      if (fullSrc && fullSrc !== thumbSrc) {
        setLoading(true);
        const pre = new Image();
        pre.decoding = "async";
        pre.src = fullSrc;
        pre.onload = async () => {
          if (token !== loadToken) return;
          try {
            // 避免半加载闪烁
            if (pre.decode) await pre.decode();
          } catch (_) {
            // ignore
          }
          if (token !== loadToken) return;
          imgEl.src = fullSrc;
          setLoading(false);
        };
        pre.onerror = () => {
          if (token !== loadToken) return;
          setLoading(false);
        };
      } else {
        setLoading(false);
      }

      // 预取相邻图片，提升翻页/自动播放流畅度
      prefetch(i + 1);
      prefetch(i - 1);
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

    return {
      open: (idx) => show(idx),
      close,
      prev,
      next,
      get index() {
        return current;
      },
      get isOpen() {
        return !box.hidden;
      },
      get atEnd() {
        return current >= flatItems.length - 1;
      },
    };
  }

  // ---- 背景音乐：使用用户提供的 MP3（循环播放） ----
  function createBgmController() {
    const audio = $("#bgm");
    let playing = false;
    if (audio) {
      audio.loop = true;
      audio.preload = "none";
      audio.volume = 0.45;
    }

    async function play() {
      if (!audio) return false;
      try {
        await audio.play();
        playing = true;
        return true;
      } catch (e) {
        playing = false;
        return false;
      }
    }

    function pause() {
      if (!audio) return;
      audio.pause();
      playing = false;
    }

    return {
      play,
      pause,
      toggle: async () => {
        if (!audio) return false;
        if (playing && !audio.paused) {
          pause();
          return false;
        }
        return await play();
      },
      setVolume: (v) => {
        if (!audio) return;
        audio.volume = Math.max(0, Math.min(1, v));
      },
      get playing() {
        return !!audio && playing && !audio.paused;
      },
    };
  }

  async function load() {
    const bgm = createBgmController();

    const btnHero = $("#musicToggle");
    const btnFab = $("#floatingMusic");
    const btnStart = $("#startMemories");
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
      const playing = await bgm.toggle();
      syncButtons(playing);
      toast(playing ? "音乐已开启" : "音乐已关闭");
    }

    if (btnHero) btnHero.addEventListener("click", toggleMusic);
    if (btnFab) btnFab.addEventListener("click", toggleMusic);

    // 轻微降噪：若用户系统偏好“减少动态”，默认不提示自动播放
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      bgm.setVolume(0.35);
    }

    // 默认尝试循环播放（若浏览器拦截，会提示并等待用户手势）
    {
      const ok = await bgm.play();
      syncButtons(ok);
      if (!ok) toast("浏览器限制自动播放：请点击“开启音乐”或“开始回忆”");
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
    const lightbox = createLightbox(flat);
    const open = (idx) => {
      if (typeof lightbox === "function") return lightbox(idx);
      return lightbox && lightbox.open ? lightbox.open(idx) : undefined;
    };

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

    // “开始回忆”：滚动到时间轴 + 开启音乐 + 自动播放相册
    let slideTimer = null;
    function stopSlideshow() {
      if (slideTimer) window.clearInterval(slideTimer);
      slideTimer = null;
    }
    function startSlideshow() {
      if (!flat || flat.length === 0) return;
      stopSlideshow();
      if (lightbox && lightbox.open) lightbox.open(0);
      else open(0);

      // 每张停留 5 秒（含加载清晰大图的时间）
      slideTimer = window.setInterval(() => {
        if (!lightbox || !lightbox.isOpen) return stopSlideshow();
        if (lightbox.atEnd) {
          stopSlideshow();
          toast("已播放到最后一张");
          return;
        }
        lightbox.next();
      }, 5000);
    }

    if (btnStart) {
      btnStart.addEventListener("click", async () => {
        const timeline = $("#timeline");
        if (timeline && timeline.scrollIntoView) timeline.scrollIntoView({ behavior: "smooth", block: "start" });
        // 利用用户点击手势，确保音乐能成功启动
        const ok = await bgm.play();
        syncButtons(ok);
        startSlideshow();
      });
    }

    // 用户手动操作查看器时，停止自动播放（避免“抢操作”）
    const box = $("#lightbox");
    if (box) {
      box.addEventListener("click", (e) => {
        const t = e.target;
        if (!t || !t.dataset) return;
        if (t.dataset.close === "1" || t.dataset.prev === "1" || t.dataset.next === "1") stopSlideshow();
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


