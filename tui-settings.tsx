/**
 * Settings wizard — extracted from tui.tsx for maintainability.
 */

import type { ReactNode } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { useCallback, useMemo, useState } from "react";

export type SettingsField = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly required?: boolean;
  readonly secret?: boolean;
  readonly type?: "text" | "select";
  readonly options?: readonly string[];
};

type SettingsWizardConfig = {
  readonly title: string;
  readonly subtitle?: string;
  readonly fields: SettingsField[];
};

type SettingsWizardResult =
  | { readonly status: "saved"; readonly values: Record<string, string> }
  | { readonly status: "cancelled" };

type InkKey = {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
  name?: string;
};

function formatFieldValue(field: SettingsField, value: string): string {
  if (field.secret) return value.length > 0 ? "•".repeat(Math.min(12, value.length)) : "";
  return value;
}

function SettingsWizardApp({
  config,
  onDone,
}: {
  readonly config: SettingsWizardConfig;
  readonly onDone: (result: SettingsWizardResult) => void;
}): ReactNode {
  const { exit } = useApp();
  const [index, setIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    config.fields.forEach((field) => { initial[field.key] = field.value ?? ""; });
    return initial;
  });

  const fields = config.fields;
  const isReview = index >= fields.length;
  const currentField = fields[Math.min(index, fields.length - 1)];

  const currentValue = useMemo(() => {
    if (!currentField) return "";
    const raw = values[currentField.key] ?? "";
    if (currentField.type === "select") {
      const options = currentField.options ?? [];
      if (options.includes(raw)) return raw;
      return options[0] ?? raw;
    }
    return raw;
  }, [currentField, values]);

  const updateValue = useCallback((value: string) => {
    if (!currentField) return;
    setValues((prev) => ({ ...prev, [currentField.key]: value }));
  }, [currentField]);

  const moveNext = useCallback(() => { setIndex((prev) => Math.min(prev + 1, fields.length)); }, [fields.length]);
  const movePrev = useCallback(() => { setIndex((prev) => Math.max(0, prev - 1)); }, []);
  const save = useCallback(() => { onDone({ status: "saved", values }); exit(); }, [exit, onDone, values]);
  const cancel = useCallback(() => { onDone({ status: "cancelled" }); exit(); }, [exit, onDone]);

  useInput((input, rawKey) => {
    const key = rawKey as InkKey;
    const keyName = (rawKey as { name?: string }).name;
    if (key.ctrl && keyName === "c") { cancel(); return; }
    if (key.escape) { cancel(); return; }
    if (isReview) {
      if (key.return) save();
      if (key.upArrow) movePrev();
      return;
    }
    if (!currentField) return;
    if (currentField.type === "select") {
      const options = currentField.options ?? [];
      if (options.length === 0) return;
      const currentIdx = Math.max(0, options.indexOf(currentValue));
      if (key.leftArrow) { updateValue(options[(currentIdx - 1 + options.length) % options.length] ?? currentValue); return; }
      if (key.rightArrow) { updateValue(options[(currentIdx + 1) % options.length] ?? currentValue); return; }
      if (key.return) { moveNext(); return; }
    }
    if (key.upArrow) { movePrev(); return; }
    if (key.downArrow) moveNext();
  });

  const summaryLines = useMemo(() => {
    return fields.map((field) => {
      const value = values[field.key] ?? "";
      const pretty = formatFieldValue(field, value);
      const requiredMark = field.required ? "*" : "";
      const display = pretty.length > 0 ? pretty : "(empty)";
      return `${field.label}${requiredMark}: ${display}`;
    });
  }, [fields, values]);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>{config.title}</Text>
      {config.subtitle ? <Text dimColor>{config.subtitle}</Text> : null}
      <Box marginTop={1} flexDirection="column">
        {isReview ? (
          <Box flexDirection="column">
            <Text>Review settings:</Text>
            {summaryLines.map((line) => (<Text key={line}>{line}</Text>))}
            <Box marginTop={1}><Text dimColor>Press Enter to save, Esc to cancel, Up to edit.</Text></Box>
          </Box>
        ) : currentField ? (
          <Box flexDirection="column">
            <Text>{currentField.label}{currentField.required ? "*" : ""} ({index + 1}/{fields.length})</Text>
            {currentField.type === "select" ? (
              <Box><Text dimColor>Use ← → to change, Enter to confirm. </Text><Text color="cyan">{currentValue}</Text></Box>
            ) : (
              <TextInput value={currentValue} onChange={updateValue} onSubmit={moveNext} placeholder={currentField.secret ? "(hidden)" : ""} />
            )}
            <Box marginTop={1}><Text dimColor>Enter to continue, Esc to cancel, Up/Down to move.</Text></Box>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

export async function runSettingsWizard(config: SettingsWizardConfig): Promise<SettingsWizardResult> {
  return new Promise((resolve) => {
    let result: SettingsWizardResult = { status: "cancelled" };
    const { waitUntilExit, unmount } = render(
      <SettingsWizardApp config={config} onDone={(next) => { result = next; }} />
    );
    void waitUntilExit().then(() => { unmount(); resolve(result); });
  });
}
