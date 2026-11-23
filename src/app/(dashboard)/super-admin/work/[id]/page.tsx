import Client from "./page-client";

// The static build (S3 + CloudFront) needs one pre-built page per detail route; the real id is read in the
// browser (see src/lib/route-id.ts). On the Node server, every other id is rendered on demand.
export function generateStaticParams() {
  return [{ id: "_" }];
}

export default function Page() {
  return <Client />;
}
