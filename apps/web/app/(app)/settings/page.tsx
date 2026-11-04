"use client";

import { useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { describeApiError, changePasswordApi, updateProfileApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function SettingsPage() {
  const { user, token, refresh } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const saveProfile = () => {
    if (!token || saving) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setProfileMsg({ ok: false, text: "Display name cannot be empty." });
      return;
    }
    setSaving(true);
    setProfileMsg(null);
    void updateProfileApi(token, { name: trimmed }).then(
      () => {
        setSaving(false);
        setProfileMsg({ ok: true, text: "Profile updated." });
        void refresh();
      },
      (err: unknown) => {
        setSaving(false);
        setProfileMsg({ ok: false, text: describeApiError(err) });
      },
    );
  };

  const savePassword = (event: React.FormEvent) => {
    event.preventDefault();
    if (!token || saving) {
      return;
    }
    setSaving(true);
    setPasswordMsg(null);
    void changePasswordApi(token, { current_password: currentPassword, new_password: nextPassword }).then(
      () => {
        setSaving(false);
        setPasswordMsg({ ok: true, text: "Password changed." });
        setCurrentPassword("");
        setNextPassword("");
      },
      (err: unknown) => {
        setSaving(false);
        setPasswordMsg({ ok: false, text: describeApiError(err) });
      },
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-50">Settings</h1>
        <p className="mt-0.5 text-sm text-slate-400">Manage your account and sign-in details.</p>
      </div>

      <section aria-labelledby="profile-heading" className="rounded-xl border border-edge bg-panel p-4">
        <h2 id="profile-heading" className="text-sm font-semibold text-slate-100">
          Profile
        </h2>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-300">
            Display name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={user?.email ?? "Your name"}
              maxLength={120}
              className="rounded-md border border-edge-strong bg-canvas px-3 py-2 text-sm font-normal text-slate-100 placeholder:text-slate-500"
            />
          </label>
          <p className="text-xs text-slate-500">
            Signed in as <span className="text-slate-300">{user?.email}</span>
          </p>
          {profileMsg != null && (
            <p role="status" className={`text-xs ${profileMsg.ok ? "text-emerald-300" : "text-red-300"}`}>
              {profileMsg.text}
            </p>
          )}
          <div>
            <Button type="button" size="sm" onClick={saveProfile} disabled={saving}>
              {saving ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="password-heading" className="rounded-xl border border-edge bg-panel p-4">
        <h2 id="password-heading" className="text-sm font-semibold text-slate-100">
          Password
        </h2>
        <form onSubmit={savePassword} className="mt-3 flex flex-col gap-3">
          <PasswordInput
            label="Current password"
            id="settings-current"
            name="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            className="rounded-md border border-edge-strong bg-canvas px-3 py-2 text-sm font-normal text-slate-100 placeholder:text-slate-500"
          />
          <PasswordInput
            label="New password"
            id="settings-new"
            name="new-password"
            value={nextPassword}
            onChange={(e) => setNextPassword(e.target.value)}
            autoComplete="new-password"
            className="rounded-md border border-edge-strong bg-canvas px-3 py-2 text-sm font-normal text-slate-100 placeholder:text-slate-500"
          />
          {passwordMsg != null && (
            <p
              role="status"
              className={`flex items-center gap-1.5 text-xs ${passwordMsg.ok ? "text-emerald-300" : "text-red-300"}`}
            >
              {passwordMsg.ok ? (
                <CheckCircle2 className="size-3.5" aria-hidden />
              ) : (
                <RotateCcw className="size-3.5" aria-hidden />
              )}
              {passwordMsg.text}
            </p>
          )}
          <div>
            <Button type="submit" size="sm" disabled={saving || !currentPassword || !nextPassword}>
              {saving ? "Saving…" : "Change password"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
