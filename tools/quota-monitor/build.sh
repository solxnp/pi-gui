#!/bin/bash
# 把 main.swift 编成 ~/Applications/OCQuota.app 用的 .app 包
# 用法：./build.sh [输出目录]   默认输出到 ./build/OCQuota.app
set -euo pipefail
cd "$(dirname "$0")"

OUT_DIR="${1:-$PWD/build}"
APP="$OUT_DIR/OCQuota.app"
NAME="OCQuota"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

xcrun swiftc -O -o "$APP/Contents/MacOS/$NAME" main.swift \
  -framework Cocoa -framework Carbon

# 图标可选：有 AppIcon.icns 就带上
if [ -f AppIcon.icns ]; then
  cp AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
fi

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>$NAME</string>
    <key>CFBundleIdentifier</key><string>local.ocquota</string>
    <key>CFBundleName</key><string>$NAME</string>
    <key>CFBundleDisplayName</key><string>$NAME</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>1.1</string>
    <key>CFBundleVersion</key><string>2</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>LSUIElement</key><true/>
    <key>LSMinimumSystemVersion</key><string>11.0</string>
    <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# 自签名即可（本地应用，不需要开发者证书）
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
xattr -cr "$APP" 2>/dev/null || true

echo "built: $APP"
echo "自检：$APP/Contents/MacOS/$NAME --selftest"
