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

export type PermissionSeverity = "medium" | "high" | "critical";

export interface PermissionRuleMatch {
  readonly id: string;
  readonly severity: PermissionSeverity;
  readonly reason: string;
  readonly matchedText: string;
}

interface CommandRule {
  readonly id: string;
  readonly severity: PermissionSeverity;
  readonly pattern: RegExp;
  readonly reason: string;
}

/** `-rf`, `-fr`, `-r -f` and `-f -r`, with any other letter flag mixed in. */
const RM_FORCE = String.raw`rm\s+(?:-[a-z]*(?:rf|fr)[a-z]*|-[a-z]*r[a-z]*\s+-[a-z]*f[a-z]*|-[a-z]*f[a-z]*\s+-[a-z]*r[a-z]*)`;

const COMMAND_RULES: readonly CommandRule[] = [
  {
    id: "rm-recursive-force",
    severity: "high",
    pattern: new RegExp(String.raw`\b${RM_FORCE}\b`, "i"),
    reason: "Recursive force delete of files or directories",
  },
  {
    id: "rm-root-path",
    severity: "critical",
    pattern: new RegExp(String.raw`\b${RM_FORCE}\s+\/\*?\s*(?:$|[|;&)])`, "i"),
    reason: "Recursive force delete of the root directory",
  },
  {
    id: "rm-home-path",
    severity: "critical",
    pattern: new RegExp(String.raw`\b${RM_FORCE}\s+(?:~|\$HOME|\$\{HOME\})(?:\/|\s|$)`, "i"),
    reason: "Recursive force delete of the home directory",
  },
  {
    id: "rm-current-dir",
    severity: "critical",
    pattern: new RegExp(String.raw`\b${RM_FORCE}\s+\.{1,2}(?:\/|\s|$)`, "i"),
    reason: "Recursive force delete of the current or parent directory",
  },
  {
    id: "rm-system-path",
    severity: "critical",
    pattern: new RegExp(
      String.raw`\b${RM_FORCE}\s+(?:\/bin|\/boot|\/dev|\/etc|\/lib|\/lib64|\/proc|\/root|\/sbin|\/sys|\/usr|\/var)\b`,
      "i",
    ),
    reason: "Recursive force delete of a system directory",
  },
  {
    id: "sudo-command",
    severity: "medium",
    pattern: /(?:^|[\s|;&(])sudo\s+/i,
    reason: "Runs a command with administrator privileges",
  },
  {
    id: "sudo-rm",
    severity: "critical",
    pattern: new RegExp(String.raw`(?:^|[\s|;&(])sudo\s+${RM_FORCE}\b`, "i"),
    reason: "Recursive force delete with administrator privileges",
  },
  {
    id: "disk-overwrite-dd",
    severity: "critical",
    pattern: /\bdd\s+.*(?:of=\/dev\/|if=\/dev\/zero|if=\/dev\/random|if=\/dev\/urandom)\S*/i,
    reason: "Writes raw data to a device or fills a disk with generated data",
  },
  {
    id: "filesystem-format",
    severity: "critical",
    pattern: /\b(?:mkfs|mkfs\.[a-z0-9]+|mkswap)\b/i,
    reason: "Formats a filesystem or swap partition",
  },
  {
    id: "partition-change",
    severity: "critical",
    pattern: /\b(?:fdisk|parted|sfdisk|gdisk|sgdisk)\b/i,
    reason: "Changes a disk partition table",
  },
  {
    id: "write-device-file",
    severity: "critical",
    pattern: /(?:^|[\s|;&])(?:.+?>\s*\/dev\/(?!null\b)\S+|tee\s+\/dev\/(?!null\b)\S+)/i,
    reason: "Writes to a device file",
  },
  {
    id: "chmod-dangerous",
    severity: "high",
    pattern: /\bchmod\s+(?:-R\s+)?(?:777|ugo\+rwx|a\+rwx)\b/i,
    reason: "Grants permissions that are too wide",
  },
  {
    id: "chown-recursive",
    severity: "medium",
    pattern: /\bchown\s+(?:-R\s+|.*\s-R\s+).+/i,
    reason: "Recursively changes file ownership",
  },
  {
    id: "curl-pipe-shell",
    severity: "high",
    pattern: /\b(?:curl|wget)\b.+\|\s*(?:sh|bash|zsh|fish)\b/i,
    reason: "Downloads a script and pipes it straight into a shell",
  },
  {
    id: "shell-remote-code",
    severity: "high",
    pattern: /\b(?:bash|sh|zsh|fish)\s+<\s*\(\s*(?:curl|wget)\b/i,
    reason: "Runs a remote script through process substitution",
  },
  {
    id: "git-reset-hard",
    severity: "medium",
    pattern: /\bgit\s+reset\s+--hard\b/i,
    reason: "Discards worktree and index changes",
  },
  {
    id: "git-clean-force",
    severity: "high",
    pattern: /\bgit\s+clean\s+-[a-z]*f[a-z]*\b/i,
    reason: "Force deletes untracked files",
  },
  {
    id: "git-push-force",
    severity: "high",
    pattern: /\bgit\s+push\b.*(?:--force\b|-f\b|--force-with-lease\b)/i,
    reason: "Force pushes and can overwrite remote commits",
  },
  {
    id: "docker-prune-force",
    severity: "high",
    pattern: /\bdocker\s+(?:system|volume|image|container|builder)\s+prune\b.*(?:-f|--force)\b/i,
    reason: "Force prunes Docker resources",
  },
  {
    id: "docker-remove-force",
    severity: "medium",
    pattern: /\bdocker\s+(?:rm|rmi|volume\s+rm)\b.*(?:-f|--force)\b/i,
    reason: "Force removes Docker containers, images or volumes",
  },
  {
    id: "kubernetes-delete",
    severity: "high",
    pattern:
      /\bkubectl\s+delete\b.*(?:--all\b|-A\b|--all-namespaces\b|namespace\b|ns\b|deployment\b|pod\b|service\b|secret\b|configmap\b|pvc\b|pv\b)/i,
    reason: "Deletes Kubernetes resources",
  },
  {
    id: "process-kill-broad",
    severity: "medium",
    pattern:
      /\b(?:killall|pkill)\b\s+(?:-9\s+)?(?:node|python|java|docker|containerd|sshd|nginx|mysql|postgres|redis)\b/i,
    reason: "Kills processes in bulk",
  },
  {
    id: "systemctl-critical",
    severity: "medium",
    pattern:
      /\bsystemctl\s+(?:stop|disable|mask|restart)\s+(?:sshd|ssh|docker|network|networking|firewalld|ufw|nginx|mysql|postgres|redis)\b/i,
    reason: "Stops, disables or restarts a critical system service",
  },
  {
    id: "sensitive-env-file",
    severity: "high",
    pattern: /(?:^|[\s|;&<>])(?:\S*[/\\])?\.env(?:\.[^\s|;&<>]*)?(?=$|[\s|;&<>])/i,
    reason: "Reaches an .env file through bash and can leak or change secrets",
  },
  {
    id: "sensitive-secret-file",
    severity: "high",
    pattern:
      /(?:^|[\s|;&<>])\S*(?:secret|secrets|credential|credentials|creds|token|tokens|private[-_]?key|api[-_]?key|access[-_]?key)\S*(?=$|[\s|;&<>])/i,
    reason: "Reaches a file whose name suggests secrets through bash",
  },
  {
    id: "sensitive-ssh-private-key",
    severity: "critical",
    pattern: /(?:^|[\s|;&<>])(?:\S*[/\\])?(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?=$|[\s|;&<>])/i,
    reason: "Reaches an SSH private key through bash",
  },
  {
    id: "sensitive-auth-config-file",
    severity: "high",
    pattern: /(?:^|[\s|;&<>])(?:\S*[/\\])?(?:\.npmrc|\.pypirc|\.netrc|credentials)(?=$|[\s|;&<>])/i,
    reason: "Reaches a package manager, cloud or network credential file",
  },
  {
    id: "shell-rc-file",
    severity: "medium",
    pattern: /(?:^|[\s|;&<>])(?:\S*[/\\])?(?:\.bashrc|\.zshrc)(?=$|[\s|;&<>])/i,
    reason: "Reaches a shell startup file that can hold environment values and keys",
  },
  {
    id: "shutdown-reboot",
    severity: "medium",
    pattern: /\b(?:shutdown|reboot|halt|poweroff)\b/i,
    reason: "Shuts down or restarts the system",
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
  const inspected = withoutQuotedText(normalizeCommand(command));

  for (const rule of COMMAND_RULES) {
    const found = inspected.match(rule.pattern);
    if (found?.[0]) {
      matches.set(rule.id, {
        id: rule.id,
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

export function findDangerousCommandMatches(command: string): PermissionRuleMatch[] {
  if (command.trim().length === 0) {
    return [];
  }
  return collectMatches(command, 0);
}
