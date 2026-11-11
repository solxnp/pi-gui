import { expect, test } from "@playwright/test";
import type { RuntimeExtensionRecord } from "@pi-gui/session-driver/runtime-types";
import {
  describeExtension,
  extensionCopy,
  extensionSearchCopy,
} from "../../src/features/extensions/extension-copy";
import {
  extensionGroupId,
  extensionGroupLabel,
  extensionSourceSummary,
} from "../../src/features/extensions/extension-display";
import { translatorFor } from "../../src/i18n/translate";

const en = translatorFor("en");
const zh = translatorFor("zh-CN");

function record(overrides: Partial<RuntimeExtensionRecord> = {}): RuntimeExtensionRecord {
  return {
    path: "<inline:pi-gui-permission-gate>",
    displayName: "Permission gate",
    description: "Asks before a dangerous bash command runs",
    enabled: true,
    sourceInfo: {
      path: "<inline:pi-gui-permission-gate>",
      source: "builtin",
      scope: "temporary",
      origin: "top-level",
    },
    commands: [],
    tools: [],
    flags: [],
    flagDetails: [],
    shortcuts: [],
    diagnostics: [],
    ...overrides,
  };
}

test("pi-gui built-ins get a translated name, list line and detail paragraph", () => {
  expect(extensionCopy(record(), en)).toMatchObject({
    title: "Permission gate",
    description: expect.stringContaining("Asks before a dangerous command"),
    detail: expect.stringContaining("39 rules"),
  });
  expect(extensionCopy(record(), zh)).toMatchObject({
    title: "权限确认",
    description: "执行危险命令、读写凭据文件前先问你；关掉后不再拦截",
    detail: expect.stringContaining("39 条"),
  });

  // pi's own add-ons are ours too: they are listed under "Built into pi".
  const mcp = record({
    path: "builtin:mcp",
    displayName: "MCP servers",
    description: "Connects...",
  });
  expect(extensionCopy(mcp, zh).title).toBe("MCP 服务器");
  expect(extensionCopy(mcp, en).title).toBe("MCP servers");
});

test("an extension we do not own keeps the name and description its author wrote", () => {
  const mine = record({
    path: "/home/me/.pi/agent/extensions/demo.ts",
    displayName: "demo-extension",
    description: "A demo",
    sourceInfo: {
      path: "/home/me/.pi/agent/extensions/demo.ts",
      source: "file",
      scope: "user",
      origin: "top-level",
    },
  });
  expect(extensionCopy(mine, zh)).toEqual({ title: "demo-extension", description: "A demo" });
});

test("counts and group headings follow the locale", () => {
  const tools = record({
    path: "/repo/extensions/demo.ts",
    displayName: "demo",
    description: undefined,
    tools: [
      { name: "one", label: "One" },
      { name: "two", label: "Two" },
    ],
    sourceInfo: {
      path: "/repo/extensions/demo.ts",
      source: "file",
      scope: "project",
      origin: "top-level",
    },
  });
  expect(describeExtension(tools, en)).toBe("2 tools");
  expect(describeExtension(tools, zh)).toBe("2 个工具");

  expect(extensionGroupId(tools)).toBe("workspace");
  expect(extensionGroupLabel("workspace", en)).toBe("Workspace");
  expect(extensionGroupLabel("workspace", zh)).toBe("工作区");
  expect(extensionGroupLabel("piGuiTools", zh)).toBe("pi-gui 工具");
  expect(extensionGroupLabel("piAddons", zh)).toBe("pi 自带");
  expect(extensionGroupId(record({ path: "builtin:mcp" }))).toBe("piAddons");
});

test("search text includes the translated copy, so a Chinese query finds the row", () => {
  expect(extensionSearchCopy(record(), zh)).toContain("权限确认");
  expect(extensionSearchCopy(record(), zh)).toContain("危险命令");
  expect(extensionSearchCopy(record(), en)).toContain("Permission gate");
});

test("the @ menu source line stays English, as the rest of that list is not localised yet", () => {
  expect(extensionSourceSummary(record())).toBe("pi-gui tools · top-level");
});
