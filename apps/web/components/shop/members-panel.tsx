"use client";

import { useState } from "react";
import { RotateCcw, UserPlus } from "lucide-react";
import type { ShopMember, ShopMemberRole } from "@fieldfix/contracts";
import { Button } from "@/components/ui/button";
import { MemberRoleBadge, memberRoleLabel } from "./shop-ui";
import { addShopMemberApi, describeApiError, removeShopMemberApi, updateShopMemberApi } from "@/lib/api";

/* Members tab: roster with role management. The server enforces the
 * real guards (manager-only, owners grant owner, never drop the last
 * owner); failures surface as plain error text. */

const ROLES: ShopMemberRole[] = ["owner", "admin", "technician", "front_desk"];

export function MembersPanel({
  shopId,
  token,
  members,
  canManage,
  onMembersChange,
  error,
  onRetry,
}: {
  shopId: string;
  token: string;
  members: ShopMember[] | null;
  canManage: boolean;
  onMembersChange: (members: ShopMember[]) => void;
  error: string | null;
  onRetry: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShopMemberRole>("technician");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);

  const add = () => {
    if (email.trim().length === 0 || busy) {
      return;
    }
    setBusy(true);
    setActionError(null);
    void addShopMemberApi(shopId, token, { email: email.trim(), role }).then(
      (member) => {
        setBusy(false);
        setEmail("");
        onMembersChange([...(members ?? []), member]);
      },
      (err: unknown) => {
        setBusy(false);
        setActionError(describeApiError(err));
      },
    );
  };

  const changeRole = (userId: string, next: ShopMemberRole) => {
    if (pendingUser) {
      return;
    }
    setPendingUser(userId);
    setActionError(null);
    void updateShopMemberApi(shopId, userId, token, { role: next }).then(
      (updated) => {
        setPendingUser(null);
        onMembersChange((members ?? []).map((m) => (m.user_id === updated.user_id ? updated : m)));
      },
      (err: unknown) => {
        setPendingUser(null);
        setActionError(describeApiError(err));
      },
    );
  };

  const remove = (userId: string) => {
    if (pendingUser) {
      return;
    }
    setPendingUser(userId);
    setActionError(null);
    void removeShopMemberApi(shopId, userId, token).then(
      () => {
        setPendingUser(null);
        onMembersChange((members ?? []).filter((m) => m.user_id !== userId));
      },
      (err: unknown) => {
        setPendingUser(null);
        setActionError(describeApiError(err));
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <form
          className="flex flex-col gap-2 rounded-xl border border-edge bg-panel p-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="member-email" className="text-xs font-medium text-slate-400">
              Add by email
            </label>
            <input
              id="member-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={320}
              required
              placeholder="teammate@example.com"
              className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="member-role" className="text-xs font-medium text-slate-400">
              Role
            </label>
            <select
              id="member-role"
              value={role}
              onChange={(e) => setRole(e.target.value as ShopMemberRole)}
              className="rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-slate-100"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {memberRoleLabel(r)}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={email.trim().length === 0 || busy}>
            <UserPlus aria-hidden />
            {busy ? "Adding…" : "Add member"}
          </Button>
        </form>
      )}

      {(error ?? actionError) != null && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5"
          role="alert"
        >
          <p className="text-sm text-slate-200">
            {error != null ? `Couldn't load members: ${error}` : actionError}
          </p>
          {error != null && (
            <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
              <RotateCcw aria-hidden />
              Retry
            </Button>
          )}
        </div>
      )}

      {members != null && members.length > 0 && (
        <ul className="flex flex-col gap-2" role="list">
          {members.map((member) => (
            <li
              key={member.user_id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-edge bg-panel p-3"
            >
              <span className="font-mono text-xs text-slate-300">{member.user_id.slice(0, 8)}</span>
              <MemberRoleBadge role={member.role} />
              {canManage && (
                <span className="ml-auto flex flex-wrap items-center gap-1.5">
                  <select
                    value={member.role}
                    disabled={pendingUser === member.user_id}
                    onChange={(e) => changeRole(member.user_id, e.target.value as ShopMemberRole)}
                    aria-label={`Role for ${member.user_id.slice(0, 8)}`}
                    className="rounded-md border border-edge bg-canvas px-2 py-1.5 text-xs text-slate-100"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {memberRoleLabel(r)}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={pendingUser === member.user_id}
                    onClick={() => remove(member.user_id)}
                  >
                    {pendingUser === member.user_id ? "Saving…" : "Remove"}
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {!canManage && (
        <p className="text-xs text-slate-500">Only owners and admins can manage members.</p>
      )}
    </div>
  );
}
