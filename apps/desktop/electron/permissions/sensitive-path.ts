/**
 * Sensitive file path detection for pi-gui's built-in permission gate.
 *
 * Names are matched as a whole (stem or full filename), not as a substring: `tokenizer.ts` and
 * `auth-utils.ts` are ordinary source files, while `tokens.json`, `auth.json` and `.env.local` hold
 * credentials. `.env.example` and its siblings are templates, so they stay quiet.
 */

export interface SensitivePathMatch {
  readonly id: string;
  readonly reason: string;
  readonly matchedText: string;
}

interface PathRule {
  readonly id: string;
  readonly reason: string;
}

/** Compared against the filename with its extension removed. */
const SENSITIVE_STEMS: ReadonlyMap<string, PathRule> = new Map([
  [
    ".env",
    {
      id: "env-file",
      reason: "环境变量文件，通常放着 API Key、Token、数据库密码",
    },
  ],
  ["id_rsa", { id: "ssh-private-key", reason: "SSH 私钥" }],
  ["id_dsa", { id: "ssh-private-key", reason: "SSH 私钥" }],
  ["id_ecdsa", { id: "ssh-private-key", reason: "SSH 私钥" }],
  ["id_ed25519", { id: "ssh-private-key", reason: "SSH 私钥" }],
  [".npmrc", { id: "package-credentials", reason: "包管理器的仓库凭据" }],
  [".pypirc", { id: "package-credentials", reason: "Python 包索引凭据" }],
  [".netrc", { id: "network-credentials", reason: "网络认证凭据文件" }],
  [".git-credentials", { id: "network-credentials", reason: "Git 保存的账号凭据" }],
  [".bashrc", { id: "shell-rc-file", reason: "shell 启动文件，里面可能有密钥或环境变量" }],
  [".zshrc", { id: "shell-rc-file", reason: "shell 启动文件，里面可能有密钥或环境变量" }],
  ["secret", { id: "secret-file", reason: "文件名就是 secret / secrets" }],
  ["secrets", { id: "secret-file", reason: "文件名就是 secret / secrets" }],
  ["credential", { id: "credential-file", reason: "文件名就是 credential / credentials / creds" }],
  ["credentials", { id: "credential-file", reason: "文件名就是 credential / credentials / creds" }],
  ["creds", { id: "credential-file", reason: "文件名就是 credential / credentials / creds" }],
  ["token", { id: "token-file", reason: "文件名就是 token / tokens" }],
  ["tokens", { id: "token-file", reason: "文件名就是 token / tokens" }],
]);

/** Compared against the full filename. */
const SENSITIVE_FILES: ReadonlyMap<string, PathRule> = new Map([
  ["auth.json", { id: "auth-file", reason: "pi 保存的模型供应商凭据" }],
  [
    "credentials.json",
    { id: "credential-file", reason: "文件名就是 credential / credentials / creds" },
  ],
  ["secrets.yml", { id: "secret-file", reason: "文件名就是 secret / secrets" }],
  ["secrets.yaml", { id: "secret-file", reason: "文件名就是 secret / secrets" }],
  ["secrets.json", { id: "secret-file", reason: "文件名就是 secret / secrets" }],
]);

/** Private key material keeps its name and carries a key extension. */
const PRIVATE_KEY_EXTENSIONS: readonly string[] = [".pem", ".key", ".p12", ".pfx", ".keystore"];

/** `tokens.md` and `secrets.rst` are notes about secrets, not secrets. */
const DOCUMENT_EXTENSIONS: readonly string[] = [".md", ".mdx", ".rst"];

/** `.env.example` documents which values exist; it holds no secret of its own. */
const ENV_TEMPLATE = /^\.env\.(?:example|sample|template|dist|schema|defaults)$/i;

function fileNameOf(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return (separator === -1 ? path : path.slice(separator + 1)).toLowerCase();
}

function stemOf(fileName: string): string {
  const dot = fileName.indexOf(".", fileName.startsWith(".") ? 1 : 0);
  return dot === -1 ? fileName : fileName.slice(0, dot);
}

function extensionOf(fileName: string): string {
  const dot = fileName.indexOf(".", fileName.startsWith(".") ? 1 : 0);
  return dot === -1 ? "" : fileName.slice(dot);
}

export function findSensitivePathMatches(path: string): SensitivePathMatch[] {
  const fileName = fileNameOf(path);
  if (fileName.length === 0) {
    return [];
  }

  const matches: SensitivePathMatch[] = [];
  const record = (rule: PathRule): void => {
    if (matches.some((match) => match.id === rule.id)) {
      return;
    }
    matches.push({ id: rule.id, reason: rule.reason, matchedText: fileName });
  };

  if (ENV_TEMPLATE.test(fileName)) {
    return matches;
  }

  const exact = SENSITIVE_FILES.get(fileName);
  if (exact) {
    record(exact);
  }

  const stem = SENSITIVE_STEMS.get(stemOf(fileName));
  if (stem && !DOCUMENT_EXTENSIONS.includes(extensionOf(fileName))) {
    record(stem);
  }

  if (PRIVATE_KEY_EXTENSIONS.includes(extensionOf(fileName))) {
    record({ id: "private-key-file", reason: "私钥或证书文件（.pem/.key/.p12 等）" });
  }

  return matches;
}
