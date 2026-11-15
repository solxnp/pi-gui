#!/bin/bash
# 编译并替换 ~/Applications/OCQuota.app
#
# 注意：会先停掉正在运行的实例（菜单栏图标会消失再回来）。
# 按约定装完不自动启动，什么时候开由你决定。
set -euo pipefail
cd "$(dirname "$0")"

DST="$HOME/Applications/OCQuota.app"

echo "== 1. 编译 =="
./build.sh

echo "== 2. 停掉在跑的实例 =="
if pgrep -f "OCQuota.app/Contents/MacOS/OCQuota" >/dev/null; then
  pkill -f "OCQuota.app/Contents/MacOS/OCQuota" || true
  sleep 1
  echo "   已停止"
else
  echo "   没有在跑"
fi

echo "== 3. 备份旧版 =="
if [ -d "$DST" ]; then
  BAK="$DST.bak-$(date +%Y%m%d-%H%M%S)"
  cp -R "$DST" "$BAK"
  echo "   $BAK"
fi

echo "== 4. 替换 =="
rm -rf "$DST"
cp -R build/OCQuota.app "$DST"
xattr -cr "$DST" 2>/dev/null || true
echo "   已安装到 $DST"

echo
echo "下一步（不自动执行）："
echo "  open ~/Applications/OCQuota.app     # 或重新登录，launchd 会拉起"
echo "  自检：~/Applications/OCQuota.app/Contents/MacOS/OCQuota --selftest"
