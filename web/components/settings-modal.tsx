"use client";

import { useState } from "react";
import { type UserKeys, hasRequiredKeys } from "@/lib/keys";

type SettingsModalProps = {
  initialKeys: UserKeys;
  onSave: (keys: UserKeys) => void;
  onDisconnect?: () => void;
  isEdit?: boolean;
};

type FieldDef = {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
};

const LLM_PROVIDERS = [
  { value: "OPENAI_API_KEY", label: "OpenAI" },
  { value: "ANTHROPIC_API_KEY", label: "Anthropic" },
  { value: "GOOGLE_GENERATIVE_AI_API_KEY", label: "Gemini" },
  { value: "GROQ_API_KEY", label: "Groq" },
  { value: "XAI_API_KEY", label: "Grok" },
];

const POLYMARKET_FIELDS: FieldDef[] = [
  { key: "EVM_PRIVATE_KEY", label: "Wallet Private Key (hex)", placeholder: "0x...", required: true },
  { key: "CLOB_API_KEY", label: "CLOB API Key", required: true },
  { key: "CLOB_API_SECRET", label: "CLOB API Secret", required: true },
  { key: "CLOB_API_PASSPHRASE", label: "CLOB API Passphrase", required: true },
  { key: "POLYMARKET_FUNDER_ADDRESS", label: "Proxy Wallet Address", placeholder: "0x...", required: true },
  { key: "POLYMARKET_SIGNATURE_TYPE", label: "Signature Type", defaultValue: "1" },
];

const JUPITER_FIELDS: FieldDef[] = [
  { key: "JUPITER_API_KEY", label: "Jupiter API Key" },
  { key: "SOLANA_PRIVATE_KEY", label: "Solana Private Key (base58)" },
  { key: "SOLANA_RPC_URL", label: "Solana RPC URL", placeholder: "https://api.mainnet-beta.solana.com" },
];

const X402_FIELDS: FieldDef[] = [
  { key: "X402_ENABLED", label: "Enable x402 Payments", defaultValue: "false" },
  { key: "X402_MAX_PAYMENT_USD", label: "Max Payment Per Request ($)", defaultValue: "0.10" },
];

function isSecretField(key: string): boolean {
  return key.includes("KEY") || key.includes("SECRET") || key.includes("PRIVATE") || key.includes("PASSPHRASE");
}

function FieldInput({ field, value, onChange }: { field: FieldDef; value: string; onChange: (v: string) => void }) {
  return (
    <div className="mb-3">
      <label className="block text-sm font-medium text-[var(--text)] mb-1">
        {field.label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <input
        type={isSecretField(field.key) ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder ?? ""}
        className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-white text-[var(--text)] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent"
      />
    </div>
  );
}

function Section({ title, children, collapsible = false }: { title: string; children: React.ReactNode; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible);
  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => collapsible && setOpen(!open)}
        className={`text-sm font-semibold text-[var(--text)] mb-3 flex items-center gap-2 ${collapsible ? "cursor-pointer" : ""}`}
      >
        {collapsible && <span className="text-xs text-gray-400">{open ? "▼" : "▶"}</span>}
        {title}
      </button>
      {open && children}
    </div>
  );
}

export function SettingsModal({ initialKeys, onSave, onDisconnect, isEdit }: SettingsModalProps) {
  const [keys, setKeys] = useState<UserKeys>({ ...initialKeys });
  const [selectedProvider, setSelectedProvider] = useState(() => {
    return LLM_PROVIDERS.find((p) => initialKeys[p.value]?.trim())?.value ?? "OPENAI_API_KEY";
  });

  const update = (key: string, value: string) => {
    setKeys((prev) => ({ ...prev, [key]: value }));
  };

  const canConnect = hasRequiredKeys({ ...keys, [selectedProvider]: keys[selectedProvider] ?? "" });

  const handleSave = () => {
    if (!keys.POLYMARKET_SIGNATURE_TYPE?.trim()) keys.POLYMARKET_SIGNATURE_TYPE = "1";
    if (!keys.X402_MAX_PAYMENT_USD?.trim()) keys.X402_MAX_PAYMENT_USD = "0.10";
    onSave(keys);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-[var(--border)]">
          <h2 className="text-lg font-semibold text-[var(--text)]">
            {isEdit ? "Settings" : "Connect to Polyagent"}
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Enter your API keys to start trading. Keys are stored in your browser only.
          </p>
        </div>

        <div className="px-6 py-4">
          <Section title="LLM Provider">
            <div className="flex flex-wrap gap-2 mb-3">
              {LLM_PROVIDERS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setSelectedProvider(p.value)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    selectedProvider === p.value
                      ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                      : "bg-white text-[var(--text-secondary)] border-[var(--border)] hover:border-gray-400"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <FieldInput
              field={{ key: selectedProvider, label: `${LLM_PROVIDERS.find((p) => p.value === selectedProvider)?.label} API Key`, required: true }}
              value={keys[selectedProvider] ?? ""}
              onChange={(v) => update(selectedProvider, v)}
            />
          </Section>

          <Section title="Polymarket">
            {POLYMARKET_FIELDS.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={keys[field.key] ?? field.defaultValue ?? ""}
                onChange={(v) => update(field.key, v)}
              />
            ))}
          </Section>

          <Section title="Jupiter (Optional)" collapsible>
            {JUPITER_FIELDS.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={keys[field.key] ?? ""}
                onChange={(v) => update(field.key, v)}
              />
            ))}
          </Section>

          <Section title="x402 Payments (Optional)" collapsible>
            {X402_FIELDS.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={keys[field.key] ?? field.defaultValue ?? ""}
                onChange={(v) => update(field.key, v)}
              />
            ))}
          </Section>
        </div>

        <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between">
          {isEdit && onDisconnect ? (
            <button type="button" onClick={onDisconnect} className="text-sm text-red-500 hover:text-red-600">
              Disconnect & Clear Keys
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!canConnect}
            className="px-6 py-2 text-sm font-medium text-white bg-[var(--accent)] hover:bg-indigo-600 disabled:bg-gray-300 rounded-lg transition-colors"
          >
            {isEdit ? "Save & Reconnect" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
