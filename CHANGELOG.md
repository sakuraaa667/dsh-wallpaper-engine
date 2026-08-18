# Changelog

## 1.0.0 — 2026-08-16

- **Background from Wallpaper Engine**: wallpapers downloaded by Wallpaper
  Engine (Steam Workshop app 431960 + local projects) can be used as the
  DeepSeek Harness web background. Video wallpapers play in place
  (`muted + loop`); image wallpapers prefer the highest-resolution standalone
  artwork in the directory over the small preview file.
- **Fit modes**: 「铺满 / 完整显示」cover / contain switching, with a blurred
  backdrop fill in contain mode.
- **Readability controls**: panel dimming slider (0–100%) and background darken
  slider (0–50%), scheme-aware so text stays readable in both light and dark
  themes.
- **Auto-sync**: the wallpaper list silently re-scans every 30 s while the
  settings section is open; new downloads appear automatically.
- **Persistence**: selection is saved to `$DSH_HOME/dsh-wallpaper.json` and
  restored on restart / refresh.
- **Server routes**: `/dsh-wallpaper/list`, `/config` (GET/POST),
  `/preview/<id>` and `/file/<id>` (with HTTP range support for video),
  mounted on the host webServer. All ids are resolved through a scan-built
  map, never used to build filesystem paths.
- **Tests & CI**: unit tests for the scanner and routes (`node --test test/`)
  and a GitHub Actions workflow.
