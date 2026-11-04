import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  CircleCheck,
  Laptop,
  Monitor,
  ScanSearch,
  ShieldCheck,
  Smartphone,
  Wrench,
} from "lucide-react";
import { DeviceScene } from "@/components/fx/device-scene";
import { CountUp } from "@/components/landing/count-up";
import { DiagnosisPhone } from "@/components/landing/diagnosis-phone";
import { FaultTicker } from "@/components/landing/fault-ticker";
import { HeroVisual } from "@/components/landing/hero-visual";
import { ReportPreview } from "@/components/landing/report-preview";
import { Reveal } from "@/components/landing/reveal";
import { TelemetryDeck } from "@/components/landing/telemetry";
import { PlatformName, SupportContact } from "@/components/platform-brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/lib/theme";

const NAV = [
  { href: "#telemetry", label: "Telemetry" },
  { href: "#how", label: "How it works" },
  { href: "#devices", label: "Devices" },
  { href: "#shops", label: "Repair shops" },
];

const STATS = [
  { value: 3, suffix: "", label: "device families covered" },
  { value: 4, suffix: "", label: "guided intake steps" },
  { value: 100, suffix: "%", label: "of findings cited" },
];

const DEVICE_CARDS = [
  {
    device: "laptop",
    icon: Laptop,
    title: "Laptops",
    hint: "Power, battery, display, heat",
    faults: ["No power", "Overheating", "Dim screen"],
  },
  {
    device: "desktop",
    icon: Monitor,
    title: "Desktops",
    hint: "PSU, GPU, boot faults",
    faults: ["Boot loop", "GPU artifacts", "Dead PSU"],
  },
  {
    device: "smartphone",
    icon: Smartphone,
    title: "Phones",
    hint: "Screen, touch, cameras",
    faults: ["No charge", "Dead touch", "Cracked display"],
  },
] as const;

const SHOP_POINTS = [
  {
    icon: BookOpenText,
    title: "Reports customers believe",
    text: "Every finding ships with the test that proved it and the manual page behind it.",
  },
  {
    icon: ShieldCheck,
    title: "Safety that stops the bench",
    text: "Swollen batteries and cracked cells halt the session before anyone gets hurt.",
  },
  {
    icon: CircleCheck,
    title: "Guesses stay labelled",
    text: "Unverified causes are marked as guesses — never silently sold as facts.",
  },
];

/**
 * Public landing page. No account needed to read it or to open the
 * restricted synthetic demo; real diagnosis requires signing in.
 */
export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-edge bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <span className="flex size-8 items-center justify-center rounded-md border border-edge bg-panel">
            <Wrench className="size-4 text-cyan-300" aria-hidden />
          </span>
          <PlatformName className="text-sm font-semibold tracking-tight text-slate-50" />
          <nav className="ml-6 hidden items-center gap-4 md:flex" aria-label="Sections">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-xs font-medium text-slate-400 transition-colors hover:text-slate-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <nav className="ml-auto flex items-center gap-2" aria-label="Account">
            <ThemeToggle />
            <Button type="button" variant="ghost" size="sm" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button type="button" size="sm" asChild>
              <Link href="/register">Create account</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        <section
          className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 pt-10 pb-12 sm:px-6 sm:pt-14 lg:grid-cols-2"
          aria-labelledby="hero-title"
        >
          <div className="flex flex-col items-start gap-4">
            <Badge variant="default">
              <span className="size-1.5 animate-pulse-soft rounded-full bg-cyan-300" aria-hidden />
              Evidence-driven troubleshooting
            </Badge>
            <h1
              id="hero-title"
              className="max-w-xl text-4xl font-semibold tracking-tight text-slate-50 sm:text-5xl"
            >
              Show the device. Show the problem. Fix it with proof.
            </h1>
            <p className="max-w-md text-sm text-slate-400 sm:text-base">
              FieldFix AI guides laptop, desktop, and phone repairs with AI
              analysis, safe step-by-step tests, real manual citations, and
              reports a repair shop can trust.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="lg" asChild>
                <Link href="/register">
                  Start diagnosing
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button type="button" variant="secondary" size="lg" asChild>
                <Link href="/demo">Explore the demo</Link>
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              The demo uses fictional data and cannot run live AI analysis.
            </p>
            <dl className="mt-2 flex w-full max-w-md items-stretch gap-6 border-t border-edge pt-4">
              {STATS.map((stat) => (
                <div key={stat.label} className="flex flex-col">
                  <dt className="order-2 mt-1 text-xs text-slate-500">{stat.label}</dt>
                  <dd className="order-1 text-2xl font-semibold text-slate-50 tabular-nums">
                    <CountUp value={stat.value} suffix={stat.suffix} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <HeroVisual />
        </section>

        <FaultTicker />

        <section
          id="telemetry"
          aria-labelledby="telemetry-title"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-12 sm:px-6 sm:py-16"
        >
          <Reveal>
            <p className="text-xs font-semibold tracking-widest text-cyan-300 uppercase">
              Live telemetry
            </p>
            <h2
              id="telemetry-title"
              className="mt-1 max-w-xl text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl"
            >
              Every reading, visualized while you work
            </h2>
            <p className="mt-2 max-w-xl text-sm text-slate-400">
              Processor load, per-core curves, sensor traces, and a full system
              summary — the numbers behind the diagnosis, rendered the moment
              they matter.
            </p>
          </Reveal>
          <Reveal className="mt-6">
            <TelemetryDeck />
          </Reveal>
        </section>

        <section
          id="how"
          aria-labelledby="how-title"
          className="border-y border-edge bg-panel/40"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-12 sm:px-6 sm:py-16">
            <Reveal>
              <p className="text-xs font-semibold tracking-widest text-cyan-300 uppercase">
                How it works
              </p>
              <h2
                id="how-title"
                className="mt-1 max-w-xl text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl"
              >
                From broken device to proven fix in three moves
              </h2>
            </Reveal>

            <Reveal className="grid items-center gap-6 lg:grid-cols-2">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <span className="flex size-7 items-center justify-center rounded-md bg-canvas text-xs font-semibold text-cyan-300">
                    1
                  </span>
                  <ScanSearch className="size-4 text-slate-400" aria-hidden />
                  Show the evidence
                </p>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-400">
                  Describe the fault and upload photos. Component regions are
                  marked on your pictures, so the AI reasons about what it can
                  actually see — not what it guesses.
                </p>
              </div>
              <DeviceScene device="smartphone" />
            </Reveal>

            <Reveal className="grid items-center gap-6 lg:grid-cols-2">
              <div className="lg:order-2">
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <span className="flex size-7 items-center justify-center rounded-md bg-canvas text-xs font-semibold text-cyan-300">
                    2
                  </span>
                  Test, don&apos;t guess
                </p>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-400">
                  AI proposes causes, then guides one safe distinguishing test
                  at a time — right on the bench, right on your phone. Each
                  result narrows the field until one cause stands verified.
                </p>
              </div>
              <div className="lg:order-1">
                <DiagnosisPhone />
              </div>
            </Reveal>

            <Reveal className="grid items-center gap-6 lg:grid-cols-2">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <span className="flex size-7 items-center justify-center rounded-md bg-canvas text-xs font-semibold text-cyan-300">
                    3
                  </span>
                  <ShieldCheck className="size-4 text-slate-400" aria-hidden />
                  Stay safe, share proof
                </p>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-400">
                  Hazards stop the session automatically. Reports separate
                  guesses from verified findings, with citations your customer
                  — or your insurer — can check.
                </p>
              </div>
              <ReportPreview />
            </Reveal>
          </div>
        </section>

        <section
          id="devices"
          aria-labelledby="devices-title"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-12 sm:px-6 sm:py-16"
        >
          <Reveal>
            <p className="text-xs font-semibold tracking-widest text-cyan-300 uppercase">
              Coverage
            </p>
            <h2
              id="devices-title"
              className="mt-1 text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl"
            >
              What can it diagnose?
            </h2>
          </Reveal>
          <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3" role="list">
            {DEVICE_CARDS.map(({ device, icon: Icon, title, hint, faults }) => (
              <li key={title}>
                <Link
                  href={`/diagnostics/new?device=${device}`}
                  className="flex h-full flex-col gap-3 rounded-2xl border border-edge bg-panel p-4 transition-colors hover:border-cyan-400/40"
                >
                  <DeviceScene device={device} scanning={false} />
                  <span>
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-100">
                      <Icon className="size-4 text-cyan-300" aria-hidden />
                      {title}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>
                  </span>
                  <span className="mt-auto flex flex-wrap gap-1.5" aria-label={`Example ${title} faults`}>
                    {faults.map((fault) => (
                      <span
                        key={fault}
                        className="rounded-full border border-edge bg-canvas px-2 py-0.5 text-[11px] text-slate-300"
                      >
                        {fault}
                      </span>
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section
          id="shops"
          aria-labelledby="shops-title"
          className="border-t border-edge"
        >
          <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-2">
            <Reveal className="overflow-hidden rounded-3xl border border-edge">
              <Image
                src="/landing/technician-shop.jpg"
                alt="Repair shop technicians at work — one holding a motherboard, another fixing a laptop at a glowing bench"
                width={1280}
                height={960}
                className="block h-auto w-full object-cover"
              />
            </Reveal>
            <Reveal>
              <p className="text-xs font-semibold tracking-widest text-cyan-300 uppercase">
                For repair shops
              </p>
              <h2
                id="shops-title"
                className="mt-1 text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl"
              >
                Run the bench your customers brag about
              </h2>
              <ul className="mt-6 flex flex-col gap-4" role="list">
                {SHOP_POINTS.map(({ icon: Icon, title, text }) => (
                  <li key={title} className="flex gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-cyan-400/25 bg-cyan-400/5">
                      <Icon className="size-4 text-cyan-300" aria-hidden />
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-slate-100">{title}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-slate-400">
                        {text}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <Button type="button" className="mt-6" asChild>
                <Link href="/register">
                  Create your shop account
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            </Reveal>
          </div>
        </section>

        <section
          aria-labelledby="cta-title"
          className="mx-auto w-full max-w-6xl px-4 pb-12 sm:px-6 sm:pb-16"
        >
          <Reveal className="flex flex-col items-start gap-4 rounded-3xl border border-cyan-400/25 bg-panel p-8 sm:p-10">
            <h2
              id="cta-title"
              className="max-w-xl text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl"
            >
              The next device on your bench could come with proof.
            </h2>
            <p className="max-w-lg text-sm text-slate-400">
              Try the fictional demo in under a minute, or create an account and
              run your first real diagnosis today.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="lg" asChild>
                <Link href="/register">
                  Start diagnosing
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button type="button" variant="secondary" size="lg" asChild>
                <Link href="/demo">Try the demo</Link>
              </Button>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-edge">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 text-xs text-slate-500 sm:px-6">
          <span>
            <PlatformName /> · evidence-driven troubleshooting
          </span>
          <SupportContact />
          <Link href="/demo" className="underline">
            Demo
          </Link>
          <Link href="/admin" className="underline">
            Admin console
          </Link>
          <span className="sm:ml-auto">
            Emmanuel Edward - Meta Global AI Developer Hackathon
          </span>
        </div>
      </footer>
    </div>
  );
}
