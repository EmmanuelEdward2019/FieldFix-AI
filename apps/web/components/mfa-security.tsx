"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  describeApiError,
  isAbortError,
  mfaDisableApi,
  mfaEnrollApi,
  mfaStatusApi,
  mfaVerifyApi,
} from "@/lib/api";

const inputClass =
  "w-full rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500";

/**
 * Two-factor authentication management. TOTP via any authenticator
 * app; required for Super Admin console access. Backup codes are
 * shown once at activation — the server only keeps hashes.
 */
export function MfaSecurity({ token }: { token: string | null }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const [pending, setPending] = useState<{ otpauth_url: string; secret: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }
    const controller = new AbortController();
    void mfaStatusApi(token, controller.signal).then(
      (status) => {
        setEnabled(status.enabled);
        setVerifiedAt(status.verified_at);
      },
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setError(describeApiError(err));
        }
      },
    );
    return () => controller.abort();
  }, [token]);

  if (!token) {
    return null;
  }

  const enroll = () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    void mfaEnrollApi(token).then(
      (result) => {
        setPending({ otpauth_url: result.otpauth_url, secret: result.secret });
        setBusy(false);
        void QRCode.toDataURL(result.otpauth_url, { margin: 1, width: 192 }).then(
          (url) => setQr(url),
          () => setQr(null),
        );
      },
      (err: unknown) => {
        setBusy(false);
        setError(describeApiError(err));
      },
    );
  };

  const verify = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !code.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    void mfaVerifyApi(token, { code: code.trim() }).then(
      (result) => {
        setBusy(false);
        setEnabled(true);
        setPending(null);
        setQr(null);
        setCode("");
        setBackupCodes(result.backup_codes ?? null);
        setVerifiedAt(new Date().toISOString());
      },
      (err: unknown) => {
        setBusy(false);
        setError(describeApiError(err));
      },
    );
  };

  const disable = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !disableCode.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    void mfaDisableApi(token, { code: disableCode.trim() }).then(
      () => {
        setBusy(false);
        setEnabled(false);
        setVerifiedAt(null);
        setConfirmingDisable(false);
        setDisableCode("");
      },
      (err: unknown) => {
        setBusy(false);
        setError(describeApiError(err));
      },
    );
  };

  const copyCodes = () => {
    if (!backupCodes) {
      return;
    }
    void navigator.clipboard.writeText(backupCodes.join("\n")).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <section
      aria-label="Two-factor authentication"
      id="security"
      className="rounded-xl border border-edge bg-panel p-5"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
        {enabled ? (
          <ShieldCheck className="size-4 text-emerald-300" aria-hidden />
        ) : (
          <ShieldOff className="size-4 text-slate-400" aria-hidden />
        )}
        Two-factor authentication
      </h2>

      {enabled == null && error == null ? (
        <Skeleton className="mt-3 h-10" />
      ) : (
        <p className="mt-1 text-xs text-slate-400">
          {enabled
            ? `Enabled${verifiedAt ? ` since ${new Date(verifiedAt).toLocaleDateString()}` : ""}. Sign-ins ask for an authenticator code.`
            : "Add an authenticator app as a second sign-in step. Required for Super Admin console access."}
        </p>
      )}

      {error != null && (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {error}
          {error.includes("not configured") && (
            <> The server operator must set MFA_ENCRYPTION_KEY.</>
          )}
        </p>
      )}

      {enabled === false && pending == null && (
        <Button type="button" size="sm" onClick={enroll} disabled={busy} className="mt-3">
          {busy ? "Preparing…" : "Set up authenticator app"}
        </Button>
      )}

      {pending != null && (
        <form onSubmit={verify} className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            {qr != null ? (
              <img
                src={qr}
                alt="QR code for your authenticator app"
                width={192}
                height={192}
                className="shrink-0 rounded-lg border border-edge bg-white p-1"
              />
            ) : (
              <Skeleton className="size-48 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-xs text-slate-300">
                1. Scan the code with Google Authenticator, 1Password, or similar.
              </p>
              <p className="mt-1 text-xs text-slate-300">
                2. Can&apos;t scan? Enter this key manually:
              </p>
              <code className="mt-1 block break-all rounded bg-canvas px-2 py-1 text-xs text-cyan-200">
                {pending.secret}
              </code>
              <p className="mt-1 text-xs text-slate-300">3. Enter the 6-digit code below.</p>
            </div>
          </div>
          <div>
            <label htmlFor="mfa-setup-code" className="text-xs font-medium text-slate-300">
              6-digit code
            </label>
            <input
              id="mfa-setup-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className={`${inputClass} mt-1 max-w-56 tracking-widest`}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Verifying…" : "Verify & enable"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setPending(null);
                setQr(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {backupCodes != null && (
        <div
          role="status"
          className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3"
        >
          <p className="text-xs font-medium text-amber-200">
            Save these backup codes — each works once if you lose your device:
          </p>
          <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs text-slate-200">
            {backupCodes.map((backup) => (
              <li key={backup}>{backup}</li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={copyCodes}>
              {copied ? "Copied" : "Copy codes"}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setBackupCodes(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {enabled === true && !confirmingDisable && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-3"
          onClick={() => {
            setConfirmingDisable(true);
            setError(null);
          }}
        >
          Disable two-factor
        </Button>
      )}

      {enabled === true && confirmingDisable && (
        <form onSubmit={disable} className="mt-3 flex max-w-56 flex-col gap-2">
          <label htmlFor="mfa-disable-code" className="text-xs font-medium text-slate-300">
            Confirm with a current code
          </label>
          <input
            id="mfa-disable-code"
            type="text"
            autoComplete="one-time-code"
            required
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
            placeholder="123456 or backup code"
            className={`${inputClass} tracking-widest`}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Disabling…" : "Confirm disable"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setConfirmingDisable(false);
                setDisableCode("");
                setError(null);
              }}
            >
              Keep
            </Button>
          </div>
          {error != null && errIsInvalidCode(error) && (
            <p className="text-xs text-slate-400">Lost your device? Use a backup code.</p>
          )}
        </form>
      )}
    </section>
  );
}

function errIsInvalidCode(message: string): boolean {
  return message.toLowerCase().includes("incorrect");
}
