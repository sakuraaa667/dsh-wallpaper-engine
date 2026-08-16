/**
 * dsh-wallpaper-engine client bundle (hand-written, no build step).
 *
 * Loaded by the web shell through `window.__ModuleLoader__.load`. The factory
 * closure runs only at materialization; it requires `react` /
 * `react/jsx-runtime` from the shell's static module table and exports the
 * standard { name, inject, apply } client-plugin contract.
 *
 * It registers a "壁纸 Wallpaper Engine" settings section and applies the
 * selected wallpaper as a fixed background layer behind the app, dimming the
 * surface tokens through the theme service's overrideTokens.
 */
window.__ModuleLoader__.load({ id: "dsh-wallpaper-engine", factory: (require) => {

  var module = { exports: {} };
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

  const React = require("react");
  const jsxRuntime = require("react/jsx-runtime");
  const { jsx: e, jsxs: es, Fragment } = jsxRuntime;
  const { useState, useEffect, useMemo, useCallback, useRef } = React;

  const API = "/dsh-wallpaper";
  const NS = "dsh-wallpaper-engine";

  // ---------------------------------------------------------------------------
  // Background engine (module-level singletons shared by boot-apply and the
  // settings section).
  // ---------------------------------------------------------------------------
  let themeRef = null;
  let layerEl = null;
  let styleTag = null;
  let tokenDisposer = null;
  let current = { id: null, dim: 0.78, overlay: 0.25 };

  function clamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  function rgba(r, g, b, a) {
    return `rgba(${r},${g},${b},${a})`;
  }

  function tokenOverrides(dim) {
    const d = clamp(Number(dim) || 0.78, 0.4, 0.95);
    // Scheme-aware surfaces: keep the active palette's lightness so the app's
    // own text colors stay readable (dark text on translucent white in light
    // mode, white text on translucent dark in dark mode). A bare string value
    // would throw in the theme service, so both palettes always get strings.
    const pair = (light, dark) => ({ light, dark });
    return {
      "--dsw-alias-bg-base": pair(rgba(255, 255, 255, Math.min(d + 0.12, 1)), rgba(21, 21, 23, d)),
      "--dsw-alias-bg-layer-1": pair(rgba(255, 255, 255, Math.min(d + 0.18, 1)), rgba(15, 17, 23, Math.min(d + 0.06, 1))),
      "--dsw-alias-bg-layer-2": pair(rgba(255, 255, 255, Math.min(d + 0.22, 1)), rgba(19, 21, 28, Math.min(d + 0.1, 1))),
      "--dsw-specific-sidebar-fill": pair(rgba(249, 250, 251, Math.min(d + 0.12, 1)), rgba(21, 21, 23, Math.min(d + 0.06, 1))),
      "--dsw-alias-bg-overlay": pair(rgba(233, 236, 242, Math.min(d + 0.22, 1)), rgba(13, 15, 20, Math.min(d + 0.16, 1)))
    };
  }

  function ensureStyles() {
    if (styleTag) return styleTag;
    styleTag = document.createElement("style");
    styleTag.textContent = [
      "#dsh-wallpaper-layer{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none;background:#0a0c10}",
      "#dsh-wallpaper-layer img,#dsh-wallpaper-layer video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}",
      "#dsh-wallpaper-layer::after{content:\"\";position:absolute;inset:0;background:rgba(0,0,0,var(--dsh-wp-overlay,0.25))}",
      ".dsh-wp{display:flex;flex-direction:column;gap:14px;height:100%;min-height:400px}",
      ".dsh-wp-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap}",
      ".dsh-wp-search{flex:1;min-width:180px;padding:8px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;outline:none;font-family:inherit}",
      ".dsh-wp-search:focus{border-color:var(--dsw-alias-brand-primary)}",
      ".dsh-wp-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 14px;font-size:13px;cursor:pointer;font-family:inherit}",
      ".dsh-wp-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".dsh-wp-btn[data-primary]{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}",
      ".dsh-wp-btn:disabled{opacity:.6;cursor:default}",
      ".dsh-wp-muted{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}",
      ".dsh-wp-error{color:var(--dsw-alias-state-error-primary);font-size:13px}",
      ".dsh-wp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;overflow-y:auto;padding:2px;flex:1;align-content:start}",
      ".dsh-wp-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;cursor:pointer;background:var(--dsw-alias-bg-layer-1);position:relative;transition:border-color .15s ease}",
      ".dsh-wp-card:hover{border-color:var(--dsw-alias-border-l3)}",
      ".dsh-wp-card[data-active]{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
      ".dsh-wp-thumb{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#0a0c10;border-radius:11px 11px 0 0}",
      ".dsh-wp-info{padding:8px 10px;display:flex;flex-direction:column;gap:4px}",
      ".dsh-wp-title{font-size:13px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".dsh-wp-sub{display:flex;gap:8px;align-items:center;justify-content:space-between}",
      ".dsh-wp-badge{font-size:11px;color:var(--dsw-alias-label-secondary)}",
      ".dsh-wp-state{font-size:11px;color:var(--dsw-alias-brand-primary)}",
      ".dsh-wp-controls{display:flex;gap:18px;align-items:center;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}",
      ".dsh-wp-field{display:flex;flex-direction:column;gap:4px;min-width:200px}",
      ".dsh-wp-label{font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".dsh-wp-slider{accent-color:var(--dsw-alias-brand-primary);width:160px}",
      ".dsh-wp-empty{color:var(--dsw-alias-label-secondary);font-size:13px;padding:24px 8px}"
    ].join("\n");
    document.head.appendChild(styleTag);
    return styleTag;
  }

  function ensureLayer() {
    if (layerEl) return layerEl;
    layerEl = document.createElement("div");
    layerEl.id = "dsh-wallpaper-layer";
    document.body.appendChild(layerEl);
    return layerEl;
  }

  function setLayerContent(wp, overlay) {
    const layer = ensureLayer();
    layer.innerHTML = "";
    layer.style.setProperty("--dsh-wp-overlay", String(clamp(overlay, 0, 0.6)));
    if (wp.hasVideo && wp.file) {
      const video = document.createElement("video");
      video.src = wp.file;
      video.autoplay = true;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.addEventListener("error", () => {
        if (video.parentNode === layer && wp.preview) {
          const img = document.createElement("img");
          img.src = wp.preview;
          img.alt = "";
          layer.replaceChildren(img);
        }
      });
      layer.appendChild(video);
      void video.play().catch(() => {});
    } else if (wp.preview) {
      const img = document.createElement("img");
      img.src = wp.preview;
      img.alt = "";
      layer.appendChild(img);
    }
  }

  function applyTokens(dim) {
    if (!themeRef) return;
    if (tokenDisposer) tokenDisposer();
    tokenDisposer = themeRef.overrideTokens(NS, tokenOverrides(dim));
  }

  function applyWallpaper(wp, dim, overlay) {
    current.id = wp.id;
    current.dim = dim;
    current.overlay = overlay;
    ensureStyles();
    setLayerContent(wp, overlay);
    applyTokens(dim);
  }

  function clearBackground() {
    current.id = null;
    if (layerEl) {
      layerEl.remove();
      layerEl = null;
    }
    if (tokenDisposer) {
      tokenDisposer();
      tokenDisposer = null;
    }
  }

  async function fetchList() {
    const res = await fetch(`${API}/list`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function saveConfig() {
    try {
      await fetch(`${API}/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: current.id, dim: current.dim, overlay: current.overlay })
      });
    } catch (err) {
      // Non-fatal: persistence is best-effort.
    }
  }

  /** Re-apply the persisted selection at boot. */
  async function loadConfigFromServer() {
    try {
      const res = await fetch(`${API}/config`, { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      const cfg = body.state || {};
      if (typeof cfg.dim === "number") current.dim = cfg.dim;
      if (typeof cfg.overlay === "number") current.overlay = cfg.overlay;
      if (typeof cfg.id === "string" && cfg.id) {
        const list = await fetchList();
        const wp = list.wallpapers.find((item) => item.id === cfg.id);
        if (wp) {
          ensureStyles();
          applyWallpaper(wp, current.dim, current.overlay);
        } else {
          current.id = null;
          void saveConfig();
        }
      }
    } catch (err) {
      // Routes may not be live yet on a very first load — ignore.
    }
  }

  // ---------------------------------------------------------------------------
  // Settings section.
  // ---------------------------------------------------------------------------
  function WallpaperSection(props) {
    const theme = props.theme;
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [q, setQ] = useState("");
    const [activeId, setActiveId] = useState(current.id);
    const [dim, setDim] = useState(current.dim);
    const [overlay, setOverlay] = useState(current.overlay);
    const [busyId, setBusyId] = useState(null);
    const saveTimer = useRef(null);

    useEffect(() => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    }, []);

    const refresh = useCallback(() => {
      setLoading(true);
      setError(null);
      fetchList()
        .then((body) => setData(body))
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false));
    }, []);

    // Silent re-fetch: picks up wallpapers downloaded in Wallpaper Engine
    // while this section stays open (no loading spinner, errors ignored).
    const refreshSilent = useCallback(() => {
      fetchList()
        .then((body) => setData(body))
        .catch(() => {});
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    useEffect(() => {
      const timer = setInterval(() => { void refreshSilent(); }, 30_000);
      return () => clearInterval(timer);
    }, [refreshSilent]);

    const filtered = useMemo(() => {
      if (!data) return [];
      const needle = q.trim().toLowerCase();
      return data.wallpapers.filter((wp) => {
        if (!needle) return true;
        return (wp.title || "").toLowerCase().includes(needle);
      });
    }, [data, q]);

    const scheduleSave = useCallback(() => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { void saveConfig(); }, 350);
    }, []);

    const select = useCallback(async (wp) => {
      setBusyId(wp.id);
      try {
        themeRef = theme;
        applyWallpaper(wp, dim, overlay);
        setActiveId(wp.id);
        await saveConfig();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    }, [theme, dim, overlay]);

    const clear = useCallback(() => {
      clearBackground();
      setActiveId(null);
      void saveConfig();
    }, []);

    const onDim = useCallback((value) => {
      const v = Number(value);
      setDim(v);
      current.dim = v;
      if (current.id) applyTokens(v);
      scheduleSave();
    }, [scheduleSave]);

    const onOverlay = useCallback((value) => {
      const v = Number(value);
      setOverlay(v);
      current.overlay = v;
      if (layerEl) layerEl.style.setProperty("--dsh-wp-overlay", String(clamp(v, 0, 0.6)));
      scheduleSave();
    }, [scheduleSave]);

    const activeWallpaper = data && activeId ? data.wallpapers.find((wp) => wp.id === activeId) : null;
    const sources = data ? data.sources : null;
    const counts = data ? `${data.wallpapers.length} 个壁纸` : "";
    const sourceText = sources
      ? [...sources.workshopDirs, ...sources.projectDirs].join(" · ")
      : "";

    const head = es("div", { className: "dsh-wp-head", children: [
      e("input", {
        key: "search",
        className: "dsh-wp-search",
        type: "search",
        placeholder: "搜索壁纸标题…",
        value: q,
        onChange: (event) => setQ(event.target.value)
      }),
      e("button", {
        key: "refresh",
        type: "button",
        className: "dsh-wp-btn",
        onClick: refresh,
        children: "刷新"
      }),
      e("button", {
        key: "clear",
        type: "button",
        className: "dsh-wp-btn",
        onClick: clear,
        disabled: !activeId,
        children: "清除背景"
      })
    ] });

    const controls = es("div", { className: "dsh-wp-controls", children: [
      es("div", { key: "dim", className: "dsh-wp-field", children: [
        e("span", { className: "dsh-wp-label", children: `面板暗化 ${Math.round(dim * 100)}%` }),
        e("input", {
          type: "range", className: "dsh-wp-slider", min: "0.4", max: "0.95", step: "0.01",
          value: dim, onChange: (event) => onDim(event.target.value)
        })
      ] }),
      es("div", { key: "overlay", className: "dsh-wp-field", children: [
        e("span", { className: "dsh-wp-label", children: `背景压暗 ${Math.round(overlay * 100)}%` }),
        e("input", {
          type: "range", className: "dsh-wp-slider", min: "0", max: "0.5", step: "0.01",
          value: overlay, onChange: (event) => onOverlay(event.target.value)
        })
      ] }),
      e("div", { key: "status", className: "dsh-wp-muted", children: activeWallpaper
        ? `当前背景：${activeWallpaper.title}`
        : "未设置背景 —— 点击下方任意壁纸使用" })
    ] });

    let body;
    if (loading) {
      body = e("div", { className: "dsh-wp-muted", children: "正在扫描 Wallpaper Engine 壁纸…" });
    } else if (error) {
      body = es("div", { className: "dsh-wp-empty", children: [
        e("div", { className: "dsh-wp-error", children: `加载失败：${error}` }),
        e("div", { className: "dsh-wp-muted", children: "请确认插件服务端已激活，然后点击“刷新”。" })
      ] });
    } else if (data && !data.engineFound) {
      body = es("div", { className: "dsh-wp-empty", children: [
        e("div", { children: "未检测到 Wallpaper Engine 壁纸目录。" }),
        e("div", { className: "dsh-wp-muted", children: "已尝试的路径均不存在。若 Steam 安装在非常规位置，可通过插件配置 workshopDir / projectsDir（或用环境变量 DSH_WALLPAPER_WORKSHOP_DIR）指定。" })
      ] });
    } else if (filtered.length === 0) {
      body = e("div", { className: "dsh-wp-empty", children: "没有匹配的壁纸。" });
    } else {
      body = e("div", { className: "dsh-wp-grid", children: filtered.map((wp) => {
        const isActive = wp.id === activeId;
        const isBusy = wp.id === busyId;
        return es("div", {
          key: wp.id,
          className: "dsh-wp-card",
          "data-active": isActive ? "true" : undefined,
          title: wp.title,
          onClick: () => { void select(wp); },
          children: [
            wp.preview
              ? e("img", { className: "dsh-wp-thumb", src: wp.preview, alt: "", loading: "lazy" })
              : e("div", { className: "dsh-wp-thumb" }),
            es("div", { className: "dsh-wp-info", children: [
              e("div", { className: "dsh-wp-title", children: wp.title }),
              es("div", { className: "dsh-wp-sub", children: [
                e("span", { className: "dsh-wp-badge", children: wp.hasVideo ? "视频" : (wp.type === "web" ? "网页" : "图片") }),
                isActive
                  ? e("span", { className: "dsh-wp-state", children: isBusy ? "应用…" : "使用中" })
                  : e("span", { className: "dsh-wp-badge", children: isBusy ? "应用…" : "使用" })
              ] })
            ] })
          ]
        });
      }) });
    }

    const footer = e("div", {
      className: "dsh-wp-muted",
      children: sourceText ? `壁纸来源：${sourceText} · 共 ${counts}` : counts
    });

    return es("div", { className: "dsh-wp", children: [head, controls, body, footer] });
  }

  // ---------------------------------------------------------------------------
  // Client plugin contract.
  // ---------------------------------------------------------------------------
  const name = NS;
  const inject = ["slots", "theme"];

  function apply(ctx) {
    themeRef = ctx.theme;
    ctx.slots.inject("settings.section", () => ctx.slots.register(
      {
        name: "settings.section",
        id: "wallpaper-engine",
        order: 90,
        label: () => "壁纸 Wallpaper Engine"
      },
      (ownerProps) => e(WallpaperSection, { ...(ownerProps || {}), theme: ctx.theme })
    ));
    void loadConfigFromServer();
  }

  exports.apply = apply;
  exports.inject = inject;
  exports.name = name;
  return module.exports;
} });
