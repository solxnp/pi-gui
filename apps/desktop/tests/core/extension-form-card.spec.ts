import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSession,
  writeProjectExtension,
} from "../helpers/electron-app";

// `ctx.ui.form` is pi-gui's own host method: pi spreads the UI context it is given onto `ctx.ui`,
// so an extension can ask several questions in one blocking call and get the answers back while
// the tool is still running. The card is drawn in the conversation, never in a dialog.
const extensionSource = String.raw`
export default function formExtension(pi) {
  pi.registerCommand("form-ask", {
    description: "Ask two questions as an inline card",
    handler: async (_args, ctx) => {
      const values = await ctx.ui.form({
        title: "需要你决定",
        description: "共 2 个问题，选完一起提交",
        fields: [
          {
            id: "q1",
            title: "AI 生成内容的入库底线选哪个？",
            description: "只影响新生成的题目",
            options: [
              {
                value: "标识可查可删",
                label: "标识可查可删",
                description: "每题记 source/model，家长可筛可删",
                recommended: true,
              },
              {
                value: "直接可用",
                label: "直接可用",
                description: "不加元数据，成本最低",
              },
            ],
          },
          {
            id: "q2",
            title: "先审后用要不要开？",
            options: [
              { value: "开", label: "开", description: "家长通过后才推送" },
              { value: "关", label: "关", description: "与每日 1 分钟冲突" },
            ],
          },
        ],
        allowOther: true,
        submitLabel: "提交回答",
      });
      ctx.ui.notify(
        values
          ? "Form answers " + values.q1 + " / " + values.q2
          : "Form cancelled",
        "info",
      );
    },
  });

  pi.registerCommand("form-with-note", {
    description: "Ask one question plus an optional note",
    handler: async (_args, ctx) => {
      const values = await ctx.ui.form({
        title: "需要你决定",
        description: "请选择一项",
        fields: [
          {
            id: "answer",
            title: "下一步先做哪件？",
            options: [
              { value: "p2", label: "补多选", description: "同卡勾选多条", recommended: true },
              { value: "p3", label: "做收尾", description: "验证与文档" },
            ],
          },
          {
            id: "note",
            kind: "text",
            title: "备注（可选）",
            required: false,
            placeholder: "写你自己的理由",
          },
        ],
        allowOther: true,
        submitLabel: "提交回答",
      });
      ctx.ui.notify(
        values ? "Answered " + values.answer + " / note:" + (values.note ?? "") : "Cancelled",
        "info",
      );
    },
  });

  pi.registerCommand("form-multi", {
    description: "Ask a question that takes several answers",
    handler: async (_args, ctx) => {
      const values = await ctx.ui.form({
        title: "需要你决定",
        description: "可以多选，选完提交",
        fields: [
          {
            id: "picks",
            kind: "multi",
            title: "哪几条一起做？",
            options: [
              { value: "multi", label: "补多选", recommended: true },
              { value: "persist", label: "已回答持久化" },
              { value: "pack", label: "打包替换安装版" },
            ],
          },
        ],
        allowOther: false,
        submitLabel: "提交回答",
      });
      ctx.ui.notify(
        values && Array.isArray(values.picks)
          ? "Multi " + values.picks.join("+")
          : "Multi cancelled",
        "info",
      );
    },
  });

  pi.registerCommand("form-tall", {
    description: "Ask a form that is taller than its card",
    handler: async (_args, ctx) => {
      const values = await ctx.ui.form({
        title: "需要你决定",
        description: "共 3 个问题，选完一起提交",
        fields: Array.from({ length: 3 }, (_, index) => ({
          id: "q" + (index + 1),
          title: "第 " + (index + 1) + " 个问题",
          options: Array.from({ length: 5 }, (_, optionIndex) => ({
            value: "v" + (optionIndex + 1),
            label: "选项 " + (optionIndex + 1),
            description: "这是一段比较长的说明，用来把卡片撑高，验证卡片自己会滚动。",
          })),
        })),
        allowOther: false,
        submitLabel: "提交回答",
      });
      ctx.ui.notify(values ? "Tall form answered" : "Tall form cancelled", "info");
    },
  });
}
`;

test("a form asked by an extension is answered inline in the conversation", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("extension-form-workspace");
  await writeProjectExtension(workspacePath, "form-extension.ts", extensionSource);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Form session");

    const composer = window.getByTestId("composer");
    await composer.fill("/form-ask ");
    await composer.press("Enter");

    // The question is drawn in the conversation itself, not above the composer.
    const card = window.getByTestId("timeline-pane").getByTestId("extension-form");
    await expect(card).toBeVisible();
    // It scrolls with the conversation and lands on screen without the user hunting for it.
    await expect(card).toBeInViewport();
    await expect(composer).toBeInViewport();
    await expect(card).toContainText("需要你决定");
    await expect(card).toContainText("AI 生成内容的入库底线选哪个？");
    await expect(card).toContainText("只影响新生成的题目");
    // Two questions on one card, and no modal dialog standing in front of it.
    await expect(card.getByRole("group", { name: "AI 生成内容的入库底线选哪个？" })).toHaveCount(1);
    await expect(card.getByRole("group", { name: "先审后用要不要开？" })).toHaveCount(1);
    await expect(window.getByTestId("extension-dialog")).toHaveCount(0);

    // The option's title, its explanation, and the recommended badge all belong to one row.
    const recommendedOption = card.getByRole("radio", {
      name: /标识可查可删.*每题记 source\/model，家长可筛可删/,
    });
    await expect(recommendedOption).toBeVisible();
    await expect(card.getByTestId("extension-form-option-badge")).toHaveText(
      /^(Recommended|推荐)$/,
    );

    // Submit stays disabled until every question is answered.
    const submit = card.getByTestId("extension-form-submit");
    await expect(submit).toBeDisabled();
    await recommendedOption.check();
    await expect(submit).toBeDisabled();
    await card.getByRole("radio", { name: /^关/ }).check();
    await expect(submit).toBeEnabled();

    await submit.click();
    // The question and its answer stay in the transcript, where they were asked.
    await expect(card).toHaveCount(0);
    const answeredCard = window.getByTestId("extension-card").last();
    await expect(answeredCard).toContainText("需要你决定");
    // The whole board stays: every question, every option, and the picked ones marked.
    const board = answeredCard.getByTestId("extension-card-board");
    await expect(board).toContainText("AI 生成内容的入库底线选哪个？");
    await expect(board).toContainText("只影响新生成的题目");
    await expect(board).toContainText("直接可用");
    await expect(board).toContainText("不加元数据，成本最低");
    await expect(board).toContainText("先审后用要不要开？");
    const picked = board.locator('li[data-picked="true"]');
    const notPicked = board.locator('li[data-picked="false"]');
    await expect(picked).toHaveCount(2);
    await expect(picked.first()).toContainText("标识可查可删");
    await expect(picked.nth(1)).toContainText("关");
    await expect(notPicked).toHaveCount(2);
    await expect(notPicked.first()).toContainText("直接可用");
    await expect(answeredCard.getByTestId("extension-card-answered")).toHaveText(
      /^(Answered|已回答)$/,
    );
    // The board is the whole answer: no answer strip repeats the question and the pick under it.
    await expect(answeredCard.getByText(/^(The user answered:|用户的回答：)$/)).toHaveCount(0);
    await expect(answeredCard.locator(".extension-card__row")).toHaveCount(0);
    await expect(window.getByTestId("extension-notices")).toContainText(
      "Form answers 标识可查可删 / 关",
    );
  } finally {
    await harness.close();
  }
});

test("a form accepts a written answer when no option fits", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("extension-form-other-workspace");
  await writeProjectExtension(workspacePath, "form-extension.ts", extensionSource);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Form other session");

    const composer = window.getByTestId("composer");
    await composer.fill("/form-ask ");
    await composer.press("Enter");

    const card = window.getByTestId("extension-form");
    await expect(card).toBeVisible();
    const submit = card.getByTestId("extension-form-submit");

    // Writing my own answer counts as answering, and what the extension receives is the text.
    await card
      .getByRole("radio", { name: /标识可查可删/ })
      .first()
      .check();
    const secondQuestion = card.getByRole("group", { name: "先审后用要不要开？" });
    // The "write my own" row is app copy, so it follows the UI language the harness pins.
    await secondQuestion.getByRole("radio", { name: /^(其他|Other)/ }).check();
    await expect(submit).toBeDisabled();
    const otherInput = secondQuestion.getByTestId("extension-form-other-input");
    await otherInput.click();
    await otherInput.fill("先做灰度，看两周数据再定");
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(window.getByTestId("extension-notices")).toContainText(
      "Form answers 标识可查可删 / 先做灰度，看两周数据再定",
    );
  } finally {
    await harness.close();
  }
});

test("a tall form grows in the conversation instead of scrolling inside itself", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("extension-form-tall-workspace");
  await writeProjectExtension(workspacePath, "form-extension.ts", extensionSource);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Tall form session");

    const composer = window.getByTestId("composer");
    await composer.fill("/form-tall ");
    await composer.press("Enter");

    const card = window.getByTestId("extension-form");
    await expect(card).toBeVisible();
    // The card is conversation content, not a dialog: it grows and the transcript scrolls it, so
    // the wheel never gets stuck inside the card and the composer stays where it was.
    const body = card.getByTestId("extension-form-body");
    expect(await body.evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(0);
    await expect(composer).toBeInViewport();
    // It reads like a message column: the card is as wide as the transcript, not the whole pane.
    const cardWidth = (await card.boundingBox())?.width ?? 0;
    const transcriptWidth = (await window.getByTestId("transcript").boundingBox())?.width ?? 0;
    expect(Math.abs(cardWidth - transcriptWidth)).toBeLessThan(2);
    // Taller than the pane, so it opens at its own top: the first question is what you read first.
    await expect(card.getByRole("group", { name: "第 1 个问题" })).toBeInViewport();

    for (const index of [1, 2, 3]) {
      const question = card.getByRole("group", { name: `第 ${index} 个问题` });
      await question.getByRole("radio", { name: /选项 1/ }).check();
    }
    const submit = card.getByTestId("extension-form-submit");
    await expect(submit).toBeEnabled();
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    await submit.click();
    await expect(window.getByTestId("extension-notices")).toContainText("Tall form answered");
  } finally {
    await harness.close();
  }
});

test("a question carries an optional note that comes back with the answer", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("extension-form-note-workspace");
  await writeProjectExtension(workspacePath, "form-extension.ts", extensionSource);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Form note session");

    const composer = window.getByTestId("composer");
    await composer.fill("/form-with-note ");
    await composer.press("Enter");

    const card = window.getByTestId("extension-form");
    await expect(card).toBeVisible();
    const note = card.getByTestId("extension-form-text-input");
    await expect(note).toBeVisible();
    const submit = card.getByTestId("extension-form-submit");

    // The note is optional: the answer alone is enough to submit.
    await card.getByRole("radio", { name: /补多选/ }).check();
    await expect(submit).toBeEnabled();
    await note.fill("多选对我更顺手");
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(window.getByTestId("extension-notices")).toContainText(
      "Answered p2 / note:多选对我更顺手",
    );
    const answeredCard = window.getByTestId("extension-card").last();
    await expect(answeredCard).toContainText("下一步先做哪件？");
    await expect(answeredCard).toContainText("备注（可选）");
    // The note is echoed in its own row of the board, not repeated in a strip below it.
    await expect(answeredCard.getByTestId("extension-card-board-note")).toHaveText(
      "多选对我更顺手",
    );
    await expect(answeredCard.locator(".extension-card__row")).toHaveCount(0);
  } finally {
    await harness.close();
  }

  // The answer is a session entry, not renderer state: reopening the thread still shows it.
  const reopened = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await reopened.firstWindow();
    await selectSession(window, "Form note session");
    const card = window.getByTestId("extension-card");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("下一步先做哪件？");
    await expect(card).toContainText("补多选");
    await expect(card).toContainText("多选对我更顺手");
    await expect(window.getByTestId("extension-form")).toHaveCount(0);
  } finally {
    await reopened.close();
  }
});

test("a multi question answers with every checked option", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("extension-form-multi-workspace");
  await writeProjectExtension(workspacePath, "form-extension.ts", extensionSource);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Form multi session");

    const composer = window.getByTestId("composer");
    await composer.fill("/form-multi ");
    await composer.press("Enter");

    const card = window.getByTestId("extension-form");
    await expect(card).toBeVisible();
    const submit = card.getByTestId("extension-form-submit");
    // A multi question draws checkboxes, so nothing is checked to begin with.
    const boxes = card.getByRole("checkbox");
    await expect(boxes).toHaveCount(3);
    await expect(submit).toBeDisabled();
    await card.getByRole("checkbox", { name: /补多选/ }).check();
    await card.getByRole("checkbox", { name: /打包替换安装版/ }).check();
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(window.getByTestId("extension-notices")).toContainText("Multi multi+pack");
  } finally {
    await harness.close();
  }
});
