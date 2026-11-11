import { useState, type ReactNode } from "react";
import type { HostUiResponse } from "@pi-gui/session-driver";
import type { SessionExtensionDialogRecord } from "../../../contracts/desktop-state";
import { useTranslation } from "../../i18n";

export type ExtensionFormDialog = Extract<SessionExtensionDialogRecord, { kind: "form" }>;
/** The request a pending question carries, as the timeline receives it. */
export type PendingExtensionForm = ExtensionFormDialog;
export type ExtensionFormAnswer = string | readonly string[];
export type ExtensionFormValues = Readonly<Record<string, ExtensionFormAnswer>>;

/** The mark a "write my own" pick carries before its text replaces it. */
const OTHER_PREFIX = "other:";
const OTHER_VALUE_SUFFIX = ":other";

/**
 * A form an extension asked for with `ctx.ui.form(...)`, drawn in the conversation instead of in a
 * dialog: every question on one card, one submit, and the extension stays blocked until it lands.
 * A `multi` question takes any number of options, so it draws checkboxes.
 */
export function ExtensionFormCard({
  form,
  onSubmit,
}: {
  readonly form: ExtensionFormDialog;
  readonly onSubmit: (values: Record<string, ExtensionFormAnswer>) => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [otherText, setOtherText] = useState<Readonly<Record<string, string>>>({});
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({});

  const complete = form.fields.every(
    (field) =>
      field.required === false ||
      (field.kind === "text"
        ? (typed[field.id] ?? "").trim().length > 0
        : hasAnswer(field.id, picked, otherText)),
  );

  const pick = (fieldId: string, value: string, multiple: boolean) =>
    setPicked((current) => {
      const chosen = current[fieldId] ?? [];
      if (!multiple) return { ...current, [fieldId]: [value] };
      return {
        ...current,
        [fieldId]: chosen.includes(value)
          ? chosen.filter((entry) => entry !== value)
          : [...chosen, value],
      };
    });

  return (
    <section
      aria-label={form.title}
      className="extension-form"
      data-testid="extension-form"
      role="group"
    >
      <header className="extension-form__header">
        <span className="extension-form__glyph" aria-hidden="true">
          ?
        </span>
        <span className="extension-form__title">{form.title}</span>
      </header>
      <div className="extension-form__body" data-testid="extension-form-body">
        {form.description ? (
          <p className="extension-form__description">{form.description}</p>
        ) : null}
        {form.fields.map((field) => {
          if (field.kind === "text") {
            return (
              <fieldset className="extension-form__field" key={field.id}>
                <legend className="extension-form__legend">{field.title}</legend>
                {field.description ? (
                  <p className="extension-form__field-description">{field.description}</p>
                ) : null}
                <textarea
                  aria-label={field.title}
                  className="extension-form__text-input"
                  data-testid="extension-form-text-input"
                  placeholder={field.placeholder}
                  rows={3}
                  value={typed[field.id] ?? ""}
                  onChange={(event) =>
                    setTyped((current) => ({ ...current, [field.id]: event.target.value }))
                  }
                />
              </fieldset>
            );
          }
          const multiple = field.kind === "multi";
          const chosen = picked[field.id] ?? [];
          return (
            <fieldset className="extension-form__field" key={field.id}>
              <legend className="extension-form__legend">{field.title}</legend>
              {field.description ? (
                <p className="extension-form__field-description">{field.description}</p>
              ) : null}
              <div className="extension-form__options">
                {(field.options ?? []).map((option) => (
                  <OptionRow
                    checked={chosen.includes(option.value)}
                    key={option.value}
                    multiple={multiple}
                    name={field.id}
                    value={option.value}
                    onPick={() => pick(field.id, option.value, multiple)}
                  >
                    <span className="extension-form__option-title">
                      {option.label}
                      {option.recommended ? (
                        <span
                          className="extension-form__badge"
                          data-testid="extension-form-option-badge"
                        >
                          {t("extensionDialog.recommended")}
                        </span>
                      ) : null}
                    </span>
                    {option.description ? (
                      <span className="extension-form__option-description">
                        {option.description}
                      </span>
                    ) : null}
                  </OptionRow>
                ))}
                {form.allowOther ? (
                  <OptionRow
                    checked={chosen.includes(otherValue(field.id))}
                    multiple={multiple}
                    name={field.id}
                    value={otherValue(field.id)}
                    onPick={() => pick(field.id, otherValue(field.id), multiple)}
                  >
                    <span className="extension-form__option-title">{t("extensionForm.other")}</span>
                    <input
                      aria-label={`${field.title}: ${t("extensionForm.other")}`}
                      className="extension-form__other-input"
                      data-testid="extension-form-other-input"
                      placeholder={t("extensionForm.otherPlaceholder")}
                      type="text"
                      value={otherText[field.id] ?? ""}
                      onChange={(event) => {
                        setOtherText((current) => ({ ...current, [field.id]: event.target.value }));
                        if (!chosen.includes(otherValue(field.id))) {
                          pick(field.id, otherValue(field.id), multiple);
                        }
                      }}
                    />
                  </OptionRow>
                ) : null}
              </div>
            </fieldset>
          );
        })}
      </div>
      <footer className="extension-form__footer">
        <button
          className="button button--primary"
          data-testid="extension-form-submit"
          disabled={!complete}
          type="button"
          onClick={() => onSubmit(collectAnswers(form, picked, otherText, typed))}
        >
          {form.submitLabel ?? t("extensionForm.submit")}
        </button>
      </footer>
    </section>
  );
}

function OptionRow({
  checked,
  multiple,
  name,
  value,
  onPick,
  children,
}: {
  readonly checked: boolean;
  readonly multiple: boolean;
  readonly name: string;
  readonly value: string;
  readonly onPick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <label className={`extension-form__option ${checked ? "extension-form__option--picked" : ""}`}>
      <input
        checked={checked}
        name={name}
        type={multiple ? "checkbox" : "radio"}
        value={value}
        onChange={onPick}
      />
      <span className="extension-form__option-body">{children}</span>
    </label>
  );
}

function otherValue(fieldId: string): string {
  return `${OTHER_PREFIX}${fieldId}${OTHER_VALUE_SUFFIX}`;
}

function isOther(value: string): boolean {
  return value.startsWith(OTHER_PREFIX) && value.endsWith(OTHER_VALUE_SUFFIX);
}

function hasAnswer(
  fieldId: string,
  picked: Readonly<Record<string, readonly string[]>>,
  otherText: Readonly<Record<string, string>>,
): boolean {
  const chosen = picked[fieldId] ?? [];
  return chosen.some((value) =>
    isOther(value) ? (otherText[fieldId] ?? "").trim().length > 0 : true,
  );
}

/** What the extension receives: a string for one choice, an array for a multi choice. */
function collectAnswers(
  form: ExtensionFormDialog,
  picked: Readonly<Record<string, readonly string[]>>,
  otherText: Readonly<Record<string, string>>,
  typed: Readonly<Record<string, string>>,
): Record<string, ExtensionFormAnswer> {
  const values: Record<string, ExtensionFormAnswer> = {};
  for (const field of form.fields) {
    if (field.kind === "text") {
      const text = (typed[field.id] ?? "").trim();
      if (text) values[field.id] = text;
      continue;
    }
    const chosen = picked[field.id] ?? [];
    const resolved: string[] = [];
    for (const value of chosen) {
      if (isOther(value)) {
        const typed = (otherText[field.id] ?? "").trim();
        if (typed) resolved.push(typed);
        continue;
      }
      if ((field.options ?? []).some((option) => option.value === value)) resolved.push(value);
    }
    if (resolved.length === 0) continue;
    values[field.id] = field.kind === "multi" ? resolved : (resolved[0] ?? "");
  }
  return values;
}
