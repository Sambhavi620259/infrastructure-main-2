import { mapEmbedUrl, mapLink } from "@/lib/maps";

/** Map preview with a pin on the office location, and a link to open the full map. */
export function LocationMap({ latitude, longitude, label }: { latitude: number; longitude: number; label: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <iframe
        title={`Map of ${label}`}
        src={mapEmbedUrl(latitude, longitude)}
        className="h-48 w-full"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      <a
        href={mapLink(latitude, longitude)}
        target="_blank"
        rel="noreferrer"
        className="block border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
      >
        Open in map ({latitude.toFixed(5)}, {longitude.toFixed(5)})
      </a>
    </div>
  );
}
