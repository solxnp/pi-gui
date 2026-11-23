import test from "node:test";
import assert from "node:assert/strict";
import { isInterjectionSteer } from "@pi-gui/session-driver";
import {
  injectInterjectionPreamble,
  isInterjectionMessage,
  messageText,
  transcriptFromMessages,
} from "../dist/session-supervisor-utils.js";

const INTERJECTION_START = "<pi-gui-interjection>";
const INTERJECTION_END = "</pi-gui-interjection>";

function steered(text: string) {
  return { role: "user", content: [{ type: "text", text: injectInterjectionPreamble(text) }] };
}

await test("a steering message carries the block the model needs", () => {
  const wrapped = injectInterjectionPreamble("先告诉我怎么注册账号");
  assert.ok(wrapped.startsWith(INTERJECTION_START));
  assert.ok(wrapped.includes(INTERJECTION_END));
  assert.ok(wrapped.includes("Do not end your run with only a reply"));
  assert.ok(wrapped.endsWith("先告诉我怎么注册账号"));
});

await test("the block never reaches the transcript text", () => {
  assert.equal(messageText(steered("先告诉我怎么注册账号")), "先告诉我怎么注册账号");
  const items = transcriptFromMessages([steered("先告诉我怎么注册账号")]);
  const row = items.find((item) => item.kind === "message");
  assert.ok(row && row.kind === "message");
  assert.deepEqual(row.attachments ?? [], []);
});

await test("a steered message with file attachments keeps both envelopes out of the text", () => {
  const files = {
    version: 1,
    files: [{ kind: "file", name: "a.ts", mimeType: "text/plain", fsPath: "/tmp/a.ts" }],
  };
  const content = [
    {
      type: "text",
      text: injectInterjectionPreamble(
        `<pi-gui-file-attachments>${JSON.stringify(files)}</pi-gui-file-attachments>\n看一下这个`,
      ),
    },
  ];
  const message = { role: "user", content };
  assert.equal(messageText(message), "看一下这个");
  const items = transcriptFromMessages([message]);
  const row = items.find((item) => item.kind === "message");
  assert.ok(row && row.kind === "message");
  assert.equal(row.attachments?.length, 1);
  assert.equal(row.interjection, true);
});

await test("transcript rows keep the interjection flag and the plain text", () => {
  const items = transcriptFromMessages([steered("顺手看下这个")]);
  const row = items.find((item) => item.kind === "message");
  assert.ok(row && row.kind === "message");
  assert.equal(row.text, "顺手看下这个");
  assert.equal(row.interjection, true);
});

await test("an ordinary prompt is not marked as an interjection", () => {
  const items = transcriptFromMessages([
    { role: "user", content: [{ type: "text", text: "正常提问" }] },
  ]);
  const row = items.find((item) => item.kind === "message");
  assert.ok(row && row.kind === "message");
  assert.equal(row.interjection, undefined);
  assert.equal(isInterjectionMessage({ role: "user", content: "正常提问" }), false);
});

await test("a message that merely mentions the marker mid-text is left alone", () => {
  const message = {
    role: "user",
    content: [{ type: "text", text: `标题 ${INTERJECTION_START} 不是插话` }],
  };
  assert.equal(isInterjectionMessage(message), false);
  assert.equal(messageText(message), `标题 ${INTERJECTION_START} 不是插话`);
});

await test("a user prompt that pastes the opening tag is neither stripped nor labelled", () => {
  const pasted = `${INTERJECTION_START} 这个标签是什么意思？帮我解释一下`;
  const message = { role: "user", content: [{ type: "text", text: pasted }] };
  assert.equal(isInterjectionMessage(message), false);
  assert.equal(messageText(message), pasted);
});

await test("an assistant that starts with the same tag is not a steering message", () => {
  const message = {
    role: "assistant",
    content: [{ type: "text", text: injectInterjectionPreamble("回显") }],
  };
  assert.equal(isInterjectionMessage(message), false);
  const row = transcriptFromMessages([message]).find((item) => item.kind === "message");
  assert.ok(row && row.kind === "message");
  assert.equal(row.interjection, undefined);
});

await test("the instruction lets the user stop the run", () => {
  const wrapped = injectInterjectionPreamble("先停下，别动了");
  assert.match(wrapped, /stop, wait or undo the work/);
  assert.match(wrapped, /the user outranks this note/);
  assert.ok(!wrapped.includes("<pi-gui-file-attachments>"));
});

await test("a slash steer is not an interjection, so both sides agree on the label", () => {
  // The driver leaves `/…` text untouched so pi can expand it; the row must then stay unlabelled
  // live and after a reload, instead of being labelled from `mode` alone.
  assert.equal(isInterjectionSteer({ mode: "steer", text: "/skill:verify-pi-gui" }), false);
  assert.equal(isInterjectionSteer({ mode: "steer", text: "顺便问一句" }), true);
  assert.equal(isInterjectionSteer({ mode: "followUp", text: "顺便问一句" }), false);
});
