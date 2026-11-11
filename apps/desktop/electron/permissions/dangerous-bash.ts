/**
 * Dangerous bash command detection for pi-gui's built-in permission gate.
 *
 * Matching is precision-first: quoted text is blanked out before the rules run, so a command that
 * only *mentions* `rm -rf` or `sudo` inside a commit message, a grep pattern or an echo string does
 * not ask for confirmation. Shell `-c` payloads and `eval` arguments are unwrapped one level so the
 * command they actually run is still inspected.
 *
 * This is a reminder, not a security boundary. `xargs rm`, `$(printf rm) -rf /` and a base64 pipeline
 * all get past it.
 */

import type { PermissionCategoryId } from "../../contracts/permission-preferences";

export type PermissionSeverity = "medium" | "high" | "critical";

/** What the Settings page needs to know about a rule: no pattern, no severity. */
export interface PermissionCategoryRule {
  readonly id: string;
  readonly category: PermissionCategoryId;
  readonly reason: string;
}

export interface PermissionRuleMatch {
  readonly id: string;
  readonly category: PermissionCategoryId;
  readonly severity: PermissionSeverity;
  readonly reason: string;
  readonly matchedText: string;
}

interface CommandRule {
  readonly id: string;
  readonly category: PermissionCategoryId;
  readonly severity: PermissionSeverity;
  readonly pattern: RegExp;
  readonly reason: string;
}

/** `-rf`, `-fr`, `-r -f` and `-f -r`, with any other letter flag mixed in. */
const RM_FORCE = String.raw`rm\s+(?:-[a-z]*(?:rf|fr)[a-z]*|-[a-z]*r[a-z]*\s+-[a-z]*f[a-z]*|-[a-z]*f[a-z]*\s+-[a-z]*r[a-z]*)`;

const COMMAND_RULES: readonly CommandRule[] = [
  {
    id: "rm-recursive-force",
    category: "delete-disk",
    severity: "high",
    pattern: new RegExp(String.raw`\b${RM_FORCE}\b`, "i"),
    reason: "递归强制删除文件或目录",
  },
  {
    id: "rm-root-path",
    category: "delete-disk",
    severity: "critical",
    pattern: new RegExp(String.raw`\b${RM_FORCE}\s+\/\*?(?=$|[\s|;&)])`, "i"),
    reason: "递归强制删除根目录 /",
  },
  {
    id: "rm-home-path",
    category: "delete-disk",
    severity: "critical",
    pattern: new RegExp(String.raw`\b${RM_FORCE}\s+(?:~|\$HOME|\$\{HOME\})(?:\/|\s|$)`, "i"),
    reason: "递归强制删除主目录 ~ 或 $HOME",
  },
  {
    id: "rm-current-dir",
    category: "delete-disk",
    severity: "critical",
    pattern: new RegExp(String.raw`\b${RM_FORCE}\s+\.{1,2}(?:\/|\s|$)`, "i"),
    reason: "递归强制删除当前目录或上级目录",
  },
  {
    id: "rm-system-path",
    category: "delete-disk",
    severity: "critical",
    pattern: new RegExp(
      String.raw`\b${RM_FORCE}\s+(?:\/bin|\/boot|\/dev|\/etc|\/lib|\/lib64|\/proc|\/root|\/sbin|\/sys|\/usr|\/var)\b`,
      "i",
    ),
    reason: "递归强制删除系统目录（/etc、/usr 等）",
  },
  {
    id: "sudo-command",
    category: "sudo",
    severity: "medium",
    pattern: /(?:^|[\s|;&(])sudo\s+/i,
    reason: "用管理员权限（sudo）执行命令",
  },
  {
    id: "sudo-rm",
    category: "sudo",
    severity: "critical",
    pattern: new RegExp(String.raw`(?:^|[\s|;&(])sudo\s+${RM_FORCE}\b`, "i"),
    reason: "用管理员权限递归强制删除",
  },
  {
    id: "disk-overwrite-dd",
    category: "delete-disk",
    severity: "critical",
    pattern: /\bdd\s+.*(?:of=\/dev\/|if=\/dev\/zero|if=\/dev\/random|if=\/dev\/urandom)\S*/i,
    reason: "dd 直接读写磁盘设备，或灌数据把磁盘填满",
  },
  {
    id: "filesystem-format",
    category: "delete-disk",
    severity: "critical",
    pattern: /\b(?:mkfs|mkfs\.[a-z0-9]+|mkswap)\b/i,
    reason: "格式化文件系统或交换分区",
  },
  {
    id: "partition-change",
    category: "delete-disk",
    severity: "critical",
    pattern: /\b(?:fdisk|parted|sfdisk|gdisk|sgdisk)\b/i,
    reason: "修改磁盘分区表",
  },
  {
    id: "write-device-file",
    category: "delete-disk",
    severity: "critical",
    pattern: /(?:^|[\s|;&])(?:.+?>\s*\/dev\/(?!null\b)\S+|tee\s+\/dev\/(?!null\b)\S+)/i,
    reason: "直接往磁盘设备文件写数据",
  },
  {
    id: "chmod-dangerous",
    category: "file-mode",
    severity: "high",
    pattern: /\bchmod\s+(?:-R\s+)?(?:777|ugo\+rwx|a\+rwx)\b/i,
    reason: "把文件权限放大到 777 / ugo+rwx",
  },
  {
    id: "chown-recursive",
    category: "file-mode",
    severity: "medium",
    pattern: /\bchown\s+(?:-R\s+|.*\s-R\s+).+/i,
    reason: "递归修改文件所有者",
  },
  {
    id: "curl-pipe-shell",
    category: "remote-script",
    severity: "high",
    pattern: /\b(?:curl|wget)\b.+\|\s*(?:sh|bash|zsh|fish)\b/i,
    reason: "下载脚本后直接管道给 shell 执行",
  },
  {
    id: "shell-remote-code",
    category: "remote-script",
    severity: "high",
    pattern: /\b(?:bash|sh|zsh|fish)\s+<\s*\(\s*(?:curl|wget)\b/i,
    reason: "用进程替换执行远程脚本",
  },
  {
    id: "git-reset-hard",
    category: "git",
    severity: "medium",
    pattern: /\bgit\s+reset\s+--hard\b/i,
    reason: "git reset --hard，丢弃工作区和暂存区的改动",
  },
  {
    id: "git-clean-force",
    category: "git",
    severity: "high",
    pattern: /\bgit\s+clean\s+-[a-z]*f[a-z]*\b/i,
    reason: "git clean -f，强制删除未跟踪的文件",
  },
  {
    id: "git-push-force",
    category: "git",
    severity: "high",
    pattern: /\bgit\s+push\b.*(?:--force\b|-f\b|--force-with-lease\b)/i,
    reason: "git push 带强制参数，可能覆盖远端提交",
  },
  {
    id: "docker-prune-force",
    category: "containers",
    severity: "high",
    pattern: /\bdocker\s+(?:system|volume|image|container|builder)\s+prune\b.*(?:-f|--force)\b/i,
    reason: "强制清理 Docker 资源",
  },
  {
    id: "docker-remove-force",
    category: "containers",
    severity: "medium",
    pattern: /\bdocker\s+(?:rm|rmi|volume\s+rm)\b.*(?:-f|--force)\b/i,
    reason: "强制删除 Docker 容器 / 镜像 / 卷",
  },
  {
    id: "kubernetes-delete",
    category: "containers",
    severity: "high",
    pattern:
      /\bkubectl\s+delete\b.*(?:--all\b|-A\b|--all-namespaces\b|namespace\b|ns\b|deployment\b|pod\b|service\b|secret\b|configmap\b|pvc\b|pv\b)/i,
    reason: "删除 Kubernetes 资源",
  },
  {
    id: "process-kill-broad",
    category: "system-services",
    severity: "medium",
    pattern:
      /\b(?:killall|pkill)\b\s+(?:-9\s+)?(?:node|python|java|docker|containerd|sshd|nginx|mysql|postgres|redis)\b/i,
    reason: "批量终止关键进程",
  },
  {
    id: "systemctl-critical",
    category: "system-services",
    severity: "medium",
    pattern:
      /\bsystemctl\s+(?:stop|disable|mask|restart)\s+(?:sshd|ssh|docker|network|networking|firewalld|ufw|nginx|mysql|postgres|redis)\b/i,
    reason: "停止 / 禁用 / 重启关键系统服务",
  },
  {
    id: "sensitive-env-file",
    category: "credential-commands",
    severity: "high",
    pattern: /(?:^|[\s|;&<>])(?:\S*[/\\])?\.env(?:\.[^\s|;&<>]*)?(?=$|[\s|;&<>])/i,
    reason: "通过命令读写 .env 文件，可能泄露或改掉密钥",
  },
  {
    id: "sensitive-secret-file",
    category: "credential-commands",
    severity: "high",
    pattern:
      /(?:^|[\s|;&<>])\S*(?:secret|secrets|credential|credentials|creds|token|tokens|private[-_]?key|api[-_]?key|access[-_]?key)\S*(?=$|[\s|;&<>])/i,
    reason: "通过命令访问文件名像密钥 / token 的文件",
  },
  {
    id: "sensitive-ssh-private-key",
    category: "credential-commands",
    severity: "critical",
    pattern: /(?:^|[\s|;&<>])(?:\S*[/\\])?(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?=$|[\s|;&<>])/i,
    reason: "通过命令访问 SSH 私钥",
  },
  {
    id: "sensitive-auth-config-file",
    category: "credential-commands",
    severity: "high",
    pattern: /(?:^|[\s|;&<>])(?:\S*[/\\])?(?:\.npmrc|\.pypirc|\.netrc|credentials)(?=$|[\s|;&<>])/i,
    reason: "通过命令访问包管理器 / 云服务 / 网络凭据文件",
  },
  {
    id: "shell-rc-file",
    category: "credential-commands",
    severity: "medium",
    pattern: /(?:^|[\s|;&<>])(?:\S*[/\\])?(?:\.bashrc|\.zshrc)(?=$|[\s|;&<>])/i,
    reason: "通过命令访问 shell 启动文件，里面可能有密钥",
  },
  {
    id: "shutdown-reboot",
    category: "system-services",
    severity: "medium",
    pattern: /\b(?:shutdown|reboot|halt|poweroff)\b/i,
    reason: "关机或重启系统",
  },
];

const SEVERITY_WEIGHT: Readonly<Record<PermissionSeverity, number>> = {
  critical: 3,
  high: 2,
  medium: 1,
};

const QUOTED = String.raw`("(?:[^"\\]|\\.)*"|'[^']*')`;
const SHELL_PAYLOAD = new RegExp(
  String.raw`(?:^|[\s|;&(])(?:ba|da|z|k|fi)?sh\s+[^|;&]*?-[a-z]*c[a-z]*\s+${QUOTED}`,
  "gi",
);
const EVAL_PAYLOAD = new RegExp(String.raw`(?:^|[\s|;&(])eval\s+${QUOTED}`, "gi");

const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1([\s\S]*?)\n[ \t]*\2(?=\n|$)/g;

/**
 * Script bodies are data, not commands. A `python3 - <<'PY'` block that happens to contain the word
 * `credentials` is not a credential access, and scanning it produced exactly that false positive.
 * A heredoc handed to a shell is different: that body is a command, so it stays inspectable.
 */
function withoutScriptHeredocs(command: string): string {
  return command.replace(HEREDOC, (block, _quote: string, tag: string) => {
    const head = command.slice(0, command.indexOf(block));
    const shellRunsIt = /(?:^|[\s|;&(])(?:ba|da|z|k|fi)?sh\s/.test(head);
    return shellRunsIt ? block : `<<${tag} … ${tag}`;
  });
}

function normalizeCommand(command: string): string {
  return command
    .replace(/\\\r?\n/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Replaces quoted text with empty quotes. The dangerous part of a command is never inside quotes;
 * what sits there is a message, a search pattern or a path that the flags still expose.
 */
function withoutQuotedText(command: string): string {
  return command.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'[^']*'/g, "''");
}

function unquote(text: string): string {
  const inner = text.slice(1, -1);
  return text.startsWith("'") ? inner : inner.replace(/\\(.)/g, "$1");
}

/** Text a shell would run as a command of its own: `sh -c "..."`, `bash -lc '...'`, `eval "..."`. */
function embeddedCommandPayloads(command: string): string[] {
  const payloads: string[] = [];
  for (const pattern of [SHELL_PAYLOAD, EVAL_PAYLOAD]) {
    pattern.lastIndex = 0;
    for (const match of command.matchAll(pattern)) {
      const quoted = match[1];
      if (quoted) {
        payloads.push(unquote(quoted));
      }
    }
  }
  return payloads;
}

function collectMatches(command: string, depth: number): PermissionRuleMatch[] {
  const matches = new Map<string, PermissionRuleMatch>();
  const inspected = withoutQuotedText(normalizeCommand(withoutScriptHeredocs(command)));

  for (const rule of COMMAND_RULES) {
    const found = inspected.match(rule.pattern);
    if (found?.[0]) {
      matches.set(rule.id, {
        id: rule.id,
        category: rule.category,
        severity: rule.severity,
        reason: rule.reason,
        matchedText: found[0],
      });
    }
  }

  if (depth === 0) {
    for (const payload of embeddedCommandPayloads(command)) {
      for (const match of collectMatches(payload, depth + 1)) {
        if (!matches.has(match.id)) {
          matches.set(match.id, match);
        }
      }
    }
  }

  return [...matches.values()].sort(
    (left, right) => SEVERITY_WEIGHT[right.severity] - SEVERITY_WEIGHT[left.severity],
  );
}

/** The rule table as Settings lists it; the patterns themselves stay inside this module. */
export function listCommandRules(): readonly PermissionCategoryRule[] {
  return COMMAND_RULES.map(({ id, category, reason }) => ({ id, category, reason }));
}

export function findDangerousCommandMatches(command: string): PermissionRuleMatch[] {
  if (command.trim().length === 0) {
    return [];
  }
  return collectMatches(command, 0);
}
