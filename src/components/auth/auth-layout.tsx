import type { ComponentType, InputHTMLAttributes, ReactNode, SVGProps } from "react";
import {
  ChartBarIcon,
  ClipboardDocumentCheckIcon,
  ComputerDesktopIcon,
  TicketIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";

type Feature = { title: string; text: string; icon: ComponentType<SVGProps<SVGSVGElement>> };

const FEATURES: Feature[] = [
  { title: "Asset Management", text: "Track hardware from purchase to disposal", icon: ComputerDesktopIcon },
  { title: "Service Tickets", text: "Handle asset requests and returns", icon: TicketIcon },
  { title: "Warranty & Maintenance", text: "Stay ahead of expiring coverage", icon: WrenchScrewdriverIcon },
  { title: "Reports & Analytics", text: "Audit, lifecycle and inventory insights", icon: ChartBarIcon },
];

/**
 * Split-screen frame for the sign-in and registration pages: a navy brand
 * panel on the left (hidden on small screens) and the form on the right.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-[45%] flex-col justify-between bg-[#14213d] px-10 py-10 text-white lg:flex xl:px-14">
        <div>
          <span className="grid h-14 w-14 place-items-center rounded-full bg-white/10">
            <ClipboardDocumentCheckIcon className="h-7 w-7" aria-hidden="true" />
          </span>
          <h1 className="mt-8 text-4xl font-extrabold tracking-tight">IT Asset Management Portal</h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-slate-300">
            Securely manage hardware, software, service tickets, warranties and audits from one unified
            workspace.
          </p>
        </div>

        <ul className="my-10 space-y-3">
          {FEATURES.map(({ title, text, icon: Icon }) => (
            <li
              key={title}
              className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-500/25 text-blue-300">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-bold">{title}</span>
                <span className="block text-sm text-slate-300">{text}</span>
              </span>
            </li>
          ))}
        </ul>

        <p className="text-sm text-slate-400">© {new Date().getFullYear()} Bold and Wise Ventures Pvt. Ltd.</p>
      </aside>

      <main className="flex min-w-0 flex-1 items-center justify-center px-3 py-8 min-[360px]:px-4 sm:px-8 sm:py-10">
        <div className="w-full max-w-md">
          {/* The brand panel is hidden on small screens, so show the name above the card. */}
          <p className="mb-6 text-center text-lg font-extrabold text-slate-900 lg:hidden">
            IT Asset Management Portal
          </p>
          <section className="rounded-3xl bg-white p-5 shadow-xl shadow-slate-200/70 min-[360px]:p-7 sm:p-9">{children}</section>
        </div>
      </main>
    </div>
  );
}

/** Text input with a leading icon, used by the auth forms. */
export function IconField({
  label,
  icon: Icon,
  trailing,
  ...inputProps
}: {
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  trailing?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-sm font-semibold text-slate-700">
      {label}
      <span className="mt-1.5 flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
        <Icon className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
        <input
          {...inputProps}
          className="min-w-0 flex-1 bg-transparent py-3 text-base font-normal text-slate-900 outline-none placeholder:text-slate-400 read-only:text-slate-500"
        />
        {trailing}
      </span>
    </label>
  );
}
