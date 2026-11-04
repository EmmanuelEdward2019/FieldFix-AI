"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { TechnicianCard, UpsertOwnTechnicianProfile } from "@fieldfix/contracts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ApiError,
  describeApiError,
  getOwnTechnicianProfileApi,
  isAbortError,
  upsertOwnTechnicianProfileApi,
} from "@/lib/api";

/* Pure payload helpers (tested). */

export function parseCommaList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export interface ProfileFormValue {
  display_name: string;
  city: string;
  region: string;
  postal_code: string;
  latitude: string;
  longitude: string;
  specialties: string;
  device_types: string;
  phone: string;
  contact_email: string;
  whatsapp: string;
  about: string;
  accepting_requests: boolean;
}

export function emptyProfileForm(): ProfileFormValue {
  return {
    display_name: "",
    city: "",
    region: "",
    postal_code: "",
    latitude: "",
    longitude: "",
    specialties: "",
    device_types: "",
    phone: "",
    contact_email: "",
    whatsapp: "",
    about: "",
    accepting_requests: true,
  };
}

export function cardToForm(card: TechnicianCard): ProfileFormValue {
  return {
    display_name: card.display_name,
    city: card.city,
    region: card.region,
    postal_code: card.postal_code ?? "",
    latitude: card.latitude != null ? String(card.latitude) : "",
    longitude: card.longitude != null ? String(card.longitude) : "",
    specialties: card.specialties.join(", "),
    device_types: card.device_types.join(", "),
    phone: card.phone ?? "",
    contact_email: card.contact_email ?? "",
    whatsapp: card.whatsapp ?? "",
    about: card.about ?? "",
    accepting_requests: card.accepting_requests,
  };
}

const optionalText = (value: string): string | null =>
  value.trim().length > 0 ? value.trim() : null;

const optionalNumber = (value: string): number | null =>
  value.trim().length > 0 ? Number(value) : null;

/** Form state → PUT /me payload. Coordinates stay null unless BOTH are set. */
export function profileFormToPayload(form: ProfileFormValue): UpsertOwnTechnicianProfile {
  const lat = optionalNumber(form.latitude);
  const lng = optionalNumber(form.longitude);
  return {
    display_name: form.display_name.trim(),
    city: form.city.trim(),
    region: form.region.trim(),
    postal_code: optionalText(form.postal_code),
    latitude: lat != null && lng != null ? lat : null,
    longitude: lat != null && lng != null ? lng : null,
    specialties: parseCommaList(form.specialties),
    device_types: parseCommaList(form.device_types),
    phone: optionalText(form.phone),
    contact_email: optionalText(form.contact_email),
    whatsapp: optionalText(form.whatsapp),
    about: optionalText(form.about),
    accepting_requests: form.accepting_requests,
  };
}

/* Presentational form (render-tested). */

const inputClass =
  "rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500";

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-300">
        {label}
      </label>
      {children}
      {hint != null && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function OwnTechnicianProfileForm({
  initial,
  verified,
  saving,
  error,
  notice,
  onSubmit,
}: {
  initial: ProfileFormValue;
  verified: boolean | null;
  saving: boolean;
  error: string | null;
  notice: string | null;
  onSubmit: (form: ProfileFormValue) => void;
}) {
  const [form, setForm] = useState<ProfileFormValue>(initial);
  const set = (key: keyof ProfileFormValue, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const valid =
    form.display_name.trim().length > 0 &&
    form.city.trim().length > 0 &&
    form.region.trim().length > 0;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
    >
      {verified != null && (
        <p className="text-xs text-slate-400" role="status">
          Verified badge: {verified ? "yes" : "no"} — managed by FieldFix admins, not editable here.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="own-tech-name" label="Display name *">
          <input
            id="own-tech-name"
            type="text"
            value={form.display_name}
            onChange={(e) => set("display_name", e.target.value)}
            maxLength={200}
            required
            placeholder="e.g. Riley Repairs"
            className={inputClass}
          />
        </Field>
        <Field id="own-tech-postal" label="Postal code">
          <input
            id="own-tech-postal"
            type="text"
            value={form.postal_code}
            onChange={(e) => set("postal_code", e.target.value)}
            maxLength={50}
            placeholder="Optional"
            className={inputClass}
          />
        </Field>
        <Field id="own-tech-city" label="City *">
          <input
            id="own-tech-city"
            type="text"
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            maxLength={200}
            required
            placeholder="e.g. Austin"
            className={inputClass}
          />
        </Field>
        <Field id="own-tech-region" label="Region *">
          <input
            id="own-tech-region"
            type="text"
            value={form.region}
            onChange={(e) => set("region", e.target.value)}
            maxLength={200}
            required
            placeholder="e.g. TX"
            className={inputClass}
          />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-lg border border-edge bg-canvas p-3">
        <legend className="px-1 text-xs font-medium text-slate-300">
          Location for radius search (optional)
        </legend>
        <p className="text-xs text-slate-500">
          Entering coordinates opts you in to &ldquo;near me&rdquo; discovery: profiles without
          coordinates never match a radius search. Coordinates are stored on your listing and shown
          only as a distance — never as an address.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="own-tech-lat" label="Latitude">
            <input
              id="own-tech-lat"
              type="number"
              step="any"
              min={-90}
              max={90}
              value={form.latitude}
              onChange={(e) => set("latitude", e.target.value)}
              placeholder="e.g. 30.27"
              className={inputClass}
            />
          </Field>
          <Field id="own-tech-lng" label="Longitude">
            <input
              id="own-tech-lng"
              type="number"
              step="any"
              min={-180}
              max={180}
              value={form.longitude}
              onChange={(e) => set("longitude", e.target.value)}
              placeholder="e.g. -97.74"
              className={inputClass}
            />
          </Field>
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="own-tech-specialties" label="Specialties" hint="Comma-separated, e.g. board repair, data recovery">
          <input
            id="own-tech-specialties"
            type="text"
            value={form.specialties}
            onChange={(e) => set("specialties", e.target.value)}
            placeholder="Optional"
            className={inputClass}
          />
        </Field>
        <Field id="own-tech-devices" label="Device types" hint="Comma-separated, e.g. laptop, smartphone">
          <input
            id="own-tech-devices"
            type="text"
            value={form.device_types}
            onChange={(e) => set("device_types", e.target.value)}
            placeholder="Optional"
            className={inputClass}
          />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-lg border border-edge bg-canvas p-3">
        <legend className="px-1 text-xs font-medium text-slate-300">
          Public contact details (optional)
        </legend>
        <p className="text-xs text-slate-500">
          Anything you enter here is visible to anyone who opens your card. Leave all three blank
          to be reachable only through contact requests.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field id="own-tech-phone" label="Phone">
            <input
              id="own-tech-phone"
              type="tel"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              maxLength={200}
              className={inputClass}
            />
          </Field>
          <Field id="own-tech-email" label="Contact email">
            <input
              id="own-tech-email"
              type="email"
              value={form.contact_email}
              onChange={(e) => set("contact_email", e.target.value)}
              maxLength={320}
              className={inputClass}
            />
          </Field>
          <Field id="own-tech-wa" label="WhatsApp">
            <input
              id="own-tech-wa"
              type="text"
              value={form.whatsapp}
              onChange={(e) => set("whatsapp", e.target.value)}
              maxLength={200}
              className={inputClass}
            />
          </Field>
        </div>
      </fieldset>

      <Field id="own-tech-about" label="About">
        <textarea
          id="own-tech-about"
          value={form.about}
          onChange={(e) => set("about", e.target.value)}
          maxLength={5000}
          rows={3}
          placeholder="Services, hours, service area…"
          className={inputClass}
        />
      </Field>

      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-edge bg-canvas p-3 text-sm text-slate-200">
        <input
          type="checkbox"
          checked={form.accepting_requests}
          onChange={(e) => set("accepting_requests", e.target.checked)}
          className="mt-1 size-4 accent-cyan-400"
        />
        <span>
          <span className="font-medium">Accept contact requests</span>
          <span className="block text-xs text-slate-500">
            Your listing consent: when off, your card stays visible but the Contact button is
            disabled and new requests are rejected.
          </span>
        </span>
      </label>

      {error != null && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5" role="alert">
          <p className="text-sm text-slate-200">{error}</p>
        </div>
      )}
      {notice != null && (
        <p className="text-sm text-emerald-300" role="status">
          {notice}
        </p>
      )}

      <div>
        <Button type="submit" disabled={saving || !valid}>
          {saving ? "Saving…" : "Save technician profile"}
        </Button>
      </div>
    </form>
  );
}

/* Token-gated container: loads GET /me, saves with PUT /me. */

type LoadState =
  | { status: "loading" }
  | { status: "ready"; card: TechnicianCard | null }
  | { status: "error"; message: string };

export function OwnTechnicianProfileSection({ token }: { token: string | null }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!token) {
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    setError(null);
    setNotice(null);
    void getOwnTechnicianProfileApi(token, controller.signal).then(
      (card) => setState({ status: "ready", card }),
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setState({ status: "error", message: describeApiError(err) });
        }
      },
    );
    return () => controller.abort();
  }, [token, reload]);

  if (!token) {
    return (
      <p className="text-sm text-slate-400">
        Sign in to manage your technician listing.
      </p>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-2" role="status" aria-label="Loading technician profile">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5" role="alert">
        <p className="text-sm text-slate-200">
          Couldn&apos;t load your technician profile: {state.message}
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={() => setReload((n) => n + 1)}>
          <RotateCcw aria-hidden />
          Retry
        </Button>
      </div>
    );
  }

  const submit = (form: ProfileFormValue) => {
    if (saving) {
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    const hadCard = state.card != null;
    void upsertOwnTechnicianProfileApi(token, profileFormToPayload(form)).then(
      (card) => {
        setSaving(false);
        setState({ status: "ready", card });
        setNotice(
          hadCard ? "Profile saved." : "Listing created — you now appear in technician search.",
        );
      },
      (err: unknown) => {
        setSaving(false);
        setError(
          err instanceof ApiError && err.code === "invalid_request"
            ? `Check the highlighted fields: ${describeApiError(err)}`
            : describeApiError(err),
        );
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {state.card == null && (
        <p className="text-sm text-slate-400">
          You don&apos;t have a technician listing yet. Create one to appear in search and receive
          contact requests — all fields except name, city, and region are optional.
        </p>
      )}
      <OwnTechnicianProfileForm
        key={state.card?.updated_at ?? "new"}
        initial={state.card ? cardToForm(state.card) : emptyProfileForm()}
        verified={state.card ? state.card.verified : null}
        saving={saving}
        error={error}
        notice={notice}
        onSubmit={submit}
      />
    </div>
  );
}
