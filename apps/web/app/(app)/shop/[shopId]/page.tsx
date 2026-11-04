"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
import type {
  RepairJob,
  Shop,
  ShopCustomer,
  ShopMember,
  ShopMemberRole,
} from "@fieldfix/contracts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomersPanel } from "@/components/shop/customers-panel";
import { InventoryPanel } from "@/components/shop/inventory-panel";
import { JobDetailDialog } from "@/components/shop/job-detail";
import { JobsPanel } from "@/components/shop/jobs-panel";
import { MembersPanel } from "@/components/shop/members-panel";
import { ReportsPanel } from "@/components/shop/reports-panel";
import { MemberRoleBadge } from "@/components/shop/shop-ui";
import {
  describeApiError,
  getShopApi,
  isAbortError,
  listShopCustomersApi,
  listShopMembersApi,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function ShopDetailPage({ params }: { params: Promise<{ shopId: string }> }) {
  const { shopId } = use(params);
  const { token, status } = useAuth();
  const [shop, setShop] = useState<Shop | null>(null);
  const [myRole, setMyRole] = useState<ShopMemberRole | null>(null);
  const [members, setMembers] = useState<ShopMember[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<ShopCustomer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState("jobs");
  const [openJob, setOpenJob] = useState<RepairJob | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [jobsRefresh, setJobsRefresh] = useState(0);
  const [hazardousJobIds, setHazardousJobIds] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    if (!token) {
      return () => undefined;
    }
    const controller = new AbortController();
    setShop(null);
    setError(null);
    setMembers(null);
    setMembersError(null);
    setCustomers(null);
    void getShopApi(shopId, token, controller.signal).then(
      (res) => {
        setShop(res.shop);
        setMyRole(res.my_role);
      },
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setError(describeApiError(err));
        }
      },
    );
    void listShopMembersApi(shopId, token, controller.signal).then(
      (res) => setMembers(res.members),
      (err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) {
          setMembersError(describeApiError(err));
        }
      },
    );
    void listShopCustomersApi(shopId, token, undefined, controller.signal).then(
      (res) => setCustomers(res.customers),
      () => {
        if (!controller.signal.aborted) {
          setCustomers([]);
        }
      },
    );
    return () => controller.abort();
  }, [shopId, token, reload]);

  useEffect(() => load(), [load]);

  const openJobDetail = (job: RepairJob) => {
    setOpenJob(job);
    setDetailOpen(true);
  };

  const customerName = openJob
    ? (customers ?? []).find((c) => c.id === openJob.customer_id)?.name ?? null
    : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <Link
        href="/shop"
        className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        All shops
      </Link>

      {status === "loading" && <Skeleton className="h-10 w-64" />}
      {status !== "loading" && !token && (
        <div className="rounded-xl border border-dashed border-edge-strong p-6 text-center">
          <p className="text-sm text-slate-300">Sign in to open this shop.</p>
        </div>
      )}

      {error != null && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2.5"
          role="alert"
        >
          <p className="text-sm text-slate-200">Couldn&apos;t load this shop: {error}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => setReload((n) => n + 1)}>
            <RotateCcw aria-hidden />
            Retry
          </Button>
        </div>
      )}

      {token != null && shop == null && error == null && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading shop">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-12" />
        </div>
      )}

      {token != null && shop != null && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight text-slate-50">
                {shop.name}
                {myRole && <MemberRoleBadge role={myRole} />}
              </h1>
              <p className="mt-0.5 text-sm text-slate-400">
                {shop.description ??
                  [shop.city, shop.region, shop.country].filter(Boolean).join(", ") ??
                  "Repair workspace"}
              </p>
            </div>
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="Shop workspace">
              <TabsTrigger value="jobs">Jobs</TabsTrigger>
              <TabsTrigger value="customers">Customers</TabsTrigger>
              <TabsTrigger value="inventory">Inventory</TabsTrigger>
              <TabsTrigger value="reports">Reports</TabsTrigger>
              <TabsTrigger value="members">Members</TabsTrigger>
            </TabsList>

            <TabsContent value="jobs">
              <JobsPanel
                shopId={shopId}
                token={token}
                customers={customers ?? []}
                members={members ?? []}
                hazardousJobIds={hazardousJobIds}
                onOpenJob={openJobDetail}
                refreshKey={jobsRefresh}
              />
            </TabsContent>
            <TabsContent value="customers">
              <CustomersPanel
                shopId={shopId}
                token={token}
                customers={customers}
                onCustomersChange={setCustomers}
              />
            </TabsContent>
            <TabsContent value="inventory">
              <InventoryPanel shopId={shopId} token={token} />
            </TabsContent>
            <TabsContent value="reports">
              <ReportsPanel shopId={shopId} token={token} />
            </TabsContent>
            <TabsContent value="members">
              <MembersPanel
                shopId={shopId}
                token={token}
                members={members}
                canManage={myRole === "owner" || myRole === "admin"}
                onMembersChange={setMembers}
                error={membersError}
                onRetry={() => setReload((n) => n + 1)}
              />
            </TabsContent>
          </Tabs>

          <JobDetailDialog
            shopId={shopId}
            token={token}
            job={openJob}
            members={members ?? []}
            customerName={customerName}
            open={detailOpen}
            onOpenChange={setDetailOpen}
            onJobChanged={(updated) => {
              setOpenJob(updated);
              setJobsRefresh((n) => n + 1);
            }}
            onHazardChange={(jobId, hazardous) =>
              setHazardousJobIds((prev) => {
                const next = new Set(prev);
                if (hazardous) {
                  next.add(jobId);
                } else {
                  next.delete(jobId);
                }
                return next;
              })
            }
          />
        </>
      )}
    </div>
  );
}
