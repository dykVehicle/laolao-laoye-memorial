(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const PLACEHOLDER_SRC = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
  const VIDEO_PLACEHOLDER_SRC = "assets/video-placeholder.svg";
  const UA = (navigator.userAgent || "").toLowerCase();
  const IS_WECHAT = UA.includes("micromessenger");

  function forceTopIfNeeded() {
    if (location.hash) return false;
    try {
      if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    } catch (_) {
      // ignore
    }
    const goTop = () => window.scrollTo(0, 0);
    goTop();
    window.requestAnimationFrame(goTop);
    window.setTimeout(goTop, 120);
    window.setTimeout(goTop, 480);
    return true;
  }

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

  function isVideoItem(it) {
    const k = safeText(it && (it.kind || it.type)).toLowerCase();
    if (k === "video") return true;
    return Boolean(it && it.video);
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

  function setupLazyThumbs(rootEl) {
    if (!rootEl) return;
    if (!rootEl.querySelector("img.photo__img[data-src]")) return;

    const bindFallback = (img) => {
      if (!img || img._fallbackBound) return;
      img._fallbackBound = true;
      img.addEventListener("error", () => {
        try {
          const fb = img.dataset && img.dataset.fallback;
          if (fb && img.src !== fb) {
            // 只回退一次，避免循环
            delete img.dataset.fallback;
            img.src = fb;
          }
        } catch (_) {
          // ignore
        }
      });
    };

    const loadOne = (img) => {
      if (!img || !img.dataset) return false;
      const src = img.dataset.src;
      if (!src) return false;
      bindFallback(img);
      img.src = src;
      delete img.dataset.src;
      return true;
    };

    let scheduled = 0;
    const bootUntil = Date.now() + 12000; // 兜底：防止滚动位置“延迟恢复”导致永远不触发加载

    const nearTimeline = () => {
      // scrollY 在部分内置浏览器偶尔不可靠，所以同时用 bounding rect 兜底
      if (window.scrollY > 200) return true;
      const r = rootEl.getBoundingClientRect();
      return r.top < window.innerHeight * 1.8;
    };

    const loadVisible = (limit) => {
      const imgs = $$("img.photo__img[data-src]", rootEl);
      if (imgs.length === 0) return 0;
      const vh = window.innerHeight || 800;
      const topBound = -vh * 0.8;
      const bottomBound = vh * 1.8;
      let n = 0;
      for (const img of imgs) {
        // 微信内置浏览器在某些机型上 elementFromPoint/closest 不稳定，改用矩形判断更可靠
        const r = img.getBoundingClientRect();
        if (r.bottom < topBound || r.top > bottomBound) continue;
        if (loadOne(img)) n++;
        if (n >= limit) break;
      }
      return n;
    };

    const step = () => {
      scheduled = 0;
      if (document.hidden) return;

      const isBoot = Date.now() < bootUntil;
      if (!nearTimeline() && !isBoot) return;

      // 微信下多给一点首屏额度，减少“停在某一年但一直空白”的概率
      const limit = IS_WECHAT ? 10 : 6;
      const loaded = loadVisible(limit);

      // 若有“静默恢复滚动位置”但没触发事件，boot 窗口内主动轮询
      if (loaded === 0 && isBoot) schedule(360);
    };

    const schedule = (delay = 0) => {
      if (scheduled) return;
      scheduled = window.setTimeout(() => window.requestAnimationFrame(step), delay);
    };

    const onHint = () => schedule(0);
    window.addEventListener("scroll", onHint, { passive: true });
    window.addEventListener("resize", onHint);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) schedule(0);
    });

    // Kickstart：立即尝试加载视口附近缩略图（避免用户看到一屏空白骨架）
    schedule(0);
    window.setTimeout(() => schedule(0), 200);
    window.setTimeout(() => schedule(0), 800);
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
      section.setAttribute("aria-label", `${year} 年照片与视频`);

      const videosCount = items.filter(isVideoItem).length;
      const photosCount = Math.max(0, items.length - videosCount);
      let countText = `${items.length} 条`;
      if (videosCount && photosCount) countText = `${photosCount} 张 · ${videosCount} 段视频`;
      else if (videosCount) countText = `${videosCount} 段视频`;
      else countText = `${photosCount} 张`;

      const head = document.createElement("div");
      head.className = "year__head";
      head.innerHTML = `
        <h3 class="year__title">${year}</h3>
        <div class="year__count">${countText}</div>
      `;

      const grid = document.createElement("div");
      grid.className = "grid";

      for (const it of items) {
        const idx = globalIndex++;
        const label = formatDateLabel(it.date, year);
        const isVideo = isVideoItem(it);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = isVideo ? "photo photo--video" : "photo";
        btn.setAttribute("data-idx", String(idx));
        const typeLabel = isVideo ? "视频" : "照片";
        const actionLabel = isVideo ? "点击播放" : "点击放大查看";
        btn.setAttribute("aria-label", `${year} 年${typeLabel}：${label || year}，${actionLabel}`);

        const img = document.createElement("img");
        img.className = "photo__img";
        // 注意：部分手机/内置浏览器对 loading=lazy 支持不稳定，仍可能一次性请求所有缩略图。
        // 所以这里用 data-src + IntersectionObserver 做“强制按需加载”，避免卡死。
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = `回忆${typeLabel} ${label || year}`;
        img.src = PLACEHOLDER_SRC;
        // 微信/部分内置浏览器可能不支持 WebP：默认用 WebP，失败则回退到 JPEG
        const thumbWebp = it.thumb || it.poster || (isVideo ? "" : it.src);
        const thumbJpg = it.thumbJpg || it.posterJpg || it.srcJpg;
        const thumbSrc = thumbWebp || thumbJpg || (isVideo ? VIDEO_PLACEHOLDER_SRC : "");
        const thumbFallback = thumbWebp && thumbJpg ? thumbJpg : "";
        if (thumbSrc) img.dataset.src = thumbSrc;
        if (thumbFallback && thumbFallback !== thumbSrc) img.dataset.fallback = thumbFallback;
        if (it.tw && it.th) {
          img.width = it.tw;
          img.height = it.th;
        }

        const chip = document.createElement("div");
        chip.className = "photo__label";
        chip.textContent = isVideo ? `视频 · ${label || year}` : label;

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
    const videoEl = $("#lightboxVideo");
    const dateEl = $("#lightboxDate");
    const metaEl = $("#lightboxMeta");
    const loadingEl = $("#lightboxLoading");
    if (!box || (!imgEl && !videoEl)) return () => {};

    let current = -1;
    let loadToken = 0;
    let hasHistoryTrap = false;
    let closingFromPop = false;
    const LOADING_TEXT_IMG = "正在加载清晰大图…";
    const SLOW_TEXT_IMG = "网络较慢，已先显示预览…";
    const LOADING_TEXT_VIDEO = "正在加载视频…";
    const SLOW_TEXT_VIDEO = "网络较慢，请稍候…";
    let slowHintT = null;

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

    function setLoading(v, kind = "image") {
      const isVid = kind === "video";
      const LOADING_TEXT = isVid ? LOADING_TEXT_VIDEO : LOADING_TEXT_IMG;
      const SLOW_TEXT = isVid ? SLOW_TEXT_VIDEO : SLOW_TEXT_IMG;
      if (loadingEl) {
        loadingEl.hidden = !v;
        if (v) loadingEl.textContent = LOADING_TEXT;
      }
      if (v) {
        if (!isVid && imgEl) imgEl.classList.add("lightbox__img--soft");
        window.clearTimeout(slowHintT);
        slowHintT = window.setTimeout(() => {
          if (loadingEl && !loadingEl.hidden) loadingEl.textContent = SLOW_TEXT;
        }, 2600);
      } else {
        if (imgEl) imgEl.classList.remove("lightbox__img--soft");
        window.clearTimeout(slowHintT);
        slowHintT = null;
        if (loadingEl) loadingEl.textContent = LOADING_TEXT_IMG;
      }
    }

    function setMedia(kind) {
      const isVid = kind === "video";
      if (videoEl) videoEl.style.display = isVid ? "block" : "none";
      if (imgEl) imgEl.style.display = isVid ? "none" : "block";
    }

    function stopVideo() {
      if (!videoEl) return;
      try {
        videoEl.pause();
      } catch (_) {
        // ignore
      }
      try {
        videoEl.removeAttribute("src");
        videoEl.load();
      } catch (_) {
        // ignore
      }
    }

    function canPrefetch() {
      const c = navigator.connection;
      if (!c) return true;
      if (c.saveData) return false;
      const t = (c.effectiveType || "").toLowerCase();
      if (t.includes("2g") || t.includes("slow-2g") || t.includes("3g")) return false;
      return true;
    }

    function prefetch(i) {
      const it = flatItems && flatItems[i];
      if (!it) return;
      if (isVideoItem(it)) return;
      const src = it.src || it.thumb;
      if (!src) return;
      const im = new Image();
      im.decoding = "async";
      im.src = src;
    }

    function show(i) {
      if (!flatItems || !flatItems[i]) return;
      const wasHidden = box.hidden;
      current = i;
      const it = flatItems[i];
      const label = formatDateLabel(it.date, it.year);
      const isVideo = isVideoItem(it);
      const token = ++loadToken;

      // 从视频切走时，先停掉（避免后台继续占用带宽/音频）
      stopVideo();

      if (isVideo) {
        setMedia("video");
        const posterWebp = it.poster || it.thumb;
        const posterJpg = it.posterJpg || it.thumbJpg;
        // 微信下优先用 JPG，减少 WebP 不支持导致“黑底无封面”
        const posterSrc = (IS_WECHAT && posterJpg) ? posterJpg : (posterWebp || posterJpg);

        if (videoEl) {
          try {
            videoEl.poster = posterSrc || "";
          } catch (_) {
            // ignore
          }

          const vsrc = it.video || "";
          if (vsrc) {
            setLoading(true, "video");
            const onReady = () => {
              if (token !== loadToken) return;
              setLoading(false, "video");
            };
            // 用一次性监听，避免多次翻页累积
            videoEl.addEventListener("loadedmetadata", onReady, { once: true });
            videoEl.addEventListener("error", onReady, { once: true });
            try {
              videoEl.src = vsrc;
              videoEl.load();
            } catch (_) {
              setLoading(false, "video");
            }
          } else {
            setLoading(false, "video");
          }
        }

        if (dateEl) dateEl.textContent = label || `${it.year}`;
        if (metaEl) metaEl.textContent = it.name ? `文件：${it.name}（视频）` : "视频";
        setVisible(true);

        if (wasHidden) {
          // 手机手势返回/返回键：优先退出大图，而不是退出页面
          try {
            history.pushState({ ...(history.state || {}), __lightbox: 1 }, "", location.href);
            hasHistoryTrap = true;
          } catch (_) {
            hasHistoryTrap = false;
          }
        }
        return;
      }

      setMedia("image");

      // 先用缩略图“秒开”，再在后台加载清晰大图，减少感知等待
      const thumbWebp = it.thumb || it.src;
      const thumbJpg = it.thumbJpg || it.srcJpg;
      const thumbSrc = thumbWebp || thumbJpg;
      const thumbFallback = thumbWebp && thumbJpg ? thumbJpg : "";

      const fullWebp = it.src || it.thumb;
      const fullJpg = it.srcJpg || it.thumbJpg;
      const fullSrc = fullWebp || fullJpg;
      const fullFallback = fullWebp && fullJpg ? fullJpg : "";

      if (imgEl) {
        imgEl.decoding = "async";
        imgEl.alt = `回忆照片 ${label || it.year}`;
      }
      // 预览图：若 WebP 不支持，回退到 JPG
      if (imgEl) imgEl.onerror = null;
      if (thumbSrc) {
        if (imgEl)
          imgEl.onerror = () => {
          if (token !== loadToken) return;
          if (thumbFallback && imgEl.src !== thumbFallback) imgEl.src = thumbFallback;
        };
        if (imgEl) imgEl.src = thumbSrc;
      }
      if (dateEl) dateEl.textContent = label || `${it.year}`;
      if (metaEl) metaEl.textContent = it.name ? `文件：${it.name}` : "";
      setVisible(true);

      if (wasHidden) {
        // 手机手势返回/返回键：优先退出大图，而不是退出页面
        try {
          history.pushState({ ...(history.state || {}), __lightbox: 1 }, "", location.href);
          hasHistoryTrap = true;
        } catch (_) {
          hasHistoryTrap = false;
        }
      }

      if (fullSrc && fullSrc !== thumbSrc) {
        setLoading(true, "image");
        const tryLoadFull = (src, onFail) => {
          const pre = new Image();
          pre.decoding = "async";
          pre.src = src;
          pre.onload = () => {
            if (token !== loadToken) return;
            if (imgEl) imgEl.src = src;
            setLoading(false, "image");
          };
          pre.onerror = () => {
            if (token !== loadToken) return;
            onFail && onFail();
          };
        };

        tryLoadFull(fullSrc, () => {
          if (fullFallback && fullFallback !== fullSrc) {
            tryLoadFull(fullFallback, () => setLoading(false, "image"));
            return;
          }
          setLoading(false, "image");
        });
      } else {
        setLoading(false, "image");
      }

      // 预取相邻图片，提升翻页/自动播放流畅度
      if (canPrefetch()) prefetch(i + 1);
    }

    function close() {
      loadToken++;
      stopVideo();
      setLoading(false, "image");
      setVisible(false);
      if (hasHistoryTrap && !closingFromPop) {
        // 让返回栈回到“打开大图之前”的状态
        hasHistoryTrap = false;
        try {
          history.back();
        } catch (_) {
          // ignore
        }
      }
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

    // 手机返回手势/返回键：触发 popstate
    window.addEventListener("popstate", () => {
      if (!box.hidden) {
        closingFromPop = true;
        close();
        closingFromPop = false;
      }
      hasHistoryTrap = false;
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
    let fadeToken = 0;
    // 记录“期望音量”，避免兼容自动播放时把 volume 置 0 后无法恢复，导致“音乐不响”
    let preferredVolume = 0.45;

    function clamp01(v) {
      return Math.max(0, Math.min(1, v));
    }

    function getVolumeSafe() {
      if (!audio) return preferredVolume;
      try {
        const v = typeof audio.volume === "number" ? audio.volume : preferredVolume;
        return Number.isFinite(v) ? v : preferredVolume;
      } catch (_) {
        return preferredVolume;
      }
    }

    function restoreVolumeIfNeeded() {
      if (!audio) return;
      try {
        const v = getVolumeSafe();
        if (v <= 0.001 && preferredVolume > 0.001) {
          audio.volume = preferredVolume;
        }
      } catch (_) {
        // ignore
      }
    }

    if (audio) {
      audio.loop = true;
      // 让浏览器自行决定（HTML里已设为 metadata + autoplay）
      audio.preload = audio.getAttribute("preload") || "metadata";
      preferredVolume = 0.45;
      try {
        audio.volume = preferredVolume;
      } catch (_) {
        // ignore
      }
    }

    async function play() {
      if (!audio) return false;
      try {
        fadeToken++;
        // 若之前被兼容逻辑置为 0，这里在“有声播放”场景先恢复音量
        if (!audio.muted) restoreVolumeIfNeeded();
        await audio.play();
        playing = true;
        if (!audio.muted) restoreVolumeIfNeeded();
        return true;
      } catch (e) {
        playing = false;
        return false;
      }
    }

    function pause() {
      if (!audio) return;
      fadeToken++;
      audio.pause();
      playing = false;
    }

    function setMuted(m) {
      if (!audio) return;
      try {
        audio.muted = !!m;
      } catch (_) {
        // ignore
      }
      // 用户手势解除静音时，确保音量不为 0（否则“看似播放成功但不响”）
      if (!m) restoreVolumeIfNeeded();
    }

    async function autoplaySmart() {
      if (!audio) return false;

      // 先尝试正常播放（如果浏览器允许有声自动播放，会直接成功）
      const normalOk = await play();
      if (normalOk) return true;

      // 再尝试“静音启动”（部分浏览器/内置 WebView 会放行静音自动播放）
      // 注意：不要把 volume 置为 0（会导致后续用户点击播放时仍不响）
      const token = ++fadeToken;
      try {
        audio.muted = true;
        restoreVolumeIfNeeded();
        await audio.play();
        playing = true;
      } catch (e) {
        playing = false;
        try {
          audio.muted = false;
        } catch (_) {
          // ignore
        }
        restoreVolumeIfNeeded();
        return false;
      }

      // 尝试解除静音（不保证所有浏览器都允许“无手势解除静音”）
      window.setTimeout(() => {
        if (token !== fadeToken) return;
        try {
          audio.muted = false;
        } catch (_) {
          // ignore
        }
        restoreVolumeIfNeeded();
      }, 120);

      return true;
    }

    return {
      play,
      autoplaySmart,
      pause,
      toggle: async () => {
        if (!audio) return false;
        const isRunning = playing && !audio.paused;
        const v = getVolumeSafe();
        const audibleNow = isRunning && !audio.muted && v > 0.001;
        // 若“正在播放但静音/音量为0”，点击应当变成“开启有声”，而不是先暂停
        if (audibleNow) {
          pause();
          return false;
        }
        try {
          audio.muted = false;
        } catch (_) {
          // ignore
        }
        restoreVolumeIfNeeded();
        if (isRunning) return true;
        return await play();
      },
      setMuted,
      setVolume: (v) => {
        if (!audio) return;
        const vv = clamp01(v);
        preferredVolume = vv;
        try {
          audio.volume = vv;
        } catch (_) {
          // ignore
        }
      },
      get playing() {
        return !!audio && playing && !audio.paused;
      },
      get audible() {
        if (!audio) return false;
        if (!playing || audio.paused) return false;
        if (audio.muted) return false;
        const v = getVolumeSafe();
        return v > 0.001;
      },
    };
  }

  async function load() {
    // 页面进入时默认回到顶部（无 hash 时）。部分手机 WebView 会恢复上次滚动位置，这里强制覆盖。
    forceTopIfNeeded();

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
      await bgm.toggle();
      const audible = bgm.audible;
      syncButtons(audible);
      toast(audible ? "音乐已开启" : "音乐已关闭");
    }

    if (btnHero) btnHero.addEventListener("click", toggleMusic);
    if (btnFab) btnFab.addEventListener("click", toggleMusic);

    // 轻微降噪：若用户系统偏好“减少动态”，默认不提示自动播放
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      bgm.setVolume(0.35);
    }

    // 默认尝试循环播放（不同手机/微信内置浏览器策略不同，尽量提高成功率）
    let unlocked = false;
    let autoplayToastShown = false;
    let autoplayInFlight = false;

    const tryWeixinBridge = () => {
      try {
        const w = window.WeixinJSBridge;
        if (w && typeof w.invoke === "function") {
          w.invoke("getNetworkType", {}, () => onUserGesture());
        }
      } catch (_) {
        // ignore
      }
      try {
        const y = window.YixinJSBridge;
        if (y && typeof y.invoke === "function") {
          y.invoke("getNetworkType", {}, () => onUserGesture());
        }
      } catch (_) {
        // ignore
      }
    };

    const onUserGesture = async () => {
      if (unlocked || autoplayInFlight) return;
      autoplayInFlight = true;
      // 用户手势场景：确保解除静音后再播放
      bgm.setMuted(false);
      const ok = await bgm.play();
      autoplayInFlight = false;
      syncButtons(bgm.audible);
      if (ok) {
        unlocked = true;
        // 用 capture=true（布尔）移除，兼容部分老WebView对 options 对象的支持差异
        document.removeEventListener("pointerdown", onUserGesture, true);
        document.removeEventListener("touchstart", onUserGesture, true);
        document.removeEventListener("click", onUserGesture, true);
      }
    };

    // 先注册（避免某些WebView事件很早触发）
    document.addEventListener("pointerdown", onUserGesture, { passive: true, capture: true });
    document.addEventListener("touchstart", onUserGesture, { passive: true, capture: true });
    document.addEventListener("click", onUserGesture, { passive: true, capture: true });
    document.addEventListener("WeixinJSBridgeReady", onUserGesture, false);
    document.addEventListener("YixinJSBridgeReady", onUserGesture, false);

    // 立即尝试一次（尽最大可能自动播放）
    {
      await bgm.autoplaySmart();
      const audible = bgm.audible;
      syncButtons(audible);
      if (audible) unlocked = true;
      else if (!autoplayToastShown) {
        autoplayToastShown = true;
        toast("音乐默认已开启：若未播放，轻触/滑动页面即可自动开始");
      }
    }

    // 微信/部分内置浏览器：主动触发 JSBridge（即使 Ready 事件已错过也能尝试）
    tryWeixinBridge();
    window.setTimeout(tryWeixinBridge, 600);
    window.setTimeout(tryWeixinBridge, 1600);

    // 加载照片数据
    let data = null;
    try {
      const res = await fetch("./data/gallery.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (e) {
      console.warn("gallery load failed", e);
    }

    const flat = buildTimeline(data) || [];
    setupLazyThumbs($("#timelineRoot"));
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
        bgm.setMuted(false);
        await bgm.play();
        syncButtons(bgm.audible);
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
  // 处理 bfcache/返回恢复场景：再次显示页面时也强制回到顶部（无 hash 时）。
  window.addEventListener("pageshow", () => forceTopIfNeeded());
})();


