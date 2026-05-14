# Icons

Place the following files here for the menu bar icon:

- `tray-idleTemplate.png` + `tray-idleTemplate@2x.png`  — 22×22 and 44×44 px, white on transparent (macOS template image)
- `tray-activeTemplate.png` + `tray-activeTemplate@2x.png` — same, used when connected/syncing
- `icon.icns` — app icon for the .dmg installer (1024×1024 px)

## Quick icon generation (requires ImageMagick)

```bash
# Minimal circle icon — replace with a proper design
convert -size 22x22 xc:none -fill white -draw "circle 11,11 11,2" tray-idleTemplate.png
convert -size 44x44 xc:none -fill white -draw "circle 22,22 22,3" tray-idleTemplate@2x.png
cp tray-idleTemplate.png  tray-activeTemplate.png
cp tray-idleTemplate@2x.png tray-activeTemplate@2x.png
```

If no icon files are present, the app falls back to a text title in the menu bar.
